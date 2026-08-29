import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { MoreHorizontal } from 'lucide-react';
import { ComposerEntry } from '@/compose/composer-entry';
import { ChainCover } from '@/chain/ChainCover';
import { ComposeSessionService } from '@/services/compose-session.service';
import { AggregateView } from '@/chain/aggregate-views';
import { MapView } from '@/chain/map-view';
import { RecapEntry } from '@/chain/recap-entry';
import { babyAgeLabel } from '@/lib/template';
import { canCompose } from '@/lib/roles';
import { humanError } from '@/lib/errors';
import { formatSearchParsed } from '@/lib/search-summary';
import { FilterChips } from '@/timeline/filter-chips';
import { TimelineSearchField } from '@/timeline/search-field';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail } from '@/timeline/timeline-rail';
import { IconButton } from '@/ui/button/index';
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
  // 封面加载失败当次隐藏（按 coverMediaId 记忆，换链/换封面自然重置），不无限重试
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);

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
  // 大封面只属于链首页与公开分享页（spec §7.5）；服务端 ready 门闸保证 mediaId/URL/focus 三元组同非空
  const showCover = chain.coverMediaId !== null && chain.coverUrl !== null && failedCoverId !== chain.coverMediaId;

  return (
    <div>
      {showCover && (
        <ChainCover
          mediaId={chain.coverMediaId!}
          focus={chain.coverFocus}
          onError={() => setFailedCoverId(chain.coverMediaId)}
          className="mb-4"
        />
      )}
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

      <RecapEntry chainId={chain.id} />

      {(() => {
        const views = chain.templateManifest.views ?? [];
        if (views.length === 0) return null;
        // 主时间线 tab 恒在首位；groupBy 的 timeline 视图 id 映射为 'trips'（防与主时间线撞 key）
        const tabs = [
          { id: 'timeline', label: '时间线' },
          ...views
            .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
            .map((v) => ({ id: v.type === 'timeline' ? 'trips' : v.type, label: v.label })),
        ];
        return (
          <nav className="mb-4 flex flex-wrap gap-2" aria-label="链视图">
            {tabs.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={service.activeView === v.id}
                onClick={() => service.setActiveView(v.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
                  service.activeView === v.id
                    ? 'bg-select text-select-fg'
                    : 'text-muted hover:bg-floating-hover hover:text-ink'
                }`}
              >
                {v.label}
              </button>
            ))}
          </nav>
        );
      })()}

      {service.activeView === 'timeline' ? (
        <TimelineSearchField
          onSubmit={(q) => void service.submitSearch(q)}
          onClear={() => {
            if (service.searching) void service.exitSearch();
          }}
        />
      ) : null}

      <TimelineRail
        fixedChainId={chain.id}
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />

      {service.activeView === 'timeline' ? (
        <>
          {service.searchError ? (
            <Banner tone="error">{humanError(service.searchError)}</Banner>
          ) : service.searching && service.searchParsed ? (
            <Banner tone="info" action={{ label: '关闭', onPress: () => void service.exitSearch() }}>
              {formatSearchParsed(service.searchParsed)}
            </Banner>
          ) : null}
        <FilterChips
          filter={service.filter}
          onClearPerson={() =>
            service.setFilter({ ...service.filter, personId: undefined, personName: undefined })
          }
          onClearPlace={() => service.setFilter({ ...service.filter, place: undefined })}
          onClearBefore={() => service.clearBefore()}
        />
        <Timeline
          moments={service.moments}
          hideSignature={service.filter.order === 'created_at'}
          isPending={service.$model.loadFirst.loading}
          isError={Boolean(service.$model.loadFirst.error)}
          onRetry={() => void service.loadFirst()}
          hasNextPage={service.hasMore}
          isFetchingNextPage={service.$model.loadMore.loading}
          fetchNextPage={() => void service.loadMore()}
          templateManifest={chain.templateManifest}
          ageLabelOf={(m) => {
            const birthdate = chain.payload?.birthdate;
            return typeof birthdate === 'string' ? babyAgeLabel(birthdate, m.happenedAt, m.happenedTzOffset) : '';
          }}
          entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
          onPersonFilter={(p) => service.togglePersonFilter(p)}
          onPlaceFilter={(place) => service.togglePlaceFilter(place)}
          empty={
            service.searching ? (
              <EmptyState
                variant="timeline"
                scope="section"
                title="没有找到相关时刻"
                description="换个说法，或关掉搜索回到时间线。"
                action={{ label: '退出搜索', emphasis: 'quiet', onPress: () => void service.exitSearch() }}
              />
            ) : service.filtered ? (
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
        </>
      ) : (
        <AggregateView
          view={service.activeView}
          aggregate={service.aggregate}
          moments={service.moments}
          chainPayload={chain.payload}
          hasMore={service.hasMore}
          isLoading={service.$model.loadAggregate.loading}
          error={service.$model.loadAggregate.error ? humanError(service.$model.loadAggregate.error) : null}
          onRetry={() => void service.loadAggregate().catch(() => undefined)}
          map={(props) => <MapView {...props} />}
        />
      )}
    </div>
  );
});

export const ChainHome = bindServices(ChainHomeContent, [ChainHomeService]);
