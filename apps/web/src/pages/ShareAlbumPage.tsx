import { useParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { Timeline } from '@/timeline/Timeline';

export function ShareAlbumPage() {
  const { token = '' } = useParams();
  const q = useInfiniteQuery({
    queryKey: qk.publicShare(token),
    queryFn: ({ pageParam }) => client.getPublicShare(token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: token.length > 0,
    retry: false,
  });

  if (q.isPending) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16">
        <div className="mx-auto max-w-content space-y-4">
          {[0, 1].map((i) => (
            // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
            <div key={i} className="h-40 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />
          ))}
        </div>
      </div>
    );
  }

  if (q.isError) {
    const closed = q.error instanceof ApiError && (q.error.status === 404 || q.error.code === 'SHARE_NOT_FOUND');
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <p className="rounded-card border-2 border-line bg-surface px-8 py-6 font-display text-xl text-ink shadow-card">
          {closed ? '这本相册的分享已关闭' : '加载失败，请稍后重试'}
        </p>
      </div>
    );
  }

  const chain = q.data.pages[0]?.chain;
  const moments = q.data.pages.flatMap((p) => p.moments);

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto max-w-content px-6 py-8">
          {/* 链名为动态文案，不用 font-display：得意黑子集只含固定文案字形（硬约束） */}
          <h1 className="text-3xl font-medium">{chain?.name}</h1>
          {chain?.description && <p className="mt-2 text-muted">{chain.description}</p>}
          <p className="mt-2 text-xs text-muted">只读分享 · 时刻</p>
        </div>
      </header>
      <main className="mx-auto max-w-content px-6 py-8">
        <Timeline
          moments={moments}
          shareToken={token}
          readOnly
          isPending={false}
          isError={false}
          hasNextPage={Boolean(q.hasNextPage)}
          isFetchingNextPage={q.isFetchingNextPage}
          fetchNextPage={q.fetchNextPage}
          empty={<p className="py-16 text-center text-muted">还没有内容</p>}
        />
      </main>
      <footer className="py-8 text-center text-xs text-muted">由家庭用「时刻」记录</footer>
    </div>
  );
}
