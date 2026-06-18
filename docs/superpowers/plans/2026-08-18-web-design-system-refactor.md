# Web Design System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web C 端从 sticker/card 视觉迁移为已批准的日子线设计系统，同时保持所有业务、API、DTO、路由、权限、媒体、分享、日期锚定和 RAB 语义不变。

**Architecture:** 严格串行地先修复可重复构建与测试基础，再以 `tokens.css → Tailwind 语义映射 → ui 基元 → Shell/Timeline → 页面组合` 推进。Task 2–8 是共享热点的唯一 owner；Task 9–13 只使用这些公开接口，绝不回写 tokens、通用 UI 或 RAB Service 的业务语义。Task 14 将受控 seed 的 CSI 流程固化为可重放视觉回归，Task 15 只做全量质量门与验收。

**Tech Stack:** pnpm workspace、Vite 7、React 19、TypeScript、Tailwind CSS、react-aria-components、@rabjs/react、Vitest + React Testing Library、CSI。

**Spec:** `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`; `docs/superpowers/specs/2026-08-18-web-button-design.md`; `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`; `docs/superpowers/specs/2026-08-18-web-field-input-design.md`; `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`; `docs/superpowers/specs/2026-08-18-web-feedback-design.md`.

## Global Constraints

- 执行顺序固定为 Task 1 → 15；同一时刻只允许当前 Task 修改其列出的共享热点。
- 不修改 `packages/dto/**`、`apps/web/src/api/client.ts`、任一 RAB Service 的状态含义或请求路径；仅 Task 14 可在其列出的 `apps/server/**` 文件中实现本地 E2E CLI fixture seeder，绝不增加 HTTP gateway、控制器或业务路由。跨域刷新仍只经既有 `'global'` 事件。
- 保留 `App.tsx` 现有路由集合与 `/chains/:chainId/compose` 重定向；页面从 `useParams` 调 `service.hydrate(id)`、跳转留在组件。
- 组件颜色、尺寸、圆角、阴影、z-index 一律从 `apps/web/src/styles/tokens.css` 与 Tailwind 语义映射消费；业务页不得写十六进制、一次性 `px-[…]`、`h-[…]`、页面私有阴影或 `z-40/z-50`。
- 页面网格只用 4/8/12/16/20/24/32px；动态业务内容用系统字体，固定“时刻/今天/昨天/记下此刻”才可使用 Smiley Sans；所有交互均有可见 `focus-visible`。
- Web 测试不得运行 `pnpm test` 或 `resetDb()`；CSI 只用专用测试帐号和受控 seed，绝不依赖个人登录态或生产数据库。CSI 运行器仅连接 `http://127.0.0.1:5173` 和 `http://127.0.0.1:3000/api`；`fixtures/seed.mjs` 必须在每次写入前拒绝非 loopback URL、缺少 `MOMENT_E2E=1`、或本地 CLI `preflight` 未回报 `{ mode: 'e2e', database: 'moment_e2e' }` 的目标。CLI 必须同时要求 `NODE_ENV=test` 和 `MYSQL_DATABASE=moment_e2e`（因此保留 `_e2e` 后缀），并且不暴露 HTTP seed gateway。

---

## File ownership map

