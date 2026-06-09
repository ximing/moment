import { bindServices, observer, useService } from '@rabjs/react';
import { ComposerEntry } from '@/compose/composer-entry';
import { canCompose } from '@/lib/roles';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail } from '@/timeline/timeline-rail';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { Icon } from '@/ui/Icon';
import { FeedHomeService } from './feed-home.service';

const FeedHomeContent = observer(function FeedHomeContent() {
  const service = useService(FeedHomeService);
  const chainList = useService(ChainListService);
  const composeSession = useService(ComposeSessionService);
  const chains = chainList.chains;
  const looks = new Map(chains.map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }]));
  // 占位卡抑制：viewer（任何链都不可写）全程不见（spec §5）
  const entry = chains.some(canCompose) ? <ComposerEntry /> : undefined;
  const loading = service.$model.loadFirst.loading;
  const noChains = !loading && chains.length === 0;

  return (
    <div>
      <TimelineRail
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />
      {service.filter.before && (
        <div className="sticky top-2 z-10 mb-3">
          <button
            type="button"
            onClick={() => service.clearBefore()}
            className="inline-flex items-center gap-1 rounded-sticker bg-select px-3 py-1 text-sm text-select-fg"
          >
            <Icon icon={ArrowLeft} size={14} />
            回到今天
          </button>
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
            <Empty title="建第一条时光链，比如「宝宝成长」" hint="点「开一条新的链」就可以。" />
          ) : service.filtered ? (
            // 筛选/锚定筛空（web-product §4 空态表第三行）
            <Empty
              title="没有符合条件的时刻"
              action={
                <Button variant="ghost" onClick={() => service.clearFilters()}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <Empty
              title="还没有记下任何一刻"
              action={<Button onClick={() => composeSession.openCompose()}>记下此刻</Button>}
            />
          )
        }
      />
    </div>
  );
});

export const FeedHome = bindServices(FeedHomeContent, [FeedHomeService]);
