# 时刻 Moment — App 端 rab 迁移 + MVP 补齐 Design

> 日期：2026-08-18
> 状态：设计已与用户对齐（方案 A：完全对齐 Web rab 分层）
> 范围：`apps/app` 状态层从 TanStack Query + zustand 迁到 `@rabjs/react`（rab），并补齐 MVP 功能缺口。不改 server / dto / api-client。
> 权威边界：数据与权限听 `2026-08-15-moment-design.md`；状态分层听本文与 web 迁移实践（`2026-08-17-web-rab-state-migration.md`）。

## 0. 背景与范围

App 端（Expo RN + expo-router）已有页面骨架：登录/注册、(tabs) 时间线/链/通知、链详情、时刻详情、发布、新建链、邀请接受。状态层是 TanStack Query + zustand，与 web 端刚完成的 rab 迁移不一致。

**本轮做：**

1. 状态层整体迁到 rab（方案 A：完全对齐 Web 的 rab 分层）。
2. 补齐 MVP 缺口：链设置页、「我」页、通知点击跳转。

**本轮不做：**

- Expo Push 不接入（`src/lib/push.ts` 移除；后续换国内推送方案单独一轮）。
- UI 视觉保持现有功能风格，不对齐 web「日子线」视觉。
- 不补 jest 测试基建；验证 = lint + tsc + iOS 模拟器手测。
- 不动 server / dto / api-client；不动媒体上传管线。

## 1. 目录与分层

```
apps/app/
├── app/                        # expo-router 路由（薄壳）
│   ├── _layout.tsx             # 入口：register 全局 Service + Stack
│   ├── login.tsx register.tsx
│   ├── (tabs)/index.tsx        # 时间线
│   ├── (tabs)/chains.tsx       # 链列表
│   ├── (tabs)/notifications.tsx
│   ├── (tabs)/me.tsx           # 新增：我
│   ├── chains/[chainId].tsx
│   ├── chains/[chainId]/settings.tsx   # 新增：链设置（参数带 chainId）
│   ├── moments/[id].tsx
│   ├── compose.tsx chains-new.tsx invites/[token].tsx
└── src/
    ├── services/               # 全局 Service（register，_layout 里注册）
    │   ├── auth.service.ts
    │   ├── chain-list.service.ts
    │   └── notification.service.ts
    ├── features/               # 页面：index.tsx + <name>.service.ts 同目录
    │   ├── feed/ chains/ chain-home/ chain-settings/
    │   ├── moment/ compose/ notifications/ me/ auth/ invite/
    ├── components/             # 现有 MomentCard/MediaGrid/Field 等保留
    └── lib/                    # api.ts / token-store / media / rn-put / format 保留
```

路由文件只做三件事：解析参数 → `service.hydrate(params)` → 渲染 feature 组件。跳转（`router.push`）留在组件，Service 不碰 router。

## 2. rab 状态三层（对齐 web）

- **全局 Service**（`src/services/`）：在 `app/_layout.tsx` 用 `register` 注册，`AuthService` 排首。**禁止**用 `bindServices` 注册全局 Service。
- **页面 Service**：`src/features/<name>/index.tsx` + 同目录 `<name>.service.ts`，组件用 `bindServices` 绑定，生命周期随页面。
- **组件级 Service**：与组件同目录（本轮暂不需要，发布面板若拆分再用）。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- Service 依赖用 getter + `this.resolve()`，不用 `@Inject`。

## 3. 全局 Service 职责

| Service | 职责 |
|---|---|
| `AuthService`（注册排首） | 启动时从 SecureStore 恢复会话、`GET /me` 校验；login / register / logout；资料修改（昵称、头像、改密码）；登录态变化发 `auth:changed` |
| `ChainListService` | 我的链列表 + 各链角色；监听 `auth:changed` 重拉；链资料变更后发 `chain:changed` |
| `NotificationService` | 未读数 + 通知列表、标记已读、payload 解析（跳转目标 = moment id / chain id） |

