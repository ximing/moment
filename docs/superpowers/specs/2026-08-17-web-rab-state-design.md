# 时刻 Moment — Web 状态管理改用 rab

> 日期：2026-08-17
> 状态：设计已与用户对齐，待实现
> 范围：`apps/web` 的状态层与目录。不改 API / dto / 权限 / 媒体语义 / 视觉。
> 权威边界：数据与权限听 `2026-08-15-moment-design.md`；功能面听 `2026-08-16-web-product.md`；视觉与壳层听 `2026-08-17-web-c-end-redesign.md`。本文只定义 **状态怎么住、文件怎么摆**。冲突时：契约听原文，功能听 web-product，观感听 c-end，状态听本文。

## 0. 目标与非目标

**目标：** 用 `@rabjs/react`（已在 `apps/web/package.json`，`^9.2.0`，源码尚未引用）接管 web 全部业务状态。去掉 React Context 与 TanStack Query。按 rab 三层生命周期（全局 `register` / 页面 `bindServices` / 组件 `bindServices`）管理状态。目录改成 rab 教科书形态（`services/` + `pages/<name>/index.tsx` + 同目录 `*.service.ts`）。

**成功标准：**

1. `apps/web/src` 中零个 `@tanstack/react-query` / `useQuery` / `useInfiniteQuery` / `useMutation` / `QueryClient` 引用。
2. 应用状态零个 `createContext`（React Aria 等库自带的 Context 除外）。
3. 业务状态只活在 `Service` 子类上；读它的组件必须是 `observer`（或 `bindServices` 包过的），禁止解构 observable。
4. 产品行为保持：空态文案、改筛选整页重查（web-product §4.3）、`?compose=1`、`lastCreatedId` 生长动画、通知 30s 轮询、主题三态、分享页恒浅。
5. `pnpm --filter @moment/web typecheck` 与 `lint` 通过。

**非目标（本轮明确不做）：** 草稿持久化、筛选进 URL、乐观更新、媒体 blob 缓存 Service、发布后立刻刷时间线里别人的头像、给 web 新加 vitest、改 dto / HTTP、视觉改版。

**已选方案（对话中拍板，不再重开）：**

- 服务端数据也进 rab，删除 React Query（不是「Context 迁 rab、Query 留着」）。
- 严格三层，不是把 feed 筛选 / 草稿 `register()` 成单例。
- 整棵改成 rab 教科书目录，不是在现有扁平 `pages/FeedHome.tsx` 旁塞 service。

## 1. 分层

```
register() 全局单例
  AuthService  ThemeService  ChainListService  NotificationService  ComposeSessionService
        ↑ 可 resolve / useService
页面 bindServices()（随路由挂载/销毁）
  FeedHomeService  ChainHomeService  ChainSettingsService  MomentPageService
  MeService  LoginService  RegisterService  InviteService  ShareAlbumService
        ↑
组件 bindServices()（随组件挂载/销毁）
  ComposePanelService  CreateChainDialogService  MomentSheetService
```

通知列表是全局，不是页面级：`Shell` 一直要读未读数，不能跟 `/notifications` 卸载一起死。

HTTP 仍走现成 `src/api/client.ts` 的 `client`（`@moment/api-client` 单例）。不包一层空的 `ApiService`。`src/api/keys.ts` 随 React Query 删除。

`tokenStore` / `cachedUser` / `cacheUser` 留在 `client.ts`：它们是 localStorage 适配，不是 React 状态。`tokenStore.clear()` 仍派发 `window` 事件 `moment:auth-cleared`；改由 `AuthService` 听，不再由 `AuthProvider` 听。

## 2. 目录

