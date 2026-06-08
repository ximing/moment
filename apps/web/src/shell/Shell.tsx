import { useEffect, useState, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { ComposeFab } from '@/compose/compose-fab';
import { ComposePanel } from '@/compose/ComposePanel';
import { ComposeSessionService } from '@/services/compose-session.service';
import { canCompose } from '@/lib/roles';
import { ChainMark } from '@/chain/ChainMark';
import { ContextMenu, MenuItem } from '@/ui/Menu';
import { CreateChainDialog } from './create-chain-dialog';
import { UserMenu } from './user-menu';

export const Shell = observer(function Shell() {
  const composeSession = useService(ComposeSessionService);
  const navigate = useNavigate();
  const location = useLocation();
  const chainId = useMatch('/chains/:chainId')?.params.chainId;
  const [creating, setCreating] = useState(false);

  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const { data: notifications } = useQuery({
    queryKey: qk.notifications(false),
    queryFn: () => client.listNotifications(undefined, { limit: 50 }),
    refetchInterval: 30_000,
  });
  const unread = (notifications?.notifications ?? []).filter((n) => n.readAt === null).length;
  const currentChain = chains?.find((c) => c.id === chainId);
  const showCompose = currentChain ? canCompose(currentChain) : (chains ?? []).some(canCompose);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('compose') === '1') {
      composeSession.openCompose({ chainId });
      q.delete('compose');
      navigate({ pathname: location.pathname, search: q.toString() }, { replace: true });
    }
  }, [location.search, location.pathname, chainId, navigate, composeSession]);

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[var(--sidebar)] flex-col border-r border-[color:color-mix(in_srgb,var(--line)_70%,transparent)] bg-surface px-3 pt-6 min-[1400px]:flex">
        <Brand />
        <nav className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <NavLink to="/" end className={sideLink}>
            <span className="inline-block h-4 w-4 shrink-0 rounded-full bg-[conic-gradient(var(--dot-pink),var(--dot-blue),var(--dot-mint),var(--dot-pink))]" />
            大家的日子
          </NavLink>
          {(chains ?? []).map((c) => (
            <ChainNav key={c.id} chain={c} className={sideLink} />
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-2 rounded-xl px-2 py-1.5 text-left text-[13px] text-muted transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"
          >
            开一条新的链
          </button>
        </nav>
        <div className="shrink-0">
          <div className="-mx-3 border-t border-[color:color-mix(in_srgb,var(--line)_70%,transparent)]" />
          <div className="py-4">
            <UserMenu unread={unread} />
          </div>
        </div>
      </aside>

      <div className="min-[1400px]:pl-[var(--sidebar)] min-[1400px]:pr-[var(--rail)]">
        <header className="sticky top-0 z-20 flex items-center gap-2.5 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 py-3 backdrop-blur min-[1400px]:hidden">
          <Brand compact />
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLink to="/" end className={chipLink}>
              <span className="inline-block h-4 w-4 shrink-0 rounded-full bg-[conic-gradient(var(--dot-pink),var(--dot-blue),var(--dot-mint),var(--dot-pink))]" />
              大家的日子
            </NavLink>
            {(chains ?? []).map((c) => (
              <ChainNav key={c.id} chain={c} className={chipLink} />
            ))}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-sticker px-2.5 py-1 text-sm text-muted"
            >
              +
            </button>
          </div>
          <UserMenu unread={unread} compact />
        </header>
        <main className="mx-auto w-full max-w-content px-5 pb-32 pt-6 min-[900px]:px-8">
          <Outlet />
        </main>
      </div>

      <ComposePanel />
      {showCompose && <ComposeFab chainId={chainId} />}
      {creating && <CreateChainDialog onClose={() => setCreating(false)} />}
    </div>
  );
});

function ChainNav({
  chain,
  className,
}: {
  chain: ChainDto;
  className: (args: { isActive: boolean }) => string;
}) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  return (
    <>
      <NavLink to={`/chains/${chain.id}`} className={className} onContextMenu={onContextMenu}>
        <ChainMark chainId={chain.id} color={chain.color} icon={chain.icon} size={16} />
        <span className="truncate">{chain.name}</span>
      </NavLink>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
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
        </ContextMenu>
      )}
    </>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <NavLink to="/" className={`font-display shrink-0 text-ink ${compact ? 'text-xl' : 'px-2 text-[28px] leading-none'}`}>
      时<span className="text-action">刻</span>
    </NavLink>
  );
}

function sideLink({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2 truncate rounded-xl px-2 py-1.5 text-sm ${
    isActive ? 'font-semibold text-ink' : 'text-muted hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink'
  }`;
}

function chipLink({ isActive }: { isActive: boolean }) {
  return `inline-flex shrink-0 items-center gap-1.5 rounded-sticker px-2.5 py-1 text-sm ${
    isActive
      ? 'bg-surface font-semibold text-ink shadow-sticker'
      : 'text-muted hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink'
  }`;
}
