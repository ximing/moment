import type { ReactNode } from 'react';
import { observer, useService } from '@rabjs/react';
import type { PublicShareMoment, TemplateManifest } from '@moment/dto';
import type { ChainLook } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner, InlineProgress } from '@/ui/feedback/index';
import { MomentSheet } from './moment-sheet';
import { AlbumSkeleton } from './album-skeleton';
import { groupMomentsByMonth, monthHeading } from './group-by-month';
import { noteColSpan } from './note-layout';

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

  const renderSheet = (m: PublicShareMoment) => {
    const span = noteColSpan(m) === 2 ? 'col-span-2' : undefined;
    const grow = m.id === composeSession.lastCreatedId ? 'animate-[grow-in_200ms_ease-out]' : undefined;
    const className = [span, grow].filter(Boolean).join(' ') || undefined;
    return (
      <div key={m.id} className={className}>
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
        <section key={g.month} aria-label={monthHeading(g.month)}>
          <h2 className="mb-3 text-caption tracking-wide text-muted">{monthHeading(g.month)}</h2>
          <div className="grid grid-cols-2 gap-3 [grid-auto-flow:dense] min-[900px]:grid-cols-3 min-[1400px]:grid-cols-4">
            {g.moments.map(renderSheet)}
          </div>
        </section>
      ))}
      {tail}
    </>
  );
});
