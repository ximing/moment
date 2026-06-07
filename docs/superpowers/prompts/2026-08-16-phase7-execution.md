# Phase 7 开发执行 Prompt（@moment/app：Expo RN 全功能 + 分片上传 + Expo Push）

> 用途：交给一个全新开发 Agent 执行 `docs/superpowers/plans/2026-08-15-phase7-expo-app.md`（3 轮评审 + 2 轮修复完成；第 3 轮残留 1 阻塞 + 1 高 + 3 中 + 4 低，已整理为下方「计划勘误表」，**勘误与计划正文冲突时以勘误为准**）。
> 使用方式：以下「Prompt 正文」整段复制给新 Agent。

## Prompt 正文

你是「时刻 Moment」项目的开发执行 Agent。任务：按实施计划完成 Phase 7 全部 7 个 Task 的开发，创建 `apps/app`（@moment/app，Expo RN）。

### 必读文件（动手前按序读完）

1. `docs/superpowers/plans/2026-08-15-phase7-expo-app.md` —— **实施计划本体（执行依据，代码以计划为准；与本 prompt 勘误表冲突时，以勘误表为准）**
2. `docs/superpowers/plans/CONVENTIONS.md` —— 跨计划契约与工程约定
3. `docs/superpowers/plans/2026-08-15-phase6-api-client-web.md` —— api-client 契约来源（含 `UploadMediaInput.fileUri`/`PutFn`/`FilePart` 扩展段）
4. `docs/superpowers/specs/2026-08-15-moment-design.md` —— spec（仅用于理解背景）

### 前置检查（开工前完成并报告）

- 确认 Phase 1–6 产物存在：`packages/dto`、`packages/api-client` 可被 workspace 引用，`apps/server` 可启动。
- **重点核对 api-client 是否已含 fileUri 契约扩展**：`UploadMediaInput` 的可选 `fileUri` 字段、`PutFn` body 联合类型 `FilePart`、默认 `xhrPut` 对 `FilePart` 拒收报错。若 Phase 6 落地代码早于该扩展、尚未实现：先按 Phase 6 计划中「fileUri 扩展」段的契约为 `packages/api-client` 补齐（含测试），单独 commit（`feat(api-client): UploadMediaInput fileUri/putWithProgress 扩展`），再开始 Task 1。**禁止改变既有 Blob 路径行为。**
- 记录环境前置：pnpm 10.22+、Node ≥ 20；iOS/Android 模拟器可用；推送验收需真机 + Expo 账号（`eas init` 已在 moment 项目下执行，`EAS_PROJECT_ID` 可取得）。

### 执行方式

用 TaskCreate 建立 7 个 Task 逐个跟踪，**严格按 Task 1→7 顺序串行执行**（Task 间有 Consumes/Produces 依赖）。每个 Task 的工作循环：

1. 通读该 Task 全文（Files/Interfaces/Steps），按计划创建/修改/删除文件，代码采用计划给出的实现（叠加勘误表修正）；
2. 执行该 Task Steps 中声明的验证命令（typecheck/lint/expo export/模拟器冒烟），必须全绿才进入下一个；`expo start --ios` 是常驻进程，确认起包后 Ctrl-C 退出再继续；
3. 验证通过后 `git commit`（信息格式：`feat(app): Task N ...`；Task 1 含仓库根 `.npmrc` 时一并 add 并在 commit message 注明），commit 前只 add 本 Task 涉及的文件；
4. 遇到计划与实际落地代码冲突：先查勘误表，仍无解则停下来报告，不自行发挥绕过；**禁止修改 server 行为、禁止改其他 Phase 的计划文件**。

验证命令速查（以计划各 Task Steps 声明为准）：`pnpm --filter @moment/app typecheck|lint`、`pnpm --filter @moment/app export:check`、根目录 `pnpm lint`。

### 计划勘误表（第 3 轮评审结论，逐条强制应用）

**B1（阻塞）— 媒体展示鉴权**：`GET /api/media/:id` 是 `@Authorized()` 端点，计划中 `MediaGrid`/moment 详情页直塞 `client.mediaUrl(m.id)` 给 `<Image>`/`useVideoPlayer` **必 401**，feed/链时间线/详情页全部媒体不可用。也不能用 `source={{ uri, headers: { Authorization } }}`（headers 被原生 loader 带过 302 到预签名 S3 URL，签名+Authorization 并存会被 S3 拒绝）。**执行时改为**：新增 `useMediaUri(mediaId)` hook —— `client.fetchMediaBlob(mediaId)`（自带 Bearer + follow 302）拿 Blob → expo-file-system 写入 CacheDirectory 得 `file://` URI（图片可用 base64 data URI）→ 供 `<Image>`/`useVideoPlayer` 使用，组件卸载删除缓存文件；`MediaGrid`、moment 详情页、`mediaAbsolute` 全部改走该 hook。忽略计划 Global Constraints 中「媒体展示一律 mediaUrl(id) 直塞/跟随 302」的表述（与 Phase 6 硬契约冲突，按 Phase 6「整段加载、无 Range seek」取舍执行）。

