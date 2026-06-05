import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useCompose } from '@/compose/ComposeContext';
import { ComposerEntry } from '@/compose/ComposerEntry';
import { canCompose, roleLabel } from '@/lib/roles';
import { Timeline } from '@/timeline/Timeline';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Empty } from './FeedHome';

export function ChainHome() {
  const { chainId = '' } = useParams();
  const { openCompose } = useCompose();
  const [tagId, setTagId] = useState<string | undefined>();
  const [order, setOrder] = useState<'happened_at' | 'created_at'>('happened_at');
  const { data: chain, isPending: chainPending, isError, error, refetch } = useQuery({
    queryKey: qk.chain(chainId),
    queryFn: () => client.getChain(chainId),
    enabled: Boolean(chainId),
  });
  const { data: tags } = useQuery({
    queryKey: qk.tags(chainId),
    queryFn: () => client.listTags(chainId),
    enabled: Boolean(chainId),
  });
  const feedFilter = { chainIds: [chainId], tagId, order };
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

  return (
    <div>
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

      {(tags?.tags.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTagId(undefined)}
            className={`rounded-full px-2 py-0.5 text-xs ${tagId === undefined ? 'bg-accent text-accent-fg' : 'text-muted'}`}
          >
            全部
          </button>
          {tags!.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId(t.id)}
              className={`rounded-full px-2 py-0.5 text-xs ${tagId === t.id ? 'bg-accent text-accent-fg' : 'text-muted'}`}
            >
              #{t.name}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto text-xs text-muted"
            onClick={() => setOrder((o) => (o === 'happened_at' ? 'created_at' : 'happened_at'))}
          >
            {order === 'happened_at' ? '按事件时间' : '按添加时间'}
          </button>
        </div>
      )}

      <Timeline
        moments={moments}
        hideSignature={order === 'created_at'}
        isPending={q.isPending}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        hasNextPage={Boolean(q.hasNextPage)}
        isFetchingNextPage={q.isFetchingNextPage}
        fetchNextPage={q.fetchNextPage}
        entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
        empty={
          tagId || order === 'created_at' ? (
            <Empty title="没有符合条件的时刻" action={<Button variant="ghost" onClick={() => { setTagId(undefined); setOrder('happened_at'); }}>清除筛选</Button>} />
          ) : (
            <Empty
              title="还没有记下任何一刻"
              action={canCompose(chain) ? <Button onClick={() => openCompose({ chainId: chain.id })}>记下此刻</Button> : undefined}
            />
          )
        }
      />
    </div>
  );
}
