# Phase 7: 移动 App（apps/app：Expo RN 全功能 + 分片上传 + Expo Push）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `apps/app`（@moment/app）：Expo + expo-router + TanStack Query 的 React Native App，页面镜像 web（登录/注册、feed 无限滚动 + 链/tag 过滤 + 排序切换、链列表/链详情（时间线/成员/邀请/tag）、发布 composer（三类型、多选图压缩 ≤2048px、视频 ≤500MB/≤5min 预校验、happened_at 选择、补发 is_backfill 自动标记（选过去时间自动置位，无手动开关）、tag）、moment 详情（评论/表情）、通知列表、邀请接受深链接），上传复用 `@moment/api-client` 的 multipart helper（分片串行 + 每片重试 + 进度），推送用 expo-notifications 注册 Expo Push token 到 `POST /api/devices/push-token`，通知点击深跳 moment 详情。本计划不改 server / dto 已交付代码；对 api-client 有一处**已声明的最小契约消费**（`UploadMediaInput` 的可选 `fileUri` 形态 + `PutFn` body 联合 `FilePart`，见 Global Constraints——该扩展已在 Phase 6 计划同步落地，Phase 6 实现时一并交付，本计划仍零改动 api-client 仓库代码）。

**Architecture:** 单一 Expo 应用包，数据层完全复用 `@moment/api-client`（`createMomentClient` + `TokenStore` 接口；组件里禁止裸 fetch）。token 持久化用 `expo-secure-store` 实现 api-client 的 `TokenStore` 接口；直传 PUT 用自写 RN 版 `rnPut`（`PutFn` 实现）：图片等已入内存的小 Blob 直接 XHR 发送；视频走 api-client 的 `fileUri` 形态，`rnPut` 收到 `FilePart` 后用 `expo-file-system` 新 `File` API 按 `[start, end)` 区间从文件读盘再 PUT，**视频整文件不读入内存**（spec §5.5 上限 500MB，RN 进程装不下）。API 地址来自 `app.config.ts` 的 `extra.apiUrl`（构建期由 `EXPO_PUBLIC_API_URL` 环境变量注入，eas.json 三 profile 各自指定；模拟器默认 `http://localhost:3000`，Android 模拟器需 `http://10.0.2.2:3000`，真机 dev 用局域网 IP）。导航为 expo-router 文件路由：根 `_layout`（QueryProvider + AuthProvider + 通知监听）→ `(tabs)`（feed/链/通知三 tab）+ 顶层页面（login/register/compose/chains/[id]/moments/[id]/invites/[token]），受保护页面统一 `RequireAuth` 包装。服务端状态全部 TanStack Query，mutation 后按 query key 精确 invalidate。

**Tech Stack:** Expo SDK 54（`expo ~54.0.0`，React Native 0.81，React 19.1，Metro 内置）+ expo-router v6 + `@tanstack/react-query` ^5 + `@shopify/flash-list` ^2（feed 列表；v2 已自动估算条目高度，代码中传入的 `estimatedItemSize` 仅为兼容保留、不构成正确性依赖）+ `@moment/api-client` / `@moment/dto`（workspace）+ expo-secure-store / expo-image-picker / expo-image-manipulator / expo-notifications / expo-device / expo-video / expo-constants / expo-linking / expo-file-system / `@react-native-community/datetimepicker`。TS：`moduleResolution: bundler` + `jsx: react-jsx`（Metro 打包，不经 tsc 产物）；lint 复用 `@moment/eslint-config`。验证 = typecheck + lint + `expo export`（Task 1 建好脚本）+ 真机/模拟器手动验收（Task 7 DoD）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§2 App 选型与 monorepo 结构、§4 API、§5.5 客户端压缩与上传管线、§5.6 时区与补发、§6 安全「App 安全存储」）；`docs/superpowers/plans/CONVENTIONS.md` §3.4（媒体稳定入口）/ §3.6（路由总表，本计划零新增路由）/ §4（web/app 只做 typecheck + build + lint + 手动验收）。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- 假设 Phase 1–6 已全部执行完毕。直接消费的契约（不得改名）：`@moment/api-client` 的 `createMomentClient(options: MomentClientOptions): MomentClient`、`MomentClientOptions = { baseUrl; tokenStore: TokenStore; fetchImpl?; putWithProgress?: PutFn }`、`ApiError { status; code; details? }`、`client.uploadMedia(input: UploadMediaInput)`（分片串行 + 每片重试 ≤3 + `onProgress(loaded,total)` + 本地 `MEDIA_TOO_LARGE` 413 预校验）、`client.mediaUrl(mediaId)`、`xhrPut`；`UploadMediaInput` 支持 `{ file: Blob, ... }` 与 `{ fileUri: string, size, ... }` 两种形态（二选一，`fileUri` 形态下 `PutFn` 收到 `FilePart = { fileUri; start; end; size; mime }` 由注入的 put 按区间读盘，**整文件不进内存**——Phase 7 评审引入的最小契约扩展，已在 Phase 6 计划的 `types.ts`/`upload.ts` 同步落地）；`@moment/dto` 的 `MomentResponse`（含 `tags: TagBrief[]`、`commentCount: number`、`reactions: ReactionSummary[]`、**`myReaction: string | null`**——「我的表情」高亮唯一来源，`ReactionSummary = { emoji, count }` **无 `mine` 字段**，禁止读 `r.mine`）、`MomentMedia`、`ReactionSummary`、`REACTION_EMOJIS`、`NotificationDto`（`payload.title/body/data.momentId`，Phase 5 worker 快照契约）、`CommentListResponse = { comments, nextCursor }` / `NotificationListResponse = { notifications, nextCursor }`（两个列表端点都返回该形状，**不是裸数组**；服务端默认每页 20 条，页面消费一律 `limit: 50` + useInfiniteQuery/加载更多消费 `nextCursor`，与 Phase 6 跨端约定一致）、`MAX_IMAGE_BYTES/MAX_VIDEO_BYTES/VIDEO_PART_SIZE/MAX_VIDEO_DURATION_SECONDS`、`AuthTokens/UserProfile/AuthResponse/ChainDto/ChainMemberDto/InviteDto/AcceptInviteResponse/TagResponse/CommentDto/FeedQuery` 等。媒体大小/时长/分片常量唯一来源是 `@moment/dto`，App 内禁止复制数字。
- **深链接 scheme：`moment`**。邀请链接格式 `moment://invites/<token>`（app/invites/[token].tsx）。注意 expo-router 解析 custom scheme 时 `scheme://` 后的 host+path 整体映射为路由路径，即 `moment://invites/<token>` → `/invites/<token>`——**页面目录必须与之逐字一致**（复数 `invites`）；通知点击跳 `/moments/<momentId>`（payload.data.momentId，Phase 5 契约 `data: { momentId, chainId }`）。
- 媒体展示一律 `client.mediaUrl(mediaId)`（`{apiUrl}/api/media/:id` 绝对 URL，跟随 302 预签名；CONVENTIONS §3.4 禁止内嵌预签名 URL）。
- 上传幂等：服务端 `complete` 幂等（Phase 3 契约），客户端对整个 `uploadMedia` 做 ≤2 次重试（网络类失败）——重试会重新 presign 得到新 mediaId，旧 mediaId 残留为 `uploading` 行由 Phase 8 sweeper 清理，不阻塞本计划；用户取消/超过重试即报错，不静默。
- 视频预校验（spec §5.5）：`fileSize > MAX_VIDEO_BYTES` 或 `duration > MAX_VIDEO_DURATION_SECONDS` 时**不上传**，Alert 提示「请先在系统相册压缩/裁剪后重选」；图片经 expo-image-manipulator 压到最长边 ≤2048px、JPEG 0.85，压缩后仍 > `MAX_IMAGE_BYTES` 才拒绝。
- 服务端状态全部 TanStack Query；query key 常量集中在 `src/lib/keys.ts`；本地状态只用 React state/context（auth 一个 context），不引入 redux/zustand。表单校验复用 `@moment/dto` 的 zod schema（`registerInputSchema/loginInputSchema/createChainInputSchema`）在提交前 `safeParse`。
- 包配置：`"main": "expo-router/entry"`；`metro.config.js` 必须 `unstable_enablePackageExports = true`（api-client/dto 是 exports 指向 ESM dist 的包，无此开关 Metro 解析不到）；`app.config.ts` 只此一份（不再建 app.json），`extra.apiUrl` 在运行期经 `expo-constants` 读取。
- 环境切换：`extra.apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'`。本地 `npx expo start` 前可 `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000` 覆盖；EAS 构建由 eas.json 各 profile 的 `env.EXPO_PUBLIC_API_URL` 注入（development=开发机地址、preview/production=线上 API 域名，构建前按实际部署回填）。模拟器：iOS 用 `http://localhost:3000`，Android 模拟器用 `http://10.0.2.2:3000`；真机 dev 用局域网 IP。
- 验证命令（每 Task 运行）：`pnpm --filter @moment/app typecheck`、`pnpm --filter @moment/app lint`、`pnpm --filter @moment/app export:check`（`expo export --platform ios`，验证 Metro bundle 可产出）；无组件自动化测试（CONVENTIONS §4）。手动验收集中在 Task 7 DoD。
- commit 约定：`feat(app): ...`，每 Task 一个。

---

### Task 1: apps/app 包骨架（Expo + expo-router + api-client 接线 + eas 三 profile）

**Files:**
- Create: `apps/app/package.json`、`apps/app/tsconfig.json`、`apps/app/eslint.config.js`、`apps/app/metro.config.js`、`apps/app/app.config.ts`、`apps/app/eas.json`、`apps/app/.gitignore`
- Create: 仓库根 `.npmrc`（pnpm hoisted 布局，Expo/Metro 前置条件，见 Step 1 说明）
- Create: `apps/app/src/lib/token-store.ts`、`apps/app/src/lib/api.ts`、`apps/app/src/lib/query.ts`、`apps/app/src/lib/keys.ts`、`apps/app/src/lib/format.ts`
- Create: `apps/app/app/_layout.tsx`（最小版：QueryProvider + Stack，Task 2 扩 AuthProvider）、`apps/app/app/index.tsx`（**临时骨架占位页**，Task 3 创建 `(tabs)/index.tsx` 时删除——见该 Task Files 清单）

