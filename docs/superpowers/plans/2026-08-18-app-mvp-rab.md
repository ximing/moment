# App 端 rab 迁移 + MVP 补齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/app` 的业务状态从 TanStack Query + React Context 迁到 `@rabjs/react`（rab，与 web 同款三层分层），并补齐 MVP 缺口：链设置页、「我」页（第 4 个 tab）、通知点击跳转。

**Architecture:** 全局 Service（`src/services/`，`AuthService` 排首）在 `app/_layout.tsx` 模块级 `register` 后用 `RSRoot` 包树；页面 Service 在 `src/features/<name>/`（`index.tsx` + `<name>.service.ts`）用 `bindServices` 绑生命周期；跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。HTTP 仍走 `src/lib/api.ts` 的 `client` 单例。与 web 迁移同款「发射方先迁、收听方后迁」：迁移后的写操作在最终清理任务前**同时** emit + `queryClient.invalidateQueries`，保证任何中间态整机可开机。

**Tech Stack:** `@rabjs/react@^9.2.0`（新增）、Expo SDK 54 + expo-router v6、`@moment/dto` / `@moment/api-client`（不改）。删除 `@tanstack/react-query`、`expo-notifications`、`expo-device`。

**Spec:** `docs/superpowers/specs/2026-08-18-app-mvp-rab-design.md`（契约听 spec；冲突以 spec 为准）

## Global Constraints

- **App 无测试 runner（spec §8），本轮不新加**。每个任务验证 = `pnpm --filter @moment/app typecheck` + `pnpm --filter @moment/app lint`；Task 1 与 Task 11 另跑 `pnpm --filter @moment/app export:check`。不许在验证前 commit。
- 每 Task 一个 commit，conventional：`feat(app): ...` / `refactor(app): ...`。
- 每刀切完必须能开机：任何时刻 `pnpm --filter @moment/app ios` 可起、登录后主流程可用。
- **中间态铁律**：迁移后的写操作 Service 在成功路径里**同时** `this.emit(..., 'global')` **和** `queryClient.invalidateQueries(...)`（从 `src/lib/query.ts` import 单例）。emit 供已迁移的 Service 听，invalidate 供还没迁移的 RQ 页面听。Task 11 统一摘掉 invalidate。
- 读 Service 的组件必须 `observer(...)` 或被 `bindServices` 包过；**禁止解构 observable**（`const { moments } = service` ❌，`service.moments` ✅）。
- Service 依赖用 getter + `this.resolve()`，不用 `@Inject`；Service 不碰 router（`router.push` / `router.back` 留组件）。
- 路由文件（`app/*.tsx`）只做三件事：解析参数 → `service.hydrate(params)`（组件内 `useEffect`）→ 渲染 feature 组件。
- import 一律相对路径（现状约定；不用 `@/` 别名）：`src/services/x` ↔ `src/features/y` 之间走 `../../services/x.service`。
- 事件 payload 契约（spec §5 事件表，与 web `apps/web/src/lib/events.ts` 一字不差）：
  - `auth:changed` → `UserProfile | null`
  - `chain:changed` → `{ chainId: string; op: 'create' | 'update' | 'delete' }`
  - `moment:changed` → `{ momentId: string; chainId: string; op: 'create' | 'update' | 'delete' | 'react' }`
  - `comment:changed` → `{ momentId: string }`
- 数据事实（不得越界写 server 不支持的东西）：
  - `updateMeInputSchema` 只有 nickname / avatarColor / avatarIcon / avatarMediaId——**没有改密码**。「我」页不做改密码。
  - `updateChainInputSchema` 不支持 `coverMediaId`——链设置资料只做 name / description / color / icon。
  - `listInvites` **仅 owner 可调**（editor 调会 403；web 端按 editor 调是 web 的 bug，App 不抄）。
  - `markNotificationsRead` ids 每批 1–100，**不传空数组**。
  - `NotificationDto.payload` 顶层有 `momentId` / `chainId` / `title` / `body`，另有嵌套 `data: { momentId, chainId }`——读顶层优先，嵌套兜底。
  - `client.createMoment(chainId, input)` 返回 `MomentResponse`（含 `id` / `chainId`）。
- 删除顺序红线：`src/lib/auth.tsx`（Context）在 Task 1 变 shim、Task 11 删；`src/lib/push.ts` 从 Task 1 起不再被调用、Task 11 删；`src/lib/query.ts` / `keys.ts` 与 `@tanstack/react-query` 依赖 Task 11 删。
- 不动 `src/lib/media.ts` / `rn-put.ts` / `use-media-uri.ts` / `format.ts` 与媒体上传管线（图片压缩后 Blob 进内存；视频 `fileUri` + 分片读盘）。
- UI 保持现有功能风格（spec §0），不做视觉改版；新页面沿用现有 RN 基础组件样式密度。

## 任务总览（为什么是这个序）

发射方（Task 3–5）先上线 emit 并保留 invalidate；全局听众（Task 6）后上线 `on(...)`；读页面（Task 7–8）逐个替换 RQ；新功能（Task 9–10）直接长在 rab 上；Task 11 清扫。任何一刀切下去，未迁移页面靠 invalidate 刷新、已迁移 Service 靠事件刷新，两边都活着。

| Task | 内容 | 上线的东西 |
|---|---|---|
| 1 | 基建：rab 依赖 + events/errors + onAuthCleared + AuthService + register + RSRoot | 全局骨架、useAuth shim、observer RequireAuth；停用 Push 路由 |
| 2 | 登录/注册页 → `features/login` `features/register` | `$model.submit` 单通道范式 |
| 3 | 时刻详情页 → `features/moment` | `comment:changed` / `moment:changed`(react) 发射 |
| 4 | 发布页 → `features/compose` | `moment:changed`(create) 发射 |
| 5 | 新建链 + 邀请接受 → `features/chains-new` `features/invite` | `chain:changed`(create) 发射 |
| 6 | 全局 ChainListService + NotificationService + 通知页 + 链列表页 | 全局听众上线；通知跳转 |
| 7 | 时间线 → `features/feed` | `moment:changed` / `comment:changed` 听众 |
| 8 | 链详情 → `features/chain-home`（全量 rab 化，功能不丢） | 链页听众 |
| 9 | 新增链设置页 `chains/[chainId]/settings` | 分享链接 / 转让 / 删除链；chain-home 收薄 |
| 10 | 新增「我」页 + 第 4 个 tab | 昵称 / 头像 / 登出 |
| 11 | 清理：卸 RQ / 删 push / 改 CLAUDE.md / DoD | 终态 |

---

### Task 1: 基建——rab 依赖 + AuthService + 全局注册 + RSRoot

**Files:**
- Modify: `apps/app/package.json`（dependencies 加 `"@rabjs/react": "^9.2.0"`）
- Create: `apps/app/src/lib/events.ts`
- Create: `apps/app/src/lib/errors.ts`
- Modify: `apps/app/src/lib/token-store.ts`
- Create: `apps/app/src/services/auth.service.ts`
- Create: `apps/app/src/services/register.ts`
- Modify: `apps/app/app/_layout.tsx`
- Modify: `apps/app/src/lib/auth.tsx`（Context → useAuth shim）
- Modify: `apps/app/src/components/RequireAuth.tsx`（observer 化）

**Interfaces:**
- Consumes: `client`（`src/lib/api.ts`，已有）；`secureTokenStore` / `loadUser` / `saveUser`（`src/lib/token-store.ts`，已有）；`queryClient`（`src/lib/query.ts`，已有，过渡期用）。
- Produces（后续所有 Task 依赖）:
  - `class AuthService extends Service`：`user: UserProfile | null`；`ready: boolean`；`login(input: LoginInput): Promise<void>`；`register(input: RegisterInput): Promise<void>`；`logout(): Promise<void>`；`applyAuth(res: AuthResponse): Promise<void>`；`refreshUser(next: UserProfile): void`。
  - `onAuthCleared(fn: () => void): () => void`（`src/lib/token-store.ts`）。
  - `registerGlobals(): void`（`src/services/register.ts`；Task 6 会往里追加注册项，AuthService 恒排首）。
  - `useAuth(): { user: UserProfile | null; ready: boolean; login(email, password): Promise<void>; register(input): Promise<void>; logout(): Promise<void> }`（shim，返回快照对象；Task 11 删）。
  - `humanError(err: unknown): string`（`src/lib/errors.ts`）。
  - `MomentChangedPayload` / `CommentChangedPayload` / `ChainChangedPayload`（`src/lib/events.ts`）。

- [ ] **Step 1: 装依赖**

```bash
cd apps/app && pnpm add '@rabjs/react@^9.2.0'
```

- [ ] **Step 2: 建 `src/lib/events.ts`（与 web `apps/web/src/lib/events.ts` 同文）**

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

- [ ] **Step 3: 建 `src/lib/errors.ts`**

Web 版 `humanError` 的 App 拷贝（文案表合并 App 已用到的邀请/注册码）：

```ts
import { ApiError } from '@moment/api-client';

const COPY: Record<string, string> = {
  INVALID_CREDENTIALS: '邮箱或密码不对',
  EMAIL_ALREADY_REGISTERED: '该邮箱已注册',
  UNAUTHORIZED: '登录过期了，请重新登录',
  CHAIN_NOT_FOUND: '看不到这条链，或它已经不在了',
  CHAIN_ROLE_INSUFFICIENT: '没有权限做这件事',
  SHARE_NOT_FOUND: '这本相册的分享已关闭',
  SHARE_LINK_NOT_FOUND: '这条分享链接不存在',
  MEDIA_NOT_FOUND: '看不到这张图或视频',
  MEDIA_TOO_LARGE: '文件太大',
  VALIDATION_ERROR: '有些内容需要改一改',
  RATE_LIMITED: '操作太频繁，请稍后再试',
  OWNER_MUST_TRANSFER: '创建者离开前需要先把链交给别人',
  CANNOT_TRANSFER_TO_SELF: '不能转让给自己',
  CANNOT_CHANGE_OWN_ROLE: '不能改自己的角色',
  MEMBER_NOT_FOUND: '这个人已经不在链里',
  TAG_NOT_IN_CHAIN: '这个标签不属于这条链',
  TAG_EXISTS: '标签已存在',
  TAG_LIMIT_REACHED: '标签已达上限 100 个',
  INVITE_NOT_FOUND: '邀请不存在或已被吊销',
  INVITE_EXPIRED: '邀请已过期',
  INVITE_ALREADY_ACCEPTED: '邀请已被使用',
  INVITE_EMAIL_MISMATCH: '该邀请限定了其他邮箱',
  NETWORK_ERROR: '网络不太好，请重试',
  EMPTY_PATCH: '没有要保存的修改',
  CONTENT_REQUIRED: '先写一句此刻吧',
  MEDIA_COUNT_INVALID: '图片或视频数量不对',
};

const FALLBACK = '出了点问题，请重试';

export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (COPY[err.code]) return COPY[err.code];
    if (COPY[err.message]) return COPY[err.message];
    if (err.status === 401) return COPY.UNAUTHORIZED;
    return FALLBACK;
  }
  if (err instanceof Error && err.message) {
    return COPY[err.message] ?? FALLBACK;
  }
  return FALLBACK;
}
```

- [ ] **Step 4: `src/lib/token-store.ts` 加 onAuthCleared 桥**

RN 没有 `window.dispatchEvent('moment:auth-cleared')`（web 的单路径桥）。把桥做进 `secureTokenStore.clear()`——api-client 的 Http 在 refresh 彻底失效时**只调 `clear()`**，桥必须挂在这里。`clear()` 删完 keys 后通知监听者；`saveUser` / `setTokens` 不通知。

在文件末尾追加，并改写 `secureTokenStore.clear()`：

```ts
type AuthClearedListener = () => void;
const authClearedListeners = new Set<AuthClearedListener>();

/** tokenStore.clear() 的唯一桥（替代 web 的 window 'moment:auth-cleared'）：
 *  api-client Http refresh 失效与 AuthService.logout 都经 clear() 收敛到 AuthService 构造里的订阅。 */
export function onAuthCleared(fn: AuthClearedListener): () => void {
  authClearedListeners.add(fn);
  return () => {
    authClearedListeners.delete(fn);
  };
}

function notifyAuthCleared(): void {
  for (const fn of [...authClearedListeners]) fn();
}
```

`secureTokenStore` 改为：

```ts
export const secureTokenStore: TokenStore = {
  async getAccessToken() {
    return (await readTokens())?.accessToken ?? null;
  },
  async getRefreshToken() {
    return (await readTokens())?.refreshToken ?? null;
  },
  async setTokens(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined);
    notifyAuthCleared(); // 单路径：登出与 refresh 失效都从这里通知 AuthService
  },
};
```

- [ ] **Step 5: 建 `src/services/auth.service.ts`**

与 web 的差异全在注释里：SecureStore 异步 → `ready` 闸 + hydrate 完成必发一次 `auth:changed`（web 冷启动不发，App 不发则 ChainList/Notification 永远空）。

