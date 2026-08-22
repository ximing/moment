import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';
import type { MomentResponse, TagResponse, TemplateManifest } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { humanError } from '@/lib/errors';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';
import { canCompose } from '@/lib/roles';
import { summarizePayload } from '@/lib/template';
import { currentTzOffset, toWallClockInput, wallClockToIso } from '@/lib/time';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import type { ComposeRequest } from '@/services/compose-session.service';

export interface PickedImage {
  file: File;
  previewUrl: string;
}

export interface PickedVideo {
  file: File;
  previewUrl: string;
  durationSeconds: number;
}

function isPastHappenedAt(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) > 5 * 60_000;
}

/** 发布面板（spec §4.6）：草稿活在面板生命周期；submit 成功 emit + markCreated + close。 */
export class ComposePanelService extends Service {
  request: ComposeRequest | null = null;
  pickedChainId = '';
  content = '';
  images: PickedImage[] = [];
  video: PickedVideo | null = null;
  /** 封面草稿（spec video-poster §3：与视频选择同生同灭）；截帧失败保持 null = 无封面发布 */
  posterBlob: Blob | null = null;
  posterMediaId: string | null = null;
  replaceConfirm: 'image' | 'video' | null = null;
  pendingFiles: File[] = [];
  happenedAt = nowLocalInput();
  selectedTags: string[] = [];
  newTag = '';
  progress: string | null = null;
  error: string | null = null; // 本地校验 + humanError(API) 都落这里（面板内，spec §8）
  tagList: TagResponse[] = [];
  /** 当前链的模板 manifest（链详情内嵌，spec §3.2）；null = 未加载或无扩展 */
  manifest: TemplateManifest | null = null;
  /** 结构化类别（spec §1.1）；standard = 普通 moment。编辑模式锁定为原 kind（S4：不允许切 kind） */
  kind = 'standard';
  /** momentFields / kind payload 的草稿值；key 与 manifest 声明一致 */
  payloadDraft: Record<string, unknown> = {};
  geoBusy = false;
  private manifestChainId = '';

  get chainList(): ChainListService {
    return this.resolve(ChainListService);
  }

  get writableChains() {
    return this.chainList.chains.filter(canCompose);
  }

  get chainId(): string {
    return this.pickedChainId || this.writableChains[0]?.id || '';
  }

  get edit(): MomentResponse | undefined {
    return this.request?.edit;
  }

  get needChainPick(): boolean {
    return !this.edit && !this.request?.chainId && this.writableChains.length > 1 && !this.chainId;
  }

  hydrate(request: ComposeRequest): void {
    this.request = request;
    this.pickedChainId = request.chainId ?? request.edit?.chainId ?? '';
    this.content = request.edit?.content ?? '';
    this.happenedAt = request.edit
      ? toWallClockInput(request.edit.happenedAt, request.edit.happenedTzOffset)
      : nowLocalInput();
    this.selectedTags = request.edit?.tags.map((t) => t.id) ?? [];
    // 编辑模式：kind 锁定原值，payload 草稿从既有值水合（S4：提交时 kind+payload 始终显式携带）
    this.kind = request.edit?.kind ?? 'standard';
    this.payloadDraft = { ...(request.edit?.payload ?? {}) };
    this.manifest = null;
    this.manifestChainId = '';
  }

  async loadTagList(): Promise<void> {
    if (!this.chainId) {
      this.tagList = [];
      return;
    }
    this.tagList = (await client.listTags(this.chainId)).tags;
  }

  /** 面板内切链（评审 H4）：重置结构化状态——旧链的 kind/payload 草稿对新链模板无意义；
   *  manifest 置 null 使 TemplateFields 在新 manifest 到达前不渲染（await 期间无旧表单可提交）。 */
  pickChain(chainId: string): void {
    if (this.pickedChainId === chainId) return;
    this.pickedChainId = chainId;
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
  }

  /** 链切换时拉模板 manifest（链详情内嵌；同链幂等）。失败静默：无扩展字段可填，主流程不阻塞。 */
  async loadManifest(chainId: string): Promise<void> {
    if (!chainId || this.manifestChainId === chainId) return;
    this.manifestChainId = chainId;
    const detail = await client.getChain(chainId);
    // 异步返回时链已切换则丢弃（防串链）
    if (this.chainId === chainId) this.manifest = detail.templateManifest;
  }

  /** 切 kind（仅新建；编辑模式 UI 不提供入口）。切走清空草稿，防旧值按新 kind 校验不过（S4 推论）。 */
  setKind(kind: string): void {
    this.kind = kind;
    this.payloadDraft = {};
  }

