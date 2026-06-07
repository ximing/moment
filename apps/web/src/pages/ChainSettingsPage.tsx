import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { ChainSettings } from '@/chain/ChainSettings';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Icon } from '@/ui/Icon';

export function ChainSettingsPage() {
  const { chainId = '' } = useParams();
  const { data: chain, isPending, isError, refetch } = useQuery({
    queryKey: qk.chain(chainId),
    queryFn: () => client.getChain(chainId),
    enabled: Boolean(chainId),
  });
  // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
  if (isPending) return <div className="h-32 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  if (isError || !chain) {
    return <Banner action={{ label: '重试', onClick: () => void refetch() }}>看不到这条链，或它已经不在了</Banner>;
  }
  return (
    <div className="max-w-content">
      <Link to={`/chains/${chain.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        {chain.name}
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-medium">这条链</h1>
      <ChainSettings chain={chain} />
    </div>
  );
}
