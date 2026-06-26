import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { ChainDto, MomentMedia, MomentResponse, UserProfile } from '@moment/dto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposePanel } from '@/compose/compose-panel';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { NotificationService } from '@/services/notification.service';
import { ThemeService } from '@/services/theme.service';
import { monthBeforeParam } from '@/lib/time';
import { MomentSheetContent } from '@/timeline/moment-sheet';
import { MomentSheetService } from '@/timeline/moment-sheet.service';
import { ChainHomeContent } from './index';
import { ChainHomeService } from './chain-home.service';

// 链主页 / 时间线 / 发布面板契约（plan Task 10）：
// - 纯文字时刻（media: []）不出现媒体容器；Tag 与正文是同一 text-flow 元素；
// - 单图时刻把声明了宽高（64×48）的媒体原样交给 MediaBlock，点开进入灯箱 index 0；
// - 单链变体的时刻元信息里没有链来源链接；
// - 回应入口文案为「N 条回应」（含 0），自己的时刻 kebab 打开 ResponsiveMenu，
//   表情触发器打开 ReactionPopover；
// - 时间索引按年分组：历史年份折叠为一行，点击只展开该年；
// - 有草稿的 ComposePanel 关闭（取消 / Escape）先弹 AlertDialog「继续记录 / 放弃记录」。
//
// 最小桩与 shell-navigation.test.tsx / app-toast.test.tsx 同一约定：@/api/client
// 全模块桩（未列方法永不 settle），全局 Service 与 main.tsx 同序注册，认证态经
// resolve(AuthService) 直接播种。jsdom 下 RAB Service 属性变更不触发 observer
// 重渲：ChainHomeService / ComposeSessionService 在渲染前播种（hydrate 幂等守卫
// 命中后不再发请求），草稿经 fireEvent.change 单次写终值，断言目标是 service
// 调用与 DOM 结果。
//
// MediaBlock 的内部几何（声明宽高比渲染、网格分支）归 Task 11 的
// MediaBlock.test.tsx；这里用模块桩只验证交接契约：media 数据原样到达、
// onOpen(index) 回传点击序号。IntersectionObserver / matchMedia 是 jsdom 缺口。

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
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

// MediaBlock 桩：记录每次交接的 props，并把每个媒体渲染成可点击的探针。
const mediaBlockCalls = vi.hoisted(() => ({
  list: [] as { media: MomentMedia[]; onOpen?: (index: number) => void }[],
}));

vi.mock('@/media/MediaBlock', () => ({
  MediaBlock(props: { media: MomentMedia[]; onOpen?: (index: number) => void }) {
    mediaBlockCalls.list.push(props);
    return (
      <div data-testid="media-block">
        {props.media.map((m, i) => (
          <button key={m.id} type="button" data-testid={`media-open-${i}`} onClick={() => props.onOpen?.(i)}>
            {m.mime}
          </button>
        ))}
      </div>
    );
  },
}));

register(AuthService);
register(ThemeService);
register(ComposeSessionService);
register(ChainListService);
register(NotificationService);
register(ChainHomeService);
register(MomentSheetService);

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
  name: '周末小家',
  description: '一起记录平凡日子',
  coverMediaId: null,
  color: 'coral',
  icon: null,
  visibility: 'private',
  ownerId: 'user-1',
  myRole: 'owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  membersPreview: [
    { userId: 'user-1', nickname: '林晓满', avatarUrl: null, role: 'owner' },
    { userId: 'user-2', nickname: '乔乔', avatarUrl: null, role: 'editor' },
  ],
  memberCount: 2,
};

const TEXT_MOMENT: MomentResponse = {
  id: 'moment-text',
  chainId: 'chain-1',
  author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
  type: 'text',
  content: '回家的路上买了刚出炉的面包。',
  happenedAt: '2026-08-17T14:00:00.000Z',
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: '2026-08-17T14:00:00.000Z',
  media: [],
  tags: [
    { id: 'tag-1', name: '日常' },
    { id: 'tag-2', name: '晚餐' },
  ],
  commentCount: 1,
  reactions: [],
  myReaction: null,
};

