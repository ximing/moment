import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { ComposerEntry } from '@/compose/composer-entry';
import { canCompose } from '@/lib/roles';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail } from '@/timeline/timeline-rail';
import { Button } from '@/ui/button/index';
import { EmptyState } from '@/ui/feedback/index';
import { FeedHomeService } from './feed-home.service';

// 「大家的日子」汇总页（C 端总规范 §4.1 / §6.3）：页眉 = 多链标 + 大家的日子 +
// 「来自 N 条时光链」（N 只解释内容来源），主动作只有「记下此刻」（viewer 全程
// 不见，与 ComposerEntry 同一抑制规则）。链色点来源链接只在本页的时刻元信息出现
// （chainLookById 分支），筛选 / 锚定 / 加载语义保持既有 service 行为。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册同名 Service 后直接渲染本组件（timeline-variants.test.tsx）。
export const FeedHomeContent = observer(function FeedHomeContent() {
  const service = useService(FeedHomeService);
  const chainList = useService(ChainListService);
  const composeSession = useService(ComposeSessionService);
  const chains = chainList.chains;
  const looks = new Map(chains.map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }]));
  // viewer（任何链都不可写）全程不见发布入口（spec §5）
  const writable = chains.some(canCompose);
  const entry = writable ? <ComposerEntry /> : undefined;
  const loading = service.$model.loadFirst.loading;
  const noChains = !loading && chains.length === 0;

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* 多链标：与左栏导航同一 conic 四色点 */}
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 rounded-full bg-[conic-gradient(var(--dot-pink),var(--dot-blue),var(--dot-mint),var(--dot-pink))]"
          />
          <div className="min-w-0">
            <h1 className="text-page-title font-semibold text-ink">大家的日子</h1>
            {chains.length > 0 && <p className="mt-1 text-meta text-muted">来自 {chains.length} 条时光链</p>}
          </div>
        </div>
        {writable && (
          <Button className="shrink-0" onClick={() => composeSession.openCompose()}>
            记下此刻
          </Button>
        )}
      </header>

      <TimelineRail
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />
      {/* 锚定态「回到今天」：与链主页同一锚定 chips 语义，清 before 回第一页 */}
      {service.filter.before && (
        <div className="sticky top-2 z-10 mb-4">
          <Button variant="secondary" leadingIcon={ArrowLeft} onClick={() => service.clearBefore()}>
            回到今天
          </Button>
        </div>
      )}
      <Timeline
        moments={service.moments}
        chainLookById={looks}
        hideSignature={service.filter.order === 'created_at'}
        isPending={loading}
        isError={Boolean(service.$model.loadFirst.error)}
        onRetry={() => void service.loadFirst()}
        hasNextPage={service.hasMore}
        isFetchingNextPage={service.$model.loadMore.loading}
        fetchNextPage={() => void service.loadMore()}
        entry={entry}
        empty={
          noChains ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="建第一条时光链，比如「宝宝成长」"
              description="点「开一条新的链」就可以。"
            />
          ) : service.filtered ? (
            // 筛选/锚定筛空（web-product §4 空态表第三行）
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
              description="这一刻，等你来写下。"
              action={
                writable
                  ? { label: '记下此刻', emphasis: 'primary', onPress: () => composeSession.openCompose() }
                  : undefined
              }
            />
          )
        }
      />
    </div>
  );
});

export const FeedHome = bindServices(FeedHomeContent, [FeedHomeService]);