**Interfaces:**
- Consumes: `@moment/api-client` 的 `createMomentClient/TokenStore/xhrPut/ApiError`；`@moment/dto` 的 `AuthTokens/UserProfile`。
- Produces（后续 Task 依赖，不得改名）:
  - `client: MomentClient`、`apiUrl: string`（`src/lib/api.ts`）
  - `secureTokenStore: TokenStore`、`loadUser()/saveUser(user)`（`src/lib/token-store.ts`，SecureStore keys `moment.auth.tokens` / `moment.auth.user`；清空走 `secureTokenStore.clear()`）
  - `queryClient`（`src/lib/query.ts`）
  - `qk`（`src/lib/keys.ts`，query key 工厂：`qk.feed(filters)/qk.feedAll()/qk.chains/qk.chain(id)/qk.chainMoments(id)/qk.members(id)/qk.invites(id)/qk.tags(id)/qk.moment(id)/qk.comments(id)/qk.notifications()`）
  - `formatMomentTime(iso, tzOffsetMinutes)`、`formatRelative(iso)`（`src/lib/format.ts`）
  - 根布局：`QueryClientProvider` + `StatusBar` + Stack（后续 Task 在此文件上增量扩展）

- [ ] **Step 1: 包与工程配置**

`apps/app/package.json`：
```json
{
  "name": "@moment/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit",
    "lint": "eslint app/ src/",
    "export:check": "expo export --platform ios --output-dir dist-check",
    "clean": "rm -rf dist-check"
  },
  "dependencies": {
    "@moment/api-client": "workspace:*",
    "@moment/dto": "workspace:*",
    "@react-native-community/datetimepicker": "8.4.4",
    "@shopify/flash-list": "2.0.4",
    "@tanstack/react-query": "^5.66.0",
    "expo": "~54.0.0",
    "expo-constants": "~18.0.5",
    "expo-device": "~8.0.5",
    "expo-file-system": "~19.0.5",
    "expo-image-manipulator": "~14.0.5",
    "expo-image-picker": "~17.0.5",
    "expo-linking": "~8.0.5",
    "expo-notifications": "~0.32.5",
    "expo-router": "~6.0.4",
    "expo-secure-store": "~15.0.5",
    "expo-status-bar": "~3.0.8",
    "expo-video": "~3.0.5",
    "react": "19.1.0",
    "react-native": "0.81.4",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0"
  },
  "devDependencies": {
    "@moment/eslint-config": "workspace:*",
    "@moment/typescript-config": "workspace:*",
    "@types/react": "~19.1.0",
    "typescript": "^5.7.3"
  }
}
```

`apps/app/tsconfig.json`（Metro/bundler 解析，不产 tsc 产物；`build`/`typecheck` 都只做 `--noEmit` 检查，turbo `build` 仍满足 `dependsOn: ["^build"]` 的包序）：
```json
{
  "extends": "@moment/typescript-config/base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "declaration": false,
    "types": [],
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["app.config.ts", "expo-env.d.ts", "app/**/*.ts", "app/**/*.tsx", "src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist-check"]
}
```

（include 必须显式列 `"app.config.ts"`：根级文件不被 `app/**/*.ts` 匹配，否则 typecheck 对它是盲区。`expo-env.d.ts` 由 `expo start` 首次运行自动生成（`/// <reference types="expo/types" />`），为 `app.config.ts` 里的 `process.env` 提供 ambient 类型；两文件都需在 include 内 typecheck 才能过。）
```js
export { default } from '@moment/eslint-config';
```

`apps/app/metro.config.js`（CommonJS——Metro 配置不走 bundler 编译）：
```js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// api-client / dto 是 exports 指向 ESM dist 的包，必须开启 package exports 解析
config.resolver.unstable_enablePackageExports = true;
module.exports = config;
```

仓库根 `.npmrc`（**pnpm 布局前置条件**：Expo/RN/Metro 对 pnpm 默认 symlink `node_modules` 布局兼容性差，常见 duplicate React / 模块解析失败，Expo 官方 monorepo 指南要求 hoisted 布局；对 dto/server/api-client 等 TS 包无影响）：
```
node-linker=hoisted
```

`apps/app/app.config.ts`：
```ts
import type { ExpoConfig } from 'expo/config';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const config: ExpoConfig = {
  name: '时刻',
  slug: 'moment',
  scheme: 'moment',
  version: '0.1.0',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'com.moment.app', supportsTablet: false },
  android: { package: 'com.moment.app' },
  plugins: ['expo-router', 'expo-secure-store', 'expo-notifications'],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? null },
  },
};

export default config;
```

（`EAS_PROJECT_ID` 在首次 `npx eas init` 后回填进 EAS 项目的环境变量或直接替换该处字符串；不影响本地 export:check。回退值用 `null` 而非 `''`——空串会被 `getExpoPushTokenAsync` 当作有效 projectId 传入而抛错，push 侧以 `Constants.easConfig?.projectId` 缺失即跳过（Task 2）。）

`apps/app/eas.json`：
```json
{
  "cli": { "version": ">= 13.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "http://192.168.1.5:3000" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "https://api.example.com" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://api.example.com" }
    }
  },
  "submit": { "production": {} }
}
```

（环境切换说明：`development` 真机联调把 `EXPO_PUBLIC_API_URL` 改成开发机局域网 IP 且 server 监听 `0.0.0.0`；iOS 模拟器无需 EAS，`npx expo start --ios` 默认 `http://localhost:3000`；Android 模拟器 `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo start --android`；`preview`/`production` 在部署 API 域名确定后替换 `api.example.com`。）

`apps/app/.gitignore`：
```
node_modules/
.expo/
dist/
dist-check/
*.orig.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision
.env
.env.*
```

- [ ] **Step 2: token store / api client / query / keys / format**

`apps/app/src/lib/token-store.ts`：
```ts
import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, UserProfile } from '@moment/dto';
import type { TokenStore } from '@moment/api-client';

const TOKENS_KEY = 'moment.auth.tokens';
const USER_KEY = 'moment.auth.user';

async function readTokens(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

/** api-client TokenStore 接口的 SecureStore 实现（spec §6「App 安全存储」）。 */
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
  },
};

export async function loadUser(): Promise<UserProfile | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function saveUser(user: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}
```

`apps/app/src/lib/api.ts`：
```ts
import Constants from 'expo-constants';
import { createMomentClient, xhrPut, type MomentClient } from '@moment/api-client';
import { secureTokenStore } from './token-store';

export const apiUrl =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000';

/**
 * 直传 PUT 本 Task 先用 api-client 的 xhrPut（RN 自带 XMLHttpRequest，支持 upload.onprogress 与
 * Blob body——此时只有小 Blob 场景）。Task 5 交付 RN 版 rnPut 后切换：视频走 fileUri 形态按片读盘，
 * 整文件不进内存。
 */
export const client: MomentClient = createMomentClient({
  baseUrl: apiUrl,
  tokenStore: secureTokenStore,
  putWithProgress: xhrPut,
});
```

`apps/app/src/lib/query.ts`：
```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
```

`apps/app/src/lib/keys.ts`：
```ts
import type { FeedQuery } from '@moment/api-client';

/** query key 工厂：全部页面经 qk.* 取 key，invalidate 一处可追。 */
export const qk = {
  feed: (filters: Pick<FeedQuery, 'chainIds' | 'tagId' | 'order'>) => ['feed', filters] as const,
  /** feed 前缀 key（发布/互动后失效全部过滤组合），禁止在页面里裸写 ['feed'] 字面量 */
  feedAll: () => ['feed'] as const,
  chains: () => ['chains'] as const,
  chain: (chainId: string) => ['chain', chainId] as const,
  chainMoments: (chainId: string) => ['chainMoments', chainId] as const,
  members: (chainId: string) => ['members', chainId] as const,
  invites: (chainId: string) => ['invites', chainId] as const,
  tags: (chainId: string) => ['tags', chainId] as const,
  moment: (momentId: string) => ['moment', momentId] as const,
  comments: (momentId: string) => ['comments', momentId] as const,
  notifications: () => ['notifications'] as const,
};
```

`apps/app/src/lib/format.ts`：
```ts
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** happened_at 按记录时的时区偏移展示（spec §5.6：存 UTC，展示用提交方时区）。
 *  与 Phase 6 web 版 formatHappenedAt 同构：shifted 的 UTC 字段才是提交者墙钟，
 *  必须用 getUTC* 取值——用本地 getter 会在非 UTC 设备上再叠加设备时区偏移。 */
export function formatMomentTime(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** 相对时间（通知/评论列表用，设备本地时区）。 */
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

- [ ] **Step 3: 最小根布局与入口页**

`apps/app/app/_layout.tsx`（Task 2/6 在此文件增量扩展，本 Task 先交付可运行最小版）：
```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/query';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack>
    </QueryClientProvider>
  );
}
```

`apps/app/app/index.tsx`（临时骨架占位页，Task 3 删除）：
```tsx
import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    // 骨架阶段一律先落 /login：(tabs)/index 尚未创建，'/' 此阶段没有主界面可去。
    // Task 3 创建 (tabs)/index.tsx 时删除本文件——两文件同解析为 '/' 会触发 expo-router
    // 路由冲突；且此处若 replace('/') 会自指 no-op，卡死在「加载中…」闪屏。
    router.replace('/login');
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.hint}>加载中…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { color: '#666', fontSize: 14 },
});
```

- [ ] **Step 4: 安装并验证**

Run: `pnpm install && pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: typecheck/lint 0 error；`expo export` 产出 `dist-check/`（iOS bundle + assets）；终端提示 export 成功。

**硬验收（pnpm 布局冒烟，不得跳过）**：`pnpm --filter @moment/app ios` 启动 iOS 模拟器，App 应正常起包并显示「加载中…」后跳转 `/login`（此时仅骨架页）。`expo export` 与模拟器冒烟共同验证 hoisted 布局下 Metro 可解析全部依赖；若出现 duplicate React / 模块解析失败，按 Expo 官方 monorepo 指南在 `metro.config.js` 补 `watchFolders`（monorepo 根）与 `nodeModulesPaths` 后复验。（`expo start --ios` 是常驻 dev server，不会自然结束：人工确认起包与跳转正常后 Ctrl-C 退出，再继续后续步骤。）

- [ ] **Step 5: Commit**

```bash
git add apps/app .npmrc
git commit -m "feat(app): Expo 骨架（expo-router/SecureStore tokenStore/api-client 接线/eas 三 profile/pnpm hoisted 布局）"
```

---

### Task 2: 认证（auth context + 登录/注册页 + 登录保护）

**Files:**
- Create: `apps/app/src/lib/auth.tsx`、`apps/app/src/lib/push.ts`、`apps/app/src/components/Field.tsx`、`apps/app/src/components/ErrorText.tsx`、`apps/app/src/components/Screen.tsx`
- Create: `apps/app/app/login.tsx`、`apps/app/app/register.tsx`
- Modify: `apps/app/app/_layout.tsx`（接 AuthProvider）

