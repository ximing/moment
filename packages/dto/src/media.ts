import { z } from 'zod';

/** spec §5.5：图 ≤10MB；视频 ≤500MB。所有端共享的唯一常量来源。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** 视频 multipart 单 part 大小（spec §5.5：5–20MB，取 8MB）。 */
export const VIDEO_PART_SIZE = 8 * 1024 * 1024;
/** 视频时长上限（秒，spec §5.5「≤5 分钟」）。服务端只校验客户端上报的 durationSeconds。 */
export const MAX_VIDEO_DURATION_SECONDS = 300;

/**
 * mime 白名单（而非 `kind + '/*'` 前缀检查）：SVG 可内嵌 `<script>`，
 * 放行即构成存储型 XSS（预签名 GET 以原始 Content-Type 下发）——与 Task 2 `getContentType`
 * 的 octet-stream 兜底构成双防线。服务端/客户端共用，不得各自复制清单。
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export const mediaPresignInputSchema = z
  .object({
    mime: z.string().min(3).max(100),
    size: z.number().int().positive(),
    kind: z.enum(['image', 'video']),
    sortOrder: z.number().int().min(0).max(8).optional(),
    /** 客户端上报的视频时长（秒）；≤300。服务端不探测实际时长（偏离取舍见 Global Constraints）。 */
    durationSeconds: z.number().int().min(1).max(MAX_VIDEO_DURATION_SECONDS).optional(),
  })
  .superRefine((val, ctx) => {
    const allowed = val.kind === 'image' ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
    if (!(allowed as readonly string[]).includes(val.mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MIME_KIND_MISMATCH',
        path: ['mime'],
      });
    }
    if (val.kind === 'image' && val.durationSeconds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MEDIA_INVALID',
        path: ['durationSeconds'],
      });
    }
  });
export type MediaPresignInput = z.infer<typeof mediaPresignInputSchema>;

export interface MediaPresignResponse {
  mediaId: string;
  method: 'put' | 'multipart';
  /** method=put 时的预签名 PUT URL；multipart 时为 null（part URL 由 /media/:id/parts 获取） */
  url: string | null;
  /** method=multipart 时的 S3 uploadId；否则 null */
  uploadId: string | null;
  /** method=multipart 时每个 part 的字节数；否则 null */
  partSize: number | null;
}

export const mediaPartsInputSchema = z.object({
  partNumbers: z
    .array(z.number().int().min(1).max(10000))
    .min(1)
    .max(200),
});
export type MediaPartsInput = z.infer<typeof mediaPartsInputSchema>;

export interface MediaPartUrl {
  partNumber: number;
  url: string;
  /** 预签名有效期（秒） */
  expiresIn: number;
}

export interface MediaPartsResponse {
  mediaId: string;
  partSize: number;
  urls: MediaPartUrl[];
}

export const mediaCompleteInputSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(255),
      })
    )
    .max(10000)
    .default([]),
});
export type MediaCompleteInput = z.infer<typeof mediaCompleteInputSchema>;

export interface MediaCompleteResponse {
  mediaId: string;
  status: 'ready';
  mime: string;
  size: number;
}
