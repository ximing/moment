# Phase 6: 共享客户端与 Web（packages/api-client + apps/web 全功能）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立两端共享的 typed API 客户端 `@moment/api-client`（Bearer 自动附带、401 单飞 refresh + 重放一次、ApiError 透传 `error.code/message/status`、覆盖 Phase 1–5 全部端点、媒体上传 helper 含 PUT 直传与 multipart 分片串行每片重试 + `onProgress`——**不得挡死上传进度**，spec §2 monorepo 结构原文要求），并交付 `apps/web`（@moment/web）：登录/注册、feed 无限滚动（链/tag 过滤 + 排序切换）、链列表/链详情（时间线 + 成员/邀请/tag 管理）、链内 composer（三类型 + 图片九宫格 + 视频信息 + happened_at + is_backfill + tag 选择 + 上传进度条）、moment 详情（评论/表情 reaction）、通知页（未读标记）、邀请接受页。**范围声明：moment 的编辑/删除 Web UI 不在本阶段**（api-client 的 `updateMoment/deleteMoment` 方法已覆盖，UI 归 Phase 7/8 或 backlog；spec §1 的 editor 权限在 Web 端由 composer + 删除自己评论承接）。

**Architecture:** 两层交付。`packages/api-client` 是纯 TS 库（NodeNext ESM，与 @moment/dto 同构），运行时不依赖浏览器环境——但类型层面需要 DOM lib（`fetch/Response/Blob/AbortSignal/XMLHttpRequest` 全局类型，tsconfig `lib: ["ES2022","DOM","DOM.Iterable"]`）；浏览器专属的 XHR 上传实现通过可注入的 `putWithProgress` 提供，node 测试注入 fake。`apps/web` 是 Vite SPA：TanStack Query 管全部服务端状态（feed 用 `useInfiniteQuery`，mutation 后按 query key 精确 invalidate），本地 auth 状态一个轻量 context；所有 API 调用一律走 `@moment/api-client`，**组件里禁止裸 fetch**。公开分享页 `/share/:token` 属 Phase 8，不在本计划。

**Tech Stack:**
- api-client：TypeScript 5.7 + NodeNext ESM + `tsx --test`（CONVENTIONS §4 dto/api-client 二选一中选 `tsx --test`，与 dto 一致）；网络层测试用手写 mock fetch（注入 `fetchImpl`），不起 msw。
- web：**照搬 aimo apps/web 的选型**（实测 `/Users/ximing/project/mygithub/aimo/apps/web/package.json` 与 src 结构）：Vite 7 + `@vitejs/plugin-react` + React 19 + TS（tsconfig references `tsconfig.app.json`/`tsconfig.node.json`、`moduleResolution: bundler`、`jsx: react-jsx`、`@` alias → `src`）、**Tailwind CSS 3.4**（`tailwind.config.js` + `postcss.config.js` autoprefixer）、eslint flat config（`@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `globals`，非 @moment/eslint-config）、图标 `lucide-react`、无重组件库依赖（aimo 用 @headlessui/react，本计划交互简单，全部原生元素 + Tailwind，不引入）。差异声明：aimo 的服务层是 `@rabjs/react` DI，moment 按 spec §2 用 **TanStack Query v5 + React Router v7**（aimo 亦用 react-router ^7）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§2 选型/monorepo 结构、§4 全部已建 API、§5.5 上传管线、§5.6 时区与补发）；`docs/superpowers/plans/CONVENTIONS.md` §3.6 路由总表 / §4 测试策略。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- 假设 Phase 1–5 已全部执行完毕：`@moment/dto` 的 Phase 1–4 符号（`AuthTokens/UserProfile/AuthResponse/ChainDto/ChainMemberDto/InviteDto/AcceptInviteResponse/MomentResponse（含 `tags: TagBrief[]`）/MomentListResponse/FeedResponse/MediaPresignResponse/MediaPartsResponse/MediaCompleteResponse/MAX_IMAGE_BYTES/MAX_VIDEO_BYTES/VIDEO_PART_SIZE/MAX_VIDEO_DURATION_SECONDS/feedQuerySchema/createMomentInputSchema/updateMomentInputSchema` 等）与 CONVENTIONS §3.6 路由全部可直接引用（**免责条款**：Phase 2–4 计划间偶有同物异名——如同一 patch schema 在 Phase 3 计划文本中写作类型 `PatchMomentInput`、Phase 4 计划写作 `updateMomentInputSchema`——执行时一律以 `@moment/dto` 落地导出为准，在 api-client 内做等价映射（映射写在 client.ts 顶部并注释），禁止反向要求改 dto/server）；本计划不改 server 一行代码。
- **api-client 公共签名**（Task 1–3 建立，Phase 7 app 端逐字消费，不得改名）：`createMomentClient(options: MomentClientOptions): MomentClient`，`MomentClientOptions = { baseUrl: string; tokenStore: TokenStore; fetchImpl?: typeof fetch; putWithProgress?: PutFn }`，`TokenStore = { getAccessToken(): Promise<string|null>|string|null; getRefreshToken(): Promise<string|null>|string|null; setTokens(tokens: AuthTokens): Promise<void>|void; clear(): Promise<void>|void }`。
- refresh 语义：请求带 token 收到 401 → **单飞**调 `POST /api/auth/refresh`（并发多个 401 只发一次 refresh，其余等同一 promise）→ 成功 `setTokens` 后原请求**重放一次**；重放仍 401 或 refresh 本身失败 → `tokenStore.clear()` + 抛 `ApiError`。`/api/auth/*` 端点自身不触发 refresh（`skipAuthRefresh`），防循环。
- `ApiError extends Error`，字段 `status: number`、`code: string`、`details?: unknown`——来自服务端统一错误体 `{error:{code,message,details?}}`（Phase 1 契约）；非 JSON/网络失败时 `code: 'NETWORK_ERROR'`、`status: 0`。
- 媒体读取走 `client.fetchMediaBlob(mediaId): Promise<Blob>`：`GET /api/media/:id` 是 `@Authorized()` 端点（Phase 3 Task 6），鉴权只认 `Authorization: Bearer` 头，而 `<img>/<video>` 元素请求不会携带该头——**禁止**把 `mediaUrl(id)` 直接塞进 `<img>/<video>` 的 src（必 401，feed/链时间线/详情页全部媒体不可用）。Web 组件一律 `fetchMediaBlob`（统一 fetch 封装带 Bearer；fetch 默认 follow 重定向，302 到预签名 URL 后直接 `res.blob()` 拿到二进制）→ `URL.createObjectURL` 渲染，组件卸载时 `revokeObjectURL`。**取舍声明**：此方案失去 302 响应头的 `Cache-Control` 复用与视频流式 seek（Range 请求），图片/视频为整段加载——这是 Phase 6 的有意简化，Phase 8 公开分享页时再引入签名 query 参数（`?st=`）方案。`mediaUrl(id)` 方法保留（返回稳定入口 URL `${baseUrl}/api/media/${id}`，供未来使用），但 Web 组件不再直接用于 `<img>/<video>` src（CONVENTIONS §3.4 禁止内嵌预签名 URL 的约束不变）。web 经 Vite dev proxy `/api → localhost:3000`，生产同源部署。**S3 桶 CORS 前置条件（整条媒体链路的硬依赖）**：`GET /api/media/:id` 的 302 `Location` 是跨域 S3 绝对 URL（Vite proxy `/api` 不覆盖该域），fetch follow 后的跨域响应若桶未配 CORS，`res.blob()` 直接抛 TypeError（被 `useMediaObjectUrl` 的 `.catch(() => undefined)` 静默 → feed/链时间线/详情页媒体全部空白占位）；`xhrPut` 直传预签名 PUT URL 同理需桶 CORS 允许 PUT，且 multipart 的 etag 取自 PUT 响应头 `ETag`，需 `Access-Control-Expose-Headers: ETag`（缺配置 → `ETAG_MISSING`，见 Task 3）。桶 CORS 必须配置：`AllowedMethods: GET, PUT`、`AllowedOrigins: web origin`（dev 为 `http://localhost:5173`）、`AllowedHeaders: Content-Type`、`ExposeHeaders: ETag`。**备注：Phase 8 加固时复核该配置**（本计划不改 Phase 8 计划文件）。
- 媒体大小/时长/分片常量唯一来源是 `@moment/dto`（`MAX_IMAGE_BYTES` 等），web 与 api-client 引用之，禁止复制数字（Phase 3 Global Constraints 原文）。
- 上传进度：`uploadMedia({..., onProgress?: (loaded, total) => void})`；图片 PUT 直传整体进度、视频按已完成的 part 字节 + 当前 part 内进度累加。默认 `putWithProgress` 用 XHR（浏览器），**不用 fetch**——fetch 无上传进度（spec §2 原文「注意不挡死上传进度回调」）。
- 状态：服务端状态全部 TanStack Query（query key 常量集中在 `src/api/keys.ts`）；本地 auth 状态仅一个 context（user + login/logout 动作），不引入 redux/zustand。
- 表单校验一律复用 `@moment/dto` 的 zod schema（`registerInputSchema`/`loginInputSchema`/`createChainInputSchema`/`createMomentInputSchema` 等），在提交前 `safeParse`，错误信息按 issue path 展示。
- web 验证 = `typecheck`（tsc --noEmit）+ `build`（vite build）+ `lint`（eslint）三绿 + 手动验收清单（本计划 DoD）；**不做组件测试**（CONVENTIONS §4）。api-client 用 `tsx --test` 单测（mock fetch / 注入 fake putWithProgress），网络层不触真实后端。
- web 端 token 存储：localStorage（key `moment.auth.tokens` / `moment.auth.user`），实现 `TokenStore` 接口；XSS 面与 httpOnly cookie 的取舍已在 Phase 1 声明（JSON body 传输为既定决策），不重开。
- 环境变量：web 仅 `VITE_API_BASE_URL`（默认 `''` 同源，dev 走 Vite proxy）；无新 server 环境变量。
- commit 约定：`feat(api-client): ...` / `feat(web): ...`，每 Task 一个。

## Phase 5 依赖契约（comments / reactions / notifications / devices）

Phase 5 计划（互动与异步）在 `@moment/dto` 新增以下符号，本计划按此消费；**执行时若 Phase 2–5 实际命名有出入（含 Phase 3 `PatchMomentInput` / Phase 4 `UpdateMomentInput` 这类同物异名），以落地代码为准在 api-client 内做等价映射（映射层写在 client.ts 顶部并注释），禁止反向要求改 server**：

```ts
// packages/dto/src/comments.ts（Phase 5）
export const createCommentInputSchema; // { content: string(1..1000) }
export const REACTION_EMOJIS; // 10 个 emoji 白名单（Phase 5 约束的唯一常量来源，Web 端 reaction 行渲染全量，禁止本地硬编码子集）
export interface CommentDto {
  id: string; momentId: string; author: AuthorSummary; content: string; createdAt: string; // ISO
}
export interface CommentListResponse { comments: CommentDto[]; nextCursor: string | null }
// packages/dto/src/moments.ts（Phase 5 在 MomentResponse 上扩展，经 momentSerializer 批量计数）
export interface ReactionSummary { emoji: string; count: number } // 注意：无 mine 字段
export interface MomentResponse { /* ...既有字段... */ commentCount: number; reactions: ReactionSummary[]; myReaction: string | null }
// packages/dto/src/notifications.ts（Phase 5；dto 无 devices.ts——push 相关 schema 也在此文件）
export interface NotificationDto {
  id: string; type: string; payload: Record<string, unknown>; readAt: string | null; createdAt: string;
}
export interface NotificationListResponse { notifications: NotificationDto[]; nextCursor: string | null }
export const registerPushTokenSchema; // RegisterPushTokenInput = { expoToken: string(16..128); platform: 'ios'|'android'|'web' }
export const markNotificationsReadSchema; // MarkNotificationsReadInput = { ids: uuid[]（1..100，空数组被拒） }
```

HTTP 语义（Phase 5 路由，本计划消费）：
- `GET /api/moments/:id/comments?cursor=&limit=`（升序游标分页，limit 默认 20、1–50）→ `CommentListResponse = { comments: CommentDto[]; nextCursor: string | null }`
- `POST /api/moments/:id/comments` body `{content}` → `CommentDto`（201）
- `DELETE /api/comments/:id` → 204
- `PUT /api/moments/:id/reaction` body `{emoji}` → **204 空 body**（`ReactionService.set: Promise<void>`）
- `DELETE /api/moments/:id/reaction` → **204 空 body**（`Promise<void>`）
- `GET /api/notifications?unread=true|false&cursor=&limit=`（降序游标分页）→ `NotificationListResponse = { notifications: NotificationDto[]; nextCursor: string | null }`
- `POST /api/notifications/read` body `{ids: uuid[]}`（**必填 1–100 个，空数组 400，无「空 = 全部已读」语义**）→ 204
- `POST /api/devices/push-token` body `registerPushTokenSchema`（`{expoToken, platform}`）→ 204（web 不调，typed method 覆盖即可）

由此带来的客户端约定（Task 2/4/9/10 均按此实现）：reaction 成功后**不读响应体**，由调用方 `invalidateQueries(qk.moment/momentId)`（连带 feed/链时间线）重新 GET；「我的表情」高亮判断用 `moment.myReaction === emoji`；通知/评论列表服务端**默认每页 20 条、上限 50**——「首轮即全量」不成立，页面消费一律 `limit: 50` + `useInfiniteQuery`（或「加载更多」按钮）消费 `nextCursor`（`resp.notifications` / `resp.comments`）；「全部已读」需**循环翻页**（`limit=50` 逐页取 `nextCursor`）收集全部未读 id 再**分批（≤100）**提交（只读第一页会漏掉第 21 条起的通知，badge 清不零）；AppShell 未读 badge 只取第一页（`limit: 50`）计数即可（badge 上限 50 可接受），但「全部已读」必须能翻页收集全部未读。

另外两个 Phase 3/4 既有响应形状确认（本计划按此消费）：
- `GET /api/chains/:chainId/moments` → `{ moments: MomentResponse[]; nextCursor: string | null }`（Phase 4 Task 7 已把 service 返回值对齐为 `moments` 键，但 **dto 的 `MomentListResponse` 接口仍是 Phase 3 的 `items` 键且 Phase 4 未修正**——因此 client.ts 的 `listChainMoments` 一律以 `Pick<FeedResponse, 'moments' | 'nextCursor'>` 为返回类型，**不 import `MomentListResponse`**；文末 DoD 备注了回头给 Phase 4 补 dto 接口修正的建议）
- `GET /api/feed` → `FeedResponse = { moments; nextCursor }`；查询参数 snake_case：`cursor/chain_ids/tag_id/order/limit`

---

## 分组 A：packages/api-client

### Task 1: @moment/api-client 包骨架 + fetch 封装（token 附带 / ApiError / 401 单飞 refresh + 重放，TDD）

**Files:**
- Create: `packages/api-client/package.json`、`packages/api-client/tsconfig.json`、`packages/api-client/tsconfig.test.json`、`packages/api-client/eslint.config.js`
- Create: `packages/api-client/src/types.ts`、`packages/api-client/src/http.ts`、`packages/api-client/src/index.ts`
- Test: `packages/api-client/src/http.test.ts`

**Interfaces:**
- Consumes: `@moment/dto` 的 `AuthTokens/AuthResponse`（Phase 1）。
- Produces（Task 2/3 与 Phase 7 依赖，不得改名）:
  - `TokenStore`（见 Global Constraints）
  - `class ApiError extends Error { status: number; code: string; details?: unknown }`
  - `PutFn = (url: string, body: Blob, contentType: string, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal) => Promise<{ etag: string | null }>`
  - `MomentClientOptions = { baseUrl: string; tokenStore: TokenStore; fetchImpl?: typeof fetch; putWithProgress?: PutFn }`
  - `class Http`（内部）：`request<T>(path: string, options?: RequestOptions): Promise<T>`，`RequestOptions = { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; skipAuth?: boolean; skipAuthRefresh?: boolean }`

- [ ] **Step 1: 包骨架**

`packages/api-client/package.json`：
```json
{
  "name": "@moment/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsx --test src/*.test.ts",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit -p tsconfig.test.json",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@moment/dto": "workspace:*",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@moment/eslint-config": "workspace:*",
    "@moment/typescript-config": "workspace:*",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

`packages/api-client/tsconfig.json`：
```json
{
  "extends": "@moment/typescript-config/base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/api-client/tsconfig.test.json`（tsconfig.json 把 `src/**/*.test.ts` exclude 出 build；测试代码不进产物但**必须进 typecheck**，否则 `pnpm typecheck` 测不到测试文件的类型错误）：
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "exclude": []
}
```

`packages/api-client/eslint.config.js`：
```js
export { default } from '@moment/eslint-config';
```

- [ ] **Step 2: 写失败测试**

`packages/api-client/src/http.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthTokens } from '@moment/dto';
import { ApiError, Http, type TokenStore } from './http.js';

function memoryStore(tokens?: AuthTokens): TokenStore & { tokens: AuthTokens | null; cleared: boolean } {
  const store = {
    tokens: tokens ?? null,
    cleared: false,
    getAccessToken() {
      return store.tokens?.accessToken ?? null;
    },
    getRefreshToken() {
      return store.tokens?.refreshToken ?? null;
    },
    setTokens(t: AuthTokens) {
      store.tokens = t;
    },
    clear() {
      store.tokens = null;
      store.cleared = true;
    },
  };
  return store;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('自动附带 Bearer token；成功解析 JSON', async () => {
  const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
  const calls: { url: string; init: RequestInit }[] = [];
  const http = new Http({
    baseUrl: 'http://x',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, { ok: 1 });
    },
  });
  const data = await http.request<{ ok: number }>('/api/ping');
  assert.equal(data.ok, 1);
  assert.equal(calls[0]!.url, 'http://x/api/ping');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer a1');
});

