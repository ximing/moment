import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ToastProvider } from '@/ui/feedback/index';
import { ChainNavList } from './chain-nav-list';

// ChainNavList 拖拽视觉契约（已批准方案：ghost + FLIP 让位）：
// - 拖拽激活后出现 portal 到 body 的 ghost 浮动副本（aria-hidden、pointer-events-none、
//   内容与被拖项一致），原位项保留作半透明占位（opacity-50）；
// - 松手清 ghost 并按目标下标提交 reorder（提交逻辑与手势机语义不变）；
// - pointercancel 清 ghost、不提交。
// jsdom 无 PointerEvent 构造器与布局（getBoundingClientRect 全 0）：用 MouseEvent 携带
// pointerId/isPrimary/pointerType 合成指针事件；全 0 中点下指针越过即落到末尾槽位。
// 最小桩与 shell-navigation.test.tsx 同一约定：@/api/client 全模块桩，全局 Service
// 与 main.tsx 同序注册，chains 直接播种。

const api = vi.hoisted(() => ({
  listChains: vi.fn(),
  reorderChains: vi.fn(),
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
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

// 链头像的认证 blob 通道：同步回 blob:mock-<id>（与 timeline-variants.test.tsx 同一约定）。
vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

register(AuthService);
register(ChainListService);

function makeChain(id: string, name: string): ChainDto {
  return {
    id,
    name,
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
}

const CHAINS = [makeChain('c1', '链一'), makeChain('c2', '链二'), makeChain('c3', '链三')];

beforeEach(() => {
  vi.clearAllMocks();
  api.listChains.mockResolvedValue(CHAINS);
  api.reorderChains.mockResolvedValue(undefined);
  resolve(ChainListService).chains = CHAINS;
});

function renderList(axis: 'x' | 'y' = 'y') {
  return render(
    <MemoryRouter>
      <RSRoot>
        <ToastProvider>
          <ChainNavList chains={CHAINS} axis={axis} itemClassName={() => 'item'} />
        </ToastProvider>
      </RSRoot>
    </MemoryRouter>,
  );
}

/** 合成主指针事件：jsdom 无 PointerEvent，用 MouseEvent 带坐标再补指针字段。 */
function pointer(type: string, init: { clientX: number; clientY: number }): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: 'mouse' },
  });
  return event;
}

const GHOST_SELECTOR = '[aria-hidden="true"].pointer-events-none.fixed';

describe('ChainNavList 拖拽 ghost 与提交', () => {
  it('激活后出现跟手 ghost 与原位半透明占位，松手清 ghost 并提交新顺序', async () => {
    renderList();
    const link = screen.getByRole('link', { name: /链一/ });

    fireEvent(link, pointer('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(link, pointer('pointermove', { clientX: 10, clientY: 100 }));

    // ghost：portal 到 body 的浮动副本，内容与被拖项一致
    const ghost = document.body.querySelector(GHOST_SELECTOR);
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveTextContent('链一');
    // 原位项保留作半透明占位
    expect(link.className).toContain('opacity-50');

    fireEvent(link, pointer('pointerup', { clientX: 10, clientY: 100 }));

    expect(document.body.querySelector(GHOST_SELECTOR)).toBeNull();
    // jsdom 全 0 中点：指针越过所有项 → 链一落到末尾槽位
    await waitFor(() =>
      expect(api.reorderChains).toHaveBeenCalledWith({ chainIds: ['c2', 'c3', 'c1'] }),
    );
  });

  it('pointercancel 中止：清 ghost、还原视觉顺序、不提交', () => {
    renderList();
    const link = screen.getByRole('link', { name: /链一/ });

    fireEvent(link, pointer('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(link, pointer('pointermove', { clientX: 10, clientY: 100 }));
    expect(document.body.querySelector(GHOST_SELECTOR)).not.toBeNull();

    fireEvent(link, pointer('pointercancel', { clientX: 10, clientY: 100 }));

    expect(document.body.querySelector(GHOST_SELECTOR)).toBeNull();
    expect(link.className).not.toContain('opacity-50');
    expect(api.reorderChains).not.toHaveBeenCalled();
  });

  it('普通点击不建 ghost、不触发提交', () => {
    renderList();
    const link = screen.getByRole('link', { name: /链二/ });

    fireEvent(link, pointer('pointerdown', { clientX: 10, clientY: 10 }));
    fireEvent(link, pointer('pointerup', { clientX: 10, clientY: 10 }));

    expect(document.body.querySelector(GHOST_SELECTOR)).toBeNull();
    expect(api.reorderChains).not.toHaveBeenCalled();
  });

  it('导航项只渲染链头像（blob 通道 + 焦点），不渲染封面', () => {
    const withAvatar: ChainDto = {
      ...makeChain('c1', '链一'),
      avatarMediaId: 'm-avatar-1',
      avatarUrl: '/api/media/m-avatar-1',
      avatarFocus: { x: 0.25, y: 0.75 },
      coverMediaId: 'm-cover-1',
      coverUrl: '/api/media/m-cover-1',
      coverFocus: { x: 0.5, y: 0.5 },
    };
    const { container } = render(
      <MemoryRouter>
        <RSRoot>
          <ToastProvider>
            <ChainNavList chains={[withAvatar]} axis="y" itemClassName={() => 'item'} />
          </ToastProvider>
        </RSRoot>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /链一/ });
    const img = link.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-m-avatar-1');
    expect(img).toHaveStyle({ objectPosition: '25% 75%' });
    // 封面不进导航：整个导航只有头像这一张图
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });
});
