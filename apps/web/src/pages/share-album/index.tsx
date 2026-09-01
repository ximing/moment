import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { Timeline } from '@/timeline/timeline';
import { ChainMark } from '@/chain/ChainMark';
import { PublicChainCover } from '@/chain/ChainCover';
import { AggregateView } from '@/chain/aggregate-views';
import { MapView } from '@/chain/map-view';
import { MarkdownText } from '@/pages/recap/markdown-text';
import { EmptyState, TimelineSkeleton } from '@/ui/feedback/index';
import { isHttpUrl } from '@/lib/media-src';
import { ShareAlbumService } from './share-album.service';

// 公开分享相册（plan Task 11）：无 Shell、全程只读；媒体/头像/封面优先接口签发的
// https，相对路径才拼 ?st=。过期 / 吊销 / 不存在语义不变（404 / SHARE_NOT_FOUND → 已关闭空态）。
// 视觉与认证时间线同一套日子线语法；链名是动态文案，用系统字（spec §2.2）。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册同名 Service 后直接渲染本组件（timeline-variants.test.tsx）。
export const ShareAlbumPageContent = observer(function ShareAlbumPageContent() {
  const { token = '' } = useParams();
  const service = useService(ShareAlbumService);
  // 封面加载失败当次隐藏（不无限重试），页头回普通布局
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同详情页）
  const loadErr = service.$model.loadFirst.error;
  if (!service.chain && (service.$model.loadFirst.loading || !loadErr)) {
    return (
      <div className="min-h-screen w-full bg-bg px-6 py-8">
        <TimelineSkeleton />
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
  const showCover = Boolean(chain?.coverMediaId && chain.coverUrl && !coverFailed);
  const avatarSrc = chain?.avatarUrl
    ? isHttpUrl(chain.avatarUrl)
      ? chain.avatarUrl
      : `${chain.avatarUrl}?st=${encodeURIComponent(token)}`
    : null;

  return (
    <div className="min-h-screen bg-bg">
      {showCover && (
        <PublicChainCover
          src={chain!.coverUrl!}
          shareToken={token}
          focus={chain!.coverFocus}
          onError={() => setCoverFailed(true)}
        />
      )}
      <header className={showCover ? '' : 'border-b border-line'}>
        <div className={`w-full px-6 ${showCover ? 'pb-8' : 'py-8'}`}>
          {showCover && chain ? (
            <div className="mb-3">
              <ChainMark
                chainId={token}
                color={chain.color}
                icon={chain.icon}
                avatarSrc={avatarSrc}
                avatarFocus={chain.avatarFocus}
                size={32}
              />
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-3">
            {chain && !showCover && (
              <ChainMark
                // PublicShareChainInfo 不带链 id：哈希色回退用 share token 作稳定种子（仅三模式全空时才用到）
                chainId={token}
                color={chain.color}
                icon={chain.icon}
                avatarSrc={avatarSrc}
                avatarFocus={chain.avatarFocus}
                size={24}
              />
            )}
            <h1 className="min-w-0 truncate text-page-title font-semibold text-ink">{chain?.name}</h1>
          </div>
          {chain?.description && <p className="mt-2 text-meta text-muted">{chain.description}</p>}
          <p className="mt-2 text-caption text-muted">只读分享 · 时刻</p>
        </div>
      </header>
      <main className="w-full px-6 py-8">
        {service.recap && (
          <section className="mb-8">
            <h2 className="mb-4 text-body font-semibold text-ink">
              {Number(service.recap.period.slice(5))} 月回顾
              {service.recap.status === 'degraded' && <span className="ml-2 text-meta font-normal text-muted">（简版）</span>}
            </h2>
            <MarkdownText content={service.recap.content} />
          </section>
        )}
        {(() => {
          const manifest = service.templateManifest;
          if (!manifest || service.aggregates.length === 0) return null;
          return (
            <div className="mb-8 flex flex-col gap-6">
              {service.aggregates.map((agg) => (
                <section key={agg.view}>
                  <h2 className="mb-2 text-body font-semibold text-ink">
                    {(manifest.views ?? []).find((v) => v.type === agg.view)?.label ?? agg.view}
                  </h2>
                  <AggregateView
                    view={agg.view}
                    aggregate={agg}
                    moments={service.moments}
                    chainPayload={null}
                    hasMore={false}
                    isLoading={false}
                    error={null}
                    onRetry={() => void service.loadFirst()}
                    map={(props) => <MapView {...props} />}
                  />
                </section>
              ))}
            </div>
          );
        })()}
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
