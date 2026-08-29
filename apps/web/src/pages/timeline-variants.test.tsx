import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import type { ChainDto, CommentDto, MomentMedia, MomentResponse, UserProfile } from '@moment/dto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { NotificationService } from '@/services/notification.service';
import { ThemeService } from '@/services/theme.service';
import { MomentSheetContent } from '@/timeline/moment-sheet';
import { MomentSheetService } from '@/timeline/moment-sheet.service';
import { FeedHomeContent } from './feed-home/index';
import { FeedHomeService } from './feed-home/feed-home.service';
import { MomentPageContent } from './moment/index';
import { MomentPageService } from './moment/moment.service';
import { ShareAlbumPageContent } from './share-album/index';
import { ShareAlbumService } from './share-album/share-album.service';

// 三个路由变体契约（plan Task 11）：
// - 「大家的日子」feed：页眉「大家的日子 / 来自 N 条时光链」+ 唯一主动作「记下此刻」；
//   仅 feed 项的时刻元信息带「● 链名」来源链接（链色点 + 链名 → /chains/:chainId）；
//   同一 MomentSheet 不给 chainLookById 时没有来源链接；
// - /moments/:momentId 详情：回复 Field + 既有删除自己评论动作，评论增删仍走
//   MomentPageService 既有 mutation（createComment / deleteComment）；
// - /share/:token 公开分享：无 Shell、只读（无 composer / 表情 / kebab 入口），
//   点媒体按被点 index 经 Lightbox 打开，媒体走 ?st= token 通道。
//
// 最小桩与 chain-home.test.tsx / shell-navigation.test.tsx 同一约定：@/api/client
// 全模块桩（未列方法永不 settle），全局 Service 与 main.tsx 同序注册，认证态经
// resolve(AuthService) 直接播种。jsdom 下 RAB Service 属性变更不触发 observer
// 重渲：Service 在渲染前播种（hydrate 幂等守卫命中后不再发请求），草稿经
// fireEvent.change / fireEvent.submit 写终值，断言目标是 service 调用与 DOM 结果。
//
// MediaBlock 的内部几何归 MediaBlock.test.tsx；这里用模块桩只验证交接契约：
// media / shareToken 原样到达、onOpen(index) 回传点击序号。

const api = vi.hoisted(() => ({
  getFeed: vi.fn(),
  getMonthIndex: vi.fn(),
  listTags: vi.fn(),
  getMoment: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  getPublicShare: vi.fn(),
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
  list: [] as { media: MomentMedia[]; shareToken?: string; onOpen?: (index: number) => void }[],
}));