test('query 参数拼接（跳过 undefined）；无 token 时不带 Authorization', async () => {
  const store = memoryStore();
  let url = '';
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (u) => {
      url = String(u);
      return jsonResponse(200, {});
    },
  });
  await http.request('/api/feed', { query: { cursor: undefined, limit: 7, order: 'created_at' } });
  assert.equal(url, '/api/feed?limit=7&order=created_at');
});

test('401 → refresh 一次 → 用新 token 重放原请求成功', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  const apiCalls: string[] = [];
  const refreshCalls: string[] = [];
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (u === '/api/auth/refresh') {
        refreshCalls.push(auth);
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      apiCalls.push(`${u} ${auth}`);
      if (auth === 'Bearer expired') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(200, { value: 42 });
    },
  });
  const data = await http.request<{ value: number }>('/api/feed');
  assert.equal(data.value, 42);
  assert.deepEqual(refreshCalls, ['']); // refresh 本身不带 Authorization
  assert.deepEqual(apiCalls, ['/api/feed Bearer expired', '/api/feed Bearer new']);
  assert.equal(store.tokens?.refreshToken, 'r2'); // setTokens 已写入
});

test('并发两个 401 请求只触发一次 refresh（单飞）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  let refreshCount = 0;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (u === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      if (auth !== 'Bearer new') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(200, { ok: true });
    },
  });
  await Promise.all([http.request('/api/chains'), http.request('/api/feed')]);
  assert.equal(refreshCount, 1);
});

test('refresh 失败 → clear() 并抛 ApiError（含服务端 code/status）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'dead', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return jsonResponse(401, { error: { code: 'REFRESH_TOKEN_REUSED', message: '复用' } });
      }
      return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'REFRESH_TOKEN_REUSED');
      assert.equal(err.status, 401);
      assert.equal(err.message, '复用');
      return true;
    }
  );
  assert.equal(store.cleared, true);
  assert.equal(store.tokens, null);
});

test('无 refreshToken 时 401 直接抛（clear 不误删未登录态以外的状态）', async () => {
  const store = memoryStore(); // 无 token
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } }),
  });
  await assert.rejects(() => http.request('/api/feed'), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_TOKEN');
});

test('skipAuthRefresh 的请求 401 不走 refresh，直接抛 ApiError', async () => {
  const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
  let refreshCount = 0;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(200, {});
      }
      return jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: '凭据错误' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/auth/login', { method: 'POST', skipAuthRefresh: true }),
    (e: unknown) => e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
  );
  assert.equal(refreshCount, 0);
});

test('业务错误透传 code/message/status/details；204 返回 undefined', async () => {
  const store = memoryStore();
  let status = 403;
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => {
      if (status === 403) {
        status = 204;
        return jsonResponse(403, {
          error: { code: 'CHAIN_ROLE_INSUFFICIENT', message: '角色不足', details: { role: 'viewer' } },
        });
      }
      return new Response(null, { status: 204 });
    },
  });
  await assert.rejects(
    () => http.request('/api/chains/c1', { method: 'PATCH' }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, 'CHAIN_ROLE_INSUFFICIENT');
      assert.equal(e.status, 403);
      assert.deepEqual(e.details, { role: 'viewer' });
      return true;
    }
  );
  const none = await http.request<void>('/api/chains/c1', { method: 'DELETE' });
  assert.equal(none, undefined);
});

test('网络失败/非 JSON 错误体 → NETWORK_ERROR / 降级 message', async () => {
  const store = memoryStore();
  const failing = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    () => failing.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'NETWORK_ERROR' && e.status === 0
  );

  const html = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async () =>
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  });
  await assert.rejects(
    () => html.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'HTTP_502' && e.status === 502
  );
});

test('重放后仍 401 → clear + 抛 ApiError（只重放一次）', async () => {
  const store = memoryStore({ accessToken: 'bad', refreshToken: 'r', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'still-bad', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'INVALID_TOKEN'
  );
  assert.equal(store.cleared, true);
});

test('refresh 成功后重放收到 403 → 不 clear，直接抛 ApiError（非 401 ≠ 登录态失效）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  const http = new Http({
    baseUrl: '',
    tokenStore: store,
    fetchImpl: async (url, init) => {
      const u = String(url);
      if (u === '/api/auth/refresh') {
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (auth === 'Bearer expired') return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      return jsonResponse(403, { error: { code: 'CHAIN_ROLE_INSUFFICIENT', message: '角色不足' } });
    },
  });
  await assert.rejects(
    () => http.request('/api/feed'),
    (e: unknown) => e instanceof ApiError && e.code === 'CHAIN_ROLE_INSUFFICIENT'
  );
  assert.equal(store.cleared, false); // 业务 403 不误清登录态
  assert.equal(store.tokens?.accessToken, 'new'); // refresh 写入的新 token 仍在
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm install && pnpm --filter @moment/api-client test`
Expected: FAIL（`Cannot find module './http.js'`）

- [ ] **Step 4: 实现**

`packages/api-client/src/types.ts`：
```ts
import type { AuthTokens } from '@moment/dto';

/** token 持久化接口：web 用 localStorage 实现、app 用 expo-secure-store 实现（各自在自己的 app 包里提供）。 */
export interface TokenStore {
  getAccessToken(): Promise<string | null> | string | null;
  getRefreshToken(): Promise<string | null> | string | null;
  setTokens(tokens: AuthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** 服务端统一错误体 {error:{code,message,details?}} 的客户端形态。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** RN 等无法把整文件读入内存的环境：不传 Blob，改传文件 uri + 字节区间，由注入的 put 实现按片读盘。
 *  （Phase 7 评审引入的最小契约扩展：500MB 视频整读入内存真机 OOM。带 size 使其与 Blob 在
 *  `body.size` 上结构同型，既有 fake/默认实现无需分支。） */
export interface FilePart {
  fileUri: string;
  start: number;
  end: number;
  size: number;
  mime: string;
}

/** 直传 PUT（带上传进度）。默认实现是浏览器 XHR（只接受 Blob）；node 测试注入 fake；RN 注入自定义实现（可按 FilePart 读盘）。 */
export type PutFn = (
  url: string,
  body: Blob | FilePart,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
) => Promise<{ etag: string | null }>;

export interface MomentClientOptions {
  /** API 根地址，如 ''（同源）或 'https://api.example.com' */
  baseUrl: string;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  putWithProgress?: PutFn;
}
```

`packages/api-client/src/http.ts`：
```ts
import type { AuthResponse, AuthTokens } from '@moment/dto';
import { ApiError, type MomentClientOptions, type TokenStore } from './types.js';

export { ApiError };
export type { MomentClientOptions, PutFn, TokenStore };

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 拼到 URL 上的查询参数（undefined 跳过；值会被 String() 化） */
  query?: Record<string, string | number | undefined>;
  /** true = 不附带 Authorization（refresh/login 等） */
  skipAuth?: boolean;
  /** true = 收到 401 也不触发 refresh（auth 端点自身，防循环） */
  skipAuthRefresh?: boolean;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = `请求失败（${res.status}）`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.details !== undefined) details = body.error.details;
  } catch {
    // 非 JSON 错误体：保留 HTTP_xxx 降级码
  }
  return new ApiError(message, res.status, code, details);
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** 低层 HTTP 封装：Bearer 附带、401 单飞 refresh + 重放一次、ApiError 透传。 */
export class Http {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private refreshPromise: Promise<string> | null = null;

  constructor(options: MomentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const first = await this.doFetch(path, options);
    if (first.status === 401 && !options.skipAuth && !options.skipAuthRefresh) {
      // 只有「本次可能附带过 token」的请求才值得 refresh：store 里连 refreshToken 都没有
      // （即本来就没登录）时直接透传 401，不 refresh、不 clear——避免误清未登录态以外的状态。
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (!refreshToken) throw await toApiError(first);
      const accessToken = await this.refresh(); // 单飞；失败抛 ApiError 并已 clear
      const second = await this.doFetch(path, options, accessToken);
      if (!second.ok) {
        // 只有重放仍 401 才意味着登录态真失效；403/404/410 等业务错误直接透传，不误清 token（不强制登出）。
        if (second.status === 401) await this.tokenStore.clear().catch(() => undefined);
        throw await toApiError(second);
      }
      return parseBody<T>(second);
    }
    if (!first.ok) throw await toApiError(first);
    return parseBody<T>(first);
  }

  /** 拉取二进制（如 GET /api/media/:id：302 → 预签名对象，fetch 默认 follow 重定向，res.blob() 直接拿内容）。
   *  与 request 同一套 Bearer 附带 + 401 单飞 refresh + 重放一次语义，仅响应处理换成 blob()。 */
  async requestBlob(path: string): Promise<Blob> {
    const first = await this.doFetch(path, {});
    if (first.status === 401) {
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (!refreshToken) throw await toApiError(first);
      const accessToken = await this.refresh();
      const second = await this.doFetch(path, {}, accessToken);
      if (!second.ok) {
        if (second.status === 401) await this.tokenStore.clear().catch(() => undefined);
        throw await toApiError(second);
      }
      return second.blob();
    }
    if (!first.ok) throw await toApiError(first);
    return first.blob();
  }

  private async doFetch(path: string, options: RequestOptions, tokenOverride?: string): Promise<Response> {
    let token = tokenOverride;
    if (token === undefined && !options.skipAuth) {
      token = (await this.tokenStore.getAccessToken()) ?? undefined;
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const url = buildUrl(this.baseUrl, path, options.query);
    try {
      return await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err instanceof Error ? err.message : '网络错误', 0, 'NETWORK_ERROR');
    }
  }

  /** 单飞 refresh：并发调用共享同一 promise；成功返回新 accessToken，失败 clear 并抛 ApiError。 */
  private refresh(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = await this.tokenStore.getRefreshToken();
    if (!refreshToken) {
      await this.tokenStore.clear().catch(() => undefined);
      throw new ApiError('登录已过期', 401, 'NO_REFRESH_TOKEN');
    }
    const res = await this.doFetch('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      skipAuth: true,
      skipAuthRefresh: true,
    });
    if (!res.ok) {
      await this.tokenStore.clear().catch(() => undefined);
      throw await toApiError(res);
    }
    const data = (await res.json()) as AuthResponse;
    await this.tokenStore.setTokens(data.tokens);
    return data.tokens.accessToken;
  }
}

export type { AuthTokens };
```

`packages/api-client/src/index.ts`：
```ts
export * from './types.js';
export { Http, type RequestOptions } from './http.js';
```

- [ ] **Step 5: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build`
Expected: http 11 个测试 PASS；`dist/index.js` 与 `dist/index.d.ts` 生成。

- [ ] **Step 6: Commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): 包骨架与 fetch 封装（Bearer/401 单飞 refresh/ApiError 透传）"
```

---

### Task 2: typed methods 覆盖 Phase 1–5 全部端点（TDD）

**Files:**
- Create: `packages/api-client/src/client.ts`、`packages/api-client/src/zod-input.ts`
- Modify: `packages/api-client/src/index.ts`（re-export client）
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Http/RequestOptions/ApiError`、`@moment/dto` 全部类型（Phase 1–4 + Phase 5 契约段）。
- Produces（Task 3、Task 4+ 与 Phase 7 依赖，方法名不得改）:

```ts
export interface MomentClient {
  // auth
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<UserProfile>;
  // chains & members & invites
  listChains(): Promise<ChainDto[]>;
  getChain(chainId: string): Promise<ChainDto>;
  createChain(input: CreateChainInput): Promise<ChainDto>;
  updateChain(chainId: string, input: UpdateChainInput): Promise<ChainDto>;
  deleteChain(chainId: string): Promise<void>;
  listMembers(chainId: string): Promise<ChainMemberDto[]>;
  updateMemberRole(chainId: string, userId: string, role: InviteRole): Promise<ChainMemberDto>;
  removeMember(chainId: string, userId: string): Promise<void>;
  transferChain(chainId: string, userId: string): Promise<ChainDto>;
  createInvite(chainId: string, input: CreateInviteInput): Promise<InviteDto>;
  listInvites(chainId: string): Promise<InviteDto[]>;
  revokeInvite(inviteId: string): Promise<void>;
  acceptInvite(token: string): Promise<AcceptInviteResponse>;
  // moments & feed
  createMoment(chainId: string, input: CreateMomentInput): Promise<MomentResponse>;
  /** Phase 5 后 service 返回 {moments, nextCursor}，但 dto 的 MomentListResponse 仍是 Phase 3 的 items 键——统一用 Pick<FeedResponse>（见依赖契约段） */
  listChainMoments(chainId: string, query?: { cursor?: string; limit?: number }): Promise<Pick<FeedResponse, 'moments' | 'nextCursor'>>;
  getMoment(momentId: string): Promise<MomentResponse>;
  updateMoment(momentId: string, input: PatchMomentInput): Promise<MomentResponse>;
  deleteMoment(momentId: string): Promise<void>;
  getFeed(query?: FeedQuery): Promise<FeedResponse>;
  // tags
  listTags(chainId: string): Promise<TagListResponse>;
  createTag(chainId: string, name: string): Promise<TagResponse>;
  deleteTag(tagId: string): Promise<void>;
  // media（上传 helper 属 Task 3）
  presignMedia(input: MediaPresignInput): Promise<MediaPresignResponse>;
  presignMediaParts(mediaId: string, partNumbers: number[]): Promise<MediaPartsResponse>;
  completeMedia(mediaId: string, parts: { partNumber: number; etag: string }[]): Promise<MediaCompleteResponse>;
  abortMedia(mediaId: string): Promise<void>;
  /** 稳定入口相对/绝对 URL（CONVENTIONS §3.4，不内嵌预签名）。仅供未来使用，Web 组件不得直接用作 `<img>/<video>` src（401，见 Global Constraints 媒体条目） */
  mediaUrl(mediaId: string): string;
  /** 经统一 fetch 封装（Bearer + 401 refresh 重放）拉取媒体二进制；fetch 默认 follow 302 到预签名对象。Web 端 `<img>/<video>` 渲染的唯一来源（配合 URL.createObjectURL） */
  fetchMediaBlob(mediaId: string): Promise<Blob>;
  // comments & reactions
  listComments(momentId: string, query?: { cursor?: string; limit?: number }): Promise<CommentListResponse>;
  createComment(momentId: string, content: string): Promise<CommentDto>;
  deleteComment(commentId: string): Promise<void>;
  /** Phase 5：PUT/DELETE 均 204 空 body——调用方成功后 invalidate moment/feed 重新 GET */
  setReaction(momentId: string, emoji: string): Promise<void>;
  removeReaction(momentId: string): Promise<void>;
  // notifications & devices
  /** 分页参数：页面消费一律 limit: 50（服务端默认每页仅 20，见依赖契约段）；cursor 供「全部已读」循环翻页收集全部未读 */
  listNotifications(unread?: boolean, query?: { cursor?: string; limit?: number }): Promise<NotificationListResponse>;
  /** Phase 5 schema：ids 必填 1–100 个 uuid（无「空=全部」语义，分批由调用方负责） */
  markNotificationsRead(ids: string[]): Promise<void>;
  registerPushToken(input: RegisterPushTokenInput): Promise<void>;
}
export function createMomentClient(options: MomentClientOptions): MomentClient;
export interface FeedQuery { cursor?: string; chainIds?: string[]; tagId?: string; order?: 'happened_at' | 'created_at'; limit?: number }
```

（`uploadMedia` 属 Task 3，届时追加到本 interface 与返回对象上；本 Task 交付的 `MomentClient` 不含它。）

（`CreateMomentInput` = dto 的 `z.input` 形态——客户端构造时 `isBackfill/mediaIds/tagIds` 可省略，故 client.ts 里定义 `type CreateMomentInput = z.input<typeof createMomentInputSchema>` 之外还需把 happenedAt 等必填字段带上；直接 `import { createMomentInputSchema } from '@moment/dto'` 用 `z.input<>` 推导即可，zod 已是 api-client 依赖。）

- [ ] **Step 1: 写失败测试**

