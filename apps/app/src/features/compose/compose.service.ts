import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, type MediaCompleteResponse, type MomentType } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';
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

  private editable: { id: string; name: string }[] = [];
  tagNames: { id: string; name: string }[] = [];

  /** 路由 param 进来（?chainId=）；compose 是 modal 路由，bindServices 实例随页面生灭，不挡幂等。 */
  hydrate(chainId: string | undefined): void {
    this.chainId = chainId;
    void this.loadChains().catch(() => undefined);
  }

  get editableChains(): { id: string; name: string }[] {
    return this.editable;
  }

  get activeChainId(): string | undefined {
    return this.chainId ?? this.editable[0]?.id;
  }

  setChain(id: string): void {
    this.chainId = id;
    this.tagIds = [];
    void this.loadChains().catch(() => undefined);
  }

  private async loadChains(): Promise<void> {
    const chains = this.resolve(ChainListService).chains;
    this.editable = chains.filter((c) => c.myRole !== 'viewer').map((c) => ({ id: c.id, name: c.name }));
    const active = this.chainId ?? this.editable[0]?.id;
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

  /** 提交：串行上传（进度聚合）→ createMoment → emit。前置校验失败抛 Error（中文 message）。 */
  async submit(): Promise<void> {
    const activeChainId = this.activeChainId;
    if (!activeChainId) throw new Error('请选择要发布到的链（需要编辑权限）');
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
    // 过渡期 invalidate（feed 前缀覆盖全部过滤组合 + 链内列表 + 标签计数）；Task 11 删
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() });
    void queryClient.invalidateQueries({ queryKey: qk.chainMoments(activeChainId) });
    void queryClient.invalidateQueries({ queryKey: qk.tags(activeChainId) });
  }
}
