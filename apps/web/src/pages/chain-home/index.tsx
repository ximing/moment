import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { ComposerEntry } from '@/compose/composer-entry';
import { ComposeSessionService } from '@/services/compose-session.service';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail } from '@/timeline/timeline-rail';
import { Button, IconButton } from '@/ui/button/index';
import { Banner, EmptyState, TimelineSkeleton } from '@/ui/feedback/index';
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';
import { ChainAudience } from './chain-audience';
import { ChainHomeService } from './chain-home.service';

// 链主页（C 端总规范 §4.2 + chain-audience-header 规范 §3）：页眉 = 链名 + 成员
// 头像簇与可见性（贴链名右侧）+ 最右 ···（ResponsiveMenu，进链设置）；简介在
// 下一行、左缘与链名对齐。链名是动态文案，用系统字（spec §2.2）。kebab 沿用既有
// 可见性规则（成员即可见，设置项不变）；角色条件与数据流保持原样。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册同名 Service 后直接渲染本组件（chain-home.test.tsx）。
export const ChainHomeContent = observer(function ChainHomeContent() {
  const { chainId = '' } = useParams();
  const navigate = useNavigate();
  const service = useService(ChainHomeService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  // 三态判定（防 hydrate effect 首帧闪错误态）：骨架 = 无 chain 且（加载中或无错）
  const chainErr = service.$model.loadChain.error;
  if (!service.chain && (service.$model.loadChain.loading || !chainErr)) {
    return <TimelineSkeleton />;
  }
  if (!service.chain) {
    return (
      <Banner
        tone="error"
        action={chainErr && !service.$model.loadChain.loading ? { label: '重试', onPress: () => service.loadChain() } : undefined}
      >
        看不到这条链，或它已经不在了
      </Banner>
    );
  }
  const chain = service.chain;

  return (
    <div>
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 truncate text-page-title font-semibold text-ink">{chain.name}</h1>
          <ChainAudience chain={chain} />
          <div className="ml-auto shrink-0">
            <ResponsiveMenu
              aria-label={`${chain.name} 的链操作`}
              sheetTitle={chain.name}
              trigger={<IconButton icon={MoreHorizontal} label="链操作" />}
              onAction={(key) => {
                if (key === 'settings') navigate(`/chains/${chain.id}/settings`);
              }}
            >
              <MenuItem id="settings" textValue="设置">
                设置
              </MenuItem>
            </ResponsiveMenu>
          </div>
        </div>
        {chain.description && <p className="mt-1 text-meta text-muted">{chain.description}</p>}
      </header>

      <TimelineRail
        fixedChainId={chain.id}
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />

      {/* 锚定态「回到今天」：时间线顶部固定一枚（spec §4.3），清 before 回第一页 */}
      {service.filter.before && (
        <div className="sticky top-2 z-10 mb-4">
          <Button variant="secondary" leadingIcon={ArrowLeft} onClick={() => service.clearBefore()}>
            回到今天
          </Button>
        </div>
      )}

      <Timeline
        moments={service.moments}
        hideSignature={service.filter.order === 'created_at'}
        isPending={service.$model.loadFirst.loading}
        isError={Boolean(service.$model.loadFirst.error)}
        onRetry={() => void service.loadFirst()}
        hasNextPage={service.hasMore}
        isFetchingNextPage={service.$model.loadMore.loading}
        fetchNextPage={() => void service.loadMore()}
        entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
        empty={
          service.filtered ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="没有符合条件的时刻"
              description="换个标签或月份再看看。"
              action={{ label: '清除筛选', emphasis: 'quiet', onPress: () => service.clearFilters() }}
            />
          ) : (
            <EmptyState
              variant="timeline"
              scope="section"
              title="还没有记下任何一刻"
              description="这条链的第一刻，等你来写下。"
              action={
                canCompose(chain)
                  ? { label: '记下此刻', emphasis: 'primary', onPress: () => composeSession.openCompose({ chainId: chain.id }) }
                  : undefined
              }
            />
          )
        }
      />
    </div>
  );
});

export const ChainHome = bindServices(ChainHomeContent, [ChainHomeService]);