`packages/api-client/src/client.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentClient } from './client.js';

/** 记录全部 fetch 调用并按需应答的 harness。 */
function harness() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const client = createMomentClient({
    baseUrl: 'http://x',
    tokenStore: {
      getAccessToken: () => null,
      getRefreshToken: () => null,
      setTokens: () => {},
      clear: () => {},
    },
    fetchImpl: async (url, init) => {
      const call = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      // harness 只断言请求形状，应答统一 200 JSON（204 语义已在 http.test 覆盖）
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, calls };
}

test('auth：register/login 走 skipAuthRefresh；logout 传 refreshToken', async () => {
  const { client, calls } = harness();
  await client.register({ email: 'a@b.c', password: 'secret123', nickname: 'a' });
  await client.login({ email: 'a@b.c', password: 'secret123' });
  await client.logout('r1');
  await client.me();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/auth/register',
    'POST http://x/api/auth/login',
    'POST http://x/api/auth/logout',
    'GET http://x/api/auth/me',
  ]);
  assert.deepEqual(calls[0]!.body, { email: 'a@b.c', password: 'secret123', nickname: 'a' });
  assert.deepEqual(calls[2]!.body, { refreshToken: 'r1' });
});

test('chains/members/invites 路径与方法名对齐 Phase 2 路由', async () => {
  const { client, calls } = harness();
  await client.listChains();
  await client.getChain('c1');
  await client.createChain({ name: '链', visibility: 'private' });
  await client.updateChain('c1', { name: '新' });
  await client.deleteChain('c1');
  await client.listMembers('c1');
  await client.updateMemberRole('c1', 'u2', 'viewer');
  await client.removeMember('c1', 'u2');
  await client.transferChain('c1', 'u2');
  await client.createInvite('c1', { role: 'viewer' });
  await client.listInvites('c1');
  await client.revokeInvite('i1');
  await client.acceptInvite('tok');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/chains',
    'GET http://x/api/chains/c1',
    'POST http://x/api/chains',
    'PATCH http://x/api/chains/c1',
    'DELETE http://x/api/chains/c1',
    'GET http://x/api/chains/c1/members',
    'PATCH http://x/api/chains/c1/members/u2',
    'DELETE http://x/api/chains/c1/members/u2',
    'POST http://x/api/chains/c1/transfer',
    'POST http://x/api/chains/c1/invites',
    'GET http://x/api/chains/c1/invites',
    'DELETE http://x/api/invites/i1',
    'POST http://x/api/invites/tok/accept',
  ]);
  assert.deepEqual(calls[6]!.body, { role: 'viewer' });
  assert.deepEqual(calls[8]!.body, { userId: 'u2' });
});

test('moments/feed/tags 路径与查询参数', async () => {
  const { client, calls } = harness();
  await client.createMoment('c1', {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
  });
  await client.listChainMoments('c1', { cursor: 'cur', limit: 7 });
  await client.getMoment('m1');
  await client.updateMoment('m1', { content: 'new' });
  await client.deleteMoment('m1');
  await client.getFeed({ chainIds: ['c1', 'c2'], tagId: 't1', order: 'created_at', limit: 10, cursor: 'cur' });
  await client.listTags('c1');
  await client.createTag('c1', '周岁');
  await client.deleteTag('t1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/chains/c1/moments',
    'GET http://x/api/chains/c1/moments?cursor=cur&limit=7',
    'GET http://x/api/moments/m1',
    'PATCH http://x/api/moments/m1',
    'DELETE http://x/api/moments/m1',
    'GET http://x/api/feed?cursor=cur&chain_ids=c1%2Cc2&tag_id=t1&order=created_at&limit=10',
    'GET http://x/api/chains/c1/tags',
    'POST http://x/api/chains/c1/tags',
    'DELETE http://x/api/tags/t1',
  ]);
  assert.deepEqual(calls[0]!.body, {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    mediaIds: [],
  });
  assert.deepEqual(calls[7]!.body, { name: '周岁' });
});

test('media/comments/reactions/notifications/devices 路径', async () => {
  const { client, calls } = harness();
  await client.presignMedia({ mime: 'image/jpeg', size: 1024, kind: 'image', sortOrder: 0 });
  await client.presignMediaParts('md1', [1, 2]);
  await client.completeMedia('md1', [{ partNumber: 1, etag: '"a"' }]);
  await client.abortMedia('md1');
  assert.equal(client.mediaUrl('md1'), 'http://x/api/media/md1');
  await client.listComments('m1');
  await client.createComment('m1', '好看');
  await client.deleteComment('cm1');
  await client.setReaction('m1', '❤️');
  await client.removeReaction('m1');
  await client.listNotifications(true);
  await client.markNotificationsRead(['n1']);
  await client.registerPushToken({ expoToken: 'ExponentPushToken[x]', platform: 'ios' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST http://x/api/media/presign',
    'POST http://x/api/media/md1/parts',
    'POST http://x/api/media/md1/complete',
    'POST http://x/api/media/md1/abort',
    'GET http://x/api/moments/m1/comments',
    'POST http://x/api/moments/m1/comments',
    'DELETE http://x/api/comments/cm1',
    'PUT http://x/api/moments/m1/reaction',
    'DELETE http://x/api/moments/m1/reaction',
    'GET http://x/api/notifications?unread=true',
    'POST http://x/api/notifications/read',
    'POST http://x/api/devices/push-token',
  ]);
  assert.deepEqual(calls[1]!.body, { partNumbers: [1, 2] });
  assert.deepEqual(calls[2]!.body, { parts: [{ partNumber: 1, etag: '"a"' }] });
  assert.deepEqual(calls[5]!.body, { content: '好看' });
  assert.deepEqual(calls[7]!.body, { emoji: '❤️' });
  assert.deepEqual(calls[10]!.body, { ids: ['n1'] });
  assert.deepEqual(calls[11]!.body, { expoToken: 'ExponentPushToken[x]', platform: 'ios' });
});

test('getFeed 空查询不带 query string', async () => {
  const { client, calls } = harness();
  await client.getFeed();
  assert.equal(calls[0]!.url, 'http://x/api/feed');
});

test('fetchMediaBlob 走稳定入口；listNotifications 带 cursor/limit 分页参数', async () => {
  const { client, calls } = harness();
  await client.fetchMediaBlob('md1');
  await client.listNotifications(true, { cursor: 'cur', limit: 50 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/media/md1',
    'GET http://x/api/notifications?unread=true&cursor=cur&limit=50',
  ]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL（`Cannot find module './client.js'`）

- [ ] **Step 3: 实现**

`packages/api-client/src/client.ts`：
```ts
import type {
  AcceptInviteResponse,
  AuthResponse,
  ChainDto,
  ChainMemberDto,
  CommentDto,
  CommentListResponse,
  CreateChainInput,
  CreateInviteInput,
  FeedResponse,
  InviteDto,
  InviteRole,
  LoginInput,
  MediaCompleteResponse,
  MediaPartsResponse,
  MediaPresignInput,
  MediaPresignResponse,
  MomentResponse,
  NotificationListResponse,
  PatchMomentInput, // 等价映射（依赖契约段免责条款）：Phase 3 计划名 PatchMomentInput / Phase 4 计划名 UpdateMomentInput——若 dto 实际导出为 UpdateMomentInput，改为 `UpdateMomentInput as PatchMomentInput`，禁止反向改 dto
  RegisterInput,
  RegisterPushTokenInput,
  TagListResponse,
  TagResponse,
  UpdateChainInput,
  UserProfile,
} from '@moment/dto';
import { createMomentInputSchema } from '@moment/dto';
import type { ZodInput } from './zod-input.js';
import { Http } from './http.js';
import type { MomentClientOptions } from './types.js';

/** feed 查询（web 端 camelCase，序列化时转 snake_case 查询参数，Phase 4 dto 约定） */
export interface FeedQuery {
  cursor?: string;
  chainIds?: string[];
  tagId?: string;
  order?: 'happened_at' | 'created_at';
  limit?: number;
}

/** moment 创建入参：z.input 形态（isBackfill/mediaIds/tagIds 可省略，dto schema 补默认值） */
export type CreateMomentInput = ZodInput<typeof createMomentInputSchema>;

export interface MomentClient {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  logout(refreshToken: string): Promise<void>;
  me(): Promise<UserProfile>;

  listChains(): Promise<ChainDto[]>;
  getChain(chainId: string): Promise<ChainDto>;
  createChain(input: CreateChainInput): Promise<ChainDto>;
  updateChain(chainId: string, input: UpdateChainInput): Promise<ChainDto>;
  deleteChain(chainId: string): Promise<void>;
  listMembers(chainId: string): Promise<ChainMemberDto[]>;
  updateMemberRole(chainId: string, userId: string, role: InviteRole): Promise<ChainMemberDto>;
  removeMember(chainId: string, userId: string): Promise<void>;
  transferChain(chainId: string, userId: string): Promise<ChainDto>;
  createInvite(chainId: string, input: CreateInviteInput): Promise<InviteDto>;
  listInvites(chainId: string): Promise<InviteDto[]>;
  revokeInvite(inviteId: string): Promise<void>;
  acceptInvite(token: string): Promise<AcceptInviteResponse>;

  createMoment(chainId: string, input: CreateMomentInput): Promise<MomentResponse>;
  /** Phase 5 后 service 返回 {moments, nextCursor}，但 dto 的 MomentListResponse 仍是 Phase 3 的 items 键——统一用 Pick<FeedResponse>（见依赖契约段） */
  listChainMoments(chainId: string, query?: { cursor?: string; limit?: number }): Promise<Pick<FeedResponse, 'moments' | 'nextCursor'>>;
  getMoment(momentId: string): Promise<MomentResponse>;
  updateMoment(momentId: string, input: PatchMomentInput): Promise<MomentResponse>;
  deleteMoment(momentId: string): Promise<void>;
  getFeed(query?: FeedQuery): Promise<FeedResponse>;

  listTags(chainId: string): Promise<TagListResponse>;
  createTag(chainId: string, name: string): Promise<TagResponse>;
  deleteTag(tagId: string): Promise<void>;

  presignMedia(input: MediaPresignInput): Promise<MediaPresignResponse>;
  presignMediaParts(mediaId: string, partNumbers: number[]): Promise<MediaPartsResponse>;
  completeMedia(mediaId: string, parts: { partNumber: number; etag: string }[]): Promise<MediaCompleteResponse>;
  abortMedia(mediaId: string): Promise<void>;
  mediaUrl(mediaId: string): string;
  /** Web `<img>/<video>` 渲染的唯一来源：Blob → URL.createObjectURL（见 Global Constraints 媒体条目） */
  fetchMediaBlob(mediaId: string): Promise<Blob>;

  listComments(momentId: string, query?: { cursor?: string; limit?: number }): Promise<CommentListResponse>;
  createComment(momentId: string, content: string): Promise<CommentDto>;
  deleteComment(commentId: string): Promise<void>;
  /** Phase 5：PUT/DELETE 均 204 空 body——调用方成功后 invalidate moment/feed 重新 GET */
  setReaction(momentId: string, emoji: string): Promise<void>;
  removeReaction(momentId: string): Promise<void>;

  /** 分页参数：页面消费一律 limit: 50（服务端默认每页仅 20，见依赖契约段）；cursor 供「全部已读」循环翻页收集全部未读 */
  listNotifications(unread?: boolean, query?: { cursor?: string; limit?: number }): Promise<NotificationListResponse>;
  /** Phase 5 schema：ids 必填 1–100 个 uuid（无「空=全部」语义，分批由调用方负责） */
  markNotificationsRead(ids: string[]): Promise<void>;
  registerPushToken(input: RegisterPushTokenInput): Promise<void>;
}

export function createMomentClient(options: MomentClientOptions): MomentClient {
  const http = new Http(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  /** 入参先过 dto schema 补默认值（isBackfill:false、mediaIds:[]、tagIds 不传时 strip），保证请求体与测试断言一致 */
  const parseMomentInput = (input: CreateMomentInput): Record<string, unknown> =>
    createMomentInputSchema.parse(input) as unknown as Record<string, unknown>;

  return {
    register: (input) => http.request('/api/auth/register', { method: 'POST', body: input, skipAuthRefresh: true }),
    login: (input) => http.request('/api/auth/login', { method: 'POST', body: input, skipAuthRefresh: true }),
    logout: (refreshToken) =>
      http.request('/api/auth/logout', { method: 'POST', body: { refreshToken }, skipAuthRefresh: true }),
    me: () => http.request('/api/auth/me'),

    listChains: () => http.request('/api/chains'),
    getChain: (chainId) => http.request(`/api/chains/${chainId}`),
    createChain: (input) => http.request('/api/chains', { method: 'POST', body: input }),
    updateChain: (chainId, input) => http.request(`/api/chains/${chainId}`, { method: 'PATCH', body: input }),
    deleteChain: (chainId) => http.request(`/api/chains/${chainId}`, { method: 'DELETE' }),
    listMembers: (chainId) => http.request(`/api/chains/${chainId}/members`),
    updateMemberRole: (chainId, userId, role) =>
      http.request(`/api/chains/${chainId}/members/${userId}`, { method: 'PATCH', body: { role } }),
    removeMember: (chainId, userId) =>
      http.request(`/api/chains/${chainId}/members/${userId}`, { method: 'DELETE' }),
    transferChain: (chainId, userId) =>
      http.request(`/api/chains/${chainId}/transfer`, { method: 'POST', body: { userId } }),
    createInvite: (chainId, input) => http.request(`/api/chains/${chainId}/invites`, { method: 'POST', body: input }),
    listInvites: (chainId) => http.request(`/api/chains/${chainId}/invites`),
    revokeInvite: (inviteId) => http.request(`/api/invites/${inviteId}`, { method: 'DELETE' }),
    acceptInvite: (token) => http.request(`/api/invites/${token}/accept`, { method: 'POST' }),

    createMoment: (chainId, input) =>
      http.request(`/api/chains/${chainId}/moments`, { method: 'POST', body: parseMomentInput(input) }),
    listChainMoments: (chainId, query) =>
      http.request(`/api/chains/${chainId}/moments`, { query: { cursor: query?.cursor, limit: query?.limit } }),
    getMoment: (momentId) => http.request(`/api/moments/${momentId}`),
    updateMoment: (momentId, input) => http.request(`/api/moments/${momentId}`, { method: 'PATCH', body: input }),
    deleteMoment: (momentId) => http.request(`/api/moments/${momentId}`, { method: 'DELETE' }),
    getFeed: (query) =>
      http.request('/api/feed', {
        query: {
          cursor: query?.cursor,
          chain_ids: query?.chainIds?.join(','),
          tag_id: query?.tagId,
          order: query?.order,
          limit: query?.limit,
        },
      }),

    listTags: (chainId) => http.request(`/api/chains/${chainId}/tags`),
    createTag: (chainId, name) => http.request(`/api/chains/${chainId}/tags`, { method: 'POST', body: { name } }),
    deleteTag: (tagId) => http.request(`/api/tags/${tagId}`, { method: 'DELETE' }),

    presignMedia: (input) => http.request('/api/media/presign', { method: 'POST', body: input }),
    presignMediaParts: (mediaId, partNumbers) =>
      http.request(`/api/media/${mediaId}/parts`, { method: 'POST', body: { partNumbers } }),
    completeMedia: (mediaId, parts) =>
      http.request(`/api/media/${mediaId}/complete`, { method: 'POST', body: { parts } }),
    abortMedia: (mediaId) => http.request(`/api/media/${mediaId}/abort`, { method: 'POST' }),
    mediaUrl: (mediaId) => `${baseUrl}/api/media/${mediaId}`,
    fetchMediaBlob: (mediaId) => http.requestBlob(`/api/media/${mediaId}`),

    listComments: (momentId, query) =>
      http.request(`/api/moments/${momentId}/comments`, { query: { cursor: query?.cursor, limit: query?.limit } }),
    createComment: (momentId, content) =>
      http.request(`/api/moments/${momentId}/comments`, { method: 'POST', body: { content } }),
    deleteComment: (commentId) => http.request(`/api/comments/${commentId}`, { method: 'DELETE' }),
    setReaction: (momentId, emoji) =>
      http.request(`/api/moments/${momentId}/reaction`, { method: 'PUT', body: { emoji } }),
    removeReaction: (momentId) => http.request(`/api/moments/${momentId}/reaction`, { method: 'DELETE' }),

    listNotifications: (unread, query) =>
      http.request('/api/notifications', {
        query: {
          unread: unread === undefined ? undefined : unread ? 'true' : 'false',
          cursor: query?.cursor,
          limit: query?.limit,
        },
      }),
    markNotificationsRead: (ids) => http.request('/api/notifications/read', { method: 'POST', body: { ids } }),
    registerPushToken: (input) => http.request('/api/devices/push-token', { method: 'POST', body: input }),
  };
}
```

`packages/api-client/src/zod-input.ts`（`ZodInput` 帮助类型——`z.input` 但剥除 `undefined` 键的简便写法，避免每个调用点 `as`）：
```ts
import type { ZodType } from 'zod';

/** z.input<T> 的可选键保留 optional，但整体可赋值给 parse 入参的形态。 */
export type ZodInput<T extends ZodType> = T extends ZodType<infer _O, infer _D, infer I> ? I : never;
```

（Task 2 阶段 `uploadMedia` 尚不在 `MomentClient` interface 与返回对象中；Task 3 Step 3 的三处增量补上——两个 Task 之间仓库内不存在任何未实现的 `uploadMedia` 引用。）

`packages/api-client/src/index.ts`（整体替换）：
```ts
export * from './types.js';
export { Http, type RequestOptions } from './http.js';
export { createMomentClient, type FeedQuery, type CreateMomentInput, type MomentClient } from './client.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build`
Expected: http 11 个 + client 6 个测试 PASS；build 产物含 `dist/client.js`。

- [ ] **Step 5: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): typed methods 覆盖 Phase 1–5 全部端点"
```

---

### Task 3: 媒体上传 helper（PUT 直传 + multipart 分片串行每片重试 + onProgress，TDD）

**Files:**
- Create: `packages/api-client/src/upload.ts`、`packages/api-client/src/default-put.ts`
- Modify: `packages/api-client/src/client.ts`（interface 与返回对象追加 `uploadMedia`）
- Modify: `packages/api-client/src/index.ts`（导出 `UploadMediaInput/PutFn 默认实现`）
- Test: `packages/api-client/src/upload.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `createMomentClient` 各 media 方法、`@moment/dto` 的 `VIDEO_PART_SIZE/MAX_IMAGE_BYTES/MAX_VIDEO_BYTES/MediaPresignResponse`。
- Produces（Task 8 与 Phase 7 依赖，不得改名）:
  - `UploadMediaInput = { file?: Blob; fileUri?: string; mime: string; size: number; kind: 'image'|'video'; durationSeconds?: number; sortOrder?: number; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }`（`file`/`fileUri` 二选一；`fileUri` 形态下 `PutFn` 收到 `FilePart = { fileUri; start; end; size; mime }` 由注入的 put 按片读盘——Phase 7 评审引入的最小契约扩展，防 RN 端 500MB 视频整文件入内存 OOM；web 用法不变）。**Produces 保证**：`onProgress` 的 `loaded` 单调不减——分片重试时该 part 的进度重新从 0 计，实现层只上报历史最大值，UI 进度条不回退（upload.test 已断言）。
  - `client.uploadMedia(input: UploadMediaInput): Promise<MediaCompleteResponse>`：图片 = presign(put) → PUT 直传（整体进度）→ `completeMedia(id, [])`；视频 = presign(multipart) → 按 `VIDEO_PART_SIZE` 切片、**分批取 part URL、片间串行、每片失败重试 ≤3 次（同一预签名 URL，TTL 900s 足够）** → `completeMedia(id, parts)`（etag 来自 PUT 响应头）。
  - `xhrPut: PutFn`（浏览器默认实现，XHR `upload.onprogress`——fetch 无上传进度，spec §2 原文）。
  - 客户端预校验：`MAX_IMAGE_BYTES`/`MAX_VIDEO_BYTES` 超限直接抛 `ApiError('...', 413, 'MEDIA_TOO_LARGE')`，不发起 presign。

