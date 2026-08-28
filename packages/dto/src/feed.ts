import { z } from 'zod';
import type { MomentResponse } from './moments.js';

/** GET query 与 tag_id 同一宽松 uuid（spec §6.1：不要用更严的 z.string().uuid()） */
export const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime 字符串：先正则限定 ISO 形态（防 `2026/08/01` 这类 Date.parse 宽松解析漏网），再校验可解析 */
export const isoDatetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, 'INVALID_TIMESTAMP')
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'INVALID_TIMESTAMP' });

const chainIdsCsv = z
  .string()
  .refine((v) => typeof v === 'string' && v.split(',').every((id) => uuidLoose.test(id)), {
    message: 'chain_ids 必须是逗号分隔的 uuid',
  })
  .optional();

export const feedQuerySchema = z
  .object({
    /** opaque 游标（base64url(JSON)），首页不传 */
    cursor: z.string().min(1).max(1024).optional(),
    /** 逗号分隔的链 id，仅用于在「我的链」范围内收窄（参数名遵循 spec §4 snake_case） */
    chain_ids: chainIdsCsv,
    tag_id: z.string().regex(uuidLoose).optional(),
    /** happened_at=事件时间（默认）；created_at=添加时间（补发可见，spec §5.6） */
    order: z.enum(['happened_at', 'created_at']).default('happened_at'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** 日期锚定（spec §4.2）：happened_at < before，严格小于；与 cursor 同传取更严上界 */
    before: isoDatetime.optional(),
    /**
     * HTTP query snake_case（spec §6.1）。api-client FeedQuery（P8）camelCase 映射：
     * personId ← person_id；place ← place；happenedFrom ← happened_from；happenedTo ← happened_to。
     * 过滤进 queryMomentPage 属 P2；本 schema 只做校验。
     */
    person_id: z.string().regex(uuidLoose).optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happened_from: isoDatetime.optional(),
    happened_to: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.before !== undefined && val.order === 'created_at') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BEFORE_REQUIRES_HAPPENED_AT', path: ['before'] });
    }
    if ((val.happened_from !== undefined || val.happened_to !== undefined) && val.order === 'created_at') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RANGE_REQUIRES_HAPPENED_AT',
        path: ['happened_from'],
      });
    }
    if (
      val.happened_from !== undefined &&
      val.happened_to !== undefined &&
      Date.parse(val.happened_from) > Date.parse(val.happened_to)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happened_to'] });
    }
  });
export type FeedQueryInput = z.infer<typeof feedQuerySchema>;

export interface FeedResponse {
  moments: MomentResponse[];
  /** 还有下一页时为 opaque 游标，否则 null */
  nextCursor: string | null;
}

export const monthIndexQuerySchema = z.object({
  chain_ids: chainIdsCsv,
  tag_id: z.string().regex(uuidLoose).optional(),
  /**
   * 查看者时区偏移（必填，契约保留；分钟，语义同 JS getTimezoneOffset）。
   * 归桶改用每条 moment.happened_tz_offset，不再用本参数。
   */
  tz_offset: z.coerce.number().int().min(-840).max(840),
});
export type MonthIndexQueryInput = z.infer<typeof monthIndexQuerySchema>;

export interface MonthIndexEntry {
  /** '%Y-%m'，发生地墙钟归桶 */
  month: string;
  count: number;
}

export interface MonthIndexResponse {
  /** 按月倒序；空范围为空数组 */
  months: MonthIndexEntry[];
}
