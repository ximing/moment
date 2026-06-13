# 时刻 Moment — App 端 moment 编辑/删除 Design

> 日期：2026-08-18
> 状态：设计已与用户对齐（编辑深度 = 对齐 web 全量编辑；入口 = 详情页 + 卡片长按）
> 范围：仅 `apps/app`。不改 server / dto / api-client（`updateMoment` / `deleteMoment` / `PatchMomentInput` 均已存在）。
> 权威边界：服务端规则听 `2026-08-15-moment-design.md`（仅作者可改，媒体与类型不可改）；状态分层听 `2026-08-18-app-mvp-rab-design.md`。

## 0. 背景

api-client 已有 `updateMoment(momentId, PatchMomentInput)` 与 `deleteMoment(momentId)`，web 端已用（compose-panel 编辑模式 / moment-sheet 删除）。App 端无任何编辑/删除入口，发布主场景在手机上无法改错字、删错发。

## 1. 服务端契约（现状，不动）

- `PatchMomentInput`：`content? / happenedAt? / happenedTzOffset? / isBackfill? / tagIds?`，`.strict()` 拒绝 `type` / `mediaIds`。
- 权限：仅作者本人（`NOT_MOMENT_AUTHOR`）+ 链成员资格。
- web 端编辑语义（对齐目标）：时间没改就不传 `happenedAt`；改了才传并重算 `isBackfill`。

## 2. compose 编辑模式

### 路由与数据流

- `app/compose.tsx` 增加可选参数 `momentId`：`router.push({ pathname: '/compose', params: { momentId } })`。
- `ComposeService` 增加编辑态：
  - `edit: MomentResponse | null`、`get isEdit`。
  - `hydrate(chainId?, momentId?)`：有 `momentId` 时走 `loadForEdit`（`client.getMoment` → 预填草稿），否则走现有新建分支。
  - 预填：`content`、`tagIds`、`type`、`isBackfill`；`happenedAt` 用原始墙钟毫秒（`Date.parse(iso) − tzOffset·60_000`）构造 Date，picker 的本地字段即显示记录时区的墙钟（与 `formatMomentTime` 同源语义）。
- **编辑态 UI 收敛**：类型 SegmentBar、选链 chip、选图/选视频区全部隐藏（server 不允许改）；媒体用现有 `MediaGrid` 只读展示；按钮文案「发布」→「保存」。
- **提交**：`submit()` 有 `edit` 时走 `submitEdit()`：
  - 前置校验同新建（文字类型非空、≤5000 字）。
  - patch 基础为 `{ content, tagIds }`；`happenedAt.getTime() !== 原始墙钟毫秒` 时按记录时区还原 ISO（`+ tzOffset·60_000` 再 toISOString）并重算 `isBackfill`（`< now − 10min`）。
  - 成功 emit `moment:changed { op: 'update' }`（feed / 链详情 / 详情页已监听自动重拉）。

## 3. 删除

- `MomentPageService.deleteMoment()`：`client.deleteMoment` → emit `moment:changed { op: 'delete' }`。详情页自身对该事件的既有处理（`deleted = true` → 「该时刻可能已被删除」）之外，组件在删除成功回调里 `router.back()`（详情页自己是作者刚删的目标，回退比停留占位更顺）。
- 删除均经确认弹窗（`Alert.alert` destructive）。

## 4. 入口

### 4.1 详情页（`features/moment/`）

- 头部操作区（作者本人可见，`useService(AuthService).user.id === m.author.id`）：「编辑」→ `router.push('/compose', { momentId })`；「删除」→ 确认 → `service.deleteMoment()`。

### 4.2 卡片长按（feed + 链详情两处列表）

- `MomentCard` 加可选 prop `onLongPress?: () => void`（`Pressable` 原生支持）；组件本身不含权限判断。
- 两处列表（`features/feed`、`features/chain-home`）传 `onLongPress`，仅 `item.author.id === 当前用户 id` 的卡片生效。
- 长按弹 `ActionSheetIOS`（iOS）/ `Alert.alert` 三按钮（Android）：「编辑」「删除」（destructive，二次确认）「取消」。编辑 → `router.push('/compose', { momentId })`；删除 → `client.deleteMoment` → emit `moment:changed { op: 'delete' }`。
- 删除动作放一个小工具函数（如 `src/features/compose/delete-moment.ts` 或就近组件内联），不进任何全局 Service——它是一次性 API 调用 + 事件，无跨页状态。

## 5. 错误处理

- 编辑加载失败：compose 显示加载/失败态（`$model.loadForEdit` 单通道），可返回。
- 提交失败：沿用现有「前置校验 Error 中文 message 直接展示，ApiError 走 humanError」分流。
- 非作者在服务端被 `NOT_MOMENT_AUTHOR` 403 拦截（入口已隐藏，此处只是兜底）。

## 6. 验证

- `pnpm lint` + tsc（`pnpm build` 过类型）。
- iOS 模拟器手测：编辑文本/标签 → 列表与详情刷新；改发生时间 → 时间显示变化且补发标记正确；不改时间提交 → 不传 happenedAt（抓包或服务端日志确认）；删除 → 列表消失、详情页回退；非作者卡片长按无菜单、详情页无入口。
