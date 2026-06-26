import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, type MediaCompleteResponse, type MomentResponse, type MomentType, type PatchMomentInput } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../lib/api';
import { compressImage, pickImages, pickVideo, validateVideo, type PickedVideo, type ReadyImage } from '../../lib/media';
import { ChainListService } from '../../services/chain-list.service';

/** 总尝试次数 = 初始 1 次 + ≤2 次重试；网络类（status 0）/5xx 才重试。
 *  服务端 complete 幂等，重试会重新 presign 拿新 mediaId，旧 mediaId 残留由 sweeper 清理。 */
const UPLOAD_ATTEMPTS = 3;

async function uploadWithRetry(
  input: Parameters<typeof client.uploadMedia>[0]
): Promise<MediaCompleteResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await client.uploadMedia(input);
    } catch (err) {
      lastError = err;
      // 413 本地预校验、401（refresh 已失败并 clear 后的残余请求）、403 等重试无意义
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) throw err;
    }
  }
  throw lastError;
}

/** 发布页（spec §6）：草稿进 Service，提交是显式动作，无 effect 链式 setState。 */
export class ComposeService extends Service {
  chainId: string | undefined = undefined;
  type: MomentType = 'text';
  content = '';
  images: ReadyImage[] = [];
  video: PickedVideo | null = null;
  happenedAt = new Date();
  isBackfill = false;
  tagIds: string[] = [];
  progressLabel: string | null = null;
  showPicker = false; // 日期时间选择器展开态（iOS spinner 需要显式收起）

  tagNames: { id: string; name: string }[] = [];

  /** 编辑态：被编辑的 moment（spec §2）。非 null 时类型/链/媒体锁定，提交走 PATCH。 */
  edit: MomentResponse | null = null;
  /** 记录时区墙钟毫秒 = Date.parse(edit.happenedAt) − happenedTzOffset·60_000。
   *  只作数值参与换算，绝不当设备本地时间用（spec §2 review C1）。 */
  private editWallMs = 0;
  /** 设备时区偏移（getTimezoneOffset 分钟），loadForEdit 采样一次、提交复用同一值（防 DST 期间偏移漂移）。 */
  private editDeviceOffset = 0;

  get isEdit(): boolean {
    return this.edit !== null;
  }

  /** 路由 param 进来（?chainId= / ?momentId=）；compose 是 modal 路由，bindServices 实例随页面生灭，不挡幂等。 */
  hydrate(chainId: string | undefined, momentId?: string): void {
    if (momentId) {
      // 编辑分支：加载/失败态单通道走 $model.loadForEdit
      void this.loadForEdit(momentId).catch(() => undefined);
      return;
    }
    this.chainId = chainId;
    void this.loadTags().catch(() => undefined);
  }

  /** 编辑预填：content/tagIds/type/isBackfill + 发生时间两次平移（spec §2）。
   *  链固定为 edit.chainId（见 activeChainId），不回退可编辑链，防标签载错链 → TAG_NOT_IN_CHAIN。 */
  async loadForEdit(momentId: string): Promise<void> {
    const m = await client.getMoment(momentId);
    this.edit = m;
    this.chainId = m.chainId;
    this.type = m.type;
    this.content = m.content;
    this.tagIds = m.tags.map((t) => t.id);
    this.isBackfill = m.isBackfill;
    // 时区换算（spec 公式，禁止走 Date 本地字段捷径）：
    // wallMs 是记录时区的墙钟毫秒；picker 按设备本地字段渲染 Date，
    // 所以显示值 = wallMs + deviceOffset，使该 Date 的设备本地字段恰好等于记录时区墙钟。
    this.editDeviceOffset = new Date().getTimezoneOffset();
    this.editWallMs = Date.parse(m.happenedAt) - m.happenedTzOffset * 60_000;
    this.happenedAt = new Date(this.editWallMs + this.editDeviceOffset * 60_000);
    await this.loadTags();
  }

