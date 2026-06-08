import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Icon } from '@/ui/Icon';
import { ChainSettingsSections } from './sections';
import { ChainSettingsService } from './chain-settings.service';

const ChainSettingsPageContent = observer(function ChainSettingsPageContent() {
  const { chainId = '' } = useParams();
  const service = useService(ChainSettingsService);

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
  return (
    <div className="max-w-content">
      <Link to={`/chains/${service.chain.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        {service.chain.name}
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-medium">这条链</h1>
      <ChainSettingsSections />
    </div>
  );
});

export const ChainSettingsPage = bindServices(ChainSettingsPageContent, [ChainSettingsService]);
