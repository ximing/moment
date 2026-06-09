# 指令入口（指针）

本仓库的指令真相源是各层 `CLAUDE.md`（Codex 已通过 `.codex/config.toml` 的 `project_doc_fallback_filenames = ["CLAUDE.md"]` 复用同一套目录链）：

- 根：`CLAUDE.md` —— 全局基线，任何工作前先读。
- 子目录（进入对应子树工作时先读）：
  - `apps/server/CLAUDE.md` — Express API、feature 模块范式、链权限、错误码、drizzle 迁移
  - `apps/web/CLAUDE.md` — rab 三层状态、页面/组件放置约束
  - `apps/app/CLAUDE.md` — Expo 客户端
  - `packages/dto/CLAUDE.md` — 跨端契约唯一真相源
- 横切规则（Claude Code 按 `paths` 自动加载；Codex 无对应机制，命中以下区域时需手动读）：
  - `.claude/rules/testing.md` — 所有测试文件（触真实测试库、`--runInBand`、`resetDb` 约定、数据库红线）
  - `.claude/rules/plan-docs.md` — `docs/superpowers/plans|prompts/**`
  - `.claude/rules/web-ui.md` — `apps/web/src/**` 的尺度与对齐网格（Design System）
