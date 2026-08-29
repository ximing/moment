import type { ReactNode } from 'react';
import { observer, useService } from '@rabjs/react';
import type { PublicShareMoment, TemplateManifest } from '@moment/dto';
import type { ChainLook } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { dayHeading } from '@/lib/time';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner, InlineProgress, TimelineSkeleton } from '@/ui/feedback/index';
import { MomentSheet } from './moment-sheet';
import { groupMomentsByDate } from './group-by-date';

/**
 * 日子线（C 端总规范 §5）：--stroke 低强度虚线贯穿 + 日期结 + 按内容变形的日子。
 * hideSignature（order=created_at）时日期结收起，线仍在（发生日非单调，不是把线拆掉）。
 *
 * 几何（全部落在 4/8/12/16/20/24/32 网格）：内容列缩进 pl-8（32px），线心固定在
 * 内容列左缘前 20px（left-3 + -translate-x-1/2），与 ComposerEntry 的 -left-7 圆点
 * 钩子同心；日期结以 -left-5 -translate-x-1/2 居中到线心。结分三档：今天大结
 * --action、昨天中结 --date、更早小结 --stroke；内容层一律无阴影（spec §2.4）。
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
  templateManifest,
  ageLabelOf,
  onPersonFilter,
  onPlaceFilter,
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
  hideSignature?: boolean;
  entry?: ReactNode;
  templateManifest?: TemplateManifest | null;
  /** 年龄标注函数（chain-home 按链 payload.birthdate 提供；feed/分享页不传则不显示） */
  ageLabelOf?: (m: PublicShareMoment) => string;
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
}) {
  const sentinelRef = useLoadMoreSentinel(!isPending && !isError, hasNextPage, isFetchingNextPage, fetchNextPage);
  const composeSession = useService(ComposeSessionService);

  const renderSheet = (m: PublicShareMoment) => (
    <div key={m.id} className={m.id === composeSession.lastCreatedId ? 'animate-[grow-in_200ms_ease-out]' : undefined}>
      <MomentSheet
        moment={m}
        chainName={chainLookById?.get(m.chainId)?.name}
        chainColor={chainLookById?.get(m.chainId)?.color}
        chainIcon={chainLookById?.get(m.chainId)?.icon}
        chainAvatarMediaId={chainLookById?.get(m.chainId)?.avatarMediaId}
        chainAvatarFocus={chainLookById?.get(m.chainId)?.avatarFocus}
        shareToken={shareToken}
        readOnly={readOnly}
        templateManifest={templateManifest}
        ageLabel={ageLabelOf?.(m)}
        onPersonFilter={readOnly ? undefined : onPersonFilter}
        onPlaceFilter={readOnly ? undefined : onPlaceFilter}
      />
    </div>
  );

  const tail = (
    <>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <InlineProgress variant="indeterminate" label="正在载入更多" />}
    </>
  );

  if (isPending) {
    return <TimelineSkeleton />;
  }
  if (isError) {
    return (
      <Banner tone="error" action={onRetry ? { label: '重试', onPress: onRetry } : undefined}>
        没法刷新，点重试
      </Banner>
    );
  }
  if (moments.length === 0) return <>{empty}</>;

  if (hideSignature) {
    return (
      <div className="relative pl-8">
        <Line />
        {entry}
        <div className="flex flex-col gap-6">
          {moments.map(renderSheet)}
          {tail}
        </div>
      </div>
    );
  }

  const groups = groupMomentsByDate(moments);
  return (
    <div className="relative pl-8">
      <Line />
      {entry}
      {groups.map((g) => {
        const day = dayHeading(g.date);
        return (
          <section key={g.date} aria-label={day.title} className="relative mb-8">
            <span
              aria-hidden
              className={
                day.kind === 'today'
                  ? 'absolute -left-5 top-1 h-5 w-5 -translate-x-1/2 rounded-full bg-action'
                  : day.kind === 'yesterday'
                    ? 'absolute -left-5 top-2 h-3 w-3 -translate-x-1/2 rounded-full bg-date'
                    : 'absolute -left-5 top-3 h-2 w-2 -translate-x-1/2 rounded-full bg-stroke'
              }
            />
            <h2 className="mb-4">
              {/* 「今天 / 昨天」是固定字形，可用得意黑；其它日期是动态内容，用系统字（spec §2.2） */}
              <span className={day.kind === 'other' ? 'text-day-title font-medium text-ink' : 'font-display text-day-title text-ink'}>
                {day.title}
              </span>
              <small className="ml-2 text-meta font-normal text-muted">{day.sub}</small>
            </h2>
            <div className="flex flex-col gap-6">{g.moments.map(renderSheet)}</div>
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
      className="absolute inset-y-2 left-3 -translate-x-1/2 border-l-2 border-dashed border-[color:color-mix(in_srgb,var(--stroke)_72%,transparent)]"
    />
  );
}