**Interfaces:**
- Consumes: `client.login/register/me/logout`、`registerInputSchema/loginInputSchema`（dto）、`secureTokenStore/loadUser/saveUser`、`ApiError`。
- Produces:
  - `AuthProvider` / `useAuth(): { user: UserProfile | null; ready: boolean; login(email: string, password: string): Promise<void>; register(input: { email: string; password: string; nickname: string }): Promise<void>; logout(): Promise<void> }`（`src/lib/auth.tsx`；login/register 成功与冷启动校验通过后调 `registerForPushNotifications()`）
  - `registerForPushNotifications(): Promise<void>`（`src/lib/push.ts`，Task 7 只消费不改动；模拟器/未授权/无 eas projectId 静默跳过，**任何内部错误整体吞掉**（dev 下 console.warn）——推送注册失败绝不打断登录/注册主流程，留待下次冷启动重试）
  - 通用组件：`Screen`（SafeArea 容器）、`Field`（label + TextInput）、`ErrorText`

- [ ] **Step 1: 通用组件**

`apps/app/src/components/Screen.tsx`：
```tsx
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children, scroll = false, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  if (scroll) {
    return (
      <SafeAreaView style={[styles.flex, style]}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaView style={[styles.flex, style]}>{<View style={styles.flex}>{children}</View>}</SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 16, gap: 12 },
});
```

`apps/app/src/components/Field.tsx`：
```tsx
import { StyleSheet, Text, TextInput, type TextInputProps } from 'react-native';

export function Field({ label, ...inputProps }: TextInputProps & { label: string }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#aaa" autoCapitalize="none" {...inputProps} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
});
```

`apps/app/src/components/ErrorText.tsx`：
```tsx
import { StyleSheet, Text } from 'react-native';

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({ error: { color: '#d33', fontSize: 13 } });
```

- [ ] **Step 2: auth context**

`apps/app/src/lib/auth.tsx`：
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import type { UserProfile } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from './api';
import { queryClient } from './query';
import { loadUser, saveUser, secureTokenStore } from './token-store';
import { registerForPushNotifications } from './push';

