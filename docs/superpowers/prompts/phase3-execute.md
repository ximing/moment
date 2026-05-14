# Phase 3 执行 prompt（计划已评审通过，粘贴给执行 Agent）

请执行 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase3-moments-media.md 这份实施计划（时刻 Moment 项目 Phase 3：时刻与媒体——moments 三类型 + S3 预签名/multipart 上传 + outbox 基建）。

## 第 0 步：先读背景，再核对前置（不通过则停止）

先读完以下文件再动手：
1. 上述计划文件（全文，逐 Task，含 Global Constraints 与「留给后续 Phase 的接缝」）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 跨计划接口契约（引用符号不得改名）
3. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md 的 §1（moment 三类型）、§3（media/moments/outbox 表）、§4（Moments/Media API）、§5.3（存储抽象与媒体读取）、§5.5（上传管线）、§5.6（时区）

前置核对（计划假设 Phase 1-2 已落地，开工前逐项确认符号真实存在且签名一致）：
- Phase 1：`apps/server/src/config.ts` 的 envSchema（含 Phase 2 追加的 `INVITE_TTL_DAYS`——本计划在其后**插入** S3/PRESIGN 字段，严禁整体替换 schema）；`HttpError`；`@Authorized` 装饰器与 currentUser resolver；`tests/helpers/db.ts` 的 `resetDb`/`closeDb`；`app.ts` controllers 数组。
- Phase 2：`src/chains/chain-policy.ts` 的 `ChainPolicy.require(userId, chainId, minRole)`（404 CHAIN_NOT_FOUND / 403 CHAIN_ROLE_INSUFFICIENT）；`src/chains/require-chain-role.ts` 的 `requireChainRole(minRole)`；chains/chain_members/chain_invites 表；`ChainService.remove` 的事务注释锚点（Task 8 Step 4 要在该锚点处补 media→moments 级联，先核对锚点存在）。
- Phase 2 遗留边界：`requireChainRole` 的 passwordChangedAt 已知瑕疵按计划说明对待，不在本计划修复范围。
- **若符号缺失或签名与计划描述不符，停下来报告，不要自行发挥。**

## 执行规则

1. 工作目录 /Users/ximing/project/mygithub/moment。开工前从 main 切出新分支 `feat/phase3-moments-media`。
2. 严格按计划 Task 1→9 顺序执行，每个 Task 内 Steps 逐步来：写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → commit。不跳步、不合并 Task、不擅自改设计。
3. 计划中的代码是完整的，照写即可；发现计划代码有错误时停下来报告，不要绕过。Task 2 Step 2 的 config 修改是**插入式**片段；Task 8 Step 4 改 `chain.service.ts` 时 import 按计划括注「保持 Phase 2 原样、仅追加」。
4. 计划已写入的硬性红线，违反必返工：
   - `momentSerializer` 是 moment 序列化唯一出口；media 只出 `{id, url: '/api/media/:id', ...}` 相对路径，**严禁**内嵌预签名 URL；
   - `create()` 事务内只 copy + 更新 DB 行，tmp 对象的 `deleteFile` 必须在**事务成功提交后**执行；
   - 预签名 GET 的签名时刻按小时窗对齐（`alignedGetPresign` 返回 `{signingDate, expiresIn}`，`getSignedUrl` 传 `signingDate`），保证同窗 URL 全等；
   - multipart parts 的升序排序钉在 service 层（adapter 收到的必须是已排序数组）；
   - mime 用白名单（`IMAGE_MIME_TYPES`/`VIDEO_MIME_TYPES`），`image/svg+xml` 双重拒绝（dto + `getContentType` 强制 octet-stream）；
   - `.for('update')` 行锁（create 绑定 media）与条件更新抢占（complete/abort 的 `WHERE status='uploading'`）不得简化为先读后写。
5. 环境事实（已就绪）：
   - apps/server/.env 已存在，含测试库 MySQL 连接与 S3 配置（严禁提交进 git，.gitignore 已覆盖）。
   - 包管理器 pnpm 10.22+，Node ≥ 20。
   - 测试打 .env 指向的 MySQL 测试库（moment_test_db），严禁生产库；每个触库测试文件 afterAll(closeDb)；新表（media/moments/outbox）必须扩展 tests/helpers/db.ts 的 resetDb。
   - 单测全程 mock 存储 adapter（`setStorageAdapter` 注入点）；真实桶 smoke 仅 `RUN_S3_IT=1` 时跑，默认跳过——不要因为没有真实桶凭据而卡住。
6. 每完成一个 Task 按计划里的 commit 命令提交（conventional commits）；测试不通过不许进入下一个 Task。
7. 全部完成后做计划末尾 DoD 的全部验证项（typecheck/test/build/lint + 手动验收清单；S3 相关手动项无真实桶时可标注跳过原因）。

## 评审残留问题（执行时顺手处理，属计划授权范围）

以下是计划终审的残留低危项，在对应 Task 执行时按下述修法处理（均为注释/一行级改动，不改设计）：
- 【低，Task 5 complete()】合片成功后置 `uploadId=null` 的注释中补一句：若该持久化本身失败（崩溃窗口），重试会打出 NoSuchUpload → 500，由客户端重新 presign 兜底。
- 【低，Task 5 abort()】`abortMultipart` 先于条件 UPDATE 发起的 S3 侧窄竞态（并发 complete 已消费 uploadId → NoSuchUpload → 500）：按计划实现不改顺序，但在方法注释中声明该取舍；若实现时发现可无风险地调换顺序（先条件更新抢到行再调 S3），可调换并同步测试。
- 【低】Task 5/7/8 的 app.ts controllers 示例仅为参考基线，实际以当前文件数组为准**仅追加**，严禁照抄丢项（尤其 AuthController/InvitesController）。

## 最终回复格式

报告：每个 Task 的完成状态与 commit hash、测试通过数量（各文件用例数）、DoD 验证结果、残留问题 3 条的处理情况、以及执行中发现的计划文档问题（如有）。
