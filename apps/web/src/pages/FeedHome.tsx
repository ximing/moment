import { useMemo, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useCompose } from '@/compose/ComposeContext';
import { ComposerEntry } from '@/compose/ComposerEntry';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/Timeline';
import { Button } from '@/ui/Button';

export function FeedHome() {
  const { openCompose } = useCompose();
  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const names = useMemo(() => new Map((chains ?? []).map((c) => [c.id, c.name])), [chains]);
  // 占位卡抑制：viewer（任何链都不可写）全程不见（spec §5）
  const entry = (chains ?? []).some(canCompose) ? <ComposerEntry /> : undefined;
  const filter = { order: 'happened_at' as const };
  const q = useInfiniteQuery({
    queryKey: qk.feed(filter),
    queryFn: ({ pageParam }) => client.getFeed({ ...filter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const moments = q.data?.pages.flatMap((p) => p.moments) ?? [];
  const noChains = !q.isPending && (chains ?? []).length === 0;

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl">我的时间线</h1>
      <Timeline
        moments={moments}
        chainNameById={names}
        isPending={q.isPending}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        hasNextPage={Boolean(q.hasNextPage)}
        isFetchingNextPage={q.isFetchingNextPage}
        fetchNextPage={q.fetchNextPage}
        entry={entry}
        empty={
          noChains ? (
            <Empty title="建第一条时光链，比如「宝宝成长」" hint="左栏点「新的链」就可以。" />
          ) : (
            <Empty
              title="还没有记下任何一刻"
              action={<Button onClick={() => openCompose()}>记下此刻</Button>}
            />
          )
        }
      />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="py-20 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