| Owner task | Exact shared files it alone may modify                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Consumers after it lands |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 2          | `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/tokens.test.ts`, `apps/web/tailwind.config.js`, `.claude/rules/web-ui.md`, `.gitignore`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3–15                     |
| 3          | `apps/web/src/ui/button/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 4–15                     |
| 4          | `apps/web/src/ui/modal/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5–15                     |
| 5          | `apps/web/src/ui/floating/**`, `apps/web/src/ui/menu/**`, `apps/web/src/ui/popover/**`, `apps/web/src/ui/tooltip/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 6–15                     |
| 6          | `apps/web/src/ui/field/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 7–15                     |
| 7          | `apps/web/src/ui/feedback/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 8–15                     |
| 8          | `apps/web/src/pages/design-lab/**`, `apps/web/src/pages/not-found.tsx`, `apps/web/src/pages/not-found.test.tsx`, `apps/web/src/app-toast.test.tsx`, `apps/web/src/App.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 9–15                     |
| 9          | `apps/web/src/shell/Shell.tsx`, `apps/web/src/shell/user-menu.tsx`, `apps/web/src/shell/create-chain-dialog/index.tsx`, `apps/web/src/compose/composer-entry.tsx`, `apps/web/src/compose/compose-fab.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 10–15                    |
| 10         | `apps/web/src/pages/chain-home/index.tsx`, `apps/web/src/pages/chain-home/chain-audience.tsx`, `apps/web/src/timeline/timeline.tsx`, `apps/web/src/timeline/timeline-rail.tsx`, `apps/web/src/timeline/moment-sheet.tsx`, `apps/web/src/timeline/reaction-bar.tsx`, `apps/web/src/compose/compose-panel/index.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 11–15                    |
| 11         | `apps/web/src/pages/feed-home/index.tsx`, `apps/web/src/pages/moment/index.tsx`, `apps/web/src/pages/share-album/index.tsx`, `apps/web/src/media/MediaBlock.tsx`, `apps/web/src/media/MediaBlock.test.tsx`, `apps/web/src/timeline/lightbox.tsx`, `apps/web/src/timeline/lightbox.test.tsx`, `apps/web/src/pages/timeline-variants.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 12–15                    |
| 12         | `apps/web/src/pages/chain-settings/index.tsx`, `apps/web/src/pages/chain-settings/sections.tsx`, `apps/web/src/chain/ChainLookPicker.tsx`, `apps/web/src/pages/me/index.tsx`, `apps/web/src/ui/ThemeToggle.tsx`, `apps/web/src/ui/Avatar.tsx`, `apps/web/src/pages/notifications/index.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 13–15                    |
| 13         | `apps/web/src/pages/auth-frame.tsx`, `apps/web/src/pages/login/index.tsx`, `apps/web/src/pages/register/index.tsx`, `apps/web/src/pages/invite/index.tsx`, `apps/web/src/ui/Button.tsx`, `apps/web/src/ui/Field.tsx`, `apps/web/src/ui/Menu.tsx`, `apps/web/src/ui/Confirm.tsx`, `apps/web/src/ui/Banner.tsx`, `apps/web/src/ui/Empty.tsx`, `apps/web/src/ui/HoverTip.tsx`, `apps/web/src/ui/HappenedAtField.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 14–15                    |
| 14         | `apps/server/src/config.ts`, `apps/server/.env.example`, `apps/server/src/e2e/fixture-asset.ts`, `apps/server/src/e2e/fixture-cli-contract.ts`, `apps/server/src/e2e/fixture-cli-contract.test.ts`, `apps/server/src/e2e/fixture-rows.ts`, `apps/server/src/e2e/fixture-rows.test.ts`, `apps/server/src/e2e/fixture-seeder.ts`, `apps/server/src/e2e/fixture-cli.ts`, `apps/web/e2e/run.mjs`, `apps/web/e2e/lib/bridge.mjs`, `apps/web/e2e/lib/bridge.test.mjs`, `apps/web/e2e/lib/env.mjs`, `apps/web/e2e/lib/manifest.mjs`, `apps/web/e2e/lib/manifest.test.mjs`, `apps/web/e2e/fixtures/seed.mjs`, `apps/web/e2e/fixtures/seed.test.mjs`, `apps/web/e2e/cases/design-system-regression.md`, `apps/web/e2e/suites/design-system-regression.mjs`, `apps/web/e2e/baselines/manifest.json`, `apps/web/e2e/baselines/design-lab/light/390.png`, `apps/web/e2e/baselines/design-lab/light/1024.png`, `apps/web/e2e/baselines/design-lab/light/1440.png`, `apps/web/e2e/baselines/design-lab/light/1895.png`, `apps/web/e2e/baselines/design-lab/dark/390.png`, `apps/web/e2e/baselines/design-lab/dark/1024.png`, `apps/web/e2e/baselines/design-lab/dark/1440.png`, `apps/web/e2e/baselines/design-lab/dark/1895.png`, `apps/web/e2e/baselines/feed-home/light/390.png`, `apps/web/e2e/baselines/feed-home/light/1024.png`, `apps/web/e2e/baselines/feed-home/light/1440.png`, `apps/web/e2e/baselines/feed-home/light/1895.png`, `apps/web/e2e/baselines/feed-home/dark/390.png`, `apps/web/e2e/baselines/feed-home/dark/1024.png`, `apps/web/e2e/baselines/feed-home/dark/1440.png`, `apps/web/e2e/baselines/feed-home/dark/1895.png`, `apps/web/e2e/baselines/chain-home/light/390.png`, `apps/web/e2e/baselines/chain-home/light/1024.png`, `apps/web/e2e/baselines/chain-home/light/1440.png`, `apps/web/e2e/baselines/chain-home/light/1895.png`, `apps/web/e2e/baselines/chain-home/dark/390.png`, `apps/web/e2e/baselines/chain-home/dark/1024.png`, `apps/web/e2e/baselines/chain-home/dark/1440.png`, `apps/web/e2e/baselines/chain-home/dark/1895.png`, `apps/web/e2e/README.md` | 15                       |

## Task 1: Repair the Web dependency link and establish a green build baseline

**Files:**

- Modify: `apps/web/vite.config.ts`
- Create: `docs/superpowers/verification/2026-08-18-web-build-baseline.md`

**Interfaces:**

- Consumes: `apps/web/package.json` dependency `react-dom@^19.2.0` and root lockfile resolution `react-dom@19.2.8`.
- Produces: Vite resolves `react-dom` from the installed package root under hoisted or isolated layouts; no tracked dependency-manifest change; the exact failed/repaired command evidence is recorded in the baseline document.

- [ ] **Step 1: Record the fail-first baseline and prove the broken target.**

Ensure `apps/web/node_modules/react-dom` is deleted or does not exist, then run:

```bash
test ! -e apps/web/node_modules/react-dom
test -e node_modules/react-dom/package.json
pnpm --filter @moment/web build
```

Expected: exit 1 during `vite build` with `Could not load ...apps/web/node_modules/react-dom/client` and `ENOENT`.

- [ ] **Step 2: Make Vite's React DOM alias hoist-safe.**

In `apps/web/vite.config.ts`, import `createRequire` from `node:module` and derive the installed package root with:

```ts
const reactDomRoot = path.dirname(
  createRequire(import.meta.url).resolve("react-dom/package.json"),
);
```

Keep `reactRoot` and `dedupe: ['react', 'react-dom']` unchanged. Do not add a scoped pnpm install, conditional repair, generated symlink, lockfile change, or React version change.

- [ ] **Step 3: Verify the no-symlink green baseline and tracked-file invariants.**

Run:

```bash
test ! -e apps/web/node_modules/react-dom
node -e "const {createRequire}=require('node:module'); const {resolve,dirname}=require('node:path'); console.log(dirname(createRequire(resolve('apps/web/vite.config.ts')).resolve('react-dom/package.json')))"
pnpm --filter @moment/web build
pnpm --filter @moment/web typecheck
git diff --exit-code -- pnpm-lock.yaml
```

Expected: the path resolves to the installed `react-dom` package root; build and typecheck exit 0 without a Web-local `react-dom` symlink; `pnpm-lock.yaml` is byte-for-byte unchanged.

- [ ] **Step 4: Record the reproducible baseline and commit the task.**

Create `docs/superpowers/verification/2026-08-18-web-build-baseline.md` with this exact result table. The pnpm version, no-link/root-package checks, fail-first exit, absolute probe and pre-fix typecheck are the observed 2026-08-18 baseline values; the repaired build/typecheck and lockfile rows are the fixed acceptance results that Task 1 must reproduce exactly:

| Check               | Exact command                                                                                                                                                                                                     | Expected result                           | Observed result                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| pnpm version        | `pnpm --version`                                                                                                                                                                                                  | records the tool version                  | `10.22.0`                                                                                |
| no local symlink    | `test ! -e apps/web/node_modules/react-dom`                                                                                                                                                                       | exit 0                                    | exit 0                                                                                   |
| root package exists | `test -e node_modules/react-dom/package.json`                                                                                                                                                                     | exit 0                                    | exit 0                                                                                   |
| fail-first build    | `pnpm --filter @moment/web build`                                                                                                                                                                                 | exit 1; `react-dom/client` ENOENT         | exit 1; `react-dom/client` ENOENT                                                        |
| absolute Vite probe | `node -e "const {createRequire}=require('node:module'); const {resolve,dirname}=require('node:path'); console.log(dirname(createRequire(resolve('apps/web/vite.config.ts')).resolve('react-dom/package.json')))"` | prints installed `react-dom` package root | `/Users/ximing/orca/workspaces/moment/web-design-system-refactor/node_modules/react-dom` |
| repaired build      | `pnpm --filter @moment/web build`                                                                                                                                                                                 | exit 0                                    | exit 0                                                                                   |
| repaired typecheck  | `pnpm --filter @moment/web typecheck`                                                                                                                                                                             | exit 0                                    | exit 0                                                                                   |
| lockfile invariant  | `git diff --exit-code -- pnpm-lock.yaml`                                                                                                                                                                          | exit 0; no output                         | exit 0; no output                                                                        |

Do not replace any command, expected result, or table row. The table makes the no-symlink fail-first and repaired results, root package existence, absolute path probe, build, typecheck, and lockfile invariant independently reproducible.

Then commit only the two Task 1 tracked files:

```bash
git add apps/web/vite.config.ts docs/superpowers/verification/2026-08-18-web-build-baseline.md
git commit -m "feat(web): make react-dom alias hoist-safe"
```

## Task 2: Establish the Web test scripts and token owner

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/styles/tokens.test.ts`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/tailwind.config.js`
- Modify: `.claude/rules/web-ui.md`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Task 1 buildable Vite importer; existing `:root[data-theme='dark']` theme contract.
- Produces: the sole Web owner for package scripts, Vitest setup, CSS tokens, Tailwind semantic mappings and E2E runtime-ignore rules; `pnpm --filter @moment/web test` runs Vitest in jsdom, `pnpm --filter @moment/web e2e:design-system` runs `node e2e/run.mjs design-system-regression`, and later UI/E2E tasks consume only these published commands and token names.

- [ ] **Step 1: Write the failing token and script contract.**

Create `apps/web/src/styles/tokens.test.ts` to assert both themes define the approved base, field, overlay, feedback, geometry and z-index tokens, plus reduced motion. Assert the package exposes the single `test` script and Vitest loads `src/test/setup.ts`.

- [ ] **Step 2: Run the focused contract before adding the owner implementation.**

Run: `pnpm --filter @moment/web test -- tokens.test.ts`

Expected: FAIL because the package has no test script, Vitest configuration, or complete token contract.

- [ ] **Step 3: Add the only package/test-script owner and complete the semantic token layer.**

Add the Web testing dependencies, including the Node PNG comparison dependencies `pixelmatch` and `pngjs`, and configure `test` as `vitest run` plus `e2e:design-system` as `node e2e/run.mjs design-system-regression`; the latter may fail until Task 14 creates the runner. Configure jsdom, setup and coverage-independent focused execution. Add the approved light/dark color, field, overlay, feedback, geometry and z-index tokens; retain only documented temporary aliases for old callers until Task 13 cleanup. Map every public semantic token in Tailwind. Add only `apps/web/e2e/artifacts/**` to `.gitignore`; Task 14's exact manifest and 24 approved PNG paths remain unignored. Update `.claude/rules/web-ui.md` so no later task adds package scripts, test setup, tokens, legacy aliases or E2E ignore rules.

- [ ] **Step 4: Run the focused contract and baseline static gates.**

Run: `pnpm --filter @moment/web test -- tokens.test.ts && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: all exit 0; the package script, test setup and token contract are green, while legacy aliases remain confined to the documented transition mapping.

- [ ] **Step 5: Commit the infrastructure and token contract.**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/styles/tokens.test.ts apps/web/src/styles/tokens.css apps/web/tailwind.config.js .claude/rules/web-ui.md .gitignore
git commit -m "feat(web): establish design system tokens and tests"
```

## Task 3: Create the Button family directory

**Files:**

- Create: `apps/web/src/ui/button/Button.tsx`
- Create: `apps/web/src/ui/button/Button.test.tsx`
- Create: `apps/web/src/ui/button/index.ts`

**Interfaces:**

- Consumes: Task 2 control, focus and action tokens.
- Produces: `Button`, `ButtonLink`, `IconButton`, `ButtonVariant`, `ButtonShape`, `ButtonProps`, `ButtonLinkProps` and `IconButtonProps` from `ui/button`; `danger + pill` is rejected by the discriminated union. Existing UI files remain untouched for Task 13 cleanup.

- [ ] **Step 1: Write failing Button behavior tests.**

In `ui/button/Button.test.tsx`, render the three public primitives; assert default native `type="button"`, loading has `aria-busy="true"` and suppresses `onClick`, ButtonLink is an anchor, IconButton has its accessible name, and a `// @ts-expect-error` fixture rejects danger-pill.

- [ ] **Step 2: Run the focused test before implementation.**

Run: `pnpm --filter @moment/web test -- Button.test.tsx`

Expected: FAIL because the new `ui/button` directory and exports do not exist.

- [ ] **Step 3: Implement the minimum Button family.**

Implement the discriminated prop union, semantic variants, standard/pill geometry, spinner slot, focus ring and reduced-motion behavior exclusively from Task 2 tokens. Keep `className` limited to outer placement and export the family from `index.ts`; do not create a compatibility adapter or edit callers. Existing callers continue to use their old paths until Task 13.

- [ ] **Step 4: Verify Button contracts and compilation.**

Run: `pnpm --filter @moment/web test -- Button.test.tsx && pnpm --filter @moment/web typecheck`

Expected: all tests pass and TypeScript rejects the danger-pill fixture; only the new directory is involved.

- [ ] **Step 5: Commit the Button family.**

```bash
git add apps/web/src/ui/button/Button.tsx apps/web/src/ui/button/Button.test.tsx apps/web/src/ui/button/index.ts
git commit -m "feat(web): create button primitives"
```

## Task 4: Create the Modal family directory

**Files:**

- Create: `apps/web/src/ui/modal/Modal.tsx`
- Create: `apps/web/src/ui/modal/Modal.test.tsx`
- Create: `apps/web/src/ui/modal/index.ts`

**Interfaces:**

- Consumes: Task 2 overlay tokens and Task 3 `ui/button` exports.
- Produces: only the public `Dialog`, `Sheet`, `AlertDialog` components and their exact props/`CloseReason` type from `ui/modal`; `ModalSurface` is a directory-private implementation detail in `Modal.tsx`, is omitted from `ui/modal/index.ts`, and is never imported by business callers. Existing overlays remain untouched until Task 13 cleanup.

- [ ] **Step 1: Write failing overlay tests.**

In `modal.test.tsx`, assert Dialog returns focus to its trigger after close, `Escape` calls `onRequestClose('escape')`, outside click calls `onRequestClose('outside')`, `busy` suppresses close requests, AlertDialog Escape calls `onCancel`, and the mobile/desktop Sheet uses one component with the 768px media-query class.

- [ ] **Step 2: Run the tests before creating the behavior layer.**

Run: `pnpm --filter @moment/web test -- modal.test.tsx`

Expected: FAIL because the new `ui/modal` directory and exports do not exist.

- [ ] **Step 3: Implement controlled surfaces and migrate existing overlays without changing their services.**

Build directory-private `ModalSurface` with react-aria focus containment, inert background, scroll lock, portal z-layer, scrim and focus restoration. Export only Dialog/Sheet with fixed Header/Body/Footer structure and AlertDialog with cancel-first focus, busy protection and close-reason semantics from `ui/modal/index.ts`; never export `ModalSurface`. Sheet changes from right-floating desktop to bottom near-full mobile at 768px. Keep existing Confirm, Lightbox and caller files untouched until Task 13 migrates and removes them.

- [ ] **Step 4: Verify focus, close reasons and existing callers.**

Run: `pnpm --filter @moment/web test -- modal.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: all exit 0; the new directory contains no `fixed inset-0`, `z-40`, `z-50`, or window Escape listener.

- [ ] **Step 5: Commit modal behavior.**

```bash
git add apps/web/src/ui/modal/Modal.tsx apps/web/src/ui/modal/Modal.test.tsx apps/web/src/ui/modal/index.ts
git commit -m "feat(web): create modal primitives"
```

## Task 5: Create floating, menu, popover and tooltip directories

**Files:**

- Create: `apps/web/src/ui/floating/FloatingLayer.tsx`
- Create: `apps/web/src/ui/floating/FloatingLayer.test.tsx`
- Create: `apps/web/src/ui/menu/Menu.tsx`
- Create: `apps/web/src/ui/menu/Menu.test.tsx`
- Create: `apps/web/src/ui/menu/index.ts`
- Create: `apps/web/src/ui/popover/Popover.tsx`
- Create: `apps/web/src/ui/popover/Popover.test.tsx`
- Create: `apps/web/src/ui/popover/index.ts`
- Create: `apps/web/src/ui/tooltip/Tooltip.tsx`
- Create: `apps/web/src/ui/tooltip/Tooltip.test.tsx`
- Create: `apps/web/src/ui/tooltip/index.ts`

**Interfaces:**

- Consumes: Task 2 semantic tokens, Task 3 button exports and Task 4 modal layering contract.
- Produces: only the public `ResponsiveMenu`, `MenuItem`, `MenuLinkItem`, `MenuGroup`, `ContextMenu`, `Popover`, `ReactionPopover`, `MemberPopover` and `Tooltip` exports from their semantic directories; `FloatingLayer` is directory-private, has no `ui/floating/index.ts` barrel and is imported only by Task 5 implementations. `ActionSheet` is an internal branch of `ResponsiveMenu`, never a public export. Menu callers do not read viewport width. Field creation waits for Task 6.

- [ ] **Step 1: Write failing floating-surface tests.**

In `FloatingLayer.test.tsx`, mock trigger/viewport rectangles and assert Portal rendering, preferred `bottom end` placement, Flip/Shift when the preferred side clips, outside/Escape dismissal, trigger-out-of-viewport dismissal and focus restoration. In `Menu.test.tsx`, assert ArrowDown/ArrowUp open at the first/last enabled item, `role="menu"`, text navigation, Home/End, Escape/refocus, the under-768 modal ActionSheet with independent “取消”, and close/refocus when an open surface crosses the 767/768 boundary. In `Popover.test.tsx`, assert ReactionPopover has an accessible grid label, starts on the current/first emoji, supports two-dimensional arrow navigation, Enter selection, Escape and refocus; assert MemberPopover opens after 300ms from desktop hover or focus, remains open while the pointer crosses into its surface, opens immediately on click/touch, is keyboard/read-screen reachable, and closes on outside/Escape with refocus. In `Tooltip.test.tsx`, use fake timers and matchMedia stubs to assert `label` is plain text, the IconButton has its own accessible name, neither trigger nor surface has a native `title`, fine-pointer hover/focus opens after exactly 600ms, leave/blur closes after exactly 100ms, Escape closes, coarse pointers never render it, and an above placement flips rather than clipping.

- [ ] **Step 2: Run the focused test before creating the directories.**

Run: `pnpm --filter @moment/web test -- FloatingLayer.test.tsx Menu.test.tsx Popover.test.tsx Tooltip.test.tsx`

Expected: FAIL because the new floating/menu/popover/tooltip directories and exports do not exist.

- [ ] **Step 3: Implement the floating and command-surface contracts.**

Implement directory-private `FloatingLayer` for portal flip/shift, collision, outside dismissal, viewport exit and focus restoration; semantic implementations import its file directly and no index re-exports it. Build one declarative command collection for public `ResponsiveMenu`, whose under-768 rendering uses an internal ActionSheet, plus the public Popover/ReactionPopover/MemberPopover and short desktop Tooltip contracts. Tooltip accepts only `label: string`, never writes `title`, uses the fixed 600ms/100ms timers, and is suppressed for `pointer: coarse`; MemberPopover supports the fixed hover/focus delay, pointer transit and touch/click pinning. Keep all existing menu, hover-tip, reaction and date-time callers untouched until Task 13.

- [ ] **Step 4: Verify keyboard and viewport behavior.**

Run: `pnpm --filter @moment/web test -- FloatingLayer.test.tsx Menu.test.tsx Popover.test.tsx Tooltip.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; the new directories contain no arbitrary z-index, full-screen outside button, custom window key listener, caller-supplied placement, width or shadow.

- [ ] **Step 5: Commit the floating command surfaces.**

```bash
git add apps/web/src/ui/floating/FloatingLayer.tsx apps/web/src/ui/floating/FloatingLayer.test.tsx apps/web/src/ui/menu/Menu.tsx apps/web/src/ui/menu/Menu.test.tsx apps/web/src/ui/menu/index.ts apps/web/src/ui/popover/Popover.tsx apps/web/src/ui/popover/Popover.test.tsx apps/web/src/ui/popover/index.ts apps/web/src/ui/tooltip/Tooltip.tsx apps/web/src/ui/tooltip/Tooltip.test.tsx apps/web/src/ui/tooltip/index.ts
git commit -m "feat(web): create floating command primitives"
```

## Task 6: Create the Field family directory consuming Task 5

**Files:**

- Create: `apps/web/src/ui/field/Field.tsx`
- Create: `apps/web/src/ui/field/Field.test.tsx`
- Create: `apps/web/src/ui/field/SelectField.test.tsx`
- Create: `apps/web/src/ui/field/DateTimeField.test.tsx`
- Create: `apps/web/src/ui/field/index.ts`

**Interfaces:**

- Consumes: Tasks 2–4 token, button and public modal contracts, plus Task 5's public `Popover`; Task 6 never imports `FloatingLayer` or `ActionSheet`.
- Produces: public `Field`, `FieldDescription`, `FieldError`, `Input`, `Textarea`, `Select`, `TextField`, `TextareaField`, `PasswordField`, `SelectField` and `DateTimeField`. Text/Input compositions accept `{ label: string; name: string; isRequired?: boolean; isOptional?: boolean; description?: string; isInvalid?: boolean; errorMessage?: string; isClearable?: boolean }` plus the applicable native `value`, `onChange`, `onBlur`, `ref`, `type`, `inputMode`, `autoComplete`, `enterKeyHint`, `readOnly` and `disabled` props. `DateTimeField(props: { value: string; onChange(next: string): void; hint?: string }): JSX.Element` preserves the existing local-wall-clock `YYYY-MM-DDTHH:mm` contract exactly: it neither constructs a `Date` nor applies a UTC/time-zone conversion. Existing field callers remain untouched until Task 13.

- [ ] **Step 1: Write failing Field tests.**

In `Field.test.tsx`, assert public Field/FieldDescription/FieldError associate stable IDs, error replaces description and sets `aria-invalid`, Clear appears only for an enabled nonempty `isClearable` short field and clearing retains input focus, PasswordField toggles type without changing value/caret/focus, Textarea has `resize-none`, 16px text and the required 112px minimum height, Input/Select are 44px, readonly remains focusable/copyable, disabled is outside the Tab order, browser autofill styling retains `--field-bg`, and `type`, `inputMode`, `autoComplete` and `enterKeyHint` reach the native input unchanged. In `SelectField.test.tsx`, assert a visible label/description/error association and the React Aria ArrowUp/ArrowDown/Enter/Escape keyboard model without reusing Menu semantics. In `DateTimeField.test.tsx`, render `value="2026-08-18T17:30"` with `hint="按发生时间排列"`, assert the hint association, open by pointer and keyboard, change date/minute, and assert `onChange` receives the local-wall-clock string unchanged in format and without an offset/UTC conversion; rerender the emitted value and assert the same wall clock is shown.

- [ ] **Step 2: Run the focused test before creating the directory.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx SelectField.test.tsx DateTimeField.test.tsx`

Expected: FAIL because the new `ui/field` directory and exports do not exist.

- [ ] **Step 3: Implement the fixed Field API.**

Use react-aria-components associations for stable IDs; export FieldDescription/FieldError but expose no size/radius/tone variants; map default/hover/focus/error/disabled/readonly/autofill through Task 2 field tokens. Render “可选” only from `isOptional`; `isRequired` is native semantics without a star. Implement the single optional Clear end action with synchronous refocus. Implement Select with its native/React Aria label and keyboard model. Implement DateTimeField on top of Task 5 public Popover behavior by moving the existing parse/format-local-wall-clock logic verbatim in semantics; keep `value`, `onChange(next)` and `hint` behavior and never convert through `Date`, UTC or the browser zone. Do not edit or adapt any existing caller in this task.

- [ ] **Step 4: Verify Field semantics.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx SelectField.test.tsx DateTimeField.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; `hint` exists only on the exact DateTimeField contract, while the new field directory contains no generic legacy `hint`/`error` compatibility props, `rounded-*`, `border-line`, `h-10`, or `resize-y` escape hatch.

- [ ] **Step 5: Commit the Field family.**

```bash
git add apps/web/src/ui/field/Field.tsx apps/web/src/ui/field/Field.test.tsx apps/web/src/ui/field/SelectField.test.tsx apps/web/src/ui/field/DateTimeField.test.tsx apps/web/src/ui/field/index.ts
git commit -m "feat(web): create field primitives"
```

## Task 7: Create the Feedback family directory

**Files:**

- Create: `apps/web/src/ui/feedback/Feedback.tsx`
- Create: `apps/web/src/ui/feedback/Feedback.test.tsx`
- Create: `apps/web/src/ui/feedback/index.ts`

**Interfaces:**

- Consumes: Tasks 2–6 feedback/z tokens, Button and AlertDialog.
- Produces: `Banner({ tone: 'error' | 'warning' | 'info'; action?: { label: string; onPress(): void | Promise<void> }; children: string })`; `EmptyState({ variant: 'timeline' | 'plain'; scope: 'page' | 'section'; title: string; description: string; action?: { label: string; onPress(): void; emphasis: 'primary' | 'quiet' } })`; `ToastProvider`, `ToastRegion`, and `useToast(): { show(input: { key: string; message: string; action?: { label: string; onPress(): void | Promise<void> } }): void; clear(): void }`; `TimelineSkeleton`, `FeedSkeleton`, `DetailSkeleton`, `SettingsSkeleton`, `InlineProgress({ variant: 'indeterminate' | 'determinate'; label: string; value?: number })`; and `usePending(loading: boolean): boolean`. A normal Toast has an exact 3500ms visible budget, an actionable Toast has 6000ms, same-key replacement refreshes that budget, hover/focus pauses and later resumes the remaining milliseconds, one item is visible with at most two queued, route changes preserve provider state, and the provider clears visible/queued items on the existing `window` event `moment:auth-cleared`.

- [ ] **Step 1: Write failing feedback tests.**

In `feedback.test.tsx`, use fake timers to assert Banner renders `role="alert"` for error and its action cannot double-submit; a normal Toast exits at exactly 3500ms and an actionable Toast at exactly 6000ms; same-key show replaces content and restarts its exact budget; hover and focus independently pause and resume only the remaining time; one item is visible with at most two queued; a full queue evicts the oldest unshown normal confirmation but never an actionable Toast; rerendering a route child under the same provider preserves the queue; `useToast().clear()` and dispatching `moment:auth-cleared` both synchronously clear visible and queued items. Assert EmptyState rejects a second action by type; Skeleton is `aria-hidden`; `usePending(false → true)` remains false for 179ms, becomes true at 180ms, and after loading becomes false remains true until its 280ms minimum-visible budget completes; reduced-motion matchMedia makes all four Skeleton templates static while preserving those delay/minimum-visible timings; determinate InlineProgress exposes `role="progressbar"` and `aria-valuenow`.

- [ ] **Step 2: Run tests before implementation.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx`

Expected: FAIL because the new `ui/feedback` directory and exports do not exist.

- [ ] **Step 3: Implement structured feedback primitives.**

Implement token-only structured Banner, EmptyState, ToastProvider, ToastRegion, skeleton templates, InlineProgress and the fixed-signature `usePending` in the new directory. Centralize the 3500/6000ms remaining-time clock, same-key refresh, one-visible/two-queued eviction rules, hover/focus pause and route-stable state in ToastProvider; register and clean up one `moment:auth-cleared` listener that calls the same `clear()` implementation exposed by `useToast`. Implement the fixed 180ms delay and 280ms minimum-visible state machine once in `usePending`; reduced motion disables Skeleton animation, not the layout-stability timing. Export `ToastProvider` and `ToastRegion` as separate primitives; do not mount either into the app here, add compatibility adapters, or edit callers. Task 8 is the sole `App.tsx` owner and mounts exactly one provider/region; Task 13 performs migration and removes old paths.

- [ ] **Step 4: Verify feedback contracts.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; the exact Toast/pending clocks and auth-clear lifecycle are green; only Toast has a shadow; the new feedback directory uses no fixed position for content feedback, private `animate-pulse`, or legacy adapter.

- [ ] **Step 5: Commit feedback primitives.**

```bash
git add apps/web/src/ui/feedback/Feedback.tsx apps/web/src/ui/feedback/Feedback.test.tsx apps/web/src/ui/feedback/index.ts
git commit -m "feat(web): create feedback primitives"
```

## Task 8: Add the development-only Design Lab

**Files:**

- Create: `apps/web/src/pages/design-lab/index.tsx`
- Create: `apps/web/src/pages/design-lab/design-lab.test.tsx`
- Create: `apps/web/src/pages/not-found.tsx`
- Create: `apps/web/src/pages/not-found.test.tsx`
- Create: `apps/web/src/app-toast.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: public Task 3–7 UI exports, especially `EmptyState`, `ToastProvider`/`ToastRegion`, and existing `ThemeService` data-theme behavior.
- Produces: development-only `/__design-lab` route with deterministic fixture props, light/dark switch, and 390/1024/1440/1895 container presets; production route tree contains no Design Lab route; `NotFound(): JSX.Element` renders the authenticated wildcard's plain EmptyState; `App` creates and consumes that module in this task, wraps the complete router once with `ToastProvider`, and renders one sibling `ToastRegion`, which stays singular after route navigation. Unauthenticated wildcard redirect and `/chains/:chainId/compose` redirect remain unchanged.

- [ ] **Step 1: Write failing route-boundary tests.**

In `design-lab.test.tsx`, stub `import.meta.env.DEV` true/false and assert the Design Lab renders Button/Field/Modal/Menu/Feedback trigger sections only when DEV is true, with all four labelled viewport presets. In `not-found.test.tsx`, assert the module renders “没有这个页面” as a plain EmptyState with no error Banner or Toast. In `app-toast.test.tsx`, render the real App at two routable locations in sequence, navigate through its router, assert `getAllByRole('region', { name: /通知|toast/i })` has length exactly one both before and after navigation, assert authenticated wildcard renders `NotFound`, unauthenticated wildcard redirects to `/login`, and assert `ComposeRedirect` produces `/chains/x?compose=1`.

- [ ] **Step 2: Run before adding the route.**

Run: `pnpm --filter @moment/web test -- design-lab.test.tsx not-found.test.tsx app-toast.test.tsx`

Expected: FAIL because no Design Lab or NotFound module exists, the wildcard still uses its inline presentation, and App does not yet provide one persistent global toast region.

- [ ] **Step 3: Implement the isolated visual harness.**

Create a static fixture page with real interactive triggers for Button states, fields (error/password/date), Dialog/Sheet/AlertDialog, Menu/Popover/Tooltip and all Feedback variants. Create `pages/not-found.tsx` as a plain EmptyState and import it from `App.tsx` for the authenticated wildcard in the same task and commit. In `App.tsx`, wrap the entire existing route tree exactly once with `<ToastProvider>` and render exactly one `<ToastRegion />` as a sibling inside that provider, outside individual routes, Shell, and the Design Lab. Register `<Route path="/__design-lab" ...>` only inside `if (import.meta.env.DEV)`; use local component state and fixed strings only—no client, service, seed, or production navigation changes. Preserve the unauthenticated wildcard redirect and `ComposeRedirect` exactly, and do not add a second provider/region in Shell, pages, overlays, or test-only routing.

- [ ] **Step 4: Verify dev visibility and production omission.**

Run: `pnpm --filter @moment/web test -- design-lab.test.tsx not-found.test.tsx app-toast.test.tsx && pnpm --filter @moment/web build`

Expected: PASS; production build succeeds, its route source does not contain a runtime-accessible `__design-lab` branch, App consumes the already-created NotFound module without a future-task import, redirects are preserved, and one ToastRegion survives a route transition.

- [ ] **Step 5: Commit the lab.**

```bash
git add apps/web/src/pages/design-lab/index.tsx apps/web/src/pages/design-lab/design-lab.test.tsx apps/web/src/pages/not-found.tsx apps/web/src/pages/not-found.test.tsx apps/web/src/app-toast.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): add development design lab"
```

## Task 9: Migrate Shell, navigation and composer entry points

**Files:**

- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/shell/user-menu.tsx`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify: `apps/web/src/compose/composer-entry.tsx`
- Modify: `apps/web/src/compose/compose-fab.tsx`
- Create: `apps/web/src/shell/shell-navigation.test.tsx`

**Interfaces:**

- Consumes: Tasks 2–8 public UI exports and the existing Shell outlet, navigation, auth and compose services.
- Produces: token-backed Shell, user menu, create-chain dialog and composer entry/FAB; navigation, auth guards, chain-list loading and compose-session semantics remain unchanged. Timeline and page/timeline files are owned by Task 10 and are not modified here.

- [ ] **Step 1: Write failing Shell/navigation tests.**

In `shell-navigation.test.tsx`, assert authenticated navigation destinations, logout/theme actions, create-chain validation/service calls, and composer entry/FAB compose-session handoff.

- [ ] **Step 2: Run tests before entry migration.**

Run: `pnpm --filter @moment/web test -- shell-navigation.test.tsx`

Expected: FAIL because these callers still import legacy Button/Field/Menu/Banner APIs and use sticker/card layout hooks.

- [ ] **Step 3: Migrate only Shell/navigation/composer entry points.**

Replace old imports with `ui/button`, `ui/modal`, `ui/menu`, `ui/field` and `ui/feedback` exports; use token-backed Shell layout and existing top-bar breakpoints. Keep route links, auth visibility, chain-list state, create-chain service calls, compose-session events and ComposePanel mounting exactly as they are. Do not edit `timeline/**`, page files or any service file.

- [ ] **Step 4: Verify the entry contract.**

Run: `pnpm --filter @moment/web test -- shell-navigation.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; only Task 9 Files change, no service path changes, and owned files contain no legacy UI imports or private overlay/layout escape hatches.

- [ ] **Step 5: Commit Shell/navigation/composer migration.**

```bash
git add apps/web/src/shell/Shell.tsx apps/web/src/shell/user-menu.tsx apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/compose/composer-entry.tsx apps/web/src/compose/compose-fab.tsx apps/web/src/shell/shell-navigation.test.tsx
git commit -m "feat(web): migrate shell navigation and composer entries"
```

## Task 10: Migrate chain home, timeline and compose panel

**Files:**

- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/chain-home/chain-audience.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Modify: `apps/web/src/timeline/timeline-rail.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/timeline/reaction-bar.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Create: `apps/web/src/pages/chain-home/chain-home.test.tsx`

**Interfaces:**

- Consumes: Tasks 3–9 public UI APIs and existing `ChainHomeService`/`ComposePanelService` methods unchanged.
- Produces: timeline structure and `/chains/:chainId` composition with year-grouped rail, mobile Sheet rail, member header, MomentSheet, ReactionPopover and dirty-draft AlertDialog; service calls, role conditions, filters and date anchors remain unchanged.

- [ ] **Step 1: Write failing sample-page tests.**

In `chain-home.test.tsx`, use fixed ChainHomeService fixtures for one pure-text moment with `media: []` and one single-image moment; assert the zero-media branch renders no media container, the single-image branch preserves its declared width/height ratio and opens index 0, chain source is absent in single-chain moment metadata, tags and body are one text-flow element, response link says `N 条回应`, own moment kebab opens ResponsiveMenu, the reaction trigger opens ReactionPopover, and dirty compose close opens `AlertDialog` with “继续记录”/“放弃记录”.

- [ ] **Step 2: Run tests before composing the page.**

Run: `pnpm --filter @moment/web test -- chain-home.test.tsx`

Expected: FAIL because the current timeline is flat/fixed, MomentSheet separates tags and says “评论”, and ComposePanel drops drafts on Escape.

- [ ] **Step 3: Migrate only chain-home/timeline/compose-panel presentation.**

Keep `hydrate(chainId)`, chain membership/visibility data, edit/delete callbacks, upload flow and filters intact. Render chain audience header with member avatars, visibility and permission-gated kebab; format text on `--surface` without shadow, media as its own base, tags before body in one text flow, and the emotion/response controls. Convert ComposePanel to Sheet, reuse Field/Button/DateTimeField and show AlertDialog only when its current service state is dirty; make the timeline line dashed and semantic, group month entries by year, and preserve media replacement confirmation, progress/failure and submission refresh behavior. Do not edit Shell, navigation, other page groups or service files.

- [ ] **Step 4: Verify the sample route.**

Run: `pnpm --filter @moment/web test -- chain-home.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; only Task 10 Files change, the single-chain variant has no chain-source metadata, and no API client calls, direct fetches or service-to-service loads are added.

- [ ] **Step 5: Commit the sample page.**

```bash
git add apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/chain-home/chain-audience.tsx apps/web/src/timeline/timeline.tsx apps/web/src/timeline/timeline-rail.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/reaction-bar.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/pages/chain-home/chain-home.test.tsx
git commit -m "feat(web): migrate chain home timeline and composer"
```

## Task 11: Migrate feed, moment detail and public share

**Files:**

- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/moment/index.tsx`
- Modify: `apps/web/src/pages/share-album/index.tsx`
- Modify: `apps/web/src/media/MediaBlock.tsx`
- Modify: `apps/web/src/timeline/lightbox.tsx`
- Create: `apps/web/src/media/MediaBlock.test.tsx`
- Create: `apps/web/src/timeline/lightbox.test.tsx`
- Create: `apps/web/src/pages/timeline-variants.test.tsx`

**Interfaces:**

- Consumes: Tasks 3–10 public Button/Modal/Field/Feedback and timeline/MomentSheet interfaces, existing `useMediaObjectUrl(mediaId: string | null)` authenticated-media contract, and `MomentMedia.url` as the stable relative `/api/media/:id` entry.
- Produces: `/` adds the “大家的日子 / 来自 N 条时光链” header and chain-color source link only for feed items; `/moments/:momentId` retains comment CRUD with ReplyComposer; `/share/:token` remains no-Shell/read-only and retains `st` media access. `MediaBlock` renders 0/1/2/9 image cases, declared single-image ratio, square multi-image cells and video without changing URL semantics; `Lightbox({ items, index, shareToken?, onClose, onIndex })` opens the clicked index, wraps previous/next navigation, handles ArrowLeft/ArrowRight/Escape/outside/close, and renders both image and video.

- [ ] **Step 1: Write failing variant tests.**

In `MediaBlock.test.tsx`, mock `useMediaObjectUrl` and assert: zero items returns no media DOM; one image uses its 64/48 aspect ratio and calls `onOpen(0)`; two images form a two-column square grid; nine images form a complete three-column 3×3 grid and each callback reports 0–8; video renders the 16:9 play surface and then a native controls element. Assert authenticated image/video requests use object URLs returned by `useMediaObjectUrl(media.id)`, while share mode never requests a blob and uses the stable relative media URL plus exactly `?st=${encodeURIComponent(shareToken)}`. In `lightbox.test.tsx`, start at index 1, assert that item is visible, buttons and ArrowLeft/ArrowRight wrap through indexes, one-item mode hides arrows, Escape/outside/the named close button call `onClose`, and image/video retain the same authenticated blob versus share-token URL split. In `timeline-variants.test.tsx`, assert a feed moment exposes `● {chainName}` link, the same MomentSheet with no `chainLookById` does not, moment detail renders a reply Field plus existing delete-own-comment action, and share has neither compose nor reaction triggers while opening the clicked MediaBlock index through Lightbox.

- [ ] **Step 2: Run before page migration.**

Run: `pnpm --filter @moment/web test -- MediaBlock.test.tsx lightbox.test.tsx timeline-variants.test.tsx`

Expected: FAIL because feed header/source presentation, detail reply composition, and share’s old card/header styling have not been migrated.

- [ ] **Step 3: Recompose three variants on the sample contracts.**

Implement the feed header with one `记下此刻` primary action, use the existing `chainLookById` branch to render linkable color dot + chain name, and preserve feed filters/load semantics. Replace detail comment input/rows with Field and quiet/AlertDialog actions while retaining service mutations. Recompose MediaBlock without changing `useMediaObjectUrl` or share query semantics: preserve 0/1/2–9/video as first-class branches, declared single-image aspect ratio, square 2/3-column grid cells and clicked index. Migrate Lightbox to the Task 4 z/focus/IconButton rules while preserving controlled index, keyboard wrapping, close paths and image/video URL behavior. Give share the same timeline/media visual grammar, retain its token/API access and expiry/unavailable semantics, and leave it read-only/no Shell. These component tests add no new visual baseline file; Task 14 remains exactly 24 PNGs.

- [ ] **Step 4: Verify the three route variants.**

Run: `pnpm --filter @moment/web test -- MediaBlock.test.tsx lightbox.test.tsx timeline-variants.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; only Task 11 Files change, source link appears only on feed, and no share change adds authentication, interaction, DTO, media URL, or share-token behavior.

- [ ] **Step 5: Commit feed/detail/share migration.**

```bash
git add apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/share-album/index.tsx apps/web/src/media/MediaBlock.tsx apps/web/src/media/MediaBlock.test.tsx apps/web/src/timeline/lightbox.tsx apps/web/src/timeline/lightbox.test.tsx apps/web/src/pages/timeline-variants.test.tsx
git commit -m "feat(web): align feed detail and share views"
```

## Task 12: Migrate chain settings, profile and notifications

**Files:**

- Modify: `apps/web/src/pages/chain-settings/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Modify: `apps/web/src/chain/ChainLookPicker.tsx`
- Modify: `apps/web/src/pages/me/index.tsx`
- Modify: `apps/web/src/ui/ThemeToggle.tsx`
- Modify: `apps/web/src/ui/Avatar.tsx`
- Modify: `apps/web/src/pages/notifications/index.tsx`
- Create: `apps/web/src/pages/settings-account.test.tsx`

**Interfaces:**

- Consumes: Tasks 3–7 component APIs and existing ChainSettings/Me/Notification Services unchanged.
- Produces: semantic settings sections; callers use `useToast().show(...)` only for success whose result is otherwise invisible, while Task 8 remains the sole `ToastProvider`/`ToastRegion` owner; owner/editor/viewer visibility unchanged; profile retains theme `system | light | dark`; notifications retain read/pagination behavior.

- [ ] **Step 1: Write failing role/account tests.**

In `settings-account.test.tsx`, fixture each role and assert owner-only share/member/danger sections remain hidden for viewer, a destructive link opens AlertDialog with concrete labels, theme exposes all three existing choices, settings save calls `useToast().show({ key: 'settings-saved', message: '设置已保存' })`, and notifications show an action-color unread dot without card shadow.

- [ ] **Step 2: Run before migrating settings surfaces.**

Run: `pnpm --filter @moment/web test -- settings-account.test.tsx`

Expected: FAIL because old sections use sticker cards/small buttons/Confirm and do not use structured save feedback.

- [ ] **Step 3: Apply the settings composition pattern.**

Replace per-section card stacks, small entity buttons, private input styles and arbitrary confirmations with Field/Button/ResponsiveMenu/Banner/AlertDialog. Keep every existing service call, server error mapping and role guard exactly as is. Use a plain EmptyState where a settings sublist has no contents; make Me a quiet content stack retaining avatar upload/clear, three theme states and logout; make notification rows quiet with existing mark-read/load-more actions and structured loading/empty/error feedback. Do not edit any service or page outside the Task 12 Files.

- [ ] **Step 4: Verify role and feedback contracts.**

Run: `pnpm --filter @moment/web test -- settings-account.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; only Task 12 Files change, role branch output is unchanged except visual/components, and destructive outcomes do not add a duplicate Toast.

- [ ] **Step 5: Commit account/settings migration.**

```bash
git add apps/web/src/pages/chain-settings/index.tsx apps/web/src/pages/chain-settings/sections.tsx apps/web/src/chain/ChainLookPicker.tsx apps/web/src/pages/me/index.tsx apps/web/src/ui/ThemeToggle.tsx apps/web/src/ui/Avatar.tsx apps/web/src/pages/notifications/index.tsx apps/web/src/pages/settings-account.test.tsx
git commit -m "feat(web): redesign settings account and notifications"
```

## Task 13: Migrate authentication and invitation, then remove legacy UI

**Files:**

- Modify: `apps/web/src/pages/auth-frame.tsx`
- Modify: `apps/web/src/pages/login/index.tsx`
- Modify: `apps/web/src/pages/register/index.tsx`
- Modify: `apps/web/src/pages/invite/index.tsx`
- Create: `apps/web/src/pages/entry-states.test.tsx`
- Delete: `apps/web/src/ui/Button.tsx`
- Delete: `apps/web/src/ui/Field.tsx`
- Delete: `apps/web/src/ui/Menu.tsx`
- Delete: `apps/web/src/ui/Confirm.tsx`
- Delete: `apps/web/src/ui/Banner.tsx`
- Delete: `apps/web/src/ui/Empty.tsx`
- Delete: `apps/web/src/ui/HoverTip.tsx`
- Delete: `apps/web/src/ui/HappenedAtField.tsx`

**Interfaces:**

- Consumes: Task 3 `Button`; Task 4 `AlertDialog`; Task 5 public menu/popover APIs; Task 6 `TextField` and `PasswordField`; Task 7 `Banner`/Feedback APIs; and Task 8's already-created and already-consumed NotFound route module and singleton Toast integration. Existing Login/Register/Invite services remain unchanged.
- Produces: auth forms use TextField/PasswordField/Banner/Button; invite keeps `from` preservation and accepted-chain navigation; Task 8-owned wildcard and compose redirects remain unchanged. The eight tracked legacy UI files are removed only after all callers migrate; the never-tracked `apps/web/src/ui/Floating.tsx` is only asserted absent and is never staged or passed to `git rm`.

- [ ] **Step 1: Write failing entry-flow tests.**

In `entry-states.test.tsx`, assert login/register inputs have `autocomplete="email"`, `current-password`/`new-password`, concrete field errors, and submit Button loading; invite redirect preserves its existing `from` query and accepted-chain navigation. Task 8 already owns wildcard and compose-redirect coverage, so this test neither imports nor recreates those routes.

- [ ] **Step 2: Run before migration.**

Run: `pnpm --filter @moment/web test -- entry-states.test.tsx`

Expected: FAIL because the authentication and invitation surfaces still use legacy Field/Button composition and old entry imports.

- [ ] **Step 3: Recompose all entry surfaces without altering flows.**

Use AuthFrame only for layout and shared tokens, TextField/PasswordField for native semantics, Banner for service errors and one explicit submit Button per form. Preserve the existing schemas, service calls, `from` redirect and invite accept behavior. Do not modify `App.tsx`, `pages/not-found.tsx` or its Task 8 test. Before deletion, require a repository-wide old-import scan to pass; then delete every listed tracked old file, with `git rm apps/web/src/ui/HoverTip.tsx` explicitly required.

- [ ] **Step 4: Verify entry behavior and route preservation.**

Run: `pnpm --filter @moment/web test -- entry-states.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; only Task 13 Files change, route paths/params/redirect targets exactly match the Task 8 App contract, and deletion gates report no old imports or tracked legacy files.

- [ ] **Step 5: Prove cleanup safety and remove legacy UI.**

Run: `test "$(rg -l "@/ui/(Button|Field|Menu|Confirm|Banner|Empty|HoverTip|HappenedAtField|Floating)|from ['\"]\.\/(Button|Field|Menu|Confirm|Banner|Empty|HoverTip|HappenedAtField|Floating)" apps/web/src --glob '*.{ts,tsx}' | wc -l | tr -d ' ')" -eq 0 && test ! -e apps/web/src/ui/Floating.tsx && git rm apps/web/src/ui/HoverTip.tsx && git rm apps/web/src/ui/Button.tsx apps/web/src/ui/Field.tsx apps/web/src/ui/Menu.tsx apps/web/src/ui/Confirm.tsx apps/web/src/ui/Banner.tsx apps/web/src/ui/Empty.tsx apps/web/src/ui/HappenedAtField.tsx`

Expected: the import scan exits 0 before deletion, the absent `Floating.tsx` ghost is verified without a removal or staging command, `HoverTip.tsx` is removed through `git rm`, and no listed tracked legacy path remains.

- [ ] **Step 6: Verify entry flows and cleanup ghosts.**

Run: `pnpm --filter @moment/web test -- entry-states.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && ! rg -n "(shadow-sticker|control-sm|text-(today|knot)|@/ui/(Button|Field|Menu|Confirm|Banner|Empty|HoverTip|HappenedAtField|Floating))" apps/web/src --glob '*.{ts,tsx}'`

Expected: PASS; no old imports, deleted ghost paths or legacy visual hooks remain, and service/API/DTO/RAB semantics are unchanged.

- [ ] **Step 7: Commit entry migration and cleanup.**

```bash
git add apps/web/src/pages/auth-frame.tsx apps/web/src/pages/login/index.tsx apps/web/src/pages/register/index.tsx apps/web/src/pages/invite/index.tsx apps/web/src/pages/entry-states.test.tsx
git add -u apps/web/src/ui/Button.tsx apps/web/src/ui/Field.tsx apps/web/src/ui/Menu.tsx apps/web/src/ui/Confirm.tsx apps/web/src/ui/Banner.tsx apps/web/src/ui/Empty.tsx apps/web/src/ui/HoverTip.tsx apps/web/src/ui/HappenedAtField.tsx
git commit -m "feat(web): migrate entry states and remove legacy ui"
```

## Task 14: Add replayable CSI E2E and visual regression coverage

**Files:**

- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/.env.example`
- Create: `apps/server/src/e2e/fixture-asset.ts`
- Create: `apps/server/src/e2e/fixture-cli-contract.ts`
- Create: `apps/server/src/e2e/fixture-cli-contract.test.ts`
- Create: `apps/server/src/e2e/fixture-rows.ts`
- Create: `apps/server/src/e2e/fixture-rows.test.ts`
- Create: `apps/server/src/e2e/fixture-seeder.ts`
- Create: `apps/server/src/e2e/fixture-cli.ts`
- Create: `apps/web/e2e/run.mjs`
- Create: `apps/web/e2e/lib/bridge.mjs`
- Create: `apps/web/e2e/lib/bridge.test.mjs`
- Create: `apps/web/e2e/lib/env.mjs`
- Create: `apps/web/e2e/lib/manifest.mjs`
- Create: `apps/web/e2e/lib/manifest.test.mjs`
- Create: `apps/web/e2e/fixtures/seed.mjs`
- Create: `apps/web/e2e/fixtures/seed.test.mjs`
- Create: `apps/web/e2e/cases/design-system-regression.md`
- Create: `apps/web/e2e/suites/design-system-regression.mjs`
- Create: `apps/web/e2e/baselines/manifest.json`
- Create: `apps/web/e2e/baselines/design-lab/light/390.png`
- Create: `apps/web/e2e/baselines/design-lab/light/1024.png`
- Create: `apps/web/e2e/baselines/design-lab/light/1440.png`
- Create: `apps/web/e2e/baselines/design-lab/light/1895.png`
- Create: `apps/web/e2e/baselines/design-lab/dark/390.png`
- Create: `apps/web/e2e/baselines/design-lab/dark/1024.png`
- Create: `apps/web/e2e/baselines/design-lab/dark/1440.png`
- Create: `apps/web/e2e/baselines/design-lab/dark/1895.png`
- Create: `apps/web/e2e/baselines/feed-home/light/390.png`
- Create: `apps/web/e2e/baselines/feed-home/light/1024.png`
- Create: `apps/web/e2e/baselines/feed-home/light/1440.png`
- Create: `apps/web/e2e/baselines/feed-home/light/1895.png`
- Create: `apps/web/e2e/baselines/feed-home/dark/390.png`
- Create: `apps/web/e2e/baselines/feed-home/dark/1024.png`
- Create: `apps/web/e2e/baselines/feed-home/dark/1440.png`
- Create: `apps/web/e2e/baselines/feed-home/dark/1895.png`
- Create: `apps/web/e2e/baselines/chain-home/light/390.png`
- Create: `apps/web/e2e/baselines/chain-home/light/1024.png`
- Create: `apps/web/e2e/baselines/chain-home/light/1440.png`
- Create: `apps/web/e2e/baselines/chain-home/light/1895.png`
- Create: `apps/web/e2e/baselines/chain-home/dark/390.png`
- Create: `apps/web/e2e/baselines/chain-home/dark/1024.png`
- Create: `apps/web/e2e/baselines/chain-home/dark/1440.png`
- Create: `apps/web/e2e/baselines/chain-home/dark/1895.png`
- Create: `apps/web/e2e/README.md`

**Interfaces:**

- Consumes: Task 2's package-owned `e2e:design-system` script, `pixelmatch`/`pngjs` dependencies and artifact-ignore rules; Task 8 `/__design-lab`; Task 9–13 route/UI contracts; the current Drizzle insert schemas; existing `hashPassword(plain: string): Promise<string>`; existing `getStorage()`/`currentStorageMeta()`; and a CSI daemon. Task 14 must not modify `apps/web/package.json`, `pnpm-lock.yaml`, `.gitignore`, app source, route/controller registration, or any legacy component path.
- Produces config-owned `MOMENT_E2E`, `MOMENT_E2E_OWNER_EMAIL`, `MOMENT_E2E_OWNER_PASSWORD`, `MOMENT_E2E_VIEWER_EMAIL`, and `MOMENT_E2E_VIEWER_PASSWORD`. `fixture-cli-contract.ts` imports neither `config`, `db`, storage nor the seeder and exports the plain structural `E2eFixtureEnv`, `FixtureAction = 'preflight' | 'reset' | 'seed' | 'teardown'`, `parseFixtureAction(argv: readonly string[]): FixtureAction`, `assertE2eFixtureGuard(env: E2eFixtureEnv): void`, `assertE2eStorageGuard(env: E2eFixtureEnv): void`, `readE2eFixtureCredentials(env: E2eFixtureEnv): E2eFixtureCredentials`, `runFixtureAction(action: FixtureAction, credentials: E2eFixtureCredentials | undefined, dependencies: { loadSeeder(): Promise<FixtureSeederModule>; serialize(value: E2eCliResult): string }): Promise<string>`, and `executeFixtureCli(options: { argv: readonly string[]; env: E2eFixtureEnv; loadSeeder(): Promise<FixtureSeederModule>; writeStdout(text: string): void; writeStderr(text: string): void; setExitCode(code: number): void }): Promise<void>`. All actions pass the exact database and storage guards; only `seed` calls `readE2eFixtureCredentials`. `preflight` serializes exactly `{ mode: 'e2e', database: 'moment_e2e' }` without `loadSeeder`; each write action runs action → serialization → `closeFixtureDb()` in `finally`, exactly once. `fixture-cli.ts` is the sole composition root that imports `config`, passes it to `executeFixtureCli`, supplies the dynamic `fixture-seeder.ts` loader and maps failure to `process.exitCode`; importing/testing the pure contract never parses repository config or opens MySQL/S3.
- Produces `fixture-rows.ts` as a DB-free deterministic row factory. It exports the stable IDs `ownerId=00000000-0000-4000-8000-000000000011`, `viewerId=00000000-0000-4000-8000-000000000012`, `tagId=00000000-0000-4000-8000-000000000013`, `chainId=00000000-0000-4000-8000-000000000014`, `momentId=00000000-0000-4000-8000-000000000015`, `imageMomentId=00000000-0000-4000-8000-000000000016`, `mediaId=00000000-0000-4000-8000-000000000017`, `shareLinkId=00000000-0000-4000-8000-000000000018`, and `inviteId=00000000-0000-4000-8000-000000000019`; `FIXTURE_FIXED_NOW='2026-08-18T09:30:00.000Z'`; `FIXTURE_EXPIRY_MS=315360000000` (3650 days); and `buildFixtureRows(credentials, { hashPassword, storageMeta }): Promise<FixtureRows>`. The row factory calls the injected existing hash function once per password and returns complete typed insert values for users/chains/members/moments/media/tags/momentTags/shareLinks/chainInvites; its module has no config/DB/storage import or side effect.
- Produces `fixture-asset.ts` exports `FIXTURE_IMAGE_PNG: Buffer`, `FIXTURE_IMAGE_MIME: 'image/png'`, `FIXTURE_IMAGE_WIDTH: 64`, `FIXTURE_IMAGE_HEIGHT: 48`, and adapter-relative `FIXTURE_IMAGE_STORAGE_KEY: 'chains/00000000-0000-4000-8000-000000000014/00000000-0000-4000-8000-000000000016/00000000-0000-4000-8000-000000000017.png'`. Keep the already validated literal unchanged: 228 Base64 characters, 169 decoded bytes, strict 64×48 RGBA8 PNG.
- Produces `fixture-seeder.ts` exports `resetFixture(): Promise<{ ok: true }>`, `seedFixture(credentials: E2eFixtureCredentials): Promise<DesignSystemFixture>`, `teardownFixture(): Promise<{ ok: true }>`, and `closeFixtureDb(): Promise<void>`. `seedFixture` passes existing `hashPassword` and captured storage metadata to `buildFixtureRows`, then writes those rows without changing a value. The password-free result is `DesignSystemFixture = { owner: { id; email; nickname }; viewer: { id; email; nickname }; tagId; chainId; momentId; imageMomentId; mediaId; shareLinkId; inviteId; shareToken; inviteToken; fixedNow; apiBaseUrl; webBaseUrl }`; reset/teardown return `{ ok: true }`.
- Web produces `node e2e/run.mjs design-system-regression [--update-baselines]`; action-specific `seed({ action: 'reset' | 'seed' | 'teardown' }): Promise<DesignSystemFixture | { ok: true }>`; `assertE2eEnvironment(): WebE2eEnvironment`, whose owner/viewer passwords come directly from the runner's local environment and never from CLI stdout; `bridge.request(action: string, args: object): Promise<unknown>` with exact `{ action, args, session: 'e2e-web-design-system-refactor' }` and `success/data`; `bridge.comparePng({ baselinePath, actualPath, threshold: 0.1, maxDiffPixels: 120 }): Promise<{ diffPixels: number; diffPath: string }>`; and `loadBaselineManifest(): Promise<BaselineCase[]>`, whose `requiredContent` uses only the seven closed labels. The sole manifest owns exactly the 24 PNG files listed in this Task's Files; only `--update-baselines` writes one of them, and normal runs write only ignored artifacts.

- [ ] **Step 1: Write the failing guarded-CLI contract and natural-language case before automation.**

Create `apps/server/src/e2e/fixture-cli-contract.test.ts` with Node's built-in test runner and import only `fixture-cli-contract.ts`. Assert exact-one-argument parsing for `preflight|reset|seed|teardown` and reject missing/extra/unknown actions. Assert each absent or invalid database guard member rejects before an injected seeder runs: `MOMENT_E2E !== '1'`, `NODE_ENV !== 'test'`, and missing/non-exact `MYSQL_DATABASE`, including another `_e2e` name. Assert storage guard rejects a non-`moment-e2e` bucket, a missing/non-loopback or HTTPS endpoint, and a public bucket without a network request. Parameterize `executeFixtureCli` with guard-complete environments that omit all four credential variables and prove `preflight`, `reset`, and `teardown` succeed; prove only `seed` rejects each missing/empty/invalid email/password before `loadSeeder`. Assert preflight's exact JSON and zero loader calls; password-free seed stdout; sanitized errors; success trace `action, serialize, close`; action-failure trace `action, close`; serializer-failure trace `action, serialize, close`; closer failure is fatal; and `setExitCode(1)` is called without `process.exit()`. The test source and its import graph must contain no `config`, `fixture-seeder`, `db`, storage factory, dotenv or network import, so this exact command passes in `env -i` with only `PATH` and repository-local Node resolution.

Create `apps/server/src/e2e/fixture-rows.test.ts` and inject a fake `hashPassword` that records its inputs and returns `hash:owner`/`hash:viewer`, plus an inert storage metadata object. Capture the complete `FixtureRows` result and assert the two exact password inputs occur once each and only the returned hashes enter `users.passwordHash`; assert every row value and FK listed in Step 3, the stable IDs and Chinese nicknames, member roles, moment authors, media uploader, share/invite creators, `acceptedAt`/`revokedAt`, and both deterministic expiries `new Date(Date.parse(FIXTURE_FIXED_NOW) + FIXTURE_EXPIRY_MS)`. The test imports no schema, config, DB or storage runtime module.

Create `apps/web/e2e/fixtures/seed.test.mjs` with an injected `execFile` fake. A guard-complete environment without any fixture credentials must allow reset and teardown and show the exact `preflight → requested action` child sequence; the same environment must reject seed before a child call. Supplying all four credentials must allow seed, but parsed stdout and error messages must omit password keys/values. All three actions still reject missing `MOMENT_E2E=1`, non-test NODE_ENV, non-exact database, unsafe storage values, or either non-loopback/wrong-port base URL. The test makes no child, DB, S3 or network connection.

Create `apps/web/e2e/lib/bridge.test.mjs` with an injected `fetch` stub; it must never contact `127.0.0.1:10088` or navigate Chrome. Assert the status preflight uses `GET /status`; command requests use `POST /command` and the exact top-level `{ action, args, session }` shape; `{ success: true, data: value }` returns `value`; `{ success: false, error }` rejects; `open` maps to `navigate`, `press` maps to `send_keys`, and both viewport operations map to `cdp` with their exact CDP method/params. Create `apps/web/e2e/lib/manifest.test.mjs` to require exactly the `design-lab`, `feed-home` and `chain-home` route slugs × two themes × four width/height pairs and the 24 unique relative PNG paths listed in this task. It must assert every required-content label—`大家的日子`, `单链页`, `纯文字时刻`, `单图时刻`, `跨年索引`, `长Tag`, and `长链名`—appears in at least one baseline's `requiredContent`; after capture it must also reject a missing, duplicate, path-traversing or unlisted PNG and any unknown required-content label.

Create the case as a human-readable acceptance journey, not an automation implementation: it contains user actions and visible outcomes only, with no CSS selector, `data-*` selector, XPath, CSI `@e` reference, or locator syntax. It must name these exact fixture inputs and invariants:

```text
owner.email    = MOMENT_E2E_OWNER_EMAIL (example for apps/server/.env.e2e: owner.e2e@moment.invalid)
owner.password = MOMENT_E2E_OWNER_PASSWORD
owner.id       = 00000000-0000-4000-8000-000000000011
owner.nickname = 林晓满
viewer.email   = MOMENT_E2E_VIEWER_EMAIL (example for apps/server/.env.e2e: viewer.e2e@moment.invalid)
viewer.password = MOMENT_E2E_VIEWER_PASSWORD
viewer.id      = 00000000-0000-4000-8000-000000000012
viewer.nickname = 周小禾
tagId          = 00000000-0000-4000-8000-000000000013
chainId        = 00000000-0000-4000-8000-000000000014
momentId       = 00000000-0000-4000-8000-000000000015
imageMomentId  = 00000000-0000-4000-8000-000000000016
mediaId        = 00000000-0000-4000-8000-000000000017
shareLinkId    = 00000000-0000-4000-8000-000000000018
inviteId       = 00000000-0000-4000-8000-000000000019
shareToken     = e2e-design-system-share-token
inviteToken    = e2e-design-system-invite-token
fixedNow       = 2026-08-18T09:30:00.000Z
apiBaseUrl     = http://127.0.0.1:3000/api
webBaseUrl     = http://127.0.0.1:5173
```

Passwords come only from ignored local `apps/server/.env.e2e` or CI's non-production secret store: do not put a password, access token, or MySQL connection field in any tracked fixture, case, suite, screenshot name, terminal output, or README. The case says to first reset then seed; then perform a real `/api/auth/login` through the visible `/login` form as viewer, verify 周小禾 and viewer/read-only permissions, log out and observe auth-clear, perform a second real visible login as owner, verify 林晓满 and owner edit/delete/member controls, and only then enter the owner-authenticated screenshot matrix. A fixture object or localStorage injection never substitutes for either login. Visit `/__design-lab`, `/`, `/chains/{chainId}`, `/chains/{chainId}?compose=1`, `/chains/{chainId}/settings`, `/moments/{momentId}`, `/me`, `/notifications`, `/share/{shareToken}`, `/invites/{inviteToken}`, `/login`, `/register`, and authenticated wildcard; verify visible role/read-only/invite-from, reaction/comment/edit/delete, tag/order/date-anchor, loading/error/empty, and no-business-semantics-drift states. Name and visibly verify the long chain `我们一起走过的很长很长的时光链名字`, the long tag `跨年旅行与新年第一束光和家人的漫长回忆`, the pure-text moment `2025 年最后一天：一起把这一年的温柔收好。` at `2025-12-31T15:30:00.000Z`, the one-image moment `2026 年第一天：新年的第一束光。` at `2026-01-01T00:30:00.000Z`, and the 2025/2026 rail boundary. Both `/` and `/chains/{chainId}` must show both seeded moments, the decoded image, long values and cross-year index together before their screenshot; `/` additionally shows `大家的日子`, and the chain route proves the single-chain variant. Cover light and dark at 390×844, 1024×900, 1440×900 and 1895×900; keyboard and overlay behavior; reduced motion; and a separate 1440×900 light-theme 200% zoom journey with visible labels and no horizontal clipping.

- [ ] **Step 2: Prove the new contracts fail before implementation.**

Run:

```bash
env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts apps/server/src/e2e/fixture-rows.test.ts
node --test apps/web/e2e/fixtures/seed.test.mjs apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/manifest.test.mjs
pnpm --filter @moment/web e2e:design-system
```

Expected: the clean-shell server command fails because the pure CLI/row modules do not exist, without importing config or attempting DB/S3; the Web Node command fails because seed/bridge/manifest implementations and the manifest file do not exist, without starting a child or network call; the package command fails with Node's missing-module error for `apps/web/e2e/run.mjs`. The package command itself resolves because Task 2, the sole `package.json` owner, already installed the script. Do not edit `package.json` to make any command fail or pass.

- [ ] **Step 3: Implement the guarded local seeder, bridge, runner and suite.**

In `apps/server/src/config.ts`, add `MOMENT_E2E` as the literal `'0' | '1'` config value defaulting to `'0'` and add the four E2E credential variables as empty-string-to-`undefined` optional config values; email values use email validation and password values use the same minimum length as registration. In `apps/server/.env.example`, add `MOMENT_E2E=0`, the two `.invalid` example emails and blank `MOMENT_E2E_OWNER_PASSWORD=` / `MOMENT_E2E_VIEWER_PASSWORD=` lines with a comment that real values exist only in ignored `apps/server/.env.e2e` or CI's non-production secret store. Add a second comment beside the existing `ATTACHMENT_S3_*` block: E2E overrides those same variables with private `ATTACHMENT_S3_BUCKET=moment-e2e`, a loopback `ATTACHMENT_S3_ENDPOINT`, and an E2E-only prefix; do not add a second storage configuration. Do not add the ignored file to Git and do not add another MySQL connection variable: it overrides the existing `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE=moment_e2e` fields.

`fixture-cli-contract.ts` implements all parsing, guard, credential and lifecycle logic against its plain injected environment/dependencies. The database guard requires the entire database name to equal `moment_e2e`; an `_e2e` marker elsewhere or a different suffixed database is rejected. The storage guard parses `ATTACHMENT_S3_ENDPOINT` with `URL`, accepts only `http:` plus hostname `127.0.0.1`, `localhost` or `[::1]`, requires `ATTACHMENT_S3_BUCKET === 'moment-e2e'`, and requires `ATTACHMENT_S3_IS_PUBLIC === false`; it performs no request. `preflight` is guard-only and returns fixed JSON without calling `loadSeeder`. Only `seed` validates/reads credentials. For `reset|seed|teardown`, `runFixtureAction` awaits the selected injected module method, calls the injected serializer while the DB is still open, and always awaits `closeFixtureDb()` exactly once in `finally`; closer error remains fatal. `fixture-cli.ts` contains only composition: statically import `config` and the pure contract, pass a dynamic seeder loader plus `JSON.stringify`/stdout/sanitized-stderr/exit-code adapters, and call `executeFixtureCli`. It never calls `process.exit()`. Thus the executable parses real config only at the edge, while the clean-shell contract test never imports config, dotenv, DB or S3.

`fixture-asset.ts` is source-only and has no filesystem/network read. Define the exact deterministic PNG as:

```ts
export const FIXTURE_IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAcElEQVR4AeXBURWAIADAwLlnFTtQgwoUILYxNAYfu7vePT8OWgxOkjiJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJk7ibhzSJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJ+wE1twPHArzfWQAAAABJRU5ErkJggg==",
  "base64",
);
export const FIXTURE_IMAGE_MIME = "image/png" as const;
export const FIXTURE_IMAGE_WIDTH = 64;
export const FIXTURE_IMAGE_HEIGHT = 48;
export const FIXTURE_IMAGE_STORAGE_KEY =
  "chains/00000000-0000-4000-8000-000000000014/00000000-0000-4000-8000-000000000016/00000000-0000-4000-8000-000000000017.png" as const;
```

`fixture-rows.ts` implements this complete deterministic row contract, with `fixedNow = new Date(FIXTURE_FIXED_NOW)` and `expiry = new Date(fixedNow.getTime() + FIXTURE_EXPIRY_MS)`; neither is derived from `Date.now()`:

| Table           | Exact inserted values                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users` owner   | `{ id: ownerId, email: credentials.owner.email, passwordHash: await hashPassword(credentials.owner.password), nickname: '林晓满', passwordChangedAt: null, createdAt: fixedNow, avatarMediaId: null, avatarColor: null, avatarIcon: null }`                                                                   |
| `users` viewer  | `{ id: viewerId, email: credentials.viewer.email, passwordHash: await hashPassword(credentials.viewer.password), nickname: '周小禾', passwordChangedAt: null, createdAt: fixedNow, avatarMediaId: null, avatarColor: null, avatarIcon: null }`                                                                |
| `chains`        | `{ id: chainId, name: '我们一起走过的很长很长的时光链名字', description: '一起收藏日常', coverMediaId: null, color: null, icon: null, visibility: 'private', ownerId, createdAt: fixedNow, updatedAt: fixedNow }`                                                                                             |
| `chainMembers`  | `[{ chainId, userId: ownerId, role: 'owner', joinedAt: fixedNow }, { chainId, userId: viewerId, role: 'viewer', joinedAt: fixedNow }]`                                                                                                                                                                        |
| `moments` text  | `{ id: momentId, chainId, authorId: ownerId, type: 'text', content: '2025 年最后一天：一起把这一年的温柔收好。', happenedAt: new Date('2025-12-31T15:30:00.000Z'), happenedTzOffset: -480, isBackfill: true, createdAt: fixedNow, updatedAt: fixedNow, deletedAt: null }`                                     |
| `moments` image | `{ id: imageMomentId, chainId, authorId: viewerId, type: 'media', content: '2026 年第一天：新年的第一束光。', happenedAt: new Date('2026-01-01T00:30:00.000Z'), happenedTzOffset: -480, isBackfill: true, createdAt: fixedNow, updatedAt: fixedNow, deletedAt: null }`                                        |
| `media`         | `{ id: mediaId, momentId: imageMomentId, uploaderId: viewerId, s3Key: FIXTURE_IMAGE_STORAGE_KEY, mime: FIXTURE_IMAGE_MIME, size: FIXTURE_IMAGE_PNG.byteLength, width: 64, height: 48, duration: null, posterMediaId: null, sortOrder: 0, status: 'ready', storageMeta, uploadId: null, createdAt: fixedNow }` |
| `tags`          | `{ id: tagId, chainId, name: '跨年旅行与新年第一束光和家人的漫长回忆', createdAt: fixedNow }`                                                                                                                                                                                                                 |
| `momentTags`    | `{ momentId, tagId }`                                                                                                                                                                                                                                                                                         |
| `shareLinks`    | `{ id: shareLinkId, chainId, token: 'e2e-design-system-share-token', createdBy: ownerId, expiresAt: expiry, revokedAt: null, createdAt: fixedNow }`                                                                                                                                                           |
| `chainInvites`  | `{ id: inviteId, chainId, token: 'e2e-design-system-invite-token', email: credentials.viewer.email, role: 'viewer', createdBy: ownerId, expiresAt: expiry, acceptedAt: null, createdAt: fixedNow }`                                                                                                           |

`fixture-seeder.ts` is the only DB/storage-writing producer. It accepts parsed credentials and never reads `process.env`. `resetFixture` obtains the current adapter/snapshot, idempotently deletes the fixture object, then deletes schema rows in foreign-key reverse order (`pushTokens`, `notifications`, `reactions`, `comments`, `momentTags`, `tags`, `outbox`, `media`, `moments`, `chainInvites`, `chainMembers`, `shareLinks`, `chains`, `refreshTokens`, `users`). `seedFixture` first resets, uploads the exact PNG through `uploadFile(key, buffer)`, captures `currentStorageMeta()`, calls `buildFixtureRows(credentials, { hashPassword, storageMeta })` with the existing auth helper, and transactionally inserts each returned row without implicit defaults or value rewriting. The invite targets the already-member viewer intentionally, so current idempotent accept semantics return that chain while the exact future expiry remains valid through 2036 and repeatable. If the transaction fails after upload, delete the uploaded object with the same metadata and rethrow. `teardownFixture` delegates to reset. `closeFixtureDb` only awaits the existing `pool.end()`. Do not create an HTTP endpoint/controller/route, middleware exception, reset secret, direct `S3Client`, second adapter, or `resetDb()` call.

`fixtures/seed.mjs` is the only Web seed/reset producer. Every action requires `MOMENT_E2E=1`, `NODE_ENV=test`, exact `MYSQL_DATABASE=moment_e2e`, safe storage guard values, and HTTP loopback base URLs with exact ports 3000/5173; only `action === 'seed'` reads and requires the four fixture credentials. Reset, teardown and their preflight child run with credentials absent. Resolve `repoRoot` from `new URL('../../../../', import.meta.url)` and CLI from `new URL('../../../server/src/e2e/fixture-cli.ts', import.meta.url)`; invoke `execFile(process.execPath, ['--loader', 'ts-node/esm', fixtureCliPath, action], { cwd: repoRoot, env: inheritedGuardedEnv })`. This works when the filtered command starts at the repository's `apps/web` directory. Parse only JSON stdout, reject nonzero status, and run credential-free preflight before every write, requiring exact `{ mode: 'e2e', database: 'moment_e2e' }`. Failure exposes only action/status, never stderr or secrets. The runner gets passwords separately from `assertE2eEnvironment()` and never from child output.

`lib/env.mjs` exports `assertE2eEnvironment()`, `waitForReadiness()`, and `waitForVisualIdle()`. The README makes a dedicated, private, non-production local S3-compatible service a hard prerequisite: configure an `mc` alias named `e2e` for the loopback MinIO/S3 endpoint, run `mc mb --ignore-existing e2e/moment-e2e` and `mc anonymous set none e2e/moment-e2e`, and never reuse a development or production bucket. The ignored `apps/server/.env.e2e` must set `MYSQL_DATABASE=moment_e2e`, `ATTACHMENT_S3_BUCKET=moment-e2e`, `ATTACHMENT_S3_PREFIX=e2e/attachments`, `ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9000`, `ATTACHMENT_S3_IS_PUBLIC=false`, and locally supplied `ATTACHMENT_S3_ACCESS_KEY_ID`/`ATTACHMENT_S3_SECRET_ACCESS_KEY`; no tracked README value contains those credentials. Its commands are exact and run in three terminals only after that bucket exists and the ignored environment is sourced:

```bash
# terminal 1: server; the ignored file contains only dedicated E2E values
set -a; source apps/server/.env.e2e; set +a
MOMENT_E2E=1 NODE_ENV=test PORT=3000 pnpm --filter @moment/server exec nodemon --exec "node --loader ts-node/esm" ./src/index.ts

# terminal 2: Web uses Vite's existing same-origin /api proxy
pnpm --filter @moment/web dev -- --host 127.0.0.1 --port 5173 --strictPort

# terminal 3: readiness, deterministic reset/seed, replay, deterministic teardown
set -a; source apps/server/.env.e2e; set +a
until curl -fsS http://127.0.0.1:3000/api/health | rg -q '"status":"ok"'; do sleep 0.2; done
until curl -fsS http://127.0.0.1:5173/ > /dev/null; do sleep 0.2; done
MOMENT_E2E=1 node --loader ts-node/esm apps/server/src/e2e/fixture-cli.ts preflight
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs reset
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs seed
pnpm --filter @moment/web e2e:design-system
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs teardown
```

The runner owns `try/finally` teardown, so the explicit final command is only the recovery/debug command and every normal, failure, interrupt, and `--update-baselines` run calls it. `run.mjs` accepts only the suite name and optional `--update-baselines`, rejects any other argument, resets and seeds before suite execution, and uses the one CSI session `e2e-web-design-system-refactor`.

`bridge.mjs` wraps CSI at the fixed daemon URL `http://127.0.0.1:10088`. Before opening a page or issuing an action, it calls `GET /status` and rejects unless JSON has `extension_connected === true`. Every bridge operation sends `POST /command` with exactly `{ action, args, session: 'e2e-web-design-system-refactor' }`, parses JSON, rejects unless the response has `success === true`, and returns only `data`. Use this exact action map:

| Bridge method                | CSI action   | Exact args                                                                                                         |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `open(url)`                  | `navigate`   | `{ url }`                                                                                                          |
| `click(selector)`            | `click`      | `{ selector }`                                                                                                     |
| `press(keys, repeat?)`       | `send_keys`  | `{ keys, ...(repeat === undefined ? {} : { repeat }) }`                                                            |
| `fill(selector, value)`      | `fill`       | `{ selector, value }`                                                                                              |
| `evaluate(code)`             | `evaluate`   | `{ code }`                                                                                                         |
| `screenshot(path)`           | `screenshot` | `{ format: 'png', path }`                                                                                          |
| `waitForNetworkIdle()` poll  | `evaluate`   | `{ code: WAIT_FOR_NETWORK_IDLE_SCRIPT }`                                                                           |
| `setViewport(width, height)` | `cdp`        | `{ method: 'Emulation.setDeviceMetricsOverride', params: { width, height, deviceScaleFactor: 1, mobile: false } }` |
| `setPageScaleFactor(scale)`  | `cdp`        | `{ method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: scale } }`                                   |

`WAIT_FOR_NETWORK_IDLE_SCRIPT` is a fixed source string exported beside the bridge and used by the fetch-stub contract test; it observes the suite's tracked fetch/XHR counter and returns only after zero pending requests has remained stable for 500 ms. The bridge records actual image, pixel diff and JSON assertion evidence in the ignored artifacts directory. The suite is the only file with stable locators: semantic role/name, label, or unique `id`/`data-testid` locators only; no classes, positional selectors, CSS layout selectors, XPath, or `@e` references. Before any authenticated baseline capture, the suite opens `/login`, fills and submits the visible form with viewer credentials, waits for authenticated viewer UI and asserts read-only controls; it then performs the visible logout, waits for the login page and cleared ToastRegion, repeats the visible login with owner credentials, waits for owner UI/edit controls, and retains that real owner session for feed/chain captures. It must not call tokenStore, mutate local/session storage, synthesize auth state, or treat the seed result as a session.

Create `apps/web/e2e/baselines/manifest.json` as the sole baseline producer list with these exact entries. `requiredContent` is manifest metadata consumed by the suite before capture, not a free-form note; the suite maps each label to a concrete visible assertion. `manifest.mjs` rejects any other route slug, theme, viewport, required-content label, relative file, duplicate, missing file after capture, or extra PNG under the baseline root:

| Route slug   | Route               | Theme | Viewport | `requiredContent`                                                    | PNG path                    |
| ------------ | ------------------- | ----- | -------- | -------------------------------------------------------------------- | --------------------------- |
| `design-lab` | `/__design-lab`     | light | 390×844  | `[]`                                                                 | `design-lab/light/390.png`  |
| `design-lab` | `/__design-lab`     | light | 1024×900 | `[]`                                                                 | `design-lab/light/1024.png` |
| `design-lab` | `/__design-lab`     | light | 1440×900 | `[]`                                                                 | `design-lab/light/1440.png` |
| `design-lab` | `/__design-lab`     | light | 1895×900 | `[]`                                                                 | `design-lab/light/1895.png` |
| `design-lab` | `/__design-lab`     | dark  | 390×844  | `[]`                                                                 | `design-lab/dark/390.png`   |
| `design-lab` | `/__design-lab`     | dark  | 1024×900 | `[]`                                                                 | `design-lab/dark/1024.png`  |
| `design-lab` | `/__design-lab`     | dark  | 1440×900 | `[]`                                                                 | `design-lab/dark/1440.png`  |
| `design-lab` | `/__design-lab`     | dark  | 1895×900 | `[]`                                                                 | `design-lab/dark/1895.png`  |
| `feed-home`  | `/`                 | light | 390×844  | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/light/390.png`   |
| `feed-home`  | `/`                 | light | 1024×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/light/1024.png`  |
| `feed-home`  | `/`                 | light | 1440×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/light/1440.png`  |
| `feed-home`  | `/`                 | light | 1895×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/light/1895.png`  |
| `feed-home`  | `/`                 | dark  | 390×844  | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/dark/390.png`    |
| `feed-home`  | `/`                 | dark  | 1024×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/dark/1024.png`   |
| `feed-home`  | `/`                 | dark  | 1440×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/dark/1440.png`   |
| `feed-home`  | `/`                 | dark  | 1895×900 | `["大家的日子","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]` | `feed-home/dark/1895.png`   |
| `chain-home` | `/chains/{chainId}` | light | 390×844  | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/light/390.png`  |
| `chain-home` | `/chains/{chainId}` | light | 1024×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/light/1024.png` |
| `chain-home` | `/chains/{chainId}` | light | 1440×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/light/1440.png` |
| `chain-home` | `/chains/{chainId}` | light | 1895×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/light/1895.png` |
| `chain-home` | `/chains/{chainId}` | dark  | 390×844  | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/dark/390.png`   |
| `chain-home` | `/chains/{chainId}` | dark  | 1024×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/dark/1024.png`  |
| `chain-home` | `/chains/{chainId}` | dark  | 1440×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/dark/1440.png`  |
| `chain-home` | `/chains/{chainId}` | dark  | 1895×900 | `["单链页","纯文字时刻","单图时刻","跨年索引","长Tag","长链名"]`     | `chain-home/dark/1895.png`  |

For each state, assert all of its `requiredContent` labels against visible DOM and decoded media, then wait for `document.fonts.ready`, decoded rendered images/video poster promises, two `requestAnimationFrame` frames after layout, and no tracked fetch/XHR for 500 ms before the screenshot or comparison. The runner iterates the manifest's 24 entries and no computed or caller-supplied baseline path; compare with threshold `0.1` and `maxDiffPixels: 120`, fail on either exceeded value, and retain `artifacts/{runId}/{routeSlug}-{theme}-{width}.actual.png`, `.diff.png`, and `.json`. The feed-home and chain-home setup keeps the long chain name, long tag, 2025/2026 rail labels, pure-text moment and decoded one-image moment simultaneously rendered for every viewport before capture. At 390 px assert focus order, Tab/Shift+Tab, Escape, outside click and focus restoration for each overlay; at 767 px assert ResponsiveMenu is an ActionSheet; at 768 px assert it is anchored; resize an open menu/sheet across the boundary and assert it closes and returns focus. Assert Popover collision, AlertDialog safe default/cancel flow, and dirty Sheet protection. At 200% call `setPageScaleFactor(2)`, assert `visualViewport.scale >= 1.99`, assert each tested control has `scrollWidth <= clientWidth` and an in-viewport bounding rectangle, and save both the screenshot and JSON scale/geometry evidence outside the baseline set.

- [ ] **Step 4: Verify the guarded CLI and capture approved tracked baselines once, then prove ordinary replay is read-only.**

Run the pure server test without Jest or a database:

```bash
env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts apps/server/src/e2e/fixture-rows.test.ts
node --test apps/web/e2e/fixtures/seed.test.mjs apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/manifest.test.mjs
```

Expected: PASS from a clean shell; server tests import neither config nor DB/storage runtime, capture every deterministic row/FK/password-hash input, and prove credential-free preflight/reset/teardown plus exactly-once close ordering. Web tests prove only seed needs credentials, reset/teardown still pass every guard, and bridge/manifest behavior uses only injected fakes. No test opens a pool, calls `resetDb()`, runs migration/Jest, contacts S3/CSI, or invokes repository-wide `pnpm test`.

Run the baseline update only after human visual approval:

```bash
pnpm --filter @moment/web e2e:design-system -- --update-baselines
node apps/web/e2e/lib/manifest.mjs --verify
node --test apps/web/e2e/lib/manifest.test.mjs
git status --short --untracked-files=all -- apps/web/e2e/baselines
```

Expected: the status lists exactly `manifest.json` plus the 24 PNG Files declared by this task; manifest verification proves the complete three-route × two-theme × four-viewport matrix, all seven required-content labels have at least one baseline, all paths are unique, and no unlisted PNG exists. Neither `artifacts/` nor a credential is tracked. Any unsupported artifact-update flag, baseline auto-update, or write outside the exact manifest set is rejected.

Then run the standard replay twice and prove the image ownership/invariants:

```bash
node apps/web/e2e/lib/manifest.mjs --hashes > apps/web/e2e/artifacts/baselines.before.sha256
pnpm --filter @moment/web e2e:design-system
pnpm --filter @moment/web e2e:design-system
node apps/web/e2e/lib/manifest.mjs --hashes > apps/web/e2e/artifacts/baselines.after.sha256
cmp apps/web/e2e/artifacts/baselines.before.sha256 apps/web/e2e/artifacts/baselines.after.sha256
git diff --exit-code -- apps/web/e2e/baselines
git check-ignore -q apps/web/e2e/artifacts/probe.actual.png
! git check-ignore -q apps/web/e2e/baselines/chain-home/light/1440.png
! rg -n '@e[0-9]+' apps/web/e2e --glob '*.{mjs,md}'
```

Expected: both ordinary runs pass; the before/after digest files are identical; the manifest and all 24 PNGs remain byte-identical; actual/diff/JSON evidence is ignored; no `@e` reference exists; and every required viewport/theme/content label, overlay/responsive boundary, idle wait, and 200% zoom assertion has machine evidence.

- [ ] **Step 5: Commit the replayable regression suite.**

```bash
git add apps/web/e2e/run.mjs apps/web/e2e/lib/bridge.mjs apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/env.mjs apps/web/e2e/lib/manifest.mjs apps/web/e2e/lib/manifest.test.mjs apps/web/e2e/fixtures/seed.mjs apps/web/e2e/fixtures/seed.test.mjs apps/web/e2e/cases/design-system-regression.md apps/web/e2e/suites/design-system-regression.mjs apps/web/e2e/baselines/manifest.json
git add apps/web/e2e/baselines/design-lab/light/390.png apps/web/e2e/baselines/design-lab/light/1024.png apps/web/e2e/baselines/design-lab/light/1440.png apps/web/e2e/baselines/design-lab/light/1895.png apps/web/e2e/baselines/design-lab/dark/390.png apps/web/e2e/baselines/design-lab/dark/1024.png apps/web/e2e/baselines/design-lab/dark/1440.png apps/web/e2e/baselines/design-lab/dark/1895.png
git add apps/web/e2e/baselines/feed-home/light/390.png apps/web/e2e/baselines/feed-home/light/1024.png apps/web/e2e/baselines/feed-home/light/1440.png apps/web/e2e/baselines/feed-home/light/1895.png apps/web/e2e/baselines/feed-home/dark/390.png apps/web/e2e/baselines/feed-home/dark/1024.png apps/web/e2e/baselines/feed-home/dark/1440.png apps/web/e2e/baselines/feed-home/dark/1895.png
git add apps/web/e2e/baselines/chain-home/light/390.png apps/web/e2e/baselines/chain-home/light/1024.png apps/web/e2e/baselines/chain-home/light/1440.png apps/web/e2e/baselines/chain-home/light/1895.png apps/web/e2e/baselines/chain-home/dark/390.png apps/web/e2e/baselines/chain-home/dark/1024.png apps/web/e2e/baselines/chain-home/dark/1440.png apps/web/e2e/baselines/chain-home/dark/1895.png apps/web/e2e/README.md
git add apps/server/src/config.ts apps/server/.env.example apps/server/src/e2e/fixture-asset.ts apps/server/src/e2e/fixture-cli-contract.ts apps/server/src/e2e/fixture-cli-contract.test.ts apps/server/src/e2e/fixture-rows.ts apps/server/src/e2e/fixture-rows.test.ts apps/server/src/e2e/fixture-seeder.ts apps/server/src/e2e/fixture-cli.ts
git commit -m "test(web): add guarded design system visual regression"
```

## Task 15: Run final static gates and whole-site acceptance

**Files:**

- Verify: every tracked file changed by Tasks 1–14

**Interfaces:**

- Consumes: complete, serial Task 1–14 implementation; Task 2's package-owned commands and ignore rules; and Task 14's standard CSI action/args/data bridge, guarded fixture CLI with deterministic pool closure/storage asset, exact baseline manifest and 24 PNGs.
- Produces: a verified Web design-system refactor with no API/DTO/RAB semantic drift, no prohibited visual escape hatches, no normal-run baseline mutation, ignored runtime evidence, a complete manifest-owned PNG set, and documented command output.
- Cleanup ownership: Task 13 is the sole owner of legacy UI deletion; Task 15 only verifies its post-cleanup invariant and never deletes or stages those paths again.

- [ ] **Step 1: Run focused Web automated gates first.**

Run: `env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts apps/server/src/e2e/fixture-rows.test.ts && node --test apps/web/e2e/fixtures/seed.test.mjs apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/manifest.test.mjs && pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`

Expected: every command exits 0; the clean-shell server tests prove pure guard/action parsing, credential scope, complete row/FK/hash values and exactly-once close without config/DB/S3; Web Node tests prove seed wrapper/CSI envelope/24-file manifest without child/network side effects; all component media/Field/Floating/Feedback tests are included by Web Vitest; and build proves Task 1’s `react-dom/client` repair remains valid. Do not run `resetDb()`, migrations, server Jest, `pnpm --filter @moment/server test`, or repository-wide `pnpm test`.

- [ ] **Step 2: Run the full replayable visual/interaction matrix.**

Run: `pnpm --filter @moment/web e2e:design-system`

Expected: exit 0 after visible-form login succeeds first as viewer and then as owner; the manifest's `design-lab`, `feed-home` and `chain-home` baselines pass at 390/1024/1440/1895 in light/dark. Feed/chain captures visibly contain both Chinese authors, pure-text moment, decoded one-image moment, 2025/2026 index, long Tag and long chain name, with feed additionally showing `大家的日子` and chain proving the single-chain page. The full route journey, reduced motion, Tab/Shift+Tab, Escape, outside interactions, Modal/Sheet/AlertDialog/Menu/Popover/Tooltip layering, 767px ActionSheet/768px anchored behavior, resize-close/focus restoration, and documented 200% zoom evidence also pass.

- [ ] **Step 3: Scan for forbidden implementation drift.**

Run: `result_ui=0; result_config=0; rg -n "(#[0-9A-Fa-f]{3,8}|z-(40|50)|shadow-sticker|control-sm|animate-pulse|fixed inset-0|\\bborder-t\\b|text-\[[^]]+\]|px-\[[^]]+\]|h-\[[^]]+\])" apps/web/src --glob '*.{ts,tsx}' || result_ui=$?; rg -n "(shadow-sticker|control-sm|today|knot-)" apps/web/tailwind.config.js || result_config=$?; test "$result_ui" -eq 1 && test "$result_config" -eq 1`

Expected: both `rg` commands exit 1 with no matches; CSS token literal declarations are intentionally outside the scan.

- [ ] **Step 4: Verify baseline and repository integrity without cleanup work.**

Run:

```bash
git diff --check
git diff --exit-code -- apps/web/e2e/baselines
node apps/web/e2e/lib/manifest.mjs --verify
git check-ignore -q apps/web/e2e/artifacts/final-probe.actual.png
! git check-ignore -q apps/web/e2e/baselines/chain-home/light/1440.png
pnpm build
git status --short
```

Expected: diff/build and manifest verification exit 0; normal acceptance did not change the manifest or any of its 24 PNGs; runtime artifacts are ignored and every manifest path is tracked; status lists only deliberate implementation files and approved CSI baseline images. Do not run `pnpm test`, because it reaches the server’s real test database. Do not delete, restore, stage, or otherwise clean up an old component path in this task.

- [ ] **Step 5: Record the acceptance result without creating a cleanup or baseline commit.**

Record the exact commands, exit codes, CSI run ID, baseline `git diff --exit-code` result, and 200% zoom evidence path in the execution handoff. Task 15 has no Files to modify and therefore makes no commit; any later documentation-only commit is owned by the coordinator, never used to stage legacy cleanup or generated artifacts.

## Self-review checklist

- [ ] All 15 required deliveries map one-to-one to Tasks 1–15, including the broken `react-dom/client` baseline, test facility/tokens, all five component families, dev-only lab, Shell/Timeline, every requested page group, CSI replay, and final static/whole-site verification.
- [ ] Tasks 2–14 declare their shared owner exactly once: Task 2 alone owns `apps/web/package.json`, `pnpm-lock.yaml` and `.gitignore`; Task 8 alone creates `pages/not-found.tsx`, consumes it from `App.tsx` and owns the toast integration test; Task 13 owns only the eight tracked legacy deletions and never removes the absent Floating ghost; Task 14 alone owns its listed server E2E CLI/asset, Web E2E paths, manifest and 24 exact PNGs; Task 15 verifies and owns no modified file.
- [ ] All exported interfaces named by a later task are produced in an earlier task, including Task 8 NotFound before Task 13 entry migration; `ModalSurface`, `FloatingLayer` and ActionSheet remain internal/non-exported while Task 6 consumes only public Popover; every state-changing page still delegates data/business semantics to its existing RAB Service.
- [ ] No task uses placeholders, open-ended paths, “same as another task”, or a generic test instruction; each has files, consumes/produces interfaces, an initial failure, minimum implementation, passing command, and a commit.
- [ ] Before handoff, run `placeholder_hits=$(rg -n 'T[B]D|T[O]DO|implement la[t]er|fill in deta[i]ls|适当处[理]|类似 Tas[k]|<[a-z][a-z0-9_-]*>' docs/superpowers/plans/2026-08-18-web-design-system-refactor.md | rg -v '<(void|string|number|boolean|unknown|never)>' || true); test -z "$placeholder_hits"` so ordinary and angle-bracket placeholders are both rejected while concrete TypeScript primitive generic arguments are allowed; run `pnpm exec prettier --check docs/superpowers/plans/2026-08-18-web-design-system-refactor.md`; inspect every Task Files/Interfaces/red-green/commit block for unique ownership and producer-before-consumer ordering; verify 15 tasks, at least 120 exact uniquely owned paths, pure CLI modules with no config/DB/storage runtime import, exact 24 PNG paths and seven required-content labels, strict 228-character/169-byte 64×48 PNG decoding, pool lifecycle/internal exports, `git diff --check`, and a diff containing only this plan file.