```
apps/web/src/
  main.tsx                              # register 五个全局 Service（AuthService 排首）+ RSRoot；不再套 QueryClient / AuthProvider
  app.tsx                               # Routes（不读 observable，无需 observer）；不再套 ComposeProvider
  services/
    auth.service.ts
    theme.service.ts
    chain-list.service.ts
    notification.service.ts
    compose-session.service.ts
  api/
    client.ts                           # 保留
  pages/
    feed-home/        index.tsx + feed-home.service.ts
    chain-home/       index.tsx + chain-home.service.ts
    chain-settings/   index.tsx + chain-settings.service.ts
    moment/           index.tsx + moment.service.ts
    notifications/    index.tsx         # 无页面 Service，观察全局 NotificationService
    me/               index.tsx + me.service.ts
    login/            index.tsx + login.service.ts
    register/         index.tsx + register.service.ts
    invite/           index.tsx + invite.service.ts
    share-album/      index.tsx + share-album.service.ts
  compose/
    compose-panel/    index.tsx + compose-panel.service.ts
    compose-fab.tsx
    composer-entry.tsx
  shell/
    index.tsx
    require-auth.tsx                    # 从 src/auth/RequireAuth.tsx 挪来
    create-chain-dialog/  index.tsx + create-chain-dialog.service.ts
    user-menu.tsx
  timeline/
    timeline.tsx
    timeline-rail.tsx                   # 受控；抽屉 open 留组件 useState
    moment-sheet.tsx + moment-sheet.service.ts
    lightbox.tsx
    reaction-bar.tsx
    group-by-date.ts
  chain/                                # 纯展示
    chain-mark.tsx
    chain-look-picker.tsx
  media/                                # 不动；useMediaObjectUrl 仍是 hook
  lib/ ui/ styles/                      # 不动
```

删除：`src/auth/AuthProvider.tsx`、`src/compose/ComposeContext.tsx`、`src/api/keys.ts`，以及旧的扁平页面文件（`pages/FeedHome.tsx` 等）。`apps/web/CLAUDE.md` 的放置规则改成跟这棵树一致。

路由表不变（`app.tsx` 仍挂同一组 path）。`/chains/:chainId/compose` 仍重定向到 `?compose=1`。

## 3. 全局 Service

五个类都 `extends Service`，在 `main.tsx` 里 `register(...)`，禁止 `bindServices`。

### 3.1 AuthService

```ts
user: UserProfile | null; // 构造时 cachedUser() 水合

applyAuth(res: AuthResponse): void;          // tokenStore + cacheUser + this.user；emit auth:changed
login(input: LoginInput): Promise<void>;     // client.login → applyAuth
register(input: RegisterInput): Promise<void>;
logout(): Promise<void>;                     // revoke 可吞错；只调 tokenStore.clear()，置空与 emit 走 auth-cleared 事件路径（不双发）
refreshUser(next: UserProfile): void;        // cacheUser + this.user；emit auth:changed（资料页改头像）
```

构造：

1. `user = cachedUser()`。
2. `window` 听 `moment:auth-cleared`：`user = null`；`cacheUser(null)`；`emit('auth:changed', null, 'global')`。登出的置空 + emit 只走这一条路径。
3. 若已有缓存用户，fire-and-forget `client.me()`，成功则 `refreshUser`（`refreshUser` 的 emit 即冷启动补发 `auth:changed`；`me()` 失败时链表/通知起不来，见 §3.3/§3.4 构造兜底）。

注意：`logout()` 只负责 revoke（吞错）与 `tokenStore.clear()`；不要在 logout 里再手动 `user = null` + emit，否则 `auth:changed` 双发、监听方双跑。

登录/注册页、邀请页、`RequireAuth`、`UserMenu`、`MePage` 全部 `useService(AuthService)`。

### 3.2 ThemeService

```ts
choice: ThemeChoice; // 构造时 getThemeChoice()

setChoice(choice: ThemeChoice): void; // setThemeChoice + this.choice
```

构造里调 `subscribeSystemTheme()`。`App` 不再自己 `useEffect` 订阅。`setThemeChoice` / `applyTheme` 仍是 `lib/theme.ts` 的纯函数（分享页恒浅规则留在 `applyTheme`，不搬进 Service）。

