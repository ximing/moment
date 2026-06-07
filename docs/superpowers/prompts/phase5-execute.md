# Phase 5 执行 prompt（计划已评审通过，粘贴给执行 Agent）

请执行 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md 这份实施计划（时刻 Moment 项目 Phase 5：互动与异步——评论 + 表情 + 通知 + outbox worker + 推送）。

## 第 0 步：先读背景，再核对前置（不通过则停止）

先读完以下文件再动手：
1. 上述计划文件（全文，逐 Task）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 跨计划接口契约（引用符号不得改名；注意 §3.4 游标约束仅限 moments 分页，评论/通知各自实现游标是契约明文允许的）
3. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md 的 §3（comments/reactions/notifications/push_tokens 表）、§4（Comments/Reactions/Notifications/Devices API）、§5.1（计数）、§5.4（outbox+worker）、§5.6（补发可见性）

前置核对（计划假设 Phase 1-4 已落地，开工前逐项确认符号真实存在且签名一致）：
- Phase 2：`src/chains/chain-policy.ts` 的 `ChainPolicy.require(userId, chainId, minRole)`、`ChainRole`；chains/chain_members 表。
- Phase 3：moments/media 表与迁移、`emitOutbox`/`DbTx`（src/outbox/）、`OutboxType` 常量（src/outbox/types.ts，含 `moment.created`/`moment.deleted` 及 payload 契约 `{momentId, chainId, authorId, isBackfill}`）、`MomentService`。
- Phase 4：`serializeMoments`（含 tags 扩展，Phase 4 定稿形态为 create/update/get 均在事务提交后调用）、feed 的 `src/feed/cursor.ts`、tests/fixtures（registerUser/createChain/addMember/insertMoment 含 isBackfill/deletedAt 选项）。
- 特别核对 Phase 4 已按修订后的计划把 `tests/moments/moment-serializer.test.ts` 迁移到 extras 签名（Phase 5 Task 5 要整体替换该签名）。**若符号缺失或差异超出计划预期，停下来报告，不要自行发挥。**

## 执行规则

1. 工作目录 /Users/ximing/project/mygithub/moment。开工前先从 main 切出新分支 `feat/phase5-interactions-worker`。
2. 严格按计划 Task 1→9 顺序执行，每个 Task 内 Steps 逐步来：写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → commit。不跳步、不合并 Task、不擅自改设计。
3. 计划中的代码是完整的，照写即可；发现计划代码有错误时停下来报告，不要绕过。
4. 已写入计划的硬性红线，违反必返工：
   - `serializeMoments` 的计数查询严禁 N+1：每页评论数 / 表情分组 / myReaction 各只允许一次批量 IN + GROUP BY 查询；
   - reaction 与 push_token 的写入必须是一条 `insert(...).onDuplicateKeyUpdate(...)`（不得先查后写）；
   - outbox 轮询 claim 必须走 `FOR UPDATE SKIP LOCKED` 短事务 + 租约，push IO 在事务外执行；
   - worker 处理器测试是函数级的（直接调用 handler，不起 worker 进程）。
5. 环境事实（已就绪）：
   - apps/server/.env 已存在，含测试库 MySQL 连接与 S3 配置（严禁提交进 git）；新环境变量 EXPO_ACCESS_TOKEN / WORKER_POLL_INTERVAL_MS / WORKER_BATCH_SIZE 同步 config.ts 与 .env.example（.env 本地补齐即可，不提交）。
   - 新依赖 expo-server-sdk 按 plan 给定版本范围安装到 apps/server。
   - 包管理器 pnpm 10.22+，Node ≥ 20。
   - 测试打 .env 指向的 MySQL 测试库（moment_test_db），严禁生产库；每个触库测试文件 afterAll(closeDb)；四张新表必须按计划给定顺序扩展 tests/helpers/db.ts 的 resetDb。
6. 每完成一个 Task 按计划里的 commit 命令提交（conventional commits）；测试不通过不许进入下一个 Task。
7. 全部完成后做计划末尾 DoD 的全部验证项（typecheck/test/build/lint + 手动验收清单；worker 冒烟用 `WORKER_PID=$!` + `kill $WORKER_PID`，非交互 shell 无 job control）。

## 评审残留说明（执行时注意）

- 本计划经 3 轮评审：前两轮的阻塞/高危问题已修复并经下一轮评审独立复核通过；**第 3 轮评审发现的高危（Task 5 链内列表 `MomentService.list` 需补可选第三参 `viewerId?` 并由 controller 传入 `user.id`）与 3 条低危已按评审给出的精确修法落实进计划，但未再派第 4 轮评审独立复核**。执行 Task 5 时对该改动多加验证：确认 `GET /api/chains/:chainId/moments` 在本人视角下 `myReaction` 正确、Phase 4 既有 moments/feed 测试不被破坏。
- backfill 语义是对 spec §5.6 的澄清性决策（仍插应用内通知、仅跳过 push，payload 标 `backfill:true`），已写入计划 Global Constraints，按计划执行即可。

## 最终回复格式

报告：每个 Task 的完成状态与 commit hash、测试通过数量（各文件用例数）、DoD 验证结果（含 worker 冒烟）、Task 5 viewerId 改动的验证结果、以及执行中发现的计划文档问题（如有）。
