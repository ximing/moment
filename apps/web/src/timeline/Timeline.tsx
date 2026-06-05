import type { ReactNode } from 'react';
import type { MomentResponse } from '@moment/dto';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner } from '@/ui/Banner';
import { MomentSheet } from './MomentSheet';
import { groupMomentsByDate } from './group-by-date';

/**
 * 时间线（spec §3）：happened_at 序下带「时光链签名」——贯穿虚线链 + 日期贴纸节点 + 卡片链节环。
 * hideSignature（order=created_at，happened_at 非单调）时整体降级为纯卡片列表（spec §3.2，非 bug）。
 *
 * 链条对齐基准：容器 pl-[26px]，虚线 left-[9px]、宽 2.5px，线中心 ≈ x10.25；
 * 日期圆点 12px 用 -left-[22px]、卡片链节环 16px 用 -left-6，中心均落在 x10（微调自 brief 初值，对齐虚线）。
 * 虚线色用 color-mix：Tailwind v3 对 var() 色值的 /40 透明度修饰静默不生效（硬约束）。
 */
export function Timeline({
  moments,
  chainNameById,
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
}: {
  moments: MomentResponse[];
  chainNameById?: Map<string, string>;
  shareToken?: string;
  readOnly?: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry?: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  empty: ReactNode;
  /** order=created_at 时传 true：链条与日期贴纸整体隐藏（spec §3.2 降级） */
  hideSignature?: boolean;
}) {
  const sentinelRef = useLoadMoreSentinel(!isPending && !isError, hasNextPage, isFetchingNextPage, fetchNextPage);

  const renderSheet = (m: MomentResponse) => (
    <MomentSheet
      key={m.id}
      moment={m}
      chainName={chainNameById?.get(m.chainId)}
      shareToken={shareToken}
      readOnly={readOnly}
    />
  );

  const tail = (
    <>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <p className="text-center text-sm text-muted">加载更多…</p>}
    </>
  );

  if (isPending) {
    const skeletons = [0, 1, 2].map((i) => (
      <div key={i} className="h-40 animate-pulse rounded-card border-2 border-line bg-surface" />
    ));
    // 骨架卡也挂链条（spec §3.3）；hideSignature 时退化为纯列表，与终态一致
    if (hideSignature) return <div className="space-y-4">{skeletons}</div>;
    return (
      <div className="relative pl-[26px]">
        <div
          aria-hidden
          className="absolute bottom-2 left-[9px] top-2 border-l-[2.5px] border-dashed border-[color:color-mix(in_srgb,var(--muted)_40%,transparent)]"
        />
        <div className="space-y-5">{skeletons}</div>
      </div>
    );
  }
  if (isError) {
    return <Banner action={onRetry ? { label: '重试', onClick: onRetry } : undefined}>没法刷新，点重试</Banner>;
  }
  if (moments.length === 0) return <>{empty}</>;

  if (hideSignature) {
    // order=created_at：happened_at 非单调，签名降级隐藏（spec §3.2）
    return (
      <div className="space-y-5">
        {moments.map(renderSheet)}
        {tail}
      </div>
    );
  }

  const groups = groupMomentsByDate(moments);
  return (
    <div className="relative pl-[26px]">
      {/* 贯穿虚线链：26px 缩进区，2.5px dashed，~0.4 透明度（spec §3.1） */}
      <div
        aria-hidden
        className="absolute bottom-2 left-[9px] top-2 border-l-[2.5px] border-dashed border-[color:color-mix(in_srgb,var(--muted)_40%,transparent)]"
      />
      {groups.map((g) => (
        <section key={g.date} className="mb-6">
          {/* 日期分组头 = 链上贴纸节点：左侧圆点(--select) + 日期贴纸（颜色全走 token） */}
          <header className="relative mb-3 flex items-center">
            <span aria-hidden className="absolute -left-[22px] h-3 w-3 rounded-full border-2 border-line bg-select" />
            {/* 动态日期文字不用 font-display：得意黑子集不含数字/月/日字形（scripts/font-glyphs.txt） */}
            <span className="rounded-sticker border-2 border-[color:var(--date-sticker-line)] bg-[var(--date-sticker-bg)] px-3 py-0.5 text-sm text-[var(--date-sticker-fg)] shadow-sticker">
              {g.date}
            </span>
          </header>
          <div className="space-y-5">{g.moments.map(renderSheet)}</div>
        </section>
      ))}
      {tail}
    </div>
  );
}