- [ ] **Step 1: 写失败测试**

`packages/api-client/src/upload.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_IMAGE_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import { ApiError, createMomentClient, type PutFn } from './index.js';

interface Recorded {
  method: string;
  url: string;
  body?: unknown;
}

function makeClient(opts: {
  presignBody: Record<string, unknown>;
  onPut?: (url: string, partIndex: number) => { etag: string | null };
}) {
  const calls: Recorded[] = [];
  const putUrls: string[] = [];
  let partSeq = 0;
  const putWithProgress: PutFn = async (url, blob, contentType, onProgress) => {
    putUrls.push(url);
    onProgress?.(0, blob.size);
    onProgress?.(blob.size, blob.size);
    return opts.onPut ? opts.onPut(url, ++partSeq) : { etag: `"etag-${url.slice(-1)}"` };
  };
  const client = createMomentClient({
    baseUrl: '',
    tokenStore: {
      getAccessToken: () => 'a',
      getRefreshToken: () => 'r',
      setTokens: () => {},
      clear: () => {},
    },
    putWithProgress,
    fetchImpl: async (url, init) => {
      const u = String(url);
      calls.push({
        method: init?.method ?? 'GET',
        url: u,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (u === '/api/media/presign') {
        return Response.json(opts.presignBody, { status: 201 });
      }
      if (u.endsWith('/parts')) {
        const { partNumbers } = calls[calls.length - 1]!.body as { partNumbers: number[] };
        return Response.json({
          mediaId: 'md1',
          partSize: VIDEO_PART_SIZE,
          urls: partNumbers.map((partNumber) => ({ partNumber, url: `https://s3/part/${partNumber}`, expiresIn: 900 })),
        });
      }
      if (u.endsWith('/complete')) {
        return Response.json({ mediaId: 'md1', status: 'ready', mime: 'video/mp4', size: 1 });
      }
      return Response.json({});
    },
  });
  return { client, calls, putUrls };
}

test('图片：presign(put) → 单次 PUT → complete(parts=[])；onProgress 走到 100%', async () => {
  const progress: [number, number][] = [];
  const { client, calls, putUrls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'https://s3/put', uploadId: null, partSize: null },
  });
  const blob = new Blob(['hello image']);
  const res = await client.uploadMedia({
    file: blob,
    mime: 'image/jpeg',
    size: blob.size,
    kind: 'image',
    sortOrder: 0,
    onProgress: (loaded, total) => progress.push([loaded, total]),
  });
  assert.equal(res.status, 'ready');
  assert.deepEqual(putUrls, ['https://s3/put']);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST /api/media/presign',
    'POST /api/media/md1/complete',
  ]);
  assert.deepEqual(calls[1]!.body, { parts: [] });
  assert.deepEqual(progress.at(-1), [blob.size, blob.size]);
});

test('图片超 MAX_IMAGE_BYTES → 本地直接 413 MEDIA_TOO_LARGE，不发起任何请求', async () => {
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'u', uploadId: null, partSize: null },
  });
  await assert.rejects(
    () =>
      client.uploadMedia({
        file: new Blob(['x']),
        mime: 'image/jpeg',
        size: MAX_IMAGE_BYTES + 1,
        kind: 'image',
      }),
    (e: unknown) => e instanceof ApiError && e.code === 'MEDIA_TOO_LARGE' && e.status === 413
  );
  assert.equal(calls.length, 0);
});

test('视频：分批取 part URL、片间串行 PUT、etag 汇总进 complete；进度单调不减', async () => {
  // partSize 来自服务端 presign 响应（= VIDEO_PART_SIZE）；造 2.5 part 的数据
  const total = Math.floor(VIDEO_PART_SIZE * 2.5);
  const presign = {
    mediaId: 'md1',
    method: 'multipart' as const,
    url: null,
    uploadId: 'up-1',
    partSize: VIDEO_PART_SIZE,
  };
  const putOrder: number[] = [];
  const { client, calls, putUrls } = makeClient({
    presignBody: presign,
    onPut: (url) => {
      const partNumber = Number(url.split('/').pop());
      putOrder.push(partNumber);
      return { etag: `"e${partNumber}"` };
    },
  });
  const blob = new Blob(['v'.repeat(8)]); // 内容无所谓，slice 只按大小
  const progress: number[] = [];
  await client.uploadMedia({
    file: blob,
    mime: 'video/mp4',
    size: total,
    kind: 'video',
    durationSeconds: 120,
    onProgress: (loaded) => progress.push(loaded),
  });
  const complete = calls.find((c) => c.url.endsWith('/complete'))!;
  assert.deepEqual(complete!.body, {
    parts: [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ],
  });
  // 串行：PUT 顺序严格 1,2,3；分批取 URL（3 片一批 BATCH=10 时只请求一次 parts）
  assert.deepEqual(putOrder, [1, 2, 3]);
  const partsCalls = calls.filter((c) => c.url.endsWith('/parts'));
  assert.equal(partsCalls.length, 1);
  assert.deepEqual((partsCalls[0]!.body as { partNumbers: number[] }).partNumbers, [1, 2, 3]);
  assert.deepEqual(putUrls, ['https://s3/part/1', 'https://s3/part/2', 'https://s3/part/3']);
  // 进度单调不减，最终到 total
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i]! >= progress[i - 1]!);
  assert.equal(progress.at(-1), total);
  // presign 携带 durationSeconds
  assert.equal((calls[0]!.body as { durationSeconds?: number }).durationSeconds, 120);
});

test('视频：part 2 第一次失败 → 同一 URL 重试成功（每片 ≤3 次），重试后仍继续后续 part', async () => {
  const total = VIDEO_PART_SIZE * 2;
  const attempts = new Map<string, number>();
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: (url) => {
      const key = url.split('/').pop()!;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (key === '2' && n === 1) throw new ApiError('网络抖动', 0, 'NETWORK_ERROR');
      return { etag: `"e${key}"` };
    },
  });
  await client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' });
  assert.equal(attempts.get('2'), 2); // 重试一次成功
  const complete = calls.find((c) => c.url.endsWith('/complete'))!;
  assert.deepEqual(complete!.body, {
    parts: [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
    ],
  });
});

test('视频：某 part 连续 3 次失败 → 抛 ApiError 且不调 complete', async () => {
  const total = VIDEO_PART_SIZE;
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: () => {
      throw new ApiError('始终失败', 0, 'NETWORK_ERROR');
    },
  });
  await assert.rejects(
    () => client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' }),
    (e: unknown) => e instanceof ApiError
  );
  assert.equal(calls.find((c) => c.url.endsWith('/complete')), undefined);
});

test('视频：PUT 成功但响应无 ETag → ETAG_MISSING 立即失败，不重试', async () => {
  const total = VIDEO_PART_SIZE;
  let putCalls = 0;
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: () => {
      putCalls += 1;
      return { etag: null }; // 桶 CORS 未 ExposeHeaders ETag 时的形态
    },
  });
  await assert.rejects(
    () => client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' }),
    (e: unknown) => e instanceof ApiError && e.code === 'ETAG_MISSING'
  );
  assert.equal(putCalls, 1); // 不作为可重试失败
  assert.equal(calls.find((c) => c.url.endsWith('/complete')), undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL（`client.uploadMedia is not a function`）

- [ ] **Step 3: 实现**

`packages/api-client/src/default-put.ts`：
```ts
import { ApiError, type PutFn } from './types.js';

/**
 * 浏览器默认直传实现：XHR（fetch 无上传进度——spec §2「注意不挡死上传进度回调」）。
 * node 环境没有 XMLHttpRequest，测试/SSR 必须注入 putWithProgress。
 */
export const xhrPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      // 进入时 signal 已 aborted：不加监听直接拒绝（abort 事件不会再触发）
      reject(new ApiError('已取消', 0, 'ABORTED'));
      return;
    }
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiError('当前环境无 XMLHttpRequest，请注入 putWithProgress', 0, 'PUT_UNAVAILABLE'));
      return;
    }
    if (!(body instanceof Blob)) {
      // FilePart（fileUri 形态）需注入自定义 put（如 Phase 7 RN 版 rnPut）按片读盘
      reject(new ApiError('fileUri 形态需注入自定义 putWithProgress', 0, 'PUT_UNAVAILABLE'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.total);
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new ApiError(`直传失败（${xhr.status}）`, xhr.status, 'UPLOAD_FAILED'));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError('网络错误', 0, 'NETWORK_ERROR'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError('已取消', 0, 'ABORTED'));
    };
    xhr.send(body);
  });
```

`packages/api-client/src/upload.ts`：
```ts
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import type { MediaCompleteResponse, MediaPresignResponse } from '@moment/dto';
import type { Http } from './http.js';
import { ApiError, type FilePart, type MomentClientOptions, type PutFn } from './types.js';
import { xhrPut } from './default-put.js';

export interface UploadMediaInput {
  /** 整文件内存形态（web / 已压缩图片）。与 fileUri 二选一（Phase 7 RN 视频走 fileUri，按片读盘防 OOM）。 */
  file?: Blob;
  /** 文件 uri 形态（RN）：提供时 put 收到 FilePart（fileUri + start/end 区间），不构造整文件 Blob。 */
  fileUri?: string;
  mime: string;
  size: number;
  kind: 'image' | 'video';
  /** 视频时长（秒，≤300），透传给 presign（Phase 3 契约） */
  durationSeconds?: number;
  sortOrder?: number;
  /** 已传字节 / 总字节。multipart 下 = 已完成 part 字节 + 当前 part 内进度 */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/** 每片重试上限（同一预签名 URL；PRESIGN_PUT_TTL=900s 内 3 次足够） */
const MAX_PART_ATTEMPTS = 3;
/** 每批向 /media/:id/parts 申请的 part URL 数（上限 200，取 10 平衡预签名开销与串行窗口） */
const PART_BATCH = 10;

export async function uploadMediaImpl(
  http: Http,
  options: MomentClientOptions,
  input: UploadMediaInput
): Promise<MediaCompleteResponse> {
  const limit = input.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (input.size > limit) {
    throw new ApiError(
      `文件超过上限（${Math.floor(limit / 1024 / 1024)}MB）`,
      413,
      'MEDIA_TOO_LARGE'
    );
  }
  if (!input.file && !input.fileUri) {
    throw new ApiError('file 与 fileUri 必须提供其一', 0, 'UPLOAD_INPUT_INVALID');
  }
  const put: PutFn = options.putWithProgress ?? xhrPut;

  const presigned = await http.request<MediaPresignResponse>('/api/media/presign', {
    method: 'POST',
    body: {
      mime: input.mime,
      size: input.size,
      kind: input.kind,
      sortOrder: input.sortOrder,
      durationSeconds: input.durationSeconds,
    },
  });

  if (presigned.method === 'put') {
    const whole: Blob | FilePart = input.file
      ? input.file
      : { fileUri: input.fileUri!, start: 0, end: input.size, size: input.size, mime: input.mime };
    await put(presigned.url!, whole, input.mime, input.onProgress, input.signal);
    return http.request<MediaCompleteResponse>(`/api/media/${presigned.mediaId}/complete`, {
      method: 'POST',
      body: { parts: [] },
    });
  }

  // multipart：分批取 URL，片间串行，每片重试 ≤3 次
  const partSize = presigned.partSize ?? VIDEO_PART_SIZE;
  const totalParts = Math.ceil(input.size / partSize);
  const parts: { partNumber: number; etag: string }[] = [];
  let uploadedBytes = 0;

  for (let batchStart = 1; batchStart <= totalParts; batchStart += PART_BATCH) {
    const numbers: number[] = [];
    for (let n = batchStart; n < batchStart + PART_BATCH && n <= totalParts; n++) numbers.push(n);
    const res = await http.request<{ urls: { partNumber: number; url: string }[] }>(`/api/media/${presigned.mediaId}/parts`, {
      method: 'POST',
      body: { partNumbers: numbers },
    });
    for (const { partNumber, url } of res.urls) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(partNumber * partSize, input.size);
      // file 形态在内存切片；fileUri 形态传区间描述（FilePart），由注入的 put 按片读盘——
      // RN 500MB 视频不整文件进内存（Phase 7 评审引入的契约扩展）。
      const blob: Blob | FilePart = input.file
        ? input.file.slice(start, end, input.mime)
        : { fileUri: input.fileUri!, start, end, size: end - start, mime: input.mime };
      let etag: string | null = null;
      let lastError: unknown;
      // 单调化：分片重试时该 part 的进度重新从 0 计，只上报历史最大值——保证 onProgress.loaded 单调不减（Produces 契约）
      let maxPartLoaded = 0;
      for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && etag === null; attempt++) {
        if (input.signal?.aborted) throw new ApiError('已取消', 0, 'ABORTED');
        try {
          const r = await put(
            url,
            blob,
            input.mime,
            (loaded) => {
              if (loaded > maxPartLoaded) maxPartLoaded = loaded;
              input.onProgress?.(uploadedBytes + maxPartLoaded, input.size);
            },
            input.signal
          );
          etag = r.etag;
          if (etag === null) {
            // PUT 成功但响应头无 ETag：多为桶 CORS 未配置 ExposeHeaders: ETag（见 Global Constraints 媒体条目），
            // 重试同样拿不到——不作为可重试失败，立即抛专用错误码。
            throw new ApiError('直传响应缺少 ETag（多为桶 CORS 未配置 ExposeHeaders: ETag）', 0, 'ETAG_MISSING');
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (etag === null) {
        throw lastError instanceof ApiError
          ? lastError
          : new ApiError('分片上传失败', 0, 'UPLOAD_FAILED');
      }
      parts.push({ partNumber, etag });
      // 进度按切片区间计算而非 blob.size：file.slice 对越界区间返回空 Blob（size=0），
      // 生产端 file.size === input.size 时两者等价，但按区间算才是正确不变量。
      uploadedBytes += end - start;
      input.onProgress?.(uploadedBytes, input.size);
    }
  }

  return http.request<MediaCompleteResponse>(`/api/media/${presigned.mediaId}/complete`, {
    method: 'POST',
    body: { parts },
  });
}
```
（`upload.ts` 内三处 `http.request<T>` 均显式给泛型，避免 `Promise<unknown>` 推导。）

`packages/api-client/src/client.ts` 三处增量：
1. import 区追加：
```ts
import { uploadMediaImpl, type UploadMediaInput } from './upload.js';
```
2. `MomentClient` interface 的 `registerPushToken` 之后追加：
```ts
  uploadMedia(input: UploadMediaInput): Promise<MediaCompleteResponse>;
```
3. 返回对象的 `registerPushToken` 之后追加：
```ts
    uploadMedia: (input) => uploadMediaImpl(http, options, input),
```

`packages/api-client/src/index.ts`（整体替换）：
```ts
export * from './types.js';
export { Http, type RequestOptions } from './http.js';
export {
  createMomentClient,
  type FeedQuery,
  type CreateMomentInput,
  type MomentClient,
} from './client.js';
export { uploadMediaImpl, type UploadMediaInput } from './upload.js';
export { xhrPut } from './default-put.js';
```

- [ ] **Step 4: 运行确认通过 + 构建 + 全包验证**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build && pnpm --filter @moment/api-client lint && pnpm --filter @moment/api-client typecheck`
Expected: http 11 + client 6 + upload 6 个测试 PASS；build/lint/typecheck 全绿（typecheck 经 `tsconfig.test.json` 覆盖测试文件）。

- [ ] **Step 5: 全仓回归**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: 全部包（dto/server/api-client）build/lint/test 绿（api-client 进入 turbo 依赖图，web 尚未建）。

- [ ] **Step 6: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): 媒体上传 helper（PUT 直传 + multipart 串行分片每片重试 + onProgress）"
```

---

## 分组 B：apps/web 骨架 + 路由 + auth

### Task 4: apps/web 脚手架（Vite/TS/Tailwind/eslint，照搬 aimo 选型）+ client 装配 + auth context + 路由骨架 + 登录/注册页

**Files:**
- Create: `apps/web/package.json`、`apps/web/tsconfig.json`、`apps/web/tsconfig.app.json`、`apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`、`apps/web/tailwind.config.js`、`apps/web/postcss.config.js`、`apps/web/eslint.config.js`、`apps/web/index.html`、`apps/web/.env.example`
- Create: `apps/web/src/env.d.ts`、`apps/web/src/index.css`、`apps/web/src/main.tsx`、`apps/web/src/App.tsx`
- Create: `apps/web/src/api/client.ts`、`apps/web/src/api/keys.ts`
- Create: `apps/web/src/auth/AuthProvider.tsx`、`apps/web/src/auth/RequireAuth.tsx`
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`、`apps/web/src/pages/RegisterPage.tsx`

**Interfaces:**
- Consumes: `@moment/api-client` 的 `createMomentClient/ApiError/TokenStore/MomentClient`（Task 1–3）、`@moment/dto` 的 `loginInputSchema/registerInputSchema/AuthResponse/LoginInput/RegisterInput/UserProfile/AuthTokens`。
- Produces（Task 5–10 依赖，不得改名）:
  - `client: MomentClient`（`src/api/client.ts` 单例，全 app 唯一 API 入口，组件禁止裸 fetch）
  - `tokenStore: TokenStore`（localStorage 实现，key `moment.auth.tokens` / `moment.auth.user`）
  - `qk`（`src/api/keys.ts` 全部 query key 工厂——后续 Task 的 mutation invalidate 一律引用它）
  - `useAuth(): { user; login(input); register(input); logout(); applyAuth(res) }`（AuthProvider）
  - `RequireAuth`（未登录 → `/login`，携带 `state.from` 登录后回跳）
  - `AppShell`（顶部导航：时光/链/通知（未读 badge，30s 轮询）/昵称/退出；`<Outlet/>` 内容区）
  - 路由骨架：`/login`、`/register`、受保护 AppShell 布局路由（功能子路由由 Task 5–10 依次加入 App.tsx，见各 Task 的「Modify App.tsx」步骤）

- [ ] **Step 1: 工程配置文件**

`apps/web/package.json`：
```json
{
  "name": "@moment/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -p tsconfig.app.json --noEmit",
    "lint": "eslint src/",
    "preview": "vite preview"
  },
  "dependencies": {
    "@moment/api-client": "workspace:*",
    "@moment/dto": "workspace:*",
    "@tanstack/react-query": "^5.66.0",
    "lucide-react": "^0.563.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.13.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.19.1",
    "@types/node": "^22.13.4",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "autoprefixer": "^10.4.24",
    "eslint": "^9.19.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "globals": "^16.5.0",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.22.0",
    "vite": "^7.3.1"
  }
}
```

`apps/web/tsconfig.json`：
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`apps/web/tsconfig.app.json`：
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

`apps/web/tsconfig.node.json`：
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

`apps/web/vite.config.ts`：
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 沿用 aimo：@ 别名 + dev 代理 /api → server（同源部署，client.baseUrl 为 ''）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
```

