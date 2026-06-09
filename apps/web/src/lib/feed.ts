import type { RailFilter } from '@/timeline/timeline-rail';

export type FeedQueryInput = Parameters<typeof import('@/api/client').client.getFeed>[0];

/** 拼 getFeed 参数（spec §4.1 纯函数；分页 gen 守卫由各 Service 持有）。 */
export function feedQuery(filter: RailFilter, cursor?: string, limit = 50): FeedQueryInput {
  return {
    chainIds: filter.chainIds,
    tagId: filter.tagId,
    order: filter.order,
    before: filter.before,
    cursor,
    limit,
  };
}
