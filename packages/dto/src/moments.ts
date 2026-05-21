import { z } from 'zod';
import type { TagBrief } from './tags.js';

export const momentTypeSchema = z.enum(['text', 'media', 'video']);
export type MomentType = z.infer<typeof momentTypeSchema>;

const uuidSchema = z.string().uuid();
export const momentTagIdsSchema = z.array(uuidSchema).max(20);

const isoTimestampSchema = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'INVALID_TIMESTAMP' });

export const createMomentInputSchema = z
  .object({
    type: momentTypeSchema,
    content: z.string().max(5000).default(''),
    happenedAt: isoTimestampSchema,
    /** 提交时时区偏移（分钟，东八区为 -480，语义同 JS getTimezoneOffset），供展示（spec §5.6） */
    happenedTzOffset: z.number().int().min(-840).max(840),
    isBackfill: z.boolean().default(false),
    mediaIds: z.array(z.string().min(1)).default([]),
    tagIds: momentTagIdsSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'text') {
      if (val.content.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CONTENT_REQUIRED', path: ['content'] });
      }
      if (val.mediaIds.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_NOT_ALLOWED', path: ['mediaIds'] });
      }
    }
    if (val.type === 'video' && val.mediaIds.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    if (val.type === 'media' && (val.mediaIds.length < 1 || val.mediaIds.length > 9)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    // 重复 id 会导致发布事务对同一 tmp 对象 copy 两次（第二次 NoSuchKey → 500），必须拒绝
    if (val.type !== 'text' && new Set(val.mediaIds).size !== val.mediaIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
  });
export type CreateMomentInput = z.infer<typeof createMomentInputSchema>;

export const patchMomentInputSchema = z
  .object({
    content: z.string().max(5000).optional(),
    happenedAt: isoTimestampSchema.optional(),
    happenedTzOffset: z.number().int().min(-840).max(840).optional(),
    isBackfill: z.boolean().optional(),
    tagIds: momentTagIdsSchema.optional(),
  })
  .strict() // 未知键（含 mediaIds/type）直接 VALIDATION_ERROR，而非静默剥离
  .refine((val) => Object.values(val).some((v) => v !== undefined), { message: 'EMPTY_PATCH' });
export type PatchMomentInput = z.infer<typeof patchMomentInputSchema>;
export const updateMomentInputSchema = patchMomentInputSchema;
export type UpdateMomentInput = PatchMomentInput;

/** moment 响应中的媒体：只出稳定入口相对路径，不内嵌预签名 URL（CONVENTIONS §3.4） */
export interface MomentMedia {
  id: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
}

export interface AuthorSummary {
  id: string;
  nickname: string;
}

export interface MomentResponse {
  id: string;
  chainId: string;
  author: AuthorSummary;
  type: MomentType;
  content: string;
  happenedAt: string;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: string;
  media: MomentMedia[];
  /** moment 上的标签（同一 moment 内按 tagId 升序——确定性排序，非插入顺序） */
  tags: TagBrief[];
}

export interface MomentListResponse {
  items: MomentResponse[];
  nextCursor: string | null;
}
