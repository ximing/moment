import { useEffect } from 'react';
import { useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { Timeline } from '@/timeline/timeline';
import { EmptyState, TimelineSkeleton } from '@/ui/feedback/index';
import { ShareAlbumService } from './share-album.service';

// 公开分享相册（plan Task 11）：无 Shell、全程只读，媒体经 ?st= token 通道，
// 过期 / 吊销 / 不存在语义不变（404 / SHARE_NOT_FOUND → 已关闭空态）。
// 视觉与认证时间线同一套日子线语法；链名是动态文案，用系统字（spec §2.2）。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册同名 Service 后直接渲染本组件（timeline-variants.test.tsx）。
export const ShareAlbumPageContent = observer(function ShareAlbumPageContent() {
  const { token = '' } = useParams();
  const service = useService(ShareAlbumService);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同详情页）
  const loadErr = service.$model.loadFirst.error;
  if (!service.chain && (service.$model.loadFirst.loading || !loadErr)) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16">
        <div className="mx-auto max-w-content">
          <TimelineSkeleton />
        </div>
      </div>
    );
  }
  if (loadErr && !service.$model.loadFirst.loading) {
    const e = loadErr;
    const closed = e instanceof ApiError && (e.status === 404 || e.code === 'SHARE_NOT_FOUND');
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <EmptyState
          variant="plain"
          scope="page"
          title={closed ? '这本相册的分享已关闭' : '加载失败，请稍后重试'}
          description={closed ? '问问家里人是不是换了新的分享链接。' : '网络不太顺，过一会儿再打开看看。'}
        />
      </div>
    );
  }

  const chain = service.chain;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto max-w-content px-6 py-8">
          <h1 className="text-page-title font-semibold text-ink">{chain?.name}</h1>
          {chain?.description && <p className="mt-2 text-meta text-muted">{chain.description}</p>}
          <p className="mt-2 text-caption text-muted">只读分享 · 时刻</p>
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
          empty={
            <EmptyState
              variant="timeline"
              scope="section"
              title="还没有内容"
              description="这本相册里还没有记下任何一刻。"
            />
          }
        />
      </main>
      <footer className="py-8 text-center text-caption text-muted">由家庭用「时刻」记录</footer>
    </div>
  );
});

export const ShareAlbumPage = bindServices(ShareAlbumPageContent, [ShareAlbumService]);
