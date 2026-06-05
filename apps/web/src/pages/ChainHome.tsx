import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useCompose } from '@/compose/ComposeContext';
import { ComposerEntry } from '@/compose/ComposerEntry';
import { canCompose, roleLabel } from '@/lib/roles';
import { Timeline } from '@/timeline/Timeline';
import { TimelineRail, type RailFilter } from '@/timeline/TimelineRail';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Empty } from './FeedHome';

export function ChainHome() {
  const { chainId = '' } = useParams();
  const { openCompose } = useCompose();
  // 行内 tag chips / 排序小字按钮已迁入右栏 rail；tagId/order/before 合并为 RailFilter
  const [filter, setFilter] = useState<RailFilter>({ order: 'happened_at' });
  const { data: chain, isPending: chainPending, isError, error, refetch } = useQuery({
    queryKey: qk.chain(chainId),
    queryFn: () => client.getChain(chainId),
    enabled: Boolean(chainId),
  });
  // feed 固定本链 + rail 筛选；before 变化 = key 变化 = 重查第一页（spec §4.3）
  const feedFilter = { ...filter, chainIds: [chainId] };
  const q = useInfiniteQuery({
    queryKey: qk.feed(feedFilter),
    queryFn: ({ pageParam }) => client.getFeed({ ...feedFilter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(chainId),
  });
  const moments = q.data?.pages.flatMap((p) => p.moments) ?? [];

  if (chainPending) return <div className="h-32 animate-pulse rounded-paper bg-white/50" />;
  if (isError || !chain) {
    return (
      <Banner action={{ label: '重试', onClick: () => void refetch() }}>
        {error instanceof Error ? '看不到这条链，或它已经不在了' : '看不到这条链，或它已经不在了'}
      </Banner>
    );
  }

  // flex-wrap：rail 的 <1400px 触发按钮 order-first + w-full 落在主列顶部
  return (
    <div className="flex flex-wrap gap-x-8">
      <div className="min-w-0 flex-1">
        <header className="mb-6 flex items-start gap-3">
          <Avatar name={chain.name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="font-display text-2xl">{chain.name}</h1>
              <span className="text-sm text-muted">{roleLabel(chain.myRole)}</span>
            </div>
            {chain.description && <p className="mt-1 text-sm text-muted">{chain.description}</p>}
          </div>
          <Link to={`/chains/${chain.id}/settings`} className="text-sm text-muted hover:text-ink">
            设置
          </Link>
        </header>

        {/* 锚定态「回到最新」：时间线顶部固定一枚（spec §4.3），清 before 回第一页 */}
        {filter.before && (
          <div className="sticky top-2 z-10 mb-3">
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, before: undefined }))}
              className="rounded-sticker border-2 border-line bg-select px-3 py-1 text-sm text-ink shadow-sticker"
            >
              ← 回到最新
            </button>
          </div>
        )}

        <Timeline
          moments={moments}
          hideSignature={filter.order === 'created_at'}
          isPending={q.isPending}
          isError={q.isError}
          onRetry={() => void q.refetch()}
          hasNextPage={Boolean(q.hasNextPage)}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={q.fetchNextPage}
          entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
          empty={
            filter.tagId || filter.order === 'created_at' || filter.before ? (
              <Empty title="没有符合条件的时刻" action={<Button variant="ghost" onClick={() => setFilter({ order: 'happened_at' })}>清除筛选</Button>} />
            ) : (
              <Empty
                title="还没有记下任何一刻"
                action={canCompose(chain) ? <Button onClick={() => openCompose({ chainId: chain.id })}>记下此刻</Button> : undefined}
              />
            )
          }
        />
      </div>
      {/* 链页 rail：fixedChainId 隐藏链 chips，索引/标签范围固定本链；chains 传 [] 避免多余的 qk.chains 查询 */}
      <TimelineRail chains={[]} fixedChainId={chainId} value={filter} onChange={setFilter} />
    </div>
  );
}
