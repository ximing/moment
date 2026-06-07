# Web 状态迁移 rab（@rabjs/react）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web` 的全部业务状态从 React Context + TanStack Query 迁到 `@rabjs/react`（全局 `register` / 页面与组件 `bindServices` 三层），目录改成 rab 教科书形态。

**Architecture:** 五个全局 Service（Auth/Theme/ChainList/Notification/ComposeSession）在 `main.tsx` `register`；页面与组件 Service 用 `bindServices` 绑生命周期；跨域刷新一律走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`）。HTTP 仍走 `src/api/client.ts` 的 `client` 单例。**发射方先迁、收听方后迁**：每个迁移后的写操作组件在最终清理任务前同时保留 `queryClient.invalidateQueries` 与 emit，保证任何中间态整机可开机。

**Tech Stack:** `@rabjs/react@^9.2.0`（已在依赖）、react-router v7、Vite。删除 `@tanstack/react-query`。

**Spec:** `docs/superpowers/specs/2026-08-17-web-rab-state-design.md`（契约听 spec；冲突以 spec 为准）

## Global Constraints

- **web 无测试 runner（spec §10），本轮不新加**。每个任务的验证 = `pnpm --filter @moment/web typecheck` + `pnpm --filter @moment/web lint` + `pnpm --filter @moment/web dev` 手测清单。不许在验证前 commit。
- 每 Task 一个 commit，conventional：`feat(web): ...` / `refactor(web): ...`。
- 每刀切完必须能开机：任何时刻 `pnpm dev` 可起、登录后主流程可用。
- **中间态铁律（本计划核心）**：迁移后的写操作组件（发布/评论/反应/删除/设置/建链/邀请）在成功回调里**同时** `emit(..., 'global')` **和** `queryClient.invalidateQueries(...)`（从 `@/api/query-client` import 单例）。emit 供已迁移的 Service 听，invalidate 供还没迁移的 RQ 页面听。Task 14 统一摘掉 invalidate。
- 读 Service 的组件必须是 `observer(...)` 或被 `bindServices` 包过；**禁止解构 observable**（`const { user } = service` ❌，`service.user` ✅）。
- Service 方法不写 `@Action` 装饰器（方法默认即 action）；全局 Service 禁止 `bindServices`。
- 必须及时释放的资源（blob URL、`setInterval`）**不放** Service `destroy()`——容器销毁靠 GC（FinalizationRegistry），时机不可控（spec §5）。blob revoke 走显式路径；全局 Service 的 interval 随 `auth:changed` 登出关。
- CSS 硬约束（`.claude/rules/web-ui.md`）：改 `apps/web/src/**` 必须走 token；`var()` 色值透明度修饰用 `color-mix`；本计划不改视觉，JSX 结构与类名原样搬。
- 事件 payload 契约（spec §5，名字/形状不得改）：
  - `auth:changed` → `UserProfile | null`
  - `chain:changed` → `{ chainId: string; op: 'create' | 'update' | 'delete' }`
  - `moment:changed` → `{ momentId: string; chainId: string; op: 'create' | 'update' | 'delete' | 'react' }`
  - `comment:changed` → `{ momentId: string }`
- 路由表不变（path 一字不改）；`/chains/:chainId/compose` 仍重定向 `?compose=1`。

## 迁移顺序总览（为什么是这个序）

发射方（Task 2–6）先上线 emit 并保留 invalidate；收听方（Task 7、10、11）后上线 `on(...)`。这样任何一刀切下去，RQ 页面靠 invalidate 刷新、已迁页面靠事件刷新，两边都活着。

| Task | 内容 | 上线的东西 |
|---|---|---|
| 1 | 入口 + AuthService + ThemeService + RSRoot | 全局骨架、useAuth 兼容 shim |
| 2 | ComposeSessionService + 拆 ComposeContext | `moment:changed` 发射（现 ComposePanel） |
| 3 | moment 详情页 + moment-sheet | 页面/组件 Service 范式、`comment:changed` 发射 |
| 4 | chain-settings 页 | `chain:changed` 发射 |
| 5 | create-chain-dialog | `chain:changed` 发射 |
| 6 | invite 页 | `chain:changed` 发射 |
| 7 | ChainList + Notification + Shell + 通知页 | 全局听众上线 |
| 8 | me 页 | — |
| 9 | login / register 页 | — |
| 10 | feed-home 页 + lib/feed.ts + ui/Empty | `moment:changed` 听众 |
| 11 | chain-home 页 | 听众 |
| 12 | share-album 页 | — |
| 13 | compose-panel 完整服务化 | 草稿进 Service、blob 显式 revoke |
| 14 | 清理：卸 RQ、删 keys/shim、改 CLAUDE.md、DoD | 终态 |

---

### Task 1: 全局骨架——入口 + AuthService + ThemeService

**Files:**
- Create: `apps/web/src/services/auth.service.ts`
- Create: `apps/web/src/services/theme.service.ts`
- Create: `apps/web/src/api/query-client.ts`
- Create: `apps/web/src/shell/require-auth.tsx`（从 `auth/RequireAuth.tsx` 挪来并改造）
- Delete: `apps/web/src/auth/RequireAuth.tsx`
- Modify: `apps/web/src/auth/AuthProvider.tsx`（变成 useAuth shim）
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/ui/ThemeToggle.tsx`

**Interfaces:**
- Consumes: `client` / `tokenStore` / `cachedUser` / `cacheUser`（`@/api/client`，已有）；`getThemeChoice` / `setThemeChoice` / `subscribeSystemTheme`（`@/lib/theme`，已有）。
- Produces（后续所有 Task 依赖）:
  - `class AuthService extends Service`：`user: UserProfile | null`；`login(input: LoginInput): Promise<void>`；`register(input: RegisterInput): Promise<void>`；`logout(): Promise<void>`；`applyAuth(res: AuthResponse): void`；`refreshUser(next: UserProfile): void`。
  - `class ThemeService extends Service`：`choice: ThemeChoice`；`setChoice(choice: ThemeChoice): void`。
  - `queryClient`（`@/api/query-client`，`QueryClient` 单例——中间态 invalidate 用，Task 14 删）。
  - `useAuth(): AuthService`（`@/auth/AuthProvider` 暂留文件路径的 shim，返回值接口与原 context 值完全一致；Task 14 删）。
  - `RequireAuth`（`@/shell/require-auth`）。

- [ ] **Step 1: 建 `api/query-client.ts`（QueryClient 单例提出 main）**

```ts
import { QueryClient } from '@tanstack/react-query';

/** 过渡期单例：AuthService 与迁移中的组件需要 invalidate RQ 缓存（main.tsx 不再是唯一持有者）。
 *  Task 14 随 @tanstack/react-query 一起删除。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});
```

- [ ] **Step 2: 建 `services/auth.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { cacheUser, cachedUser, client, tokenStore } from '@/api/client';
import { queryClient } from '@/api/query-client';

/** 全局认证态（spec §3.1）。localStorage 水合在字段初始化，事件单路径收敛在 onAuthCleared。 */
export class AuthService extends Service {
  user: UserProfile | null = cachedUser();

  constructor() {
    super();
    // refresh 彻底失效 → Http 调 tokenStore.clear() → web tokenStore 派发 'moment:auth-cleared'。
    // 登出（logout）也走这条路径收敛内存态：单一路径，不双发 auth:changed（spec §3.1）。
    window.addEventListener('moment:auth-cleared', () => {
      this.user = null;
      queryClient.clear(); // 过渡期：RQ 缓存随会话作废；Task 14 删
      this.emit('auth:changed', null, 'global');
    });
    // 每次进站重拉 /me，换发 6 天头像链接（缓存里的旧签名会过期）；失败保持缓存态
    if (this.user) {
      void client.me().then((next) => this.refreshUser(next)).catch(() => undefined);
    }
  }

  applyAuth(res: AuthResponse): void {
    tokenStore.setTokens(res.tokens);
    cacheUser(res.user);
    queryClient.clear(); // 换会话即换缓存
    this.user = res.user;
    this.emit('auth:changed', res.user, 'global');
  }

  async login(input: LoginInput): Promise<void> {
    this.applyAuth(await client.login(input));
  }

  async register(input: RegisterInput): Promise<void> {
    this.applyAuth(await client.register(input));
  }

  async logout(): Promise<void> {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    tokenStore.clear(); // 派发 moment:auth-cleared → 上面的 listener 置空 + emit
  }

  refreshUser(next: UserProfile): void {
    cacheUser(next);
    this.user = next;
    this.emit('auth:changed', next, 'global');
  }
}
```

- [ ] **Step 3: 建 `services/theme.service.ts`**

```ts
import { Service } from '@rabjs/react';
import { getThemeChoice, setThemeChoice, subscribeSystemTheme, type ThemeChoice } from '@/lib/theme';

/** 全局主题态（spec §3.2）。分享页恒浅规则留在 lib/theme 的 applyTheme 里，不进 Service。 */
export class ThemeService extends Service {
  choice: ThemeChoice = getThemeChoice();

  constructor() {
    super();
    // system 跟随订阅挂在全局单例构造：应用存续期不解绑（原 App.tsx 的 effect 搬家）
    subscribeSystemTheme();
  }