```ts
import { Service } from '@rabjs/react';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../lib/api';
import { queryClient } from '../lib/query';
import { loadUser, onAuthCleared, saveUser, secureTokenStore } from '../lib/token-store';

/** 全局认证态（spec §3）。SecureStore 异步水合 → ready 闸；事件单路径收敛在 onAuthCleared。 */
export class AuthService extends Service {
  user: UserProfile | null = null;
  ready = false;

  constructor() {
    super();
    // refresh 彻底失效（Http→tokenStore.clear()）与 logout 都走这条路径收敛内存态：
    // 单一路径，不双发 auth:changed。
    onAuthCleared(() => {
      this.user = null;
      this.ready = true;
      queryClient.clear(); // 过渡期：RQ 缓存随会话作废；Task 11 删
      this.emit('auth:changed', null, 'global');
    });
    void this.hydrate();
  }

  /** 冷启动：SecureStore 读缓存 → ready；有缓存再校验 /me 换发头像签名链接。 */
  private async hydrate(): Promise<void> {
    const stored = await loadUser();
    this.user = stored;
    this.ready = true;
    // 与 web 相反，这里必须发：ChainList/Notification 构造时 user 还是 null（异步水合未完成），
    // 不发事件它们永远不开拉（web 靠同步 localStorage 才能省这一次）
    this.emit('auth:changed', stored, 'global');
    if (!stored) return;
    try {
      const me = await client.me();
      this.refreshUser(me);
    } catch (err) {
      // 仅 401 清会话（api-client 内部 refresh 已失败并 clear() → 上面的 onAuthCleared 已置空）。
      // 网络错误（status 0）不登出：保留缓存态，飞行模式冷启动不把持有效 token 的用户踢到登录页。
      if (err instanceof ApiError && err.status === 401 && this.user) {
        await secureTokenStore.clear();
      }
    }
  }

  async applyAuth(res: AuthResponse): Promise<void> {
    // 必须先 await 落盘（SecureStore 异步），再触发任何带 token 的调用，避免读到旧/空 token
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    queryClient.clear(); // 换会话即换缓存（过渡期；Task 11 删）
    this.user = res.user;
    this.emit('auth:changed', res.user, 'global');
  }

  async login(input: LoginInput): Promise<void> {
    await this.applyAuth(await client.login(input));
  }

  async register(input: RegisterInput): Promise<void> {
    await this.applyAuth(await client.register(input));
  }

  /** revoke 吞错；内存态收敛只走 secureTokenStore.clear() → onAuthCleared，不双发。 */
  async logout(): Promise<void> {
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    await secureTokenStore.clear();
  }

  refreshUser(next: UserProfile): void {
    void saveUser(next);
    this.user = next;
    this.emit('auth:changed', next, 'global');
  }
}
```

- [ ] **Step 6: 建 `src/services/register.ts`（Fast Refresh 保险）**

Fast Refresh 重执行模块会重复 `register`，用模块级 once-guard 挡：

```ts
import { register } from '@rabjs/react';
import { AuthService } from './auth.service';

let registered = false;

/** 全局 Service 注册（AuthService 恒排首——后续 Service 构造里 resolve(AuthService)）。
 *  模块级 once-guard：Fast Refresh 重执行不重复注册。 */
export function registerGlobals(): void {
  if (registered) return;
  registered = true;
  register(AuthService);
  // Task 6 追加：register(ChainListService); register(NotificationService);
}
```

- [ ] **Step 7: 重写 `app/_layout.tsx`（停用 Push 路由 + RSRoot）**

删 `useNotificationRouting` 与 `expo-notifications` import（spec §0：本轮不接推送）。`push.ts` 从此无人调用（Task 11 删文件）。

```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { RSRoot } from '@rabjs/react';
import { queryClient } from '../src/lib/query';
import { registerGlobals } from '../src/services/register';

// 模块级注册（registerGlobals 内部 once-guard，Fast Refresh 安全）
registerGlobals();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <RSRoot>
        <Stack screenOptions={{ headerBackTitle: '返回' }}>
          {/* 不逐个声明 Stack.Screen：路由文件陆续落地，页面标题由各页面内的
              <Stack.Screen options={{ title }} /> 设置。 */}
        </Stack>
      </RSRoot>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 8: `src/lib/auth.tsx` 改为 useAuth shim（Task 11 删）**

中间态：未迁移页面（feed/chains/chain 详情/compose…）还在 `useAuth()`。shim 返回**快照对象**（不是 observable），靠监听 `auth:changed` 强制重渲染刷新快照：

```tsx
import { useEffect, useState } from 'react';
import { useService } from '@rabjs/react';
import type { LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { AuthService } from '../services/auth.service';

interface AuthContextValue {
  user: UserProfile | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

/** 过渡 shim（Task 11 删）：给还没迁到 observer 的旧组件用。
 *  快照语义：auth:changed / ready 翻转（hydrate 完成也发事件）触发重渲染。 */
export function useAuth(): AuthContextValue {
  const auth = useService(AuthService);
  const [, setTick] = useState(0);
  useEffect(() => {
    return auth.on('auth:changed', () => setTick((t) => t + 1), 'global');
  }, [auth]);
  return {
    user: auth.user,
    ready: auth.ready,
    login: (email, password) => auth.login({ email, password }),
    register: (input) => auth.register(input),
    logout: () => auth.logout(),
  };
}
```

- [ ] **Step 9: `src/components/RequireAuth.tsx` observer 化（直读 AuthService，不走 shim）**

```tsx
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { AuthService } from '../services/auth.service';
import { Loading } from './Loading';

/** ready 闸必须有：SecureStore 异步水合期间不能当未登录踢走（web 同步水合才没有这道闸）。 */
export const RequireAuth = observer(function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  if (!auth.ready) return <Loading />;
  if (!auth.user) return <Redirect href="/login" />;
  return <>{children}</>;
});
```

- [ ] **Step 10: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check
```

Expected: 全部通过（`export:check` 产物 `dist-check/` 已在 gitignore；若不在，勿提交该目录）。

模拟器冒烟：`pnpm --filter @moment/app ios`——冷启动登录态保留、登录/登出可用、`(tabs)` 三页照常（仍走 RQ + shim）。

```bash
git add apps/app/package.json apps/app/pnpm-lock.yaml apps/app/src/lib/events.ts apps/app/src/lib/errors.ts apps/app/src/lib/token-store.ts apps/app/src/services/ apps/app/app/_layout.tsx apps/app/src/lib/auth.tsx apps/app/src/components/RequireAuth.tsx
git commit -m "feat(app): 接入 @rabjs/react，全局 AuthService + RSRoot 骨架，停用 Expo 推送路由"
```

---

### Task 2: 登录/注册页迁移——`features/login` + `features/register`

**Files:**
- Create: `apps/app/src/features/login/login.service.ts`
- Create: `apps/app/src/features/login/index.tsx`
- Create: `apps/app/src/features/register/register.service.ts`
- Create: `apps/app/src/features/register/index.tsx`
- Modify: `apps/app/app/login.tsx`（变薄壳）
- Modify: `apps/app/app/register.tsx`（变薄壳）

**Interfaces:**
- Consumes: `AuthService.login/register`（Task 1）；`humanError`（Task 1）；`loginInputSchema` / `registerInputSchema`（`@moment/dto`）。
- Produces: `export const LoginPage` / `export const RegisterPage`（bindServices 包装的组件，路由壳直接渲染）。

- [ ] **Step 1: 建 `src/features/login/login.service.ts`（web 同款）**

```ts
import { Service } from '@rabjs/react';
import { AuthService } from '../../services/auth.service';

/** 登录页：表单字段 + 调 auth.login；schema 校验与跳转留在组件。 */
export class LoginService extends Service {
  email = '';
  password = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).login({ email: this.email, password: this.password });
  }
}
```

- [ ] **Step 2: 建 `src/features/login/index.tsx`（$model 单通道：API 错只读 `$model.submit.error`）**

```tsx
import { useState } from 'react';
import { Button, Pressable, StyleSheet, Text } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { loginInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { LoginService } from './login.service';

const LoginContent = observer(function LoginContent() {
  const service = useService(LoginService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null); // 仅 schema 前置校验

  function onSubmit(): void {
    const parsed = loginInputSchema.safeParse({ email: service.email, password: service.password });
    if (!parsed.success) {
      setError('请输入有效的邮箱和密码');
      return;
    }
    setError(null);
    void service
      .submit()
      // 用 '/'（即 (tabs)/index）而非 '/(tabs)'：group 名作 href 的解析行为版本间不稳
      .then(() => router.replace('/'))
      .catch(() => undefined); // API 错误横幅只读 $model.submit.error，不双写本地 state
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '登录' }} />
      <Text style={styles.title}>时刻</Text>
      <Field label="邮箱" value={service.email} onChangeText={(v) => (service.email = v)} keyboardType="email-address" />
      <Field label="密码" value={service.password} onChangeText={(v) => (service.password = v)} secureTextEntry />
      <ErrorText message={error} />
      <ErrorText message={service.$model.submit.error ? humanError(service.$model.submit.error) : null} />
      <Button
        title={service.$model.submit.loading ? '登录中…' : '登录'}
        onPress={onSubmit}
        disabled={service.$model.submit.loading}
      />
      <Link href="/register" asChild>
        <Pressable>
          <Text style={styles.link}>没有账号？注册</Text>
        </Pressable>
      </Link>
    </Screen>
  );
});

export const LoginPage = bindServices(LoginContent, [LoginService]);

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 24 },
  link: { color: '#4a90d9', textAlign: 'center', marginTop: 16 },
});
```

- [ ] **Step 3: 建 `src/features/register/register.service.ts`**

```ts
import { Service } from '@rabjs/react';
import { AuthService } from '../../services/auth.service';

/** 注册页：表单字段 + 调 auth.register；schema 校验与跳转留在组件。 */
export class RegisterService extends Service {
  email = '';
  password = '';
  nickname = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).register({
      email: this.email,
      password: this.password,
      nickname: this.nickname,
    });
  }
}
```

- [ ] **Step 4: 建 `src/features/register/index.tsx`**

```tsx
import { useState } from 'react';
import { Button, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { registerInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { RegisterService } from './register.service';

const RegisterContent = observer(function RegisterContent() {
  const service = useService(RegisterService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(): void {
    const parsed = registerInputSchema.safeParse({
      email: service.email,
      password: service.password,
      nickname: service.nickname,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === 'password'
          ? '密码需 8–72 位'
          : issue?.path[0] === 'nickname'
            ? '昵称需 1–50 字'
            : '请输入有效邮箱'
      );
      return;
    }
    setError(null);
    void service.submit().then(() => router.replace('/')).catch(() => undefined);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '注册' }} />
      <Text style={styles.title}>注册</Text>
      <Field label="昵称" value={service.nickname} onChangeText={(v) => (service.nickname = v)} />
      <Field label="邮箱" value={service.email} onChangeText={(v) => (service.email = v)} keyboardType="email-address" />
      <Field label="密码（8–72 位）" value={service.password} onChangeText={(v) => (service.password = v)} secureTextEntry />
      <ErrorText message={error} />
      <ErrorText message={service.$model.submit.error ? humanError(service.$model.submit.error) : null} />
      <Button
        title={service.$model.submit.loading ? '注册中…' : '注册'}
        onPress={onSubmit}
        disabled={service.$model.submit.loading}
      />
    </Screen>
  );
});

export const RegisterPage = bindServices(RegisterContent, [RegisterService]);

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
});
```

- [ ] **Step 5: 路由壳 `app/login.tsx` / `app/register.tsx` 变薄壳**

`app/login.tsx` 全文：

```tsx
import { LoginPage } from '../src/features/login';

export default function LoginScreen() {
  return <LoginPage />;
}
```

`app/register.tsx` 全文：

```tsx
import { RegisterPage } from '../src/features/register';

export default function RegisterScreen() {
  return <RegisterPage />;
}
```

- [ ] **Step 6: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：错误密码登录 → 单一横幅「邮箱或密码不对」；正确登录 → 落 `(tabs)`；注册新号同理。

```bash
git add apps/app/src/features/login apps/app/src/features/register apps/app/app/login.tsx apps/app/app/register.tsx
git commit -m "refactor(app): 登录/注册页迁移 rab，API 错误收敛 $model 单通道"
```

---

### Task 3: 时刻详情页迁移——`features/moment`（`comment:changed` / `moment:changed`(react) 发射）

**Files:**
- Create: `apps/app/src/features/moment/moment.service.ts`
- Create: `apps/app/src/features/moment/index.tsx`
- Modify: `apps/app/app/moments/[id].tsx`（变薄壳）

**Interfaces:**
- Consumes: `client.getMoment/listComments/createComment/deleteComment/setReaction/removeReaction`（`@moment/api-client`，已有）；`MomentChangedPayload` / `CommentChangedPayload`（Task 1）；`queryClient` / `qk`（过渡 invalidate）。
- Produces:
  - `class MomentPageService`：`hydrate(momentId: string): void`；字段 `moment: MomentResponse | null`、`deleted: boolean`、`comments: CommentDto[]`、`draft: string`；`get hasMore(): boolean`；方法 `loadMoment() / loadFirstComments() / loadMoreComments() / submitComment() / deleteComment(id: string) / setReaction(emoji: string | null)`。
  - `export const MomentPage`（bindServices 包装，路由壳直接渲染）。

- [ ] **Step 1: 建 `src/features/moment/moment.service.ts`（web `moment.service.ts` 同款 + setReaction + 过渡 invalidate）**

```ts
import { Service } from '@rabjs/react';
import type { CommentDto, MomentResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';
import type { CommentChangedPayload, MomentChangedPayload } from '../../lib/events';

/** 详情页状态：moment + 评论分页 + 草稿。写成功 emit（+ 过渡期 invalidate），不直接拉别人的缓存。 */
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

  /** 路由 param 进来；幂等挡双调用 */
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
    if (gen !== this.gen) return; // 过期响应丢弃
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
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() }); // 过渡期；Task 11 删
  }

  async deleteComment(id: string): Promise<void> {
    await client.deleteComment(id);
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() }); // 过渡期；Task 11 删
  }

  /** emoji null = 取消自己的表情；成功 emit moment:changed(op:'react')。 */
  async setReaction(emoji: string | null): Promise<void> {
    const chainId = this.moment?.chainId ?? '';
    if (emoji === null) await client.removeReaction(this.momentId);
    else await client.setReaction(this.momentId, emoji);
    this.emit('moment:changed', { momentId: this.momentId, chainId, op: 'react' }, 'global');
    void this.loadMoment(); // 本页即时刷新计数
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() }); // 过渡期；Task 11 删
  }
}
```

- [ ] **Step 2: 建 `src/features/moment/index.tsx`**

沿用旧 `app/moments/[id].tsx` 的 JSX 与 styles（视觉不动），RQ 三件套换成 service 字段；错误文案改走 `humanError`（RN 保持 `Alert` 交互）：

```tsx
import { useEffect } from 'react';
import { Alert, Button, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { formatMomentTime, formatRelative } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { useMediaUri } from '../../lib/use-media-uri';
import { MomentPageService } from './moment.service';

function MomentImage({ media }: { media: MomentMedia }) {
  const uri = useMediaUri(media.id);
  if (!uri) return <View style={styles.image} />;
  return <Image source={{ uri }} style={styles.image} resizeMode="contain" />;
}

function ReadyVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} contentFit="contain" style={styles.video} allowsFullscreen />;
}

function VideoBlock({ media }: { media: MomentMedia }) {
  const uri = useMediaUri(media.id);
  if (!uri) return <View style={styles.video} />;
  return <ReadyVideo uri={uri} />;
}

const MomentContent = observer(function MomentContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useService(MomentPageService);

  useEffect(() => {
    service.hydrate(id);
  }, [service, id]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  if (!service.moment && service.$model.loadMoment.loading) return <Loading />;
  if (service.deleted || (!service.moment && service.$model.loadMoment.error)) {
    return (
      <View style={styles.center}>
        <Text style={styles.deleted}>该时刻可能已被删除</Text>
      </View>
    );
  }
  if (!service.moment) return <Loading />;

  const m = service.moment;
  const myEmoji = m.myReaction; // ReactionSummary = { emoji, count } 无 mine；我的表情在 myReaction

  function onEmoji(emoji: string): void {
    void service
      .setReaction(myEmoji === emoji ? null : emoji)
      .catch((err) => onError(err, '操作失败'));
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Text style={styles.author}>{m.author.nickname}</Text>
          <Text style={styles.time}>
            {formatMomentTime(m.happenedAt, m.happenedTzOffset)}
            {m.isBackfill ? ' · 补发' : ''} · 发布于 {formatRelative(m.createdAt)}
          </Text>
        </View>
        {m.content.length > 0 ? <Text style={styles.content}>{m.content}</Text> : null}
        {m.media.map((media) =>
          media.mime.startsWith('video/') ? (
            <VideoBlock key={media.id} media={media} />
          ) : (
            <MomentImage key={media.id} media={media} />
          )
        )}
        {m.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {m.tags.map((t) => (
              <Text key={t.id} style={styles.tag}>#{t.name}</Text>
            ))}
          </View>
        ) : null}

        <View style={styles.reactionRow}>
          {REACTION_EMOJIS.map((emoji) => {
            const summary = m.reactions.find((r) => r.emoji === emoji);
            const active = myEmoji === emoji;
            return (
              <Pressable key={emoji} style={[styles.reaction, active && styles.reactionActive]} onPress={() => onEmoji(emoji)}>
                <Text style={styles.reactionText}>
                  {emoji}
                  {summary && summary.count > 0 ? ` ${summary.count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>评论（{m.commentCount}）</Text>
        {service.comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            <View style={styles.commentHead}>
              <Text style={styles.commentAuthor}>{c.author.nickname}</Text>
              <Text style={styles.commentTime}>{formatRelative(c.createdAt)}</Text>
              <Pressable
                onPress={() => void service.deleteComment(c.id).catch((err) => onError(err, '删除失败'))}
              >
                <Text style={styles.commentDelete}>删除</Text>
              </Pressable>
            </View>
            <Text style={styles.commentBody}>{c.content}</Text>
          </View>
        ))}
        {service.comments.length === 0 ? <Text style={styles.noComment}>还没有评论</Text> : null}
        {service.hasMore ? (
          <Button
            title={service.$model.loadMoreComments.loading ? '加载中…' : '加载更多评论'}
            onPress={() => void service.loadMoreComments().catch((err) => onError(err, '加载失败'))}
          />
        ) : null}
        <View />
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={service.draft}
          onChangeText={(v) => (service.draft = v)}
          placeholder="写评论…（1000 字内）"
          placeholderTextColor="#aaa"
          multiline
        />
        <Button
          title="发送"
          disabled={service.$model.submitComment.loading || service.draft.trim().length === 0}
          onPress={() => void service.submitComment().catch((err) => onError(err, '发送失败'))}
        />
      </View>
    </KeyboardAvoidingView>
  );
});

