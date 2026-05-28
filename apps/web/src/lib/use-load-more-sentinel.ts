import { useCallback, useRef } from 'react';

/**
 * Infinite-scroll sentinel. Callback ref attaches after conditional
 * renders (ChainDetail returns early while isPending — a useEffect+ref
 * would see null and never re-bind).
 */
export function useLoadMoreSentinel(
  enabled: boolean,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => unknown,
): (node: HTMLDivElement | null) => void {
  const observerRef = useRef<IntersectionObserver | null>(null);

  return useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !enabled) return;

      const tryLoad = () => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      };

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) tryLoad();
        },
        { root: null, rootMargin: '400px 0px', threshold: 0 },
      );
      observer.observe(node);
      observerRef.current = observer;

      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight + 400 && rect.bottom > -400) tryLoad();
    },
    [enabled, hasNextPage, isFetchingNextPage, fetchNextPage],
  );
}