### 3.3 ChainListService

```ts
chains: ChainDto[] = [];

async load(): Promise<void>; // this.chains = await client.listChains()
```

构造：读 `this.resolve(AuthService).user`，有则 fire-and-forget `load()`——不能只依赖 `auth:changed`：缓存登录态冷启动时 AuthService 构造不发事件，`me()` 失败也不发，只听事件的话侧栏链表永远空。之后听 `auth:changed`（有 user 则 `load()`，否则 `chains = []`）与 `chain:changed`（`load()`）。register 顺序保证 AuthService 在前。

Shell 侧栏、首页链色表、发布选链都读这份列表，禁止再各拉一次。

### 3.4 NotificationService

```ts
items: NotificationDto[] = []; // 类型用 dto 里 listNotifications 的元素类型
nextCursor: string | null = null;

async loadFirst(): Promise<void>;
async loadMore(): Promise<void>;
async pollUnread(): Promise<void>;   // 30s 轮询专用：只 merge 已有条目 + 未读数，不动 cursor
async markAllRead(): Promise<void>;  // 成功后本地置 readAt / 重拉，不 emit notification:changed（唯一听者是自己，自发自收无意义）

get unreadCount(): number; // items 里 readAt === null 的数量
get hasMore(): boolean;
```

轮询与冷启动：构造读 `this.resolve(AuthService).user`，有则开轮询（与 `ChainListService` 同理，不能只听 `auth:changed`）。之后听 `auth:changed`：有 user 开 `setInterval(30000)` 并 `loadFirst()`，无 user `clearInterval` 且 `items = []`。全局 Service 不随页面卸，必须靠 `auth:changed` 关表。

轮询不能整表 `loadFirst()`：通知页共享这份 `items`，用户正在往下翻时每 30s 被整表替换 + `nextCursor` 清空，已加载的分页全丢。轮询改为 `pollUnread()`：拉第一页，只 merge 已在 `items` 里的条目与未读数，不动 `nextCursor`、不追加新页。整表 `loadFirst()` 只发生在：`auth:changed` 登入、`notification:changed`、用户在通知页手动下拉刷新。

`Shell` 读 `unreadCount`；`pages/notifications` 读 `items` / `loadMore` / `markAllRead`。两处同一份数据，禁止再出现「finite query 与 infinite query 抢同一个 key」。

### 3.5 ComposeSessionService

```ts
request: { chainId?: string; edit?: MomentResponse } | null = null;
lastCreatedId: string | null = null;

openCompose(req?: { chainId?: string; edit?: MomentResponse }): void;
  // lastCreatedId = null；request = req ?? {}
closeCompose(): void; // request = null
markCreated(id: string): void; // lastCreatedId = id
```

取代 `ComposeContext`。FAB、入口卡、时间线生长动画、`?compose=1` 都打这里。

`Shell` 保留一个路由 effect：`location.search` 含 `compose=1` 时 `openCompose({ chainId })`，再 `navigate(..., { replace: true })` 清 query。路由不属于 Service。

## 4. 页面 / 组件 Service

页面组件：`const XContent = observer(() => { ... }); export const X = bindServices(XContent, [XService]);`  
通知页没有页面 Service，只 `observer` + `useService(NotificationService)`。

首次加载由谁发起：带 `hydrate` 的页面（链页 / 详情页）在 `hydrate` 里触发，且 `hydrate` 必须幂等（同 id 直接 return，挡 StrictMode 双调用）；无路由参数的页面（首页等）在构造里 fire-and-forget `loadFirst()`（+ 需要时 `loadMeta()`），组件里不写加载 effect 链。

### 4.1 分页公约（feed / 通知 / 详情评论）

```ts
items: T[] = [];
nextCursor: string | null = null;
private gen = 0;

async loadFirst(): Promise<void> { /* gen++；整表替换；过期响应丢弃 */ }
async loadMore(): Promise<void>  { /* 无 cursor 或已 loading 则 return；append；过期丢弃 */ }
get hasMore(): boolean;
```

