import { z } from 'zod';
import { isoDatetime } from './feed.js';
import type { MomentResponse } from './moments.js';

/** POST /api/search 的 q 上限（spec §3.1）；超长 400 VALIDATION_ERROR。路由/handler 属 P6。 */
export const INTENT_MAX_QUERY_CHARS = 500;
/** spec §5：limit 缺省 20（zod 不补默认，P6 handler 用本常量） */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export type SearchTime =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'wall_date'; year: number; month: number; day: number };

export interface SearchParsed {
  personNames: string[];
  place: string | null;
  time: SearchTime | null;
  text: string;
}

export interface SearchResponse {
  moments: MomentResponse[];
  nextCursor: string | null;
  parsed: SearchParsed;
}

/**
 * POST /api/search body（spec §6.2）。camelCase。
 * 无 before / order / source。tzOffset 必填。
 * personId/tagId/chainIds 用 z.string().uuid()（严于 GET chip 的 uuidLoose）。
 */
export const searchInputSchema = z
  .object({
    q: z.string().trim().min(1).max(INTENT_MAX_QUERY_CHARS),
    chainIds: z.array(z.string().uuid()).optional(),
    tzOffset: z.number().int().min(-840).max(840),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    personId: z.string().uuid().optional(),
    tagId: z.string().uuid().optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happenedFrom: isoDatetime.optional(),
    happenedTo: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.happenedFrom && val.happenedTo && Date.parse(val.happenedFrom) > Date.parse(val.happenedTo)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happenedTo'] });
    }
  });
export type SearchInput = z.infer<typeof searchInputSchema>;
