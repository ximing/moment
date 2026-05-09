请执行 <计划文件路径> 这份实施计划（时刻 Moment 项目 <阶段名>）。

执行规则：
1. 严格按计划中的 Task 顺序执行，每个 Task 内的 Steps 逐步来：写失败测试 → 运行确认失败 → 实现 → 运行确认通过 → commit。不要跳步、不要合并 Task、不要擅自改设计。
2. 工作目录 /Users/ximing/project/mygithub/moment。计划中的每段代码都是完整的，照写即可；如发现计划代码有错误，停下来报告，不要自行发挥绕过。
3. 环境事实（已就绪）：
   - apps/server/.env 已存在，含测试库 MySQL 连接与 S3 配置（严禁提交进 git，.gitignore 已覆盖）。
   - 包管理器 pnpm 10.22+，Node ≥ 20。
   - 测试打 .env 指向的 MySQL 测试库（moment_test_db），严禁生产库；每个触库测试文件 afterAll(closeDb)。
   - 前序 Phase 代码已落地，/Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md 中的接口契约已可用，引用符号不得改名。
4. 每完成一个 Task 按计划里的 commit 命令提交（conventional commits）；测试不通过不许进入下一个 Task。
5. 全部完成后做计划末尾 DoD 的全部验证项。
6. 最终回复报告：每个 Task 的完成状态、测试通过数量、DoD 验证结果、以及执行中发现的计划文档问题（如有）。
