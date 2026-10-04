import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { RSRoot, register, resolve } from "@rabjs/react";
import type {
  ChainDto,
  ChainMemberDto,
  NotificationDto,
  ShareLinkDto,
  UserProfile,
} from "@moment/dto";
import type { ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceDraftFromChain } from "@/chain/appearance-model";
import { AuthService } from "@/services/auth.service";
import { NotificationService } from "@/services/notification.service";
import { ThemeService } from "@/services/theme.service";
import { ChainSettingsPageContent } from "./chain-settings/index";
import { ChainSettingsService } from "./chain-settings/chain-settings.service";
import { MeService } from "./me/me.service";
import { SettingsAppearanceContent } from "./settings/appearance";
import { SettingsPasswordContent } from "./settings/password";
import { SettingsProfileContent } from "./settings/profile";
import { SettingsTokensContent } from "./settings/tokens";
import { NotificationsHome } from "./notifications/index";

// 链设置 / 我 / 通知契约（plan Task 12）：
// - viewer 看不到 owner 专属的分享 / 资料（含危险区）分区，成员管理控件也不出现；
// - 吊销分享链接先弹 AlertDialog（取消 / 吊销的具体文案），确认后仍走既有
//   service.revokeShareLink；危险操作不重复弹 Toast；
// - 资料保存成功调用 useToast().show({ key: 'settings-saved', message: '设置已保存' })，
//   ToastProvider/Region 挂载归 Task 8，这里只断言 show 调用；
// - 外观页主题保留跟随系统 / 浅 / 深三态；
// - 通知未读点用行动色，行不堆卡片阴影。
//
// 最小桩与 chain-home.test.tsx 同一约定：@/api/client 全模块桩（未列方法永不
// settle），全局 Service 与 main.tsx 同序注册，认证态经 resolve(AuthService) 播种。
// jsdom 下 RAB Service 属性变更不触发 observer 重渲：ChainSettingsService /
// NotificationService 在渲染前播种（hydrate 幂等守卫命中后不再发请求）。
// ChainSettingsPageContent / 设置页 Content 具名导出是测试 seam（同
// MomentPageContent 先例）：bindServices 的私有容器实例在渲染前无法播种。
// matchMedia 钉死桌面（≥768px）：ResponsiveMenu 走锚定 Menu 分支。

