/** 全部 query key 工厂：mutation 后的精确 invalidate 一律引用这里，禁止手写数组字面量。 */
export const qk = {
  chains: ['chains'] as const,
  chain: (chainId: string) => ['chains', chainId] as const,
  chainMembers: (chainId: string) => ['chains', chainId, 'members'] as const,
  chainInvites: (chainId: string) => ['chains', chainId, 'invites'] as const,
  chainMoments: (chainId: string) => ['chains', chainId, 'moments'] as const,
  tags: (chainId: string) => ['chains', chainId, 'tags'] as const,
  feed: (f: { chainIds?: string[]; tagId?: string; order: 'happened_at' | 'created_at'; before?: string }) =>
    ['feed', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.order, f.before ?? ''] as const,
  /** month-index：tz_offset 参与 key（spec §8）；'feed' 前缀保证发布后的 ['feed'] 前缀 invalidate 一并刷新索引 */
  monthIndex: (f: { chainIds?: string[]; tagId?: string; tzOffset: number }) =>
    ['feed', 'month-index', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.tzOffset] as const,
  moment: (momentId: string) => ['moments', momentId] as const,
  comments: (momentId: string) => ['moments', momentId, 'comments'] as const,
  notifications: (unread: boolean) => ['notifications', unread] as const,
  shareLinks: (chainId: string) => ['chains', chainId, 'share-links'] as const,
  publicShare: (token: string) => ['public-share', token] as const,
};
