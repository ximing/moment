import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';
import type { MomentResponse, TagResponse } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { humanError } from '@/lib/errors';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';
import { canCompose } from '@/lib/roles';
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
  replaceConfirm: 'image' | 'video' | null = null;
  pendingFiles: File[] = [];
  happenedAt = nowLocalInput();
  selectedTags: string[] = [];
  newTag = '';
  progress: string | null = null;
  error: string | null = null; // 本地校验 + humanError(API) 都落这里（面板内，spec §8）
  tagList: TagResponse[] = [];

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
  }

  async loadTagList(): Promise<void> {
    if (!this.chainId) {
      this.tagList = [];
      return;
    }
    this.tagList = (await client.listTags(this.chainId)).tags;
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
    this.resolve(ComposeSessionService).closeCompose();
  }

  private clearPreviews(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.images = [];
    this.video = null;
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
    if (!hasImages && !hasVideo && this.content.trim().length === 0) {
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
        this.progress = '记下…';
        const res = await client.createMoment(chainId, {
          type,
          content: this.content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill,
          mediaIds,
          tagIds: this.selectedTags,
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
