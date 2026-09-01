import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { observer, useService } from '@rabjs/react';
import type { PublicShareMoment, TemplateManifest } from '@moment/dto';
import type { ChainLook } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner, InlineProgress } from '@/ui/feedback/index';
import { MomentSheet } from './moment-sheet';
import { AlbumSkeleton } from './album-skeleton';
import { albumColCount, ALBUM_GAP_PX, masonryItemStyle, packAlbumMonth } from './album-pack';
import { groupMomentsByMonth, monthHeading } from './group-by-month';

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
  order = 'happened_at',
  variant = 'album',
  templateManifest,
  ageLabelOf,
  onPersonFilter,
  onPlaceFilter,
  onTagFilter,
}: {
  moments: PublicShareMoment[];
  chainLookById?: Map<string, ChainLook>;
  shareToken?: string;
  readOnly?: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry?: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  empty: ReactNode;
  order?: 'happened_at' | 'created_at';
  variant?: 'album' | 'single';
  templateManifest?: TemplateManifest | null;
  /** 年龄标注函数（chain-home 按链 payload.birthdate 提供；feed/分享页不传则不显示） */
  ageLabelOf?: (m: PublicShareMoment) => string;
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
  onTagFilter?: (tag: { id: string; name: string }) => void;
}) {
  const sentinelRef = useLoadMoreSentinel(!isPending && !isError, hasNextPage, isFetchingNextPage, fetchNextPage);
  const composeSession = useService(ComposeSessionService);
  const colCount = useAlbumColCount();

  const renderSheet = (m: PublicShareMoment) => {
    const grow = m.id === composeSession.lastCreatedId ? 'animate-[grow-in_200ms_ease-out]' : undefined;
    return (
      <div key={m.id} className={grow ? `${grow} w-full` : 'w-full'}>
        <MomentSheet
          moment={m}
          chainName={chainLookById?.get(m.chainId)?.name}
          chainColor={chainLookById?.get(m.chainId)?.color}
          chainIcon={chainLookById?.get(m.chainId)?.icon}
          chainAvatarMediaId={chainLookById?.get(m.chainId)?.avatarMediaId}
          chainAvatarUrl={chainLookById?.get(m.chainId)?.avatarUrl}
          chainAvatarFocus={chainLookById?.get(m.chainId)?.avatarFocus}
          shareToken={shareToken}
          readOnly={readOnly}
          variant={variant}
          templateManifest={templateManifest}
          ageLabel={ageLabelOf?.(m)}
          onPersonFilter={readOnly ? undefined : onPersonFilter}
          onPlaceFilter={readOnly ? undefined : onPlaceFilter}
          onTagFilter={readOnly ? undefined : onTagFilter}
        />
      </div>
    );
  };

  const tail = (
    <>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <InlineProgress variant="indeterminate" label="正在载入更多" />}
    </>
  );

  // 已有列表时不换成骨架/错误整页：点赞评论刷新或筛选重拉会丢掉滚动位置。
  if (isPending && moments.length === 0) {
    return <AlbumSkeleton />;
  }
  if (isError && moments.length === 0) {
    return (
      <Banner tone="error" action={onRetry ? { label: '重试', onPress: onRetry } : undefined}>
        没法刷新，点重试
      </Banner>
    );
  }
  if (moments.length === 0) return <>{empty}</>;

  if (variant === 'single') {
    return (
      <>
        {moments.map(renderSheet)}
        {tail}
      </>
    );
  }

  return (
    <>
      {groupMomentsByMonth(moments, order).map((g) => (
        <section key={g.month} aria-label={monthHeading(g.month)} className="mb-8">
          <h2 className="mb-3 text-caption tracking-wide text-muted">{monthHeading(g.month)}</h2>
          <AlbumMonthGrid moments={g.moments} colCount={colCount} renderSheet={renderSheet} />
        </section>
      ))}
      {tail}
    </>
  );
});

function AlbumMonthGrid({
  moments,
  colCount,
  renderSheet,
}: {
  moments: PublicShareMoment[];
  colCount: number;
  renderSheet: (m: PublicShareMoment) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      setWidth((prev) => (prev === w ? prev : w));
    };
    apply();
    window.addEventListener('resize', apply);
    if (typeof ResizeObserver !== 'function') {
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      window.removeEventListener('resize', apply);
      ro.disconnect();
    };
  }, []);

  const colWidth = width > 0 && colCount > 0 ? (width - ALBUM_GAP_PX * (colCount - 1)) / colCount : 0;
  const positioned = colWidth > 0;

  const { placements, totalHeight } = useMemo(
    () => packAlbumMonth(moments, colCount, colWidth, positioned ? measured : undefined),
    [moments, colCount, colWidth, measured, positioned],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !positioned) return;
    const next = new Map<string, number>();
    let changed = false;
    for (const node of el.querySelectorAll<HTMLElement>('[data-note-id]')) {
      const id = node.dataset.noteId;
      if (!id) continue;
      const h = Math.round(node.offsetHeight);
      next.set(id, h);
      if (measured.get(id) !== h) changed = true;
    }
    if (changed || next.size !== measured.size) setMeasured(next);
  });

  return (
    <div ref={ref} className="relative w-full" style={positioned ? { height: totalHeight } : undefined}>
      {placements.map((p) => {
        const box = positioned ? masonryItemStyle(p.col, p.span, p.y, colWidth) : undefined;
        return (
          <div
            key={p.item.id}
            data-note-id={p.item.id}
            className={positioned ? 'absolute' : undefined}
            style={box ? { left: box.left, top: box.top, width: box.width } : undefined}
          >
            {renderSheet(p.item)}
          </div>
        );
      })}
    </div>
  );
}

function useAlbumColCount(): number {
  const [n, setN] = useState(albumColCount);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const sync = () => setN(albumColCount());
    const wide = window.matchMedia('(min-width: 1400px)');
    const mid = window.matchMedia('(min-width: 900px)');
    wide.addEventListener('change', sync);
    mid.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    sync();
    return () => {
      wide.removeEventListener('change', sync);
      mid.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  return n;
}
