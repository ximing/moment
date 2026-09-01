import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { ChainDetailDto, MomentMedia, MomentResponse, UserProfile } from '@moment/dto';
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
// - commentCount===0 不显示「0 回应」；有回应时纸边是「N 回应」详情链接；
//   自己的时刻 kebab 打开 ResponsiveMenu；网格无表情入口；
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
  uploadMedia: vi.fn(),
  createMoment: vi.fn(),
}));

const mediaLib = vi.hoisted(() => ({
  probeVideo: vi.fn(),
}));

vi.mock('@/lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media')>()),
  probeVideo: mediaLib.probeVideo,
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

// 链头像/封面的认证 blob 通道：同步回 blob:mock-<id>（与 timeline-variants.test.tsx 同一约定）。
vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
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

const CHAIN: ChainDetailDto = {
  id: 'chain-1',
  name: '周末小家',
  description: '一起记录平凡日子',
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
  templateManifest: { version: 1 },
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

/** 带封面的链：服务端 ready 门闸保证 mediaId/URL/focus 三元组同非空。 */
const COVERED_CHAIN: ChainDetailDto = {
  ...CHAIN,
  coverMediaId: 'cover-1',
  coverUrl: '/api/media/cover-1',
  coverFocus: { x: 0.25, y: 0.75 },
};

const TEXT_MOMENT: MomentResponse = {
  id: 'moment-text',
  chainId: 'chain-1',
  author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
  type: 'text',
  kind: 'standard',
  payload: null,
  content: '回家的路上买了刚出炉的面包。',
  transcript: null,
  transcriptionStatus: null,
  happenedAt: '2026-08-17T14:00:00.000Z',
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: '2026-08-17T14:00:00.000Z',
  media: [],
  tags: [
    { id: 'tag-1', name: '日常' },
    { id: 'tag-2', name: '晚餐' },
  ],
  persons: [],
  place: null,
  commentCount: 1,
  reactions: [],
  myReaction: null,
};

const IMAGE_MOMENT: MomentResponse = {
  id: 'moment-image',
  chainId: 'chain-1',
  author: { id: 'user-2', nickname: '乔乔', avatarUrl: null },
  type: 'media',
  kind: 'standard',
  payload: null,
  content: '周末去看了海',
  transcript: null,
  transcriptionStatus: null,
  happenedAt: '2026-08-16T14:01:00.000Z',
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: '2026-08-16T14:01:00.000Z',
  media: [
    { id: 'media-1', url: '/api/media/media-1', mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null },
  ],
  tags: [],
  persons: [],
  place: null,
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
function seedChainHome(moments: MomentResponse[], chain: ChainDetailDto = CHAIN) {
  const service = resolve(ChainHomeService);
  service.chainId = 'chain-1';
  service.chain = chain;
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
  service.coverBusy = false;
  service.coverError = null;
  service.repositioning = false;
  service.repositionFocus = null;
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
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
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
  api.uploadMedia.mockResolvedValue({ mediaId: 'media-new', status: 'ready', mime: 'video/mp4', size: 5 });
  api.createMoment.mockResolvedValue({ ...TEXT_MOMENT, id: 'moment-new', type: 'video' });
  mediaLib.probeVideo.mockResolvedValue({ size: 5, durationSeconds: 12 });
  resolve(AuthService).user = USER;
  resolve(ChainListService).chains = [CHAIN];
  resolve(ComposeSessionService).request = null;
  resolve(ComposeSessionService).lastCreatedId = null;
  const sheet = resolve(MomentSheetService);
  sheet.lightboxIndex = null;
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
      expect(within(article).queryByRole('link', { name: /周末小家/ })).toBeNull();
      expect(within(article).queryByText('周末小家')).toBeNull();
    }
    // 链名只出现在页眉
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('commentCount 为 0 不显示回应，有回应时纸边是时刻详情链接', () => {
    seedChainHome([TEXT_MOMENT, IMAGE_MOMENT]);
    renderChainHome();

    const [textArticle, imageArticle] = screen.getAllByRole('article');
    const comments = within(textArticle!).getByRole('link', { name: '1 回应' });
    expect(comments).toHaveAttribute('href', expect.stringContaining('/moments/'));
    expect(within(imageArticle!).queryByText('0 回应')).toBeNull();
    expect(within(imageArticle!).queryByRole('link', { name: /回应/ })).toBeNull();
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

  it('网格卡片没有表情入口', () => {
    seedChainHome([TEXT_MOMENT]);
    renderChainHome();

    expect(screen.queryByRole('button', { name: '加个表情' })).toBeNull();
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

describe('链首页封面', () => {
  it('链有封面时标题上方渲染宽幅封面：blob 通道 + 焦点 object-position', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    const { container } = renderChainHome();

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-cover-1');
    expect(img).toHaveStyle({ objectPosition: '25% 75%' });
    expect(img?.parentElement?.className.split(/\s+/)).not.toContain('rounded-surface-lg');
    // 封面在内容列之外（通栏）；标题仍在，网格祖先不再要求 max-w-content
    const cover = img!.closest('[aria-hidden]');
    const heading = screen.getByRole('heading', { level: 1, name: '周末小家' });
    expect(heading.closest('.max-w-content')).toBeNull();
    expect(heading).toBeInTheDocument();
    expect(cover).not.toBeNull();
    expect(heading.closest('.px-5')!.contains(cover)).toBe(false);
    const rail = container.querySelector('aside.w-rail');
    expect(rail?.className.split(/\s+/)).toContain('top-[30vh]');
    expect(rail?.className.split(/\s+/)).not.toContain('inset-y-0');
  });

  it('封面加载失败当次隐藏，页面回普通页眉', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    const { container } = renderChainHome();

    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('无封面时时间索引仍从视口顶固定', () => {
    seedChainHome([TEXT_MOMENT]);
    const { container } = renderChainHome();
    const rail = container.querySelector('aside.w-rail');
    expect(rail?.className.split(/\s+/)).toContain('inset-y-0');
    expect(rail?.className.split(/\s+/)).not.toContain('top-[30vh]');
  });

  it('无封面的链不渲染封面容器之外的任何页眉图片', () => {
    seedChainHome([TEXT_MOMENT]);
    const { container } = renderChainHome();

    // 页面上没有任何 <img>（成员头像簇为字母占位、时刻无媒体）
    expect(container.querySelector('img')).toBeNull();
  });

  it('链色点与链名同一行；直接露出设置，没有链操作菜单', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    renderChainHome();

    const heading = screen.getByRole('heading', { level: 1, name: '周末小家' });
    expect(heading.parentElement?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'items-center']),
    );
    expect(heading.previousElementSibling).toHaveClass('rounded-full');
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '链操作' })).toBeNull();
  });

  it('owner 有封面时露出更换 / 调整 / 去掉', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    renderChainHome();

    expect(screen.getByRole('button', { name: '更换封面' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '调整位置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去掉封面' })).toBeInTheDocument();
  });

  it('非 owner 有封面时没有更换 / 调整 / 去掉', () => {
    seedChainHome([TEXT_MOMENT], { ...COVERED_CHAIN, myRole: 'editor' });
    const { unmount } = renderChainHome();
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull();
    expect(screen.queryByRole('button', { name: '调整位置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '去掉封面' })).toBeNull();
    unmount();

    seedChainHome([TEXT_MOMENT], { ...COVERED_CHAIN, myRole: 'viewer' });
    renderChainHome();
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull();
  });

  it('owner 无封面时露出添加封面；非 owner 没有', () => {
    seedChainHome([TEXT_MOMENT]);
    const { unmount } = renderChainHome();
    expect(screen.getByRole('button', { name: '添加封面' })).toBeInTheDocument();
    unmount();

    seedChainHome([TEXT_MOMENT], { ...CHAIN, myRole: 'editor' });
    const second = renderChainHome();
    expect(screen.queryByRole('button', { name: '添加封面' })).toBeNull();
    second.unmount();

    seedChainHome([TEXT_MOMENT], { ...CHAIN, myRole: 'viewer' });
    renderChainHome();
    expect(screen.queryByRole('button', { name: '添加封面' })).toBeNull();
  });

  it('调整位置态露出取消 / 保存位置（jsdom 下须播种后再渲）', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    const service = resolve(ChainHomeService);
    service.repositioning = true;
    service.repositionFocus = { x: 0.25, y: 0.75 };
    renderChainHome();

    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存位置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull();
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

    const face = screen.getByRole('button', { name: '查看媒体' });
    expect(face.querySelector('img')).toHaveAttribute('src', '/api/media/media-1');

    await user.click(face);
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

  function renderEdit(edit: MomentResponse) {
    resolve(ComposeSessionService).request = { chainId: 'chain-1', edit };
    return render(
      <RSRoot>
        <ComposePanel />
      </RSRoot>,
    );
  }

  it('编辑 media 出现加图片且可叉已有格', () => {
    renderEdit(IMAGE_MOMENT);
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
    expect(screen.queryByText('已发布的媒体不能更换')).toBeNull();
    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
  });

  it('编辑 text 出现加图片', () => {
    renderEdit({ ...IMAGE_MOMENT, id: 'moment-text-edit', type: 'text', media: [] });
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
  });

  it('编辑 voice 出现加图片且可叉附图', () => {
    renderEdit({
      ...IMAGE_MOMENT,
      id: 'moment-voice-edit',
      type: 'voice',
      media: [
        { ...IMAGE_MOMENT.media[0]!, id: 'aud', mime: 'audio/wav', url: 'https://signed.example/aud' },
        IMAGE_MOMENT.media[0]!,
      ],
    });
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
  });

  it('编辑 video 只读文案，无加图按钮', () => {
    renderEdit({
      ...IMAGE_MOMENT,
      id: 'moment-video-edit',
      type: 'video',
      media: [{ ...IMAGE_MOMENT.media[0]!, id: 'vid', mime: 'video/mp4' }],
    });
    expect(screen.getByText('视频发布后不能更换')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加图片' })).toBeNull();
  });

  it('编辑叉掉已有图后点取消先弹放弃确认', async () => {
    const user = userEvent.setup();
    renderEdit(IMAGE_MOMENT);
    await user.click(screen.getByRole('button', { name: '移除这张图片' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(resolve(ComposeSessionService).request).not.toBeNull();
  });

  it('无草稿时直接关闭，不弹 AlertDialog', async () => {
    const user = userEvent.setup();
    renderCompose();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(resolve(ComposeSessionService).request).toBeNull();
  });

  it('从媒体区域粘贴图片时由面板接收，并阻止浏览器重复处理文件', () => {
    renderCompose();
    const image = new File(['photo'], 'family.jpg', { type: 'image/jpeg' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    const allowed = fireEvent.paste(dropzone, {
      clipboardData: { files: [image] },
    });
    // RAB observable 在 jsdom 中不主动刷新 observer；拖入态的 React state 变化促使组件读取最新图片草稿。
    fireEvent.dragEnter(dropzone);

    expect(allowed).toBe(false);
    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
  });

  it('拖入图片后直接加入图片草稿', () => {
    renderCompose();
    const image = new File(['photo'], 'family.jpg', { type: 'image/jpeg' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [image] } });

    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
  });

  it('拖入单个视频后保留原文件，并从现有上传客户端提交', async () => {
    const user = userEvent.setup();
    renderCompose();
    const video = new File(['video'], 'family.mp4', { type: 'video/mp4' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [video] } });
    await waitFor(() => expect(mediaLib.probeVideo).toHaveBeenCalledWith(video));
    // probeVideo 异步写入 RAB service 后，以 React 拖入态刷新测试 DOM。
    fireEvent.dragEnter(dropzone);

    expect(document.querySelector('video[src="blob:family.mp4"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '记下' }));

    await waitFor(() =>
      expect(api.uploadMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          file: video,
          mime: 'video/mp4',
          size: video.size,
          kind: 'video',
          durationSeconds: 12,
        }),
      ),
    );
    expect(api.createMoment).toHaveBeenCalledWith(
      'chain-1',
      expect.objectContaining({ type: 'video', mediaIds: ['media-new'] }),
    );
  });

  it('拖拽经过区域内子元素时保持高亮，真正离开后才恢复', () => {
    renderCompose();
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });
    const imageButton = within(dropzone).getByRole('button', { name: '加图片' });

    fireEvent.dragEnter(dropzone);
    fireEvent.dragEnter(imageButton);
    fireEvent.dragLeave(imageButton, { relatedTarget: null });
    expect(dropzone).toHaveClass('border-action');

    fireEvent.dragLeave(dropzone, { relatedTarget: null });
    expect(dropzone).toHaveClass('border-line');
  });

  it('拖入视频时复用现有的图片/视频互斥确认', () => {
    renderCompose();
    const image = new File(['photo'], 'family.jpg', { type: 'image/jpeg' });
    const video = new File(['video'], 'family.mp4', { type: 'video/mp4' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.paste(screen.getByRole('textbox', { name: '这一刻' }), {
      clipboardData: { files: [image] },
    });
    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [video] } });

    expect(screen.getByRole('alertdialog', { name: '换成视频？' })).toBeInTheDocument();
  });

  it('普通文字粘贴不被媒体处理器阻止', () => {
    renderCompose();

    const allowed = fireEvent.paste(screen.getByRole('textbox', { name: '这一刻' }), {
      clipboardData: { files: [] },
    });

    expect(allowed).toBe(true);
  });

  it('一次拖入图片和视频时明确拒绝，不静默丢掉视频', () => {
    renderCompose();
    const image = new File(['photo'], 'family.jpg', { type: 'image/jpeg' });
    const video = new File(['video'], 'family.mp4', { type: 'video/mp4' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [image, video] } });

    expect(screen.getByRole('alert')).toHaveTextContent('图片和视频不能一起添加');
    expect(screen.queryByRole('button', { name: '移除这张图片' })).toBeNull();
  });

  it('一次拖入多个视频时明确说明只能添加一个', () => {
    renderCompose();
    const first = new File(['video-1'], 'first.mp4', { type: 'video/mp4' });
    const second = new File(['video-2'], 'second.mp4', { type: 'video/mp4' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [first, second] } });

    expect(screen.getByRole('alert')).toHaveTextContent('一次只能添加一个视频');
  });

  it('拖入非媒体文件时给出明确提示', () => {
    renderCompose();
    const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const dropzone = screen.getByRole('region', { name: '添加图片或视频' });

    fireEvent.dragEnter(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [document] } });

    expect(screen.getByRole('alert')).toHaveTextContent('这里只能添加图片或视频');
  });
});