**H1（高）— push token 字段名**：注册调用必须是 `client.registerPushToken({ expoToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })`。计划中若写作 `{ token, ... }` 一律改正（dto 契约为 `expoToken`，写错则 typecheck 失败/运行时 400 且被吞错，推送静默全灭）。

**M1 — 登出清 push 缓存**：`logout()` 中同步 `SecureStore.deleteItemAsync('moment.push.token')`，否则同设备换账号后推送注册被本地判等跳过、新账号收不到推送。

**M2 — expo-env.d.ts 入库**：Task 1 显式创建并提交 `apps/app/expo-env.d.ts`（内容 `/// <reference types="expo/types" />`），否则全新 checkout 上 tsconfig include 该文件首跑 typecheck 必报 TS6053。

**M3 — 邀请页按钮禁用条件**：`app/invites/[token].tsx` 的「接受邀请」按钮仅对终态错误（`INVITE_EXPIRED`/`INVITE_ALREADY_ACCEPTED`/`INVITE_EMAIL_MISMATCH`）禁用；网络类错误不禁用，允许重试。

**L1 — 建链文案**：名称限制文案用「1–100 字」（dto 实际 `max(100)`），计划中「1–50 字」是笔误。

**L2 — 错误码中文映射**：TagsView onCreate 等处失败提示做中文映射（`TAG_EXISTS`→「标签已存在」、`TAG_LIMIT_REACHED`→「标签已达上限 100 个」），不裸显 UPPER_SNAKE 机器码。

**L3 — rnPut 预检 abort**：`rnPut` Promise 构造开头加 `if (signal?.aborted) { reject(new ApiError('已取消', 0, 'ABORTED')); return; }`，与 `xhrPut` 行为对齐。

**L4 — 通知点击去重**：`useNotificationRouting` 记录 `lastHandledResponseId`（`response.notification.request.identifier`），`getLastNotificationResponseAsync` 补偿跳转与 response listener 共用去重，避免冷启动双跳。

### 关键红线（评审轮次中反复出错的点，执行时自查）

- 组件里**禁止裸 fetch**，一律走 `@moment/api-client`；媒体加载只走 B1 勘误的 `useMediaUri`（fetchMediaBlob + file:// URI + 卸载清理），**禁止**把 `mediaUrl(id)` 直塞 `Image`/video source；
- 上传：分片/每片重试/进度由 `client.uploadMedia` 承担，App 端 `rnPut` 走 `FilePart { fileUri, start, end, size, mime }` 按区间读盘（expo-file-system 新 File API），**禁止**整文件 `fetch(uri).blob()`（500MB 视频必 OOM）；complete 幂等，网络类错误（status 0 或 ≥500）整包重试 ≤2 次，4xx 不重试；
- 「我的表情」高亮只用 `moment.myReaction === emoji`（`ReactionSummary` 无 `mine` 字段）；评论/通知列表消费 `{ comments, nextCursor }`/`{ notifications, nextCursor }` 包装对象，`useInfiniteQuery` + `limit: 50` 翻页；「全部已读」须翻页收集全部未读 id 分批 ≤100 提交（`markNotificationsRead(ids: string[])` 无「空=全部」语义）；
- `happenedTzOffset` 发送 `happenedAt.getTimezoneOffset()` 原值（东八区 = -480）；时间展示用 UTC getter（同 Phase 6 `formatHappenedAt`）；
- 登录/注册：`await secureTokenStore.setTokens(...)` 后再注册 push；push 注册整体吞错不阻断登录；冷启动鉴权仅 401 登出，网络错误（status 0）保留用户态；
- 常量（500MB/5min/分片 10MB/REACTION_EMOJIS）唯一来源 `@moment/dto`，App 内零复制；query key 统一走 `src/lib/keys.ts` 的 `qk` 工厂；
- 深链接：scheme `moment`，邀请 `moment://invites/<token>` ↔ `app/invites/[token].tsx`（复数，勿改单数）；通知跳转 `data.momentId` → `/moments/<id>`。

### 完成标准（Task 7）

计划 Task 7 的全量验证：`pnpm --filter @moment/app typecheck|lint|export:check` 全绿 + 根 lint 绿。DoD 手动验收清单逐条执行并记录结果；模拟器可验项（登录/注册、feed 过滤与无限滚动、链详情、发布含上传、评论/表情、邀请深链接 simctl openurl）必须全过；真机专属项（推送权限→token 落库→横幅点击热/冷启动跳转）无真机时标注「未验证 + 原因」，不得跳过不记。

### 最终报告格式

- 7 个 Task 的状态（完成/偏差）与对应 commit hash（含前置检查可能产生的 api-client fileUri 扩展 commit）；
- 验证结果汇总（各命令输出结论）；
- DoD 手动验收清单执行结果（逐条 ✓/✗/未验证+原因）；
- 勘误表 10 条的应用情况（逐条 已应用/计划正文本已正确）与执行中发现的计划文档问题（如有）。
