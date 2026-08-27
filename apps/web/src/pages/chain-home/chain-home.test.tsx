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
    { id: 'media-1', url: '/api/media/media-1', mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0, posterMediaId: null, posterUrl: null },
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

describe('链首页封面', () => {
  it('链有封面时标题上方渲染宽幅封面：blob 通道 + 焦点 object-position', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    const { container } = renderChainHome();

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-cover-1');
    expect(img).toHaveStyle({ objectPosition: '25% 75%' });
    // 普通页眉仍在（封面上方/前方附加，不替换既有结构）
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('封面加载失败当次隐藏，页面回普通页眉', () => {
    seedChainHome([TEXT_MOMENT], COVERED_CHAIN);
    const { container } = renderChainHome();

    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('无封面的链不渲染封面容器之外的任何页眉图片', () => {
    seedChainHome([TEXT_MOMENT]);
    const { container } = renderChainHome();

    // 页面上没有任何 <img>（成员头像簇为字母占位、时刻无媒体）
    expect(container.querySelector('img')).toBeNull();
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