  /** 实时读全局链列表（与 FeedService.chainList 同款 getter），无一次性快照的过期窗口。 */
  get editableChains(): { id: string; name: string }[] {
    return this.resolve(ChainListService).chains
      .filter((c) => c.myRole !== 'viewer')
      .map((c) => ({ id: c.id, name: c.name }));
  }

  /** 编辑态链恒为 edit.chainId（spec §2：不回退可编辑链，防 TAG_NOT_IN_CHAIN）；
   *  新建态：路由参数的链若是 viewer 链（不在 editable 集合），回退到第一条可编辑链。 */
  get activeChainId(): string | undefined {
    if (this.edit) return this.edit.chainId;
    if (this.chainId && this.editableChains.some((c) => c.id === this.chainId)) return this.chainId;
    return this.editableChains[0]?.id;
  }

  setChain(id: string): void {
    this.chainId = id;
    this.tagIds = [];
    void this.loadTags().catch(() => undefined);
  }

  /** 只拉当前活跃链的标签（链集合本身由 ChainListService 实时持有）。 */
  private async loadTags(): Promise<void> {
    const active = this.activeChainId;
    if (active) {
      const tags = await client.listTags(active);
      this.tagNames = tags.tags.map((t) => ({ id: t.id, name: t.name }));
    }
  }

  /** 选图 + 压缩；返回 rejected 数（仅统计压缩后仍超 MAX_IMAGE_BYTES 被跳过的，名额截断不算）。
   *  满 9 张抛 Error（中文 message，组件 Alert）；压缩中途抛错也复位进度。 */
  async pickMoreImages(): Promise<number> {
    const picked = await pickImages();
    if (picked.length === 0) return 0;
    const remain = 9 - this.images.length;
    if (remain <= 0) throw new Error('图片最多 9 张');
    let rejected = 0;
    const ready: ReadyImage[] = [];
    try {
      this.progressLabel = '压缩中…';
      for (const img of picked.slice(0, remain)) {
        const r = await compressImage(img);
        if (r.size > MAX_IMAGE_BYTES) {
          rejected += 1; // 压缩后仍超限的个别图片（极端长图）跳过；常量唯一来源 @moment/dto
          continue;
        }
        ready.push(r);
      }
    } finally {
      this.progressLabel = null;
    }
    this.images = [...this.images, ...ready].slice(0, 9);
    return rejected;
  }

  /** 选视频 + 校验；返回问题文案（null = 成功）。 */
  async chooseVideo(): Promise<string | null> {
    const picked = await pickVideo();
    if (!picked) return null;
    const problem = validateVideo(picked);
    if (problem) return problem;
    this.video = picked;
    return null;
  }

  toggleTag(id: string): void {
    this.tagIds = this.tagIds.includes(id) ? this.tagIds.filter((t) => t !== id) : [...this.tagIds, id];
  }

  /** 发生时间是否被改过（spec §2 判断式：还原成墙钟毫秒再比，不能直接比 getTime()）。 */
  private get timeEdited(): boolean {
    if (!this.edit) return false;
    return this.happenedAt.getTime() - this.editDeviceOffset * 60_000 !== this.editWallMs;
  }

  /** picker 变更入口：编辑态按「记录时区还原的真实毫秒」重算补发标记（对齐 web：abs > 5min，未来也算补发）；
   *  新建态沿用原有本地毫秒口径。 */
  onHappenedAtChange(d: Date): void {
    this.happenedAt = d;
    if (this.edit) {
      const newMs = d.getTime() - this.editDeviceOffset * 60_000 + this.edit.happenedTzOffset * 60_000;
      this.isBackfill = Math.abs(newMs - Date.now()) > 5 * 60_000;
    } else {
      this.isBackfill = d.getTime() < Date.now() - 10 * 60_000;
    }
  }