vi.mock('@/media/MediaBlock', () => ({
  MediaBlock(props: { media: MomentMedia[]; shareToken?: string; onOpen?: (index: number) => void }) {
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

// Lightbox 的认证 blob 通道：同步回 blob:mock-<id>；shareToken 分支组件内部不走 hook。
vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

register(AuthService);
register(ThemeService);
register(ComposeSessionService);
register(ChainListService);
register(NotificationService);
register(FeedHomeService);
register(MomentPageService);
register(ShareAlbumService);
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
  avatarMediaId: 'm-avatar-1',
  avatarUrl: '/api/media/m-avatar-1',
  avatarFocus: { x: 0.25, y: 0.75 },
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
  membersPreview: [{ userId: 'user-1', nickname: '林晓满', avatarUrl: null, role: 'owner' }],
  memberCount: 1,
};

const CHAIN_B: ChainDto = {
  ...CHAIN,
  id: 'chain-2',
  name: '厨房实验',
  color: 'mint',
  avatarMediaId: null,
  avatarUrl: null,
  avatarFocus: null,
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
  tags: [],
  persons: [],
  place: null,
  commentCount: 0,
  reactions: [],
  myReaction: null,
};

function image(id: string, width = 64, height = 48, sortOrder = 0): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'image/jpeg', width, height, duration: null, sortOrder, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null };
}

const TWO_IMAGE_MOMENT: MomentResponse = {
  ...TEXT_MOMENT,
  id: 'moment-images',
  author: { id: 'user-2', nickname: '乔乔', avatarUrl: null },
  type: 'media',
  content: '周末去看了海',
  media: [image('media-1', 64, 48, 0), image('media-2', 48, 64, 1)],
};

const OWN_COMMENT: CommentDto = {
  id: 'comment-1',
  momentId: 'moment-text',
  author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
  content: '面包还热着呢',
  createdAt: '2026-08-17T15:00:00.000Z',
};

const OTHER_COMMENT: CommentDto = {
  id: 'comment-2',
  momentId: 'moment-text',
  author: { id: 'user-2', nickname: '乔乔', avatarUrl: null },
  content: '明天也买',
  createdAt: '2026-08-17T15:05:00.000Z',
};

/** 渲染前播种 FeedHomeService：构造器自启的 loadFirst/loadMeta 走 mock 落地后覆写终值。 */
async function seedFeed(moments: MomentResponse[]) {
  const service = resolve(FeedHomeService);
  await new Promise((r) => setTimeout(r, 0)); // 放掉构造器自启的 loadFirst/loadMeta
  service.moments = moments;
  service.nextCursor = null;
  service.filter = { order: 'happened_at' };
  service.monthIndex = [];
  service.indexPending = false;
  service.tags = [];
}

/** 渲染前播种 MomentPageService：momentId 与路由一致时 hydrate 幂等返回，不发请求。 */
function seedMomentDetail(comments: CommentDto[]) {
  const service = resolve(MomentPageService);
  service.momentId = 'moment-text';
  service.moment = TEXT_MOMENT;
  service.deleted = false;
  service.comments = comments;
  service.nextCursor = null;
  service.draft = '';
}

/** 渲染前播种 ShareAlbumService：token 与路由一致时 hydrate 幂等返回，不发请求。 */
function seedShare(moments: MomentResponse[]) {
  const service = resolve(ShareAlbumService);
  service.token = 'tok en';
  service.chain = {
    name: '周末小家',
    description: '一起记录平凡日子',
    avatarMediaId: 'm-avatar',
    avatarUrl: '/api/media/m-avatar',
    avatarFocus: { x: 0.5, y: 0.5 },
    coverMediaId: 'm-cover',
    coverUrl: '/api/media/m-cover',
    coverFocus: { x: 0.25, y: 0.75 },
    color: null,
    icon: null,
  };
  service.moments = moments;
  service.nextCursor = null;
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
  api.getFeed.mockResolvedValue({ moments: [], nextCursor: null });
  api.getMonthIndex.mockResolvedValue({ months: [] });
  api.listTags.mockResolvedValue({ tags: [] });
  api.listComments.mockResolvedValue({ comments: [], nextCursor: null });
  api.createComment.mockResolvedValue(OWN_COMMENT);
  api.deleteComment.mockResolvedValue(undefined);
  resolve(AuthService).user = USER;
  resolve(ChainListService).chains = [CHAIN, CHAIN_B];
  resolve(ComposeSessionService).request = null;
  resolve(ComposeSessionService).lastCreatedId = null;
  const sheet = resolve(MomentSheetService);
  sheet.lightboxIndex = null;
  sheet.showComments = false;
  sheet.confirmDel = false;
});

describe('大家的日子 feed', () => {
  function renderFeed() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <RSRoot>
          <Routes>
            <Route path="/" element={<FeedHomeContent />} />
          </Routes>
        </RSRoot>
      </MemoryRouter>,
    );
  }

  it('页眉是「大家的日子 / 来自 2 条时光链」，唯一主动作「记下此刻」打开 compose 会话', async () => {
    const user = userEvent.setup();
    await seedFeed([TEXT_MOMENT]);
    renderFeed();

    expect(screen.getByRole('heading', { level: 1, name: '大家的日子' })).toBeInTheDocument();
    expect(screen.getByText('来自 2 条时光链')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '记下此刻' }));
    expect(resolve(ComposeSessionService).request).not.toBeNull();
  });

  it('feed 项元信息带「● 链名」来源链接，指向 /chains/:chainId', async () => {
    await seedFeed([TEXT_MOMENT]);
    renderFeed();

    const article = screen.getByRole('article');
    const source = within(article).getByRole('link', { name: /周末小家/ });
    expect(source).toHaveAttribute('href', '/chains/chain-1');
    // 链色点与链名同在一个链接里（色点 aria-hidden，只表达身份）
    expect(source.textContent).toContain('周末小家');
  });

  it('feed 项链标识渲染链头像：认证 blob 通道 + 焦点 object-position', async () => {
    await seedFeed([TEXT_MOMENT]);
    renderFeed();

    const source = within(screen.getByRole('article')).getByRole('link', { name: /周末小家/ });
    const mark = source.querySelector('img');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('src', 'blob:mock-m-avatar-1');
    expect(mark).toHaveStyle({ objectPosition: '25% 75%' });
  });

  it('同一 MomentSheet 不给 chainLookById 时没有来源链接', () => {
    render(
      <MemoryRouter>
        <RSRoot>
          <MomentSheetContent moment={TEXT_MOMENT} />
        </RSRoot>
      </MemoryRouter>,
    );

    const article = screen.getByRole('article');
    expect(within(article).queryByRole('link', { name: /周末小家/ })).toBeNull();
  });
});