- 改筛选或改 `before`（跳月）只走 `loadFirst()`，cursor 清掉。对应 web-product §4.3。
- 写操作引起的刷新 = 再 `loadFirst()`。不重放已加载的 N 页。
- loading / error 读 `$model.loadFirst` / `$model.loadMore`，组件不另存。
- `FeedHomeService` 与 `ChainHomeService` 抽 `src/lib/feed.ts` 纯函数（拼 `getFeed` 参数、合并页）。不抽基类，不抽全局 `FeedService`。

### 4.2 FeedHomeService

```ts
filter: RailFilter = { order: 'happened_at' }; // 类型仍从 timeline-rail 导出
moments: MomentResponse[] = [];
nextCursor: string | null = null;
monthIndex: MonthIndexEntry[] = [];
tags: TagResponse[] = []; // 仅 filter.chainIds.length === 1 时有值，否则 []

setFilter(next: RailFilter): void; // 赋值后 loadFirst + loadMeta
clearBefore(): void;
clearFilters(): void; // { order: 'happened_at' }
async loadFirst(): Promise<void>;
async loadMore(): Promise<void>;
async loadMeta(): Promise<void>; // month-index（order===happened_at 时）+ 单链 tags
```

构造听 `moment:changed` / `comment:changed` → `loadFirst()` + `loadMeta()`。

`loadFirst` 调 `client.getFeed({ ...filter, cursor: undefined, limit: 50 })`。

### 4.3 ChainHomeService

与 4.2 相同，另加：

```ts
chainId = '';
chain: ChainDto | null = null;

hydrate(chainId: string): void; // 路由 param 进来；强制 filter 不含其它 chainIds；loadChain + loadFirst + loadMeta
async loadChain(): Promise<void>; // client.getChain(this.chainId)
```

`getFeed` 始终带 `chainIds: [this.chainId]`。听 `chain:changed`：payload.chainId 匹配则 `loadChain()`。

页面 `useParams` 之后调 `hydrate`，不在 Service 里碰 router。

### 4.4 MomentPageService

```ts
momentId = '';
moment: MomentResponse | null = null;
comments: CommentDto[] = [];
nextCursor: string | null = null;
draft = '';

hydrate(momentId: string): void;
async loadMoment(): Promise<void>;
async loadFirstComments(): Promise<void>;
async loadMoreComments(): Promise<void>;
async submitComment(): Promise<void>; // 成功后 draft=''；emit comment:changed
async deleteComment(id: string): Promise<void>;
```

听 `moment:changed`：同 id 且 `op === 'delete'` 时 `moment = null`（页面显示「没有这条」）；否则 `loadMoment()`。听 `comment:changed` 同 id 则 `loadFirstComments()` + `loadMoment()`（刷新评论数）。

### 4.5 ChainSettingsService / MeService / LoginService / RegisterService / InviteService / ShareAlbumService

各页把自己现在的 `useQuery` + 表单 `useState` 收进对应 Service。设置页的成员 / 邀请 / 分享链接 / 资料分区都是这个 Service 的字段，不按分区再 `bindServices`（同一次挂载、同一次卸载）。

- 设置页写成功 → `emit('chain:changed', { chainId, op }, 'global')`。
- `MeService` 改头像成功 → `auth.refreshUser(next)`。
- `LoginService` / `RegisterService` 调 `auth.login` / `auth.register`；跳转留在组件（`useNavigate`）。
- `InviteService`：未登录先走登录/注册；已登录后 `acceptInvite`，成功则 `emit('chain:changed', { chainId, op: 'create' }, 'global')`。不走 `applyAuth`（邀请接受不换会话）。
- `ShareAlbumService` 只拉公开相册；不碰全局链列表。

### 4.6 ComposePanelService