  /** 提交：编辑态走 PATCH（submitEdit）；新建态串行上传（进度聚合）→ createMoment → emit。
   *  前置校验失败抛 Error（中文 message）。 */
  async submit(): Promise<void> {
    if (this.edit) return this.submitEdit();
    const activeChainId = this.activeChainId;
    if (!activeChainId) throw new Error('请选择要发布到的链（需要编辑权限）');
    // 角色前置校验：viewer 链（含深链/旧参数）挡在媒体上传之前，避免全量上传后才被服务端 403
    if (!this.editableChains.some((c) => c.id === activeChainId)) throw new Error('请选择要发布到的链（需要编辑权限）');
    if (this.type === 'text' && this.content.trim().length === 0) throw new Error('文字类型需要内容');
    if (this.content.length > 5000) throw new Error('正文最多 5000 字');
    if (this.type === 'media' && this.images.length === 0) throw new Error('图文类型至少选 1 张图（最多 9 张）');
    if (this.type === 'video' && !this.video) throw new Error('视频类型需要先选择视频');

    // 图片走 file: Blob（压缩后百 KB 级，已在内存）；视频走 fileUri 形态——rnPut 按 part
    // 从文件 uri 读盘 PUT，500MB 视频整文件不进内存（见 src/lib/rn-put.ts）。
    const mediaIds: string[] = [];
    type UploadFile =
      | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number };
    let files: UploadFile[] = [];
    if (this.type === 'media') {
      files = this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
    } else if (this.type === 'video' && this.video) {
      files = [{ fileUri: this.video.uri, mime: this.video.mime, size: this.video.size, kind: 'video' as const, durationSeconds: this.video.durationSeconds, sortOrder: 0 }];
    }
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    let doneBytes = 0;
    try {
      for (const f of files) {
        const res = await uploadWithRetry({
          ...f,
          onProgress: (loaded) => {
            const overall = totalBytes > 0 ? Math.floor(((doneBytes + loaded) / totalBytes) * 100) : 100;
            this.progressLabel = `上传中 ${overall}%`;
          },
        });
        mediaIds.push(res.mediaId);
        doneBytes += f.size;
      }

      this.progressLabel = '发布中…';
      const created = await client.createMoment(activeChainId, {
        type: this.type,
        content: this.content,
        happenedAt: this.happenedAt.toISOString(),
        // 与 dto 契约同语义：原值（同 JS getTimezoneOffset，东八区 = -480），不取反
        happenedTzOffset: this.happenedAt.getTimezoneOffset(),
        isBackfill: this.isBackfill,
        mediaIds,
        tagIds: this.tagIds,
      });
      this.emit('moment:changed', { momentId: created.id, chainId: activeChainId, op: 'create' }, 'global');
    } finally {
      this.progressLabel = null; // 失败路径也复位，避免「上传中 N%」「发布中…」永久停留
    }
  }

  /** 编辑提交（spec §2）：patch 基础 { content, tagIds }；时间被改过才传 happenedAt
   *  （按记录时区还原 ISO）并重算 isBackfill；媒体/类型/链不可改，不进 patch。 */
  private async submitEdit(): Promise<void> {
    const edit = this.edit;
    if (!edit) return;
    if (edit.type === 'text' && this.content.trim().length === 0) throw new Error('文字类型需要内容');
    if (this.content.length > 5000) throw new Error('正文最多 5000 字');

    const patch: PatchMomentInput = { content: this.content, tagIds: this.tagIds };
    if (this.timeEdited) {
      // 还原：newWallMs = picker − deviceOffset；iso = newWallMs + 记录时区偏移（spec 公式）
      const newWallMs = this.happenedAt.getTime() - this.editDeviceOffset * 60_000;
      const newMs = newWallMs + edit.happenedTzOffset * 60_000;
      patch.happenedAt = new Date(newMs).toISOString();
      // 对齐 web compose-panel：未来时间也算补发（review I4）
      patch.isBackfill = Math.abs(newMs - Date.now()) > 5 * 60_000;
    }

    try {
      this.progressLabel = '保存中…';
      await client.updateMoment(edit.id, patch);
      this.emit('moment:changed', { momentId: edit.id, chainId: edit.chainId, op: 'update' }, 'global');
    } finally {
      this.progressLabel = null;
    }
  }
}
