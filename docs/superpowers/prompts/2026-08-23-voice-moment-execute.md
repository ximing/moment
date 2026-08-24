# Voice Moment 执行 prompt（计划已评审通过，粘贴给执行 Agent）

你是调度主 Agent。目标：执行实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-23-voice-moment.md`（时刻 Moment — 语音时刻：新 moment 类型 voice = 1 段语音 + 0~8 附图 + ASR 异步转写回填，跨 dto/api-client/server/worker/web/app，共 14 个 Task）。

**你不亲自写任何代码、不亲自改任何文件**。一切实现、测试运行、修复、复审都通过派 SubAgent 完成（用 Agent 工具）。你只负责：读 SubAgent 的返回、判断通过与否、决定下一步派谁、维护 Task 进度、最后汇总报告。

## 第 0 步：先读背景，再核对前置（不通过则停止）

你自己先读（读文件是编排者的职责，不派 SubAgent）：

1. 上述计划文件（全文，逐 Task，特别是头部 Global Constraints 与「Spec 引用与偏差」清单）
2. `/Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-23-voice-moment-design.md` —— 对应设计 spec（已过两轮对抗性复审；计划与 spec 冲突时**停下来报告**，不自行裁决）
3. `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md` —— 跨计划接口契约（引用符号不得改名）

前置核对（开工前逐项确认，不符则停止并报告）：

- 工作区干净、在 main 分支；`pnpm build` 基线通过（dto 等依赖包先构建）。
- 计划引用的前序符号真实存在：`emitOutbox`/`DbTx`（apps/server/src/outbox/）、`ChainPolicy.require`、`serializeMoments` 与 `MomentLike`、`getLLMProvider`/`setLLMProvider` 三态范式（apps/server/src/llm/factory.ts）、processor 注册表与退避档（worker/processor.ts）、sweeper 接线点（worker/index.ts）、`installMockStorage`/`listenLocal` 测试设施。
- `apps/server/.env` 存在（严禁提交/覆盖）；新环境变量 `ASR_BASE_URL`/`ASR_API_KEY`/`ASR_MODEL` 按计划同步 config.ts 与 .env.example（.env 本地补齐即可）。

## 执行规则（红线，违反必返工）

1. 开工先切分支 `feat/voice-moment`（由第一个实现 SubAgent 执行）。
2. 严格按 Task 1→14 顺序，一个 Task 全绿才进下一个。**同一时刻只允许一个实现 SubAgent 在跑**（串行流水线，禁止并行实现——测试库是远程共享 MySQL，两个 jest 会话并行会互相污染）。
3. 每个 Task 内部是「实现 → 复审 →（修复 → 再复审）* → commit」循环，commit 由实现/修复 SubAgent 按计划给定的 conventional commit 命令执行（如 `feat(server): ...`）。
4. SubAgent 发现计划代码/事实有错误时，指令它**停下来原样报告**，由你判断：计划笔误 → 派修复 SubAgent 先改计划文档再继续；设计分歧 → 停止并向用户报告。绝不允许 SubAgent 绕过计划自行发挥。
5. 触库测试铁律（写进每个 server 相关 SubAgent 的 prompt）：只打 .env 指向的测试库，严禁生产库；`--runInBand`；每个触库文件 `afterAll(closeDb)`；supertest 必须显式绑 `127.0.0.1`（本机 Dumbo.app 会劫持 :: 上的 127.0.0.1 流量）；远程测试库偶发 ECONNRESET，单测重试一次再报失败。
6. 工程约定（写进每个实现 SubAgent 的 prompt）：ESM NodeNext 相对 import 带 `.js` 后缀；业务错误 HttpError 系、message 为 UPPER_SNAKE 机器码；新环境变量只经 config.ts（zod）；链权限走 ChainPolicy，controller 禁止手写角色判断。
7. spec 已钉死、SubAgent 不得推翻的决策：录音用 expo-audio（`recorder.uri`，非 url）；web 端 MediaRecorder → 16kHz mono WAV 转码（不收 webm）；sweeper cutoff 6h；转写回填截断 5000 字符；content/transcript 分离；create 恒 emit `moment.transcribe` + handler 判 null 落 failed；转写失败不影响语音播放。
8. 每个 SubAgent 只给它当前 Task 所需的上下文（计划文件路径 + Task 编号 + 相关红线），不要让它读全量历史。SubAgent 返回后你核对：测试真的跑了并且过了（要求贴测试输出摘要），commit 真的落了（要求贴 commit hash）。

## 每个 Task 的循环

### 派「实现 SubAgent」

prompt 模板（填充 Task 编号 N 与对应红线）：

---
你在「时刻 Moment」monorepo（/Users/ximing/project/mygithub/moment，分支 feat/voice-moment）执行实施计划 docs/superpowers/plans/2026-08-23-voice-moment.md 的 **Task N**。先读计划头部 Global Constraints 与 Task N 全文（含 Files/Interfaces/Steps），涉及的前置符号读真实代码核对。

规则：严格按 Steps 走 TDD（写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过）；代码照计划写，发现计划有误立即停止并原样报告，不得绕过；<按 Task 类型插入第 5/6/7 条相关红线>；完成后运行该 Task 指定的测试命令与 typecheck/lint，全绿后按计划给定的 commit 命令提交。

你的最终回复只返回：改动文件清单、测试输出摘要（各文件用例数与结果）、typecheck/lint 结果、commit hash、发现的计划文档问题（如有）。
---

### 派「复审 SubAgent」

实现 SubAgent 返回全绿后，派**新的** SubAgent 对抗性复审这个 Task 的 diff（`git show <hash>`）：

---
你是苛刻的技术评审，对抗性审阅 commit <hash>（对应计划 docs/superpowers/plans/2026-08-23-voice-moment.md 的 Task N，先读该 Task）。只找真实问题：与计划的逐字符合度、代码正确性（对照周边真实代码）、测试断言与实现是否真的一致、有没有漏掉计划要求的夹具同步/文档同步、有没有引入计划外的改动。不修改任何文件。

输出：## VERDICT（PASS / ISSUES_FOUND）+ 按严重度排序的问题清单（每条：文件:行号 | 问题 | 修法）。无问题写「无」。
---

ISSUES_FOUND → 派「修复 SubAgent」（把问题清单原样转发，要求逐条修复、跑测试、amend 或新 commit，由其说明选择）→ 再派新复审。单 Task 最多 3 轮修复循环，仍有 blocker 则停止并向用户报告评审原文。

### Task 14（全量门禁）

派一个 SubAgent 顺序执行 `pnpm build && pnpm test && pnpm lint`，并逐项过计划末尾的手动验收清单（能自动验证的自动验证，需要真机/浏览器的列出来标记「需人工」）。

## 最终回复格式

汇总报告：每个 Task 的状态与 commit hash、复审轮数、测试用例总数、DoD 验证结果、执行中发现的计划/spec 文档问题清单、以及遗留的「需人工」验收项。
