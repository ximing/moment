import type { ReactNode } from 'react';
import type { MomentResponse } from '@moment/dto';
import { useLoadMoreSentinel } from '@/lib/use-load-more-sentinel';
import { Banner } from '@/ui/Banner';
import { MomentSheet } from './MomentSheet';

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
}) {
  const sentinelRef = useLoadMoreSentinel(!isPending && !isError, hasNextPage, isFetchingNextPage, fetchNextPage);

  if (isPending) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-paper bg-white/50" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <Banner action={onRetry ? { label: '重试', onClick: onRetry } : undefined}>没法刷新，点重试</Banner>;
  }
  if (moments.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-5">
      {moments.map((m) => (
        <MomentSheet
          key={m.id}
          moment={m}
          chainName={chainNameById?.get(m.chainId)}
          shareToken={shareToken}
          readOnly={readOnly}
        />
      ))}
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <p className="text-center text-sm text-muted">加载更多…</p>}
    </div>
  );
}