  /** momentField / kind 字段值写入草稿；undefined 表示清除该 key */
  setFieldValue(key: string, value: unknown): void {
    const next = { ...this.payloadDraft };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.payloadDraft = next;
  }

  /** geo 字段：浏览器定位（Geolocation API）；失败写 error，草稿不留半成品 */
  async pickGeo(fieldKey: string): Promise<void> {
    if (!('geolocation' in navigator)) {
      this.error = '这个浏览器不支持定位';
      return;
    }
    this.geoBusy = true;
    this.error = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000 }),
      );
      const prev = this.payloadDraft[fieldKey] as { place_name?: string } | undefined;
      this.setFieldValue(fieldKey, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(prev?.place_name ? { place_name: prev.place_name } : {}),
      });
    } catch {
      this.error = '没拿到定位，检查一下浏览器权限';
    } finally {
      this.geoBusy = false;
    }
  }

  async createTag(): Promise<void> {
    const name = this.newTag.trim();
    if (!name || !this.chainId) return;
    try {
      const tag = await client.createTag(this.chainId, name);
      this.selectedTags = [...this.selectedTags, tag.id];
      this.newTag = '';
      await this.loadTagList();
    } catch (e) {
      this.error = humanError(e);
    }
  }

  toggleTag(id: string): void {
    this.selectedTags = this.selectedTags.includes(id)
      ? this.selectedTags.filter((x) => x !== id)
      : [...this.selectedTags, id];
  }

  addImages(files: File[]): void {
    this.error = null;
    const next = [...this.images];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        this.error = `「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}）`;
        continue;
      }
      if (next.length >= 9) {
        this.error = '最多 9 张图片';
        break;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    this.images = next;
  }

  /** 截帧组件回调；blob 为 null = 截帧失败降级（静默无封面） */
  setPoster(blob: Blob | null): void {
    this.posterBlob = blob;
    this.posterMediaId = null; // 换帧后已上传的 id 作废（重传；旧行按 §2.4 ready-unbound gap 处理）
  }

  /** 视频重置路径统一调用：丢弃已截帧/已上传的封面草稿（位图与 posterMediaId 一并清空） */
  private resetPoster(): void {
    this.posterBlob = null;
    this.posterMediaId = null;
  }

  async addVideo(file: File): Promise<void> {
    this.error = null;
    if (file.size > MAX_VIDEO_BYTES) {
      this.error = `视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`;
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        this.error = `视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟`;
        return;
      }
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke（spec §5）
      this.resetPoster();
      this.video = { file, durationSeconds: meta.durationSeconds, previewUrl: URL.createObjectURL(file) };
    } catch {
      this.error = '无法读取视频';
    }
  }

  /** file input onChange 的分流（图/视频互斥确认），input 本身在组件 */
  onPickImages(files: File[]): void {
    if (this.video) {
      this.pendingFiles = files;
      this.replaceConfirm = 'image';
      return;
    }
    this.addImages(files);
  }

  onPickVideo(file: File): void {
    if (this.images.length > 0) {
      this.pendingFiles = [file];
      this.replaceConfirm = 'video';
      return;
    }
    void this.addVideo(file);
  }

  cancelReplace(): void {
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  confirmReplace(): void {
    if (this.replaceConfirm === 'image') {
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke
      this.video = null;
      this.resetPoster();
      this.addImages(this.pendingFiles);
    }
    if (this.replaceConfirm === 'video' && this.pendingFiles[0]) {
      this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl)); // 显式 revoke
      this.images = [];
      void this.addVideo(this.pendingFiles[0]);
    }
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  removeImage(index: number): void {
    URL.revokeObjectURL(this.images[index]!.previewUrl); // 显式 revoke
    this.images = this.images.filter((_, i) => i !== index);
  }

  /** 关闭/取消/Escape：先 revoke 全部预览，再关会话（不依赖 destroy/GC，spec §5） */
  resetAndClose(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.resetPoster();
    this.resolve(ComposeSessionService).closeCompose();
  }

  private clearPreviews(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.images = [];
    this.video = null;
    this.resetPoster();
  }

  async submit(): Promise<void> {
    this.error = null;
    const edit = this.edit;
    const chainId = this.chainId;
    if (!chainId) {
      this.error = '先选一条链';
      return;
    }
    const hasImages = this.images.length > 0;
    const hasVideo = Boolean(this.video);
    const structuredOnly = this.kind !== 'standard';
    if (!hasImages && !hasVideo && this.content.trim().length === 0 && !structuredOnly) {
      this.error = '先写一句此刻吧';
      return;
    }
    const timeEdited = Boolean(edit) && this.happenedAt !== toWallClockInput(edit!.happenedAt, edit!.happenedTzOffset);
    const happenedIso = edit
      ? timeEdited
        ? wallClockToIso(this.happenedAt, edit.happenedTzOffset)
        : edit.happenedAt
      : new Date(Date.parse(this.happenedAt)).toISOString();
    const happenedAtMs = Date.parse(happenedIso);
    if (Number.isNaN(happenedAtMs)) {
      this.error = '发生时间不合法';
      return;
    }
    const isBackfill = edit && !timeEdited ? edit.isBackfill : isPastHappenedAt(happenedAtMs);
    const composeSession = this.resolve(ComposeSessionService);
    try {
      if (edit) {
        await client.updateMoment(edit.id, {
          content: this.content,
          ...(timeEdited ? { happenedAt: happenedIso, happenedTzOffset: edit.happenedTzOffset } : {}),
          isBackfill,
          tagIds: this.selectedTags,
          kind: edit.kind,
          payload: Object.keys(this.payloadDraft).length > 0 ? this.payloadDraft : null,
        });
        composeSession.emit('moment:changed', { momentId: edit.id, chainId: edit.chainId, op: 'update' }, 'global');
      } else {
        const type = hasVideo ? 'video' : hasImages ? 'media' : 'text';
        const mediaIds: string[] = [];
        if (hasImages) {
          for (let i = 0; i < this.images.length; i++) {
            this.progress = `上传图片 ${i + 1}/${this.images.length}`;
            const file = await compressImage(this.images[i]!.file);
            const res = await client.uploadMedia({
              file,
              mime: file.type,
              size: file.size,
              kind: 'image',
              sortOrder: i,
              onProgress: (l, t) => (this.progress = `上传图片 ${i + 1}/${this.images.length} ${Math.round((l / t) * 100)}%`),
            });
            mediaIds.push(res.mediaId);
          }
        }
        if (this.video) {
          this.progress = '上传视频…';
          const res = await client.uploadMedia({
            file: this.video.file,
            mime: this.video.file.type,
            size: this.video.file.size,
            kind: 'video',
            durationSeconds: this.video.durationSeconds,
            onProgress: (l, t) => (this.progress = `上传视频 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
        if (this.video && this.posterBlob && !this.posterMediaId) {
          try {
            this.progress = '上传封面…';
            const res = await client.uploadMedia({
              file: this.posterBlob,
              mime: 'image/jpeg',
              size: this.posterBlob.size,
              kind: 'image',
            });
            this.posterMediaId = res.mediaId;
          } catch {
            this.posterMediaId = null; // 封面上传失败降级为无封面发布（spec §3）
          }
        }
        this.progress = '记下…';
        const hasPayload = Object.keys(this.payloadDraft).length > 0;
        // kind moment 正文兜底（Global Constraints）：正文空时用结构摘要，满足 text 类型 content 必填。
        // 兜底填入的摘要与 Task 5 卡片摘要行逐字相同——卡片侧按 content===summary 判重跳过（评审 H1），不重复显示
        const summary = this.kind !== 'standard' ? summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft) : '';
        if (this.kind !== 'standard' && this.content.trim().length === 0 && !summary && !hasImages && !hasVideo) {
          // 摘要也为空时不发空 content 给 server 被 400（CONTENT_REQUIRED），前置人话提示（评审 S8）
          this.error = '选一项或写一句，再记下';
          this.progress = null;
          return;
        }
        const content = this.content.trim().length === 0 && this.kind !== 'standard' ? summary : this.content;
        const res = await client.createMoment(chainId, {
          type,
          content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill,
          mediaIds,
          tagIds: this.selectedTags,
          kind: this.kind,
          ...(hasPayload ? { payload: this.payloadDraft } : {}),
          ...(this.posterMediaId ? { posterMediaId: this.posterMediaId } : {}),
        });
        composeSession.markCreated(res.id); // 「从链节长出来」微动效（spec §1.6）
        composeSession.emit('moment:changed', { momentId: res.id, chainId, op: 'create' }, 'global');
      }
      this.clearPreviews(); // 显式 revoke（spec §5）
      composeSession.closeCompose();
    } catch (e) {
      this.error = humanError(e);
    } finally {
      this.progress = null;
    }
  }
}
