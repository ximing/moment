/** 全部 query key 工厂：mutation 后的精确 invalidate 一律引用这里，禁止手写数组字面量。 */
export const qk = {
  chains: ['chains'] as const,
  chain: (chainId: string) => ['chains', chainId] as const,
  chainMembers: (chainId: string) => ['chains', chainId, 'members'] as const,
  chainInvites: (chainId: string) => ['chains', chainId, 'invites'] as const,
  chainMoments: (chainId: string) => ['chains', chainId, 'moments'] as const,
  tags: (chainId: string) => ['chains', chainId, 'tags'] as const,
  feed: (f: { chainIds?: string[]; tagId?: string; order: 'happened_at' | 'created_at' }) =>
    ['feed', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.order] as const,
  moment: (momentId: string) => ['moments', momentId] as const,
  comments: (momentId: string) => ['moments', momentId, 'comments'] as const,
  notifications: (unread: boolean) => ['notifications', unread] as const,
};