`apps/web/tailwind.config.js`：
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
```

`apps/web/postcss.config.js`：
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`apps/web/eslint.config.js`（照搬 aimo apps/web 的 flat config）：
```js
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
]);
```

`apps/web/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>时刻 Moment</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/.env.example`：
```dotenv
# API 根地址。开发留空（走 vite proxy /api → localhost:3000）；生产同源反向代理也留空。
VITE_API_BASE_URL=
```

`apps/web/src/env.d.ts`：
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}
```

- [ ] **Step 2: 入口 + client 装配 + query keys**

`apps/web/src/index.css`：
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    sans-serif;
  line-height: 1.5;
  color: #1f2937;
  background-color: #f9fafb;
  -webkit-font-smoothing: antialiased;
}
```

`apps/web/src/main.tsx`：
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

`apps/web/src/api/client.ts`：
```ts
import { createMomentClient, type MomentClient, type TokenStore } from '@moment/api-client';
import type { AuthTokens, UserProfile } from '@moment/dto';

const TOKENS_KEY = 'moment.auth.tokens';
const USER_KEY = 'moment.auth.user';

function readTokens(): AuthTokens | null {
  const raw = window.localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

/** web 端 TokenStore：localStorage（app 端用 expo-secure-store 实现同一接口，属 Phase 7）。 */
export const tokenStore: TokenStore = {
  getAccessToken: () => readTokens()?.accessToken ?? null,
  getRefreshToken: () => readTokens()?.refreshToken ?? null,
  setTokens: (tokens) => window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)),
  clear: () => {
    window.localStorage.removeItem(TOKENS_KEY);
    window.localStorage.removeItem(USER_KEY);
    // Http 的 refresh 失效路径只调 tokenStore.clear()（api-client 不感知 React）——
    // 派发事件通知 AuthProvider 收窄内存态（setUser(null) → RequireAuth 踢到 /login），
    // 否则 RequireAuth 仍按内存 user 判定已登录、页面永不跳转（DoD 第 11 条右半句的机制）。
    window.dispatchEvent(new Event('moment:auth-cleared'));
  },
};

export function cachedUser(): UserProfile | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function cacheUser(user: UserProfile | null): void {
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

/** 全 app 唯一 API 入口。组件里禁止裸 fetch。 */
export const client: MomentClient = createMomentClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  tokenStore,
});
```

`apps/web/src/api/keys.ts`：
```ts
/** 全部 query key 工厂：mutation 后的精确 invalidate 一律引用这里，禁止手写数组字面量。 */
export const qk = {
  chains: ['chains'] as const,
  chain: (chainId: string) => ['chains', chainId] as const,
  chainMembers: (chainId: string) => ['chains', chainId, 'members'] as const,
  chainInvites: (chainId: string) => ['chains', chainId, 'invites'] as const,
  chainMoments: (chainId: string) => ['chains', chainId, 'moments'] as const,
  tags: (chainId: string) => ['chains', chainId, 'tags'] as const,
  feed: (f: { chainIds?: string[]; tagId?: string; order: 'happened_at' | 'created_at' }) =>
    ['feed', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.order] as const,
  moment: (momentId: string) => ['moments', momentId] as const,
  comments: (momentId: string) => ['moments', momentId, 'comments'] as const,
  notifications: (unread: boolean) => ['notifications', unread] as const,
};
```

- [ ] **Step 3: auth context + 路由守卫 + AppShell + 路由骨架**

`apps/web/src/auth/AuthProvider.tsx`：
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { cacheUser, cachedUser, client, tokenStore } from '@/api/client';

interface AuthContextValue {
  user: UserProfile | null;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  /** 邀请接受等流程复用：写入 tokens + user 并更新内存态 */
  applyAuth(res: AuthResponse): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => cachedUser());
  const queryClient = useQueryClient();

  // refresh 彻底失效 → Http 调 tokenStore.clear() → web tokenStore 派发 'moment:auth-cleared'。
  // 这里收窄内存态：setUser(null) 后受保护路由的 RequireAuth 立即重定向 /login（state.from 回跳语义保留），
  // query 缓存全部作废。logout() 显式调用时同样触发本 listener（幂等，无副作用）。
  useEffect(() => {
    const onAuthCleared = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('moment:auth-cleared', onAuthCleared);
    return () => window.removeEventListener('moment:auth-cleared', onAuthCleared);
  }, [queryClient]);

  const applyAuth = useCallback((res: AuthResponse) => {
    tokenStore.setTokens(res.tokens);
    cacheUser(res.user);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      applyAuth(await client.login(input));
    },
    [applyAuth]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      applyAuth(await client.register(input));
    },
    [applyAuth]
  );

  const logout = useCallback(async () => {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) {
      await client.logout(refreshToken).catch(() => undefined);
    }
    tokenStore.clear();
    cacheUser(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, login, register, logout, applyAuth }),
    [user, login, register, logout, applyAuth]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

`apps/web/src/auth/RequireAuth.tsx`：
```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

/** 未登录跳 /login，登录后回跳原地址（state.from）。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
```

`apps/web/src/components/AppShell.tsx`：
```tsx
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Bell, Home, LogOut, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1 rounded px-3 py-1.5 text-sm ${
    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // 未读 badge：30s 轮询，只取第一页（limit 50 即可——服务端默认每页仅 20，badge 上限 50 可接受；
  // 「全部已读」在通知页翻页收集全部未读，见 NotificationsPage）
  const { data: notifications } = useQuery({
    queryKey: qk.notifications(false),
    queryFn: () => client.listNotifications(undefined, { limit: 50 }),
    refetchInterval: 30_000,
  });
  const unread = (notifications?.notifications ?? []).filter((n) => n.readAt === null).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2">
          <NavLink to="/" end className={navClass}>
            <Home size={16} />
            时光
          </NavLink>
          <NavLink to="/chains" className={navClass}>
            <Users size={16} />
            链
          </NavLink>
          <NavLink to="/notifications" className={`${navClass} relative`}>
            <Bell size={16} />
            通知
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-600">{user?.nickname}</span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            >
              <LogOut size={14} />
              退出
            </button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-3 py-4">
        <Outlet />
      </main>
    </div>
  );
}
```

`apps/web/src/App.tsx`：
```tsx
import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        {/* 功能子路由由 Task 5–10 依次加入（feed / chains / compose / moments / notifications） */}
      </Route>
      <Route path="*" element={<div className="p-8 text-center text-gray-500">页面不存在</div>} />
    </Routes>
  );
}
```

- [ ] **Step 4: 登录/注册页（dto zod schema 校验）**

`apps/web/src/pages/LoginPage.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@moment/api-client';
import { loginInputSchema } from '@moment/dto';
import { useAuth } from '@/auth/AuthProvider';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">登录时刻</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-gray-600">邮箱</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none"
          />
          {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-gray-600">密码</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none"
          />
          {fieldErrors.password && <p className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>}
        </div>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-gray-900 py-2 text-white disabled:opacity-50"
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        还没有账号？<Link to="/register" state={location.state} className="text-gray-900 underline">注册</Link>
      </p>
    </div>
  );
}
```

`apps/web/src/pages/RegisterPage.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@moment/api-client';
import { registerInputSchema } from '@moment/dto';
import { useAuth } from '@/auth/AuthProvider';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // 与 LoginPage 同款回跳：未登录点邀请链接被踢到 /login → 点「注册」进来后 from 不丢，
  // 注册成功自动回到邀请页（spec：未注册邮箱先收链接，注册后自动入链）。
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setFieldErrors({ confirm: '两次输入的密码不一致' });
      return;
    }
    const parsed = registerInputSchema.safeParse({ email, password, nickname });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(parsed.data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    type: string
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-gray-600">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => setter(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none"
      />
      {fieldErrors[id] && <p className="mt-1 text-xs text-red-600">{fieldErrors[id]}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">注册时刻</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {field('email', '邮箱', email, setEmail, 'email')}
        {field('nickname', '昵称', nickname, setNickname, 'text')}
        {field('password', '密码（8–72 位）', password, setPassword, 'password')}
        {field('confirm', '确认密码', confirm, setConfirm, 'password')}
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-gray-900 py-2 text-white disabled:opacity-50"
        >
          {submitting ? '注册中…' : '注册'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        已有账号？<Link to="/login" state={location.state} className="text-gray-900 underline">登录</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 5: 安装与静态验证**

Run: `pnpm install && pnpm --filter @moment/api-client build && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: typecheck/build/lint 三绿（`dist/` 产出 index.html + assets；空布局路由合法——`<Route element={...}/>` 无子路由在 react-router v7 允许）。

- [ ] **Step 6: 手动验证（dev）**

前置：`pnpm --filter @moment/server dev`（连测试库）+ `pnpm --filter @moment/web dev`。
1. 打开 `http://localhost:5173/register`，空表单提交 → 出现 zod 字段错误（邮箱格式/密码长度）。
2. 注册 `phase6@test.com` / `secret123` / `phase6` → 跳 `/`；因 feed 路由尚未加入（Task 5），布局路由无任何子路由、不匹配 `/`，`/` 命中 `*` 兜底显示「页面不存在」——**属预期中间态**。注意此时顶部导航**不可见**（导航在未匹配的布局路由里，兜底页渲染在布局外）；昵称/退出按钮的可见性留到 Task 5 加入 `/` 路由后验证。
3. 点退出 → 回 `/login`；直接访问 `/login` 用刚才邮箱登录成功；localStorage 出现 `moment.auth.tokens`。
4. 未登录直接访问 `/chains` → 被 RequireAuth 重定向到 `/login`，登录后回跳 `/chains`（同样暂显示 404 兜底）。

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Vite+React19+Tailwind 脚手架、api-client 装配、auth 与登录/注册页"
```

---

## 分组 C：feed + 链

### Task 5: Feed 页（useInfiniteQuery 无限滚动 + 链/tag 过滤 chips + 排序切换）+ MomentCard / MediaGrid

**Files:**
- Create: `apps/web/src/lib/time.ts`、`apps/web/src/components/MediaGrid.tsx`、`apps/web/src/components/MomentCard.tsx`
- Create: `apps/web/src/pages/FeedPage.tsx`
- Modify: `apps/web/src/App.tsx`（布局路由内加 `/`）

**Interfaces:**
- Consumes: `client.getFeed/listChains/listTags/fetchMediaBlob`、`qk.feed/qk.chains/qk.tags`、dto `MomentResponse/FeedResponse/ChainDto/TagResponse`。
- Produces（Task 7/9 依赖，不得改名）:
  - `formatHappenedAt(iso: string, tzOffsetMinutes: number): string`（按提交者时区展示：`Date.parse(iso) - tzOffset` 后取 UTC 字段；dto 语义东八区 = -480）
  - `currentTzOffset(): number`（= `new Date().getTimezoneOffset()`，composer 提交用）
  - `MomentCard({ moment, chainName? })`（作者/链名/happened_at+补发标记/content/MediaGrid/tags/reactions 摘要/评论数/详情链接）
  - `MediaGrid({ media })`（图片 1 张大图、2–9 张三列宫格；视频**点击后才加载**——占位「▶ 点击查看视频」按钮，点击后 `fetchMediaBlob` 整段拉取并自动播放（feed/时间线列表里不自动拉视频，防多条视频整段加载瞬间打满带宽）；渲染一律 `client.fetchMediaBlob(id)` → `URL.createObjectURL`，卸载时 `revokeObjectURL`——`GET /api/media/:id` 需 Bearer 头，`<img>/<video>` src 直指稳定入口必 401，见 Global Constraints 媒体条目）

- [ ] **Step 1: 时间工具 + MediaGrid + MomentCard**

`apps/web/src/lib/time.ts`：
```ts
/**
 * 按 moment 提交者的时区展示 happened_at。
 * dto 语义（Phase 3）：happenedTzOffset 同 JS getTimezoneOffset（分钟，东八区 = -480），
 * 故提交者本地墙钟 = UTC 时刻 - offset。
 */
export function formatHappenedAt(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(Date.parse(iso) - tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
    shifted.getUTCHours()
  )}:${pad(shifted.getUTCMinutes())}`;
}

/** 提交 moment 时随表单发送的时区偏移（分钟）。 */
export function currentTzOffset(): number {
  return new Date().getTimezoneOffset();
}
```

`apps/web/src/components/MediaGrid.tsx`：
```tsx
import { useEffect, useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { client } from '@/api/client';

/** 经 client.fetchMediaBlob 拉媒体二进制并转 object URL；组件卸载时 revokeObjectURL（不泄漏）。
 *  GET /api/media/:id 是 @Authorized 端点，<img>/<video> src 无法携带 Bearer——故不直接用 client.mediaUrl。
 *  取舍（Global Constraints 媒体条目）：整段加载、无 302 头 Cache-Control 复用与视频流式 seek，Phase 8 再引入签名 query 参数方案。 */
function useMediaObjectUrl(mediaId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId) return; // null = 暂不加载（视频点击前的占位态）
    let objectUrl: string | null = null;
    let alive = true;
    void client
      .fetchMediaBlob(mediaId)
      .then((blob) => {
        if (!alive) return; // 已卸载：不再创建 object URL（blob 交给 GC）
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined); // 单项媒体加载失败静默占位，不打断卡片其余内容
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [mediaId]);
  return url;
}

/** 媒体展示：视频用 <video>；图片 1 张大图、2–9 张三列宫格。二进制一律经 fetchMediaBlob 获取。 */
export function MediaGrid({ media }: { media: MomentMedia[] }) {
  if (media.length === 0) return null;
  if (media[0]!.mime.startsWith('video/')) {
    return <MediaVideo mediaId={media[0]!.id} />;
  }
  const cols = media.length === 1 ? 'grid-cols-1' : 'grid-cols-3';
  return (
    <div className={`mt-2 grid ${cols} gap-1`}>
      {media.map((m) => (
        <MediaImage key={m.id} mediaId={m.id} single={media.length === 1} />
      ))}
    </div>
  );
}

/** 视频点击加载：fetchMediaBlob 是整段加载（取舍见 Global Constraints 媒体条目），
 *  feed/链时间线里自动拉取每条视频会瞬间占满带宽——默认只渲染占位按钮，点击后才拉取并播放
 *  （详情页同款交互：卡片内点击即加载播放）。 */
function MediaVideo({ mediaId }: { mediaId: string }) {
  const [activated, setActivated] = useState(false);
  const url = useMediaObjectUrl(activated ? mediaId : null);
  if (!activated) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        className="mt-2 flex aspect-video w-full items-center justify-center rounded bg-gray-900/90 text-sm text-white"
      >
        ▶ 点击查看视频
      </button>
    );
  }
  if (!url) return <div className="mt-2 aspect-video w-full animate-pulse rounded bg-gray-100" />;
  return <video controls autoPlay src={url} className="mt-2 w-full rounded bg-black" />;
}

function MediaImage({ mediaId, single }: { mediaId: string; single: boolean }) {
  const url = useMediaObjectUrl(mediaId);
  if (!url) return <div className={`aspect-square w-full rounded bg-gray-100 ${single ? 'max-h-96' : ''}`} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`aspect-square w-full rounded object-cover ${single ? 'max-h-96 object-contain' : ''}`}
    />
  );
}
```

`apps/web/src/components/MomentCard.tsx`：
```tsx
import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import type { MomentResponse } from '@moment/dto';
import { formatHappenedAt } from '@/lib/time';
import { MediaGrid } from './MediaGrid';

/** moment 卡片：feed / 链时间线共用。点击评论数或「详情」进入详情页。 */
export function MomentCard({ moment, chainName }: { moment: MomentResponse; chainName?: string }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2 text-sm">
        <span className="font-medium">{moment.author.nickname}</span>
        {chainName && (
          <Link to={`/chains/${moment.chainId}`} className="text-gray-500 hover:underline">
            · {chainName}
          </Link>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {formatHappenedAt(moment.happenedAt, moment.happenedTzOffset)}
          {moment.isBackfill && ' · 补发'}
        </span>
      </div>
      {moment.content && <p className="whitespace-pre-wrap text-[15px]">{moment.content}</p>}
      <MediaGrid media={moment.media} />
      {moment.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {moment.tags.map((t) => (
            <span key={t.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              #{t.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-0.5">
          <MessageCircle size={13} />
          {moment.commentCount}
        </span>
        <span className="flex flex-wrap gap-1">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji}
              {r.count}
            </span>
          ))}
        </span>
        <Link to={`/moments/${moment.id}`} className="ml-auto text-gray-400 hover:text-gray-900">
          详情
        </Link>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: FeedPage**

`apps/web/src/pages/FeedPage.tsx`：
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { MomentCard } from '@/components/MomentCard';

const ORDERS = [
  { value: 'happened_at', label: '事件时间' },
  { value: 'created_at', label: '添加时间' },
] as const;

export function FeedPage() {
  const [chainFilter, setChainFilter] = useState<string[]>([]);
  const [tagId, setTagId] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<'happened_at' | 'created_at'>('happened_at');

  const { data: chains } = useQuery({ queryKey: qk.chains, queryFn: () => client.listChains() });
  const chainNameById = useMemo(
    () => new Map((chains ?? []).map((c) => [c.id, c.name])),
    [chains]
  );

  const filter = useMemo(
    () => ({ chainIds: chainFilter.length > 0 ? chainFilter : undefined, tagId, order }),
    [chainFilter, tagId, order]
  );

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isPending,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: qk.feed(filter),
    queryFn: ({ pageParam }) =>
      client.getFeed({ ...filter, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const moments = data?.pages.flatMap((p) => p.moments) ?? [];

  // tag 过滤只在选中恰好一条链时可用（tag 属于链，Phase 4 语义）
  const singleChainId = chainFilter.length === 1 ? chainFilter[0] : undefined;
  const { data: tagList } = useQuery({
    queryKey: qk.tags(singleChainId ?? ''),
    queryFn: () => client.listTags(singleChainId!),
    enabled: singleChainId !== undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleChain = (id: string) => {
    setTagId(undefined);
    setChainFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setChainFilter([]); setTagId(undefined); }}
          className={`rounded-full px-3 py-1 text-sm ${chainFilter.length === 0 ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}
        >
          全部
        </button>
        {(chains ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggleChain(c.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              chainFilter.includes(c.id)
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            {c.name}
          </button>
        ))}
        <div className="ml-auto flex rounded border border-gray-200 bg-white text-sm">
          {ORDERS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOrder(o.value)}
              className={`px-2 py-1 ${order === o.value ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {singleChainId !== undefined && (tagList?.tags.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTagId(undefined)}
            className={`rounded px-2 py-0.5 text-xs ${tagId === undefined ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            全部标签
          </button>
          {tagList!.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId(t.id)}
              className={`rounded px-2 py-0.5 text-xs ${
                tagId === t.id ? 'bg-gray-700 text-white' : 'border border-gray-200 bg-white text-gray-600'
              }`}
            >
              #{t.name}（{t.momentCount}）
            </button>
          ))}
        </div>
      )}

      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      {!isPending && !isError && moments.length === 0 && (
        <p className="py-10 text-center text-gray-400">还没有时刻。去链里发布第一条吧。</p>
      )}
      <div className="space-y-3">
        {moments.map((m) => (
          <MomentCard key={m.id} moment={m} chainName={chainNameById.get(m.chainId)} />
        ))}
      </div>
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && <p className="text-center text-sm text-gray-400">加载更多…</p>}
    </div>
  );
}
```

`apps/web/src/App.tsx` 布局路由内追加（`{/* 功能子路由… */}` 注释之后）：
```tsx
        <Route path="/" element={<FeedPage />} />