interface AuthContextValue {
  user: UserProfile | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; nickname: string }): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void loadUser().then(async (stored) => {
      if (cancelled) return;
      setUser(stored);
      setReady(true);
      // 冷启动：本地有 token，先校验仍有效（顺带触发 api-client 的 401 单飞 refresh）
      if (stored) {
        try {
          const me = await client.me();
          if (cancelled) return;
          setUser(me);
          await saveUser(me);
          await registerForPushNotifications();
        } catch (err) {
          if (cancelled) return;
          // 仅 401 登出（refresh 已失败且 api-client 内部 tokenStore.clear() 已清态）。
          // 网络错误（status 0）不登出：保留 stored 用户态，各页面 query 自行呈错/下拉重试，
          // 避免飞行模式冷启动把持有有效 token 的用户踢到登录页。
          if (err instanceof ApiError && err.status === 401) {
            setUser(null);
            router.replace('/login');
          }
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await client.login({ email, password });
    // 必须先 await 落盘，再触发任何需要带 token 的调用（含推送注册），避免读到旧/空 token
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    setUser(res.user);
    await registerForPushNotifications();
  }, []);

  const register = useCallback(async (input: { email: string; password: string; nickname: string }) => {
    const res = await client.register(input);
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    setUser(res.user);
    await registerForPushNotifications();
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    await secureTokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
```

（`client.login/register` 成功后手动 `setTokens`：api-client 只在 refresh 路径自动写 tokenStore，login/register 响应的 tokens 由调用方落盘——**必须 await 落盘完成**再调推送注册，否则 `registerPushToken` 可能读到空 token → 401 → refresh 也拿不到 → `tokenStore.clear()` 把刚落盘的登录态清空；随后 `saveUser` 持久化用户、`registerForPushNotifications()` 在登录态就绪时注册推送且自身永不抛错。）

`apps/app/src/lib/push.ts`（登录链路本 Task 就要调它，故完整实现落在本 Task；Task 7 只在其上接线通知 handler 与点击监听）：
```ts
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { client } from './api';

const PUSH_TOKEN_KEY = 'moment.push.token';

/**
 * 申请权限 → getExpoPushTokenAsync → POST /api/devices/push-token。
 * 登录后与 token 变化时调用；token 未变则跳过上报（幂等节流）。
 * 模拟器/未授权/无 eas projectId 静默跳过（真机验证见 Task 7 DoD，前置条件：eas init 已执行）。
 */
export async function registerForPushNotifications(): Promise<void> {
  // 推送注册失败不得影响登录主流程：整体吞错，下次冷启动重试兜底
  try {
    await registerPushTokenInner();
  } catch (err) {
    if (__DEV__) console.warn('[push] 注册失败，下次启动重试', err);
  }
}

async function registerPushTokenInner(): Promise<void> {
  if (!Device.isDevice) return;

  const projectId = Constants.easConfig?.projectId;
  if (!projectId) return; // eas init 未执行/本地 development build 未注入：跳过而非抛错

  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '默认',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4a90d9',
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const stored = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
  if (stored === token) return;

  await client.registerPushToken({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
}
```

- [ ] **Step 3: 登录/注册页 + 根布局接入**

`apps/app/app/login.tsx`：
```tsx
import { useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { loginInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { ErrorText } from '../src/components/ErrorText';
import { useAuth } from '../src/lib/auth';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('请输入有效的邮箱和密码');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      // 用 '/'（即 (tabs)/index）而非 '/(tabs)'：group 名作 href 的解析行为版本间不稳
      router.replace('/');
    } catch (err) {
      // err.message 是 UPPER_SNAKE 机器码（Phase 1 错误体），不能裸显；按 code 映射中文文案
      setError(
        err instanceof ApiError
          ? err.code === 'INVALID_CREDENTIALS'
            ? '邮箱或密码错误'
            : err.code === 'NETWORK_ERROR'
              ? '网络错误，请检查网络后重试'
              : err.message
          : '登录失败，请检查网络'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '登录' }} />
      <Text style={styles.title}>时刻</Text>
      <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="密码" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <Button title={submitting ? '登录中…' : '登录'} onPress={() => void onSubmit()} disabled={submitting} />
      <Link href="/register" asChild>
        <Pressable>
          <Text style={styles.link}>没有账号？注册</Text>
        </Pressable>
      </Link>
      <View />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 24 },
  link: { color: '#4a90d9', textAlign: 'center', marginTop: 16 },
});
```

`apps/app/app/register.tsx`：
```tsx
import { useState } from 'react';
import { Button, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { registerInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { ErrorText } from '../src/components/ErrorText';
import { useAuth } from '../src/lib/auth';

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = registerInputSchema.safeParse({ email, password, nickname });
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
    setSubmitting(true);
    try {
      await register(parsed.data);
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'EMAIL_ALREADY_REGISTERED'
            ? '该邮箱已注册'
            : err.message
          : '注册失败，请检查网络'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '注册' }} />
      <Text style={styles.title}>注册</Text>
      <Field label="昵称" value={nickname} onChangeText={setNickname} />
      <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="密码（8–72 位）" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <Button title={submitting ? '注册中…' : '注册'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
});
```

`apps/app/app/_layout.tsx`（整体替换）：
```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/query';
import { AuthProvider } from '../src/lib/auth';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack screenOptions={{ headerBackTitle: '返回' }}>
          {/* 不逐个声明 Stack.Screen：路由文件在各 Task 陆续落地，显式声明尚不存在的路由会报警。
              页面标题由各页面内的 <Stack.Screen options={{ title }} /> 设置。 */}
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

登录保护策略：`/login`、`/register`、`/invites/[token]` 未登录可达（邀请深链接未登录时先落登录页，登录成功回主界面，重开链接即可接受）；其余页面（`(tabs)` 全部子页、`compose`、`chains/[chainId]`、`chains-new`、`moments/[id]`）统一用 `RequireAuth` 包装（Task 3 Step 1 提供）。Task 7 在本文件上追加通知 handler 与点击监听。

- [ ] **Step 4: 验证**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: 全绿。

手动：`pnpm --filter @moment/app ios`（server 与 MySQL 已起）→ 注册新账号 → 提交成功后 `router.replace('/')` 落到 Task 1 的骨架占位 index，被重定向回 `/login`（**`(tabs)` 路由尚未创建、Task 3 才交付，属预期，不算失败**）——注册本身成功与否以「无报错弹窗 + 杀掉 App 重启仍登录」为准，进入主界面的复验并入 Task 3 Step 5；「我的」无退出入口前先不做登出验证（Task 3 tab 上提供）。

- [ ] **Step 5: Commit**

```bash
git add apps/app
git commit -m "feat(app): 登录/注册/auth context（SecureStore 持久化 + push token 注册接线）"
```

---

### Task 3: Tab 骨架 + feed 无限滚动（链/tag 过滤 + 排序切换）+ MomentCard/MediaGrid

**Files:**
- Create: `apps/app/src/components/RequireAuth.tsx`、`apps/app/src/components/MomentCard.tsx`、`apps/app/src/components/MediaGrid.tsx`、`apps/app/src/components/Loading.tsx`
- Create: `apps/app/app/(tabs)/_layout.tsx`、`apps/app/app/(tabs)/index.tsx`（feed）、`apps/app/app/(tabs)/chains.tsx`、`apps/app/app/(tabs)/notifications.tsx`（本 Task 交付完整列表页，Task 6 扩展点击深跳）
- Create: `apps/app/app/chains-new.tsx`
- Delete: `apps/app/app/index.tsx`（Task 1 骨架占位页。**必须与本 Task 同时删除**：`(tabs)/index.tsx` 与它同解析为 `/`，并存会触发 expo-router 跨 group 同路径路由冲突（告警后任选其一，行为不确定）；删除后 `/` 由 `(tabs)/index.tsx` 独占，未登录引导由 `(tabs)/_layout` 的 `RequireAuth` 承担）

**Interfaces:**
- Consumes: `client.getFeed/listChains/listTags`、`FeedQuery`、`MomentResponse/MomentMedia/TagResponse/ChainDto`、`client.mediaUrl`、`useAuth`。
- Produces:
  - `RequireAuth({ children })`：未登录 `<Redirect href="/login" />`，加载中 Loading
  - `MomentCard({ moment, onPress }: { moment: MomentResponse; onPress: () => void })`
  - `MediaGrid({ media }: { media: MomentMedia[] })`——图片格 expo-image 未引入，直接用 RN `Image`（`source={{ uri: client.mediaUrl(m.id) }}`，自动跟随 302）；视频格显示 ▶ 与时长（进详情播放由外层 MomentCard 的整卡 onPress 承担，网格自身无点击回调）
  - Tab 路由骨架（feed `/`、chains `/chains`、notifications `/notifications`）+ 新建链页 `/chains-new`

- [ ] **Step 1: 组件**

`apps/app/src/components/RequireAuth.tsx`：
```tsx
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/lib/auth';
import { Loading } from './Loading';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  return <>{children}</>;
}
```

`apps/app/src/components/Loading.tsx`：
```tsx
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
```

`apps/app/src/components/MediaGrid.tsx`：
```tsx
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentMedia } from '@moment/dto';
import { client } from '../src/lib/api';

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function MediaGrid({ media }: { media: MomentMedia[] }) {
  if (media.length === 0) return null;
  return (
    <View style={styles.grid}>
      {media.map((m) =>
        m.mime.startsWith('video/') ? (
          <View key={m.id} style={[styles.cell, styles.videoCell]}>
            <Text style={styles.play}>▶</Text>
            {m.duration != null && m.duration > 0 ? <Text style={styles.duration}>{formatDuration(m.duration)}</Text> : null}
            <Text style={styles.videoHint}>视频 · 进详情播放</Text>
          </View>
        ) : (
          <Image key={m.id} source={{ uri: client.mediaUrl(m.id) }} style={styles.cell} resizeMode="cover" />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  cell: { width: '32%', aspectRatio: 1, borderRadius: 6, backgroundColor: '#eee' },
  videoCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#222' },
  play: { color: '#fff', fontSize: 26 },
  duration: { color: '#fff', fontSize: 12, marginTop: 4 },
  videoHint: { color: '#999', fontSize: 10, marginTop: 4 },
});
```

`apps/app/src/components/MomentCard.tsx`：
```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse } from '@moment/dto';
import { formatMomentTime } from '../src/lib/format';
import { MediaGrid } from './MediaGrid';

export function MomentCard({ moment, onPress }: { moment: MomentResponse; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.head}>
        <Text style={styles.author}>{moment.author.nickname}</Text>
        <Text style={styles.time}>
          {formatMomentTime(moment.happenedAt, moment.happenedTzOffset)}
          {moment.isBackfill ? ' · 补发' : ''}
        </Text>
      </View>
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={moment.media} />
      <View style={styles.footer}>
        {moment.tags.map((t) => (
          <Text key={t.id} style={styles.tag}>
            #{t.name}
          </Text>
        ))}
        <Text style={styles.counts}>
          💬 {moment.commentCount} · {moment.reactions.reduce((sum, r) => sum + r.count, 0)} 个表情
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee', backgroundColor: '#fff' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  author: { fontWeight: '600', fontSize: 15 },
  time: { color: '#999', fontSize: 12 },
  content: { fontSize: 15, lineHeight: 22, color: '#222' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  tag: { color: '#4a90d9', fontSize: 13 },
  counts: { color: '#999', fontSize: 13, marginLeft: 'auto' },
});
```

- [ ] **Step 2: tab 骨架**

`apps/app/app/(tabs)/_layout.tsx`：
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
      </Tabs>
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 18, opacity: 0.4 },
  iconActive: { opacity: 1 },
});
```

`apps/app/app/(tabs)/notifications.tsx`（Task 3 交付完整列表；Task 6 只加点击深跳）：
```tsx
import { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NotificationDto } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { formatRelative } from '../../src/lib/format';
import { Loading } from '../../src/components/Loading';

export default function NotificationsScreen() {
  // 服务端默认每页仅 20 条（Phase 6 依赖契约）：limit: 50 + onEndReached 消费 nextCursor
  const { data, isPending, refetch, isRefetching, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: qk.notifications(),
      queryFn: ({ pageParam }) => client.listNotifications(undefined, { cursor: pageParam, limit: 50 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const onOpen = useCallback(
    (n: NotificationDto) => {
      // Task 6 扩展：追加深跳 moment 详情
      if (n.readAt == null) {
        void client.markNotificationsRead([n.id]).then(() => void refetch());
      }
    },
    [refetch]
  );

  if (isPending) return <Loading />;
  const items = data?.pages.flatMap((p) => p.notifications) ?? [];
  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      estimatedItemSize={72}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={styles.list}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      renderItem={({ item }) => {
        const payload = item.payload as { title?: string; body?: string };
        return (
          <Pressable style={[styles.item, item.readAt == null && styles.unread]} onPress={() => onOpen(item)}>
            <Text style={styles.title}>{payload.title ?? '时刻'}</Text>
            <Text style={styles.body}>{payload.body ?? ''}</Text>
            <Text style={styles.time}>{formatRelative(item.createdAt)}</Text>
          </Pressable>
        );
      }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>暂无通知</Text></View>}
      ListFooterComponent={isFetchingNextPage ? <Text style={styles.loadingMore}>加载中…</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
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

- [ ] **Step 3: feed 页（无限滚动 + 过滤 + 排序）**

先删除 Task 1 的骨架占位页 `apps/app/app/index.tsx`（本 Step 的 `(tabs)/index.tsx` 接管 `/`，同路径并存触发路由冲突，见 Files 清单），再创建：

`apps/app/app/(tabs)/index.tsx`：
```tsx
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MomentResponse } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { Loading } from '../../src/components/Loading';
import { MomentCard } from '../../src/components/MomentCard';

const PAGE_SIZE = 20;

export default function FeedScreen() {
  const [chainId, setChainId] = useState<string | undefined>();
  const [tagId, setTagId] = useState<string | undefined>();
  const [order, setOrder] = useState<'happened_at' | 'created_at'>('happened_at');

  const filters = useMemo(() => ({ chainIds: chainId ? [chainId] : undefined, tagId, order }), [chainId, tagId, order]);

  const chains = useQuery({ queryKey: qk.chains(), queryFn: () => client.listChains() });
  const tags = useQuery({
    queryKey: qk.tags(chainId ?? ''),
    queryFn: () => client.listTags(chainId ?? ''),
    enabled: chainId != null,
  });

  const feed = useInfiniteQuery({
    queryKey: qk.feed(filters),
    queryFn: ({ pageParam }) =>
      client.getFeed({ cursor: pageParam, chainIds: filters.chainIds, tagId: filters.tagId, order: filters.order, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const moments = useMemo(() => feed.data?.pages.flatMap((p) => p.moments) ?? [], [feed.data]);

  if (feed.isPending) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <Chip label="全部链" active={chainId == null} onPress={() => { setChainId(undefined); setTagId(undefined); }} />
        {(chains.data ?? []).map((c) => (
          <Chip key={c.id} label={c.name} active={chainId === c.id} onPress={() => { setChainId(c.id); setTagId(undefined); }} />
        ))}
        <Chip
          label={order === 'happened_at' ? '按发生时间' : '按添加时间'}
          active={false}
          onPress={() => setOrder(order === 'happened_at' ? 'created_at' : 'happened_at')}
        />
      </View>
      {chainId != null && (tags.data?.tags.length ?? 0) > 0 ? (
        <View style={styles.filters}>
          <Chip label="全部标签" active={tagId == null} onPress={() => setTagId(undefined)} />
          {(tags.data?.tags ?? []).map((t) => (
            <Chip key={t.id} label={`#${t.name}`} active={tagId === t.id} onPress={() => setTagId(t.id)} />
          ))}
        </View>
      ) : null}
      {feed.isError ? <Text style={styles.errorBanner}>加载失败，下拉重试</Text> : null}
      <FlashList
        data={moments}
        keyExtractor={(m) => m.id}
        estimatedItemSize={220}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        renderItem={({ item }: { item: MomentResponse }) => (
          <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有时刻，发布第一条吧</Text>
          </View>
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <Text style={styles.loadingMore}>加载中…</Text> : null
        }
      />
      <Link href={{ pathname: '/compose' }} asChild>
        <Pressable style={styles.fab} onPress={() => undefined}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

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

- [ ] **Step 4: 链列表 + 新建链页**

`apps/app/app/(tabs)/chains.tsx`：
```tsx
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainDto } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { useAuth } from '../../src/lib/auth';
import { Loading } from '../../src/components/Loading';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

export default function ChainsScreen() {
  const { logout, user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isPending, refetch, isRefetching } = useQuery({
    queryKey: qk.chains(),
    queryFn: () => client.listChains(),
  });

  if (isPending) return <Loading />;

  async function onLogout(): Promise<void> {
    await logout();
    queryClient.clear();
  }

  return (
    <View style={styles.flex}>
      <FlashList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        estimatedItemSize={64}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
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
            <Text style={styles.user}>{user?.nickname ?? ''}</Text>
            <Pressable onPress={() => void onLogout()}>
              <Text style={styles.logout}>退出登录</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

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

`apps/app/app/chains-new.tsx`：
```tsx
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { createChainInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { RequireAuth } from '../src/components/RequireAuth';

function ChainsNewInner() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = createChainInputSchema.safeParse({ name, description: description || null, visibility: 'private' });
    if (!parsed.success) {
      Alert.alert('提示', parsed.error.issues[0]?.message ?? '名称需 1–50 字');
      return;
    }
    setSubmitting(true);
    try {
      await client.createChain(parsed.data);
      await queryClient.invalidateQueries({ queryKey: qk.chains() });
      router.back();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.hint}>链是共享时间线，创建后可邀请家人朋友共同记录。</Text>
      <Field label="名称（1–50 字）" value={name} onChangeText={setName} />
      <Field label="描述（可选）" value={description} onChangeText={setDescription} multiline />
      <Button title={submitting ? '创建中…' : '创建'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

export default function ChainsNewScreen() {
  return (
    <RequireAuth>
      <ChainsNewInner />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#888', fontSize: 13 },
});
```

- [ ] **Step 5: 验证**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: 全绿。

手动：登录后 `router.replace('/')` 正常进入 tab 主界面（复验 Task 2 的登录/注册流转，无 unmatched route、无路由冲突告警）；**杀掉 App 进程后冷启动 → 直接进入 feed（不再经过登录页，验证 `app/index.tsx` 已删除且 `/` 唯一归属 `(tabs)/index`；未登录态冷启动则由 RequireAuth 落 `/login`）**；feed 下滑触发翻页；切链 chip → tag chip 出现并过滤；切「按添加时间」排序变化；新建链后「我的链」出现；退出登录回登录页。

- [ ] **Step 6: Commit**

```bash
git add apps/app
git commit -m "feat(app): tab 骨架与 feed 无限滚动过滤（FlashList + 链/tag/排序 chip）"
```

---

### Task 4: 链详情页（时间线 / 成员管理 / 邀请 / tag 管理）

**Files:**
- Create: `apps/app/app/chains/[chainId].tsx`
- Create: `apps/app/src/components/SegmentBar.tsx`

**Interfaces:**
- Consumes: `client.listChainMoments/listMembers/updateMemberRole/removeMember/createInvite/listInvites/revokeInvite/listTags/createTag/deleteTag/getChain`、`InviteRole/ChainRole/ChainMemberDto/InviteDto/TagResponse`、`MomentCard`、`qk`。
- Produces: `/chains/:chainId` 页面（四段：timeline / members / invites / tags）；`SegmentBar({ options, value, onChange })` 通用分段控件。

- [ ] **Step 1: SegmentBar**

`apps/app/src/components/SegmentBar.tsx`：
```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function SegmentBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} style={[styles.seg, value === o.value && styles.segActive]} onPress={() => onChange(o.value)}>
          <Text style={[styles.segText, value === o.value && styles.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f2f2f2', alignItems: 'center' },
  segActive: { backgroundColor: '#4a90d9' },
  segText: { color: '#444', fontSize: 13 },
  segTextActive: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 2: 链详情页**

`apps/app/app/chains/[chainId].tsx`：
```tsx
import { useMemo, useState } from 'react';
import { Alert, Button, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainMemberDto, InviteDto, MomentResponse, TagResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { Loading } from '../src/components/Loading';
import { MomentCard } from '../src/components/MomentCard';
import { SegmentBar } from '../src/components/SegmentBar';
import { RequireAuth } from '../src/components/RequireAuth';
import { formatRelative } from '../src/lib/format';

type Segment = 'timeline' | 'members' | 'invites' | 'tags';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

function ChainDetailInner() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('timeline');

  const chain = useQuery({ queryKey: qk.chain(chainId), queryFn: () => client.getChain(chainId) });
  const moments = useInfiniteQuery({
    queryKey: qk.chainMoments(chainId),
    queryFn: ({ pageParam }) => client.listChainMoments(chainId, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const members = useQuery({ queryKey: qk.members(chainId), queryFn: () => client.listMembers(chainId) });
  const invites = useQuery({ queryKey: qk.invites(chainId), queryFn: () => client.listInvites(chainId) });
  const tags = useQuery({ queryKey: qk.tags(chainId), queryFn: () => client.listTags(chainId) });

  const myRole = chain.data?.myRole;

  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: qk.members(chainId) });
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: qk.invites(chainId) });
  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: qk.tags(chainId) });

  const list = useMemo(() => moments.data?.pages.flatMap((p) => p.moments) ?? [], [moments.data]);

  if (chain.isPending || members.isPending) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.head}>
        <Text style={styles.name}>{chain.data?.name ?? ''}</Text>
        {chain.data?.description ? <Text style={styles.desc}>{chain.data.description}</Text> : null}
        <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId } })} />
      </View>
      <SegmentBar<Segment>
        options={[
          { value: 'timeline', label: '时间线' },
          { value: 'members', label: `成员 ${members.data?.length ?? 0}` },
          { value: 'invites', label: '邀请' },
          { value: 'tags', label: `标签 ${tags.data?.tags.length ?? 0}` },
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'timeline' ? (
        <FlashList
          data={list}
          keyExtractor={(m) => m.id}
          estimatedItemSize={220}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (moments.hasNextPage && !moments.isFetchingNextPage) void moments.fetchNextPage();
          }}
          renderItem={({ item }: { item: MomentResponse }) => (
            <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}

      {segment === 'members' ? <MembersView chainId={chainId} members={members.data ?? []} myRole={myRole} onChanged={invalidateMembers} /> : null}
      {segment === 'invites' ? <InvitesView chainId={chainId} invites={invites.data ?? []} myRole={myRole} chainName={chain.data?.name ?? ''} onChanged={invalidateInvites} /> : null}
      {segment === 'tags' ? <TagsView chainId={chainId} tags={tags.data?.tags} onChanged={invalidateTags} /> : null}
    </View>
  );
}

function MembersView({
  chainId,
  members,
  myRole,
  onChanged,
}: {
  chainId: string;
  members: ChainMemberDto[];
  myRole: string | undefined;
  onChanged: () => void;
}) {
  const canManage = myRole === 'owner';

  function onRolePress(m: ChainMemberDto): void {
    if (!canManage || m.role === 'owner') return;
    Alert.alert('修改角色', `${m.nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== m.role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => {
            void clientUpdateRole(chainId, m.userId, r);
          },
        })),
      {
        text: '移出链',
        style: 'destructive',
        onPress: () => {
          void clientRemoveMember(chainId, m.userId);
        },
      },
    ]);
  }

  async function clientUpdateRole(chainId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
    try {
      await client.updateMemberRole(chainId, userId, role);
      onChanged();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  async function clientRemoveMember(chainId: string, userId: string): Promise<void> {
    try {
      await client.removeMember(chainId, userId);
      onChanged();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  return (
    <View style={styles.section}>
      {members.map((m) => (
        <Pressable key={m.userId} style={styles.row} onPress={() => onRolePress(m)}>
          <Text style={styles.rowMain}>{m.nickname}</Text>
          <Text style={styles.rowSide}>{ROLE_LABEL[m.role] ?? m.role}</Text>
        </Pressable>
      ))}
      {canManage ? null : <Text style={styles.hint}>仅主理人可修改角色/移除成员</Text>}
    </View>
  );
}

function InvitesView({
  chainId,
  invites,
  myRole,
  chainName,
  onChanged,
}: {
  chainId: string;
  invites: InviteDto[];
  myRole: string | undefined;
  chainName: string;
  onChanged: () => void;
}) {
  const canInvite = myRole === 'owner' || myRole === 'editor';
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');

  async function onCreate(): Promise<void> {
    try {
      const invite = await client.createInvite(chainId, { role });
      onChanged();
      await Share.share({ message: `邀请你加入「${chainName}」时光链：moment://invites/${invite.token}` });
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  function onRevoke(inviteId: string): void {
    Alert.alert('吊销邀请', '吊销后对方无法再用该链接加入', [
      { text: '取消', style: 'cancel' },
      {
        text: '吊销',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await client.revokeInvite(inviteId);
              onChanged();
            } catch (err) {
              Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      {canInvite ? (
        <View style={styles.inviteBar}>
          <SegmentBar<'editor' | 'viewer'>
            options={[
              { value: 'editor', label: '邀请为编辑' },
              { value: 'viewer', label: '邀请为只读' },
            ]}
            value={role}
            onChange={setRole}
          />
          <Button title="生成邀请并发送" onPress={() => void onCreate()} />
        </View>
      ) : null}
      {invites.map((i) => (
        <View key={i.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
            <Text style={styles.rowSub}>
              {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
            </Text>
          </View>
          {i.acceptedAt || !canInvite ? null : (
            <Pressable onPress={() => onRevoke(i.id)}>
              <Text style={styles.danger}>吊销</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function TagsView({
  chainId,
  tags,
  onChanged,
}: {
  chainId: string;
  tags: TagResponse[] | undefined;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');

  async function onCreate(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await client.createTag(chainId, trimmed);
      setName('');
      onChanged();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.code : '网络错误');
    }
  }

  function onDelete(tagId: string, tagName: string): void {
    Alert.alert('删除标签', `删除「${tagName}」将从相关时刻上移除`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await client.deleteTag(tagId);
              onChanged();
            } catch (err) {
              Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagCreate}>
        <TextInput style={styles.tagInput} value={name} onChangeText={setName} placeholder="新标签名（链内唯一，上限 100 个）" placeholderTextColor="#aaa" />
        <Button title="添加" onPress={() => void onCreate()} />
      </View>
      {(tags ?? []).map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.rowMain}>#{t.name}（{t.momentCount} 条）</Text>
          <Pressable onPress={() => onDelete(t.id, t.name)}>
            <Text style={styles.danger}>删除</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export default function ChainDetailScreen() {
  return (
    <RequireAuth>
      <ChainDetailInner />
    </RequireAuth>
  );
}

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

- [ ] **Step 3: 验证**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: 全绿。

手动：链详情四段切换；owner 改成员角色/移除成员；生成邀请分享出 `moment://invites/<token>`；吊销邀请；建/删 tag；时间线下滑翻页。（「发布时刻」按钮的跳转验证并入 Task 5 Step 3——本 Task 执行时 `/compose` 路由尚未创建，点击提示路由不存在属预期。）

- [ ] **Step 4: Commit**

```bash
git add apps/app
git commit -m "feat(app): 链详情（时间线/成员角色/邀请分享吊销/tag 管理）"
```

---

### Task 5: 发布 composer（三类型 + 图片压缩 + 视频预校验 + 分片上传进度 + happened_at/is_backfill/tag）

**Files:**
- Create: `apps/app/src/lib/media.ts`、`apps/app/src/lib/rn-put.ts`、`apps/app/app/compose.tsx`
- Modify: `apps/app/src/lib/api.ts`（`putWithProgress` 由 `xhrPut` 换为 `rnPut`）

**Interfaces:**
- Consumes: `client.uploadMedia/createMoment/listChains/listTags`、`UploadMediaInput`（含 `fileUri` 形态与 `FilePart`，Phase 6 契约）、`PutFn`、`MAX_IMAGE_BYTES/MAX_VIDEO_BYTES/MAX_VIDEO_DURATION_SECONDS`（常量唯一来源 @moment/dto）、`ApiError`、`qk`（content/type 约束先本地校验，最终由 `client.createMoment` 内部的 dto `createMomentInputSchema.parse` 兜底）。
- Produces:
  - `src/lib/media.ts`：`pickImages(): Promise<PickedImage[]>`（≤9 张）、`pickVideo(): Promise<PickedVideo | null>`、`compressImage(img: PickedImage): Promise<ReadyImage>`（最长边 ≤2048px、JPEG 0.85、返回 Blob 与 size）、`validateVideo(v: PickedVideo): string | null`（超限返回用户提示文案，null=通过）、类型 `PickedImage/ReadyImage/PickedVideo`
  - `src/lib/rn-put.ts`：`rnPut: PutFn`（RN 版直传实现——Blob 直接 XHR 发送；`FilePart` 按 `[start,end)` 用 expo-file-system 从文件读盘，视频整文件不进内存）
  - `/compose?chainId=` 页面：三类型切换、图片九宫格、视频信息展示、happened_at（datetimepicker；选到 `now - 10min` 之前自动置 `is_backfill=true`，spec §5.6，无手动开关）、tag 多选、上传进度条与发布

- [ ] **Step 1: 媒体选择/压缩/校验**

`apps/app/src/lib/media.ts`：
```ts
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';

/** 图片压缩目标：最长边（spec §2 App 选型「客户端压缩」，2048px 足够 1080p 屏两倍图） */
export const MAX_IMAGE_DIM = 2048;

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

/** 压缩完成、可直接进 uploadMedia 的图片 */
export interface ReadyImage extends PickedImage {
  blob: Blob;
  size: number;
  mime: string;
}

export interface PickedVideo {
  uri: string;
  mime: string;
  size: number;
  /** 秒 */
  durationSeconds: number;
}

/** 仅用于压缩后的图片（百 KB 级）整读入内存；视频严禁走此路径（见 rn-put.ts 按片读盘）。 */
export async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

export async function pickImages(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 9,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

export async function pickVideo(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
  if (result.canceled) return null;
  const a = result.assets[0];
  if (!a) return null;
  return {
    uri: a.uri,
    mime: a.mimeType ?? 'video/mp4',
    size: a.fileSize ?? 0,
    durationSeconds: Math.round((a.duration ?? 0) / 1000),
  };
}

/** spec §5.5：客户端压到最长边 ≤2048px、JPEG 0.85；压缩后仍超 MAX_IMAGE_BYTES 由调用方拒绝。 */
export async function compressImage(img: PickedImage): Promise<ReadyImage> {
  let result = await ImageManipulator.manipulateAsync(img.uri, [], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  const maxDim = Math.max(result.width, result.height);
  if (maxDim > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / maxDim;
    result = await ImageManipulator.manipulateAsync(
      result.uri,
      [{ resize: { width: Math.round(result.width * scale), height: Math.round(result.height * scale) } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
  }
  const blob = await uriToBlob(result.uri);
  return { uri: result.uri, width: result.width, height: result.height, blob, size: blob.size, mime: 'image/jpeg' };
}

/** spec §5.5 视频限制的本地预校验：超限返回提示文案（引导用户先在系统相册压缩），通过返回 null。 */
export function validateVideo(v: PickedVideo): string | null {
  if (v.size > MAX_VIDEO_BYTES) {
    return `视频 ${Math.round(v.size / 1024 / 1024)}MB 超过 ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB 上限，请先在系统相册压缩后重选`;
  }
  if (v.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return `视频时长 ${Math.floor(v.durationSeconds / 60)} 分钟超过 ${Math.floor(MAX_VIDEO_DURATION_SECONDS / 60)} 分钟上限，请先在系统相册裁剪后重选`;
  }
  return null;
}
```

（实现注：`ImageManipulator.manipulateAsync` 自 SDK 52 起标记废弃，SDK 54 仍可用、不阻塞本计划；若实现时发现该 API 已被移除/类型不再导出，改用新 API `ImageManipulator.manipulate(uri).renderAsync()` + `getOutputAsync()` 等价实现，压缩参数（resize ≤2048px、JPEG 0.85）不变。）

`apps/app/src/lib/rn-put.ts`（RN 版 `PutFn`。api-client 的 `uploadMedia` 在 `fileUri` 形态下把每个 part 以 `FilePart = { fileUri; start; end; size; mime }` 传给 put——Phase 7 评审引入、Phase 6 计划已同步落地的最小契约扩展。**为什么必须这样**：500MB 视频若用 `fetch(uri).blob()` 整读入内存再 `slice()`，真机进程直接 OOM；按片读盘峰值内存 = 单个 part）：
```ts
import { File } from 'expo-file-system';
import { ApiError, type FilePart, type PutFn } from '@moment/api-client';

/** 按 [start, end) 区间从文件读字节（不整文件读入）。 */
function readPartBytes(part: FilePart): Uint8Array {
  const handle = new File(part.fileUri).open('r');
  try {
    handle.offset = part.start; // FileHandle 游标可定位（seek）
    return handle.readBytes(part.end - part.start);
  } finally {
    handle.close();
  }
}

export const rnPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    try {
      // Blob（图片等已在内存的小对象）直接发送；FilePart（视频分片）读盘构造
      const blob = body instanceof Blob ? body : new Blob([readPartBytes(body)], { type: contentType });
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onerror = () => reject(new ApiError('网络错误', 0, 'NETWORK_ERROR'));
      xhr.onabort = () => reject(new ApiError('已取消', 0, 'ABORTED'));
      xhr.onload = () => {
        const etag = xhr.getResponseHeader('ETag');
        if (xhr.status >= 200 && xhr.status < 300) resolve({ etag });
        else reject(new ApiError(`PUT 失败（${xhr.status}）`, xhr.status, 'UPLOAD_FAILED'));
      };
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(blob);
    } catch (err) {
      reject(err instanceof ApiError ? err : new ApiError('分片读取失败', 0, 'UPLOAD_FAILED'));
    }
  });
```
（实现注：若所用 expo-file-system 版本的 `FileHandle` 不可直接赋值 `offset`，则以等价 seek API 定位；均不可用时改用 `react-native-blob-util` 的 `fs.slice(src, start, end)`（原生切片，不进 JS 堆）作为 `readPartBytes` 的替代——两条路线都满足「按片读盘」，禁止回退成整文件 `fetch(uri).blob()`。）

并在 `apps/app/src/lib/api.ts` 把 `putWithProgress: xhrPut` 换成 `putWithProgress: rnPut`（import 同步替换）。

- [ ] **Step 2: composer 页**

`apps/app/app/compose.tsx`：
```tsx
import { useMemo, useState } from 'react';
import { Alert, Button, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_IMAGE_BYTES, type MediaCompleteResponse, type MomentType } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { Screen } from '../src/components/Screen';
import { SegmentBar } from '../src/components/SegmentBar';
import { RequireAuth } from '../src/components/RequireAuth';
import { compressImage, pickImages, pickVideo, validateVideo, type PickedVideo, type ReadyImage } from '../src/lib/media';

/** 总尝试次数 = 初始 1 次 + ≤2 次重试（与 Global Constraints「≤2 次重试」一致；网络类失败才重试）。
 *  服务端 complete 幂等，重试会重新 presign 拿新 mediaId，
 *  旧 mediaId 残留为 uploading 行由 Phase 8 sweeper 清理。 */
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
      // 仅网络类（status 0）/服务端 5xx 重试：413 本地预校验、401（refresh 已失败并 clear 后的
      // 残余请求）、403（CHAIN_ROLE_INSUFFICIENT）等 4xx 重试无意义且可能重复打已清态请求
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) throw err;
    }
  }
  throw lastError;
}

function ComposeInner() {
  const params = useLocalSearchParams<{ chainId?: string }>();
  const queryClient = useQueryClient();

  const chains = useQuery({ queryKey: qk.chains(), queryFn: () => client.listChains() });
  const editableChains = useMemo(() => (chains.data ?? []).filter((c) => c.myRole !== 'viewer'), [chains.data]);
  const [chainId, setChainId] = useState<string | undefined>(params.chainId ?? editableChains[0]?.id);
  const activeChainId = chainId ?? editableChains[0]?.id;

  const tags = useQuery({
    queryKey: qk.tags(activeChainId ?? ''),
    queryFn: () => client.listTags(activeChainId ?? ''),
    enabled: activeChainId != null,
  });

  const [type, setType] = useState<MomentType>('text');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<ReadyImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [happenedAt, setHappenedAt] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [isBackfill, setIsBackfill] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPickImages(): Promise<void> {
    const picked = await pickImages();
    if (picked.length === 0) return;
    const remain = 9 - images.length;
    if (remain <= 0) {
      Alert.alert('提示', '图片最多 9 张');
      return;
    }
    setProgressLabel('压缩中…');
    const ready: ReadyImage[] = [];
    let rejected = 0;
    for (const img of picked.slice(0, remain)) {
      const r = await compressImage(img);
      if (r.size > MAX_IMAGE_BYTES) {
        rejected += 1; // 压缩后仍超限的个别图片（极端长图）跳过；常量唯一来源 @moment/dto
        continue;
      }
      ready.push(r);
    }
    if (rejected > 0) Alert.alert('提示', `${rejected} 张图片压缩后仍超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，已跳过`);
    setProgressLabel(null);
    setImages((prev) => [...prev, ...ready].slice(0, 9));
  }

  async function onPickVideo(): Promise<void> {
    const picked = await pickVideo();
    if (!picked) return;
    const problem = validateVideo(picked);
    if (problem) {
      Alert.alert('无法上传', problem);
      return;
    }
    setVideo(picked);
  }

  function toggleTag(id: string): void {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function onSubmit(): Promise<void> {
    if (!activeChainId) {
      Alert.alert('提示', '请选择要发布到的链（需要编辑权限）');
      return;
    }
    // 本地前置校验（与 dto createMomentInputSchema 的 superRefine 规则一致；最终约束在
    // client.createMoment 内部再经 dto schema.parse 兜底）：
    if (type === 'text' && content.trim().length === 0) {
      Alert.alert('提示', '文字类型需要内容');
      return;
    }
    if (content.length > 5000) {
      Alert.alert('提示', '正文最多 5000 字');
      return;
    }
    if (type === 'media' && images.length === 0) {
      Alert.alert('提示', '图文类型至少选 1 张图（最多 9 张）');
      return;
    }
    if (type === 'video' && !video) {
      Alert.alert('提示', '视频类型需要先选择视频');
      return;
    }

    setSubmitting(true);
    try {
      // 1) 上传媒体（分片串行 + 每片重试由 api-client uploadMedia 负责；此处聚合多文件总进度）
      //    图片走 file: Blob（压缩后百 KB 级，已在内存）；视频走 fileUri 形态——rnPut 按 part
      //    从文件 uri 读盘 PUT，500MB 视频整文件不进内存（否则真机 OOM，见 src/lib/rn-put.ts）。
      const mediaIds: string[] = [];
      type UploadFile =
        | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
        | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number };
      let files: UploadFile[] = [];
      if (type === 'media') {
        files = images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
      } else if (type === 'video' && video) {
        files = [{ fileUri: video.uri, mime: video.mime, size: video.size, kind: 'video' as const, durationSeconds: video.durationSeconds, sortOrder: 0 }];
      }
      const totalBytes = files.reduce((s, f) => s + f.size, 0);
      let doneBytes = 0;
      for (const f of files) {
        const res = await uploadWithRetry({
          ...f,
          onProgress: (loaded) => {
            const overall = totalBytes > 0 ? Math.floor(((doneBytes + loaded) / totalBytes) * 100) : 100;
            setProgressLabel(`上传中 ${overall}%`);
          },
        });
        mediaIds.push(res.mediaId);
        doneBytes += f.size;
      }

      // 2) 发布 moment（client 内部经 dto schema 补默认值并做最终约束校验）
      setProgressLabel('发布中…');
      await client.createMoment(activeChainId, {
        type,
        content,
        happenedAt: happenedAt.toISOString(),
        // 与 dto 契约/Phase 6 currentTzOffset() 同语义：原值（同 JS getTimezoneOffset，东八区 = -480），不取反
        happenedTzOffset: happenedAt.getTimezoneOffset(),
        isBackfill,
        mediaIds,
        tagIds,
      });

      // 3) 失效相关查询（qk.feedAll() = ['feed'] 前缀，覆盖全部 feed 过滤组合）
      await queryClient.invalidateQueries({ queryKey: qk.feedAll() });
      await queryClient.invalidateQueries({ queryKey: qk.chainMoments(activeChainId) });
      await queryClient.invalidateQueries({ queryKey: qk.tags(activeChainId) });
      Alert.alert('已发布', '可在时刻流中查看');
      router.back();
    } catch (err) {
      Alert.alert(
        '发布失败',
        err instanceof ApiError
          ? `${err.message}（${err.code}）${err.code === 'NETWORK_ERROR' ? '，媒体已尝试断点重传，可重试' : ''}`
          : '网络错误，请重试'
      );
    } finally {
      setProgressLabel(null);
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <SegmentBar<MomentType>
        options={[
          { value: 'text', label: '文字' },
          { value: 'media', label: '图文' },
          { value: 'video', label: '视频' },
        ]}
        value={type}
        onChange={(t) => {
          setType(t);
          setImages([]);
          setVideo(null);
        }}
      />

      {editableChains.length > 1 ? (
        <View style={styles.chipRow}>
          {editableChains.map((c) => (
            <Pressable key={c.id} style={[styles.chip, activeChainId === c.id && styles.chipActive]} onPress={() => setChainId(c.id)}>
              <Text style={[styles.chipText, activeChainId === c.id && styles.chipTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.content}
        value={content}
        onChangeText={setContent}
        placeholder={type === 'text' ? '记录这一刻…' : '配文（可选）'}
        placeholderTextColor="#aaa"
        multiline
      />

      {type === 'media' ? (
        <View style={styles.mediaBar}>
          <Button title={`选图（${images.length}/9）`} onPress={() => void onPickImages()} />
          {images.length > 0 ? (
            <Button title="清空" color="#d33" onPress={() => setImages([])} />
          ) : null}
        </View>
      ) : null}
      {type === 'media' && images.length > 0 ? (
        <Text style={styles.mediaHint}>已压缩 {images.length} 张（最长边 ≤2048px），共 {Math.round(images.reduce((s, i) => s + i.size, 0) / 1024)}KB</Text>
      ) : null}

      {type === 'video' ? (
        <View style={styles.mediaBar}>
          <Button title={video ? '重选视频' : '选择视频'} onPress={() => void onPickVideo()} />
          {video ? (
            <Button title="移除" color="#d33" onPress={() => setVideo(null)} />
          ) : null}
        </View>
      ) : null}
      {type === 'video' && video ? (
        <Text style={styles.mediaHint}>
          {Math.round(video.size / 1024 / 1024)}MB · {Math.floor(video.durationSeconds / 60)}分{video.durationSeconds % 60}秒 · 分片上传可断点重试
        </Text>
      ) : null}

      <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)}>
        <Text style={styles.dateText}>
          发生时间：{happenedAt.toLocaleString()}（{isBackfill ? '补发' : '当下'}）
        </Text>
      </Pressable>
      {showPicker ? (
        <DateTimePicker
          value={happenedAt}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => {
            setShowPicker(Platform.OS === 'ios');
            if (d) {
              setHappenedAt(d);
              setIsBackfill(d.getTime() < Date.now() - 10 * 60_000);
            }
          }}
        />
      ) : null}

      {(tags.data?.tags.length ?? 0) > 0 ? (
        <View style={styles.chipRow}>
          {tags.data?.tags.map((t) => (
            <Pressable key={t.id} style={[styles.chip, tagIds.includes(t.id) && styles.chipActive]} onPress={() => toggleTag(t.id)}>
              <Text style={[styles.chipText, tagIds.includes(t.id) && styles.chipTextActive]}>#{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {progressLabel ? <Text style={styles.progress}>{progressLabel}</Text> : null}
      <Button title={submitting ? '处理中…' : '发布'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

export default function ComposeScreen() {
  return (
    <RequireAuth>
      <ComposeInner />
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

（上传顺序说明：先全部 `uploadMedia` 拿到 `mediaIds`，再 `createMoment`——服务端发布事务会校验 media `status='ready'` 且属于当前用户（Phase 3 契约），未 complete 完成的上传会被拒绝，天然防「引用未就绪媒体」。）

- [ ] **Step 3: 验证**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: 全绿。

手动（模拟器，server + 已有链与 tag）：发纯文本；发图文（选 3 张大图，观察「已压缩 N 张」与上传百分比从 0→100）；发视频（选 >5 分钟或超大文件验证提示，选正常小视频走分片上传）；改 happened_at 到过去自动勾「补发」；选 2 个 tag 发布后 feed 卡片显示 tag。

- [ ] **Step 4: Commit**

```bash
git add apps/app
git commit -m "feat(app): 发布 composer（三类型/图片压缩/视频预校验/分片上传进度/happened_at/补发/tag）"
```

---

### Task 6: moment 详情（评论 + 表情 reaction）+ 通知点击深跳

**Files:**
- Create: `apps/app/app/moments/[id].tsx`
- Modify: `apps/app/app/(tabs)/notifications.tsx`（onOpen 落实：标记已读 + 深跳）

**Interfaces:**
- Consumes: `client.getMoment/listComments/createComment/deleteComment/setReaction/removeReaction`、`MomentResponse/CommentDto/ReactionSummary/REACTION_EMOJIS`、`client.mediaUrl`、`formatMomentTime/formatRelative`、`qk`。
- Produces: `/moments/:id` 页面（作者/时间/content/媒体（视频用 expo-video 播放）/tag/表情行（高亮判断用 `moment.myReaction === emoji`）/评论列表（`limit: 50` + 加载更多消费 `nextCursor`）+ 发送框）。

- [ ] **Step 1: moment 详情页**

`apps/app/app/moments/[id].tsx`：
```tsx
import { useEffect, useState } from 'react';
import { Alert, Button, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REACTION_EMOJIS, type MomentMedia } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client, apiUrl } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { formatMomentTime, formatRelative } from '../src/lib/format';
import { Loading } from '../src/components/Loading';
import { RequireAuth } from '../src/components/RequireAuth';

function mediaAbsolute(m: MomentMedia): string {
  return m.url.startsWith('http') ? m.url : `${apiUrl}${m.url}`;
}

function VideoBlock({ media }: { media: MomentMedia }) {
  const player = useVideoPlayer(mediaAbsolute(media), (p) => {
    p.loop = false;
  });
  return <VideoView player={player} contentFit="contain" style={styles.video} allowsFullscreen />;
}

function MomentDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const moment = useQuery({ queryKey: qk.moment(id), queryFn: () => client.getMoment(id) });
  // 评论分页：listComments 返回 CommentListResponse = { comments, nextCursor }（不是裸数组）；
  // 服务端默认每页仅 20 条，limit: 50 + 「加载更多」消费 nextCursor（与 Phase 6 web 版同构）
  const comments = useInfiniteQuery({
    queryKey: qk.comments(id),
    queryFn: ({ pageParam }) => client.listComments(id, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.moment(id) });
    void queryClient.invalidateQueries({ queryKey: qk.comments(id) });
    void queryClient.invalidateQueries({ queryKey: qk.feedAll() });
  };

  const react = useMutation({
    mutationFn: (emoji: string | null) => (emoji === null ? client.removeReaction(id) : client.setReaction(id, emoji)),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  const send = useMutation({
    mutationFn: (content: string) => client.createComment(id, content),
    onSuccess: () => {
      setDraft('');
      invalidate();
    },
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  const removeComment = useMutation({
    mutationFn: (commentId: string) => client.deleteComment(commentId),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误'),
  });

  if (moment.isPending) return <Loading />;
  if (moment.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.deleted}>该时刻可能已被删除（{moment.error instanceof ApiError ? moment.error.code : '加载失败'}）</Text>
      </View>
    );
  }

  const m = moment.data;
  // Phase 5 契约：ReactionSummary = { emoji, count } 无 mine 字段，「我的表情」在 MomentResponse.myReaction
  const myEmoji = m.myReaction;
  const commentList = comments.data?.pages.flatMap((p) => p.comments) ?? [];

  function onEmoji(emoji: string): void {
    react.mutate(myEmoji === emoji ? null : emoji);
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
            <Image key={media.id} source={{ uri: mediaAbsolute(media) }} style={styles.image} resizeMode="contain" />
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
              <Pressable
                key={emoji}
                style={[styles.reaction, active && styles.reactionActive]}
                onPress={() => onEmoji(emoji)}
              >
                <Text style={styles.reactionText}>
                  {emoji}
                  {summary && summary.count > 0 ? ` ${summary.count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>评论（{m.commentCount}）</Text>
        {commentList.map((c) => (
          <View key={c.id} style={styles.comment}>
            <View style={styles.commentHead}>
              <Text style={styles.commentAuthor}>{c.author.nickname}</Text>
              <Text style={styles.commentTime}>{formatRelative(c.createdAt)}</Text>
              <Pressable onPress={() => removeComment.mutate(c.id)}>
                <Text style={styles.commentDelete}>删除</Text>
              </Pressable>
            </View>
            <Text style={styles.commentBody}>{c.content}</Text>
          </View>
        ))}
        {commentList.length === 0 ? <Text style={styles.noComment}>还没有评论</Text> : null}
        {comments.hasNextPage ? (
          <Button
            title={comments.isFetchingNextPage ? '加载中…' : '加载更多评论'}
            onPress={() => void comments.fetchNextPage()}
          />
        ) : null}
        <View />
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="写评论…（1000 字内）"
          placeholderTextColor="#aaa"
          multiline
        />
        <Button
          title="发送"
          disabled={send.isPending || draft.trim().length === 0}
          onPress={() => send.mutate(draft.trim())}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

export default function MomentDetailScreen() {
  return (
    <RequireAuth>
      <MomentDetailInner />
    </RequireAuth>
  );
}

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

（评论删除按钮对所有人可见但服务端校验作者/owner（Phase 5 `NOT_COMMENT_AUTHOR`/`CHAIN_NOT_FOUND`），失败以 Alert 呈现。）

- [ ] **Step 2: 通知点击深跳**

`apps/app/app/(tabs)/notifications.tsx` 中 `onOpen` 替换为（并补 import：`router` from `expo-router`、`useQueryClient` from `@tanstack/react-query`、`client.invalidateQueries` 所需的 `qk` 已在文件中）：
```tsx
  const queryClient = useQueryClient();

  const onOpen = useCallback(
    (n: NotificationDto) => {
      const payload = n.payload as { data?: { momentId?: string } };
      if (n.readAt == null) {
        void client.markNotificationsRead([n.id]).then(() => {
          void queryClient.invalidateQueries({ queryKey: qk.notifications() });
        });
      }
      const momentId = payload.data?.momentId;
      if (momentId) router.push(`/moments/${momentId}`);
    },
    [queryClient, router]
  );
```

- [ ] **Step 3: 验证**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check`
Expected: 全绿。

手动：详情页点赞/换表情/取消（计数即时变化，另一账号看一致）；发评论、删自己的评论；带视频的 moment 用 expo-video 播放；通知列表点击 → 标记已读并跳到对应 moment。

- [ ] **Step 4: Commit**

```bash
git add apps/app
git commit -m "feat(app): moment 详情（评论/表情/视频播放）与通知点击深跳"
```

---

### Task 7: 邀请深链接 + Expo Push 点击跳转 + 全量验证与 DoD

**Files:**
- Create: `apps/app/app/invites/[token].tsx`（目录名 `invites` 与深链接 `moment://invites/<token>` 映射出的路由 `/invites/<token>` 逐字一致——见 Global Constraints 深链接说明）
- Modify: `apps/app/app/_layout.tsx`（通知 handler + response listener）
- Modify: `apps/app/app/(tabs)/notifications.tsx`（进入页面即全部标记已读）

**Interfaces:**
- Consumes: `client.acceptInvite`、`AcceptInviteResponse`、`registerForPushNotifications`（Task 2 已建）、expo-notifications / expo-linking、`qk`。
- Produces: `moment://invites/<token>` 深链接接受页；App 前台通知展示 + 冷启动/后台点击跳 `/moments/<id>`。

- [ ] **Step 1: 邀请接受页**

`apps/app/app/invites/[token].tsx`：
```tsx
import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AcceptInviteResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../src/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../../src/lib/keys';
import { Screen } from '../../src/components/Screen';
import { RequireAuth } from '../../src/components/RequireAuth';

function InviteInner() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AcceptInviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onAccept(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await client.acceptInvite(token);
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: qk.chains() });
    } catch (err) {
      if (err instanceof ApiError) {
        const message =
          err.code === 'INVITE_NOT_FOUND'
            ? '邀请不存在或已被吊销'
            : err.code === 'INVITE_EXPIRED'
              ? '邀请已过期'
              : err.code === 'INVITE_ALREADY_ACCEPTED'
                ? '邀请已被使用'
                : err.code === 'INVITE_EMAIL_MISMATCH'
                  ? '该邀请限定了其他邮箱'
                  : err.message;
        setError(message);
      } else {
        setError('网络错误，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>加入时光链</Text>
      {result ? (
        <>
          <Text style={styles.ok}>
            {result.alreadyMember ? '你已经是这条链的成员' : '已成功加入！'}（角色：
            {result.role === 'owner' ? '主理人' : result.role === 'editor' ? '编辑' : '只读'}）
          </Text>
          <Button title="打开这条链" onPress={() => router.replace(`/chains/${result.chainId}`)} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>接受邀请后将出现在「我的链」中，即可查看与记录。</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {submitting ? (
            <ActivityIndicator />
          ) : (
            <Button title="接受邀请" onPress={() => void onAccept()} disabled={error != null} />
          )}
        </>
      )}
    </Screen>
  );
}

export default function InviteScreen() {
  return (
    <RequireAuth>
      <InviteInner />
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

（未登录点开深链接：`RequireAuth` 落到 `/login`，登录成功回 `(tabs)`；再点一次邀请链接（或分享面板重开）即可接受——邀请 token 在过期前始终有效。）

- [ ] **Step 2: 根布局通知接线**

`apps/app/app/_layout.tsx` 增量（在 `RootLayout` 的 `QueryClientProvider` 内、`AuthProvider` 外或内均可，放外层保证未登录也注册 listener）：
```tsx
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

function useNotificationRouting(): void {
  useEffect(() => {
    // 前台收到通知也展示横幅（SDK 53+ 必须显式返回 shouldShowBanner/shouldShowList）
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const openMoment = (data: unknown) => {
      const momentId = (data as { momentId?: string } | undefined)?.momentId;
      if (momentId) router.push(`/moments/${momentId}`);
    };

    // 冷启动补偿：首条 response 可能在 JS 监听器挂载前已派发，先补一次跳转
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) openMoment(resp.notification.request.content.data);
    });

    // 点击（App 运行中）→ 跳对应 moment（Phase 5 payload.data 契约）
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openMoment(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router]);
}
```
并在 `RootLayout` 组件体首行调用 `useNotificationRouting();`。

`apps/app/app/(tabs)/notifications.tsx` 增加（`useQueryClient`/`qk` 已在 Task 6 引入；import 需补 `useEffect`，react 一行改为 `import { useCallback, useEffect } from 'react';`）——进入页面把未读**全部**标记已读。注意 Phase 5 schema 要求 `markNotificationsRead(ids)` 的 ids 必填且 1–100 个 uuid（**无「空数组=全部」语义**，空数组直接 400），且服务端每页最多 50 条：只标记「当前已加载条目」会漏掉第 21 条起的通知。必须**循环翻页收集全部未读 id 再分批 ≤100 提交**（与 Phase 6 web 版 markAll 同构）：
```tsx
  // 依赖 []：每次进入通知页执行一次
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 1) 循环翻页（limit=50 逐页取 nextCursor）收集全部未读 id
        const unreadIds: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listNotifications(false, { cursor, limit: 50 });
          unreadIds.push(...page.notifications.filter((n) => n.readAt === null).map((n) => n.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        // 2) schema 限每批 1–100 个：分批串行提交
        for (let i = 0; i < unreadIds.length; i += 100) {
          await client.markNotificationsRead(unreadIds.slice(i, i + 100));
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: qk.notifications() });
        }
      } catch {
        // 网络失败静默：下次进入页面重试，列表本身仍可浏览
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);
```

- [ ] **Step 3: 全量验证**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app export:check
cd apps/app && npx expo prebuild --platform ios --no-install && rm -rf ios
```

Expected: typecheck/lint/export 全绿；prebuild 产出 `apps/app/ios/`（含 bundleIdentifier `com.moment.app` 与 scheme `moment`），删除后 `git status` 无残留。

Run: `pnpm build && pnpm lint && pnpm test`
Expected: 全仓（dto/server/api-client/app）绿；server 测试不受影响（本计划零 server 改动）。

- [ ] **Step 4: Commit**

```bash
git add apps/app
git commit -m "feat(app): 邀请深链接接受页与 Expo Push 点击跳转"
```

---

## 完成标准（Phase 7 DoD）

自动化门槛：

- `pnpm --filter @moment/app typecheck`、`lint`、`export:check` 三绿；`expo prebuild --platform ios --no-install` 可产出原生工程（验证后删除）。
- `pnpm build && pnpm lint && pnpm test` 全仓绿（server/dto/api-client 回归不受影响）。

模拟器手动验收清单（server dev + 本地 MySQL，模拟器 `EXPO_PUBLIC_API_URL` 按 Task 1 说明）：

1. 注册/登录/登出：新账号注册直接进主界面；杀进程重启仍登录；「我的链 → 退出登录」回登录页。
2. 链：新建链；owner 改成员角色、移除成员；生成邀请（系统分享面板出现 `moment://invites/<token>`）；吊销邀请后再接受报「邀请不存在或已被吊销」；tag 创建/删除。
3. feed：无限滚动翻页；链 chip + tag chip 过滤生效；「按发生时间/按添加时间」切换结果顺序变化。
4. 发布：text/media/video 三类型各发一条；选 3 张 4000px 大图 → 「已压缩 3 张（最长边 ≤2048px）」；上传进度 0→100%；happened_at 改到昨天自动标「补发」；选 tag 后 feed 卡片带 `#tag`。
5. 详情：表情点/换/取消计数变化（双账号核对）；评论发送/删除；视频 moment 可播放。
6. 深链接：`xcrun simctl openurl booted "moment://invites/<token>"`（Android 模拟器 `adb shell am start -W -a android.intent.action.VIEW -d "moment://invites/<token>"`）→ 邀请页 → 接受 → 「打开这条链」进链详情。
7. 断点重传（可选加分）：发布大视频上传中飞行模式 10s 再恢复 → 每片重试后完成；或中断后重试整个发布成功（幂等由服务端 complete 保证）。

真机推送验收步骤（Expo Push 只在真机生效，模拟器跳过；**前置条件：已执行 `npx eas init` 且 `EAS_PROJECT_ID` 已注入**——否则 `Constants.easConfig.projectId` 缺失，App 端按设计静默跳过 push 注册，下列步骤全部不成立）：

1. `cd apps/app && npx eas build --profile development --platform ios`（Android 同理），安装 development build。
2. 真机登录（`EXPO_PUBLIC_API_URL` 为手机可达的局域网 IP 或线上 API）→ 首次弹出通知权限弹窗，允许。
3. 验证 token 已注册：查 server 库 `push_tokens` 表出现该设备 `expo_token`（platform=ios/android，`invalidated_at` 为 NULL）；重复登录不重复上报（token 未变时跳过）。
4. 用另一账号在链内发布一条 moment（非补发）→ 真机收到横幅「<链名>：<昵称> 发布了新动态：…」；点横幅冷启动/热启动均落到对应 moment 详情。
5. 补发（is_backfill=true）不收 push，但通知列表出现条目（payload.backfill 快照），App 内点击同样可跳。
6. 评论/表情通知：另一账号评论/点赞我的 moment → 收到 push（标题为链名）。
7. iOS 前台（App 打开时）收到通知也展示横幅（setNotificationHandler 生效）。
