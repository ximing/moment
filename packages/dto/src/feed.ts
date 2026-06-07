import { z } from 'zod';
import type { MomentResponse } from './moments.js';

const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime 字符串：先正则限定 ISO 形态（防 `2026/08/01` 这类 Date.parse 宽松解析漏网），再校验可解析 */
const isoDatetime = z
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
  })
  .superRefine((val, ctx) => {
    if (val.before !== undefined && val.order === 'created_at') {
      // before 仅 happened_at 语义；created_at 下 happened_at 非单调，锚定无意义（spec §4.2）
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BEFORE_REQUIRES_HAPPENED_AT', path: ['before'] });
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