const IMAGE_MOMENT: MomentResponse = {
  id: 'moment-image',
  chainId: 'chain-1',
  author: { id: 'user-2', nickname: '乔乔', avatarUrl: null },
  type: 'media',
  content: '周末去看了海',
  happenedAt: '2026-08-16T14:01:00.000Z',
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: '2026-08-16T14:01:00.000Z',
  media: [
    { id: 'media-1', url: '/api/media/media-1', mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0 },
  ],
  tags: [],
  commentCount: 0,
  reactions: [],
  myReaction: null,
};

const MONTH_INDEX = [
  { month: '2026-08', count: 2 },
  { month: '2026-07', count: 18 },
  { month: '2026-06', count: 7 },
  { month: '2025-12', count: 6 },
  { month: '2025-11', count: 3 },
  { month: '2024-05', count: 1 },
];

/** 渲染前播种 ChainHomeService：chainId 与路由一致时 hydrate 幂等返回，不发请求。 */
function seedChainHome(moments: MomentResponse[]) {
  const service = resolve(ChainHomeService);
  service.chainId = 'chain-1';
  service.chain = CHAIN;
  service.moments = moments;
  service.nextCursor = null;
  service.monthIndex = MONTH_INDEX;
  service.indexPending = false;
  service.tags = [
    { id: 'tag-1', name: '日常', momentCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'tag-2', name: '晚餐', momentCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  // before 锚定 2026-08：「当前查看年份」展开规则不依赖真实当前年份，跨年分组可确定性断言
  service.filter = { order: 'happened_at', chainIds: ['chain-1'], before: monthBeforeParam('2026-08') };
}

function renderChainHome() {
  return render(
    <MemoryRouter initialEntries={['/chains/chain-1']}>
      <RSRoot>
        <Routes>
          <Route path="/chains/:chainId" element={<ChainHomeContent />} />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  // matchMedia 钉死桌面（≥768px）：ResponsiveMenu 走锚定 Menu 分支，其余查询一律 false
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
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  mediaBlockCalls.list.length = 0;
  api.listTags.mockResolvedValue({ tags: [] });
  resolve(AuthService).user = USER;
  resolve(ChainListService).chains = [CHAIN];
  resolve(ComposeSessionService).request = null;
  resolve(ComposeSessionService).lastCreatedId = null;
  const sheet = resolve(MomentSheetService);
  sheet.lightboxIndex = null;
  sheet.showComments = false;
  sheet.confirmDel = false;
});

describe('链主页时间线', () => {
  it('纯文字时刻（media: []）不渲染媒体容器，Tag 与正文是同一 text-flow 元素', () => {
    seedChainHome([TEXT_MOMENT]);
    renderChainHome();

    expect(screen.queryByTestId('media-block')).toBeNull();
    expect(mediaBlockCalls.list).toHaveLength(0);

    // Tag 在正文前、同一文字流：正文段落本身携带两枚 #Tag（spec §6.2）
    const body = screen.getByText('回家的路上买了刚出炉的面包。');
    expect(body.tagName).toBe('P');
    expect(within(body).getByText('#日常')).toBeInTheDocument();
    expect(within(body).getByText('#晚餐')).toBeInTheDocument();
  });

  it('单链变体的时刻元信息没有链来源链接', () => {
    seedChainHome([TEXT_MOMENT, IMAGE_MOMENT]);
    renderChainHome();

    for (const article of screen.getAllByRole('article')) {
      expect(within(article).queryByRole('link')).toBeNull();
      expect(within(article).queryByText('周末小家')).toBeNull();
    }
    // 链名只出现在页眉
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('回应入口文案为「N 条回应」，0 条也显示', () => {
    seedChainHome([TEXT_MOMENT, IMAGE_MOMENT]);
    renderChainHome();

    const [textArticle, imageArticle] = screen.getAllByRole('article');
    expect(within(textArticle!).getByRole('button', { name: '1 条回应' })).toBeInTheDocument();
    expect(within(imageArticle!).getByRole('button', { name: '0 条回应' })).toBeInTheDocument();
  });

  it('自己时刻的 kebab 打开 ResponsiveMenu（编辑 / 删除），他人时刻没有 kebab', async () => {
    const user = userEvent.setup();
    seedChainHome([TEXT_MOMENT, IMAGE_MOMENT]);
    renderChainHome();

    const [textArticle, imageArticle] = screen.getAllByRole('article');
    expect(within(imageArticle!).queryByRole('button', { name: '更多操作' })).toBeNull();

    await user.click(within(textArticle!).getByRole('button', { name: '更多操作' }));
    expect(await screen.findByRole('menuitem', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument();
  });

  it('表情触发器打开 ReactionPopover', async () => {
    const user = userEvent.setup();
    seedChainHome([TEXT_MOMENT]);
    renderChainHome();

    await user.click(screen.getByRole('button', { name: '加个表情' }));
    expect(await screen.findByRole('grid', { name: '选择表情' })).toBeInTheDocument();
  });

  it('时间索引按年分组：历史年份折叠为一行，点击只展开该年', async () => {
    const user = userEvent.setup();
    seedChainHome([TEXT_MOMENT]);
    renderChainHome();

    const rail = screen.getByRole('complementary');
    // 当前查看年份（锚定 2026-08）展开月份
    expect(within(rail).getByText('2026')).toBeInTheDocument();
    expect(within(rail).getByText('8月')).toBeInTheDocument();
    expect(within(rail).getByText('7月')).toBeInTheDocument();
    // 历史年份折叠为一行
    expect(within(rail).getByRole('button', { name: /2025/ })).toBeInTheDocument();
    expect(within(rail).queryByText('12月')).toBeNull();

    await user.click(within(rail).getByRole('button', { name: /2025/ }));
    expect(within(rail).getByText('12月')).toBeInTheDocument();
    // 一次只展开一个历史年份
    expect(within(rail).queryByText('5月')).toBeNull();
  });
});

describe('单图时刻媒体交接', () => {
  it('声明宽高的媒体原样交给 MediaBlock，点开进入灯箱 index 0', async () => {
    const user = userEvent.setup();
    // 经 MomentSheetContent seam 渲染：全局注册的 MomentSheetService 即组件所用实例，
    // 可直接断言 service 状态（bindServices 的私有容器实例在渲染前无法播种）
    render(
      <MemoryRouter>
        <RSRoot>
          <MomentSheetContent moment={IMAGE_MOMENT} />
        </RSRoot>
      </MemoryRouter>,
    );

    const handoff = mediaBlockCalls.list.at(-1);
    expect(handoff?.media).toHaveLength(1);
    expect(handoff?.media[0]).toMatchObject({ width: 64, height: 48 });

    await user.click(screen.getByTestId('media-open-0'));
    expect(resolve(MomentSheetService).lightboxIndex).toBe(0);
  });
});

describe('发布面板草稿保护', () => {
  function renderCompose() {
    resolve(ComposeSessionService).request = { chainId: 'chain-1' };
    return render(
      <RSRoot>
        <ComposePanel />
      </RSRoot>,
    );
  }

  function writeDraft() {
    // 单次 change 写终值：RAB 受控恢复会吞掉逐键 type（见文件头约定）
    fireEvent.change(screen.getByRole('textbox', { name: '这一刻' }), {
      target: { value: '今天吃了蛋糕' },
    });
  }

  it('有草稿时点「取消」先弹 AlertDialog，「放弃记录」才关闭会话', async () => {
    const user = userEvent.setup();
    renderCompose();
    writeDraft();

    await user.click(screen.getByRole('button', { name: '取消' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: '继续记录' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '放弃记录' })).toBeInTheDocument();
    expect(resolve(ComposeSessionService).request).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: '放弃记录' }));
    expect(resolve(ComposeSessionService).request).toBeNull();
  });

  it('有草稿时 Escape 同样先弹 AlertDialog，「继续记录」保留草稿', async () => {
    const user = userEvent.setup();
    renderCompose();
    writeDraft();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const dialog = await screen.findByRole('alertdialog');

    await user.click(within(dialog).getByRole('button', { name: '继续记录' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(resolve(ComposeSessionService).request).not.toBeNull();
  });

  it('无草稿时直接关闭，不弹 AlertDialog', async () => {
    const user = userEvent.setup();
    renderCompose();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(resolve(ComposeSessionService).request).toBeNull();
  });
});
