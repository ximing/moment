import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ComposeFab } from '@/compose/compose-fab';
import { ComposePanel } from '@/compose/compose-panel';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ChainListService } from '@/services/chain-list.service';
import { NotificationService } from '@/services/notification.service';
import { canCompose } from '@/lib/roles';
import { ChainMark } from '@/chain/ChainMark';
// 必须显式指向 barrel：src/ui/ 下遗留 Menu.tsx 会截获裸目录导入（见 ui/menu/index.ts）
import { ContextMenu, MenuItem } from '@/ui/menu/index';
import { CreateChainDialog } from './create-chain-dialog';
import { UserMenu } from './user-menu';

// 壳层视觉只消费 tokens.css 经 Tailwind 语义映射发布的 token（plan Task 9）：
// 侧栏 w-sidebar、导航项 rounded-menu-item / text-meta、悬停色面 floating-hover、
// 内容列 max-w-content；当前导航只用轻色面与字重（C 端总规范 §3.1），不画阴影。
// 顶栏断点沿用既有 min-[1400px] / min-[900px]。

export const Shell = observer(function Shell() {
  const composeSession = useService(ComposeSessionService);
  const navigate = useNavigate();
  const location = useLocation();
  const chainId = useMatch('/chains/:chainId')?.params.chainId;
  const [creating, setCreating] = useState(false);

  const chainList = useService(ChainListService);
  const notification = useService(NotificationService);
  const chains = chainList.chains;
  const unread = notification.unreadCount;
  const currentChain = chains.find((c) => c.id === chainId);
  const showCompose = currentChain ? canCompose(currentChain) : chains.some(canCompose);

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
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-sidebar flex-col border-r border-line bg-surface px-3 pt-6 min-[1400px]:flex">
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
            className="mt-2 rounded-menu-item px-2 py-1.5 text-left text-meta text-muted transition-colors duration-[var(--ease)] hover:bg-floating-hover hover:text-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset"
          >
            开一条新的链
          </button>
        </nav>
        <div className="shrink-0 border-t border-line py-4">
          <UserMenu unread={unread} />
        </div>
      </aside>

      <div className="min-[1400px]:pl-[var(--sidebar)] min-[1400px]:pr-[var(--rail)]">
        <header className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 py-3 backdrop-blur min-[1400px]:hidden">
          <Brand compact />
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLink to="/" end className={chipLink}>
              <span className="inline-block h-4 w-4 shrink-0 rounded-full bg-[conic-gradient(var(--dot-pink),var(--dot-blue),var(--dot-mint),var(--dot-pink))]" />
              大家的日子
            </NavLink>
            {(chains ?? []).map((c) => (
              <ChainNav key={c.id} chain={c} className={chipLink} />
            ))}
            <button
              type="button"
              aria-label="开一条新的链"
              onClick={() => setCreating(true)}
              className="shrink-0 rounded-full px-3 py-1 text-sm text-muted transition-colors duration-[var(--ease)] hover:bg-floating-hover hover:text-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset"
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
  // 右键 / Shift+F10 快捷入口由 ContextMenu 统一承载（Menu 规范 §7.4），
  // 命令与文案与链页可见入口一致（Menu 规范 §14/§16）
  return (
    <ContextMenu
      aria-label={`${chain.name} 的链操作`}
      onAction={(key) => {
        if (key === 'settings') navigate(`/chains/${chain.id}/settings`);
      }}
      items={
        <MenuItem id="settings" textValue="链设置">
          链设置
        </MenuItem>
      }
    >
      <NavLink to={`/chains/${chain.id}`} className={className}>
        <ChainMark chainId={chain.id} color={chain.color} icon={chain.icon} size={16} />
        <span className="truncate">{chain.name}</span>
      </NavLink>
    </ContextMenu>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <NavLink to="/" className={`font-display shrink-0 text-ink ${compact ? 'text-xl' : 'px-2 text-day-title'}`}>
      时<span className="text-action">刻</span>
    </NavLink>
  );
}

const NAV_FOCUS =
  'focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset';

function sideLink({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2 truncate rounded-menu-item px-2 py-1.5 text-meta transition-colors duration-[var(--ease)] ${NAV_FOCUS} ${
    isActive ? 'bg-floating-hover font-semibold text-ink' : 'text-muted hover:bg-floating-hover hover:text-ink'
  }`;
}

function chipLink({ isActive }: { isActive: boolean }) {
  return `inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-sm transition-colors duration-[var(--ease)] ${NAV_FOCUS} ${
    isActive ? 'bg-surface font-semibold text-ink' : 'text-muted hover:bg-floating-hover hover:text-ink'
  }`;
}
