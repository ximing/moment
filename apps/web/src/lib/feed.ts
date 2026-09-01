import type { RailFilter } from '@/timeline/timeline-rail';

export type FeedQueryInput = Parameters<typeof import('@/api/client').client.getFeed>[0];

/** 换月份 / 清 before 后把视口拉回页顶，否则列表已换、滚动还停在旧位置，看起来像没跳准。 */
export function scrollToPageTop(): void {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  // jsdom 的 window.scrollTo 是 not-implemented stub，调用会打错误日志
  if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo(0, 0);
}

/** 拼 getFeed 参数（spec §4.1 纯函数；分页 gen 守卫由各 Service 持有）。 */
export function feedQuery(filter: RailFilter, cursor?: string, limit = 50): FeedQueryInput {
  return {
    chainIds: filter.chainIds,
    tagId: filter.tagId,
    order: filter.order,
    before: filter.before,
    personId: filter.personId,
    place: filter.place,
    cursor,
    limit,
  };
}