```
并在文件顶部 import：
```ts
import { FeedPage } from '@/pages/FeedPage';
```

- [ ] **Step 3: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿。

- [ ] **Step 4: 手动验证（dev）**

前置：server dev + web dev，已注册用户 A 建了链并发布 ≥25 条 moment（可用 Task 8 完成后的 composer，或先 curl 造数据）。本次验证可与 Task 8 后统一执行；最小前置下验证：
1. 登录后 `/` 不再显示 404，出现 feed（或空态文案）。
2. 链 chips：点选一条链 → 列表收窄；「全部」恢复；选两条链时 tag chips 消失（无单链上下文）。
3. 选单链 → tag chips 出现，点 tag 过滤生效。
4. 排序切到「添加时间」→ 最新创建的 moment 置顶（补发可见，spec §5.6）。
5. 造满 25 条后滚动到底 → 自动加载下一页，无重复无丢失。
6. 视频类型 moment 在 feed/时间线只显示「▶ 点击查看视频」占位（network 面板无媒体请求）；点击后才发起 `/api/media/:id` 请求并自动播放；详情页同款交互。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): feed 无限滚动页（链/tag 过滤 chips + 排序切换）与 MomentCard/MediaGrid"
```

---

### Task 6: 链列表页（我参与的链 + 创建链）

**Files:**
- Create: `apps/web/src/pages/ChainsPage.tsx`
- Modify: `apps/web/src/App.tsx`（布局路由内加 `/chains`）

**Interfaces:**
- Consumes: `client.listChains/createChain`、`qk.chains`、dto `ChainDto/createChainInputSchema`、`useAuth().user`（owner 标识）。
- Produces: `/chains` 页（卡片列表：名称/我的角色/描述/创建时间，点卡片进 `/chains/:chainId`；创建表单走 `createChainInputSchema` 校验）。

- [ ] **Step 1: 实现**

`apps/web/src/pages/ChainsPage.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Plus } from 'lucide-react';
import { ApiError } from '@moment/api-client';
import { createChainInputSchema, type ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

const ROLE_LABEL: Record<string, string> = { owner: '创建者', editor: '可记录', viewer: '只读' };

export function ChainsPage() {
  const queryClient = useQueryClient();
  const { data: chains, isPending, isError, error } = useQuery({
    queryKey: qk.chains,
    queryFn: () => client.listChains(),
  });

  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: { name: string }) => client.createChain(input),
    onSuccess: () => {
      setName('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: qk.chains });
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createChainInputSchema.safeParse({ name });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '名称不合法');
      return;
    }
    setFieldError(null);
    try {
      await create.mutateAsync(parsed.data);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '创建失败');
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2 rounded-lg border border-gray-200 bg-white p-3" noValidate>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新建时光链，如「宝宝成长」"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="flex items-center gap-1 rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <Plus size={14} />
          创建
        </button>
      </form>
      {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
      {formError && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(chains ?? []).map((c: ChainDto) => (
          <Link
            key={c.id}
            to={`/chains/${c.id}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-400"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.myRole === 'owner' && <Crown size={14} className="text-amber-500" />}
              <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {ROLE_LABEL[c.myRole ?? 'viewer']}
              </span>
            </div>
            {c.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{c.description}</p>}
            <p className="mt-2 text-xs text-gray-400">创建于 {c.createdAt.slice(0, 10)}</p>
          </Link>
        ))}
      </div>
      {!isPending && (chains ?? []).length === 0 && (
        <p className="py-10 text-center text-gray-400">还没有链。创建第一条，或等好友邀请你加入。</p>
      )}
    </div>
  );
}
```

`apps/web/src/App.tsx` 布局路由内追加（`/` 之后）：
```tsx
        <Route path="/chains" element={<ChainsPage />} />
        <Route path="/chains/:chainId" element={<ChainDetailPage />} />
```
（`ChainDetailPage` 属 Task 7；为避免引用未建文件，本 Task 只加 `/chains` 一行，`/chains/:chainId` 由 Task 7 Step 4 追加。）并在顶部 import `ChainsPage`。

- [ ] **Step 2: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿。

- [ ] **Step 3: 手动验证**

1. `/chains` 空态文案可见；创建「宝宝成长」→ 列表出现卡片（我的角色=创建者），刷新后仍在。
2. 空 name 提交 → zod 错误提示。
3. 用户 B 通过邀请加入该链（可先 curl 造）→ B 的 `/chains` 显示同一链、角色徽章正确。

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): 链列表页与创建链表单"
```

---

### Task 7: 链详情页（链内时间线 + 成员管理（owner）+ 邀请生成 + tag 管理）

**Files:**
- Create: `apps/web/src/components/chain/MembersPanel.tsx`、`apps/web/src/components/chain/InvitesPanel.tsx`、`apps/web/src/components/chain/TagsPanel.tsx`
- Create: `apps/web/src/pages/ChainDetailPage.tsx`
- Modify: `apps/web/src/App.tsx`（布局路由内加 `/chains/:chainId`）

**Interfaces:**
- Consumes: `client.getChain/listChainMoments/listMembers/updateMemberRole/removeMember/transferChain/createInvite/listInvites/revokeInvite/listTags/createTag/deleteTag`、`qk.chain*/qk.tags`、dto `ChainDto/ChainMemberDto/InviteDto/TagResponse`。
- Produces:
  - `/chains/:chainId` 页：头部（名称/我的角色/描述/「发布时刻」按钮——仅 `myRole ∈ {owner, editor}` 显示，点击进 `/chains/:chainId/compose`，compose 路由 Task 8 加）+ 四个 tab：时间线（useInfiniteQuery 游标翻页）/ 成员 / 邀请 / 标签。
  - `MembersPanel({ chain })`：成员列表；owner 可改角色（editor/viewer select）、移除成员、转让 owner（选定成员 + 按钮）；本人退链按钮（owner 会被 server 409 `OWNER_MUST_TRANSFER` 拒绝，错误信息原样展示）。
  - `InvitesPanel({ chain })`：创建邀请（role select + 可选 email）；owner 可见邀请列表（复制链接 `${origin}/invites/${token}`、吊销）。
  - `TagsPanel({ chainId })`：tag 列表（含 momentCount）+ 创建 + 删除（editor+；删除后 invalidate `qk.tags` 与 `qk.feed`）。

- [ ] **Step 1: 三个管理面板**

`apps/web/src/components/chain/MembersPanel.tsx`：
```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

export function MembersPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = chain.myRole === 'owner';
  const [error, setError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const { data: members } = useQuery({
    queryKey: qk.chainMembers(chain.id),
    queryFn: () => client.listMembers(chain.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chainMembers(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chain(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chains });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : '操作失败');

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: 'editor' | 'viewer' }) =>
      client.updateMemberRole(chain.id, v.userId, v.role),
    onSuccess: invalidate,
    onError,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => client.removeMember(chain.id, userId),
    onSuccess: invalidate,
    onError,
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => client.transferChain(chain.id, userId),
    onSuccess: () => {
      setTransferTarget('');
      invalidate();
    },
    onError,
  });

  const nonOwnerMembers = (members ?? []).filter((m) => m.role !== 'owner');

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="flex items-center gap-2 px-4 py-3 text-sm">
            <span className="font-medium">{m.nickname}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{m.role}</span>
            <span className="ml-auto text-xs text-gray-400">{m.joinedAt.slice(0, 10)} 加入</span>
            {isOwner && m.role !== 'owner' && (
              <select
                value={m.role}
                onChange={(e) =>
                  changeRole.mutate({ userId: m.userId, role: e.target.value as 'editor' | 'viewer' })
                }
                className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                aria-label={`修改 ${m.nickname} 的角色`}
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            )}
            {isOwner && m.role !== 'owner' && (
              <button
                type="button"
                onClick={() => removeMember.mutate(m.userId)}
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                移除
              </button>
            )}
            {!isOwner && m.userId === user?.id && (
              <button
                type="button"
                onClick={() => removeMember.mutate(m.userId)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                退出此链
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <span>转让创建者给</span>
          <select
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="">选择成员…</option>
            {nonOwnerMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.nickname}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!transferTarget || transfer.isPending}
            onClick={() => transfer.mutate(transferTarget)}
            className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
          >
            转让
          </button>
        </div>
      )}
    </div>
  );
}
```

`apps/web/src/components/chain/InvitesPanel.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

export function InvitesPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const canCreate = chain.myRole === 'owner' || chain.myRole === 'editor';
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: invites } = useQuery({
    queryKey: qk.chainInvites(chain.id),
    queryFn: () => client.listInvites(chain.id),
    enabled: chain.myRole === 'owner',
  });

  const create = useMutation({
    mutationFn: (input: { role: 'editor' | 'viewer'; email?: string }) =>
      client.createInvite(chain.id, input),
    onSuccess: () => {
      setEmail('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.chainInvites(chain.id) });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '创建失败'),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => client.revokeInvite(inviteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.chainInvites(chain.id) }),
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '吊销失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ role, email: email.trim() === '' ? undefined : email.trim() });
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/invites/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {canCreate && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <span>邀请新成员为</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="editor">editor（可记录）</option>
            <option value="viewer">viewer（只读）</option>
          </select>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="绑定邮箱（可选，仅该邮箱可接受）"
            className="flex-1 rounded border border-gray-300 px-2 py-1"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
          >
            生成邀请
          </button>
        </form>
      )}
      {chain.myRole === 'owner' && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
          {(invites ?? []).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{i.role}</span>
              {i.email && <span className="text-gray-600">{i.email}</span>}
              <span className="text-xs text-gray-400">
                {i.acceptedAt ? `已接受（${i.acceptedAt.slice(0, 10)}）` : `${i.expiresAt.slice(0, 10)} 过期`}
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink(i.token)}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                >
                  {copied === i.token ? '已复制' : '复制链接'}
                </button>
                <button
                  type="button"
                  onClick={() => revoke.mutate(i.id)}
                  className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  吊销
                </button>
              </span>
            </li>
          ))}
          {(invites ?? []).length === 0 && <li className="px-4 py-3 text-gray-400">暂无邀请</li>}
        </ul>
      )}
      {!canCreate && (
        <p className="py-6 text-center text-sm text-gray-400">viewer 不能创建邀请，请找链内创建者或 editor。</p>
      )}
    </div>
  );
}
```

`apps/web/src/components/chain/TagsPanel.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

export function TagsPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const canEdit = chain.myRole === 'owner' || chain.myRole === 'editor';
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: tagList } = useQuery({
    queryKey: qk.tags(chain.id),
    queryFn: () => client.listTags(chain.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.tags(chain.id) });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
  };

  const create = useMutation({
    mutationFn: () => client.createTag(chain.id, name.trim()),
    onSuccess: () => {
      setName('');
      setError(null);
      invalidate();
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '创建失败'),
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => client.deleteTag(tagId),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '删除失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError('标签名不能为空');
      return;
    }
    create.mutate();
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {canEdit && (
        <form onSubmit={onSubmit} className="flex gap-2 rounded-lg border border-gray-200 bg-white p-3" noValidate>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新标签（链内唯一，1–50 字）"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button type="submit" disabled={create.isPending} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            添加
          </button>
        </form>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
        {(tagList?.tags ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-4 py-2.5">
            <span>#{t.name}</span>
            <span className="text-xs text-gray-400">{t.momentCount} 条时刻</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => remove.mutate(t.id)}
                className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            )}
          </li>
        ))}
        {(tagList?.tags ?? []).length === 0 && <li className="px-4 py-3 text-gray-400">暂无标签</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: ChainDetailPage（头部 + tabs + 链内时间线无限滚动）**

`apps/web/src/pages/ChainDetailPage.tsx`：
```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { MomentCard } from '@/components/MomentCard';
import { MembersPanel } from '@/components/chain/MembersPanel';
import { InvitesPanel } from '@/components/chain/InvitesPanel';
import { TagsPanel } from '@/components/chain/TagsPanel';

