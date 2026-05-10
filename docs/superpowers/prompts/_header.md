# prompt 使用说明

## 计划生产：`phaseN.md`（N=2..8）

每个 `phaseN.md` 是一份**调度 prompt**，粘贴给一个主 Agent 即可。主 Agent 不亲自写计划，而是：

1. 派「起草 SubAgent」按计划要求写出计划文件
2. 派「评审 SubAgent」对抗性审阅（只输出问题清单）
3. 有阻塞/高危 → 派「修复 SubAgent」→ 再派新评审，循环最多 3 轮
4. 无阻塞后 commit 并返回摘要

三个角色都是独立 SubAgent，信息全部通过文件传递（计划文件 + CONVENTIONS.md + spec + Phase 1 计划）。

## 计划执行：`execute.md`

计划评审通过后，把 `execute.md`（替换 `<计划文件路径>` 和 `<阶段名>`）粘贴给执行 Agent。

## 顺序

Phase 1 已就绪（计划已评审通过）→ 2 → 3 → 4 → 5 →（6、7 可并行）→ 8。
