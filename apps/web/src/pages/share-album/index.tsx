import { useEffect } from 'react';
import { useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { Timeline } from '@/timeline/timeline';
import { ShareAlbumService } from './share-album.service';

const ShareAlbumPageContent = observer(function ShareAlbumPageContent() {
  const { token = '' } = useParams();
  const service = useService(ShareAlbumService);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同 Task 3/4/11）
  const loadErr = service.$model.loadFirst.error;
  if (!service.chain && (service.$model.loadFirst.loading || !loadErr)) {
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
  if (loadErr && !service.$model.loadFirst.loading) {
    const e = loadErr;
    const closed = e instanceof ApiError && (e.status === 404 || e.code === 'SHARE_NOT_FOUND');
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <p className="rounded-card border border-line bg-surface px-8 py-6 font-display text-xl text-ink shadow-card">
          {closed ? '这本相册的分享已关闭' : '加载失败，请稍后重试'}
        </p>
      </div>
    );
  }

  const chain = service.chain;

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
          moments={service.moments}
          shareToken={token}
          readOnly
          isPending={false}
          isError={false}
          hasNextPage={service.hasMore}
          isFetchingNextPage={service.$model.loadMore.loading}
          fetchNextPage={() => void service.loadMore()}
          empty={<p className="py-16 text-center text-muted">还没有内容</p>}
        />
      </main>
      <footer className="py-8 text-center text-xs text-muted">由家庭用「时刻」记录</footer>
    </div>
  );
});

export const ShareAlbumPage = bindServices(ShareAlbumPageContent, [ShareAlbumService]);
