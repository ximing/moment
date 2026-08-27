import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { ChainDto, UserProfile } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeFab } from '@/compose/compose-fab';
import { ComposerEntry } from '@/compose/composer-entry';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { NotificationService } from '@/services/notification.service';
import { ThemeService } from '@/services/theme.service';
import { ToastProvider } from '@/ui/feedback/index';
import { Shell } from './Shell';
import { UserMenu } from './user-menu';

// Shell / 导航 / composer 入口契约（plan Task 9）：
// - 认证导航目的地：汇总入口 → /，链入口 → /chains/:chainId，右键「链设置」→ 链设置页；
// - 头像菜单动作：「我的资料」→ /me（主题三态入口所在页，C 端总规范 §10.2）、
//   「通知」→ /notifications 并携带未读计数、「退出登录」走 AuthService.logout
//   既有 service 路径（tokenStore.clear → moment:auth-cleared）后跳 /login；
// - create-chain：canSubmit 保存闸（chain-appearance §7.1）——名字为空或外观未就绪
//   时「创建」禁用、不调用 service；合法提交走既有
//   CreateChainDialogService.submit → client.createChain 并跳转新链；
// - composer entry / FAB 把 chainId 经 openCompose 交接给 ComposeSessionService。
//
// 最小桩与 app-toast.test.tsx 同一约定：@/api/client 全模块桩（未列方法永不
// settle），全局 Service 与 main.tsx 同序注册，认证态经 resolve(AuthService)
// 直接播种（不发 auth:changed，避免触发真实加载）。matchMedia 钉死桌面
// （≥768px），ResponsiveMenu 走锚定 Menu 分支。

const api = vi.hoisted(() => ({
  listChains: vi.fn(),
  listNotifications: vi.fn(),
  createChain: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  client: new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        (api as Record<string, unknown>)[prop] ?? (() => new Promise(() => undefined)),
    },
  ),
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve('rt-test'),
    setTokens: () => undefined,
    clear: () => window.dispatchEvent(new Event('moment:auth-cleared')),
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ThemeService);
register(ComposeSessionService);
register(ChainListService);
register(NotificationService);

const USER: UserProfile = {
  id: 'user-1',
  email: 'man@moment.test',
  nickname: '林晓满',
  avatarColor: null,
  avatarIcon: null,
  avatarUrl: null,
  avatarExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CHAIN: ChainDto = {
  id: 'chain-1',
  name: '宝宝成长',
  description: null,
  avatarMediaId: null,
  avatarUrl: null,
  avatarFocus: null,
  coverMediaId: null,
  coverUrl: null,
  coverFocus: null,
  color: 'coral',
  icon: null,
  visibility: 'private',
  template: 'daily',
  payload: null,
  ownerId: 'user-1',
  myRole: 'owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  membersPreview: [],
  memberCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listChains.mockResolvedValue([CHAIN]);
  api.listNotifications.mockResolvedValue({ notifications: [], nextCursor: null });
  api.logout.mockResolvedValue(undefined);
  // ResponsiveMenu 分支固定为桌面锚定 Menu；其它媒体查询一律 false
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  resolve(AuthService).user = USER;
  resolve(ChainListService).chains = [CHAIN];
  resolve(ComposeSessionService).request = null;
  resolve(ComposeSessionService).lastCreatedId = null;
});

/** 测试探针：回显当前地址，用于断言导航目的地（与 app-toast.test.tsx 同手法）。 */
function Probe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function shellTree(initialPath: string): ReactElement {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <RSRoot>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Probe />} />
            <Route element={<Shell />}>
              <Route path="/" element={<Probe />} />
              <Route path="/chains/:chainId" element={<Probe />} />
              <Route path="/chains/:chainId/settings" element={<Probe />} />
              <Route path="/me" element={<Probe />} />
              <Route path="/notifications" element={<Probe />} />
            </Route>
          </Routes>
        </ToastProvider>
      </RSRoot>
    </MemoryRouter>
  );
}

function renderShell(initialPath: string) {
  return render(shellTree(initialPath));
}

