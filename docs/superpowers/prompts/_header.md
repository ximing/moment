# 通用片段说明

每个 phase-*-draft.md 都是自包含的完整 prompt，直接整体粘贴给 Agent 即可。

- `review.md` — 每份计划写完后的对抗评审 prompt（替换 `<计划文件路径>`）
- `execute.md` — 每份计划评审通过后，交给执行 Agent 的 prompt（替换 `<计划文件路径>` 和阶段名）

顺序：Phase 1 已就绪（计划已评审通过）→ 2 → 3 → 4 → 5 →（6、7 可并行）→ 8。
