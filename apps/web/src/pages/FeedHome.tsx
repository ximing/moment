import { useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useCompose } from '@/compose/ComposeContext';
import { ComposerEntry } from '@/compose/ComposerEntry';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/Timeline';
import { TimelineRail, type RailFilter } from '@/timeline/TimelineRail';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

export function FeedHome() {
  const { openCompose } = useCompose();
  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const looks = useMemo(
    () => new Map((chains ?? []).map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }])),
    [chains],
  );
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

  return (
    <div>
      <TimelineRail chains={chains ?? []} value={filter} onChange={setFilter} />
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
          chainLookById={looks}
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
              <Empty title="建第一条时光链，比如「宝宝成长」" hint="点「开一条新的链」就可以。" />
            ) : filter.tagId || filter.chainIds?.length || filter.order === 'created_at' || filter.before ? (
              // 筛选/锚定筛空（web-product §4 空态表第三行）：「没有符合条件的时刻」+ 一键清除
              <Empty
                title="没有符合条件的时刻"
                action={
                  <Button variant="ghost" onClick={() => setFilter({ order: 'happened_at' })}>
                    清除筛选
                  </Button>
                }
              />
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