const TABS = [
  { key: 'timeline', label: '时间线' },
  { key: 'members', label: '成员' },
  { key: 'invites', label: '邀请' },
  { key: 'tags', label: '标签' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ChainDetailPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const [tab, setTab] = useState<Tab>('timeline');

  const { data: chain, isPending, isError, error } = useQuery({
    queryKey: qk.chain(chainId ?? ''),
    queryFn: () => client.getChain(chainId!),
    enabled: chainId !== undefined,
  });

  const timeline = useInfiniteQuery({
    queryKey: qk.chainMoments(chainId ?? ''),
    queryFn: ({ pageParam }) =>
      client.listChainMoments(chainId!, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: chainId !== undefined && tab === 'timeline',
  });
  const moments = timeline.data?.pages.flatMap((p) => p.moments) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && timeline.hasNextPage && !timeline.isFetchingNextPage) {
        void timeline.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [timeline.hasNextPage, timeline.isFetchingNextPage, timeline.fetchNextPage, tab]);

  if (isPending) return <p className="py-10 text-center text-gray-400">加载中…</p>;
  if (isError || !chain) {
    return (
      <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        加载失败：{error instanceof Error ? error.message : '链不存在或无权访问'}
      </p>
    );
  }
  const canCompose = chain.myRole === 'owner' || chain.myRole === 'editor';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{chain.name}</h1>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{chain.myRole}</span>
          {canCompose && (
            <Link
              to={`/chains/${chain.id}/compose`}
              className="ml-auto flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
            >
              <Camera size={14} />
              发布时刻
            </Link>
          )}
        </div>
        {chain.description && <p className="mt-1 text-sm text-gray-500">{chain.description}</p>}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-gray-900 font-medium' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <div className="space-y-3">
          {moments.length === 0 && !timeline.isPending && (
            <p className="py-10 text-center text-gray-400">这条链还没有时刻。</p>
          )}
          {moments.map((m) => (
            <MomentCard key={m.id} moment={m} chainName={chain.name} />
          ))}
          <div ref={sentinelRef} className="h-8" />
          {timeline.isFetchingNextPage && <p className="text-center text-sm text-gray-400">加载更多…</p>}
        </div>
      )}
      {tab === 'members' && <MembersPanel chain={chain} />}
      {tab === 'invites' && <InvitesPanel chain={chain} />}
      {tab === 'tags' && <TagsPanel chain={chain} />}
    </div>
  );
}
```

`apps/web/src/App.tsx` 布局路由内追加（`/chains` 之后）：
```tsx
        <Route path="/chains/:chainId" element={<ChainDetailPage />} />
```
并在顶部 import `ChainDetailPage`。

- [ ] **Step 3: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿（注意 `MembersPanel` 的 `useAuth` import、`ChainDetailPage` 对 `tab` 切回时间线时重新 observe sentinel）。

- [ ] **Step 4: 手动验证**

1. `/chains` 点卡片进详情：名称/角色徽章/四 tab 可切换；owner 可见「发布时刻」按钮，viewer 不可见（用 Task 8 前该按钮先指向 compose 路由——Task 8 前点击显示 404 兜底属预期中间态，Task 8 Step 5 加入路由后可用）。
2. 成员 tab：owner 把 editor 改成 viewer → 徽章变化；移除 viewer 成员 → 列表减少；把自己（owner）无「退出」按钮；非 owner 的自己有「退出此链」。
3. 转让：owner 选成员转让 → 自己变 editor、「发布时刻」仍在、成员 tab 无管理控件、邀请列表消失（403 由 enabled 条件规避）。
4. 邀请 tab：owner/editor 生成邀请（viewer/editor）→ owner 列表出现；「复制链接」得到 `/invites/<token>`；吊销后列表消失。
5. 标签 tab：添加「周岁」「游泳」→ 列表出现；重复添加同名 → 显示 `TAG_EXISTS` 的服务端 message；删除 → 消失且 feed 的 tag chips 同步失效（invalidate `['feed']`）。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 链详情页（时间线/成员管理/邀请生成/tag 管理）"
```

---

## 分组 D：发布 moment + 媒体上传

### Task 8: 链内 composer（三类型切换 / 图片九宫格选择预览 / 视频大小时长 / happened_at / is_backfill / tag 选择 / multipart 上传进度条）

**Files:**
- Create: `apps/web/src/lib/media.ts`
- Create: `apps/web/src/pages/ComposePage.tsx`
- Modify: `apps/web/src/App.tsx`（布局路由内加 `/chains/:chainId/compose`）

**Interfaces:**
- Consumes: `client.uploadMedia/createMoment/listTags/getChain`（上传走 api-client 的 multipart helper——每片重试在 client 内，页面只消费 onProgress）、`qk.chainMoments/qk.tags`、dto 常量 `MAX_IMAGE_BYTES/MAX_VIDEO_BYTES/MAX_VIDEO_DURATION_SECONDS`、`currentTzOffset()`（Task 5）。
- Produces:
  - `probeVideo(file: File): Promise<{ size: number; durationSeconds: number }>`、`formatBytes(n)`（`src/lib/media.ts`）
  - `/chains/:chainId/compose` 页：类型三选一（text/media/video）；text 必填文字；media 选 1–9 张图（每张 ≤ `MAX_IMAGE_BYTES`，预览宫格，可删）；video 选 1 个（≤ `MAX_VIDEO_BYTES` 且 ≤ `MAX_VIDEO_DURATION_SECONDS`，显示大小/时长）；`happened_at` 用 `datetime-local`（默认当前时刻）；`is_backfill` 开关；tag 多选（来自链 tags，≤20）；提交时先串行上传全部媒体（**逐项进度条**），全部 ready 后 `createMoment`，成功 invalidate 并跳回链时间线。

- [ ] **Step 1: 媒体工具**

`apps/web/src/lib/media.ts`：
```ts
export interface VideoMeta {
  size: number;
  durationSeconds: number;
}

/** 读视频元数据（时长），供 presign 的 durationSeconds 上报与前端限制提示。 */
export function probeVideo(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ size: file.size, durationSeconds: Math.round(video.duration) });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取视频元数据'));
    };
    video.src = url;
  });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** datetime-local 默认值：当前本地时刻（YYYY-MM-DDTHH:mm）。 */
export function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
```

- [ ] **Step 2: ComposePage**

