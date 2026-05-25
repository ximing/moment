import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { MomentCard } from '@/components/MomentCard';
import { MembersPanel } from '@/components/chain/MembersPanel';
import { InvitesPanel } from '@/components/chain/InvitesPanel';
import { TagsPanel } from '@/components/chain/TagsPanel';

const TABS = [
  { key: 'timeline', label: '时间线' },
  { key: 'members', label: '成员' },
  { key: 'invites', label: '邀请' },
  { key: 'tags', label: '标签' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ChainDetailPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const [tab, setTab] = useState<Tab>('timeline');

  const { data: chain, isPending, isError, error } = useQuery({
    queryKey: qk.chain(chainId ?? ''),
    queryFn: () => client.getChain(chainId!),
    enabled: chainId !== undefined,
  });

  const timeline = useInfiniteQuery({
    queryKey: qk.chainMoments(chainId ?? ''),
    queryFn: ({ pageParam }) =>
      client.listChainMoments(chainId!, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: chainId !== undefined && tab === 'timeline',
  });
  const moments = timeline.data?.pages.flatMap((p) => p.moments) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && timeline.hasNextPage && !timeline.isFetchingNextPage) {
        void timeline.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [timeline.hasNextPage, timeline.isFetchingNextPage, timeline.fetchNextPage, tab]);

  if (isPending) return <p className="py-10 text-center text-gray-400">加载中…</p>;
  if (isError || !chain) {
    return (
      <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        加载失败：{error instanceof Error ? error.message : '链不存在或无权访问'}
      </p>
    );
  }
  const canCompose = chain.myRole === 'owner' || chain.myRole === 'editor';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{chain.name}</h1>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{chain.myRole}</span>
          {canCompose && (
            <Link
              to={`/chains/${chain.id}/compose`}
              className="ml-auto flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              <Camera size={14} />
              发布时刻
            </Link>
          )}
        </div>
        {chain.description && <p className="mt-1 text-sm text-gray-500">{chain.description}</p>}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-gray-900 font-medium' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <div className="space-y-3">
          {moments.length === 0 && !timeline.isPending && (
            <p className="py-10 text-center text-gray-400">这条链还没有时刻。</p>
          )}
          {moments.map((m) => (
            <MomentCard key={m.id} moment={m} chainName={chain.name} />
          ))}
          <div ref={sentinelRef} className="h-8" />
          {timeline.isFetchingNextPage && <p className="text-center text-sm text-gray-400">加载更多…</p>}
        </div>
      )}
      {tab === 'members' && <MembersPanel chain={chain} />}
      {tab === 'invites' && <InvitesPanel chain={chain} />}
      {tab === 'tags' && <TagsPanel chain={chain} />}
    </div>
  );
}
