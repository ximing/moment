import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { AuthResponse, UserProfile } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { LoginPage } from './login/index';
import { RegisterPage } from './register/index';
import { InvitePage } from './invite/index';

// 入口流契约（plan Task 13）：
// - login/register 输入带原生 autocomplete 语义（email / current-password /
//   new-password），schema 校验失败给出具体字段错误（不是一条笼统横幅）；
// - 提交中 submit Button 进入 loading（aria-busy），成功后仍按既有 from 跳转；
// - invite 未登录重定向 /login 时保留 from（/invites/:token），已登录接受邀请后
//   仍导航到 /chains/:chainId。通配符与 compose 重定向归 Task 8，本文件不覆盖。
//
// 最小桩与 settings-account.test.tsx 同一约定：@/api/client 全模块桩（未列方法
// 永不 settle），全局 Service 与 main.tsx 同序注册，认证态经 resolve(AuthService)
// 播种；表单值经 fireEvent.change 写终值，断言目标是 service 调用与 DOM 结果。

const api = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  acceptInvite: vi.fn(),
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
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => window.dispatchEvent(new Event('moment:auth-cleared')),
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);

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

const AUTH: AuthResponse = {
  user: USER,
  tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 3600 },
};

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolvePromise = res;
    rejectPromise = rej;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/** 跳转目标探针：登录 / 注册 / 接受邀请成功后落点必须仍是既有路由。 */
function FromProbe() {
  const location = useLocation() as { state?: { from?: string } };
  return <div>登录页｜from:{location.state?.from ?? '无'}</div>;
}

function ChainProbe() {
  return <div>链首页</div>;
}

function HomeProbe() {
  return <div>首页</div>;
}

function renderLogin(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <RSRoot>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeProbe />} />
          <Route path="/chains/:chainId" element={<ChainProbe />} />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <RSRoot>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

function renderInvite(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/invites/${token}`]}>
      <RSRoot>
        <Routes>
          <Route path="/invites/:token" element={<InvitePage />} />
          <Route path="/login" element={<FromProbe />} />
          <Route path="/chains/:chainId" element={<ChainProbe />} />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resolve(AuthService).user = null;
});

describe('登录表单', () => {
  it('邮箱 / 密码输入带 autocomplete=email / current-password', () => {
    renderLogin(['/login']);

    const email = screen.getByLabelText('邮箱');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    const password = screen.getByLabelText('密码');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('空表单提交给出具体字段错误：邮箱与密码各自一条', async () => {
    const user = userEvent.setup();
    renderLogin(['/login']);

    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('请输入正确的邮箱地址')).toBeInTheDocument();
    expect(screen.getByText('请输入密码')).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('提交中按钮进入 loading（aria-busy），成功后仍按 from 跳转', async () => {
    const user = userEvent.setup();
    const pending = deferred<AuthResponse>();
    api.login.mockReturnValue(pending.promise);
    renderLogin([{ pathname: '/login', state: { from: '/chains/chain-7' } }]);

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'man@moment.test' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } });
    await user.click(screen.getByRole('button', { name: '登录' }));

    const submitting = await screen.findByRole('button', { name: '登录中…' });
    expect(submitting).toHaveAttribute('aria-busy', 'true');

    pending.resolve(AUTH);
    expect(await screen.findByText('链首页')).toBeInTheDocument();
  });
});

describe('注册表单', () => {
  it('邮箱与两个密码输入带 autocomplete=email / new-password', () => {
    renderRegister();

    expect(screen.getByLabelText('邮箱')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('再输一遍密码')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('非法输入给出具体字段错误：邮箱 / 名字 / 密码各一条', async () => {
    const user = userEvent.setup();
    renderRegister();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('再输一遍密码'), { target: { value: 'short' } });
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('请输入正确的邮箱地址')).toBeInTheDocument();
    expect(screen.getByText('请输入名字')).toBeInTheDocument();
    expect(screen.getByText('密码至少 8 位')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('两次密码不一致把错误钉在确认字段上', async () => {
    const user = userEvent.setup();
    renderRegister();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'man@moment.test' } });
    fireEvent.change(screen.getByLabelText('你的名字'), { target: { value: '林晓满' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText('再输一遍密码'), { target: { value: 'secret456' } });
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('两次密码不一致')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('提交中按钮进入 loading（aria-busy），成功后回首页', async () => {
    const user = userEvent.setup();
    const pending = deferred<AuthResponse>();
    api.register.mockReturnValue(pending.promise);
    renderRegister();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'man@moment.test' } });
    fireEvent.change(screen.getByLabelText('你的名字'), { target: { value: '林晓满' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText('再输一遍密码'), { target: { value: 'secret123' } });
    await user.click(screen.getByRole('button', { name: '注册' }));

    const submitting = await screen.findByRole('button', { name: '注册中…' });
    expect(submitting).toHaveAttribute('aria-busy', 'true');

    pending.resolve(AUTH);
    expect(await screen.findByText('首页')).toBeInTheDocument();
  });
});

describe('邀请入口', () => {
  it('未登录重定向 /login，from 保留为 /invites/:token', async () => {
    renderInvite('tok-1');

    expect(await screen.findByText('登录页｜from:/invites/tok-1')).toBeInTheDocument();
    expect(api.acceptInvite).not.toHaveBeenCalled();
  });

  it('已登录接受邀请后导航到 /chains/:chainId', async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    api.acceptInvite.mockResolvedValue({ chainId: 'chain-9' });
    renderInvite('tok-9');

    await user.click(await screen.findByRole('button', { name: '接受邀请' }));
    await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledWith('tok-9'));
    expect(await screen.findByText('链首页')).toBeInTheDocument();
  });
});
