import { z } from 'zod';
import type { MomentResponse } from './moments.js';

const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const feedQuerySchema = z.object({
  /** opaque 游标（base64url(JSON)），首页不传 */
  cursor: z.string().min(1).max(1024).optional(),
  /** 逗号分隔的链 id，仅用于在「我的链」范围内收窄（参数名遵循 spec §4 snake_case） */
  chain_ids: z
    .string()
    .refine((v) => typeof v === 'string' && v.split(',').every((id) => uuidLoose.test(id)), {
      message: 'chain_ids 必须是逗号分隔的 uuid',
    })
    .optional(),
  tag_id: z.string().regex(uuidLoose).optional(),
  /** happened_at=事件时间（默认）；created_at=添加时间（补发可见，spec §5.6） */
  order: z.enum(['happened_at', 'created_at']).default('happened_at'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQueryInput = z.infer<typeof feedQuerySchema>;

export interface FeedResponse {
  moments: MomentResponse[];
  /** 还有下一页时为 opaque 游标，否则 null */
  nextCursor: string | null;
}
