import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { MemoriesEntryContent } from './memories-entry';
import { MemoriesService } from './memories.service';

// 那年今日入口条 + 内嵌面板组件契约（spec memories-today §4）：
// - 空结果整条不渲染（不打扰）；有周年内容时入口条文案「{N} 年前的今天 · 共 {count} 条」；
// - 点击 toggle 交回 Service（打开重拉由 Service 保证，见 memories.service.test.ts）；
// - 展开面板按年份分组，分组头「{year} 年 · {n} 条」，卡片复用 MomentSheet。
//
// 与 timeline-variants.test.tsx 同一约定：@/api/client 全模块桩，全局容器注册 Service，
// 渲染前播种（jsdom 下 RAB Service 属性变更不触发 observer 重渲，展开态直接播种 open）。

const api = vi.hoisted(() => ({
  getMemoriesToday: vi.fn(),
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
register(ComposeSessionService);
register(MemoriesService);

function moment(id: string, content: string): MomentResponse {
  return {
    id,
    chainId: 'chain-1',
    author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
    type: 'text',
    content,
    happenedAt: '2025-08-19T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2025-08-19T02:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
}

/** 渲染前播种：构造器自启的 load 走 mock 落地后覆写终值。 */
async function seedMemories(input: { years: { year: number; moments: MomentResponse[] }[]; open?: boolean }) {
  const service = resolve(MemoriesService);
  await new Promise((r) => setTimeout(r, 0)); // 放掉构造器自启的 load
  service.years = input.years;
  service.today = '2026-08-19';
  service.open = input.open ?? false;
}

function renderEntry() {
  return render(
    <MemoryRouter>
      <RSRoot>
        <MemoriesEntryContent />
      </RSRoot>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  // matchMedia 钉死桌面：ResponsiveMenu 走锚定 Menu 分支
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
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getMemoriesToday.mockResolvedValue({ years: [] });
  resolve(AuthService).user = {
    id: 'user-1',
    email: 'man@moment.test',
    nickname: '林晓满',
    avatarColor: null,
    avatarIcon: null,
    avatarUrl: null,
    avatarExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  resolve(ComposeSessionService).request = null;
});

describe('那年今日入口条', () => {
  it('空结果整条不渲染', async () => {
    await seedMemories({ years: [] });
    const { container } = renderEntry();

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: /年前的今天/ })).toBeNull();
  });

  it('有周年内容时入口条文案为「{N} 年前的今天 · 共 {count} 条」，默认收起', async () => {
    await seedMemories({
      years: [
        { year: 2025, moments: [moment('a', '面包'), moment('b', '看海')] },
        { year: 2020, moments: [moment('c', '初雪')] },
      ],
    });
    renderEntry();

    const bar = screen.getByRole('button', { name: '1 年前的今天 · 共 3 条' });
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('初雪')).toBeNull(); // 面板未展开
  });

  it('展开面板按年份分组渲染，分组头「{year} 年 · {n} 条」，卡片复用 MomentSheet', async () => {
    await seedMemories({
      open: true,
      years: [
        { year: 2025, moments: [moment('a', '面包'), moment('b', '看海')] },
        { year: 2020, moments: [moment('c', '初雪')] },
      ],
    });
    renderEntry();

    expect(screen.getByRole('button', { name: '1 年前的今天 · 共 3 条' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('heading', { name: '2025 年 · 2 条' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2020 年 · 1 条' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('初雪')).toBeInTheDocument();
  });

  it('点击入口条交给 Service.toggle（打开并重拉）', async () => {
    const user = userEvent.setup();
    await seedMemories({ years: [{ year: 2025, moments: [moment('a', '面包')] }] });
    renderEntry();

    api.getMemoriesToday.mockClear();
    await user.click(screen.getByRole('button', { name: '1 年前的今天 · 共 1 条' }));

    const service = resolve(MemoriesService);
    expect(service.open).toBe(true);
    expect(api.getMemoriesToday).toHaveBeenCalledTimes(1); // 打开即重拉
  });
});
