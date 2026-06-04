import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { useCompose } from '@/compose/ComposeContext';
import { ComposePanel } from '@/compose/ComposePanel';
import { canCompose } from '@/lib/roles';
import { Button } from '@/ui/Button';
import { CreateChainDialog } from './CreateChainDialog';

export function Shell() {
  const { user, logout } = useAuth();
  const { openCompose } = useCompose();
  const navigate = useNavigate();
  const location = useLocation();
  const { chainId } = useParams<{ chainId: string }>();
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
      openCompose({ chainId });
      q.delete('compose');
      navigate({ pathname: location.pathname, search: q.toString() }, { replace: true });
    }
  }, [location.search, location.pathname, chainId, navigate, openCompose]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-paper/80 px-3 py-5">
        <NavLink to="/" className="font-display px-2 text-xl text-ink">
          时刻
        </NavLink>
        <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto">
          <NavLink to="/" end className={sideLink}>
            我的时间线
          </NavLink>
          <p className="mt-4 px-2 text-[11px] tracking-wide text-muted">链</p>
          {(chains ?? []).map((c) => (
            <NavLink key={c.id} to={`/chains/${c.id}`} className={sideLink}>
              {c.name}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-1 px-2 text-left text-sm text-muted hover:text-ink"
          >
            + 新的链
          </button>
        </nav>
        <div className="mt-auto space-y-1 border-t border-line pt-3">
          <NavLink to="/notifications" className={sideLink}>
            通知
            {unread > 0 && <span className="ml-auto text-xs text-accent">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <NavLink to="/me" className={sideLink}>
            {user?.nickname ?? '我'}
          </NavLink>
          <button
            type="button"
            className="w-full px-2 py-1.5 text-left text-sm text-muted hover:text-ink"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            退出
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-end border-b border-line bg-paper/90 px-6 py-3 backdrop-blur-sm">
          {showCompose && (
            <Button onClick={() => openCompose({ chainId })}>记下此刻</Button>
          )}
        </header>
        <main className="mx-auto w-full max-w-content flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>

      <ComposePanel />
      {creating && <CreateChainDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function sideLink({ isActive }: { isActive: boolean }) {
  return `flex items-center rounded-paper px-2 py-1.5 text-sm ${
    isActive ? 'bg-accent text-accent-fg' : 'text-ink hover:bg-white/50'
  }`;
}
