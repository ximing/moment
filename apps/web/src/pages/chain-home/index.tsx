import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ComposerEntry } from '@/compose/composer-entry';
import { ComposeSessionService } from '@/services/compose-session.service';
import { canCompose } from '@/lib/roles';
import { Timeline } from '@/timeline/timeline';
import { TimelineRail } from '@/timeline/timeline-rail';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { Icon } from '@/ui/Icon';
import { KebabButton, Menu, MenuItem } from '@/ui/Menu';
import { ChainHomeService } from './chain-home.service';

const ChainHomeContent = observer(function ChainHomeContent() {
  const { chainId = '' } = useParams();
  const navigate = useNavigate();
  const service = useService(ChainHomeService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同 Task 3）：骨架 = 无 chain 且（加载中或无错）
  const chainErr = service.$model.loadChain.error;
  if (!service.chain && (service.$model.loadChain.loading || !chainErr)) {
    // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
    return <div className="h-32 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  }
  if (!service.chain) {
    return (
      <Banner action={chainErr && !service.$model.loadChain.loading ? { label: '重试', onClick: () => void service.loadChain() } : undefined}>
        看不到这条链，或它已经不在了
      </Banner>
    );
  }
  const chain = service.chain;

  return (
    <div>
      <TimelineRail
        fixedChainId={chain.id}
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />
      <header className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-medium">{chain.name}</h1>
            {chain.description && <p className="mt-1 text-sm text-muted">{chain.description}</p>}
          </div>
          <Menu trigger={<KebabButton label="设置" />}>
            {(close) => (
              <MenuItem
                onClick={() => {
                  close();
                  navigate(`/chains/${chain.id}/settings`);
                }}
              >
                设置
              </MenuItem>
            )}
          </Menu>
        </header>

        {/* 锚定态「回到今天」：时间线顶部固定一枚（spec §4.3），清 before 回第一页 */}
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
              <Empty title="没有符合条件的时刻" action={<Button variant="ghost" onClick={() => service.clearFilters()}>清除筛选</Button>} />
            ) : (
              <Empty
                title="还没有记下任何一刻"
                action={canCompose(chain) ? <Button onClick={() => composeSession.openCompose({ chainId: chain.id })}>记下此刻</Button> : undefined}
              />
            )
          }
        />
    </div>
  );
});

export const ChainHome = bindServices(ChainHomeContent, [ChainHomeService]);