/** 独立渲染 Shell 子组件（头像菜单 / composer 入口），同时挂地址探针。 */
function renderWithProviders(node: ReactElement, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RSRoot>
        {node}
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

describe('Shell 认证导航', () => {
  it('汇总入口指向 /，链入口指向 /chains/:chainId 并可点击到达', async () => {
    const user = userEvent.setup();
    renderShell('/');

    const feedLinks = screen.getAllByRole('link', { name: /大家的日子/ });
    expect(feedLinks.length).toBeGreaterThan(0);
    for (const link of feedLinks) expect(link).toHaveAttribute('href', '/');

    const chainLinks = screen.getAllByRole('link', { name: /宝宝成长/ });
    expect(chainLinks.length).toBeGreaterThan(0);
    for (const link of chainLinks) expect(link).toHaveAttribute('href', '/chains/chain-1');

    await user.click(chainLinks[0]);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/chains/chain-1'),
    );
  });

  it('链导航右键提供「链设置」命令并跳转到链设置页', async () => {
    const user = userEvent.setup();
    renderShell('/');

    fireEvent.contextMenu(screen.getAllByRole('link', { name: /宝宝成长/ })[0]);
    await user.click(await screen.findByRole('menuitem', { name: '链设置' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/chains/chain-1/settings'),
    );
  });
});

describe('头像菜单动作（退出 / 主题入口）', () => {
  it('「我的资料」导航到 /me（主题三态入口所在页）', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu unread={0} />);

    await user.click(screen.getByRole('button', { name: /林晓满/ }));
    await user.click(await screen.findByRole('menuitem', { name: '我的资料' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/me'),
    );
  });

  it('「通知」携带未读计数并导航到 /notifications', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu unread={3} />);

    await user.click(screen.getByRole('button', { name: /林晓满/ }));
    const item = await screen.findByRole('menuitem', { name: /通知/ });
    expect(item).toHaveTextContent('3');
    await user.click(item);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/notifications'),
    );
  });

  it('「退出登录」走 AuthService.logout 既有路径并跳转 /login', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu unread={0} />);

    await user.click(screen.getByRole('button', { name: /林晓满/ }));
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/login'),
    );
    // logout 单路径：refresh token 交给既有 client.logout，tokenStore.clear
    // 派发 moment:auth-cleared 收敛内存态（Toast 清空由 Task 7 的监听承担）
    expect(api.logout).toHaveBeenCalledWith('rt-test');
    expect(resolve(AuthService).user).toBeNull();
  });
});

describe('开一条新的链', () => {
  it('空名字时「创建」被 canSubmit 门闸禁用，不调用 createChain', async () => {
    const user = userEvent.setup();
    renderShell('/');

    await user.click(screen.getAllByRole('button', { name: '开一条新的链' })[0]);
    const dialog = await screen.findByRole('dialog', { name: '开一条新的链' });

    // 门闸语义（chain-appearance §7.1）：名字为空不可提交，点击路径被按钮禁用直接封死
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeDisabled();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(api.createChain).not.toHaveBeenCalled();
  });

  it('合法提交解除门闸，走既有 service 调用并跳转到新链', async () => {
    const user = userEvent.setup();
    api.createChain.mockResolvedValue({ id: 'chain-new' });
    const view = renderShell('/');

    await user.click(screen.getAllByRole('button', { name: '开一条新的链' })[0]);
    const dialog = await screen.findByRole('dialog', { name: '开一条新的链' });
    // 测试环境 RAB observer 不触发重渲（app-toast.test.tsx 因此也直接播种
    // service 状态）：逐键 type 会被受控恢复吞掉，用单次 change 写入最终值；
    // submit 读的是 service.name，与真实交互同一路径
    fireEvent.change(within(dialog).getByRole('textbox', { name: /名字/ }), {
      target: { value: '周末小家' },
    });
    // jsdom 下 observer 不重渲：手动 rerender 让渲染时读取的 canSubmit 门闸看到新名字
    // （真实浏览器里 observer 会随 service.name 写入自动重渲，无需这一手）
    view.rerender(shellTree('/'));
    const submit = within(screen.getByRole('dialog', { name: '开一条新的链' })).getByRole('button', { name: '创建' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(api.createChain).toHaveBeenCalledWith({
        name: '周末小家',
        template: 'daily',
        visibility: 'private',
        description: undefined,
        color: 'coral',
        icon: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/chains/chain-new'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('composer 入口 compose-session 交接', () => {
  it('ComposerEntry 打开会话并携带 chainId', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ComposerEntry chainId="chain-9" />);

    await user.click(screen.getByRole('button', { name: /这一刻，记点什么/ }));
    expect(resolve(ComposeSessionService).request).toEqual({ chainId: 'chain-9' });
  });

  it('ComposeFab 滚动接力后出现，点击把 chainId 交接给 compose-session', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ComposeFab chainId="chain-1" />);

    expect(screen.queryByRole('button', { name: '记下此刻' })).toBeNull();
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true, writable: true });
    fireEvent.scroll(window);

    const fab = await screen.findByRole('button', { name: '记下此刻' });
    await user.click(fab);
    expect(resolve(ComposeSessionService).request).toEqual({ chainId: 'chain-1' });
  });
});
