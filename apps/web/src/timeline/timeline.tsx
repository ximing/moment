import type { ReactNode } from 'react';
import { observer, useService } from '@rabjs/react';
import type { ChainColor, ChainIcon, MomentResponse } from '@moment/dto';
import { ComposeSessionService } from '@/services/compose-session.service';
import { dayHeading } from '@/lib/time';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner } from '@/ui/Banner';
import { MomentSheet } from './moment-sheet';
import { groupMomentsByDate } from './group-by-date';

/**
 * 日子线：虚线贯穿 + 日期结 + 按内容变形的时刻。
 * hideSignature（order=created_at）时日期结收起，线仍在（发生日非单调，不是把线拆掉）。
 */
export const Timeline = observer(function Timeline({
  moments,
  chainLookById,
  shareToken,
  readOnly,
  isPending,
  isError,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  empty,
  hideSignature,
  entry,
}: {
  moments: MomentResponse[];
  chainLookById?: Map<string, { name: string; color: ChainColor | null; icon: ChainIcon | null }>;
  shareToken?: string;
  readOnly?: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry?: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  empty: ReactNode;
  hideSignature?: boolean;
  entry?: ReactNode;
}) {
  const sentinelRef = useLoadMoreSentinel(!isPending && !isError, hasNextPage, isFetchingNextPage, fetchNextPage);
  const composeSession = useService(ComposeSessionService);

  const renderSheet = (m: MomentResponse) => (
    <div key={m.id} className={m.id === composeSession.lastCreatedId ? 'animate-[grow-in_200ms_ease-out]' : undefined}>
      <MomentSheet
        moment={m}
        chainName={chainLookById?.get(m.chainId)?.name}
        chainColor={chainLookById?.get(m.chainId)?.color}
        chainIcon={chainLookById?.get(m.chainId)?.icon}
        shareToken={shareToken}
        readOnly={readOnly}
        hideKnot
      />
    </div>
  );

  const tail = (
    <>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <p className="text-center text-sm text-muted">加载更多…</p>}
    </>
  );

  if (isPending) {
    const skeletons = [0, 1, 2].map((i) => (
      <div key={i} className="h-40 animate-pulse rounded-card bg-surface shadow-card" />
    ));
    return (
      <div className="relative pl-9">
        <Line />
        <div className="space-y-4">{skeletons}</div>
      </div>
    );
  }
  if (isError) {
    return <Banner action={onRetry ? { label: '重试', onClick: onRetry } : undefined}>没法刷新，点重试</Banner>;
  }
  if (moments.length === 0) return <>{empty}</>;

  if (hideSignature) {
    return (
      <div className="relative pl-9">
        <Line />
        {entry}
        <div className="space-y-5">
          {moments.map(renderSheet)}
          {tail}
        </div>
      </div>
    );
  }

  const groups = groupMomentsByDate(moments);
  return (
    <div className="relative pl-9">
      <Line />
      {entry}
      {groups.map((g) => {
        const day = dayHeading(g.date);
        return (
          <section key={g.date} className="relative mb-2">
            <span
              aria-hidden
              className={
                day.kind === 'today'
                  ? 'absolute -left-[30px] top-2 h-5 w-5 rounded-full bg-[var(--today)] shadow-[0_6px_16px_color-mix(in_srgb,var(--today)_45%,transparent)]'
                  : day.kind === 'yesterday'
                    ? 'absolute -left-[27px] top-2.5 h-3.5 w-3.5 rounded-full bg-[var(--knot-yesterday)]'
                    : 'absolute -left-[25px] top-3 h-2.5 w-2.5 rounded-full bg-[var(--knot-older)]'
              }
            />
            <h2 className="mb-4 leading-[1.1]">
              <span className={day.kind === 'other' ? 'text-[28px] font-medium text-ink' : 'font-display text-[28px] text-ink'}>
                {day.title}
              </span>
              <small className="ml-2 align-[4px] text-[13px] font-normal tracking-normal text-muted">{day.sub}</small>
            </h2>
            <div className="space-y-5 pb-8">{g.moments.map(renderSheet)}</div>
          </section>
        );
      })}
      {tail}
    </div>
  );
});

function Line() {
  return (
    <div
      aria-hidden
      className="absolute bottom-2 left-[15px] top-2 border-l-2 border-dashed border-[color:color-mix(in_srgb,var(--line)_90%,transparent)]"
    />
  );
}
