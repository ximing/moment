# Web 产品重写 Implementation Plan

> **For agentic workers:** Execute task-by-task. Controller may implement inline for visual consistency.

**Goal:** 按 `docs/superpowers/specs/2026-08-16-web-product.md` 重写 `apps/web`，做成家庭平板/电脑可用的纸感时间线。

**Architecture:** 保留 dto / api-client / AuthProvider / query keys / uploadMedia。替换全部页面与壳。Compose 用 Context 面板，不设 `/compose` 路由。

**Tech Stack:** React 19, Vite, TanStack Query, Tailwind 3, react-router 7。

## Global Constraints

- 不改 dto 字段名、不改 server 路由、不新增 PATCH /me、不扩展 coverMediaId
- Token 名称与色值以 Web spec §7 为准
- 错误展示走 `errors.ts` 映射表
- 每任务 `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
- conventional commits `feat(web): ...`

### Task 1: tokens + UI 原子 + 错误映射 + Auth + Shell
### Task 2: Timeline + MomentSheet + Lightbox + 卡片互动
### Task 3: ComposePanel（选链/压缩/补记/标签/编辑）
### Task 4: ChainHeader + ChainSettings（分享优先）
### Task 5: ShareAlbum + 邀请页
### Task 6: /me + 旧文件删除 + typecheck/lint/build + 手测能跑的项
