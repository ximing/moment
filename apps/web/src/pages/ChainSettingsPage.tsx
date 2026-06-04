import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { ChainSettings } from '@/chain/ChainSettings';
import { Banner } from '@/ui/Banner';

export function ChainSettingsPage() {
  const { chainId = '' } = useParams();
  const { data: chain, isPending, isError, refetch } = useQuery({
    queryKey: qk.chain(chainId),
    queryFn: () => client.getChain(chainId),
    enabled: Boolean(chainId),
  });
  if (isPending) return <div className="h-32 animate-pulse rounded-paper bg-white/50" />;
  if (isError || !chain) {
    return <Banner action={{ label: '重试', onClick: () => void refetch() }}>看不到这条链，或它已经不在了</Banner>;
  }
  return (
    <div>
      <Link to={`/chains/${chain.id}`} className="text-sm text-muted hover:text-ink">
        ← {chain.name}
      </Link>
      <h1 className="mb-6 mt-2 font-display text-2xl">设置</h1>
      <ChainSettings chain={chain} />
    </div>
  );
}