export const MomentPage = bindServices(MomentContent, [MomentPageService]);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  deleted: { color: '#999' },
  body: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontWeight: '600', fontSize: 16 },
  time: { color: '#999', fontSize: 12 },
  content: { fontSize: 16, lineHeight: 24 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: '#eee' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#000' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { color: '#4a90d9', fontSize: 13 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reaction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  reactionActive: { backgroundColor: '#dcebff' },
  reactionText: { fontSize: 14 },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 8 },
  comment: { backgroundColor: '#fafafa', borderRadius: 8, padding: 10 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { fontWeight: '600', fontSize: 13 },
  commentTime: { color: '#999', fontSize: 12, flex: 1 },
  commentDelete: { color: '#d33', fontSize: 12 },
  commentBody: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  noComment: { color: '#999', fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, maxHeight: 100 },
});
```

- [ ] **Step 3: 路由壳 `app/moments/[id].tsx` 变薄壳**

```tsx
import { MomentPage } from '../../src/features/moment';

export default function MomentDetailScreen() {
  return <MomentPage />;
}
```

- [ ] **Step 4: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：进详情、发评论（计数 +1 且时间线 RQ 缓存失效）、点表情切换/取消、加载更多评论、删除评论。

```bash
git add apps/app/src/features/moment apps/app/app/moments
git commit -m "refactor(app): 时刻详情页迁移 rab，评论/表情事件扇出"
```

---

### Task 4: 发布页迁移——`features/compose`（`moment:changed`(create) 发射）

**Files:**
- Create: `apps/app/src/features/compose/compose.service.ts`
- Create: `apps/app/src/features/compose/index.tsx`
- Modify: `apps/app/app/compose.tsx`（变薄壳）

**Interfaces:**
- Consumes: `compressImage / pickImages / pickVideo / validateVideo` 及类型 `ReadyImage / PickedVideo`（`src/lib/media.ts`，不改）；`client.uploadMedia / createMoment / listChains / listTags`；`qk` / `queryClient`（过渡 invalidate）。
- Produces: `class ComposeService`（draft 全字段 + `hydrate(chainId?: string)` + `submit()`，见 Step 1 完整类体）；`export function ComposePage()`。

- [ ] **Step 1: 建 `src/features/compose/compose.service.ts`**

草稿（type/content/images/video/happenedAt/isBackfill/tagIds/progressLabel/showPicker）全进 Service；`uploadWithRetry` 从旧组件原样搬入。链列表本 Task 先自拉（Task 6 上线全局 `ChainListService` 后改 `resolve`）：

```ts
import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, type MediaCompleteResponse, type MomentType } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';
import { compressImage, pickImages, pickVideo, validateVideo, type PickedVideo, type ReadyImage } from '../../lib/media';

/** 总尝试次数 = 初始 1 次 + ≤2 次重试；网络类（status 0）/5xx 才重试。
 *  服务端 complete 幂等，重试会重新 presign 拿新 mediaId，旧 mediaId 残留由 sweeper 清理。 */
const UPLOAD_ATTEMPTS = 3;

async function uploadWithRetry(
  input: Parameters<typeof client.uploadMedia>[0]
): Promise<MediaCompleteResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await client.uploadMedia(input);
    } catch (err) {
      lastError = err;
      // 413 本地预校验、401（refresh 已失败并 clear 后的残余请求）、403 等重试无意义
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) throw err;
    }
  }
  throw lastError;
}

/** 发布页（spec §6）：草稿进 Service，提交是显式动作，无 effect 链式 setState。 */
export class ComposeService extends Service {
  chainId: string | undefined = undefined;
  type: MomentType = 'text';
  content = '';
  images: ReadyImage[] = [];
  video: PickedVideo | null = null;
  happenedAt = new Date();
  isBackfill = false;
  tagIds: string[] = [];
  progressLabel: string | null = null;
  showPicker = false; // 日期时间选择器展开态（iOS spinner 需要显式收起）

  private editable: { id: string; name: string }[] = [];
  tagNames: { id: string; name: string }[] = [];

  /** 路由 param 进来（?chainId=）；compose 是 modal 路由，bindServices 实例随页面生灭，不挡幂等。 */
  hydrate(chainId: string | undefined): void {
    this.chainId = chainId;
    void this.loadChains().catch(() => undefined);
  }

  get editableChains(): { id: string; name: string }[] {
    return this.editable;
  }

  get activeChainId(): string | undefined {
    return this.chainId ?? this.editable[0]?.id;
  }

  setChain(id: string): void {
    this.chainId = id;
    this.tagIds = [];
    void this.loadChains().catch(() => undefined);
  }

  private async loadChains(): Promise<void> {
    const chains = await client.listChains();
    this.editable = chains.filter((c) => c.myRole !== 'viewer').map((c) => ({ id: c.id, name: c.name }));
    const active = this.chainId ?? this.editable[0]?.id;
    if (active) {
      const tags = await client.listTags(active);
      this.tagNames = tags.tags.map((t) => ({ id: t.id, name: t.name }));
    }
  }

  /** 选图 + 压缩；返回 rejected 数（压缩后仍超 MAX_IMAGE_BYTES 的跳过，组件 Alert 汇总）。 */
  async pickMoreImages(): Promise<number> {
    const picked = await pickImages();
    if (picked.length === 0) return 0;
    const remain = 9 - this.images.length;
    if (remain <= 0) return 0;
    this.progressLabel = '压缩中…';
    const ready: ReadyImage[] = [];
    for (const img of picked.slice(0, remain)) {
      const r = await compressImage(img);
      if (r.size > MAX_IMAGE_BYTES) continue;
      ready.push(r);
    }
    this.progressLabel = null;
    this.images = [...this.images, ...ready].slice(0, 9);
    return picked.length - ready.length;
  }

  /** 选视频 + 校验；返回问题文案（null = 成功）。 */
  async chooseVideo(): Promise<string | null> {
    const picked = await pickVideo();
    if (!picked) return null;
    const problem = validateVideo(picked);
    if (problem) return problem;
    this.video = picked;
    return null;
  }

  toggleTag(id: string): void {
    this.tagIds = this.tagIds.includes(id) ? this.tagIds.filter((t) => t !== id) : [...this.tagIds, id];
  }

  /** 提交：串行上传（进度聚合）→ createMoment → emit。前置校验失败抛 Error（中文 message）。 */
  async submit(): Promise<void> {
    const activeChainId = this.activeChainId;
    if (!activeChainId) throw new Error('请选择要发布到的链（需要编辑权限）');
    if (this.type === 'text' && this.content.trim().length === 0) throw new Error('文字类型需要内容');
    if (this.content.length > 5000) throw new Error('正文最多 5000 字');
    if (this.type === 'media' && this.images.length === 0) throw new Error('图文类型至少选 1 张图（最多 9 张）');
    if (this.type === 'video' && !this.video) throw new Error('视频类型需要先选择视频');

    // 图片走 file: Blob（压缩后百 KB 级，已在内存）；视频走 fileUri 形态——rnPut 按 part
    // 从文件 uri 读盘 PUT，500MB 视频整文件不进内存（见 src/lib/rn-put.ts）。
    const mediaIds: string[] = [];
    type UploadFile =
      | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number };
    let files: UploadFile[] = [];
    if (this.type === 'media') {
      files = this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
    } else if (this.type === 'video' && this.video) {
      files = [{ fileUri: this.video.uri, mime: this.video.mime, size: this.video.size, kind: 'video' as const, durationSeconds: this.video.durationSeconds, sortOrder: 0 }];
    }
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    let doneBytes = 0;
    for (const f of files) {
      const res = await uploadWithRetry({
        ...f,
        onProgress: (loaded) => {
          const overall = totalBytes > 0 ? Math.floor(((doneBytes + loaded) / totalBytes) * 100) : 100;
          this.progressLabel = `上传中 ${overall}%`;
        },
      });
      mediaIds.push(res.mediaId);
      doneBytes += f.size;
    }

