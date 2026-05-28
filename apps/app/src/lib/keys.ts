import type { FeedQuery } from '@moment/api-client';

/** query key 工厂：全部页面经 qk.* 取 key，invalidate 一处可追。 */
export const qk = {
  feed: (filters: Pick<FeedQuery, 'chainIds' | 'tagId' | 'order'>) => ['feed', filters] as const,
  /** feed 前缀 key（发布/互动后失效全部过滤组合），禁止在页面里裸写 ['feed'] 字面量 */
  feedAll: () => ['feed'] as const,
  chains: () => ['chains'] as const,
  chain: (chainId: string) => ['chain', chainId] as const,
  chainMoments: (chainId: string) => ['chainMoments', chainId] as const,
  members: (chainId: string) => ['members', chainId] as const,
  invites: (chainId: string) => ['invites', chainId] as const,
  tags: (chainId: string) => ['tags', chainId] as const,
  moment: (momentId: string) => ['moment', momentId] as const,
  comments: (momentId: string) => ['comments', momentId] as const,
  notifications: () => ['notifications'] as const,
};
