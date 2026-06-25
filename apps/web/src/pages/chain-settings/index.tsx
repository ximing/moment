import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Banner, SettingsSkeleton } from '@/ui/feedback/index';
import { ChainSettingsSections } from './sections';
import { ChainSettingsService } from './chain-settings.service';

// 链设置壳（plan Task 12）：三态判定与 hydrate 语义不变；加载走 SettingsSkeleton，
// 失败走结构化 Banner（重试 action），内容区分区组合在 sections.tsx。
// 具名导出是测试 seam（同 MomentPageContent 先例）：bindServices 的私有容器实例
// 在渲染前无法播种，测试在全局容器注册同名 Service 后直接渲染本组件。
export const ChainSettingsPageContent = observer(function ChainSettingsPageContent() {
  const { chainId = '' } = useParams();
  const service = useService(ChainSettingsService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  // 三态判定（防 hydrate effect 首帧闪错误态）：骨架 = 无 chain 且（加载中或无错）
  const chainErr = service.$model.loadChain.error;
  if (!service.chain && (service.$model.loadChain.loading || !chainErr)) {
    return (
      <div className="max-w-content">
        <SettingsSkeleton />
      </div>
    );
  }
  if (!service.chain) {
    return (
      <div className="max-w-content">
        <Banner
          tone="error"
          action={chainErr && !service.$model.loadChain.loading ? { label: '重试', onPress: () => void service.loadChain() } : undefined}
        >
          看不到这条链，或它已经不在了
        </Banner>
      </div>
    );
  }
  return (
    <div className="max-w-content">
      <Link to={`/chains/${service.chain.id}`} className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        {service.chain.name}
      </Link>
      <h1 className="mb-6 mt-2 text-page-title font-semibold text-ink">这条链</h1>
      <ChainSettingsSections />
    </div>
  );
});

export const ChainSettingsPage = bindServices(ChainSettingsPageContent, [ChainSettingsService]);