    this.progressLabel = '发布中…';
    const created = await client.createMoment(activeChainId, {
      type: this.type,
      content: this.content,
      happenedAt: this.happenedAt.toISOString(),
      // 与 dto 契约同语义：原值（同 JS getTimezoneOffset，东八区 = -480），不取反
      happenedTzOffset: this.happenedAt.getTimezoneOffset(),
      isBackfill: this.isBackfill,
      mediaIds,
      tagIds: this.tagIds,
    });
    this.progressLabel = null;
    this.emit('moment:changed', { momentId: created.id, chainId: activeChainId, op: 'create' }, 'global');
    // 过渡期 invalidate（feed 前缀覆盖全部过滤组合 + 链内列表 + 标签计数）；Task 11 删
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() });
    void queryClient.invalidateQueries({ queryKey: qk.chainMoments(activeChainId) });
    void queryClient.invalidateQueries({ queryKey: qk.tags(activeChainId) });
  }
}
```

- [ ] **Step 2: 建 `src/features/compose/index.tsx`**

沿用旧 JSX/styles，状态读写全走 service；成功后 `Alert` + `router.back()`：

```tsx
import { useEffect } from 'react';
import { Alert, Button, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { SegmentBar } from '../../components/SegmentBar';
import { RequireAuth } from '../../components/RequireAuth';
import { ComposeService } from './compose.service';

const ComposeContent = observer(function ComposeContent() {
  const params = useLocalSearchParams<{ chainId?: string }>();
  const service = useService(ComposeService);

  useEffect(() => {
    service.hydrate(params.chainId);
  }, [service, params.chainId]);

  async function onPickImages(): Promise<void> {
    const rejected = await service.pickMoreImages().catch(() => 0);
    if (rejected > 0) {
      Alert.alert('提示', `${rejected} 张图片压缩后仍超限，已跳过`);
    }
  }

  async function onPickVideo(): Promise<void> {
    const problem = await service.chooseVideo().catch(() => null);
    if (problem) Alert.alert('无法上传', problem);
  }

  async function onSubmit(): Promise<void> {
    try {
      await service.submit();
      Alert.alert('已发布', '可在时刻流中查看');
      router.back();
    } catch (err) {
      // 前置校验（Error 中文 message）直接展示；API 错误走 humanError
      Alert.alert('发布失败', err instanceof Error && !(err instanceof ApiError) ? err.message : humanError(err));
    }
  }

  return (
    <Screen scroll>
      <SegmentBar<string>
        options={[
          { value: 'text', label: '文字' },
          { value: 'media', label: '图文' },
          { value: 'video', label: '视频' },
        ]}
        value={service.type}
        onChange={(t) => {
          service.type = t as typeof service.type;
          service.images = [];
          service.video = null;
        }}
      />

      {service.editableChains.length > 1 ? (
        <View style={styles.chipRow}>
          {service.editableChains.map((c) => (
            <Pressable key={c.id} style={[styles.chip, service.activeChainId === c.id && styles.chipActive]} onPress={() => service.setChain(c.id)}>
              <Text style={[styles.chipText, service.activeChainId === c.id && styles.chipTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.content}
        value={service.content}
        onChangeText={(v) => (service.content = v)}
        placeholder={service.type === 'text' ? '记录这一刻…' : '配文（可选）'}
        placeholderTextColor="#aaa"
        multiline
      />

      {service.type === 'media' ? (
        <View style={styles.mediaBar}>
          <Button title={`选图（${service.images.length}/9）`} onPress={() => void onPickImages()} />
          {service.images.length > 0 ? (
            <Button title="清空" color="#d33" onPress={() => (service.images = [])} />
          ) : null}
        </View>
      ) : null}
      {service.type === 'media' && service.images.length > 0 ? (
        <Text style={styles.mediaHint}>已压缩 {service.images.length} 张（最长边 ≤2048px），共 {Math.round(service.images.reduce((s, i) => s + i.size, 0) / 1024)}KB</Text>
      ) : null}

      {service.type === 'video' ? (
        <View style={styles.mediaBar}>
          <Button title={service.video ? '重选视频' : '选择视频'} onPress={() => void onPickVideo()} />
          {service.video ? (
            <Button title="移除" color="#d33" onPress={() => (service.video = null)} />
          ) : null}
        </View>
      ) : null}
      {service.type === 'video' && service.video ? (
        <Text style={styles.mediaHint}>
          {Math.round(service.video.size / 1024 / 1024)}MB · {Math.floor(service.video.durationSeconds / 60)}分{service.video.durationSeconds % 60}秒 · 分片上传可断点重试
        </Text>
      ) : null}

      <Pressable style={styles.dateBtn} onPress={() => (service.showPicker = true)}>
        <Text style={styles.dateText}>
          发生时间：{service.happenedAt.toLocaleString()}（{service.isBackfill ? '补发' : '当下'}）
        </Text>
      </Pressable>
      {service.showPicker ? (
        <DateTimePicker
          value={service.happenedAt}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => {
            service.showPicker = Platform.OS === 'ios';
            if (d) {
              service.happenedAt = d;
              service.isBackfill = d.getTime() < Date.now() - 10 * 60_000;
            }
          }}
        />
      ) : null}

      {service.tagNames.length > 0 ? (
        <View style={styles.chipRow}>
          {service.tagNames.map((t) => (
            <Pressable key={t.id} style={[styles.chip, service.tagIds.includes(t.id) && styles.chipActive]} onPress={() => service.toggleTag(t.id)}>
              <Text style={[styles.chipText, service.tagIds.includes(t.id) && styles.chipTextActive]}>#{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {service.progressLabel ? <Text style={styles.progress}>{service.progressLabel}</Text> : null}
      <Button title={service.$model.submit.loading ? '处理中…' : '发布'} onPress={() => void onSubmit()} disabled={service.$model.submit.loading} />
    </Screen>
  );
});

const ComposeBound = bindServices(ComposeContent, [ComposeService]);

export function ComposePage() {
  return (
    <RequireAuth>
      <ComposeBound />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  chipActive: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  content: { minHeight: 100, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  mediaBar: { flexDirection: 'row', gap: 12 },
  mediaHint: { color: '#888', fontSize: 12 },
  dateBtn: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2' },
  dateText: { fontSize: 14, color: '#333' },
  progress: { color: '#4a90d9', textAlign: 'center' },
});
```

- [ ] **Step 3: 路由壳 `app/compose.tsx` 变薄壳**

```tsx
import { ComposePage } from '../src/features/compose';

export default function ComposeScreen() {
  return <ComposePage />;
}
```

- [ ] **Step 4: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：文字/图文/视频各发一条；进度文案走查；发布后返回时间线能看到新卡片（RQ invalidate 生效）；带 `?chainId=` 进入预选链。

```bash
git add apps/app/src/features/compose apps/app/app/compose.tsx
git commit -m "refactor(app): 发布页迁移 rab，草稿进 Service，发布事件扇出"
```

---

### Task 5: 新建链 + 邀请接受迁移（`chain:changed`(create) 发射）

**Files:**
- Create: `apps/app/src/features/chains-new/chains-new.service.ts`
- Create: `apps/app/src/features/chains-new/index.tsx`
- Create: `apps/app/src/features/invite/invite.service.ts`
- Create: `apps/app/src/features/invite/index.tsx`
- Modify: `apps/app/app/chains-new.tsx`（变薄壳）
- Modify: `apps/app/app/invites/[token].tsx`（变薄壳）

**Interfaces:**
- Consumes: `createChainInputSchema`（`@moment/dto`）；`client.createChain / acceptInvite`；`qk` / `queryClient`（过渡 invalidate）。
- Produces: `export function ChainsNewPage()`；`export function InvitePage()`。

- [ ] **Step 1: 建 `src/features/chains-new/chains-new.service.ts`**

```ts
import { Service } from '@rabjs/react';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';

/** 新建链：表单 + createChain；schema 校验（Alert）留在组件。 */
export class ChainsNewService extends Service {
  name = '';
  description = '';

  async submit(): Promise<void> {
    const c = await client.createChain({
      name: this.name,
      description: this.description || null,
      visibility: 'private',
    });
    this.emit('chain:changed', { chainId: c.id, op: 'create' }, 'global');
    void queryClient.invalidateQueries({ queryKey: qk.chains() }); // 过渡期；Task 11 删
  }
}
```

- [ ] **Step 2: 建 `src/features/chains-new/index.tsx`**

```tsx
import { Alert, Button, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { createChainInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { RequireAuth } from '../../components/RequireAuth';
import { ChainsNewService } from './chains-new.service';

const Content = observer(function Content() {
  const service = useService(ChainsNewService);

  function onSubmit(): void {
    const parsed = createChainInputSchema.safeParse({
      name: service.name,
      description: service.description || null,
      visibility: 'private',
    });
    if (!parsed.success) {
      Alert.alert('提示', parsed.error.issues[0]?.message ?? '名称需 1–100 字');
      return;
    }
    void service
      .submit()
      .then(() => router.back())
      .catch((err) => Alert.alert('失败', humanError(err)));
  }

  return (
    <Screen scroll>
      <Text style={styles.hint}>链是共享时间线，创建后可邀请家人朋友共同记录。</Text>
      <Field label="名称（1–100 字）" value={service.name} onChangeText={(v) => (service.name = v)} />
      <Field label="描述（可选）" value={service.description} onChangeText={(v) => (service.description = v)} multiline />
      <Button title={service.$model.submit.loading ? '创建中…' : '创建'} onPress={onSubmit} disabled={service.$model.submit.loading} />
    </Screen>
  );
});

const Bound = bindServices(Content, [ChainsNewService]);

export function ChainsNewPage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#888', fontSize: 13 },
});
```

- [ ] **Step 3: 建 `src/features/invite/invite.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { AcceptInviteResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';

/** 邀请接受页：terminal = 邀请失效类错误（不可重试）；成功 emit chain:changed(create)。 */
export class InviteService extends Service {
  token = '';
  result: AcceptInviteResponse | null = null;
  terminal = false;

  hydrate(token: string): void {
    this.token = token;
  }

  async submit(): Promise<void> {
    try {
      const res = await client.acceptInvite(this.token);
      this.result = res;
      this.terminal = false;
      this.emit('chain:changed', { chainId: res.chainId, op: 'create' }, 'global');
      void queryClient.invalidateQueries({ queryKey: qk.chains() }); // 过渡期；Task 11 删
    } catch (err) {
      if (err instanceof ApiError) {
        this.terminal = new Set(['INVITE_EXPIRED', 'INVITE_ALREADY_ACCEPTED', 'INVITE_EMAIL_MISMATCH']).has(err.code);
      } else {
        this.terminal = false;
      }
      throw err; // 文案留给组件 humanError
    }
  }
}
```

- [ ] **Step 4: 建 `src/features/invite/index.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { RequireAuth } from '../../components/RequireAuth';
import { InviteService } from './invite.service';

const Content = observer(function Content() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const service = useService(InviteService);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    service.hydrate(token);
  }, [service, token]);

  function onAccept(): void {
    setError(null);
    void service
      .submit()
      .catch((err) => setError(err instanceof ApiError ? humanError(err) : '网络错误，请重试'));
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>加入时光链</Text>
      {service.result ? (
        <>
          <Text style={styles.ok}>
            {service.result.alreadyMember ? '你已经是这条链的成员' : '已成功加入！'}（角色：
            {service.result.role === 'owner' ? '主理人' : service.result.role === 'editor' ? '编辑' : '只读'}）
          </Text>
          <Button title="打开这条链" onPress={() => router.replace(`/chains/${service.result?.chainId}`)} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>接受邀请后将出现在「我的链」中，即可查看与记录。</Text>
          <Text style={styles.error}>{error}</Text>
          {service.$model.submit.loading ? (
            <ActivityIndicator />
          ) : (
            <Button title="接受邀请" onPress={onAccept} disabled={service.terminal} />
          )}
        </>
      )}
    </Screen>
  );
});

const Bound = bindServices(Content, [InviteService]);

export function InvitePage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
  hint: { color: '#777', fontSize: 14 },
  ok: { color: '#2a8a4a', fontSize: 16, textAlign: 'center' },
  error: { color: '#d33', fontSize: 14 },
});
```

- [ ] **Step 5: 路由壳变薄壳**

`app/chains-new.tsx`：

```tsx
import { ChainsNewPage } from '../src/features/chains-new';

export default function ChainsNewScreen() {
  return <ChainsNewPage />;
}
```

`app/invites/[token].tsx`：

```tsx
import { InvitePage } from '../../src/features/invite';

export default function InviteScreen() {
  return <InvitePage />;
}
```

- [ ] **Step 6: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：新建链 → 返回「我的链」看到新链（RQ invalidate）；`moment://invites/<token>` 深链进入 → 接受 → 链列表出现。

```bash
git add apps/app/src/features/chains-new apps/app/src/features/invite apps/app/app/chains-new.tsx apps/app/app/invites
git commit -m "refactor(app): 新建链/邀请接受迁移 rab，建链事件扇出"
```

---

### Task 6: 全局 ChainListService + NotificationService + 通知页 + 链列表页（听众上线 + 通知跳转）

**Files:**
- Create: `apps/app/src/services/chain-list.service.ts`
- Create: `apps/app/src/services/notification.service.ts`
- Modify: `apps/app/src/services/register.ts`（追加两个注册，Auth 恒排首）
- Create: `apps/app/src/features/notifications/index.tsx`
- Modify: `apps/app/app/(tabs)/notifications.tsx`（变薄壳）
- Create: `apps/app/src/features/chains/index.tsx`
- Modify: `apps/app/app/(tabs)/chains.tsx`（变薄壳）

**Interfaces:**
- Consumes: `AuthService`（Task 1）；`client.listChains / listNotifications / markNotificationsRead`；`formatRelative`（`src/lib/format.ts`）。
- Produces:
  - `class ChainListService`：`chains: ChainDto[]`；`load(): Promise<void>`；`myRoleOf(chainId: string): ChainRole | undefined`。
  - `class NotificationService`：`items: NotificationDto[]`；`get unreadCount(): number`；`get hasMore(): boolean`；`loadFirst() / loadMore() / markAllRead() / markOneRead(id: string)`。
  - `export function NotificationsPage()`；`export function ChainsPage()`。

- [ ] **Step 1: 建 `src/services/chain-list.service.ts`**

与 web 差异：App 的 `AuthService` hydrate 完成必发 `auth:changed`，所以构造兜底 `if (user) load()` 不是必须——仍保留（防御 register 顺序回归）：

```ts
import { Service } from '@rabjs/react';
import type { ChainDto, ChainRole, UserProfile } from '@moment/dto';
import { client } from '../lib/api';
import { AuthService } from './auth.service';

/** 全局链列表：链 tab / 时间线链色 chip / 发布选链 / 角色判断共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];

  constructor() {
    super();
    // 兜底：auth:changed（AuthService hydrate 完成会发）是主通道
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

  /** 当前用户在某链的角色（未拉到/非成员 undefined）——chain-home/设置页据此控权。 */
  myRoleOf(chainId: string): ChainRole | undefined {
    return this.chains.find((c) => c.id === chainId)?.myRole;
  }
}
```

- [ ] **Step 2: 建 `src/services/notification.service.ts`（web 同款：30s 轮询 merge）**

```ts
import { Service } from '@rabjs/react';
import type { NotificationDto, UserProfile } from '@moment/dto';
import { client } from '../lib/api';
import { AuthService } from './auth.service';

const POLL_MS = 30_000;

/** 全局通知：通知页列表与未读数共享一份；轮询只 merge 不重置分页。 */
export class NotificationService extends Service {
  items: NotificationDto[] = [];
  nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
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

  /** 全局单例随应用存续：interval 靠 auth:changed 关，不进 destroy()（生命周期靠 GC，时机不可控）。 */
  private startPolling(): void {
    if (this.timer) return;
    void this.loadFirst().catch(() => undefined);
    this.timer = setInterval(() => void this.pollUnread().catch(() => undefined), POLL_MS);
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

  /** 30s 轮询：拉第一页 merge——新条目前置、已有条目按 id 换新（读态变化），不动 nextCursor。 */
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
      const page = await client.listNotifications(false, { cursor, limit: 50 });
      unreadIds.push(...page.notifications.filter((n) => n.readAt === null).map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    // schema 限每批 1–100 个：分批串行提交；空 ids 跳过 POST（schema 拒空数组）
    for (let i = 0; i < unreadIds.length; i += 100) {
      const chunk = unreadIds.slice(i, i + 100);
      if (chunk.length === 0) continue;
      await client.markNotificationsRead(chunk);
    }
    await this.loadFirst(); // 直接重拉，不发自发自收的 notification:changed
  }

  /** 点单条已读（跳转前调）。 */
  async markOneRead(id: string): Promise<void> {
    await client.markNotificationsRead([id]);
    await this.loadFirst();
  }
}
```

- [ ] **Step 3: `src/services/register.ts` 追加注册**

```ts
import { register } from '@rabjs/react';
import { AuthService } from './auth.service';
import { ChainListService } from './chain-list.service';
import { NotificationService } from './notification.service';

let registered = false;

/** 全局 Service 注册（AuthService 恒排首——后续 Service 构造里 resolve(AuthService)）。
 *  模块级 once-guard：Fast Refresh 重执行不重复注册。 */
export function registerGlobals(): void {
  if (registered) return;
  registered = true;
  register(AuthService);
  register(ChainListService);
  register(NotificationService);
}
```

- [ ] **Step 4: 建 `src/features/notifications/index.tsx`（跳转 = momentId 优先，chainId 兜底）**

与旧页行为差异（对齐 web + spec §5.3）：不再「进页自动全部已读」，改显式「全部标为已读」按钮；点击条目 → 单条已读 + 跳转。

```tsx
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { NotificationDto } from '@moment/dto';
import { NotificationService } from '../../services/notification.service';
import { formatRelative } from '../../lib/format';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};

/** payload 顶层优先（web 同款），嵌套 data 兜底（Phase 5 推送 payload 契约）。 */
function targetOf(n: NotificationDto): { momentId?: string; chainId?: string } {
  const p = n.payload as {
    momentId?: unknown;
    chainId?: unknown;
    data?: { momentId?: unknown; chainId?: unknown };
  };
  const momentId =
    typeof p.momentId === 'string' ? p.momentId : typeof p.data?.momentId === 'string' ? p.data.momentId : undefined;
  const chainId =
    typeof p.chainId === 'string' ? p.chainId : typeof p.data?.chainId === 'string' ? p.data.chainId : undefined;
  return { momentId, chainId };
}

function payloadTitle(n: NotificationDto): string {
  const p = n.payload as { title?: unknown; momentContent?: unknown; content?: unknown; chainName?: unknown };
  for (const key of ['title', 'momentContent', 'content', 'chainName'] as const) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return TYPE_LABEL[n.type] ?? '时刻';
}

export const NotificationsPage = observer(function NotificationsPage() {
  const service = useService(NotificationService);

  function onOpen(n: NotificationDto): void {
    const { momentId, chainId } = targetOf(n);
    if (n.readAt == null) void service.markOneRead(n.id).catch(() => undefined);
    if (momentId) router.push(`/moments/${momentId}`);
    else if (chainId) router.push(`/chains/${chainId}`);
  }

  return (
    <View style={styles.flex}>
      {service.unreadCount > 0 ? (
        <Pressable style={styles.markAll} onPress={() => void service.markAllRead().catch(() => undefined)}>
          <Text style={styles.markAllText}>
            {service.$model.markAllRead.loading ? '标记中…' : `全部标为已读（${service.unreadCount}）`}
          </Text>
        </Pressable>
      ) : null}
      <FlashList
        data={service.items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={service.$model.loadFirst.loading} onRefresh={() => void service.loadFirst().catch(() => undefined)} />
        }
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={() => void service.loadMore().catch(() => undefined)}
        renderItem={({ item }) => {
          const p = item.payload as { body?: unknown };
          return (
            <Pressable style={[styles.item, item.readAt == null && styles.unread]} onPress={() => onOpen(item)}>
              <Text style={styles.title}>{payloadTitle(item)}</Text>
              <Text style={styles.body}>{typeof p.body === 'string' ? p.body : ''}</Text>
              <Text style={styles.time}>{formatRelative(item.createdAt)}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !service.$model.loadFirst.loading ? (
            <View style={styles.empty}><Text style={styles.emptyText}>暂无通知</Text></View>
          ) : null
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  markAll: { padding: 12 },
  markAllText: { color: '#4a90d9', textAlign: 'center', fontSize: 14 },
  list: { padding: 12 },
  loadingMore: { textAlign: 'center', color: '#999', padding: 12 },
  item: { padding: 12, borderRadius: 8, backgroundColor: '#fff', marginBottom: 8 },
  unread: { backgroundColor: '#eef5ff' },
  title: { fontWeight: '600', fontSize: 15 },
  body: { color: '#444', fontSize: 14, marginTop: 2 },
  time: { color: '#999', fontSize: 12, marginTop: 4 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#999' },
});
```

- [ ] **Step 5: 路由壳 `app/(tabs)/notifications.tsx` 变薄壳**

```tsx
import { NotificationsPage } from '../../src/features/notifications';

export default function NotificationsScreen() {
  return <NotificationsPage />;
}
```

- [ ] **Step 6: 建 `src/features/chains/index.tsx`（链列表 observer 化；登出暂留，Task 10 移去「我」页）**

```tsx
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainListService } from '../../services/chain-list.service';
import { AuthService } from '../../services/auth.service';
import { Loading } from '../../components/Loading';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

export const ChainsPage = observer(function ChainsPage() {
  const chainList = useService(ChainListService);
  const auth = useService(AuthService);

  if (chainList.chains.length === 0 && chainList.$model.load.loading) return <Loading />;

  return (
    <View style={styles.flex}>
      <FlashList
        data={chainList.chains}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={chainList.$model.load.loading} onRefresh={() => void chainList.load().catch(() => undefined)} />
        }
        renderItem={({ item }: { item: ChainDto }) => (
          <Pressable style={styles.item} onPress={() => router.push(`/chains/${item.id}`)}>
            <View style={styles.itemMain}>
              <Text style={styles.name}>{item.name}</Text>
              {item.description ? <Text style={styles.desc} numberOfLines={1}>{item.description}</Text> : null}
            </View>
            <Text style={styles.role}>{ROLE_LABEL[item.myRole ?? 'viewer'] ?? ''}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有链，新建一条或等好友邀请</Text>
          </View>
        }
        ListHeaderComponent={
          <Link href="/chains-new" asChild>
            <Pressable style={styles.newBtn}>
              <Text style={styles.newBtnText}>＋ 新建链</Text>
            </Pressable>
          </Link>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={styles.user}>{auth.user?.nickname ?? ''}</Text>
            <Pressable onPress={() => void auth.logout().catch(() => undefined)}>
              <Text style={styles.logout}>退出登录</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  list: { padding: 12 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 8 },
  itemMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  desc: { color: '#888', fontSize: 13, marginTop: 2 },
  role: { color: '#4a90d9', fontSize: 13 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#999' },
  newBtn: { backgroundColor: '#4a90d9', borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 12 },
  newBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  user: { color: '#666' },
  logout: { color: '#d33' },
});
```

- [ ] **Step 7: 路由壳 `app/(tabs)/chains.tsx` 变薄壳**

```tsx
import { ChainsPage } from '../../src/features/chains';

export default function ChainsScreen() {
  return <ChainsPage />;
}
```

- [ ] **Step 8: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：登录后链 tab 自动出现链（`auth:changed` → ChainList.load）；发布 moment 后另一账号收到通知（30s 轮询或下拉）；点通知 → 跳时刻详情且未读消失；纯 chain 类通知 → 跳链详情；登出再登录 → 通知重新拉取。

```bash
git add apps/app/src/services apps/app/src/features/notifications apps/app/src/features/chains apps/app/app/(tabs)/notifications.tsx apps/app/app/(tabs)/chains.tsx
git commit -m "feat(app): 全局 ChainList/Notification Service 上线，通知点击跳转"
```

---

### Task 7: 时间线迁移——`features/feed`（`moment:changed` / `comment:changed` 听众）

**Files:**
- Create: `apps/app/src/features/feed/feed.service.ts`
- Create: `apps/app/src/features/feed/index.tsx`
- Modify: `apps/app/app/(tabs)/index.tsx`（变薄壳）

**Interfaces:**
- Consumes: `ChainListService.chains`（Task 6，链 chip 用，不自拉）；`client.getFeed / listTags`。
- Produces:
  - `class FeedService`：`chainId: string | undefined`；`tagId: string | undefined`；`order: 'happened_at' | 'created_at'`；`moments: MomentResponse[]`；`tags: TagResponse[]`；`get hasMore(): boolean`；`setChainFilter(id: string | undefined): void`；`setTagFilter(id: string | undefined): void`；`toggleOrder(): void`；`loadFirst() / loadMore()`。
  - `export const FeedPage`（bindServices 包装）。
- 同时改 Task 4 的 `ComposeService`：链列表从自拉换 `resolve(ChainListService)`（见 Step 3）。

- [ ] **Step 1: 建 `src/features/feed/feed.service.ts`**

沿用现有时间线的筛选形态（链 chip + 标签 chip + 排序切换），不做 web 的月份索引（YAGNI）：

```ts
import { Service } from '@rabjs/react';
import type { MomentResponse, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { ChainListService } from '../../services/chain-list.service';

const PAGE_SIZE = 20;

/** 时间线（spec §4）：筛选 + feed 分页 + 单链标签；链 chip 读全局 ChainListService。 */
export class FeedService extends Service {
  chainId: string | undefined = undefined;
  tagId: string | undefined = undefined;
  order: 'happened_at' | 'created_at' = 'happened_at';
  moments: MomentResponse[] = [];
  tags: TagResponse[] = [];
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    void this.loadFirst().catch(() => undefined);
    void this.loadTags().catch(() => undefined);
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst().catch(() => undefined); // 评论数在 moment 上
      },
      'global',
    );
    // chain:changed 不听：链名/角色变化由 ChainListService 持有，feed 数据本身不受影响
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  private nextCursor: string | null = null;

  setChainFilter(id: string | undefined): void {
    this.chainId = id;
    this.tagId = undefined;
    void this.loadFirst().catch(() => undefined);
    void this.loadTags().catch(() => undefined);
  }

  setTagFilter(id: string | undefined): void {
    this.tagId = id;
    void this.loadFirst().catch(() => undefined);
  }

  toggleOrder(): void {
    this.order = this.order === 'happened_at' ? 'created_at' : 'happened_at';
    void this.loadFirst().catch(() => undefined);
  }

  get chainList(): { id: string; name: string }[] {
    return this.resolve(ChainListService).chains.map((c) => ({ id: c.id, name: c.name }));
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.getFeed({
      cursor: undefined,
      chainIds: this.chainId ? [this.chainId] : undefined,
      tagId: this.tagId,
      order: this.order,
      limit: PAGE_SIZE,
    });
    if (gen !== this.gen) return; // 改筛选只走 loadFirst，cursor 清掉
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.getFeed({
        cursor: this.nextCursor,
        chainIds: this.chainId ? [this.chainId] : undefined,
        tagId: this.tagId,
        order: this.order,
        limit: PAGE_SIZE,
      });
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** 单链筛选才拉标签（与旧页 enabled: chainId != null 同语义）。 */
  private async loadTags(): Promise<void> {
    if (!this.chainId) {
      this.tags = [];
      return;
    }
    this.tags = (await client.listTags(this.chainId)).tags;
  }
}
```

- [ ] **Step 2: 建 `src/features/feed/index.tsx`**

沿用旧 JSX/styles（chip 行 + FlashList + FAB），RQ 换 service：

```tsx
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { FeedService } from './feed.service';

const FeedContent = observer(function FeedContent() {
  const service = useService(FeedService);

  if (service.moments.length === 0 && service.$model.loadFirst.loading) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <Chip label="全部链" active={service.chainId == null} onPress={() => service.setChainFilter(undefined)} />
        {service.chainList.map((c) => (
          <Chip key={c.id} label={c.name} active={service.chainId === c.id} onPress={() => service.setChainFilter(c.id)} />
        ))}
        <Chip
          label={service.order === 'happened_at' ? '按发生时间' : '按添加时间'}
          active={false}
          onPress={() => service.toggleOrder()}
        />
      </View>
      {service.chainId != null && service.tags.length > 0 ? (
        <View style={styles.filters}>
          <Chip label="全部标签" active={service.tagId == null} onPress={() => service.setTagFilter(undefined)} />
          {service.tags.map((t) => (
            <Chip key={t.id} label={`#${t.name}`} active={service.tagId === t.id} onPress={() => service.setTagFilter(t.id)} />
          ))}
        </View>
      ) : null}
      {service.$model.loadFirst.error ? <Text style={styles.errorBanner}>加载失败，下拉重试</Text> : null}
      <FlashList
        data={service.moments}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={service.$model.loadFirst.loading} onRefresh={() => void service.loadFirst().catch(() => undefined)} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void service.loadMore().catch(() => undefined)}
        renderItem={({ item }: { item: MomentResponse }) => (
          <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有时刻，发布第一条吧</Text>
          </View>
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
      <Link href={{ pathname: '/compose' }} asChild>
        <Pressable style={styles.fab} onPress={() => undefined}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </Link>
    </View>
  );
});

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export const FeedPage = bindServices(FeedContent, [FeedService]);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e5e5' },
  chipActive: { backgroundColor: '#4a90d9', borderColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  list: { paddingBottom: 16 },
  empty: { padding: 48, alignItems: 'center' },
  emptyText: { color: '#999' },
  loadingMore: { textAlign: 'center', color: '#999', padding: 12 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4a90d9',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
  errorBanner: { color: '#d33', textAlign: 'center', padding: 8 },
});
```

- [ ] **Step 3: `ComposeService` 链列表改读全局（`src/features/compose/compose.service.ts`）**

`private editable` 及 `loadChains` 里的 `client.listChains()` 换成 `resolve(ChainListService)`（标签仍按 activeChainId 自拉）：

```ts
  private async loadChains(): Promise<void> {
    const chains = this.resolve(ChainListService).chains;
    this.editable = chains.filter((c) => c.myRole !== 'viewer').map((c) => ({ id: c.id, name: c.name }));
    const active = this.chainId ?? this.editable[0]?.id;
    if (active) {
      const tags = await client.listTags(active);
      this.tagNames = tags.tags.map((t) => ({ id: t.id, name: t.name }));
    }
  }
```

import 行加 `import { ChainListService } from '../../services/chain-list.service';`，并删掉不再用的 `client.listChains` 调用（`client` 仍被 `listTags/uploadMedia/createMoment` 用，import 保留）。

- [ ] **Step 4: 路由壳 `app/(tabs)/index.tsx` 变薄壳**

```tsx
import { FeedPage } from '../../src/features/feed';

export default function FeedScreen() {
  return <FeedPage />;
}
```

- [ ] **Step 5: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：时间线浏览 + 下拉刷新 + 滚动加载；切链/切标签/切排序；发布 moment 返回时间线列表置顶（事件扇出，无 invalidate 也生效）；发评论后时间线评论数 +1。

```bash
git add apps/app/src/features/feed apps/app/src/features/compose/compose.service.ts apps/app/app/(tabs)/index.tsx
git commit -m "refactor(app): 时间线迁移 rab，feed 事件听众上线"
```

---

### Task 8: 链详情页迁移——`features/chain-home`（全量 rab 化，功能不丢）

**Files:**
- Create: `apps/app/src/features/chain-home/chain-home.service.ts`
- Create: `apps/app/src/features/chain-home/index.tsx`
- Modify: `apps/app/app/chains/[chainId].tsx`（变薄壳）

**Interfaces:**
- Consumes: `client.getChain / listChainMoments / listMembers / listInvites / listTags / updateMemberRole / removeMember / createInvite / revokeInvite / createTag / deleteTag`；`ChainChangedPayload`（Task 1）；`qk` / `queryClient`（过渡 invalidate）。
- Produces:
  - `class ChainHomeService`：`hydrate(chainId: string): void`；字段 `chain: ChainDto | null`、`moments: MomentResponse[]`、`members: ChainMemberDto[]`、`invites: InviteDto[]`、`tags: TagResponse[]`、`segment: 'timeline' | 'members' | 'invites' | 'tags'`；`get hasMore(): boolean`、`get myRole(): ChainRole | undefined`；方法 `changeRole(userId, role) / removeMember(userId) / createInvite(role) / revokeInvite(id) / addTag(name) / deleteTag(id)`。
  - `export const ChainHomePage`。

**注意：`listInvites` 仅 owner 可调（editor 403）——`loadMembers` 里按 `chain.myRole === 'owner'` 才拉，非 owner `invites = []` 且邀请段隐藏生成入口（对 editor 隐藏邀请列表是权限事实，不是功能缺失；Task 9 设置页同样处理）。**

- [ ] **Step 1: 建 `src/features/chain-home/chain-home.service.ts`**

```ts
import { Service } from '@rabjs/react';
import type { ChainDto, ChainMemberDto, InviteDto, MomentResponse, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';
import type { ChainChangedPayload } from '../../lib/events';

export type ChainSegment = 'timeline' | 'members' | 'invites' | 'tags';

/** 链详情（本 Task 保持全功能四段；Task 9 上线设置页后收薄为 timeline + tags）。 */
export class ChainHomeService extends Service {
  chainId = '';
  chain: ChainDto | null = null;
  segment: ChainSegment = 'timeline';
  moments: MomentResponse[] = [];
  members: ChainMemberDto[] = [];
  invites: InviteDto[] = [];
  tags: TagResponse[] = [];
  private nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private sectionsLoaded = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后由用户导航离开
        void this.loadChain().catch(() => undefined);
      },
      'global',
    );
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.chain = null;
    this.moments = [];
    this.members = [];
    this.invites = [];
    this.tags = [];
    this.sectionsLoaded = false;
    void this.loadChain().catch(() => undefined);
    void this.loadFirst().catch(() => undefined);
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  get myRole(): string | undefined {
    // 优先 chain.myRole（getChain 实时）；兜底全局链列表
    return this.chain?.myRole;
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      this.sectionsLoaded = true;
      void this.loadMembers().catch(() => undefined);
      void this.loadTags().catch(() => undefined);
    }
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listChainMoments(this.chainId, { cursor: undefined, limit: 20 });
    if (gen !== this.gen) return;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listChainMoments(this.chainId, { cursor: this.nextCursor, limit: 20 });
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async loadMembers(): Promise<void> {
    this.members = await client.listMembers(this.chainId);
    // listInvites 仅 owner（editor 调会 403；这是服务端权限事实）
    if (this.chain?.myRole === 'owner') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
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

  async createInvite(role: 'editor' | 'viewer'): Promise<string> {
    const invite = await client.createInvite(this.chainId, { role });
    await this.loadMembers();
    return invite.token; // 组件拼 moment://invites/<token> 走 Share
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async addTag(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await client.createTag(this.chainId, trimmed);
    await this.loadTags();
    void queryClient.invalidateQueries({ queryKey: qk.tags(this.chainId) }); // 过渡期；Task 11 删
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
    void queryClient.invalidateQueries({ queryKey: qk.tags(this.chainId) }); // 过渡期；Task 11 删
  }
}
```

- [ ] **Step 2: 建 `src/features/chain-home/index.tsx`**

沿用旧 `app/chains/[chainId].tsx` 的四段交互（`Alert` 确认流保留），成员/邀请/标签视图内联为本页区块（不再拆独立 View 组件），styles 从旧文件原样搬入（文末）：

```tsx
import { useEffect, useState } from 'react';
import { Alert, Button, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { ChainMemberDto, MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar } from '../../components/SegmentBar';
import { formatRelative } from '../../lib/format';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const [segment, setSegment] = useState<ChainSegment>('timeline');

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  if (!service.chain && service.$model.loadChain.loading) return <Loading />;

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  const myRole = service.myRole;
  const canManage = myRole === 'owner';

  function onRolePress(m: ChainMemberDto): void {
    if (!canManage || m.role === 'owner') return;
    Alert.alert('修改角色', `${m.nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== m.role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => void service.changeRole(m.userId, r).catch((err) => onError(err, '改角色失败')),
        })),
      {
        text: '移出链',
        style: 'destructive',
        onPress: () => void service.removeMember(m.userId).catch((err) => onError(err, '移出失败')),
      },
    ]);
  }

  async function onCreateInvite(): Promise<void> {
    try {
      const token = await service.createInvite('editor');
      await Share.share({
        message: `邀请你加入「${service.chain?.name ?? ''}」时光链：moment://invites/${token}`,
      });
    } catch (err) {
      onError(err, '生成邀请失败');
    }
  }

  function onRevokeInvite(inviteId: string): void {
    Alert.alert('吊销邀请', '吊销后对方无法再用该链接加入', [
      { text: '取消', style: 'cancel' },
      {
        text: '吊销',
        style: 'destructive',
        onPress: () => void service.revokeInvite(inviteId).catch((err) => onError(err, '吊销失败')),
      },
    ]);
  }

  return (
    <View style={styles.flex}>
      <View style={styles.head}>
        <Text style={styles.name}>{service.chain?.name ?? ''}</Text>
        {service.chain?.description ? <Text style={styles.desc}>{service.chain.description}</Text> : null}
        <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })} />
      </View>
      <SegmentBar<ChainSegment>
        options={[
          { value: 'timeline', label: '时间线' },
          { value: 'members', label: `成员 ${service.members.length}` },
          { value: 'invites', label: '邀请' },
          { value: 'tags', label: `标签 ${service.tags.length}` },
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'timeline' ? (
        <FlashList
          data={service.moments}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.4}
          onEndReached={() => void service.loadMore().catch(() => undefined)}
          renderItem={({ item }: { item: MomentResponse }) => (
            <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}

      {segment === 'members' ? (
        <View style={styles.section}>
          {service.members.map((m) => (
            <Pressable key={m.userId} style={styles.row} onPress={() => onRolePress(m)}>
              <Text style={styles.rowMain}>{m.nickname}</Text>
              <Text style={styles.rowSide}>{ROLE_LABEL[m.role] ?? m.role}</Text>
            </Pressable>
          ))}
          {canManage ? null : <Text style={styles.hint}>仅主理人可修改角色/移除成员</Text>}
        </View>
      ) : null}

      {segment === 'invites' ? (
        <View style={styles.section}>
          {canManage ? (
            <Button title="生成邀请（编辑）并发送" onPress={() => void onCreateInvite()} />
          ) : null}
          {service.invites.map((i) => (
            <View key={i.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
                <Text style={styles.rowSub}>
                  {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
                </Text>
              </View>
              {i.acceptedAt || !canManage ? null : (
                <Pressable onPress={() => onRevokeInvite(i.id)}>
                  <Text style={styles.danger}>吊销</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {segment === 'tags' ? <TagsSection service={service} /> : null}
    </View>
  );
});

/** 标签段需要本地输入框 state，拆成子组件——service 经 props 传入（同一 bindServices 实例，
 *  与 web chain-settings 的 sections.tsx 同款；子块自身只 observer，不再 useService）。 */
const TagsSection = observer(function TagsSection({ service }: { service: ChainHomeService }) {
  const [name, setName] = useState('');

  function onDelete(tagId: string, tagName: string): void {
    Alert.alert('删除标签', `删除「${tagName}」将从相关时刻上移除`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void service.deleteTag(tagId).catch((err) => Alert.alert('失败', humanError(err))),
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagCreate}>
        <TextInput
          style={styles.tagInput}
          value={name}
          onChangeText={setName}
          placeholder="新标签名（链内唯一，上限 100 个）"
          placeholderTextColor="#aaa"
        />
        <Button
          title="添加"
          onPress={() =>
            void service
              .addTag(name)
              .then(() => setName(''))
              .catch((err) => Alert.alert('失败', humanError(err)))
          }
        />
      </View>
      {service.tags.map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.rowMain}>#{t.name}（{t.momentCount} 条）</Text>
          <Pressable onPress={() => onDelete(t.id, t.name)}>
            <Text style={styles.danger}>删除</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
});

export const ChainHomePage = bindServices(Content, [ChainHomeService]);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  head: { padding: 16, backgroundColor: '#fff', gap: 6 },
  name: { fontSize: 20, fontWeight: '700' },
  desc: { color: '#777', fontSize: 14 },
  list: { paddingBottom: 16 },
  empty: { color: '#999', textAlign: 'center', padding: 32 },
  section: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  rowMain: { flex: 1, fontSize: 15 },
  rowSide: { color: '#4a90d9', fontSize: 13 },
  rowSub: { color: '#999', fontSize: 12, marginTop: 2 },
  hint: { color: '#aaa', fontSize: 12 },
  inviteBar: { gap: 8 },
  tagCreate: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tagInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  danger: { color: '#d33', fontSize: 13 },
});
```

- [ ] **Step 3: 路由壳 `app/chains/[chainId].tsx` 变薄壳**

```tsx
import { ChainHomePage } from '../../src/features/chain-home';

export default function ChainDetailScreen() {
  return <ChainHomePage />;
}
```

- [ ] **Step 4: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟（owner 账号）：链详情四段走查；改成员角色/移出；生成邀请 → Share 弹出；吊销邀请；增删标签。editor 账号：邀请段不出现「生成」且无 403 报错（invites 空）。发布 moment 后链内时间线置顶。

```bash
git add apps/app/src/features/chain-home apps/app/app/chains
git commit -m "refactor(app): 链详情页迁移 rab（成员/邀请/标签权限对齐服务端）"
```

---

### Task 9: 新增链设置页——`chains/[chainId]/settings`（分享链接 / 转让 / 删除链；chain-home 收薄）

**Files:**
- Create: `apps/app/src/features/chain-settings/chain-settings.service.ts`
- Create: `apps/app/src/features/chain-settings/index.tsx`
- Create: `apps/app/app/chains/[chainId]/settings.tsx`（新路由）
- Modify: `apps/app/src/features/chain-home/index.tsx`（删 members/invites 段，head 加设置齿轮）
- Modify: `apps/app/src/features/chain-home/chain-home.service.ts`（删 members/invites 字段与方法）
- Modify: `apps/app/app.config.ts`（extra 加 `webUrl`）
- Modify: `apps/app/src/lib/api.ts`（导出 `webUrl`）

**Interfaces:**
- Consumes: `client.getChain / listMembers / listInvites / listShareLinks / createShareLink / revokeShareLink / updateChain / updateMemberRole / removeMember / transferChain / createInvite / revokeInvite / deleteChain`；`CHAIN_COLORS / CHAIN_ICONS`（`@moment/dto`）；`ChainChangedPayload`（Task 1）。
- Produces:
  - `webUrl: string`（`src/lib/api.ts`，读 `extra.webUrl`，缺省 `http://localhost:5173`）——分享链接 `${webUrl}/share/${token}` 走 `Share.share`（长辈在浏览器打开，web 已有公开页）。
  - `class ChainSettingsService`（见 Step 2）。
  - `export function ChainSettingsPage()`。
  - chain-home 收薄后只剩 `chain / moments / tags`，`segment` 收为 `'timeline' | 'tags'`。

**权限面（服务端事实）：** owner 全量；editor 只见资料展示 + 成员列表（只读）+ 「退出链」；`listInvites` / `listShareLinks` **仅 owner 调**（editor/viewer 打开设置页不触发这两个请求）。

- [ ] **Step 1: `app.config.ts` extra 加 `webUrl`，`src/lib/api.ts` 导出**

`app.config.ts`（`extra` 块整体替换；这是 Expo 公开变量，不涉及 server `config.ts`）：

```ts
  extra: {
    apiUrl,
    webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? undefined },
  },
```

`src/lib/api.ts` 末尾追加：

```ts
/** 分享链接落 Web 端（/share/:token，web 已有匿名公开页）——长辈用浏览器打开。 */
export const webUrl =
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ??
  'http://localhost:5173';
```

- [ ] **Step 2: 建 `src/features/chain-settings/chain-settings.service.ts`**

web `chain-settings.service.ts` 的 RN 版：资料表单无封面（`updateChainInputSchema` 不支持 coverMediaId）；`loadMembers` 里 `listInvites` 仅 owner；分享链接/转让/删除 owner 专属：

```ts
import { Service } from '@rabjs/react';
import type { ChainColor, ChainDto, ChainIcon, ShareLinkDto } from '@moment/dto';
import { client } from '../../lib/api';
import type { ChainChangedPayload } from '../../lib/events';

/** 设置页全部状态：链详情 + 资料/标签表单 + 成员 + 邀请 + 分享链接 + 危险区。 */
export class ChainSettingsService extends Service {
  chainId = '';
  chain: ChainDto | null = null;

  members: Awaited<ReturnType<typeof client.listMembers>> = [];
  invites: Awaited<ReturnType<typeof client.listInvites>> = [];
  shareLinks: ShareLinkDto[] = [];
  tags: Awaited<ReturnType<typeof client.listTags>>['tags'] = [];

  // 资料表单（name/description/color/icon；无封面——服务端 updateChain 不支持）
  formName = '';
  formDescription = '';
  formColor: ChainColor = 'coral';
  formIcon: ChainIcon | null = null;
  formHydrated = false;

  // 分享链接创建选项（与 web 同款）
  shareExpire: 'never' | '7' | '30' = 'never';

  // 成员操作
  inviteEmail = '';

  private sectionsLoaded = false;

  constructor() {
    super();
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后页面即将跳走
        void this.loadChain().catch(() => undefined);
      },
      'global',
    );
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    void this.loadChain().catch(() => undefined);
  }

  get myRole(): string | undefined {
    return this.chain?.myRole;
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      this.sectionsLoaded = true;
      void this.loadMembers().catch(() => undefined);
      if (this.chain.myRole === 'owner') {
        void this.loadShareLinks().catch(() => undefined);
      }
      void this.loadTags().catch(() => undefined);
    }
    if (!this.formHydrated) {
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
    // listInvites 仅 owner（editor 调会 403）
    if (this.chain?.myRole === 'owner') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadShareLinks(): Promise<void> {
    if (this.chain?.myRole !== 'owner') return;
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
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async createShareLink(): Promise<void> {
    let expiresAt: string | undefined;
    if (this.shareExpire === '7') expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
    if (this.shareExpire === '30') expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
    await client.createShareLink(this.chainId, expiresAt ? { expiresAt } : {});
    await this.loadShareLinks();
  }

  async revokeShareLink(id: string): Promise<void> {
    await client.revokeShareLink(id);
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

  /** 退出链（owner 必须先转让，服务端 OWNER_MUST_TRANSFER 兜底）。 */
  async leaveChain(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async transferChain(userId: string): Promise<void> {
    await client.transferChain(this.chainId, userId);
    await this.loadMembers();
    await this.loadChain();
  }

  async createInvite(): Promise<string> {
    const invite = await client.createInvite(this.chainId, {
      email: this.inviteEmail.trim() || undefined,
      role: 'editor',
    });
    this.inviteEmail = '';
    await this.loadMembers();
    return invite.token;
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async addTag(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await client.createTag(this.chainId, trimmed);
    await this.loadTags();
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
  }

  async deleteChain(): Promise<void> {
    await client.deleteChain(this.chainId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'delete' }, 'global');
  }
}
```

- [ ] **Step 3: 建 `src/features/chain-settings/index.tsx`**

分区 UI（ScrollView；错误统一 `Alert` + `humanError`，loading 读 `$model.<method>.loading`）。完整代码：

```tsx
import { useEffect, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { CHAIN_COLORS, CHAIN_ICONS } from '@moment/dto';
import { webUrl } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { formatRelative } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { RequireAuth } from '../../components/RequireAuth';
import { ChainSettingsService } from './chain-settings.service';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainSettingsService);
  const auth = useService(AuthService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  if (!service.chain && service.$model.loadChain.loading) return <Loading />;
  if (!service.chain) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>链加载失败</Text>
        <Button title="重试" onPress={() => void service.loadChain().catch(() => undefined)} />
      </View>
    );
  }

  const isOwner = service.myRole === 'owner';
  const myUserId = auth.user?.id;

  function onRolePress(userId: string, nickname: string, role: string): void {
    if (!isOwner || role === 'owner') return;
    Alert.alert('修改角色', `${nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => void service.changeRole(userId, r).catch((err) => onError(err, '改角色失败')),
        })),
      ...(userId === myUserId
        ? [
            {
              text: '退出链',
              style: 'destructive' as const,
              onPress: () =>
                void service
                  .leaveChain(userId)
                  .then(() => router.back())
                  .catch((err) => onError(err, '退出失败')),
            },
          ]
        : [
            {
              text: '移出链',
              style: 'destructive' as const,
              onPress: () => void service.removeMember(userId).catch((err) => onError(err, '移出失败')),
            },
          ]),
    ]);
  }

  function onTransfer(userId: string, nickname: string): void {
    Alert.alert('转让链', `把主理人转让给 ${nickname}？转让后你变为编辑`, [
      { text: '取消', style: 'cancel' },
      {
        text: '转让',
        style: 'destructive',
        onPress: () => void service.transferChain(userId).catch((err) => onError(err, '转让失败')),
      },
    ]);
  }

  function onDeleteChain(): void {
    Alert.alert('删除链', '删除后所有成员都无法访问这条链，确认？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void service
            .deleteChain()
            .then(() => router.replace('/chains'))
            .catch((err) => onError(err, '删除失败')),
      },
    ]);
  }

  /** url 是完整地址：分享链接走 `${webUrl}/share/${token}`（浏览器打开），邀请走 `moment://invites/${token}`。 */
  async function onShare(url: string): Promise<void> {
    try {
      await Share.share({ message: url });
    } catch {
      // 用户取消分享面板：静默
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: '链设置' }} />

      <Text style={styles.sectionTitle}>资料{isOwner ? '' : '（仅主理人可修改）'}</Text>
      {isOwner ? (
        <>
          <TextInput style={styles.input} value={service.formName} onChangeText={(v) => (service.formName = v)} placeholder="链名（1–100 字）" placeholderTextColor="#aaa" />
          <TextInput style={styles.input} value={service.formDescription} onChangeText={(v) => (service.formDescription = v)} placeholder="描述（可选）" placeholderTextColor="#aaa" multiline />
          <View style={styles.chipRow}>
            {CHAIN_COLORS.map((c) => (
              <Pressable key={c} style={[styles.chip, service.formColor === c && styles.chipActive]} onPress={() => (service.formColor = c)}>
                <Text style={[styles.chipText, service.formColor === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRow}>
            {CHAIN_ICONS.map((i) => (
              <Pressable key={i} style={[styles.chip, service.formIcon === i && styles.chipActive]} onPress={() => (service.formIcon = i)}>
                <Text style={styles.chipText}>{i}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={service.$model.saveProfile.loading ? '保存中…' : '保存资料'} disabled={service.$model.saveProfile.loading} onPress={() => void service.saveProfile().catch((err) => onError(err, '保存失败'))} />
        </>
      ) : (
        <>
          <Text style={styles.row}>{service.chain.name}</Text>
          {service.chain.description ? <Text style={styles.muted}>{service.chain.description}</Text> : null}
          {myUserId ? (
            <Button title="退出这条链" color="#d33" onPress={() => void service.leaveChain(myUserId).then(() => router.back()).catch((err) => onError(err, '退出失败'))} />
          ) : null}
        </>
      )}

      <Text style={styles.sectionTitle}>成员（{service.members.length}）</Text>
      {service.members.map((m) => (
        <Pressable key={m.userId} style={styles.rowBox} onPress={() => onRolePress(m.userId, m.nickname, m.role)}>
          <Text style={styles.row}>{m.nickname}</Text>
          <View style={styles.rowSide}>
            {isOwner && m.role !== 'owner' ? (
              <Pressable onPress={() => onTransfer(m.userId, m.nickname)}>
                <Text style={styles.link}>转让</Text>
              </Pressable>
            ) : null}
            <Text style={styles.muted}>{ROLE_LABEL[m.role] ?? m.role}</Text>
          </View>
        </Pressable>
      ))}

      {isOwner ? (
        <>
          <Text style={styles.sectionTitle}>邀请</Text>
          <Button
            title="生成邀请链接（编辑）"
            disabled={service.$model.createInvite.loading}
            onPress={() =>
              void service
                .createInvite()
                .then((token) => onShare(`邀请你加入「${service.chain?.name ?? ''}」时光链：moment://invites/${token}`))
                .catch((err) => onError(err, '生成邀请失败'))
            }
          />
          {service.invites.map((i) => (
            <View key={i.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
                <Text style={styles.muted}>
                  {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
                </Text>
              </View>
              {i.acceptedAt ? null : (
                <Pressable onPress={() => void service.revokeInvite(i.id).catch((err) => onError(err, '吊销失败'))}>
                  <Text style={styles.danger}>吊销</Text>
                </Pressable>
              )}
            </View>
          ))}

          <Text style={styles.sectionTitle}>分享链接（给长辈看这条链）</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, service.shareExpire === 'never' && styles.chipActive]} onPress={() => (service.shareExpire = 'never')}>
              <Text style={[styles.chipText, service.shareExpire === 'never' && styles.chipTextActive]}>永不过期</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '7' && styles.chipActive]} onPress={() => (service.shareExpire = '7')}>
              <Text style={[styles.chipText, service.shareExpire === '7' && styles.chipTextActive]}>7 天</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '30' && styles.chipActive]} onPress={() => (service.shareExpire = '30')}>
              <Text style={[styles.chipText, service.shareExpire === '30' && styles.chipTextActive]}>30 天</Text>
            </Pressable>
          </View>
          <Button
            title={service.$model.createShareLink.loading ? '创建中…' : '创建分享链接'}
            disabled={service.$model.createShareLink.loading}
            onPress={() => void service.createShareLink().catch((err) => onError(err, '创建失败'))}
          />
          {service.shareLinks.map((s) => (
            <View key={s.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{webUrl}/share/{s.token.slice(0, 8)}…</Text>
                <Text style={styles.muted}>
                  {s.revokedAt ? '已吊销' : s.expiresAt ? `至 ${formatRelative(s.expiresAt)}` : '永不过期'} · {formatRelative(s.createdAt)}
                </Text>
              </View>
              {s.revokedAt ? null : (
                <View style={styles.rowSide}>
                  <Pressable onPress={() => void onShare(`${webUrl}/share/${s.token}`)}>
                    <Text style={styles.link}>发送</Text>
                  </Pressable>
                  <Pressable onPress={() => void service.revokeShareLink(s.id).catch((err) => onError(err, '吊销失败'))}>
                    <Text style={styles.danger}>吊销</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          <Text style={styles.sectionTitle}>危险区</Text>
          <Button title="删除这条链" color="#d33" disabled={service.$model.deleteChain.loading} onPress={onDeleteChain} />
        </>
      ) : null}
      <View />
    </ScrollView>
  );
});

const Bound = bindServices(Content, [ChainSettingsService]);

export function ChainSettingsPage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  chipActive: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  rowBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  rowMain: { flex: 1 },
  rowSide: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { fontSize: 15 },
  link: { color: '#4a90d9', fontSize: 13 },
  danger: { color: '#d33', fontSize: 13 },
  muted: { color: '#999', fontSize: 12, marginTop: 2 },
});
```

- [ ] **Step 4: 新路由 `app/chains/[chainId]/settings.tsx`（薄壳）**

```tsx
import { ChainSettingsPage } from '../../../src/features/chain-settings';

export default function ChainSettingsScreen() {
  return <ChainSettingsPage />;
}
```

- [ ] **Step 5: chain-home 收薄（成员/邀请挪进设置页）**

`src/features/chain-home/chain-home.service.ts`：
- 删字段 `members` / `invites`、方法 `loadMembers / changeRole / removeMember / createInvite / revokeInvite` 及 `loadChain` 里的 `loadMembers` 级联；`loadTags` 保留（时间线标签段仍在链页）。
- `ChainSegment` 收为 `'timeline' | 'tags'`。

`src/features/chain-home/index.tsx`：
- `SegmentBar` options 删「成员/邀请」两项；删 `onRolePress / onCreateInvite / onRevokeInvite` 与 members/invites 两段 JSX；`TagsSection` 保留。
- head 行加齿轮（所有成员可见；页内按角色控权）：

```tsx
        <View style={styles.headActions}>
          <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })} />
          <Pressable style={styles.gear} onPress={() => router.push(`/chains/${service.chainId}/settings`)}>
            <Text style={styles.gearText}>⚙️ 设置</Text>
          </Pressable>
        </View>
```

styles 追加 `headActions: { flexDirection: 'row', alignItems: 'center', gap: 12 }`、`gear: { paddingVertical: 6 }`、`gearText: { color: '#4a90d9', fontSize: 14 }`。

- [ ] **Step 6: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟（owner）：设置页改链名/颜色/图标 → 保存 → 返回链页与链列表名字即时更新（`chain:changed`）；创建分享链接（7 天）→ 发送面板出现 `http://localhost:5173/share/...`；吊销；生成邀请；转让主理人 → 自己变编辑、危险区消失；删除链 → 回链列表且列表不再有该链。editor：设置页只见资料展示 + 成员 + 退出链；退出后链列表消失。

```bash
git add apps/app/src/features/chain-settings apps/app/src/features/chain-home apps/app/app/chains apps/app/app.config.ts apps/app/src/lib/api.ts
git commit -m "feat(app): 链设置页（资料/成员/邀请/分享链接/转让/删除），chain-home 收薄"
```

---

### Task 10: 新增「我」页——`(tabs)/me` + 第 4 个 tab（昵称 / 头像 / 登出）

**Files:**
- Create: `apps/app/src/features/me/me.service.ts`
- Create: `apps/app/src/features/me/index.tsx`
- Create: `apps/app/app/(tabs)/me.tsx`（新路由）
- Modify: `apps/app/app/(tabs)/_layout.tsx`（3 tab → 4 tab）
- Modify: `apps/app/src/features/chains/index.tsx`（删底部昵称/登出 footer——职能移入「我」页）

**Interfaces:**
- Consumes: `AuthService.user / refreshUser / logout`（Task 1）；`compressImage / pickImages`（`src/lib/media.ts`）；`MAX_IMAGE_BYTES`（`@moment/dto`）；`client.uploadMedia / updateMe`。
- Produces: `class MeService`（`nicknameDraft / saveNickname() / pickAndUploadAvatar() / clearAvatar()`）；`export function MePage()`。

**边界（数据事实）：** `updateMeInputSchema` 无 password 字段——**不做改密码**；无主题系统——**不做主题切换**。头像上传走媒体管线（单图 → 压缩 → Blob）。

- [ ] **Step 1: 建 `src/features/me/me.service.ts`**

```ts
import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { client } from '../../lib/api';
import { compressImage, pickImages } from '../../lib/media';
import { AuthService } from '../../services/auth.service';

/** 「我」页：昵称草稿 + 头像上传/清除。更新成功走 auth.refreshUser（由 Auth 发 auth:changed）。 */
export class MeService extends Service {
  nicknameDraft = '';

  /** 从 AuthService.user 水合昵称草稿（进入页面时组件调一次）。 */
  hydrateFromUser(): void {
    this.nicknameDraft = this.resolve(AuthService).user?.nickname ?? '';
  }

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async saveNickname(): Promise<void> {
    const nickname = this.nicknameDraft.trim();
    if (!nickname) throw new Error('昵称需 1–50 字');
    const next = await client.updateMe({ nickname });
    this.auth.refreshUser(next);
  }

  /** 单图 → 压缩 → uploadMedia → updateMe(avatarMediaId)。返回问题文案（null = 成功）。 */
  async pickAndUploadAvatar(): Promise<string | null> {
    const picked = await pickImages();
    if (picked.length === 0) return null;
    const compressed = await compressImage(picked[0]!);
    if (compressed.size > MAX_IMAGE_BYTES) return '图片太大了，换一张试试';
    const res = await client.uploadMedia({
      file: compressed.blob,
      mime: compressed.mime,
      size: compressed.size,
      kind: 'image',
    });
    const next = await client.updateMe({ avatarMediaId: res.mediaId });
    this.auth.refreshUser(next);
    return null;
  }

  async clearAvatar(): Promise<void> {
    const next = await client.updateMe({ avatarMediaId: null });
    this.auth.refreshUser(next);
  }
}
```

- [ ] **Step 2: 建 `src/features/me/index.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Alert, Button, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { MeService } from './me.service';

const MeContent = observer(function MeContent() {
  const auth = useService(AuthService);
  const service = useService(MeService);

  useEffect(() => {
    service.hydrateFromUser();
  }, [service]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  function onLogout(): void {
    Alert.alert('退出登录', '退出后需要重新登录', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        // logout → secureTokenStore.clear() → auth:changed(null) → RequireAuth 踢回 /login
        onPress: () => void auth.logout().catch(() => undefined),
      },
    ]);
  }

  const user = auth.user;
  if (!user) return <View style={styles.flex} />;

  return (
    <View style={styles.body}>
      <Pressable style={styles.avatarBox} onPress={() => void service.pickAndUploadAvatar().then((p) => { if (p) Alert.alert('无法上传', p); }).catch((err) => onError(err, '上传头像失败'))}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{user.nickname.slice(0, 1)}</Text>
          </View>
        )}
        <Text style={styles.link}>换头像</Text>
      </Pressable>
      {user.avatarUrl ? (
        <Button title="清除头像" color="#d33" disabled={service.$model.clearAvatar.loading} onPress={() => void service.clearAvatar().catch((err) => onError(err, '清除失败'))} />
      ) : null}

      <Text style={styles.sectionTitle}>昵称</Text>
      <TextInputRow service={service} />

      <Text style={styles.sectionTitle}>邮箱</Text>
      <Text style={styles.muted}>{user.email}</Text>

      <View style={styles.spacer} />
      <Button title="退出登录" color="#d33" onPress={onLogout} />
    </View>
  );
});

/** 昵称输入行：TextInput 受控值绑 service.nicknameDraft（observer 响应）。 */
const TextInputRow = observer(function TextInputRow({ service }: { service: MeService }) {
  const [draft, setDraft] = useState(service.nicknameDraft);
  useEffect(() => setDraft(service.nicknameDraft), [service.nicknameDraft]);
  return (
    <View style={styles.nicknameRow}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onEndEditing={() => (service.nicknameDraft = draft)}
        placeholder="昵称（1–50 字）"
        placeholderTextColor="#aaa"
        maxLength={50}
      />
      <Button
        title={service.$model.saveNickname.loading ? '保存中…' : '保存'}
        disabled={service.$model.saveNickname.loading}
        onPress={() => void service.saveNickname().catch((err) => Alert.alert('失败', humanError(err)))}
      />
    </View>
  );
});

export const MePage = bindServices(MeContent, [MeService]);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, padding: 16, gap: 10 },
  avatarBox: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, color: '#888' },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 12 },
  nicknameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  muted: { color: '#888', fontSize: 14 },
  link: { color: '#4a90d9', fontSize: 14 },
  spacer: { flex: 1 },
});
```

- [ ] **Step 3: 新路由 `app/(tabs)/me.tsx`（薄壳）**

```tsx
import { MePage } from '../../src/features/me';

export default function MeScreen() {
  return <MePage />;
}
```

- [ ] **Step 4: `(tabs)/_layout.tsx` 加第 4 个 tab**

```tsx
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { RequireAuth } from '../../src/components/RequireAuth';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={[styles.icon, focused && styles.iconActive]}>{label}</Text>;
}

export default function TabsLayout() {
  return (
    <RequireAuth>
      <Tabs screenOptions={{ headerShown: true, tabBarLabelStyle: { fontSize: 11 } }}>
        <Tabs.Screen
          name="index"
          options={{ title: '时刻流', tabBarIcon: ({ focused }) => <TabIcon label="🏠" focused={focused} /> }}
        />
        <Tabs.Screen
          name="chains"
          options={{ title: '我的链', tabBarIcon: ({ focused }) => <TabIcon label="⛓️" focused={focused} /> }}
        />
        <Tabs.Screen
          name="notifications"
          options={{ title: '通知', tabBarIcon: ({ focused }) => <TabIcon label="🔔" focused={focused} /> }}
        />
        <Tabs.Screen
          name="me"
          options={{ title: '我', tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} /> }}
        />
      </Tabs>
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 18, opacity: 0.4 },
  iconActive: { opacity: 1 },
});
```

- [ ] **Step 5: 链列表页删登出 footer（`src/features/chains/index.tsx`）**

删 `ListFooterComponent`（昵称 + 退出登录）与 `auth` 的 `useService`（若无其他使用）；styles 删 `footer / user / logout` 三项。

- [ ] **Step 6: 验证 + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

模拟器冒烟：第 4 个 tab 出现；改昵称保存 → 链页 footer 无残留、通知/评论作者名即时刷新（`auth:changed` → 各 Service 重拉）；换头像 → 头像更新（预签名 URL 6 天有效，refreshUser 换新）；清除头像；登出 → 踢回登录页，SecureStore 清空（重进需登录）。

```bash
git add apps/app/src/features/me apps/app/app/(tabs)/me.tsx apps/app/app/(tabs)/_layout.tsx apps/app/src/features/chains/index.tsx
git commit -m "feat(app): 「我」页（昵称/头像/登出），tab 扩为 4 个"
```

---

### Task 11: 清理——卸 TanStack Query / 删 push / 改 CLAUDE.md / DoD

**Files:**
- Modify: `apps/app/package.json`（删 `@tanstack/react-query` / `expo-notifications` / `expo-device`）
- Delete: `apps/app/src/lib/query.ts`、`apps/app/src/lib/keys.ts`、`apps/app/src/lib/auth.tsx`、`apps/app/src/lib/push.ts`
- Modify: `apps/app/src/services/auth.service.ts`（删两处 `queryClient` 引用）
- Modify: `apps/app/src/features/moment/moment.service.ts`、`src/features/compose/compose.service.ts`、`src/features/chains-new/chains-new.service.ts`、`src/features/invite/invite.service.ts`、`src/features/chain-home/chain-home.service.ts`（删全部过渡 `queryClient.invalidateQueries` 与 `qk` import）
- Modify: `apps/app/app.config.ts`（plugins 删 `'expo-notifications'`）
- Modify: `apps/app/CLAUDE.md`（重写放置约束为 rab 分层）

**Interfaces:**
- Consumes: 前面全部任务的终态。
- Produces: 终态——App 无 RQ / 无推送 / 无 Context 业务态。

- [ ] **Step 1: 全仓扫残留**

```bash
grep -rn "tanstack\|queryClient\|qk\." apps/app/src apps/app/app --include='*.ts' --include='*.tsx'
grep -rn "expo-notifications\|expo-device\|lib/push\|lib/auth" apps/app/src apps/app/app apps/app/app.config.ts --include='*.ts' --include='*.tsx' --include='*.json'
```

Expected: 只剩本 Task 要删的那几处（AuthService 两处 `queryClient`、五个 service 的 `qk`/`queryClient` import 与调用、`_layout.tsx` 的 `QueryClientProvider`、`package.json` / `app.config.ts` 依赖项）。

- [ ] **Step 2: 删过渡代码**

- `_layout.tsx`：删 `QueryClientProvider` 包装与 `queryClient` import（`RSRoot` 直接包 `Stack`）。
- `auth.service.ts`：删 `import { queryClient }` 与 `onAuthCleared` 回调、`applyAuth` 里的 `queryClient.clear()`（会话缓存清理由 ChainList/Notification 的 `auth:changed` 监听承担）。
- 五个 feature service：删 `import { queryClient }` / `import { qk }` 与所有 `void queryClient.invalidateQueries(...)` 行（连同「过渡期；Task 11 删」注释）。
- 删文件：`src/lib/query.ts`、`src/lib/keys.ts`、`src/lib/auth.tsx`（shim）、`src/lib/push.ts`。
- `app.config.ts`：`plugins` 收为 `['expo-router', 'expo-secure-store']`。

- [ ] **Step 3: 卸依赖**

```bash
cd apps/app && pnpm remove '@tanstack/react-query' 'expo-notifications' 'expo-device'
```

（`expo-constants` / `expo-linking` 等仍被使用，保留；若 lint 报未用依赖再核对。）

- [ ] **Step 4: 重写 `apps/app/CLAUDE.md`**

```markdown
# apps/app — Expo React Native 客户端

## 这个目录负责什么

- 移动端客户端（Expo + expo-router），消费同一套 `@moment/dto` / `@moment/api-client` 契约。

## 放置约束

- 状态三层（rab）：全局 Service 在 `src/services/`（`register` 注册于 `src/services/register.ts`，`app/_layout.tsx` 模块级调用，AuthService 排首）；页面组件 `src/features/<name>/index.tsx` + 同目录 `<name>.service.ts`（`bindServices`，模块级 bind 一次）。跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- `app/*.tsx` 是薄壳：解析参数 → `service.hydrate(params)`（组件 `useEffect`）→ 渲染 feature；跳转（`router.push/back`）留组件，Service 不碰 router。
- 可复用无业务组件放 `src/components/`；纯逻辑放 `src/lib/`。

## 开发偏好

- token 存取只经 `src/lib/token-store.ts`（`onAuthCleared` 是登出/refresh 失效的单路径桥）；API 调用集中在 `src/lib/api.ts`（`client` / `apiUrl` / `webUrl`）。
- SecureStore 异步：`AuthService.ready` 是登录闸；`applyAuth` 必须先 `await setTokens` 再发任何带 token 的调用。
- 媒体管线：图片压缩后 Blob 进内存；视频一律 `fileUri` + `rn-put` 分片读盘，整文件不进内存。
- 深链接/邀请路径新增时同步检查 `app.config.ts` 的 scheme 配置。
- 推送未接入（spec 2026-08-18 起下线 Expo Push；接入国内方案时另立计划）。
```

- [ ] **Step 5: 验证 + DoD + commit**

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check
```

iOS 模拟器 DoD（spec §8 全流程，两端账号配合）：

1. 注册新号 → 自动登录 → 落 4-tab 时间线；杀 App 重启 → 登录态保留（SecureStore 水合 + `me()` 校验）。
2. 时间线：浏览、下拉刷新、滚动分页、切链/切标签/切排序。
3. 发布：文字 / 图文（多图压缩）/ 视频（分片进度）→ 时间线与链内时间线置顶。
4. 时刻详情：评论、表情（切换/取消）、加载更多评论、删除评论；计数联动。
5. 链设置：改资料（名/描述/色/图标）→ 链页与列表即时更新；创建分享链接 → 浏览器开 `webUrl/share/<token>` 能匿名看；吊销后打不开；生成/吊销邀请；转让主理人；删除链。
6. 通知：另一账号发布/评论 → 30s 轮询出现未读；点通知跳时刻详情且未读清零；「全部标为已读」。
7. 我：改昵称、换头像、清除头像、登出 → 踢回登录页；重登数据正常。
8. 登出态冷启动直达 `(tabs)` 路由 → `RequireAuth` 踢登录页；`moment://invites/<token>` 深链在未登录时先登录再接受（或登录页跳转后仍可手动重进，不要求 returnTo）。

```bash
git add -A apps/app
git commit -m "refactor(app): 删除 TanStack Query 与推送残留，rab 迁移收尾"
```

---

## 计划自查记录

- **Spec 覆盖**：§1 目录分层（Task 1–10 逐步落位，Task 11 定稿 CLAUDE.md）；§2 三层与事件（全程约束）；§3 全局 Service（Task 1/6）；§4 页面 Service 与数据流（Task 2–8）；§5.1 链设置（Task 9，无封面/无改密码——服务端无此能力）；§5.2 我页（Task 10，无改密码）；§5.3 通知跳转（Task 6，momentId 优先 chainId 兜底，软删由详情页「已删除」态兜底）；§6 媒体管线不动（Task 4 原样搬）；§7 删除项（Task 1 起 push 失效、Task 11 全删；zustand 本就不存在，spec §0 描述有误，无操作）；§8 验证（每 Task typecheck+lint，Task 1/11 export:check，Task 11 DoD 清单）。
- **中间态铁律核对**：Task 3–5、Task 8 的发射方全部 emit + invalidate；Task 6/7 听众上线时发射方已在位；Task 11 摘 invalidate。
- **类型一致性**：`AuthService.ready`、`ChainListService.myRoleOf`、`webUrl`、事件 payload 类型在各 Task 间签名一致；`hydrate(chainId/momentId/token)` 命名统一。
