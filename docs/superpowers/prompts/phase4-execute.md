# Phase 4 执行 prompt（计划已评审通过，粘贴给执行 Agent）

请执行 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md 这份实施计划（时刻 Moment 项目 Phase 4：标签与聚合时间线——tags + 复合游标 feed）。

## 第 0 步：先读背景，再核对前置（不通过则停止）

先读完以下文件再动手：
1. 上述计划文件（全文，逐 Task）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 跨计划接口契约（引用符号不得改名）
3. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md 的 §3（tags/moment_tags 表）、§4（Tags/Feed API）、§5.1（Feed 查询）、§5.6（补发可见性）

前置核对（计划假设 Phase 1-3 已落地，开工前逐项确认符号真实存在且签名一致）：
- Phase 2：`src/chains/chain-policy.ts` 的 `ChainPolicy.require(userId, chainId, minRole)`、`src/chains/require-chain-role.ts` 的 `requireChainRole(minRole)`；chains/chain_members/invites 表与迁移。
- Phase 3：moments/media 表与迁移、`MomentService`、`momentSerializer`（src/moments/moment-serializer.ts）、`emitOutbox`（src/outbox/outbox.ts）、存储 adapter。
- 特别核对计划「Phase 2/3 依赖契约」小节列出的 requireChainRole 四条前置要求（自解析 Authorization header 取 userId、匿名 next() 放行交 @Authorized 产 401、async 错误 try/catch 后 next(err)、passwordChangedAt 已知瑕疵）。**若 Phase 2 实现不满足，按计划给出的等价移植规则改实现（不改签名）；若符号缺失或差异超出计划预期，停下来报告，不要自行发挥。**

## 执行规则

1. 工作目录 /Users/ximing/project/mygithub/moment。开工前先从 main 切出新分支 `feat/phase4-tags-feed`。
2. 严格按计划 Task 1→8 顺序执行，每个 Task 内 Steps 逐步来：写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → commit。不跳步、不合并 Task、不擅自改设计。
3. 计划中的代码是完整的，照写即可；发现计划代码有错误时停下来报告，不要绕过。
4. 两条已写入计划的硬性红线，违反必返工：
   - `serializeMoments` 必须在 `await db.transaction(...)` 返回**之后**调用（全局 db 连接读不到未提交的 moment_tags）；
   - 游标编解码只允许存在于 `src/feed/cursor.ts` 一处（Task 7 重构后 grep 确认）。
5. 环境事实（已就绪）：
   - apps/server/.env 已存在，含测试库 MySQL 连接与 S3 配置（严禁提交进 git）。
   - 包管理器 pnpm 10.22+，Node ≥ 20。
   - 测试打 .env 指向的 MySQL 测试库（moment_test_db），严禁生产库；每个触库测试文件 afterAll(closeDb)；新表必须扩展 tests/helpers/db.ts 的 resetDb。
6. 每完成一个 Task 按计划里的 commit 命令提交（conventional commits）；测试不通过不许进入下一个 Task。
7. 全部完成后做计划末尾 DoD 的全部验证项（typecheck/test/build/lint + 手动验收清单）。

## 评审残留问题（执行时顺手修复，属计划授权范围）

以下是计划评审的残留中/低危项，在对应 Task 执行时按下述修法处理（均为小改动，不需改设计）：
- 【中，Task 7】`packages/dto/src/moments.ts` 的 `listMomentsQuerySchema.cursor` 补 `z.string().min(1).max(1024).optional()`，使空串/超长游标返回 400 VALIDATION_ERROR 与 feed 一致；并在 Task 7 测试补一条空串 cursor → VALIDATION_ERROR 用例。
- 【低，Task 4】update 修改点增量片段与完整骨架变量名不一致时，以完整骨架（`updatedRow`）为准。
- 【低，Task 4】moment-serializer 加 import 时与既有 import 合并，不重复声明。
- 【低，Task 5】`feedQuerySchema` 的 `chain_ids` refine 回调加 `typeof v === 'string' &&` 守卫，防重复 query 参数（数组值）抛裸 TypeError → 500。
- 【低，Task 7】残留检查 grep 模式用 `base64url|nextCursor`（限定 apps/server/src/moments/），确认编解码仅剩 src/feed/cursor.ts。

## 最终回复格式

报告：每个 Task 的完成状态与 commit hash、测试通过数量（各文件用例数）、DoD 验证结果、残留问题 5 条的处理情况、以及执行中发现的计划文档问题（如有）。
