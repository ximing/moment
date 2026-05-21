import { z } from 'zod';

export const tagCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
export type TagCreateInput = z.infer<typeof tagCreateInputSchema>;

/** 挂在 moment 响应上的最小 tag 视图。 */
export interface TagBrief {
  id: string;
  name: string;
}

/** 链内 tag 列表项（momentCount 不含软删 moment）。 */
export interface TagResponse {
  id: string;
  name: string;
  momentCount: number;
  /** ISO 8601 */
  createdAt: string;
}

export interface TagListResponse {
  tags: TagResponse[];
}
