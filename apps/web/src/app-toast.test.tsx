import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { UserProfile } from '@moment/dto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthService } from './services/auth.service';
import { ChainListService } from './services/chain-list.service';
import { ComposeSessionService } from './services/compose-session.service';
import { NotificationService } from './services/notification.service';
import { ThemeService } from './services/theme.service';

// App 级 Toast 契约（plan Task 8）：
// - 整个既有路由树外包恰好一个 ToastProvider；provider 内、路由之外恰好一个 ToastRegion；
// - 路由跳转后 region 数量恒 1；
// - 认证通配符渲染 NotFound（纯 EmptyState）；未认证通配符重定向 /login；
// - ComposeRedirect 精确保留：/chains/:chainId/compose → /chains/x?compose=1。
//
// 渲染真实 App 的最小桩：
// - @/api/client 全模块桩：client 任意方法返回永不 settle 的 Promise（页面停在加载态），
//   tokenStore / cachedUser / cacheUser 不触 localStorage；
// - matchMedia / IntersectionObserver 空实现（jsdom 缺失，ThemeService 与时间线需要）；
// - 全局 Service 与 main.tsx 同序注册（AuthService 排首），认证态经 resolve(AuthService).user 播种。

vi.mock('@/api/client', () => ({
  client: new Proxy(
    {},
    {
      get:
        () =>
        () =>
          new Promise(() => undefined),
    },
  ),
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
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
  email: 'lab@moment.test',
  nickname: '设计实验室',
  avatarColor: null,
  avatarIcon: null,
  avatarUrl: null,
  avatarExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  resolve(AuthService).user = null;
});

/** 测试探针：回显当前地址与重定向携带的 from，用于断言重定向目标。 */
function LocationProbe(): ReactElement {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}${from ? `|from=${from}` : ''}`}
    </output>
  );
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RSRoot>
        <App />
      </RSRoot>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const toastRegions = () =>
  screen.getAllByRole('region', { name: /通知|toast/i });

describe('App 全局 Toast 集成', () => {
  it('两个路由连续渲染并导航，ToastRegion 前后恒为 1', async () => {
    const user = userEvent.setup();
    const first = renderApp('/login');
    expect(toastRegions()).toHaveLength(1);

    // 经真实路由跳转 /login → /register，provider/region 不重建、不叠加
    await user.click(screen.getByRole('link', { name: '注册' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/register');
    expect(toastRegions()).toHaveLength(1);
    first.unmount();

    // 第二个可路由位置再次渲染，region 仍唯一
    const second = renderApp('/register');
    expect(toastRegions()).toHaveLength(1);
    second.unmount();
  });

  it('认证通配符渲染 NotFound（纯 EmptyState，无 Banner/Toast）', () => {
    resolve(AuthService).user = USER;
    renderApp('/no-such-page');

    expect(screen.getByText('没有这个页面')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(toastRegions()).toHaveLength(1);
  });

  it('未认证通配符重定向到 /login', () => {
    renderApp('/no-such-page');

    const probe = screen.getByTestId('location');
    expect(probe).toHaveTextContent('/login');
    expect(probe).toHaveTextContent('from=/no-such-page');
    expect(toastRegions()).toHaveLength(1);
  });

  it('ComposeRedirect 精确跳到 /chains/x?compose=1', () => {
    renderApp('/chains/x/compose');

    // 未登录：/chains/x?compose=1 随即被 RequireAuth 踢到 /login，
    // state.from 精确保留 ComposeRedirect 的目标地址
    const probe = screen.getByTestId('location');
    expect(probe).toHaveTextContent('/login');
    expect(probe).toHaveTextContent('from=/chains/x?compose=1');
  });
});