  setChoice(choice: ThemeChoice): void {
    setThemeChoice(choice);
    this.choice = choice;
  }
}
```

- [ ] **Step 4: 改 `main.tsx`——register + RSRoot**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { RSRoot, register } from '@rabjs/react';
import { App } from './App';
import { queryClient } from './api/query-client';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import './index.css';

// AuthService 必须排首：ChainListService / NotificationService 构造里 resolve 它（Task 7 起）
register(AuthService);
register(ThemeService);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RSRoot>
          <App />
        </RSRoot>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

RSRoot 给整棵树一个根容器：没有它，容器外的 `useService` 走库的兼容分支（console 打 `[WARN] 兼容模式`），且未注册的 Service 会被**静默注册成全局单例**（spec §7）。

- [ ] **Step 5: 改 `App.tsx`——删主题 effect 与 RequireAuth import 路径**

改动两处，其余不动：

```tsx
// 删：import { useEffect } from 'react';（若无其他使用）
// 删：import { subscribeSystemTheme } from '@/lib/theme';
// 删：App 函数体里的 useEffect(subscribeSystemTheme)（搬进了 ThemeService 构造）
// import { RequireAuth } from '@/auth/RequireAuth';  改为：
import { RequireAuth } from '@/shell/require-auth';
```

`ComposeProvider` 本 Task 不动（Task 2 拆）。

- [ ] **Step 6: 挪 `auth/RequireAuth.tsx` → `shell/require-auth.tsx` 并改 observer**

```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 未登录跳 /login，登录后回跳原地址（state.from）。 */
export const RequireAuth = observer(function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  const location = useLocation();
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});
```

- [ ] **Step 7: 改 `auth/AuthProvider.tsx` 为 useAuth shim（其余消费方零改动）**

整个文件替换为：

```ts
import { useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 过渡 shim：接口与原 useAuth 一致，实现委托全局 AuthService（spec §3.1）。
 *  ⚠️ 返回的是 Service 实例，消费方未包 observer 时读 auth.user 不会触发重渲——
 *  未迁移页面（表单类，user 只作一次判空）可接受；Task 14 删本文件。 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthService {
  return useService(AuthService);
}
```

- [ ] **Step 8: `git mv shell/UserMenu.tsx shell/user-menu.tsx` 并改头部（observer 化；Shell 的 import 同步改）**

UserMenu 是登出后必须即时反映的组件，本 Task 迁掉；内部 props 传递结构不动：

```tsx
// import { useAuth } from '@/auth/AuthProvider';  删
import { observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

// export function UserMenu({ unread, compact }: ...)  改为：
export const UserMenu = observer(function UserMenu({ unread, compact }: { unread: number; compact?: boolean }) {
  const auth = useService(AuthService);
  // const { user, logout } = useAuth();  删，后续引用改为：
  //   user   → auth.user
  //   logout → auth.logout
  ...原 JSX 不动
});
```

`SidebarUserMenu` / `UserMenuItems` 的 `logout: () => Promise<unknown>` prop 不变，传 `auth.logout`。

- [ ] **Step 9: 改 `ui/ThemeToggle.tsx` 读 ThemeService**

```tsx
import { observer, useService } from '@rabjs/react';
import { ThemeService } from '@/services/theme.service';
import type { ThemeChoice } from '@/lib/theme';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

/** 三态分段主题开关：受控于全局 ThemeService（spec §3.2）。 */
export const ThemeToggle = observer(function ThemeToggle() {
  const theme = useService(ThemeService);
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="主题">
      {OPTIONS.map((o) => {
        const active = theme.choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => theme.setChoice(o.value)}
            className={`rounded-sticker px-3 py-1.5 text-sm ${
              active ? 'bg-select text-select-fg' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
});
```

- [ ] **Step 10: 验证 RSStrict 可用性（spec §7 预留决策点）**

在 `main.tsx` 的 `<RSRoot>` 外再包一层 `<RSStrict>`（`import { RSRoot, RSStrict, register } from '@rabjs/react'`），起 dev。检查 console：
- 无 `[WARN] 兼容模式`、无 strict 报错 → **保留 RSStrict**（漏 bindServices 直接 throw，成功标准 3 的护栏）。
- 出现 strict 相关报错（全局 resolve 与 strict 组合问题）→ 移除 RSStrict，在本文件此步记录一行「RSStrict 不兼容，放弃」。

- [ ] **Step 11: 验证**

```bash
pnpm --filter @moment/web typecheck
pnpm --filter @moment/web lint
pnpm --filter @moment/web dev
```

手测：① 未登录访问 `/` → 踢 `/login`；② 登录 → 回跳；③ /me 换主题三态生效且刷新后保持；④ 退出（UserMenu）→ 踢 `/login`；⑤ console 无 `[WARN] 兼容模式`。

- [ ] **Step 12: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): 全局骨架——AuthService/ThemeService/register+RSRoot，拆主题与 RequireAuth"
```

---

### Task 2: ComposeSessionService + 拆 ComposeContext

**Files:**
- Create: `apps/web/src/services/compose-session.service.ts`
- Delete: `apps/web/src/compose/ComposeContext.tsx`
- Modify: `apps/web/src/App.tsx`（删 ComposeProvider）
- Modify: `apps/web/src/compose/ComposeFab.tsx` → 改名 `compose/compose-fab.tsx`
- Modify: `apps/web/src/compose/ComposerEntry.tsx` → 改名 `compose/composer-entry.tsx`
- Modify: `apps/web/src/compose/ComposePanel.tsx`（仅外壳与 submit 的 emit）
- Modify: `apps/web/src/timeline/Timeline.tsx` → 改名 `timeline/timeline.tsx`（spec §2）
- Modify: `apps/web/src/main.tsx`（register 追加）
- Modify: `apps/web/src/shell/Shell.tsx`（仅 `openCompose` 来源）

**Interfaces:**
- Consumes: Task 1 的骨架。
- Produces:
  - `interface ComposeRequest { chainId?: string; edit?: MomentResponse }`
  - `class ComposeSessionService extends Service`：`request: ComposeRequest | null`；`lastCreatedId: string | null`；`openCompose(req?: ComposeRequest): void`；`closeCompose(): void`；`markCreated(id: string): void`。

- [ ] **Step 1: 建 `services/compose-session.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';

export interface ComposeRequest {
  chainId?: string;
  edit?: MomentResponse;
}

/** 全局发布面板会话（spec §3.5）：取代 ComposeContext。FAB / 入口卡 / ?compose=1 / 生长动画共用。 */
export class ComposeSessionService extends Service {
  request: ComposeRequest | null = null;
  /** 发布成功的 moment id：时间线「从链节长出来」微动效（spec §1.6）。渲染期直读，不用 ref。 */
  lastCreatedId: string | null = null;

  openCompose(req?: ComposeRequest): void {
    // 下一次打开发布面板即自清，生长动画只作用于刚发布的那张卡
    this.lastCreatedId = null;
    this.request = req ?? {};
  }

  closeCompose(): void {
    this.request = null;
  }

  markCreated(id: string): void {
    this.lastCreatedId = id;
  }
}
```

- [ ] **Step 2: `main.tsx` register 追加（ThemeService 之后）**

```tsx
import { ComposeSessionService } from './services/compose-session.service';
// ...
register(ComposeSessionService);
```

- [ ] **Step 3: `git mv` 两个入口组件并改 `composer-entry.tsx` / `compose-fab.tsx`**

两个文件同一改法——`useCompose` 换 Service + observer。以 ComposerEntry 为例（ComposeFab 同型，`openCompose({ chainId })` 不变）：

```tsx
import { observer, useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';

/** 常驻 composer 入口：只是入口，点击显式打开 ComposePanel modal。挂在日子线上。 */
export const ComposerEntry = observer(function ComposerEntry({ chainId }: { chainId?: string }) {
  const composeSession = useService(ComposeSessionService);
  // onClick={() => openCompose({ chainId })}  改为：
  // onClick={() => composeSession.openCompose({ chainId })}
  ...原 JSX 不动
});
```

ComposeFab 的滚动显隐 `useState/useEffect` 是纯 UI，留在组件（spec §6）。

- [ ] **Step 4: 改 `ComposePanel.tsx` 外壳**

```tsx
import { observer, useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';

export const ComposePanel = observer(function ComposePanel() {
  const composeSession = useService(ComposeSessionService);
  if (!composeSession.request) return null;
  return <ComposeBody request={composeSession.request} onClose={composeSession.closeCompose} />;
});
```

`ComposeBody` 本 Task 不动（草稿 useState 留到 Task 13）。

- [ ] **Step 5: `ComposeBody.submit()` 成功路径加 emit（中间态铁律）**

`submit()` 里 `onClose()` 之前（原 `markCreated(res.id)` 处）：

```tsx
// const { markCreated } = useCompose();  删，文件头加：
// import { useService } from '@rabjs/react';
// import { ComposeSessionService } from '@/services/compose-session.service';
// import { queryClient } from '@/api/query-client';
// ComposeBody 函数体：const composeSession = useService(ComposeSessionService);

// 原 markCreated(res.id);  改为：
composeSession.markCreated(res.id);
// emit 供已迁移的 feed Service 听（Task 10 起）；invalidate 供未迁移的 RQ 页面听（Task 14 摘）
composeSession.emit(
  'moment:changed',
  { momentId: res.id, chainId, op: 'create' },
  'global',
);
```

编辑分支（`edit` 存在时）在 `client.updateMoment` 成功后同样补：

```tsx
composeSession.emit(
  'moment:changed',
  { momentId: edit.id, chainId: edit.chainId, op: 'update' },
  'global',
);
```

原有的 `queryClient.invalidateQueries(...)` 四行**保留**（`useQueryClient()` 换成 import 的 `queryClient`）。

- [ ] **Step 6: `git mv timeline/Timeline.tsx timeline/timeline.tsx` 并改读 lastCreatedId**

```tsx
import { observer, useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';

// export function Timeline({...})  改为：
export const Timeline = observer(function Timeline({...}: {...原类型...}) {
  ...
  // const { lastCreatedId } = useCompose();  删，改为：
  const composeSession = useService(ComposeSessionService);
  // renderSheet 里 m.id === lastCreatedId  改为  m.id === composeSession.lastCreatedId
  ...原 JSX 不动
});
```

- [ ] **Step 7: 改 `Shell.tsx`（仅 openCompose 来源）+ 删 ComposeProvider**

Shell：

```tsx
// import { useCompose } from '@/compose/ComposeContext';  删，加：
import { useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';
// export function Shell()  改为 export const Shell = observer(function Shell() {
//   const { openCompose } = useCompose();  改为：
const composeSession = useService(ComposeSessionService);
//   ?compose=1 effect 里 openCompose({ chainId })  改为 composeSession.openCompose({ chainId })
```

`App.tsx`：删 `ComposeProvider` import 与包裹（`<Routes>` 直接返回）。

删除 `apps/web/src/compose/ComposeContext.tsx`。全仓 `grep -rn "ComposeContext\|useCompose" apps/web/src` 应零命中。

- [ ] **Step 8: 验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 首页入口卡点开面板 → 关闭；② 滚下 240px 出 FAB → 点开；③ `?compose=1` 进链页自动开面板且 URL 清掉；④ 发布一条 → 面板关、新卡生长动画、时间线刷新；⑤ 编辑一条 → 刷新。

```bash
git add apps/web/src && git commit -m "feat(web): ComposeSessionService 取代 ComposeContext，发布 emit moment:changed"
```

---

### Task 3: moment 详情页 + MomentSheet 服务化

**Files:**
- Create: `apps/web/src/lib/events.ts`（全局事件 payload 契约，spec §5 事件表）
- Create: `apps/web/src/pages/moment/index.tsx`
- Create: `apps/web/src/pages/moment/moment.service.ts`
- Create: `apps/web/src/timeline/moment-sheet.tsx`（从 `timeline/MomentSheet.tsx` 搬，spec §2 平铺命名）
- Create: `apps/web/src/timeline/moment-sheet.service.ts`
- Delete: `apps/web/src/pages/MomentPage.tsx`、`apps/web/src/timeline/MomentSheet.tsx`
- Modify: `apps/web/src/App.tsx`（import 改 `@/pages/moment`）
- Modify: `apps/web/src/timeline/Timeline.tsx` → 改名 `timeline/timeline.tsx`（spec §2）（import 路径）

**Interfaces:**
- Consumes: Task 1 骨架；`humanError`（`@/lib/errors`）；`client`。
- Produces:
  - `class MomentPageService extends Service`：`momentId: string`；`moment: MomentResponse | null`；`comments: CommentDto[]`；`nextCursor: string | null`；`draft: string`；`hydrate(momentId: string): void`；`loadMoment(): Promise<void>`；`loadFirstComments(): Promise<void>`；`loadMoreComments(): Promise<void>`；`submitComment(): Promise<void>`；`deleteComment(id: string): Promise<void>`；`get hasMore(): boolean`。
  - `MomentSheet`（`@/timeline/moment-sheet`，props 与原完全一致，多包了 `bindServices`）。

- [ ] **Step 1: 建 `lib/events.ts`（事件 payload 契约）**

```ts
// lib/events.ts —— 全局事件 payload 契约（spec §5 事件表；发射与监听双方都从这里 import）。
// 注：auth:changed 的 payload 直接用 `UserProfile | null`（@moment/dto），不另设类型。

export type MomentChangedPayload = {
  momentId: string;
  chainId: string;
  op: 'create' | 'update' | 'delete' | 'react';
};
export type CommentChangedPayload = { momentId: string };
export type ChainChangedPayload = { chainId: string; op: 'create' | 'update' | 'delete' };
```

- [ ] **Step 2: 建 `pages/moment/moment.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { CommentDto, MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { queryClient } from '@/api/query-client';
import type { MomentChangedPayload, CommentChangedPayload } from '@/lib/events';

/** 详情页状态（spec §4.4）：moment + 评论分页 + 草稿。写成功 emit，不直接拉别人的缓存。 */
export class MomentPageService extends Service {
  momentId = '';
  moment: MomentResponse | null = null;
  deleted = false; // 收到本条 delete 事件：页面显示「没有这条」（区别于加载失败）
  comments: CommentDto[] = [];
  nextCursor: string | null = null;
  draft = '';
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      (p: MomentChangedPayload) => {
        if (p.momentId !== this.momentId) return;
        if (p.op === 'delete') {
          this.moment = null;
          this.deleted = true;
          return;
        }
        void this.loadMoment();
      },
      'global',
    );
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        if (p.momentId !== this.momentId) return;
        void this.loadFirstComments();
        void this.loadMoment(); // 刷新评论数
      },
      'global',
    );
  }

  /** 路由 param 进来；幂等挡 StrictMode 双调用 */
  hydrate(momentId: string): void {
    if (this.momentId === momentId) return;
    this.momentId = momentId;
    this.moment = null;
    this.deleted = false;
    this.comments = [];
    this.nextCursor = null;
    void this.loadMoment();
    void this.loadFirstComments();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadMoment(): Promise<void> {
    const m = await client.getMoment(this.momentId);
    this.moment = m;
  }

  async loadFirstComments(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listComments(this.momentId, { cursor: undefined, limit: 50 });
    if (gen !== this.gen) return; // 过期响应丢弃（spec §4.1）
    this.comments = page.comments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMoreComments(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listComments(this.momentId, { cursor: this.nextCursor, limit: 50 });
      if (gen !== this.gen) return;
      this.comments = [...this.comments, ...page.comments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async submitComment(): Promise<void> {
    const text = this.draft.trim();
    if (!text) return;
    await client.createComment(this.momentId, text);
    this.draft = '';
    // 过渡期：RQ 页面（feed/链页未迁）还靠 invalidate 刷新（Task 14 摘）。
    // ['feed'] 前缀覆盖 feed + month-index；['chains'] 前缀覆盖链页 chainMoments/链详情。
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
  }

  async deleteComment(id: string): Promise<void> {
    await client.deleteComment(id);
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
  }
}
```

- [ ] **Step 3: 建 `pages/moment/index.tsx`**（原 `MomentPage.tsx` 的 JSX 平移，数据源换 Service）

```tsx
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Timeline } from '@/timeline/Timeline';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { MomentPageService } from './moment.service';

const MomentPageContent = observer(function MomentPageContent() {
  const { momentId = '' } = useParams();
  const service = useService(MomentPageService);
  const auth = useService(AuthService);

  useEffect(() => {
    service.hydrate(momentId);
  }, [service, momentId]);

  // 三态判定（防 hydrate effect 首帧闪错误态：effect 跑起来前 loading 为 false）：
  //   骨架 = 无 moment 且（加载中 或 既无错也未删）；横幅 = 无 moment 且（加载失败或已删）
  const loadErr = service.$model.loadMoment.error;
  if (!service.moment && (service.$model.loadMoment.loading || (!loadErr && !service.deleted))) {
    // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
    return <div className="max-w-content h-40 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  }
  if (!service.moment) {
    return (
      <div className="max-w-content">
        <Banner
          action={loadErr && !service.$model.loadMoment.loading ? { label: '重试', onClick: () => void service.loadMoment() } : undefined}
        >
          看不到这条时刻
        </Banner>
      </div>
    );
  }
  const moment = service.moment;

  function onSubmit(e: import('react').FormEvent) {
    e.preventDefault();
    if (!service.draft.trim()) return;
    void service.submitComment().catch(() => undefined); // 错误读 $model.submitComment.error
  }

  return (
    <div className="max-w-content space-y-6">
      <Link to={`/chains/${moment.chainId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        回链
      </Link>
      <Timeline
        moments={[moment]}
        isPending={false}
        isError={false}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => undefined}
        empty={null}
      />
      <section>
        {/* 「评论」不在得意黑字形子集内，不用 font-display */}
        <h2 className="mb-3 text-lg font-medium">评论</h2>
        <ul className="space-y-3">
          {service.comments.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-surface p-3 text-sm shadow-sticker">
              <span className="font-medium">{c.author.nickname}</span>
              <span className="ml-2">{c.content}</span>
              {auth.user?.id === c.author.id && (
                <button type="button" className="ml-2 text-xs text-danger" onClick={() => void service.deleteComment(c.id)}>
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
        {service.hasMore && (
          <button type="button" className="mt-2 text-sm text-muted" onClick={() => void service.loadMoreComments()}>
            更早的评论
          </button>
        )}
        {service.$model.submitComment.error && (
          <div className="mt-3">
            <Banner>{humanError(service.$model.submitComment.error)}</Banner>
          </div>
        )}
        {service.$model.deleteComment.error && (
          <div className="mt-3">
            <Banner>{humanError(service.$model.deleteComment.error)}</Banner>
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-4 space-y-2">
          <Textarea
            value={service.draft}
            onChange={(e) => (service.draft = e.target.value)}
            placeholder="写一句…"
            rows={3}
          />
          <Button type="submit" disabled={service.$model.submitComment.loading || !service.draft.trim()}>
            发送
          </Button>
        </form>
      </section>
    </div>
  );
});

export const MomentPage = bindServices(MomentPageContent, [MomentPageService]);
```

- [ ] **Step 4: 建 `timeline/moment-sheet.service.ts`（每卡一实例，spec §4.8）**

```ts
import { Service } from '@rabjs/react';
import type { CommentDto, MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { queryClient } from '@/api/query-client';
import type { CommentChangedPayload } from '@/lib/events';

/** 单卡状态（spec §4.8）：灯箱/评论展开/删除确认 + 评论预览（limit 20，与详情页不是同一份）。 */
export class MomentSheetService extends Service {
  lightboxIndex: number | null = null;
  showComments = false;
  confirmDel = false;
  moment: MomentResponse | null = null;
  preview: CommentDto[] = [];
  previewText = '';
  private loaded = false;

  hydrate(moment: MomentResponse): void {
    this.moment = moment;
  }

  /** 展开评论时按需拉（幂等：同卡只拉一次，后续靠 comment:changed 事件刷新） */
  async loadPreview(): Promise<void> {
    if (!this.moment || this.loaded) return;
    this.loaded = true;
    const page = await client.listComments(this.moment.id, { limit: 20 });
    this.preview = page.comments;
  }

  async refreshPreview(): Promise<void> {
    if (!this.moment || !this.loaded) return;
    const page = await client.listComments(this.moment.id, { limit: 20 });
    this.preview = page.comments;
  }

  async react(emoji: string): Promise<void> {
    const m = this.moment!;
    if (m.myReaction === emoji) await client.removeReaction(m.id);
    else await client.setReaction(m.id, emoji);
    // 过渡期 invalidate（Task 14 摘）：['feed'] 前缀覆盖 feed + month-index，
    // ['chains'] 前缀覆盖链页 chainMoments/链详情（等价原 touch() 的三个 key）
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    this.emit('moment:changed', { momentId: m.id, chainId: m.chainId, op: 'react' }, 'global');
  }

  async remove(): Promise<void> {
    const m = this.moment!;
    await client.deleteMoment(m.id);
    this.confirmDel = false;
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    this.emit('moment:changed', { momentId: m.id, chainId: m.chainId, op: 'delete' }, 'global');
  }

  async submitPreviewComment(): Promise<void> {
    const m = this.moment!;
    const text = this.previewText.trim();
    if (!text) return;
    await client.createComment(m.id, text);
    this.previewText = '';
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    this.emit('comment:changed', { momentId: m.id }, 'global');
  }

  constructor() {
    super();
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        if (this.moment && p.momentId === this.moment.id) void this.refreshPreview();
      },
      'global',
    );
  }
}
```

（卡片自身的 `moment` 数据永远由父层重传 prop——feed 重拉后 prop 即新值，Service 无需监听 `moment:changed` 改卡。）

- [ ] **Step 5: 建 `timeline/moment-sheet.tsx`**（原 `MomentSheet.tsx` JSX 平移）

改动点（其余 JSX 原样搬）：

```tsx
import { bindServices, observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { humanError } from '@/lib/errors';
import { MomentSheetService } from './moment-sheet.service';

// export function MomentSheet({...})  改为：
const MomentSheetContent = observer(function MomentSheetContent({
  moment: momentProp,
  chainName,
  chainColor,
  chainIcon,
  shareToken,
  readOnly,
  hideKnot,
}: {
  ...与原 props 类型完全一致...
}) {
  const service = useService(MomentSheetService);
  const auth = useService(AuthService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(momentProp);
  }, [service, momentProp]);

  const moment = momentProp; // 卡片渲染永远用父层传入的最新数据（feed 重拉后 prop 已是新值）
  const mine = auth.user?.id === moment.author.id;
  // 原三个 useState 全删，替换：
  //   lightbox        → service.lightboxIndex（setLightbox → service.lightboxIndex = n / null）
  //   showComments    → service.showComments
  //   confirmDel      → service.confirmDel
  // 评论展开 effect：setShowComments(true) 时调 service.loadPreview()
  // react.mutate(emoji)   → void service.react(emoji)
  // remove.mutate()       → void service.remove()
  // openCompose({ chainId, edit }) → composeSession.openCompose({ chainId, edit })
  // CommentPreview 整块并入本组件渲染：comments=service.preview、text=service.previewText
  ...原 JSX 不动
});

export const MomentSheet = bindServices(MomentSheetContent, [MomentSheetService]);
```

原 `CommentPreview` 子组件删除，其 JSX（前 3 条 + 查看全部 + 表单）内联到 `showComments` 分支，数据源改 `service.preview` / `service.previewText`，提交按钮 `disabled={service.$model.submitPreviewComment.loading || !service.previewText.trim()}`，错误 `<Banner>{humanError(service.$model.submitPreviewComment.error)}</Banner>`。

- [ ] **Step 6: 引用切换 + 删旧文件**

- `App.tsx`：`import { MomentPage } from '@/pages/MomentPage'` → `@/pages/moment`。
- `Timeline.tsx`：`import { MomentSheet } from './MomentSheet'` → `@/timeline/moment-sheet'`。
- 删 `pages/MomentPage.tsx`、`timeline/MomentSheet.tsx`。

- [ ] **Step 7: 验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 详情页加载/发评论/删评论/加载更早；② 卡片表情反应 → 时间线卡片反应数刷新（RQ invalidate 仍在）；③ 卡片评论展开 → 预览 3 条 + 快速评论；④ 卡片删除 → 时间线消失；⑤ 别处 emit `comment:changed`（详情页发评论）→ 已展开的卡片预览刷新。

```bash
git add apps/web/src && git commit -m "feat(web): moment 详情页与 MomentSheet 服务化（每卡实例），emit moment/comment:changed"
```

---

### Task 4: chain-settings 页服务化

**Files:**
- Create: `apps/web/src/pages/chain-settings/index.tsx`（原 `pages/ChainSettingsPage.tsx` 的壳）
- Create: `apps/web/src/pages/chain-settings/sections.tsx`（原 `chain/ChainSettings.tsx` 的三个分区 + Danger）
- Create: `apps/web/src/pages/chain-settings/chain-settings.service.ts`
- Delete: `apps/web/src/pages/ChainSettingsPage.tsx`、`apps/web/src/chain/ChainSettings.tsx`
- Modify: `apps/web/src/App.tsx`（import 改 `@/pages/chain-settings`）

**Interfaces:**
- Consumes: Task 1 骨架；`canInvite` / `isOwner` / `roleLabel`（`@/lib/roles`）；`fallbackChainColor`（`@/lib/chain-color`）。
- Produces:
  - `class ChainSettingsService extends Service`：`chainId: string`；`chain: ChainDto | null`；成员/邀请/分享链接/标签各列表字段与表单字段（见 Step 1）；`hydrate(chainId: string): void`；写方法见 Step 1。
  - `ChainSettingsPage`（`@/pages/chain-settings`）。

- [ ] **Step 1: 建 `chain-settings.service.ts`**

原 `ChainSettings.tsx` 里三个分区的全部 `useQuery`/`useMutation`/`useState` 收进一个 Service（spec §4.5：同一次挂载同一次卸载，不按分区再 bindServices）：

```ts
import { Service } from '@rabjs/react';
import type { ChainColor, ChainDto, ChainIcon, ShareLinkDto } from '@moment/dto';
import { client } from '@/api/client';
import { queryClient } from '@/api/query-client';
import type { ChainChangedPayload } from '@/lib/events';

/** 设置页全部状态（spec §4.5）：链详情 + 成员 + 邀请 + 分享链接 + 资料表单 + 标签。 */
export class ChainSettingsService extends Service {
  chainId = '';
  chain: ChainDto | null = null;

  members: Awaited<ReturnType<typeof client.listMembers>> = [];
  invites: Awaited<ReturnType<typeof client.listInvites>> = [];

  shareLinks: ShareLinkDto[] = [];
  shareExpire: 'never' | '7' | '30' | 'date' = 'never';
  shareDate = '';
  revokeLinkId: string | null = null;

  // 资料表单
  formName = '';
  formDescription = '';
  formColor: ChainColor = 'coral';
  formIcon: ChainIcon | null = null;
  formHydrated = false;
  tags: Awaited<ReturnType<typeof client.listTags>>['tags'] = [];
  newTagName = '';

  // 成员操作
  transferId: string | null = null;
  transferName = '';
  inviteEmail = '';

  constructor() {
    super();
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后页面即将跳走
        void this.loadChain();
      },
      'global',
    );
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    // 先拉链（角色决定成员/邀请/分享的可见面），成功后再拉各分区数据
    void this.loadChain().then(() => {
      void this.loadMembers();
      void this.loadShareLinks();
      void this.loadTags();
    });
  }

  private invalidateRq(): void {
    // 过渡期：['chains'] 前缀失效同时覆盖 sidebar 的 ['chains'] 与链页/成员/标签
    // 的 ['chains', id, ...]；['feed'] 覆盖 feed + month-index（Task 14 删）
    queryClient.invalidateQueries({ queryKey: ['chains'] });
    queryClient.invalidateQueries({ queryKey: ['feed'] });
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.formHydrated && this.chain) {
      // 首载水合资料表单（之后用户改动不覆盖）
      this.formHydrated = true;
      this.formName = this.chain.name;
      this.formDescription = this.chain.description ?? '';
      this.formColor = this.chain.color ?? 'coral';
      this.formIcon = this.chain.icon;
    }
  }

  async loadMembers(): Promise<void> {
    this.members = await client.listMembers(this.chainId);
    const myRole = this.chain?.myRole;
    if (myRole === 'owner' || myRole === 'editor') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadShareLinks(): Promise<void> {
    if (!this.chain || this.chain.myRole !== 'owner') return;
    this.shareLinks = (await client.listShareLinks(this.chainId)).items;
  }

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
  }

  async saveProfile(): Promise<void> {
    await client.updateChain(this.chainId, {
      name: this.formName.trim(),
      description: this.formDescription.trim() || null,
      color: this.formColor,
      icon: this.formIcon,
    });
    this.invalidateRq();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async createShareLink(): Promise<void> {
    let expiresAt: string | undefined;
    if (this.shareExpire === '7') expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
    if (this.shareExpire === '30') expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
    if (this.shareExpire === 'date' && this.shareDate) expiresAt = new Date(this.shareDate).toISOString();
    await client.createShareLink(this.chainId, expiresAt ? { expiresAt } : {});
    await this.loadShareLinks();
  }

  async revokeShareLink(id: string): Promise<void> {
    await client.revokeShareLink(id);
    this.revokeLinkId = null;
    await this.loadShareLinks();
  }

  async changeRole(userId: string, role: 'editor' | 'viewer'): Promise<void> {
    await client.updateMemberRole(this.chainId, userId, role);
    await this.loadMembers();
  }

  async removeMember(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    await this.loadMembers();
    await this.loadChain();
  }

  async leaveChain(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    this.invalidateRq();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async transferChain(userId: string): Promise<void> {
    await client.transferChain(this.chainId, userId);
    this.transferId = null;
    this.transferName = '';
    await this.loadMembers();
    await this.loadChain();
  }

  async createInvite(): Promise<void> {
    await client.createInvite(this.chainId, { email: this.inviteEmail.trim() || undefined, role: 'editor' });
    this.inviteEmail = '';
    await this.loadMembers();
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async addTag(): Promise<void> {
    const name = this.newTagName.trim();
    if (!name) return;
    await client.createTag(this.chainId, name);
    this.newTagName = '';
    await this.loadTags();
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
  }

  async deleteChain(): Promise<void> {
    await client.deleteChain(this.chainId);
    this.invalidateRq();
    this.emit('chain:changed', { chainId: this.chainId, op: 'delete' }, 'global');
  }
}
```

错误展示：Service 方法抛错读 `$model.<method>.error`，各分区组件渲染 `humanError(service.$model.saveProfile.error)` 等（`humanError` 只对 API 错误用；设置页原有错误文案都是 API 路径，语义不变）。`leaveChain` / `deleteChain` 成功后的 `navigate('/')` 留在组件（路由不进 Service，spec §6）。

- [ ] **Step 2: 建 `index.tsx`（壳）**

```tsx
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Icon } from '@/ui/Icon';
import { ChainSettingsSections } from './sections';
import { ChainSettingsService } from './chain-settings.service';

const ChainSettingsPageContent = observer(function ChainSettingsPageContent() {
  const { chainId = '' } = useParams();
  const service = useService(ChainSettingsService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同 Task 3）：骨架 = 无 chain 且（加载中或无错）
  const chainErr = service.$model.loadChain.error;
  if (!service.chain && (service.$model.loadChain.loading || !chainErr)) {
    // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
    return <div className="h-32 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  }
  if (!service.chain) {
    return (
      <Banner action={chainErr && !service.$model.loadChain.loading ? { label: '重试', onClick: () => void service.loadChain() } : undefined}>
        看不到这条链，或它已经不在了
      </Banner>
    );
  }
  return (
    <div className="max-w-content">
      <Link to={`/chains/${service.chain.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        {service.chain.name}
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-medium">这条链</h1>
      <ChainSettingsSections />
    </div>
  );
});

export const ChainSettingsPage = bindServices(ChainSettingsPageContent, [ChainSettingsService]);
```

- [ ] **Step 3: 建 `sections.tsx`**（原 `ChainSettings.tsx` 的 ShareSection/MembersSection/ProfileSection/DangerSection + 顶部分区 tab）

顶部 `ChainSettings`（tab 切换）的 `section` useState 是纯 UI，留组件。三个分区组件全部改 `observer` + `useService(ChainSettingsService)`，`useQuery/useMutation/useState` 全部换成 Service 字段读写：

- `ShareSection`：`data?.items` → `service.shareLinks`；`expire/date/revokeId` → `service.shareExpire` 等；`create.mutate()` → `void service.createShareLink()`；错误 → `humanError(service.$model.createShareLink.error)`。
- `MembersSection`：`members/invites/email/transferId/transferName/copied` 中，`copied`（复制成功的 1.5s 高亮）留组件 `useState`（纯 UI 瞬时态）；其余换 Service。`leave.mutate()` 成功的 `navigate('/')` 写在组件：`void service.leaveChain(auth.user!.id).then(() => navigate('/'))`。
- `ProfileSection`：表单四字段 + `tagName` 换 Service（`service.formName` 等，onChange 直接赋值）；`save` → `void service.saveProfile()`。
- `DangerSection`：`open/typed` 两个 UI 态留组件；`del` → `void service.deleteChain().then(() => navigate('/')).catch(() => undefined)`。

JSX 结构与类名原样搬。

- [ ] **Step 4: 引用切换 + 删旧文件**

`App.tsx` import 改 `@/pages/chain-settings`；删 `pages/ChainSettingsPage.tsx`、`chain/ChainSettings.tsx`。全仓 `grep -rn "ChainSettings'" apps/web/src` 校验无残留旧路径。

- [ ] **Step 5: 验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 资料改名/换色保存 → 链页与侧栏刷新（RQ invalidate）；② 生成/吊销分享链接；③ 改成员角色/移除/转让（输链名确认）；④ 生成邀请/复制/吊销；⑤ 标签增删；⑥ 离开链、删除链 → 回首页。

```bash
git add apps/web/src && git commit -m "feat(web): 链设置页服务化，写操作 emit chain:changed"
```

---

### Task 5: create-chain-dialog 服务化

**Files:**
- Create: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Create: `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts`
- Delete: `apps/web/src/shell/CreateChainDialog.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`（import 路径）

**Interfaces:**
- Consumes: Task 1 骨架；`ChainLookPicker`（`@/chain/ChainLookPicker`）。
- Produces: `CreateChainDialog`（`@/shell/create-chain-dialog`，props 仍为 `{ onClose: () => void }`——开关是 Shell 本地 boolean，spec §4.7）。

- [ ] **Step 1: 建 service**

```ts
import { Service } from '@rabjs/react';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { client } from '@/api/client';
import { queryClient } from '@/api/query-client';

/** 建链对话框（spec §4.7）：表单 + submit；开关本身是 Shell 的本地 boolean。 */
export class CreateChainDialogService extends Service {
  name = '';
  description = '';
  color: ChainColor = 'coral';
  icon: ChainIcon | null = null;

  async submit(): Promise<string> {
    const chain = await client.createChain({
      name: this.name.trim(),
      visibility: 'private',
      description: this.description.trim() || undefined,
      color: this.color,
      icon: this.icon,
    });
    queryClient.invalidateQueries({ queryKey: ['chains'] }); // 过渡期（Task 14 摘）
    this.emit('chain:changed', { chainId: chain.id, op: 'create' }, 'global');
    return chain.id;
  }
}
```

- [ ] **Step 2: 建 index.tsx**（原 JSX 平移）

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChainLookPicker } from '@/chain/ChainLookPicker';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Field';
import { CreateChainDialogService } from './create-chain-dialog.service';

const CreateChainDialogContent = observer(function CreateChainDialogContent({ onClose }: { onClose: () => void }) {
  const service = useService(CreateChainDialogService);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null); // 名字为空等本地校验错误

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!service.name.trim()) {
      setError('给这条链起个名字');
      return;
    }
    void service
      .submit()
      .then((chainId) => {
        onClose();
        navigate(`/chains/${chainId}`);
      })
      .catch((e) => setError(humanError(e)));
  }

  // 原 JSX：name/description/color/icon 的 value/onChange 改 service 字段；
  // 提交按钮 disabled={service.$model.submit.loading}，文案 loading ? '创建中…' : '创建'
  // API 错误：{service.$model.submit.error && <Banner>{humanError(service.$model.submit.error)}</Banner>}
  // 其余原样（含遮罩 color-mix 与表单结构）
  ...
});

export const CreateChainDialog = bindServices(CreateChainDialogContent, [CreateChainDialogService]);
```

- [ ] **Step 3: Shell import 切换；删旧文件；验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：侧栏「开一条新的链」→ 建链成功 → 跳新链页、侧栏立刻出现新链（RQ invalidate + 事件双保险）。

```bash
git add apps/web/src && git commit -m "feat(web): 建链对话框服务化，emit chain:changed"
```

---

### Task 6: invite 页服务化

**Files:**
- Create: `apps/web/src/pages/invite/index.tsx`
- Create: `apps/web/src/pages/invite/invite.service.ts`
- Delete: `apps/web/src/pages/InvitePage.tsx`
- Modify: `apps/web/src/App.tsx`（import 改 `@/pages/invite`）

**Interfaces:**
- Consumes: Task 1 `AuthService`（未登录判断）。
- Produces: `InvitePage`（`@/pages/invite`）。

- [ ] **Step 1: 建 service**

```ts
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { queryClient } from '@/api/query-client';

/** 邀请接受页（spec §4.5）：已登录才可 accept；成功 emit chain:changed，不 applyAuth（邀请不换会话）。 */
export class InviteService extends Service {
  token = '';

  hydrate(token: string): void {
    this.token = token;
  }

  async accept(): Promise<string> {
    const res = await client.acceptInvite(this.token);
    queryClient.invalidateQueries({ queryKey: ['chains'] }); // 过渡期（Task 14 摘）
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    this.emit('chain:changed', { chainId: res.chainId, op: 'create' }, 'global');
    return res.chainId;
  }
}
```

- [ ] **Step 2: 建 index.tsx**（原 JSX 平移）

```tsx
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { InviteService } from './invite.service';

const InvitePageContent = observer(function InvitePageContent() {
  const { token } = useParams<{ token: string }>();
  const service = useService(InviteService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  // 原 JSX：接受按钮 onClick={() => void service.accept()
  //   .then((chainId) => navigate(`/chains/${chainId}`, { replace: true }))
  //   .catch((e) => setError(humanError(e)))}
  // disabled={service.$model.accept.loading}，文案 loading ? '加入中…' : '接受邀请'
  // API 错误 Banner 读 service.$model.accept.error；其余原样
  ...
});

export const InvitePage = bindServices(InvitePageContent, [InviteService]);
```

- [ ] **Step 3: 引用切换、删旧文件、验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 未登录打开邀请链接 → 踢登录 → 登录后回邀请页 → 接受 → 跳新链页且侧栏出现；② 失效邀请 → 错误文案。

```bash
git add apps/web/src && git commit -m "feat(web): 邀请页服务化，成功 emit chain:changed"
```

---

### Task 7: ChainListService + NotificationService + Shell + 通知页（听众上线）

**Files:**
- Create: `apps/web/src/services/chain-list.service.ts`
- Create: `apps/web/src/services/notification.service.ts`
- Create: `apps/web/src/pages/notifications/index.tsx`
- Delete: `apps/web/src/pages/NotificationsHome.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`（下 RQ，读两个全局 Service）
- Modify: `apps/web/src/main.tsx`（register 追加两个）

**Interfaces:**
- Consumes: Task 1–6 的 `auth:changed` / `chain:changed` 发射方已全部就位。
- Produces:
  - `class ChainListService extends Service`：`chains: ChainDto[]`；`load(): Promise<void>`。
  - `class NotificationService extends Service`：`items: NotificationDto[]`；`loadFirst(): Promise<void>`；`loadMore(): Promise<void>`；`pollUnread(): Promise<void>`；`markAllRead(): Promise<void>`；`get unreadCount(): number`；`get hasMore(): boolean`。
  - `NotificationsHome`（`@/pages/notifications`）。

- [ ] **Step 1: 建 `services/chain-list.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { ChainDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

/** 全局链列表（spec §3.3）：侧栏 / 首页链色表 / 发布选链共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];

  constructor() {
    super();
    // 冷启动兜底：不能只听 auth:changed——缓存登录态下 AuthService 构造不发事件、
    // me() 失败也不发，只听事件侧栏会一直空（spec §3.3）
    if (this.resolve(AuthService).user) void this.load();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) void this.load();
        else this.chains = [];
      },
      'global',
    );
    this.on('chain:changed', () => void this.load(), 'global');
  }

  async load(): Promise<void> {
    this.chains = await client.listChains();
  }
}
```

- [ ] **Step 2: 建 `services/notification.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { NotificationDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

const POLL_MS = 30_000;

/** 全局通知（spec §3.4）：Shell 未读数与通知页列表共享一份；轮询只 merge 不重置分页。 */
export class NotificationService extends Service {
  items: NotificationDto[] = [];
  nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // 冷启动兜底（与 ChainListService 同理）
    if (this.resolve(AuthService).user) this.startPolling();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) this.startPolling();
        else this.stopPolling();
      },
      'global',
    );
  }

  /** 全局单例随应用存续：interval 靠 auth:changed 关，不进 destroy()（spec §5） */
  private startPolling(): void {
    if (this.timer) return;
    void this.loadFirst();
    this.timer = setInterval(() => void this.pollUnread(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.items = [];
    this.nextCursor = null;
    this.gen++;
  }

  get unreadCount(): number {
    return this.items.filter((n) => n.readAt === null).length;
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listNotifications(undefined, { limit: 50 });
    if (gen !== this.gen) return; // 过期响应丢弃
    this.items = page.notifications;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listNotifications(undefined, { cursor: this.nextCursor, limit: 50 });
      if (gen !== this.gen) return;
      this.items = [...this.items, ...page.notifications];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** 30s 轮询专用（spec §3.4）：拉第一页 merge——新条目前置、已有条目按 id 换新（读态变化），
   *  不动 nextCursor、不丢用户已加载的分页。 */
  async pollUnread(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listNotifications(undefined, { limit: 50 });
    if (gen !== this.gen) return;
    const pageIds = new Set(page.notifications.map((n) => n.id));
    const older = this.items.filter((n) => !pageIds.has(n.id));
    this.items = [...page.notifications, ...older];
  }

  async markAllRead(): Promise<void> {
    const unreadIds: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listNotifications(undefined, { cursor, limit: 50 });
      unreadIds.push(...page.notifications.filter((n) => n.readAt === null).map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    for (let i = 0; i < unreadIds.length; i += 100) {
      await client.markNotificationsRead(unreadIds.slice(i, i + 100));
    }
    await this.loadFirst(); // 直接重拉，不发自发自收的 notification:changed（spec §3.4）
  }
}
```

- [ ] **Step 3: `main.tsx` register 追加（AuthService 已排首）**

```tsx
import { ChainListService } from './services/chain-list.service';
import { NotificationService } from './services/notification.service';
// ...
register(ChainListService);
register(NotificationService);
```

- [ ] **Step 4: 改 `Shell.tsx` 下 RQ**

```tsx
// 删：import { useQuery } from '@tanstack/react-query';
// 删：import { client } from '@/api/client';  与  import { qk } from '@/api/keys';
// 加：
import { useService } from '@rabjs/react';
import { ChainListService } from '@/services/chain-list.service';
import { NotificationService } from '@/services/notification.service';

// Shell 函数体内：
//   const { data: chains } = useQuery(...)  与  notifications useQuery(...)  两块删，改为：
const chainList = useService(ChainListService);
const notification = useService(NotificationService);
const chains = chainList.chains;
const unread = notification.unreadCount;
// 后续 chains / unread 引用不变
```

- [ ] **Step 5: 建 `pages/notifications/index.tsx`**（原 `NotificationsHome.tsx` 平移，无页面 Service，spec §2）

```tsx
import { Link } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { NotificationService } from '@/services/notification.service';
import { Button } from '@/ui/Button';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};

function payloadTitle(payload: Record<string, unknown>): string {
  for (const key of ['title', 'momentContent', 'content', 'chainName']) {
    const v = payload[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function hrefOf(payload: Record<string, unknown>): string | null {
  const momentId = payload.momentId;
  const chainId = payload.chainId;
  if (typeof momentId === 'string') return `/moments/${momentId}`;
  if (typeof chainId === 'string') return `/chains/${chainId}`;
  return null;
}

export const NotificationsHome = observer(function NotificationsHome() {
  const notification = useService(NotificationService);
  const items = notification.items;
  const unread = notification.unreadCount;

  // 原 JSX 平移：
  //   items.length === 0 && !q.isPending  →  items.length === 0 && !notification.$model.loadFirst.loading
  //   markAll 按钮 disabled={notification.$model.markAllRead.loading}
  //     onClick={() => void notification.markAllRead()}
  //   q.hasNextPage → notification.hasMore；fetchNextPage → void notification.loadMore()
  ...
});
```

`App.tsx` import 改 `@/pages/notifications`；删 `pages/NotificationsHome.tsx`。

- [ ] **Step 6: 验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 冷启动（已登录刷新）侧栏链表直接出来、未读角标在；② 通知页加载更多几页 → 停留 >30s → 列表不被重置、能继续加载（spec §10 关键回归）；③ 全部已读 → 角标消失且列表同步；④ 登出 → 角标清零、轮询停（Network 面板无 30s 请求）；⑤ 建链/改设置/接受邀请 → 侧栏即时刷新（走事件，不再靠 invalidate）。

```bash
git add apps/web/src && git commit -m "feat(web): ChainList/Notification 全局 Service + Shell 与通知页下 RQ"
```

---

### Task 8: me 页服务化

**Files:**
- Create: `apps/web/src/pages/me/index.tsx`
- Create: `apps/web/src/pages/me/me.service.ts`
- Delete: `apps/web/src/pages/MePage.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `AuthService.refreshUser`（Task 1）；`compressImage`（`@/lib/compress`）。
- Produces: `MePage`（`@/pages/me`）。

- [ ] **Step 1: 建 service**

```ts
import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { AuthService } from '@/services/auth.service';

/** 资料页（spec §4.5）：头像上传/清除 + 本地预览。上传成功走 auth.refreshUser。 */
export class MeService extends Service {
  preview: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async uploadAvatar(file: File): Promise<void> {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('图片太大了');
    const compressed = await compressImage(file);
    const res = await client.uploadMedia({
      file: compressed,
      mime: compressed.type,
      size: compressed.size,
      kind: 'image',
    });
    const next = await client.updateMe({ avatarMediaId: res.mediaId });
    this.preview = null;
    this.auth.refreshUser(next);
  }

  async clearAvatar(): Promise<void> {
    const next = await client.updateMe({ avatarMediaId: null });
    this.preview = null;
    this.auth.refreshUser(next);
  }

  setPreview(url: string): void {
    this.preview = url;
  }
}
```

预览 blob 的 `URL.revokeObjectURL`：上传/清除成功即覆盖 `preview = null`，原 URL 在下一次 `setPreview` 前自然回收页面级引用——沿用现状（现状同样不 revoke preview），不新增行为。

- [ ] **Step 2: 建 index.tsx**（原 `MePage.tsx` JSX 平移）

```tsx
const MePageContent = observer(function MePageContent() {
  const service = useService(MeService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!auth.user) return null;
  // 原 JSX：
  //   user → auth.user；preview → service.preview
  //   upload.mutate → void service.uploadAvatar(file).catch(() => undefined)
  //     错误 Banner：humanError(service.$model.uploadAvatar.error)
  //   clear.mutate → void service.clearAvatar()；错误读 $model.clearAvatar.error
  //   onChange 里 setPreview(URL.createObjectURL(file)) → service.setPreview(URL.createObjectURL(file))
  //   退出按钮：void auth.logout().then(() => navigate('/login'))
  //   主题区块 ThemeToggle 不变（Task 1 已迁）
  ...
});
export const MePage = bindServices(MePageContent, [MeService]);
```

- [ ] **Step 3: 引用切换、删旧文件、验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 上传头像 → 本页与 UserMenu 头像即时换；② 去掉头像；③ 超大图报「图片太大了」；④ 退出 → 登录页；⑤ 刷新后头像仍是新签发的 URL（`/me` 重拉链路未破坏）。

```bash
git add apps/web/src && git commit -m "feat(web): 我的页服务化，头像成功走 auth.refreshUser"
```

---

### Task 9: login / register 页服务化

**Files:**
- Create: `apps/web/src/pages/login/index.tsx` + `apps/web/src/pages/login/login.service.ts`
- Create: `apps/web/src/pages/register/index.tsx` + `apps/web/src/pages/register/register.service.ts`
- Create: `apps/web/src/pages/auth-frame.tsx`（原 `AuthPages.tsx` 底部的 `AuthFrame`，两页共用）
- Delete: `apps/web/src/pages/AuthPages.tsx`
- Modify: `apps/web/src/App.tsx`（两处 import）

**Interfaces:**
- Consumes: `AuthService.login/register`（Task 1）；`loginInputSchema` / `registerInputSchema`（`@moment/dto`）。
- Produces: `LoginPage`、`RegisterPage`。

- [ ] **Step 1: 建 login service**

⚠️ 校验留在组件（与原代码同位）：`humanError` 对普通 `Error` 走 COPY 表回退（`lib/errors.ts:34-37`），service 里 `throw new Error('请填写正确的邮箱和密码')` 会被吃成「出了点问题，请重试」，丢原文案。

```ts
import { Service } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 登录页（spec §4.5）：表单字段 + 调 auth.login；schema 校验与跳转留在组件。 */
export class LoginService extends Service {
  email = '';
  password = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).login({ email: this.email, password: this.password });
  }
}
```

- [ ] **Step 2: 建 `pages/login/index.tsx`**（原 LoginPage JSX 平移）

```tsx
const LoginPageContent = observer(function LoginPageContent() {
  const service = useService(LoginService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginInputSchema.safeParse({ email: service.email, password: service.password });
    if (!parsed.success) {
      setError('请填写正确的邮箱和密码');
      return;
    }
    setError(null);
    void service
      .submit()
      .then(() => navigate(location.state?.from ?? '/', { replace: true }))
      .catch((err) => setError(humanError(err)));
  }
  // 原 JSX：email/password 的 value/onChange 改 service.email / service.password；
  // 按钮 disabled={service.$model.submit.loading}，文案 loading ? '登录中…' : '登录'
  // AuthFrame 从 '@/pages/auth-frame' import；其余原样
  ...
});
export const LoginPage = bindServices(LoginPageContent, [LoginService]);
```

- [ ] **Step 3: 建 register service + 页面**（同型，校验同样留组件）

```ts
import { Service } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 注册页（spec §4.5）：表单字段 + 调 auth.register；两次密码一致与 schema 校验留在组件。 */
export class RegisterService extends Service {
  email = '';
  nickname = '';
  password = '';
  confirm = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).register({
      email: this.email,
      password: this.password,
      nickname: this.nickname,
    });
  }
}
```

`pages/register/index.tsx` 的 `onSubmit` 与原 AuthPages 相同：先 `password !== confirm` → `setError('两次密码不一致')`；再 `registerInputSchema.safeParse` 失败 → `setError('请检查邮箱、名字和密码（密码至少 8 位）')`；通过后 `void service.submit().then(跳转).catch((err) => setError(humanError(err)))`。

`pages/register/index.tsx` 与 login 同型：四个表单字段读 Service、`submit` 成功 `navigate(location.state?.from ?? '/', { replace: true })`、失败 `setError(humanError(err))`。`AuthFrame` 搬到 `pages/auth-frame.tsx` 原样。

- [ ] **Step 4: 引用切换、删旧文件、验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 登录成功回跳 `state.from`；② 错密码出人话错误；③ 注册 → 直接进首页；④ 两次密码不一致拦截。

```bash
git add apps/web/src && git commit -m "feat(web): 登录/注册页服务化"
```

---

### Task 10: feed-home 页 + lib/feed.ts + ui/Empty（moment:changed 听众上线）

**Files:**
- Create: `apps/web/src/lib/feed.ts`
- Create: `apps/web/src/ui/Empty.tsx`（从 `FeedHome.tsx` 挪出的通用组件）
- Create: `apps/web/src/pages/feed-home/index.tsx`
- Create: `apps/web/src/pages/feed-home/feed-home.service.ts`
- Delete: `apps/web/src/pages/FeedHome.tsx`
- Modify: `apps/web/src/timeline/TimelineRail.tsx` → 改名 `timeline/timeline-rail.tsx`（改受控：index/tags 由 props 传入）
- Modify: `apps/web/src/pages/chain-home/../ChainHome.tsx`（Empty import 改 `@/ui/Empty`，本 Task 只改 import，Task 11 整页迁）
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `ChainListService`（Task 7）；`currentTzOffset`（`@/lib/time`）；`RailFilter`（仍从 `@/timeline/TimelineRail` 导出，spec §4.2）。
- Produces:
  - `feedQuery(filter: RailFilter, cursor?: string, limit?: number): FeedQueryInput`（`@/lib/feed`）。
  - `class FeedHomeService extends Service`：见 Step 2 签名（`ChainHomeService`（Task 11）复用同一套分页公约）。
  - `TimelineRail` 新 props：`{ fixedChainId?: string; index: MonthIndexEntry[]; indexPending: boolean; tags: TagResponse[]; value: RailFilter; onChange: (next: RailFilter) => void }`（**去掉 `chains` prop**）。
  - `Empty`（`@/ui/Empty`）。

- [ ] **Step 1: 建 `lib/feed.ts` 与 `ui/Empty.tsx`**

```ts
// lib/feed.ts
import type { RailFilter } from '@/timeline/timeline-rail';

export type FeedQueryInput = Parameters<typeof import('@/api/client').client.getFeed>[0];

/** 拼 getFeed 参数（spec §4.1 纯函数；分页 gen 守卫由各 Service 持有）。 */
export function feedQuery(filter: RailFilter, cursor?: string, limit = 50): FeedQueryInput {
  return {
    chainIds: filter.chainIds,
    tagId: filter.tagId,
    order: filter.order,
    before: filter.before,
    cursor,
    limit,
  };
}
```

```tsx
// ui/Empty.tsx —— 原 FeedHome.tsx 的 Empty 原样搬出（参数化组件，无业务）
import type { ReactNode } from 'react';

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="py-20 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 建 `feed-home.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { MonthIndexEntry, MomentResponse, TagResponse } from '@moment/dto';
import { client } from '@/api/client';
import { currentTzOffset } from '@/lib/time';
import { feedQuery } from '@/lib/feed';
import type { RailFilter } from '@/timeline/timeline-rail';

/** 首页状态（spec §4.2）：筛选 + feed 分页 + 月份索引 + 单链标签。 */
export class FeedHomeService extends Service {
  filter: RailFilter = { order: 'happened_at' };
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  monthIndex: MonthIndexEntry[] = [];
  indexPending = false;
  tags: TagResponse[] = [];
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    void this.loadFirst();
    void this.loadMeta();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  /** 空态分流（web-product §4 空态表）：任一筛选生效即走「没有符合条件的时刻」 */
  get filtered(): boolean {
    return Boolean(
      this.filter.tagId || this.filter.chainIds?.length || this.filter.order === 'created_at' || this.filter.before,
    );
  }

  setFilter(next: RailFilter): void {
    this.filter = next;
    void this.loadFirst();
    void this.loadMeta();
  }

  clearBefore(): void {
    this.setFilter({ ...this.filter, before: undefined });
  }

  clearFilters(): void {
    this.setFilter({ order: 'happened_at' });
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.getFeed(feedQuery(this.filter, undefined, 50));
    if (gen !== this.gen) return; // 改筛选/跳月只走 loadFirst，cursor 清掉（spec §4.1）
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.getFeed(feedQuery(this.filter, this.nextCursor, 50));
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** month-index（仅 happened_at 序）+ 单链标签（spec §4.2 loadMeta） */
  async loadMeta(): Promise<void> {
    this.indexPending = true;
    try {
      if (this.filter.order === 'happened_at') {
        const idx = await client.getMonthIndex({
          chainIds: this.filter.chainIds,
          tagId: this.filter.tagId,
          tzOffset: currentTzOffset(),
        });
        this.monthIndex = idx.months;
      } else {
        this.monthIndex = [];
      }
      const scopeChainId = this.filter.chainIds?.length === 1 ? this.filter.chainIds[0] : undefined;
      this.tags = scopeChainId ? (await client.listTags(scopeChainId)).tags : [];
    } finally {
      this.indexPending = false;
    }
  }
}
```

- [ ] **Step 3: `git mv timeline/TimelineRail.tsx timeline/timeline-rail.tsx` 并改为纯受控**

- 删 `useQuery` / `client` / `qk` import；删 `chains?: ChainDto[]` prop。
- 新 props（Interfaces 块的签名）；`RailContent` 内部：
  - `idx.data?.months` → `index`；`idx.isPending` → `indexPending`。
  - `tags?.tags` → `tags`；`qk.tags` 查询删。
  - `value.chainIds`（scope 计算）、`monthFromBefore` / `monthBeforeParam` / `currentTzOffset` 中仍被纯渲染逻辑用到的保留，`currentTzOffset` 随 month-index 查询删掉而移除 import。
  - `RailFilter` 类型仍从这里 export（spec §4.2）。
- 抽屉 `open` 的 `useState` 保留（spec §2：受控；抽屉开关不上 Service）。

- [ ] **Step 4: 建 `pages/feed-home/index.tsx`**

```tsx
import { bindServices, observer, useService } from '@rabjs/react';
import { ComposerEntry } from '@/compose/composer-entry';
import { canCompose } from '@/lib/roles';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Timeline } from '@/timeline/Timeline';
import { TimelineRail } from '@/timeline/TimelineRail';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { Icon } from '@/ui/Icon';
import { FeedHomeService } from './feed-home.service';

const FeedHomeContent = observer(function FeedHomeContent() {
  const service = useService(FeedHomeService);
  const chainList = useService(ChainListService);
  const composeSession = useService(ComposeSessionService);
  const chains = chainList.chains;
  const looks = new Map(chains.map((c) => [c.id, { name: c.name, color: c.color, icon: c.icon }]));
  // 占位卡抑制：viewer（任何链都不可写）全程不见（spec §5）
  const entry = chains.some(canCompose) ? <ComposerEntry /> : undefined;
  const loading = service.$model.loadFirst.loading;
  const noChains = !loading && chains.length === 0;

  return (
    <div>
      <TimelineRail
        index={service.monthIndex}
        indexPending={service.indexPending}
        tags={service.tags}
        value={service.filter}
        onChange={(next) => service.setFilter(next)}
      />
      {service.filter.before && (
        <div className="sticky top-2 z-10 mb-3">
          <button
            type="button"
            onClick={() => service.clearBefore()}
            className="inline-flex items-center gap-1 rounded-sticker bg-select px-3 py-1 text-sm text-select-fg"
          >
            <Icon icon={ArrowLeft} size={14} />
            回到今天
          </button>
        </div>
      )}
      <Timeline
        moments={service.moments}
        chainLookById={looks}
        hideSignature={service.filter.order === 'created_at'}
        isPending={loading}
        isError={Boolean(service.$model.loadFirst.error)}
        onRetry={() => void service.loadFirst()}
        hasNextPage={service.hasMore}
        isFetchingNextPage={service.$model.loadMore.loading}
        fetchNextPage={() => void service.loadMore()}
        entry={entry}
        empty={
          noChains ? (
            <Empty title="建第一条时光链，比如「宝宝成长」" hint="点「开一条新的链」就可以。" />
          ) : service.filtered ? (
            // 筛选/锚定筛空（web-product §4 空态表第三行）
            <Empty
              title="没有符合条件的时刻"
              action={
                <Button variant="ghost" onClick={() => service.clearFilters()}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <Empty
              title="还没有记下任何一刻"
              action={<Button onClick={() => composeSession.openCompose()}>记下此刻</Button>}
            />
          )
        }
      />
    </div>
  );
});

export const FeedHome = bindServices(FeedHomeContent, [FeedHomeService]);
```

- [ ] **Step 5: 引用切换 + 删旧文件**

- `App.tsx`：`import { FeedHome } from '@/pages/FeedHome'` → `@/pages/feed-home`。
- `ChainHome.tsx`：`import { Empty } from './FeedHome'` → `import { Empty } from '@/ui/Empty'`（Task 11 会整页搬）。
- 删 `pages/FeedHome.tsx`。

- [ ] **Step 6: 验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 首屏分页加载更多；② 筛选单链出标签 chips、切标签 → 整表重查 + 空态「没有符合条件的时刻」+ 清除筛选；③ 按记下顺序看 → 日期结收起、月份索引块变说明；④ 点月份跳月 →「回到今天」出现且能清；⑤ 发布/编辑/删除/反应（Task 2/3 的 emit）→ 首页即时刷新；⑥ 建链（Task 5 emit）→ 不影响首页（无 chain 事件监听，符合 spec）。

```bash
git add apps/web/src && git commit -m "feat(web): 首页服务化（筛选/分页/月份索引/标签），Rail 改受控"
```

---

### Task 11: chain-home 页

**Files:**
- Create: `apps/web/src/pages/chain-home/index.tsx`
- Create: `apps/web/src/pages/chain-home/chain-home.service.ts`
- Delete: `apps/web/src/pages/ChainHome.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 10 的 `feedQuery`、受控 `TimelineRail`、`Empty`；`chain:changed`（Task 4/5/6 已发射）。
- Produces: `ChainHome`（`@/pages/chain-home`）。

- [ ] **Step 1: 建 `chain-home.service.ts`**

与 `FeedHomeService` 同一套分页公约（spec §4.3），另加链详情与 `hydrate`：

```ts
import { Service } from '@rabjs/react';
import type { ChainDto, MonthIndexEntry, MomentResponse, TagResponse } from '@moment/dto';
import { client } from '@/api/client';
import { currentTzOffset } from '@/lib/time';
import { feedQuery } from '@/lib/feed';
import type { RailFilter } from '@/timeline/timeline-rail';
import type { ChainChangedPayload } from '@/lib/events';

/** 链页状态（spec §4.3）：getFeed 恒带 chainIds:[chainId]；hydrate 由路由 param 驱动。 */
export class ChainHomeService extends Service {
  chainId = '';
  chain: ChainDto | null = null;
  filter: RailFilter = { order: 'happened_at' };
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  monthIndex: MonthIndexEntry[] = [];
  indexPending = false;
  tags: TagResponse[] = [];
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
    this.on('chain:changed', (p: ChainChangedPayload) => {
      if (p.chainId !== this.chainId) return;
      if (p.op === 'delete') return; // 删除后由用户导航离开
      void this.loadChain();
    }, 'global');
  }

  /** 路由 param 进来（spec §4.3）：强制 filter 不含其它 chainIds；幂等挡 StrictMode */
  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.chain = null;
    this.filter = { order: 'happened_at', chainIds: [chainId] };
    this.moments = [];
    void this.loadChain();
    void this.loadFirst();
    void this.loadMeta();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  get filtered(): boolean {
    return Boolean(this.filter.tagId || this.filter.order === 'created_at' || this.filter.before);
  }

  setFilter(next: RailFilter): void {
    this.filter = { ...next, chainIds: [this.chainId] }; // 恒定本链
    void this.loadFirst();
    void this.loadMeta();
  }

  clearBefore(): void {
    this.setFilter({ ...this.filter, before: undefined });
  }

  clearFilters(): void {
    this.setFilter({ order: 'happened_at' });
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
  }

  async loadFirst(): Promise<void> {
    if (!this.chainId) return;
    const gen = ++this.gen;
    const page = await client.getFeed(feedQuery(this.filter, undefined, 50));
    if (gen !== this.gen) return;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.getFeed(feedQuery(this.filter, this.nextCursor, 50));
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async loadMeta(): Promise<void> {
    if (!this.chainId) return;
    this.indexPending = true;
    try {
      if (this.filter.order === 'happened_at') {
        const idx = await client.getMonthIndex({
          chainIds: [this.chainId],
          tagId: this.filter.tagId,
          tzOffset: currentTzOffset(),
        });
        this.monthIndex = idx.months;
      } else {
        this.monthIndex = [];
      }
      this.tags = (await client.listTags(this.chainId)).tags;
    } finally {
      this.indexPending = false;
    }
  }
}
```

- [ ] **Step 2: 建 `pages/chain-home/index.tsx`**（原 `ChainHome.tsx` JSX 平移）

```tsx
const ChainHomeContent = observer(function ChainHomeContent() {
  const { chainId = '' } = useParams();
  const navigate = useNavigate();
  const service = useService(ChainHomeService);
  const composeSession = useService(ComposeSessionService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同 Task 3）：骨架 = 无 chain 且（加载中或无错）
  const chainErr = service.$model.loadChain.error;
  if (!service.chain && (service.$model.loadChain.loading || !chainErr)) {
    // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
    return <div className="h-32 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  }
  if (!service.chain) {
    return (
      <Banner action={chainErr && !service.$model.loadChain.loading ? { label: '重试', onClick: () => void service.loadChain() } : undefined}>
        看不到这条链，或它已经不在了
      </Banner>
    );
  }
  const chain = service.chain;

  // 原 JSX 结构不变：
  //   TimelineRail 加 fixedChainId={chain.id} index={service.monthIndex} indexPending={service.indexPending}
  //     tags={service.tags} value={service.filter} onChange={(next) => service.setFilter(next)}
  //   header / 锚定「回到今天」（service.clearBefore()）/ Timeline（同 Task 10 的 props 映射，
  //     isPending=service.$model.loadFirst.loading）
  //   entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
  //   空态：service.filtered → 「没有符合条件的时刻」+ clearFilters；否则空链态
  //     （viewer 无按钮；editor「记下此刻」→ composeSession.openCompose({ chainId: chain.id })）
  //   设置菜单 navigate 不变
  ...
});
export const ChainHome = bindServices(ChainHomeContent, [ChainHomeService]);
```

- [ ] **Step 3: 引用切换、删旧文件、验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 进链页骨架 → 链名/简介/菜单；② 标签筛选/切序/跳月（同首页）；③ 设置页改名（Task 4 emit chain:changed）→ 回链页名字即时变；④ viewer 进链页无「记下此刻」按钮（spec §10 回归）；⑤ 链间互切（侧栏 A→B）列表正确重查（hydrate 幂等 + 换 id 重置）。

```bash
git add apps/web/src && git commit -m "feat(web): 链页服务化（恒定本链筛选 + chain:changed 重拉）"
```

---

### Task 12: share-album 页

**Files:**
- Create: `apps/web/src/pages/share-album/index.tsx`
- Create: `apps/web/src/pages/share-album/share-album.service.ts`
- Delete: `apps/web/src/pages/ShareAlbumPage.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `ApiError`（`@moment/api-client`）。
- Produces: `ShareAlbumPage`（`@/pages/share-album`）。

- [ ] **Step 1: 建 service（只拉公开相册，不碰全局链列表，spec §4.5）**

```ts
import { Service } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { client } from '@/api/client';

export type PublicShareChain = Awaited<ReturnType<typeof client.getPublicShare>>['chain'];

/** 公开分享相册（spec §4.5）：匿名只读分页。 */
export class ShareAlbumService extends Service {
  token = '';
  chain: PublicShareChain | null = null;
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  private loadingMore = false;

  hydrate(token: string): void {
    if (this.token === token) return;
    this.token = token;
    this.chain = null;
    this.moments = [];
    void this.loadFirst();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadFirst(): Promise<void> {
    const page = await client.getPublicShare(this.token);
    this.chain = page.chain;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await client.getPublicShare(this.token, this.nextCursor);
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }
}
```

- [ ] **Step 2: 建 index.tsx**（原 `ShareAlbumPage.tsx` JSX 平移）

```tsx
const ShareAlbumPageContent = observer(function ShareAlbumPageContent() {
  const { token = '' } = useParams();
  const service = useService(ShareAlbumService);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  // 三态判定（防 hydrate effect 首帧闪错误态，同 Task 3/4/11）
  const loadErr = service.$model.loadFirst.error;
  if (!service.chain && (service.$model.loadFirst.loading || !loadErr)) {
    // 原骨架 JSX 原样（两张 60% surface 卡）
    ...
  }
  if (loadErr && !service.$model.loadFirst.loading) {
    const e = loadErr;
    const closed = e instanceof ApiError && (e.status === 404 || e.code === 'SHARE_NOT_FOUND');
    // 原「这本相册的分享已关闭 / 加载失败，请稍后重试」JSX 原样
    ...
  }
  // 原 header + Timeline + footer JSX 原样：
  //   moments={service.moments} shareToken={token} readOnly
  //   hasNextPage={service.hasMore} isFetchingNextPage={service.$model.loadMore.loading}
  //   fetchNextPage={() => void service.loadMore()}
  ...
});
export const ShareAlbumPage = bindServices(ShareAlbumPageContent, [ShareAlbumService]);
```

- [ ] **Step 3: 引用切换、删旧文件、验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 打开有效分享链接（未登录）→ 相册分页；② 恒浅色（切系统深色也不变）；③ 吊销后再开 →「这本相册的分享已关闭」；④ 伪造 token → 同关闭文案。

```bash
git add apps/web/src && git commit -m "feat(web): 分享相册页服务化"
```

---

### Task 13: compose-panel 完整服务化

**Files:**
- Create: `apps/web/src/compose/compose-panel/index.tsx`（从 `compose/ComposePanel.tsx` 搬）
- Create: `apps/web/src/compose/compose-panel/compose-panel.service.ts`
- Delete: `apps/web/src/compose/ComposePanel.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`（import 路径）

**Interfaces:**
- Consumes: `ChainListService`（Task 7）；`ComposeSessionService`（Task 2）。
- Produces: `ComposePanel`（`@/compose/compose-panel`，仍为无 props 常挂组件，内部条件渲染）。

- [ ] **Step 1: 建 `compose-panel.service.ts`**

草稿（正文/文件/标签/happenedAt/进度）全部进面板生命周期 Service（spec §4.6）。**bindServices 绑在条件挂载的面板本体上**（`request === null` 时外层渲染 null），关面板即销毁实例、草稿即弃——与现状一致（spec：不做草稿持久化）。blob URL 的 revoke 全部走显式路径，不进 `destroy()`（spec §5）。

```ts
import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';
import type { MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { humanError } from '@/lib/errors';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';
import { canCompose } from '@/lib/roles';
import { currentTzOffset, toWallClockInput, wallClockToIso } from '@/lib/time';
import type { TagResponse } from '@moment/dto';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import type { ComposeRequest } from '@/services/compose-session.service';

export interface PickedImage {
  file: File;
  previewUrl: string;
}

export interface PickedVideo {
  file: File;
  previewUrl: string;
  durationSeconds: number;
}

function isPastHappenedAt(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) > 5 * 60_000;
}

/** 发布面板（spec §4.6）：草稿活在面板生命周期；submit 成功 emit + markCreated + close。 */
export class ComposePanelService extends Service {
  request: ComposeRequest | null = null;
  pickedChainId = '';
  content = '';
  images: PickedImage[] = [];
  video: PickedVideo | null = null;
  replaceConfirm: 'image' | 'video' | null = null;
  pendingFiles: File[] = [];
  happenedAt = nowLocalInput();
  selectedTags: string[] = [];
  newTag = '';
  progress: string | null = null;
  error: string | null = null; // 本地校验 + humanError(API) 都落这里（面板内，spec §8）
  tagList: TagResponse[] = [];

  get chainList(): ChainListService {
    return this.resolve(ChainListService);
  }

  get writableChains() {
    return this.chainList.chains.filter(canCompose);
  }

  get chainId(): string {
    return this.pickedChainId || this.writableChains[0]?.id || '';
  }

  get edit(): MomentResponse | undefined {
    return this.request?.edit;
  }

  get needChainPick(): boolean {
    return !this.edit && !this.request?.chainId && this.writableChains.length > 1 && !this.chainId;
  }

  hydrate(request: ComposeRequest): void {
    this.request = request;
    this.pickedChainId = request.chainId ?? request.edit?.chainId ?? '';
    this.content = request.edit?.content ?? '';
    this.happenedAt = request.edit
      ? toWallClockInput(request.edit.happenedAt, request.edit.happenedTzOffset)
      : nowLocalInput();
    this.selectedTags = request.edit?.tags.map((t) => t.id) ?? [];
  }

  async loadTagList(): Promise<void> {
    if (!this.chainId) {
      this.tagList = [];
      return;
    }
    this.tagList = (await client.listTags(this.chainId)).tags;
  }

  async createTag(): Promise<void> {
    const name = this.newTag.trim();
    if (!name || !this.chainId) return;
    try {
      const tag = await client.createTag(this.chainId, name);
      this.selectedTags = [...this.selectedTags, tag.id];
      this.newTag = '';
      await this.loadTagList();
    } catch (e) {
      this.error = humanError(e);
    }
  }

  toggleTag(id: string): void {
    this.selectedTags = this.selectedTags.includes(id)
      ? this.selectedTags.filter((x) => x !== id)
      : [...this.selectedTags, id];
  }

  addImages(files: File[]): void {
    this.error = null;
    const next = [...this.images];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        this.error = `「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}）`;
        continue;
      }
      if (next.length >= 9) {
        this.error = '最多 9 张图片';
        break;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    this.images = next;
  }

  async addVideo(file: File): Promise<void> {
    this.error = null;
    if (file.size > MAX_VIDEO_BYTES) {
      this.error = `视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`;
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        this.error = `视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟`;
        return;
      }
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke（spec §5）
      this.video = { file, durationSeconds: meta.durationSeconds, previewUrl: URL.createObjectURL(file) };
    } catch {
      this.error = '无法读取视频';
    }
  }

  /** file input onChange 的分流（图/视频互斥确认），input 本身在组件 */
  onPickImages(files: File[]): void {
    if (this.video) {
      this.pendingFiles = files;
      this.replaceConfirm = 'image';
      return;
    }
    this.addImages(files);
  }

  onPickVideo(file: File): void {
    if (this.images.length > 0) {
      this.pendingFiles = [file];
      this.replaceConfirm = 'video';
      return;
    }
    void this.addVideo(file);
  }

  cancelReplace(): void {
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  confirmReplace(): void {
    if (this.replaceConfirm === 'image') {
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke
      this.video = null;
      this.addImages(this.pendingFiles);
    }
    if (this.replaceConfirm === 'video' && this.pendingFiles[0]) {
      this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl)); // 显式 revoke
      this.images = [];
      void this.addVideo(this.pendingFiles[0]);
    }
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  removeImage(index: number): void {
    URL.revokeObjectURL(this.images[index]!.previewUrl); // 显式 revoke
    this.images = this.images.filter((_, i) => i !== index);
  }

  /** 关闭/取消/Escape：先 revoke 全部预览，再关会话（不依赖 destroy/GC，spec §5） */
  resetAndClose(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.resolve(ComposeSessionService).closeCompose();
  }

  private clearPreviews(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.images = [];
    this.video = null;
  }

  async submit(): Promise<void> {
    this.error = null;
    const edit = this.edit;
    const chainId = this.chainId;
    if (!chainId) {
      this.error = '先选一条链';
      return;
    }
    const hasImages = this.images.length > 0;
    const hasVideo = Boolean(this.video);
    if (!hasImages && !hasVideo && this.content.trim().length === 0) {
      this.error = '先写一句此刻吧';
      return;
    }
    const timeEdited = Boolean(edit) && this.happenedAt !== toWallClockInput(edit!.happenedAt, edit!.happenedTzOffset);
    const happenedIso = edit
      ? timeEdited
        ? wallClockToIso(this.happenedAt, edit.happenedTzOffset)
        : edit.happenedAt
      : new Date(Date.parse(this.happenedAt)).toISOString();
    const happenedAtMs = Date.parse(happenedIso);
    if (Number.isNaN(happenedAtMs)) {
      this.error = '发生时间不合法';
      return;
    }
    const isBackfill = edit && !timeEdited ? edit.isBackfill : isPastHappenedAt(happenedAtMs);
    const composeSession = this.resolve(ComposeSessionService);
    try {
      if (edit) {
        await client.updateMoment(edit.id, {
          content: this.content,
          ...(timeEdited ? { happenedAt: happenedIso, happenedTzOffset: edit.happenedTzOffset } : {}),
          isBackfill,
          tagIds: this.selectedTags,
        });
        composeSession.emit('moment:changed', { momentId: edit.id, chainId: edit.chainId, op: 'update' }, 'global');
      } else {
        const type = hasVideo ? 'video' : hasImages ? 'media' : 'text';
        const mediaIds: string[] = [];
        if (hasImages) {
          for (let i = 0; i < this.images.length; i++) {
            this.progress = `上传图片 ${i + 1}/${this.images.length}`;
            const file = await compressImage(this.images[i]!.file);
            const res = await client.uploadMedia({
              file,
              mime: file.type,
              size: file.size,
              kind: 'image',
              sortOrder: i,
              onProgress: (l, t) => (this.progress = `上传图片 ${i + 1}/${this.images.length} ${Math.round((l / t) * 100)}%`),
            });
            mediaIds.push(res.mediaId);
          }
        }
        if (this.video) {
          this.progress = '上传视频…';
          const res = await client.uploadMedia({
            file: this.video.file,
            mime: this.video.file.type,
            size: this.video.file.size,
            kind: 'video',
            durationSeconds: this.video.durationSeconds,
            onProgress: (l, t) => (this.progress = `上传视频 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
        this.progress = '记下…';
        const res = await client.createMoment(chainId, {
          type,
          content: this.content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill,
          mediaIds,
          tagIds: this.selectedTags,
        });
        composeSession.markCreated(res.id); // 「从链节长出来」微动效（spec §1.6）
        composeSession.emit('moment:changed', { momentId: res.id, chainId, op: 'create' }, 'global');
      }
      this.clearPreviews(); // 显式 revoke（spec §5）
      composeSession.closeCompose();
    } catch (e) {
      this.error = humanError(e);
    } finally {
      this.progress = null;
    }
  }
}
```

注意：`submit` 里**不再需要** Task 2 加的过渡期 `queryClient.invalidateQueries`——首页/链页已全走 `moment:changed` 事件（Task 10/11 完成后 RQ 页面只剩无 feed 的角落）；`chain(chainId)` / `tags` 的 invalidate 同理由 `chain:changed` / 面板自身 `loadTagList` 覆盖。

- [ ] **Step 2: 建 `compose/compose-panel/index.tsx`**

外层沿用 Task 2 的 observer 外壳；`ComposeBody` 变 `bindServices` 绑实例（**绑本体**，不绑常挂外壳——spec §4.6）：

```tsx
import { useEffect, useRef } from 'react';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChainMark } from '@/chain/ChainMark';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Confirm } from '@/ui/Confirm';
import { HappenedAtField } from '@/ui/HappenedAtField';
import { Icon } from '@/ui/Icon';
import { X } from 'lucide-react';
import { ComposePanelService } from './compose-panel.service';

export const ComposePanel = observer(function ComposePanel() {
  const composeSession = useService(ComposeSessionService);
  if (!composeSession.request) return null;
  return <ComposeBody />;
});

const ComposeBodyContent = observer(function ComposeBodyContent() {
  const service = useService(ComposePanelService);
  const composeSession = useService(ComposeSessionService);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);
  const busy = service.$model.submit.loading;

  useEffect(() => {
    service.hydrate(composeSession.request!);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时一次性水合
  }, []);
  useEffect(() => {
    void service.loadTagList();
  }, [service, service.chainId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !e.defaultPrevented) service.resetAndClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, service]);

  // 原 ComposeBody JSX 原样，绑定替换：
  //   writable → service.writableChains；chainId → service.chainId；edit → service.edit
  //   onClose → service.resetAndClose()；busy → service.$model.submit.loading
  //   content/images/video/happenedAt/selectedTags/newTag/error/progress → service 字段
  //   setImages/removeImage → service.removeImage(i)；addImages/onPickImages/onPickVideo/confirmReplace → service 方法
  //   tagList?.tags → service.tagList；createTag.mutate → void service.createTag()
  //   submit 按钮 onClick={() => void service.submit()}
  //   校验错误与 API 错误统一读 service.error（service 内已 humanError）
  ...
});

const ComposeBody = bindServices(ComposeBodyContent, [ComposePanelService]);
```

- [ ] **Step 3: Shell import 切换；删旧文件；验证 + Commit**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web dev
```

手测：① 开面板写半截关掉重开 → 草稿已清（不持久化，spec 非目标）；② 加 9+ 张图/超限图/超时长视频的报错文案；③ 图视频互换确认弹层；④ 发布带图 moment → 进度文案 → 生长动画 → 时间线刷新；⑤ 编辑 moment 改时间/标签 → 保存刷新；⑥ 新建标签即选中；⑦ Escape 关面板；⑧ 单链用户面板直显「记到「链名」」。

```bash
git add apps/web/src && git commit -m "feat(web): 发布面板服务化（草稿进面板 Service，blob 显式 revoke）"
```

---

### Task 14: 清理——卸 RQ、删 keys/shim/query-client、改 CLAUDE.md、DoD

**Files:**
- Delete: `apps/web/src/api/keys.ts`、`apps/web/src/api/query-client.ts`、`apps/web/src/auth/AuthProvider.tsx`
- Modify: `apps/web/src/services/auth.service.ts`（去 queryClient）
- Modify: `apps/web/src/pages/moment/moment.service.ts`、`timeline/moment-sheet.service.ts`（去过渡 invalidate）
- Modify: `apps/web/src/pages/chain-settings/chain-settings.service.ts`（去 invalidateRq）
- Modify: `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts`、`apps/web/src/pages/invite/invite.service.ts`（去过渡 invalidate）
- Modify: `apps/web/src/main.tsx`（去 QueryClientProvider）
- Modify: `apps/web/package.json`（卸 `@tanstack/react-query`）
- Modify: `apps/web/CLAUDE.md`
- Rename: `timeline/Lightbox.tsx` → `timeline/lightbox.tsx`、`timeline/ReactionBar.tsx` → `timeline/reaction-bar.tsx`、`timeline/group-by-date.ts`（已是 kebab，核对即可）——spec §2 目录树的最后对齐（纯 `git mv` + import 路径，`moment-sheet.tsx` 内引用同步改）

**Interfaces:**
- Consumes: Task 1–13 全部完成。
- Produces: spec §0 成功标准的终态。

- [ ] **Step 1: 摘掉全部过渡期 RQ 引用**

逐文件删（都是 Task 1–6 标了「过渡期」的行）：

- `services/auth.service.ts`：删 `import { queryClient } from '@/api/query-client'` 与 `queryClient.clear()` 两处（auth-cleared listener、applyAuth）。
- `pages/moment/moment.service.ts`：删 import 与 `submitComment`/`deleteComment` 里的 `queryClient.invalidateQueries`。
- `timeline/moment-sheet.service.ts`：删 import 与 `react`/`remove`/`submitPreviewComment` 里的 invalidate。
- `pages/chain-settings/chain-settings.service.ts`：删 `invalidateRq()` 方法及全部调用。
- `shell/create-chain-dialog/create-chain-dialog.service.ts`、`pages/invite/invite.service.ts`：删 import 与 invalidate 行。
- `main.tsx`：删 `QueryClientProvider` import 与包裹（RSRoot 直挂 BrowserRouter 下）。
- `App.tsx` 的 `NotFound`：还在用 `useAuth` shim——改为 `observer` + `useService(AuthService)`：

```tsx
const NotFound = observer(function NotFound() {
  const auth = useService(AuthService);
  if (!auth.user) return <Navigate to="/login" replace />;
  return <p className="py-16 text-center text-muted">没有这个页面</p>;
});
```

- [ ] **Step 2: 删文件 + 卸依赖**

```bash
rm apps/web/src/api/keys.ts apps/web/src/api/query-client.ts apps/web/src/auth/AuthProvider.tsx
pnpm --filter @moment/web remove @tanstack/react-query
```

- [ ] **Step 3: grep 门禁（spec §0 成功标准 1/2）**

```bash
grep -rn "tanstack\|useQuery\|useInfiniteQuery\|useMutation\|QueryClient\|createContext\|useAuth\|ComposeContext\|api/keys\|query-client" apps/web/src
```

预期：**零命中**（React Aria 等库自带的 Context 例外——grep 的是 `src` 内我们自己写的 `createContext`）。有命中逐个清掉再继续。

- [ ] **Step 4: 改 `apps/web/CLAUDE.md` 放置规则**

「放置约束」段替换为（其余段落不动）：

```markdown
## 放置约束

- 状态三层（rab）：全局 Service 在 `src/services/`（`register` 注册于 `main.tsx`，AuthService 排首）；页面组件 `src/pages/<name>/index.tsx` + 同目录 `<name>.service.ts`（`bindServices`）；组件级 Service 与组件同目录。跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- 时间线交互组件在 `src/timeline/`（`moment-sheet.tsx` + `moment-sheet.service.ts` 平铺同目录，每卡一实例）；通用无业务组件放 `src/ui/`；壳层在 `src/shell/`；发布面板在 `src/compose/compose-panel/`。
- 所有 API 访问经 `src/api/client.ts` 的 `client`；类型来自 `@moment/dto` / `@moment/api-client`；组件里不手写 fetch，不包空 ApiService。
- 页面私有纯逻辑下沉 `src/lib/`（如 `feed.ts`）；不进 `src/ui/`。
- 路由参数驱动：页面组件 `useParams` 后 `service.hydrate(id)`（Service 不碰 router）；路由跳转 `useNavigate` 留组件。
```

- [ ] **Step 5: DoD 验收（spec §10 全项）**

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm build
```

手测清单（spec §10）：
1. 登录 → 首页筛选 / 跳月 / 加载更多。
2. 发布生长动画（`lastCreatedId`）。
3. 链页 / 设置（改名回链页即时生效）。
4. 详情评论 + 卡片评论预览互不串数据。
5. 通知未读角标与列表一致；通知页翻页后停留 >30s 不被轮询重置。
6. 登出回登录页；分享页恒浅。
7. 回归：viewer 不见「记下」；`?compose=1` 打开面板并从 URL 清掉；改筛选出现「没有符合条件的时刻」+ 清除筛选。
8. Console 无 `[WARN] 兼容模式`；Network 面板登出后无 30s 轮询。

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/superpowers 2>/dev/null || git add apps/web
git commit -m "refactor(web): 删除 TanStack Query 与过渡 shim，rab 迁移收尾"
```

---

## 自查记录（写计划时已核）

- **Spec 覆盖**：§1 分层/§2 目录/§3 五全局 Service/§4 页面组件 Service/§5 事件表/§6 留 React 项/§7 入口/§8 错误/§9 顺序/§10 验收 —— Task 1–14 全对应；spec §9 的 7 步顺序被本计划的「发射方先行」细化替代（Task 2–6 发射、7/10/11 收听），每刀开机约束不变。
- **类型一致**：`ComposeRequest` / `MomentChangedPayload` / `CommentChangedPayload` / `RailFilter` / `feedQuery` 各 Task 引用同一名；`NotificationService.pollUnread` 只在 Task 7 定义、Shell 只读 `unreadCount`。
- **行为保真核对过的点**：`lastCreatedId` 渲染期直读（Task 2）；通知 markAllRead 的全量翻页循环（Task 7）；ComposePanel 校验文案逐字保留（Task 13）；分享页 404 文案（Task 12）；`humanError` 对普通 Error 走 COPY 表回退——登录/注册的校验文案留在组件直设，不经 humanError（Task 9）。
