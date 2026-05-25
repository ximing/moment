import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { MomentCard } from '@/components/MomentCard';

const ORDERS = [
  { value: 'happened_at', label: '事件时间' },
  { value: 'created_at', label: '添加时间' },
] as const;

export function FeedPage() {
  const [chainFilter, setChainFilter] = useState<string[]>([]);
  const [tagId, setTagId] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<'happened_at' | 'created_at'>('happened_at');

  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const chainNameById = useMemo(
    () => new Map((chains ?? []).map((c) => [c.id, c.name])),
    [chains]
  );

  const filter = useMemo(
    () => ({ chainIds: chainFilter.length > 0 ? chainFilter : undefined, tagId, order }),
    [chainFilter, tagId, order]
  );

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isPending,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: qk.feed(filter),
    queryFn: ({ pageParam }) =>
      client.getFeed({ ...filter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const moments = data?.pages.flatMap((p) => p.moments) ?? [];

  // tag 过滤只在选中恰好一条链时可用（tag 属于链，Phase 4 语义）
  const singleChainId = chainFilter.length === 1 ? chainFilter[0] : undefined;
  const { data: tagList } = useQuery({
    queryKey: qk.tags(singleChainId ?? ''),
    queryFn: () => client.listTags(singleChainId!),
    enabled: singleChainId !== undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleChain = (id: string) => {
    setTagId(undefined);
    setChainFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setChainFilter([]); setTagId(undefined); }}
          className={`rounded-full px-3 py-1 text-sm ${chainFilter.length === 0 ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}
        >
          全部
        </button>
        {(chains ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggleChain(c.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              chainFilter.includes(c.id)
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            {c.name}
          </button>
        ))}
        <div className="ml-auto flex rounded border border-gray-200 bg-white text-sm">
          {ORDERS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOrder(o.value)}
              className={`px-2 py-1 ${order === o.value ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {singleChainId !== undefined && (tagList?.tags.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTagId(undefined)}
            className={`rounded px-2 py-0.5 text-xs ${tagId === undefined ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            全部标签
          </button>
          {tagList!.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId(t.id)}
              className={`rounded px-2 py-0.5 text-xs ${
                tagId === t.id ? 'bg-gray-700 text-white' : 'border border-gray-200 bg-white text-gray-600'
              }`}
            >
              #{t.name}（{t.momentCount}）
            </button>
          ))}
        </div>
      )}

      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      {!isPending && !isError && moments.length === 0 && (
        <p className="py-10 text-center text-gray-400">还没有时刻。去链里发布第一条吧。</p>
      )}
      <div className="space-y-3">
        {moments.map((m) => (
          <MomentCard key={m.id} moment={m} chainName={chainNameById.get(m.chainId)} />
        ))}
      </div>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <p className="text-center text-sm text-gray-400">加载更多…</p>}
    </div>
  );
}
