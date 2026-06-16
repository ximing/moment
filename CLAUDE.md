# Moment — 项目指令

多用户时光链记录应用（pnpm + turbo monorepo）。产品 spec 在 `docs/superpowers/specs/`。

## 结构

- `apps/server` — Express API（routing-controllers + TypeDI + Drizzle + MySQL），含 worker 与 push
- `apps/web` — Vite + React 静态 Web（家庭平板时间线），有自己的 `CLAUDE.md`
- `apps/app` — Expo React Native 客户端，有自己的 `CLAUDE.md`
- `packages/dto` — 跨端共享 zod schema 与类型，有自己的 `CLAUDE.md`
- `packages/api-client` — 服务端 API 的类型化 client（web/app 复用）
- `config/` — 共享 tsconfig / eslint；`backup/` — 备份 sidecar；`docs/superpowers/` — spec/计划/提示词

## 全局约束

- Node ≥ 20，ESM NodeNext：TS 相对 import 一律带 `.js` 后缀。
- Conventional commits：`feat(server): ...` / `feat(web): ...` / `feat(app): ...` / `docs: ...`。
- 新增环境变量必须同步改 `apps/server/src/config.ts`（zod 校验）和 `apps/server/.env.example`。
- `apps/server/.env` 可能含真实凭据，已 gitignore，**严禁提交或覆盖**。
- 数据库红线：测试/开发只打 `.env` 指向的测试库，**严禁对生产库跑测试或 `resetDb()`**。

## Web C 端设计规范

`apps/web` 的所有页面与组件开发必须遵循下列已批准规范；这些文件是视觉和组件行为的唯一真相源，不能在页面或局部规则中另建相冲突的样式约定：

- `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`
- `docs/superpowers/specs/2026-08-18-web-button-design.md`
- `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`
- `docs/superpowers/specs/2026-08-18-web-field-input-design.md`
- `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`
- `docs/superpowers/specs/2026-08-18-web-feedback-design.md`

## 常用命令

- 构建：`pnpm build`（先构建 dto 等依赖包再起 dev）
- 开发：`pnpm dev`（turbo 并行）
- 迁移：`pnpm --filter @moment/server migrate`
- 测试：`pnpm test`；仅 server：`pnpm --filter @moment/server test`（触真实测试库，`--runInBand`）
- Lint / 格式化：`pnpm lint` / `pnpm format`

## 局部规则导航

- `apps/server/CLAUDE.md` — feature 模块范式、链权限、错误码、drizzle 迁移约定
- `apps/web/CLAUDE.md`、`apps/app/CLAUDE.md`、`packages/dto/CLAUDE.md`
- 横切规则（按路径自动加载）：
  - `.claude/rules/testing.md` — 所有测试文件
  - `.claude/rules/plan-docs.md` — `docs/superpowers/plans|prompts/` 下的计划与提示词文档
  - `.claude/rules/web-ui.md` — `apps/web/src/**` 的 Design System 入口与跨页面尺度 / 对齐约束

Codex CLI 经 `.codex/config.toml` 回退名单复用本 `CLAUDE.md` 目录链（入口见根 `AGENTS.md`）。
