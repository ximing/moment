import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useService } from '@rabjs/react';
import { ComposerEntry } from '@/compose/composer-entry';
import { ComposeSessionService } from '@/services/compose-session.service';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail, type RailFilter } from '@/timeline/TimelineRail';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { KebabButton, Menu, MenuItem } from '@/ui/Menu';
import { Empty } from './FeedHome';

export function ChainHome() {
  const { chainId = '' } = useParams();
  const navigate = useNavigate();
  const composeSession = useService(ComposeSessionService);
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

  if (chainPending) return <div className="h-32 animate-pulse rounded-card bg-white/50" />;
  if (isError || !chain) {
    return (
      <Banner action={{ label: '重试', onClick: () => void refetch() }}>
        {error instanceof Error ? '看不到这条链，或它已经不在了' : '看不到这条链，或它已经不在了'}
      </Banner>
    );
  }

  return (
    <div>
      <TimelineRail chains={[]} fixedChainId={chainId} value={filter} onChange={setFilter} />
      <header className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-medium">{chain.name}</h1>
            {chain.description && <p className="mt-1 text-sm text-muted">{chain.description}</p>}
          </div>
          <Menu trigger={<KebabButton label="设置" />}>
            {(close) => (
              <MenuItem
                onClick={() => {
                  close();
                  navigate(`/chains/${chain.id}/settings`);
                }}
              >
                设置
              </MenuItem>
            )}
          </Menu>
        </header>

        {/* 锚定态「回到最新」：时间线顶部固定一枚（spec §4.3），清 before 回第一页 */}
        {filter.before && (
          <div className="sticky top-2 z-10 mb-3">
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, before: undefined }))}
              className="inline-flex items-center gap-1 rounded-sticker bg-select px-3 py-1 text-sm text-select-fg"
            >
              <Icon icon={ArrowLeft} size={14} />
              回到今天
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
                action={canCompose(chain) ? <Button onClick={() => composeSession.openCompose({ chainId: chain.id })}>记下此刻</Button> : undefined}
              />
            )
          }
        />
    </div>
  );
}