describe('时刻详情', () => {
  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={['/moments/moment-text']}>
        <RSRoot>
          <Routes>
            <Route path="/moments/:momentId" element={<MomentPageContent />} />
          </Routes>
        </RSRoot>
      </MemoryRouter>,
    );
  }

  it('渲染回复 Field，提交走既有 createComment', async () => {
    seedMomentDetail([OWN_COMMENT, OTHER_COMMENT]);
    renderDetail();

    const reply = screen.getByRole('textbox', { name: '回复' });
    fireEvent.change(reply, { target: { value: '沙发' } });
    fireEvent.submit(reply.closest('form')!);

    await waitFor(() => expect(api.createComment).toHaveBeenCalledWith('moment-text', '沙发'));
  });

  it('自己的评论有删除动作，确认后走既有 deleteComment；他人评论没有', async () => {
    const user = userEvent.setup();
    seedMomentDetail([OWN_COMMENT, OTHER_COMMENT]);
    renderDetail();

    const ownRow = screen.getByText('面包还热着呢').closest('li')!;
    const otherRow = screen.getByText('明天也买').closest('li')!;
    expect(within(otherRow).queryByRole('button', { name: '删除' })).toBeNull();

    await user.click(within(ownRow).getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '删除' }));

    await waitFor(() => expect(api.deleteComment).toHaveBeenCalledWith('comment-1'));
  });
});

describe('公开分享相册', () => {
  function renderShare() {
    return render(
      <MemoryRouter initialEntries={['/share/tok%20en']}>
        <RSRoot>
          <Routes>
            <Route path="/share/:token" element={<ShareAlbumPageContent />} />
          </Routes>
        </RSRoot>
      </MemoryRouter>,
    );
  }

  it('页头渲染公开链头像与封面：稳定 URL + ?st=encodeURIComponent(token)，不走 blob 通道', () => {
    seedShare([TWO_IMAGE_MOMENT]);
    const { container } = renderShare();

    const imgs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src'));
    // 头像与封面都走 ?st= 通道（token 带空格，必须 encode）
    expect(imgs).toContain('/api/media/m-avatar?st=tok%20en');
    expect(imgs).toContain('/api/media/m-cover?st=tok%20en');
    // 封面只出现在页头：时刻媒体经 MediaBlock 桩渲染按钮，不产生额外 <img>
    expect(imgs).toHaveLength(2);

    const cover = container.querySelector('img[src="/api/media/m-cover?st=tok%20en"]');
    expect(cover).toHaveStyle({ objectPosition: '25% 75%' });
  });

  it('封面加载失败当次隐藏，页头回普通布局', () => {
    seedShare([TWO_IMAGE_MOMENT]);
    const { container } = renderShare();

    const cover = container.querySelector('img[src="/api/media/m-cover?st=tok%20en"]')!;
    fireEvent.error(cover);
    expect(container.querySelector('img[src^="/api/media/m-cover"]')).toBeNull();
    // 公开头像不受影响
    expect(container.querySelector('img[src^="/api/media/m-avatar"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '周末小家' })).toBeInTheDocument();
  });

  it('只读无 Shell：无 composer、无表情入口、无 kebab，媒体经 ?st= 通道交接', () => {
    seedShare([TWO_IMAGE_MOMENT]);
    renderShare();

    expect(screen.queryByText('这一刻，记点什么…')).toBeNull();
    expect(screen.queryByRole('button', { name: '记下此刻' })).toBeNull();
    expect(screen.queryByRole('button', { name: '加个表情' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();

    const handoff = mediaBlockCalls.list.at(-1);
    expect(handoff?.shareToken).toBe('tok en');
    expect(handoff?.media).toHaveLength(2);
  });

  it('点媒体把被点 index 交给灯箱；灯箱按该 index 用 ?st= URL 渲染', async () => {
    const user = userEvent.setup();
    // 经 MomentSheetContent seam 渲染：全局注册的 MomentSheetService 即组件所用实例
    render(
      <MemoryRouter>
        <RSRoot>
          <MomentSheetContent moment={TWO_IMAGE_MOMENT} shareToken="tok en" readOnly />
        </RSRoot>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('media-open-1'));
    expect(resolve(MomentSheetService).lightboxIndex).toBe(1);
  });

  it('lightboxIndex 已是被点序号时，Lightbox 按该序号渲染分享 URL 的媒体', () => {
    resolve(MomentSheetService).lightboxIndex = 1;
    render(
      <MemoryRouter>
        <RSRoot>
          <MomentSheetContent moment={TWO_IMAGE_MOMENT} shareToken="tok en" readOnly />
        </RSRoot>
      </MemoryRouter>,
    );

    const dialog = screen.getByRole('dialog');
    // 媒体 img alt="" 无 img 角色（装饰性媒体），按元素查询
    const img = dialog.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/media/media-2?st=tok%20en');
  });
});