发布是会话型状态，**不做全局**：`ComposeService` 是 `features/compose/` 的页面级 Service，随 modal 销毁。

## 4. 页面 Service 与数据流

- 每个页面 Service 持有自己的列表/详情/表单态与游标；feed / 链详情用 `(happened_at, id)` 复合游标分页（沿用 api-client 现有接口形态）。
- 异步方法的 loading/error 走 `$model.<method>` 单通道呈现（与 web 登录页错误横幅同一约定）；表单校验错误就近展示。
- 跨域刷新只走 `'global'` 事件，Service 之间不互调 load：
  - `moment:changed`（发布/编辑/删除后）→ feed 与链详情各自重拉
  - `comment:changed` → moment 详情重拉
  - `chain:changed` → 链列表、链详情重拉
  - `auth:changed` → 各列表 Service 清空并重拉
- 链详情页按当前用户在该链的 role（来自 `ChainListService`）控制发布按钮与设置入口：editor 及以上可发布，owner 可见危险区。

## 5. 功能补齐清单

### 5.1 链设置页（`app/chains/[chainId]/settings.tsx` + `features/chain-settings/`）

- 资料：链名、描述、封面（owner 可改）。
- 成员：列表 + 角色展示；owner 可改角色（不可改为 owner）、移除成员。
- 邀请：owner/editor 生成邀请链接（复制分享）。
- 分享链接：创建 / 列表 / 吊销（「给长辈看这条链」）。
- 危险区（owner）：转让 owner、删除链。

### 5.2 「我」页（`app/(tabs)/me.tsx` + `features/me/`）

- 头像 + 昵称主体；邮箱展示。
- 修改昵称、换头像（走媒体上传管线）、修改密码。
- 退出登录。
- tab 从 3 个变 4 个：时间线 / 链 / 通知 / 我。

### 5.3 通知跳转

- 通知列表项点击 → 按 payload 中的 moment id 跳 `/moments/:id`；目标已软删时优雅降级（详情页提示「内容已删除」）。

## 6. 媒体与上传（不动）

沿用现有管线：`lib/media.ts`（expo-image-picker 选图 / 压缩）、`lib/rn-put.ts`（直传 PUT：Blob 走 XHR，FilePart 按分片读盘）、api-client 的 presign / parts / complete。发布页 Service 持有草稿（文本 / 媒体项 / happened_at / 标签），提交走显式动作，不做 effect 链式 setState。

## 7. 删除项

- 依赖：`@tanstack/react-query`、`zustand`。
- 代码：`src/lib/query.ts`、`src/lib/keys.ts`、`src/lib/auth.tsx`、`src/lib/push.ts`。
- 组件里所有 `useQuery` / `useMutation` / `queryClient.invalidateQueries` 替换为页面 Service + `'global'` 事件。

## 8. 错误处理与验证

- 错误：统一走 `$model` 单通道；401 由 api-client token 刷新兜底，刷新失败 → `AuthService` 清空会话 → 跳登录。
- 验证：
  - `pnpm lint`、tsc（`pnpm build` 过类型）。
  - iOS 模拟器手测主流程：注册/登录 → 时间线浏览与分页 → 发布 text/media moment → 链详情评论/表情 → 链设置（改资料/邀请/分享链接/成员）→ 通知跳转 → 修改资料/退出登录。
  - 可用 rab-rn-debug skill 对模拟器上的 Service 状态做断言调试。

## 9. 迁移顺序（实施计划据此拆分）

1. 基建：装 `@rabjs/react`，`_layout.tsx` 注册全局 Service，写 `AuthService` / `ChainListService` / `NotificationService`。
2. auth 页（登录/注册）迁移——最小闭环先跑通。
3. feed / chains 列表 / 链详情 / 时刻详情迁移（核心读路径）。
4. 发布 / 新建链迁移（写路径 + 事件扇出）。
5. 通知页迁移 + 点击跳转。
6. 新增链设置页、「我」页。
7. 删 TanStack Query / zustand / push.ts，全局清扫验证。