草稿（正文、文件、标签、`happenedAt`、进度）活在面板生命周期。`bindServices` 绑在**条件挂载的面板本体**上（今天 `ComposeBody` 的位置），不绑常挂的外壳：外层 `ComposePanel` 是常挂的（`request === null` 渲 null），绑外层会让草稿跨开关半持久化——与非目标「不做草稿持久化」冲突且行为改变。

`submit` 成功：`composeSession.markCreated(id)`；`emit('moment:changed', { momentId, chainId, op: 'create' | 'update' }, 'global')`；`composeSession.closeCompose()`。

预览 blob 的 `URL.revokeObjectURL` 走**显式路径**（`submit` 成功、用户移除文件、`closeCompose` 时机），不放进 Service 的 `destroy()`——`bindServices` 的容器销毁靠 FinalizationRegistry/GC，不是 unmount 即时（见 §5），`destroy()` 里的清理时机不可控，blob URL 会滞留。

### 4.7 CreateChainDialogService

表单 + `submit` → `client.createChain` → `emit('chain:changed', { chainId, op: 'create' }, 'global')`。对话框开关是纯 UI：`Shell` 本地 `creating` boolean，和 Rail 抽屉一样不上 Service。

### 4.8 MomentSheetService

每张卡一个实例（`bindServices(MomentSheet, [MomentSheetService])`）：

```ts
lightbox: number | null = null;
showComments = false;
confirmDel = false;
preview: CommentDto[] = []; // limit 20，与详情页列表不是同一份

hydrate(moment: MomentResponse): void;
async loadPreview(): Promise<void>; // 展开评论时
async react(emoji: string): Promise<void>; // emit moment:changed op:'react'
async remove(): Promise<void>;             // emit moment:changed op:'delete'
async submitComment(text: string): Promise<void>; // emit comment:changed
```

禁止和 `MomentPageService` 共享同一块 comments 数组（这就是今天同 key 撞车的根因）。

## 5. 事件

一律 `this.emit(name, payload, 'global')` / `this.on(name, handler, 'global')`。

**dispose 语义（源码事实，勿依赖）**：`bindServices` 的容器销毁走 `UniversalFinalizationRegistry`（浏览器为原生 FinalizationRegistry），React `useEffect` cleanup 只是兜底重注册——**不是 unmount 即时销毁**。路由切走后旧页面 Service 的全局监听在 GC 前仍是活的（zombie 窗口）：会继续收事件、白发 `loadFirst()` 请求。这不破坏正确性（实例无 UI 在读、分页 gen 守卫在），但两条铁律：

1. 正确性必须不依赖监听器被及时移除（zombie 期只浪费请求，不能改坏状态）。
2. 必须及时释放的资源（blob URL、`setInterval`）不放 Service `destroy()`，走显式路径（见 §3.4 / §4.6）。zombie 实例随导航累积到 GC，属预期。

| 事件 | payload | 谁发 | 谁听 |
|---|---|---|---|
| `auth:changed` | `UserProfile \| null` | `AuthService` | `ChainListService` 有 user 则 `load()` 否则清空；`NotificationService` 开/关轮询并清空 |
| `chain:changed` | `{ chainId: string; op: 'create' \| 'update' \| 'delete' }` | 建链 / 设置 / 邀请接受 | `ChainListService.load()`；`ChainHomeService` / `ChainSettingsService` 匹配 id 则重拉链 |
| `moment:changed` | `{ momentId: string; chainId: string; op: 'create' \| 'update' \| 'delete' \| 'react' }` | 发布 / 编辑 / 删除 / 反应 | 首页、链页 `loadFirst`+`loadMeta`；详情页按 §4.4 |
| `comment:changed` | `{ momentId: string }` | 加评 / 删评 | 同上（评论数在 moment 上） |
| `notification:changed` | `undefined` | 通知页手动刷新 | `NotificationService.loadFirst()`（`markAllRead` 不发此事件，直接本地更新） |

不发 `user:updated` 去刷时间线头像。Service **不**互相调用对方的 `load()`，只发事件。

## 6. 仍留在 React 里的

