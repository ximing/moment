# Phase 8 开发执行 Prompt（分享与加固：share_links + 匿名公开页 + sweeper + 生产部署）

> 用途：交给一个全新开发 Agent 执行 `docs/superpowers/plans/2026-08-15-phase8-share-hardening.md`（3 轮评审 + 3 轮修复完成，第 3 轮无阻塞/无高危、残留 2 低已修，**无需勘误表**）。
> 使用方式：以下「Prompt 正文」整段复制给新 Agent。
> 编排说明：计划 2400+ 行、11 个 Task，采用「调度主 Agent + 每 Task 一个执行 SubAgent」模式——每个执行 SubAgent 拿全新上下文只带单个 Task；调度方亲自验收（重跑测试 + 核对改动范围）后才 commit，冲突即停上报。

## Prompt 正文

你是调度主 Agent。目标：忠实执行已通过 3 轮评审的 Phase 8 实施计划
`/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase8-share-hardening.md`
共 11 个 Task。**你不亲自写代码**，每个 Task 派一个执行 SubAgent 完成（用 Agent 工具），你负责：读计划 → 派发 → 验收（跑命令核实）→ commit → 派下一个。

### 开工前必读（你自己先读，并在每个执行 SubAgent 的 prompt 里附上路径要求先读）

1. `docs/superpowers/plans/CONVENTIONS.md` —— §3 契约是跨 Phase 接口唯一权威，符号逐字一致，禁止改名
2. `docs/superpowers/plans/2026-08-15-phase8-share-hardening.md` —— 唯一任务来源
3. `docs/superpowers/specs/2026-08-15-moment-design.md` —— 设计意图参考

前置检查（开工前完成并报告）：确认 Phase 1–7 产物存在——`packages/dto`、`packages/api-client`、`apps/server`、`apps/web` 可被 workspace 引用且 `pnpm build && pnpm lint && pnpm test` 基线全绿。基线不绿先报告，不在烂基线上开工。

### 执行 SubAgent 的 prompt 模板（每 Task 填充后原样派发）

---
你负责执行 Phase 8 计划的 **Task N：<标题>**。先读三份背景文件（路径见上），再读本计划中 Task N 的完整内容及其 Consumes 列出的前序符号的真仓源码（动手前核实签名存在且一致）。

规则：
1. 严格按 Task N 的 Step 顺序执行。后端部分走 TDD：先写/改测试，跑到计划写明的预期红灯（Expected: FAIL 内容不符 = 停下来报告，不要继续），再实现到转绿。
2. 工程铁律：ESM NodeNext 相对 import 带 .js；业务错误用 HttpError 系、message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example；api-client 测试用 node:test + node:assert/strict（禁止 expect）；计划中的代码完整照写，不得自行简化、改名或"优化"。
3. 冲突处理：计划与真仓现实不符（符号不存在、签名不同）时，停下来在最终回复里报告冲突详情（计划位置 vs 真仓现状），不要擅自改设计；纯机械差异（行号偏移、import 顺序）可自行适配并注明。
4. 完成后跑本 Task 指定的验证命令（无指定则 `pnpm build && pnpm lint && pnpm test` 的局部等价），全部通过才算完成。**不要 git commit**（由调度方统一提交）。
5. 部署/脚本类 Task：按「命令 + Expected 预期输出」逐项验证，输出不符即报告；Docker/S3 凭据不可用时完成能验证的部分（dry-run、compose config 校验）并明确列出跳过项。

最终回复只返回：完成状态（完成/受阻）、改动文件清单、验证命令及结果摘要、冲突或偏差说明（如有）。
---

### 调度流程（每 Task 一轮）

1. 从计划中提取 Task N 的标题、范围、验证命令，填模板派发执行 SubAgent。
2. 收到完成回复后**亲自验收**：复核其声称的验证结果（重跑关键测试命令），检查改动文件与计划 Files 清单一致、无计划外改动（`git status --short`）。
3. 验收通过：按该 Task 末尾给出的 commit message 提交（含计划要求的关联文件——**Task 3 需同 commit 更新 CONVENTIONS.md §3.6 Phase 8 行追加 `/api/share-links/:id`**），commit 前只 add 本 Task 涉及的文件。
4. 验收失败或 SubAgent 报告受阻/冲突：派修复 SubAgent（带上失败输出）或把冲突详情报告给我等待指示，不要带病进入下一 Task。
5. Task 间有依赖（Task 3 依赖 1-2 的表与 DTO；Task 4-5 依赖 3 的 service；Task 8 依赖 4 的 API 与 dto；Task 11 收尾依赖全部），严格按 1 → 11 顺序，不并行。

### 关键红线（评审轮次中反复出错的点，验收时自查）

- 匿名鉴权边界：`?st=` 存在即走 share 校验并忽略登录态；token 无效/过期/吊销 → 404 `SHARE_NOT_FOUND`；跨链/未绑定/软删 moment 媒体 → 404 `MEDIA_NOT_FOUND`；无 st 未登录维持 401。
- sweeper：`deleteFile` 失败**不删行**保留下轮重试（abort 失败可照删行）；两个 sweep 查询带 `ORDER BY` FIFO；dry-run 只打日志不动数据。
- share_links 三个 timestamp 列为 `fsp: 3`（特例，消除列表倒序同秒并列 flaky）。
- worker 复用单循环按 `SWEEPER_INTERVAL_MS` 节拍运行，**不引 node-cron**；`handleMomentDeleted` 是**整体替换已有 no-op 函数体**，注册表行不动。
- express-rate-limit 升 v8，自定义 keyGenerator 全走 `ipKeyGenerator(req.ip, 56)`；share-links 管理端点与 media `?st=` 不加限流（理由已在计划落档）。
- backup sidecar 的 mysqldump 必须带 `--no-tablespaces`（库级授权无 PROCESS）；恢复演练全程用 root；AWS 凭据映射在 backup.sh 内做（compose `${}` 插值读不到 env_file）。

### 验收（DoD，全部满足后向我汇报）

- 11 个 Task 全部完成，每个有独立 commit，message 与计划一致
- `pnpm build && pnpm lint && pnpm test` 全量回归全绿
- Task 11 的生产 compose 手工验证清单逐项执行并记录（不可用项注明原因）
- 最终汇报：每 Task 状态 + commit hash、测试总数变化、验证清单勾选、遗留问题

现在开始：先做前置检查并报告基线状态，然后派发 Task 1。