`apps/web/src/pages/ComposePage.tsx`：
```tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ApiError } from '@moment/api-client';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
} from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { currentTzOffset } from '@/lib/time';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';

const TYPES = [
  { value: 'text', label: '文字' },
  { value: 'media', label: '图片' },
  { value: 'video', label: '视频' },
] as const;
type MomentType = (typeof TYPES)[number]['value'];

interface PickedImage {
  file: File;
  previewUrl: string;
}
interface PickedVideo {
  file: File;
  size: number;
  durationSeconds: number;
  previewUrl: string;
}
interface UploadItem {
  name: string;
  loaded: number;
  total: number;
  status: 'uploading' | 'done';
}

export function ComposePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: chain } = useQuery({
    queryKey: qk.chain(chainId ?? ''),
    queryFn: () => client.getChain(chainId!),
    enabled: chainId !== undefined,
  });
  const { data: tagList } = useQuery({
    queryKey: qk.tags(chainId ?? ''),
    queryFn: () => client.listTags(chainId!),
    enabled: chainId !== undefined,
  });

  const [type, setType] = useState<MomentType>('text');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [happenedAt, setHappenedAt] = useState(nowLocalInput());
  const [isBackfill, setIsBackfill] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // 预览 objectURL 生命周期：删除单张图片/移除视频在各自 handler 内即时 revoke，
  // 组件卸载（发布成功跳走 / 取消返回）由本 effect 统一兜底 revoke——ref 取最新值，deps 固定 []。
  const previewsRef = useRef<{ images: PickedImage[]; video: PickedVideo | null }>({ images: [], video: null });
  previewsRef.current = { images, video };
  useEffect(
    () => () => {
      previewsRef.current.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      if (previewsRef.current.video) URL.revokeObjectURL(previewsRef.current.video.previewUrl);
    },
    []
  );

  const canCompose = chain?.myRole === 'owner' || chain?.myRole === 'editor';

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.createMoment>[1]) =>
      client.createMoment(chainId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId!) });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: qk.tags(chainId!) });
      void queryClient.invalidateQueries({ queryKey: qk.chain(chainId!) });
      navigate(`/chains/${chainId}`);
    },
  });

  function onPickImages(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setImages((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}），已跳过`);
          continue;
        }
        if (next.length >= 9) {
          setError('最多 9 张图片');
          break;
        }
        next.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
  }

  async function onPickVideo(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`);
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        setError(`视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟，当前 ${meta.durationSeconds} 秒`);
        return;
      }
      setVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl); // 换选视频：旧预览即时释放
        return { file, ...meta, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取视频');
    }
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= 20 ? prev : [...prev, id]
    );
  }

  async function uploadAll(): Promise<string[]> {
    const mediaIds: string[] = [];
    const queue: { name: string; run: (onProgress: (l: number, t: number) => void) => Promise<void>; size: number }[] = [];
    // 严格按当前 type 取待传媒体：切类型后另一侧的遗留选择不参与上传
    // （否则 video 类型会带出先前选的图片，被 createMomentInputSchema 以 MEDIA_COUNT_INVALID 拒绝）
    const pickedImages = type === 'media' ? images : [];
    pickedImages.forEach((img, index) => {
      queue.push({
        name: img.file.name,
        size: img.file.size,
        run: async (onProgress) => {
          const res = await client.uploadMedia({
            file: img.file,
            mime: img.file.type,
            size: img.file.size,
            kind: 'image',
            sortOrder: index,
            onProgress,
          });
          mediaIds.push(res.mediaId);
        },
      });
    });
    if (video && type === 'video') {
      queue.push({
        name: video.file.name,
        size: video.size,
        run: async (onProgress) => {
          const res = await client.uploadMedia({
            file: video.file,
            mime: video.file.type,
            size: video.size,
            kind: 'video',
            durationSeconds: video.durationSeconds,
            onProgress,
          });
          mediaIds.push(res.mediaId);
        },
      });
    }
    setItems(queue.map((q) => ({ name: q.name, loaded: 0, total: q.size, status: 'uploading' })));
    // 串行上传：进度逐项反馈，失败即中止（已传对象交由 server sweeper 24h 清理，无需 abort）
    for (let i = 0; i < queue.length; i++) {
      await queue[i]!.run((loaded, total) =>
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, loaded, total } : it)))
      );
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'done', loaded: it.total } : it)));
    }
    return mediaIds;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (type === 'text' && content.trim().length === 0) {
      setError('文字时刻不能为空');
      return;
    }
    if (type === 'media' && images.length === 0) {
      setError('请选择 1–9 张图片');
      return;
    }
    if (type === 'video' && !video) {
      setError('请选择一个视频');
      return;
    }
    // 先 parse 再 toISOString：datetime-local 清空/非法时 new Date(...).toISOString() 会直接抛
    // RangeError（async 里变 unhandled rejection），校验必须放在前面。
    const happenedAtMs = Date.parse(happenedAt);
    if (Number.isNaN(happenedAtMs)) {
      setError('发生时间不合法');
      return;
    }
    const happenedAtIso = new Date(happenedAtMs).toISOString();
    setSubmitting(true);
    try {
      const mediaIds = type === 'text' ? [] : await uploadAll();
      await create.mutateAsync({
        type,
        content,
        happenedAt: happenedAtIso,
        happenedTzOffset: currentTzOffset(),
        isBackfill,
        mediaIds,
        tagIds: selectedTags,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发布失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const overall = useMemo(() => {
    if (items.length === 0) return null;
    const loaded = items.reduce((s, it) => s + it.loaded, 0);
    const total = items.reduce((s, it) => s + it.total, 0);
    return { loaded, total, pct: total === 0 ? 100 : Math.round((loaded / total) * 100) };
  }, [items]);

  if (chain && !canCompose) {
    return (
      <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        你的角色（{chain.myRole}）不能在此链发布。回 <Link to={`/chains/${chainId}`} className="underline">链详情</Link>。
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`flex-1 rounded px-3 py-1.5 text-sm ${
              type === t.value ? 'bg-gray-900 text-white' : 'text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={type === 'text' ? 5 : 3}
        placeholder={type === 'text' ? '记录这一刻…' : '配文（可选）'}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 focus:border-gray-900 focus:outline-none"
      />

      {type === 'media' && (
        <div>
          <div className="grid grid-cols-3 gap-1">
            {images.map((img, i) => (
              <div key={img.previewUrl} className="relative">
                <img src={img.previewUrl} alt="" className="aspect-square w-full rounded object-cover" />
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => {
                      URL.revokeObjectURL(prev[i]!.previewUrl); // 删除单张：即时释放
                      return prev.filter((_, idx) => idx !== i);
                    })
                  }
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
                  aria-label={`移除第 ${i + 1} 张`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {images.length < 9 && (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="aspect-square rounded border-2 border-dashed border-gray-300 text-sm text-gray-400"
              >
                添加图片
              </button>
            )}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickImages}
            className="hidden"
          />
          <p className="mt-1 text-xs text-gray-400">每张 ≤10MB，最多 9 张（{images.length}/9）</p>
        </div>
      )}

      {type === 'video' && (
        <div>
          {video ? (
            <div className="space-y-2">
              <video src={video.previewUrl} controls className="w-full rounded bg-black" />
              <p className="text-xs text-gray-500">
                {video.file.name} · {formatBytes(video.size)} · {video.durationSeconds} 秒
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(video.previewUrl); // 移除视频：即时释放
                    setVideo(null);
                  }}
                  className="ml-2 text-red-600 underline"
                >
                  移除
                </button>
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="w-full rounded border-2 border-dashed border-gray-300 py-8 text-sm text-gray-400"
            >
              选择视频（≤500MB、≤5 分钟）
            </button>
          )}
          <input ref={videoInputRef} type="file" accept="video/*" onChange={onPickVideo} className="hidden" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label htmlFor="happenedAt">发生时间</label>
        <input
          id="happenedAt"
          type="datetime-local"
          value={happenedAt}
          onChange={(e) => setHappenedAt(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isBackfill}
            onChange={(e) => setIsBackfill(e.target.checked)}
          />
          补发（不推送通知）
        </label>
      </div>

      {(tagList?.tags.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-3">
          <span className="text-sm text-gray-500">标签</span>
          {tagList!.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTag(t.id)}
              className={`rounded px-2 py-0.5 text-xs ${
                selectedTags.includes(t.id) ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600'
              }`}
            >
              #{t.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {items.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">
            上传进度 {overall!.pct}%（{formatBytes(overall!.loaded)} / {formatBytes(overall!.total)}）
          </p>
          {items.map((it, i) => (
            <div key={`${it.name}-${i}`}>
              <div className="flex justify-between text-xs text-gray-500">
                <span className="truncate">{it.name}</span>
                <span>{it.status === 'done' ? '完成' : `${Math.round((it.loaded / it.total) * 100)}%`}</span>
              </div>
              <div className="h-1.5 w-full rounded bg-gray-100">
                <div
                  className="h-1.5 rounded bg-gray-900 transition-all"
                  style={{ width: `${it.total === 0 ? 100 : Math.round((it.loaded / it.total) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? '发布中…' : '发布'}
        </button>
      </div>
    </form>
  );
}
```

`apps/web/src/App.tsx` 布局路由内追加（`/chains/:chainId` 之后）：
```tsx
        <Route path="/chains/:chainId/compose" element={<ComposePage />} />
```
并在顶部 import `ComposePage`。

- [ ] **Step 3: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿。

- [ ] **Step 4: 手动验证**

1. owner 进链详情 → 「发布时刻」→ composer 可用；viewer 直接访问 `/chains/:id/compose` → 显示角色拦截文案。
2. 类型切换：text 无媒体区；media 出现九宫格；video 出现选择框。
3. 图片：选 3 张 → 宫格预览、删除一张；选第 10 张被拒；超 10MB 文件被跳过并提示。
4. 视频：选 mp4 → 显示大小/时长；>5 分钟视频被拒。
5. happened_at 改成昨天、勾选补发、选 2 个 tag → 发布：进度条逐项走完（视频为 multipart，进度按分片累加）→ 跳回链时间线，新 moment 出现在正确位置（昨天的 happened_at 在当天记录之下；feed 切「添加时间」时置顶）。
6. 上传中断网（devtools offline）→ 显示错误，不产生 moment；恢复后重新发布成功。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 链内 composer（三类型/九宫格预览/视频限制/happened_at/补发/tag 选择/上传进度条）"
```

---

## 分组 E：互动 + 通知 + 邀请

### Task 9: moment 详情页（评论列表/发评论/删除自己评论 + 表情 reaction 选择与取消）

**Files:**
- Create: `apps/web/src/pages/MomentDetailPage.tsx`
- Modify: `apps/web/src/App.tsx`（布局路由内加 `/moments/:momentId`）

**Interfaces:**
- Consumes: `client.getMoment/listComments/createComment/deleteComment/setReaction/removeReaction`、`qk.moment/qk.comments/qk.feed/qk.chainMoments`、dto `REACTION_EMOJIS`（Phase 5 唯一常量来源，渲染全量 10 个）、`MomentCard`（详情头部复用）、`useAuth().user`（删除自己评论）。
- Produces: `/moments/:momentId` 页：MomentCard 展示 + emoji reaction 行（渲染 `REACTION_EMOJIS` 全量（10 个，禁止本地硬编码子集），显示各自 count、自己已选高亮——高亮判断用 `moment.myReaction === emoji`（Phase 5 的 `ReactionSummary` 无 `mine` 字段），点击未选=选择、点击已选=取消）+ 评论列表（`useInfiniteQuery`，`limit: 50` + 「加载更多」消费 `nextCursor`——服务端默认每页仅 20 条；作者/内容/时间，自己的评论可删）+ 发评论表单（`createCommentInputSchema` 校验 1–1000）。

- [ ] **Step 1: 实现**

`apps/web/src/pages/MomentDetailPage.tsx`：
```tsx
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import { REACTION_EMOJIS, createCommentInputSchema, type MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { MomentCard } from '@/components/MomentCard';
import { formatHappenedAt } from '@/lib/time';

export function MomentDetailPage() {
  const { momentId } = useParams<{ momentId: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: moment, isPending, isError, error } = useQuery({
    queryKey: qk.moment(momentId ?? ''),
    queryFn: () => client.getMoment(momentId!),
    enabled: momentId !== undefined,
  });
  // 评论分页：服务端默认每页仅 20 条，limit: 50 + 「加载更多」消费 nextCursor
  const commentsQuery = useInfiniteQuery({
    queryKey: qk.comments(momentId ?? ''),
    queryFn: ({ pageParam }) =>
      client.listComments(momentId!, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: momentId !== undefined,
  });
  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments) ?? [];

  /** reaction/评论变化后同步详情缓存与列表（feed/链时间线的计数经 invalidate 刷新） */
  const touchLists = (chainId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId) });
  };

  const react = useMutation({
    mutationFn: (v: { emoji?: string }) =>
      v.emoji ? client.setReaction(momentId!, v.emoji) : client.removeReaction(momentId!),
    // Phase 5：reaction PUT/DELETE 均 204 空 body，拿不到更新后的 MomentResponse——
    // invalidate 后重新 GET（myReaction/reactions/commentCount 随之刷新）。
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.moment(momentId!) });
      if (moment) touchLists(moment.chainId);
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '操作失败'),
  });

  const addComment = useMutation({
    mutationFn: (text: string) => client.createComment(momentId!, text),
    onSuccess: () => {
      setContent('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId!) });
      if (moment) {
        // 函数式更新：按缓存现值递增，不用闭包里的 moment 快照全量覆盖
        // （快照可能因 reaction 并发 invalidate 已过期，展开覆盖会回退其他字段）。
        queryClient.setQueryData<MomentResponse | undefined>(qk.moment(moment.id), (prev) =>
          prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev
        );
        touchLists(moment.chainId);
      }
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '评论失败'),
  });

  const removeComment = useMutation({
    mutationFn: (commentId: string) => client.deleteComment(commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId!) });
      if (moment) {
        // 同 addComment：函数式按缓存现值递减（不展开闭包快照）。
        queryClient.setQueryData<MomentResponse | undefined>(qk.moment(moment.id), (prev) =>
          prev ? { ...prev, commentCount: Math.max(0, prev.commentCount - 1) } : prev
        );
        touchLists(moment.chainId);
      }
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '删除失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createCommentInputSchema.safeParse({ content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '评论内容不合法');
      return;
    }
    await addComment.mutateAsync(parsed.data.content).catch(() => undefined);
  }

  if (isPending) return <p className="py-10 text-center text-gray-400">加载中…</p>;
  if (isError || !moment) {
    return (
      <div className="space-y-3">
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '不存在或无权访问'}（软删 moment 返回 410）
        </p>
        <Link to="/" className="text-sm text-gray-600 underline">回 feed</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MomentCard moment={moment} />

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {REACTION_EMOJIS.map((emoji) => {
            const summary = moment.reactions.find((r) => r.emoji === emoji);
            const mine = moment.myReaction === emoji; // Phase 5：无 ReactionSummary.mine，用 MomentResponse.myReaction
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => (mine ? react.mutate({}) : react.mutate({ emoji }))}
                className={`rounded-full border px-2.5 py-1 text-sm ${
                  mine ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700'
                }`}
              >
                {emoji} {summary?.count ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium">评论（{moment.commentCount}）</h2>
        {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <ul className="divide-y divide-gray-100">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-2 text-sm">
              <span className="font-medium">{c.author.nickname}</span>
              <span className="flex-1 whitespace-pre-wrap">{c.content}</span>
              <span className="text-xs text-gray-400">{formatHappenedAt(c.createdAt, 0).slice(0, 16)}</span>
              {c.author.id === user?.id && (
                <button
                  type="button"
                  onClick={() => removeComment.mutate(c.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除
                </button>
              )}
            </li>
          ))}
          {comments.length === 0 && <li className="py-2 text-sm text-gray-400">还没有评论</li>}
        </ul>
        {commentsQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => void commentsQuery.fetchNextPage()}
            disabled={commentsQuery.isFetchingNextPage}
            className="mt-2 w-full rounded border border-gray-200 py-1.5 text-xs text-gray-500 disabled:opacity-50"
          >
            {commentsQuery.isFetchingNextPage ? '加载中…' : '加载更多评论'}
          </button>
        )}
        <form onSubmit={onSubmit} className="mt-3 flex gap-2" noValidate>
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写评论…"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={addComment.isPending}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
```

`apps/web/src/App.tsx` 布局路由内追加：
```tsx
        <Route path="/moments/:momentId" element={<MomentDetailPage />} />
```
并在顶部 import `MomentDetailPage`。

- [ ] **Step 2: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿。

- [ ] **Step 3: 手动验证**

1. feed 点「详情」→ 详情页完整展示（复用 MomentCard）。
2. 点 ❤️ → 计数 +1 且按钮高亮；再点 ❤️ → 取消（计数 -1、高亮消失）；换点 👍 → 只剩 👍 高亮（upsert 语义）。
3. 发评论「好看」→ 列表出现、评论数 +1；feed 里该卡片评论数同步刷新（invalidate `['feed']`）。
4. 删除自己的评论 → 消失、计数 -1；别人的评论无删除按钮。
5. 空评论提交 → zod 错误；用另一账号看同一 moment → reaction 的 `myReaction` 高亮状态互不影响。

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): moment 详情页（评论与表情 reaction）"
```

---

### Task 10: 通知页（未读标记 + 全部已读）+ 邀请接受页（未登录先跳登录再回来）

**Files:**
- Create: `apps/web/src/pages/NotificationsPage.tsx`、`apps/web/src/pages/AcceptInvitePage.tsx`
- Modify: `apps/web/src/App.tsx`（**布局路由外**加 `/invites/:token`，布局路由内加 `/notifications`）

**Interfaces:**
- Consumes: `client.listNotifications/markNotificationsRead/acceptInvite`、`qk.notifications`、`RequireAuth`（通知页在受保护布局内）、`useAuth().user`（邀请页判断登录态）。
- Produces:
  - `/notifications`：通知列表（`useInfiniteQuery`，`limit: 50` + 「加载更多」消费 `nextCursor`；未读蓝点 + type 中文标签 + payload 标题快照 + 时间）；「全部已读」按钮（**循环翻页收集全部未读** id 再分批 ≤100 提交——只读第一页会漏掉第 21 条起的通知且 badge 清不零，见依赖契约段）；单条点击标记已读；已读后 AppShell badge 归零。
  - `/invites/:token`（公开路由）：未登录 → `Navigate` 到 `/login` 且 `state.from = /invites/:token`（登录成功自动回来）；已登录 → 「接受邀请」按钮 → `acceptInvite(token)` 成功跳 `/chains/:chainId`、invalidate `qk.chains`；`INVITE_EXPIRED/INVITE_ALREADY_ACCEPTED/INVITE_EMAIL_MISMATCH` 等服务端错误原样展示；`alreadyMember: true` 也直接跳链。

- [ ] **Step 1: 通知页**

`apps/web/src/pages/NotificationsPage.tsx`：
```tsx
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};
function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
/** payload 是通知快照（spec §3：含资源标题快照），字段按 type 而异，防御性取 title/momentContent/chainName。 */
function payloadTitle(payload: Record<string, unknown>): string {
  for (const key of ['title', 'momentContent', 'content', 'chainName']) {
    const v = payload[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  // 服务端默认每页仅 20 条：limit: 50 + 「加载更多」消费 nextCursor（依赖契约段）
  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.notifications(false),
    queryFn: ({ pageParam }) => client.listNotifications(undefined, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = data?.pages.flatMap((p) => p.notifications) ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markOne = useMutation({
    mutationFn: (id: string) => client.markNotificationsRead([id]),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    // Phase 5 schema 要求 ids 必填 1–100 个 uuid（无「空 = 全部已读」语义），且服务端每页最多 50 条：
    // 先循环翻页（limit=50 逐页取 nextCursor）收集**全部**未读 id——只读已加载页会漏掉未加载分页里的未读，
    // badge 清不零——再分批（每批 ≤100）串行提交。
    mutationFn: async () => {
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
    },
    onSuccess: invalidate,
  });
  const unreadCount = items.filter((n) => n.readAt === null).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <h1 className="text-lg font-bold">通知</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="ml-auto rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 disabled:opacity-50"
          >
            全部已读（{unreadCount}）
          </button>
        )}
      </div>
      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {items.map((n: NotificationDto) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => n.readAt === null && markOne.mutate(n.id)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${n.readAt === null ? 'bg-blue-500' : 'bg-transparent'}`} />
              <span className="font-medium">{typeLabel(n.type)}</span>
              <span className="flex-1 truncate text-gray-600">{payloadTitle(n.payload)}</span>
              <span className="shrink-0 text-xs text-gray-400">{n.createdAt.slice(0, 16).replace('T', ' ')}</span>
            </button>
          </li>
        ))}
        {!isPending && items.length === 0 && <li className="px-4 py-8 text-center text-gray-400">暂无通知</li>}
      </ul>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full rounded border border-gray-200 bg-white py-2 text-sm text-gray-500 disabled:opacity-50"
        >
          {isFetchingNextPage ? '加载中…' : '加载更多通知'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 邀请接受页**

`apps/web/src/pages/AcceptInvitePage.tsx`：
```tsx
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => client.acceptInvite(token!),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: qk.chains });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      navigate(`/chains/${res.chainId}`, { replace: true });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '接受邀请失败'),
  });

  // 未登录：先去登录，带上回跳地址（LoginPage 的 state.from 逻辑，Task 4 已实现）
  if (!user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 text-center">
      <h1 className="mb-2 text-xl font-bold">加入时光链</h1>
      <p className="mb-6 text-sm text-gray-500">你被邀请加入一条时光链，与家人朋友共同记录时刻。</p>
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={() => accept.mutate()}
        disabled={accept.isPending}
        className="w-full rounded bg-gray-900 py-2 text-white disabled:opacity-50"
      >
        {accept.isPending ? '加入中…' : '接受邀请'}
      </button>
    </div>
  );
}
```

`apps/web/src/App.tsx` 两处追加：
1. `/register` 路由之后（布局路由**外**）：
```tsx
      <Route path="/invites/:token" element={<AcceptInvitePage />} />
```
2. 布局路由内：
```tsx
        <Route path="/notifications" element={<NotificationsPage />} />
```
顶部 import 两个页面。

- [ ] **Step 3: 静态验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 三绿。

- [ ] **Step 4: 手动验证**

1. 用 A 在链里发 moment、用 B 评论 A 的 moment → A 的导航 badge 出现数字（≤30s 轮询）。
2. `/notifications`：未读蓝点可见；点单条 → 蓝点消失；「全部已读」→ badge 归零。
3. B（editor）对 A 私链生成邀请 → 复制链接 → 未登录新浏览器窗口打开 `/invites/<token>` → 被重定向到 `/login`，注册新用户 C → 自动回到邀请页 → 点「接受邀请」→ 跳进链详情（角色 editor）。
4. 过期/已吊销邀请打开 → 展示服务端错误码 message（如「邀请已过期」），不跳转。
5. 已是成员的用户再开同一邀请链接 → `alreadyMember` 路径直接跳链详情。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 通知页（未读标记/全部已读）与邀请接受页（登录回跳）"
```

---

### Task 11: 全量验证与 DoD

**Files:**
- 无新增文件；验证-only。

**Interfaces:**
- Consumes: Task 1–10 全部产物。
- Produces: Phase 6 DoD 达成确认（Phase 7 app 端将直接消费 `@moment/api-client` 的 `createMomentClient/TokenStore/ApiError/uploadMedia`）。

- [ ] **Step 1: 全量构建与测试**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test && pnpm --filter @moment/web typecheck`
Expected: turbo 全链路绿（dto/server/api-client build+lint+test，web build+lint+typecheck）。

- [ ] **Step 2: 手动验收清单（逐页可执行；前置：`docker compose up -d mysql`（如用本地库）+ server dev + web dev + S3 桶 CORS 已按 Global Constraints 媒体条目配置（`AllowedMethods: GET, PUT`、`AllowedOrigins: web origin`、`ExposeHeaders: ETag`——未配置时媒体读取 302 后跨域 `blob()` 抛 TypeError 被静默占位、视频分片上传读不到 ETag → `ETAG_MISSING`，全部失败；Phase 8 加固时复核），注册两个账号 A（owner）/B（editor））**

1. **注册/登录（/register、/login）**：A 空表单提交见字段错误；注册成功进 `/`；退出后登录回来；未登录访问 `/chains` 被踢到 `/login` 且登录后回跳。
2. **建链（/chains）**：A 创建「宝宝成长」；创建第二条「家庭日常」；空名被拒。
3. **邀请闭环（/chains/:id → 邀请 tab）**：A 生成 editor 邀请 → 复制链接 → B 登录态打开 → 接受 → B 的 `/chains` 出现该链（editor 徽章）。
4. **发布（/chains/:id/compose）**：A 依次发布——纯文字；3 图宫格（上传进度条走完）；一个短视频；昨天时间的补发 + tag「周岁」。B（editor）也能发布；给 B 降级 viewer 后 B 的 composer 显示角色拦截。
5. **feed（/）**：默认按事件时间倒序；链 chips 过滤单链；tag chips 过滤；切「添加时间」→ 补发的那条置顶；造 25+ 条后滚动无限加载。
6. **链时间线（/chains/:id）**：与 feed 同数据、只含本链；「发布时刻」按钮仅 owner/editor 可见。
7. **成员管理**：A 改 B 角色、移除 B 再重新邀请；owner 点自己无退出按钮；A 把 owner 转让给 B 后 A 变 editor（管理控件消失）。
8. **详情互动（/moments/:id）**：B 对 A 的 moment 点 ❤️ 再取消再换 👍；B 发/删自己的评论；评论数与 reactions 摘要在 feed 卡片同步。
9. **通知（/notifications）**：B 评论/点表情后 A 的 badge +1；单条已读、全部已读生效；`is_backfill` 的发布不产生通知（Phase 5 语义）。
10. **错误透传**：停掉 server 再操作 → 网络错误提示；错误码 message 为服务端文案（如 `CHAIN_ROLE_INSUFFICIENT` 对应 message）。
11. **token 轮换**：devtools 里手动把 localStorage `moment.auth.tokens` 的 accessToken 改坏 → 任意页面刷新后请求自动 refresh 成功（无感）；把 refreshToken 也改坏 → refresh 失败 → `tokenStore.clear()` 派发 `moment:auth-cleared` → AuthProvider `setUser(null)` + 清空 query 缓存 → RequireAuth 踢到 /login（不刷新页面也应立即发生）。

- [ ] **Step 3: 收尾 Commit（如有 lint/格式修复）**

```bash
git add -A && git commit -m "chore(web): phase 6 全量验证收尾"
```
（无改动则跳过。）

---

## 完成标准（Phase 6 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿；`pnpm --filter @moment/web typecheck` 绿。
- `@moment/api-client`：http 单测覆盖 refresh 单飞/重放一次/失败 clear/错误透传/204/网络错误；client 路由与 Phase 1–5 路由总表逐字对齐（client.test 断言全部 method+path）；upload 测试覆盖直传/分片串行/每片重试/进度回调/本地大小预校验/ETag 缺失（ETAG_MISSING）立即失败不重试。方法名与组件调用处一致（Task 5–10 全部经 `client.*`）。
- `apps/web`：无任何组件裸 fetch（`grep -rn "fetch(" apps/web/src` 只应命中 0 处）；全部 API 调用经 `client`；服务端状态全部 TanStack Query（mutation 后经 `qk` 精确 invalidate）；本地状态仅 AuthContext。
- 手动验收清单 11 组全部通过（Step 2）。
- 媒体上传进度不被挡死：图片 XHR 单 PUT 进度、视频分片累加进度，均有 UI 进度条（spec §2 原文要求）。
- 本计划未改动 server / dto 任何文件；Phase 5 契约段的差异按「等价映射不改 server」原则处理并在执行记录中注明。
- **Out of scope（显式声明）**：moment 编辑/删除的 Web UI 不在本阶段（api-client 已提供 `updateMoment/deleteMoment`，UI 归 Phase 7/8 或 backlog）。
- **遗留备注（建议回头修 Phase 4 计划）**：Phase 4 只把 `GET /api/chains/:chainId/moments` 的 service 返回对齐为 `{moments, nextCursor}`，未同步修 dto 的 `MomentListResponse` 接口（仍是 Phase 3 的 `items` 键）。本计划在 api-client 内用 `Pick<FeedResponse, 'moments' | 'nextCursor'>` 规避；建议给 Phase 4 计划补一条 dto 接口修正，消除双形状。执行 Phase 6 时若 Phase 4 的 dto 接口已被执行者修成 `moments` 键，可直接 import `MomentListResponse`，否则沿用 `Pick<FeedResponse, 'moments' | 'nextCursor'>`。

---