const api = vi.hoisted(() => ({
  getChain: vi.fn(),
  updateChain: vi.fn(),
  listShareLinks: vi.fn(),
  revokeShareLink: vi.fn(),
  listAccessTokens: vi.fn(),
  createAccessToken: vi.fn(),
  revokeAccessToken: vi.fn(),
  updateMe: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  client: new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        (api as Record<string, unknown>)[prop] ??
        (() => new Promise(() => undefined)),
    },
  ),
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => window.dispatchEvent(new Event("moment:auth-cleared")),
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

// 只探针化 useToast（settings-saved 调用是 Task 12 契约），Banner/EmptyState 等
// 基元保持真实实现。
const toast = vi.hoisted(() => ({ show: vi.fn(), clear: vi.fn() }));
vi.mock("@/ui/feedback/index", async (importActual) => {
  const actual = await importActual<typeof import("@/ui/feedback/index")>();
  return { ...actual, useToast: () => toast };
});

register(AuthService);
register(ThemeService);
register(NotificationService);
register(ChainSettingsService);
register(MeService);

const USER: UserProfile = {
  id: "user-1",
  email: "man@moment.test",
  nickname: "林晓满",
  avatarColor: null,
  avatarIcon: null,
  avatarUrl: null,
  avatarExpiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const VIEWER_USER: UserProfile = {
  id: "user-3",
  email: "can@moment.test",
  nickname: "阿灿",
  avatarColor: null,
  avatarIcon: null,
  avatarUrl: null,
  avatarExpiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const CHAIN_BASE: Omit<ChainDto, "myRole"> = {
  id: "chain-1",
  name: "周末小家",
  description: "一起记录平凡日子",
  avatarMediaId: null,
  avatarUrl: null,
  avatarFocus: null,
  coverMediaId: null,
  coverUrl: null,
  coverFocus: null,
  color: "coral",
  icon: null,
  visibility: "private",
  template: "daily",
  payload: null,
  ownerId: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  membersPreview: [],
  memberCount: 3,
};

const CHAIN_OWNER: ChainDto = { ...CHAIN_BASE, myRole: "owner" };
const CHAIN_VIEWER: ChainDto = { ...CHAIN_BASE, myRole: "viewer" };

const MEMBERS: ChainMemberDto[] = [
  {
    userId: "user-1",
    nickname: "林晓满",
    avatarUrl: null,
    role: "owner",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    userId: "user-2",
    nickname: "乔乔",
    avatarUrl: null,
    role: "editor",
    joinedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    userId: "user-3",
    nickname: "阿灿",
    avatarUrl: null,
    role: "viewer",
    joinedAt: "2026-01-03T00:00:00.000Z",
  },
];

const SHARE_LINK: ShareLinkDto = {
  id: "link-1",
  chainId: "chain-1",
  token: "tok-1",
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const UNREAD_NOTIFICATION: NotificationDto = {
  id: "n-1",
  type: "moment.created",
  payload: { title: "今天去了公园", momentId: "moment-1" },
  readAt: null,
  createdAt: "2026-08-18T10:00:00.000Z",
};

const READ_NOTIFICATION: NotificationDto = {
  id: "n-2",
  type: "comment.created",
  payload: { title: "面包看起来好香", momentId: "moment-2" },
  readAt: "2026-08-18T11:00:00.000Z",
  createdAt: "2026-08-18T09:00:00.000Z",
};

/** 渲染前播种 ChainSettingsService：chainId 与路由一致时 hydrate 幂等返回，不发请求。 */
function seedChainSettings(chain: ChainDto) {
  const service = resolve(ChainSettingsService);
  service.chainId = "chain-1";
  service.chain = chain;
  service.members = MEMBERS;
  service.invites = [];
  service.shareLinks = [];
  service.tags = [];
  service.revokeLinkId = null;
  service.transferId = null;
  service.transferName = "";
  // 资料表单与外观草稿按 loadChain 首载语义播种（保存闸 canSave 需要 name 非空）
  service.formName = chain.name;
  service.formDescription = chain.description ?? "";
  service.formHydrated = true;
  service.appearance = appearanceDraftFromChain(chain);
}

function renderChainSettings() {
  return render(
    <MemoryRouter initialEntries={["/chains/chain-1"]}>
      <RSRoot>
        <Routes>
          <Route
            path="/chains/:chainId"
            element={<ChainSettingsPageContent />}
          />
        </Routes>
      </RSRoot>
    </MemoryRouter>,
  );
}

function renderSettings(node: ReactElement) {
  return render(
    <MemoryRouter>
      <RSRoot>{node}</RSRoot>
    </MemoryRouter>,
  );
}

function renderNotifications() {
  return render(
    <MemoryRouter>
      <RSRoot>
        <NotificationsHome />
      </RSRoot>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 768px)",
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
  resolve(AuthService).user = null;
  const me = resolve(MeService);
  me.tokenName = "";
  me.tokens = [];
  me.issued = null;
  me.pendingRevoke = null;
  me.copied = false;
  me.copyError = "";
  me.nickname = "";
  me.nicknameReady = false;
  me.oldPassword = "";
  me.newPassword = "";
  me.confirmPassword = "";
  me.passwordDone = false;
  api.listAccessTokens.mockResolvedValue({ tokens: [] });
});

describe("链设置角色门控", () => {
  it("viewer 只见成员分区：分享 / 资料 / 危险区与成员管理控件一律不出现", () => {
    resolve(AuthService).user = VIEWER_USER;
    seedChainSettings(CHAIN_VIEWER);
    renderChainSettings();

    // 分区导航只剩「成员」
    expect(screen.getByRole("button", { name: "成员" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享" })).toBeNull();
    expect(screen.queryByRole("button", { name: "人物" })).toBeNull();
    expect(screen.queryByRole("button", { name: "标签" })).toBeNull();
    expect(screen.queryByRole("button", { name: "资料" })).toBeNull();

    // owner 专属内容一律不出现
    expect(screen.queryByText("给长辈看这条链")).toBeNull();
    expect(screen.queryByRole("button", { name: "生成分享链接" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除整条链" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();

    // 成员列表可见，但角色调整与移除 / 转让不属 viewer
    expect(screen.getByText("林晓满")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /的角色/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /管理/ })).toBeNull();
  });
});

describe("危险操作的结构化确认", () => {
  it("吊销分享链接先弹 AlertDialog（取消 / 吊销），确认后走既有 revokeShareLink", async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    seedChainSettings(CHAIN_OWNER);
    resolve(ChainSettingsService).shareLinks = [SHARE_LINK];
    api.revokeShareLink.mockResolvedValue(undefined);
    api.listShareLinks.mockResolvedValue({ items: [] });
    renderChainSettings();

    await user.click(screen.getByRole("button", { name: "吊销" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "吊销这条链接？" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("长辈将立刻打不开这本相册。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "取消" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "吊销" }));
    await waitFor(() =>
      expect(api.revokeShareLink).toHaveBeenCalledWith("link-1"),
    );
    // 危险操作结果由 Banner / 列表变化表达，不重复弹 Toast
    expect(toast.show).not.toHaveBeenCalled();
  });
});

describe("资料保存反馈", () => {
  it("保存成功调用 useToast().show({ key: settings-saved, message: 设置已保存 })", async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    seedChainSettings(CHAIN_OWNER);
    api.updateChain.mockResolvedValue(CHAIN_OWNER);
    api.getChain.mockResolvedValue(CHAIN_OWNER);
    renderChainSettings();

    await user.click(screen.getByRole("button", { name: "资料" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        key: "settings-saved",
        message: "设置已保存",
      }),
    );
  });
});

describe("外观草稿生命周期", () => {
  it("离开设置页（unmount）调用 disposeAppearanceDraft 回收未保存 temp", () => {
    resolve(AuthService).user = VIEWER_USER;
    seedChainSettings(CHAIN_VIEWER);
    const service = resolve(ChainSettingsService);
    const spy = vi.spyOn(service, "disposeAppearanceDraft");
    const { unmount } = renderChainSettings();

    unmount();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("设置分节", () => {
  it("每一项是独立页面，退出留在设置里", () => {
    resolve(AuthService).user = USER;
    renderSettings(<SettingsProfileContent />);

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /个人资料/ })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
    expect(screen.getByRole("link", { name: /外观/ })).toHaveAttribute(
      "href",
      "/settings/appearance",
    );
    expect(screen.getByRole("link", { name: /修改密码/ })).toHaveAttribute(
      "href",
      "/settings/password",
    );
    expect(screen.getByRole("link", { name: /接口令牌/ })).toHaveAttribute(
      "href",
      "/settings/tokens",
    );
    expect(screen.getByRole("button", { name: "退出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成令牌" })).toBeNull();
  });
});

describe("外观页", () => {
  it("主题暴露跟随系统 / 浅 / 深三个既有选项", () => {
    resolve(AuthService).user = USER;
    renderSettings(<SettingsAppearanceContent />);

    const group = screen.getByRole("radiogroup", { name: "主题" });
    expect(
      within(group).getByRole("radio", { name: "跟随系统" }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("radio", { name: "浅" }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("radio", { name: "深" }),
    ).toBeInTheDocument();
  });
});

describe("接口令牌页", () => {
  const created = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "本地脚本",
    preview: "mmt_abcd***wxyz",
    createdAt: "2026-10-04T08:00:00.000Z",
    token: `mmt_${"a".repeat(43)}`,
  };

  it("没有令牌时说明用途，并显示空状态", () => {
    resolve(AuthService).user = USER;
    renderSettings(<SettingsTokensContent />);
    expect(
      screen.getByRole("heading", { name: "接口令牌" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/完整令牌只出现一次/)).toBeInTheDocument();
    expect(screen.getByText("还没有令牌。")).toBeInTheDocument();
  });

  it("生成后弹出一次明文，列表只留缩略；确认后吊销", async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    api.createAccessToken.mockResolvedValue(created);
    api.revokeAccessToken.mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const publicToken = {
      id: created.id,
      name: created.name,
      preview: created.preview,
      createdAt: created.createdAt,
    };
    // 第一次 loadTokens 先挂起。否则它会在 create 之后把列表刷成 []。
    let releaseList!: (value: { tokens: (typeof publicToken)[] }) => void;
    const firstList = new Promise<{ tokens: (typeof publicToken)[] }>(
      (resolve) => {
        releaseList = resolve;
      },
    );
    api.listAccessTokens.mockReturnValueOnce(firstList);
    // jsdom 下渲染前播种才会进首屏。名称是受控字段，生成按钮据此启用。
    const me = resolve(MeService);
    me.tokenName = "本地脚本";
    const first = renderSettings(<SettingsTokensContent />);

    await user.click(screen.getByRole("button", { name: "生成令牌" }));
    await waitFor(() =>
      expect(api.createAccessToken).toHaveBeenCalledWith({ name: "本地脚本" }),
    );
    await waitFor(() => expect(me.issued?.token).toBe(created.token));
    first.unmount();

    // 之后每次挂载都重新拉列表。只返回公开字段，完整令牌留在对话框里。
    api.listAccessTokens.mockResolvedValue({ tokens: [publicToken] });
    releaseList({ tokens: [publicToken] });
    await waitFor(() => expect(me.tokens).toEqual([publicToken]));

    // 异步 action 结束后 jsdom 不一定重渲。用已经写好的 service 状态再挂一次，看对话框。
    const shown = renderSettings(<SettingsTokensContent />);
    const dialog = screen.getByRole("dialog", { name: "令牌已生成" });
    expect(within(dialog).getByRole("textbox", { name: "令牌" })).toHaveValue(
      created.token,
    );
    expect(screen.getByText(/mmt_abcd\*\*\*wxyz/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(created.token);

    await user.click(within(dialog).getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(created.token));
    expect(me.copied).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "完成" }));
    await waitFor(() => expect(me.issued).toBeNull());
    shown.unmount();

    const listed = renderSettings(<SettingsTokensContent />);
    await screen.findByRole("button", { name: "吊销 本地脚本" });
    await waitFor(() => expect(me.tokens).toEqual([publicToken]));
    // 这次挂载的列表已经落地。后面的 loadTokens 挂起，免得吊销后又被刷回来。
    api.listAccessTokens.mockImplementation(
      () => new Promise(() => undefined),
    );
    await user.click(screen.getByRole("button", { name: "吊销 本地脚本" }));
    await waitFor(() => expect(me.pendingRevoke?.id).toBe(created.id));
    // 同步改 service 后 jsdom 不一定重渲。卸掉再挂，确认框按已有状态出现。
    listed.unmount();
    renderSettings(<SettingsTokensContent />);

    const confirm = screen.getByRole("alertdialog");
    expect(
      within(confirm).getByText("使用它的脚本会立刻无法访问。"),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "吊销" }));
    await waitFor(() =>
      expect(api.revokeAccessToken).toHaveBeenCalledWith(created.id),
    );
    await waitFor(() => expect(me.tokens).toEqual([]));
  });
});

describe("个人资料页", () => {
  it("可以改名字，邮箱只展示", async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    api.updateMe.mockResolvedValue({ ...USER, nickname: "小林" });
    const me = resolve(MeService);
    me.nickname = "小林";
    me.nicknameReady = true;
    renderSettings(<SettingsProfileContent />);

    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveValue(
      USER.email,
    );
    expect(screen.getByRole("button", { name: "上传头像" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存名字" }));
    await waitFor(() =>
      expect(api.updateMe).toHaveBeenCalledWith({ nickname: "小林" }),
    );
  });
});

describe("修改密码页", () => {
  it("两次不一致时不提交；成功后说明需要重新登录", async () => {
    const user = userEvent.setup();
    resolve(AuthService).user = USER;
    api.changePassword.mockResolvedValue(undefined);
    const me = resolve(MeService);
    me.oldPassword = "old-secret";
    me.newPassword = "new-secret-1";
    me.confirmPassword = "new-secret-2";
    const first = renderSettings(<SettingsPasswordContent />);

    await user.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(me.$model.changePassword.error).toBeInstanceOf(Error),
    );
    expect(api.changePassword).not.toHaveBeenCalled();
    first.unmount();

    me.confirmPassword = "new-secret-1";
    me.$model.changePassword.error = null;
    const second = renderSettings(<SettingsPasswordContent />);
    await user.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith({
        oldPassword: "old-secret",
        newPassword: "new-secret-1",
      }),
    );
    await waitFor(() => expect(me.passwordDone).toBe(true));
    second.unmount();
    renderSettings(<SettingsPasswordContent />);
    expect(
      screen.getByRole("dialog", { name: "密码已修改" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/接口令牌也失效了/)).toBeInTheDocument();
  });
});

describe("通知行", () => {
  it("未读点用行动色，行不堆卡片阴影；已读条没有未读点", () => {
    resolve(AuthService).user = USER;
    const notification = resolve(NotificationService);
    notification.items = [UNREAD_NOTIFICATION, READ_NOTIFICATION];
    notification.nextCursor = null;
    renderNotifications();

    const dots = screen.getAllByLabelText("未读");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("bg-action");
    const row = dots[0]!.closest("li");
    expect(row).not.toBeNull();
    expect(row!.className).not.toMatch(/shadow/);
    const hit = row!.querySelector("a, div");
    expect(hit?.className ?? "").toMatch(/min-h-touch-control/);
  });
});
