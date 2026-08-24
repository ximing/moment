import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import type { MediaCompleteResponse, MediaPresignResponse } from '@moment/dto';
import type { Http } from './http.js';
import { ApiError, type FilePart, type MomentClientOptions, type PutFn } from './types.js';
import { xhrPut } from './default-put.js';

export interface UploadMediaInput {
  /** 整文件内存形态（web / 已压缩图片）。与 fileUri 二选一（Phase 7 RN 视频走 fileUri，按片读盘防 OOM）。 */
  file?: Blob;
  /** 文件 uri 形态（RN）：提供时 put 收到 FilePart（fileUri + start/end 区间），不构造整文件 Blob。 */
  fileUri?: string;
  mime: string;
  size: number;
  kind: 'image' | 'video' | 'audio';
  /** 视频时长（秒，≤300），透传给 presign（Phase 3 契约） */
  durationSeconds?: number;
  sortOrder?: number;
  /** 已传字节 / 总字节。multipart 下 = 已完成 part 字节 + 当前 part 内进度 */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/** 每片重试上限（同一预签名 URL；PRESIGN_PUT_TTL=900s 内 3 次足够） */
const MAX_PART_ATTEMPTS = 3;
/** 每批向 /media/:id/parts 申请的 part URL 数（上限 200，取 10 平衡预签名开销与串行窗口） */
const PART_BATCH = 10;

export async function uploadMediaImpl(
  http: Http,
  options: MomentClientOptions,
  input: UploadMediaInput
): Promise<MediaCompleteResponse> {
  const limit =
    input.kind === 'image' ? MAX_IMAGE_BYTES : input.kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (input.size > limit) {
    throw new ApiError(
      `文件超过上限（${Math.floor(limit / 1024 / 1024)}MB）`,
      413,
      'MEDIA_TOO_LARGE'
    );
  }
  if (!input.file && !input.fileUri) {
    throw new ApiError('file 与 fileUri 必须提供其一', 0, 'UPLOAD_INPUT_INVALID');
  }
  const put: PutFn = options.putWithProgress ?? xhrPut;

  const presigned = await http.request<MediaPresignResponse>('/api/media/presign', {
    method: 'POST',
    body: {
      mime: input.mime,
      size: input.size,
      kind: input.kind,
      sortOrder: input.sortOrder,
      durationSeconds: input.durationSeconds,
    },
  });

  if (presigned.method === 'put') {
    const whole: Blob | FilePart = input.file
      ? input.file
      : { fileUri: input.fileUri!, start: 0, end: input.size, size: input.size, mime: input.mime };
    await put(presigned.url!, whole, input.mime, input.onProgress, input.signal);
    return http.request<MediaCompleteResponse>(`/api/media/${presigned.mediaId}/complete`, {
      method: 'POST',
      body: { parts: [] },
    });
  }

  // multipart：分批取 URL，片间串行，每片重试 ≤3 次
  const partSize = presigned.partSize ?? VIDEO_PART_SIZE;
  const totalParts = Math.ceil(input.size / partSize);
  const parts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  for (let batchStart = 1; batchStart <= totalParts; batchStart += PART_BATCH) {
    const numbers: number[] = [];
    for (let n = batchStart; n < batchStart + PART_BATCH && n <= totalParts; n++) numbers.push(n);
    const res = await http.request<{ urls: { partNumber: number; url: string }[] }>(`/api/media/${presigned.mediaId}/parts`, {
      method: 'POST',
      body: { partNumbers: numbers },
    });
    for (const { partNumber, url } of res.urls) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(partNumber * partSize, input.size);
      // file 形态在内存切片；fileUri 形态传区间描述（FilePart），由注入的 put 按片读盘——
      // RN 500MB 视频不整文件进内存（Phase 7 评审引入的契约扩展）。
      const blob: Blob | FilePart = input.file
        ? input.file.slice(start, end, input.mime)
        : { fileUri: input.fileUri!, start, end, size: end - start, mime: input.mime };
      let etag: string | null = null;
      let lastError: unknown;
      // 单调化：分片重试时该 part 的进度重新从 0 计，只上报历史最大值——保证 onProgress.loaded 单调不减（Produces 契约）
      let maxPartLoaded = 0;
      for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && etag === null; attempt++) {
        if (input.signal?.aborted) throw new ApiError('已取消', 0, 'ABORTED');
        try {
          const r = await put(
            url,
            blob,
            input.mime,
            (loaded) => {
              if (loaded > maxPartLoaded) maxPartLoaded = loaded;
              input.onProgress?.(uploadedBytes + maxPartLoaded, input.size);
            },
            input.signal
          );
          etag = r.etag;
          if (etag === null) {
            // PUT 成功但响应头无 ETag：多为桶 CORS 未配置 ExposeHeaders: ETag（见 Global Constraints 媒体条目），
            // 重试同样拿不到——不作为可重试失败，立即抛专用错误码。
            throw new ApiError('直传响应缺少 ETag（多为桶 CORS 未配置 ExposeHeaders: ETag）', 0, 'ETAG_MISSING');
          }
        } catch (err) {
          // ETAG_MISSING 不可重试（桶 CORS 不会因重试出现 ETag）
          if (err instanceof ApiError && err.code === 'ETAG_MISSING') throw err;
          lastError = err;
        }
      }
      if (etag === null) {
        throw lastError instanceof ApiError
          ? lastError
          : new ApiError('分片上传失败', 0, 'UPLOAD_FAILED');
      }
      parts.push({ partNumber, etag });
      // 进度按切片区间计算而非 blob.size：file.slice 对越界区间返回空 Blob（size=0），
      // 生产端 file.size === input.size 时两者等价，但按区间算才是正确不变量。
      uploadedBytes += end - start;
      input.onProgress?.(uploadedBytes, input.size);
    }
  }

  return http.request<MediaCompleteResponse>(`/api/media/${presigned.mediaId}/complete`, {
    method: 'POST',
    body: { parts },
  });
}