- 路由：`useParams` / `useNavigate` / `useMatch` / `?compose=1` effect。
- 媒体 blob：`useMediaObjectUrl`。
- 纯 UI：Rail 抽屉 `open`、FAB 滚出显隐、菜单坐标、灯箱开关可以在 `MomentSheetService.lightbox`（业务：哪一张）但 Rail 抽屉不上 Service。

组件保持傻：不在 render 里 filter feed、不在 effect 里链式 `setState` 提交。

## 7. 入口

```tsx
// main.tsx
register(AuthService); // 必须排首：ChainListService / NotificationService 构造里 resolve 它
register(ThemeService);
register(ChainListService);
register(NotificationService);
register(ComposeSessionService);

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <RSRoot>
        <App />
      </RSRoot>
    </BrowserRouter>
  </StrictMode>,
);
```

`RSRoot`（= `bindServices(Empty, [])`）给整棵树一个根容器。没有它，任何不在 `bindServices` 内的 `useService`（`App`、`Shell` 等）会走库的兼容分支 fallback 到全局容器，并打 `[WARN] 兼容模式` 日志；且该分支下 `useService` 遇到未注册的 Service 会**静默在全局注册它**——漏写 `bindServices` 的页面 Service 会无声变成全局单例、永不销毁，直接破坏成功标准 3。挂了 `RSRoot` 后整树 resolve 链可达全局容器。是否再上 `RSStrict`（漏绑直接 throw）在实现第 1 步验证与全局 `register` 的组合，可用就开。

去掉 `QueryClientProvider`、`AuthProvider`。`App` 只挂路由、不读 observable，不需要 `observer`；不再包 `ComposeProvider`。依赖从 `apps/web/package.json` 删除 `@tanstack/react-query`。

## 8. 错误

- API 失败抛给 `$model.method.error`。组件读它。不平行维护一份 `useState` 错误位。
- 表单错误留在面板内。无全局 toast。
- 列表：`$model.loadFirst.error` +「再试一次」= 再调 `loadFirst()`。
- `logout` 的 revoke 可吞；token 失效走 `moment:auth-cleared`。
- 人话错误仍走现有 `lib/errors.ts`，不在 Service 里翻译一套新的。

## 9. 迁移顺序

不平行养 RQ + rab。搬目录和改状态同一刀，每刀切完能开机。

1. 入口 + `RSRoot` + `AuthService` + `ThemeService`，拆 `AuthProvider`；`App` 的主题 effect 搬走。此步验证 `RSStrict` 可用性。
2. `ComposeSessionService`，拆 `ComposeContext`。
3. `ChainListService` + `NotificationService`；Shell 侧栏/未读下 RQ。
4. 首页 + 链页挪到 `pages/feed-home`、`pages/chain-home`；Rail 改受控；feed 下 RQ。
5. 详情 + `MomentSheetService`；评论两套缓存拆开。
6. 设置 / 我的 / 登录注册 / 邀请 / 分享相册，按教科书目录落地。
7. 删 `@tanstack/react-query` 与 `api/keys.ts`；改 `apps/web/CLAUDE.md`。

## 10. 验收

- 成功标准 §0 的 1–5。
- 控制台无 `[WARN] 兼容模式`（证明所有 `useService` 都在容器树内，没有静默全局化）。
- 冷启动（带缓存登录态刷新）：侧栏链表与通知未读数直接就有，不依赖 `client.me()` 成功。
- 通知页往下翻几页后停留 >30s：列表不被轮询重置，`loadMore` 仍接得上。
- 手测：登录 → 首页筛选 / 跳月 / 加载更多 → 发布生长动画 → 链页 / 设置 → 详情评论 → 通知未读角标与列表一致 → 登出回登录 → 分享页恒浅。
- 回归：viewer 不见「记下」；`?compose=1` 打开面板并从 URL 清掉；改筛选出现「没有符合条件的时刻」+ 清除筛选。

web 现无测试 runner，本轮不新加。
