import { useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useCompose } from '@/compose/ComposeContext';
import { ComposerEntry } from '@/compose/ComposerEntry';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/Timeline';
import { TimelineRail, type RailFilter } from '@/timeline/TimelineRail';
import { Button } from '@/ui/Button';

export function FeedHome() {
  const { openCompose } = useCompose();
  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const names = useMemo(() => new Map((chains ?? []).map((c) => [c.id, c.name])), [chains]);
  // 占位卡抑制：viewer（任何链都不可写）全程不见（spec §5）
  const entry = (chains ?? []).some(canCompose) ? <ComposerEntry /> : undefined;
  const [filter, setFilter] = useState<RailFilter>({ order: 'happened_at' });
  // before 变化 = key 变化 = 重查第一页（spec §4.3：替换查询参数重查，不是分页态延续）
  const q = useInfiniteQuery({
    queryKey: qk.feed(filter),
    queryFn: ({ pageParam }) => client.getFeed({ ...filter, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const moments = q.data?.pages.flatMap((p) => p.moments) ?? [];
  const noChains = !q.isPending && (chains ?? []).length === 0;

  // flex-wrap：rail 的 <1400px 触发按钮 order-first + w-full 落在主列顶部
  return (
    <div className="flex flex-wrap gap-x-8">
      <div className="min-w-0 flex-1">
        <h1 className="mb-6 font-display text-2xl">我的时间线</h1>
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
          chainNameById={names}
          hideSignature={filter.order === 'created_at'}
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
      <TimelineRail chains={chains ?? []} value={filter} onChange={setFilter} />
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
