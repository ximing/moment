# Phase 6 开发执行 Prompt（@moment/api-client + @moment/web）

> 用途：交给一个全新开发 Agent 执行 `docs/superpowers/plans/2026-08-15-phase6-api-client-web.md`（已评审通过，commit `32a74cf`）。
> 使用方式：以下「Prompt 正文」整段复制给新 Agent。

## Prompt 正文

你是「时刻 Moment」项目的开发执行 Agent。任务：按已评审通过的实施计划，完成 Phase 6 全部 11 个 Task 的开发。

### 必读文件（动手前按序读完）

1. `docs/superpowers/plans/2026-08-15-phase6-api-client-web.md` —— **实施计划本体（唯一执行依据，代码逐字照抄计划，不自行发挥）**
2. `docs/superpowers/plans/CONVENTIONS.md` —— 跨计划契约与工程约定
3. `docs/superpowers/specs/2026-08-15-moment-design.md` —— spec（仅用于理解背景）

### 前置检查（开工前完成并报告）

- 确认 Phase 1–5 产物存在：`apps/server` 可启动、`packages/dto` 可引用。若计划引用的 Phase 5 符号（如 `CommentListResponse`、`NotificationListResponse`、`REACTION_EMOJIS`）尚未落地，**以计划「Phase 5 依赖契约」段为准做等价映射，禁止反向修改 server**。
- 计划「等价映射」条款覆盖 Phase 2–5 符号（如 `PatchMomentInput`/`UpdateMomentInput` 以 dto 实际导出为准做别名映射；`MomentListResponse` 若 dto 仍为 items 键则用计划规定的 `Pick<FeedResponse,...>` 规避）。
- 记录环境前置：docker mysql（`docker compose up -d mysql`）、S3 桶 CORS（`AllowedMethods: GET, PUT` / `AllowedOrigins: http://localhost:5173` / `ExposeHeaders: ETag`，见计划 Global Constraints 媒体条目）。

### 执行方式

用 TaskCreate 建立 11 个 Task 逐个跟踪，**严格按 Task 1→11 顺序串行执行**（Task 间有 Consumes/Produces 依赖）。每个 Task 的工作循环：

1. 通读该 Task 全文（Files/Interfaces/Steps），按计划创建/修改文件，代码逐字采用计划给出的实现；
2. 执行该 Task Steps 中声明的验证命令（test/typecheck/build/lint），必须全绿才进入下一个；
3. 验证通过后 `git commit`（信息格式：`feat(api-client): Task N ...` / `feat(web): Task N ...`），commit 前只 add 本 Task 涉及的文件；
4. 遇到计划与实际落地代码冲突：按前置检查的等价映射原则处理，并在最终报告中记录偏差；**禁止修改 server 端行为、禁止改其他 Phase 的计划文件**。

验证命令速查（以计划各 Task Steps 声明为准）：`pnpm --filter @moment/api-client test|build|lint`、`pnpm --filter @moment/web typecheck|build|lint`、根目录 `pnpm lint`。

### 关键红线（评审轮次中反复出错的点，执行时自查）

- 组件里**禁止裸 fetch**，一律走 `@moment/api-client`；`mediaUrl(id)` **禁止**直接塞进 `<img>/<video>` src（必 401），媒体加载只走 `fetchMediaBlob` + objectURL（卸载/移除时 revoke）；
- refresh 语义：无 refreshToken 的 401 不进 refresh 分支直接抛；重放后仅 401 才 `clear()`；feed/通知/评论游标用 `useInfiniteQuery`（`limit: 50`），「全部已读」须翻页收集全部未读 id 再分批 ≤100 提交；
- reaction 端点是 204 空 body，成功后 invalidate `qk.moment`，不得读响应体；emoji 白名单只从 `@moment/dto` 的 `REACTION_EMOJIS` 导入；
- 评论上限 1000；`registerPushToken` 字段是 `{expoToken, platform}`；
- api-client 的 typecheck 必须经 `tsconfig.test.json` 覆盖测试文件。

### 完成标准（Task 11）

计划 Task 11 的全量验证：三个包 test/typecheck/build/lint 全绿 + 根 lint 绿。手动验收清单（Step 2 的 11 组逐页步骤）逐条执行并记录结果；环境依赖（S3 CORS 等）不可用时，标注「未验证 + 原因」而非跳过。

### 最终报告格式

- 11 个 Task 的状态（完成/偏差）与对应 commit hash；
- 验证结果汇总（各命令输出结论）；
- 手动验收清单执行结果（逐条 ✓/✗/未验证+原因）；
- 所有「等价映射」偏差清单（如有）。

## 附：调度背景（不随 Prompt 下发）

- 计划经 3 轮评审 + 3 轮修复通过（第 1 轮 2 阻塞/2 高/6 中/4 低；第 2 轮 1 阻塞/1 高/3 中/7 低；第 3 轮 0 阻塞/1 高/2 中/5 低，全部修复）。
- 已声明的有意取舍：媒体整段加载（无流式 seek/缓存复用），Phase 8 引入 `?st=` 签名方案时解决。
