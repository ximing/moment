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

| Owner task | Exact shared files it alone may modify                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Consumers after it lands |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 2          | `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/tokens.test.ts`, `apps/web/tailwind.config.js`, `.claude/rules/web-ui.md`, `.gitignore`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 3–15                     |
| 3          | `apps/web/src/ui/button/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 4–15                     |
| 4          | `apps/web/src/ui/modal/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 5–15                     |
| 5          | `apps/web/src/ui/floating/**`, `apps/web/src/ui/menu/**`, `apps/web/src/ui/popover/**`, `apps/web/src/ui/tooltip/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 6–15                     |
| 6          | `apps/web/src/ui/field/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 7–15                     |
| 7          | `apps/web/src/ui/feedback/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 8–15                     |
| 8          | `apps/web/src/pages/design-lab/**`, `apps/web/src/pages/not-found.tsx`, `apps/web/src/pages/not-found.test.tsx`, `apps/web/src/app-toast.test.tsx`, `apps/web/src/App.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 9–15                     |
| 9          | `apps/web/src/shell/Shell.tsx`, `apps/web/src/shell/user-menu.tsx`, `apps/web/src/shell/create-chain-dialog/index.tsx`, `apps/web/src/compose/composer-entry.tsx`, `apps/web/src/compose/compose-fab.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 10–15                    |
| 10         | `apps/web/src/pages/chain-home/index.tsx`, `apps/web/src/pages/chain-home/chain-audience.tsx`, `apps/web/src/timeline/timeline.tsx`, `apps/web/src/timeline/timeline-rail.tsx`, `apps/web/src/timeline/moment-sheet.tsx`, `apps/web/src/timeline/reaction-bar.tsx`, `apps/web/src/compose/compose-panel/index.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 11–15                    |
| 11         | `apps/web/src/pages/feed-home/index.tsx`, `apps/web/src/pages/moment/index.tsx`, `apps/web/src/pages/share-album/index.tsx`, `apps/web/src/media/MediaBlock.tsx`, `apps/web/src/timeline/lightbox.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 12–15                    |
| 12         | `apps/web/src/pages/chain-settings/index.tsx`, `apps/web/src/pages/chain-settings/sections.tsx`, `apps/web/src/chain/ChainLookPicker.tsx`, `apps/web/src/pages/me/index.tsx`, `apps/web/src/ui/ThemeToggle.tsx`, `apps/web/src/ui/Avatar.tsx`, `apps/web/src/pages/notifications/index.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 13–15                    |
| 13         | `apps/web/src/pages/auth-frame.tsx`, `apps/web/src/pages/login/index.tsx`, `apps/web/src/pages/register/index.tsx`, `apps/web/src/pages/invite/index.tsx`, `apps/web/src/ui/Button.tsx`, `apps/web/src/ui/Field.tsx`, `apps/web/src/ui/Menu.tsx`, `apps/web/src/ui/Confirm.tsx`, `apps/web/src/ui/Banner.tsx`, `apps/web/src/ui/Empty.tsx`, `apps/web/src/ui/HoverTip.tsx`, `apps/web/src/ui/HappenedAtField.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 14–15                    |
| 14         | `apps/server/src/config.ts`, `apps/server/.env.example`, `apps/server/src/e2e/fixture-seeder.ts`, `apps/server/src/e2e/fixture-cli.ts`, `apps/server/src/e2e/fixture-cli.test.ts`, `apps/web/e2e/run.mjs`, `apps/web/e2e/lib/bridge.mjs`, `apps/web/e2e/lib/bridge.test.mjs`, `apps/web/e2e/lib/env.mjs`, `apps/web/e2e/lib/manifest.mjs`, `apps/web/e2e/lib/manifest.test.mjs`, `apps/web/e2e/fixtures/seed.mjs`, `apps/web/e2e/cases/design-system-regression.md`, `apps/web/e2e/suites/design-system-regression.mjs`, `apps/web/e2e/baselines/manifest.json`, `apps/web/e2e/baselines/design-lab/light/390.png`, `apps/web/e2e/baselines/design-lab/light/1024.png`, `apps/web/e2e/baselines/design-lab/light/1440.png`, `apps/web/e2e/baselines/design-lab/light/1895.png`, `apps/web/e2e/baselines/design-lab/dark/390.png`, `apps/web/e2e/baselines/design-lab/dark/1024.png`, `apps/web/e2e/baselines/design-lab/dark/1440.png`, `apps/web/e2e/baselines/design-lab/dark/1895.png`, `apps/web/e2e/baselines/chain-home/light/390.png`, `apps/web/e2e/baselines/chain-home/light/1024.png`, `apps/web/e2e/baselines/chain-home/light/1440.png`, `apps/web/e2e/baselines/chain-home/light/1895.png`, `apps/web/e2e/baselines/chain-home/dark/390.png`, `apps/web/e2e/baselines/chain-home/dark/1024.png`, `apps/web/e2e/baselines/chain-home/dark/1440.png`, `apps/web/e2e/baselines/chain-home/dark/1895.png`, `apps/web/e2e/README.md` | 15                       |

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

Create `docs/superpowers/verification/2026-08-18-web-build-baseline.md` with this exact result table, replacing only `<pnpm-version>` with `pnpm --version` output and each `<exit>` with the observed integer exit code:

| Check               | Exact command                                                                                                                                                                                                     | Expected result                           | Observed result                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| pnpm version        | `pnpm --version`                                                                                                                                                                                                  | records `<pnpm-version>`                  | `<pnpm-version>`                       |
| no local symlink    | `test ! -e apps/web/node_modules/react-dom`                                                                                                                                                                       | exit 0                                    | exit `<exit>`                          |
| root package exists | `test -e node_modules/react-dom/package.json`                                                                                                                                                                     | exit 0                                    | exit `<exit>`                          |
| fail-first build    | `pnpm --filter @moment/web build`                                                                                                                                                                                 | exit 1; `react-dom/client` ENOENT         | exit `<exit>`; recorded terminal error |
| absolute Vite probe | `node -e "const {createRequire}=require('node:module'); const {resolve,dirname}=require('node:path'); console.log(dirname(createRequire(resolve('apps/web/vite.config.ts')).resolve('react-dom/package.json')))"` | prints installed `react-dom` package root | printed path                           |
| repaired build      | `pnpm --filter @moment/web build`                                                                                                                                                                                 | exit 0                                    | exit `<exit>`                          |
| repaired typecheck  | `pnpm --filter @moment/web typecheck`                                                                                                                                                                             | exit 0                                    | exit `<exit>`                          |
| lockfile invariant  | `git diff --exit-code -- pnpm-lock.yaml`                                                                                                                                                                          | exit 0; no output                         | exit `<exit>`                          |

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

Add the Web testing dependencies, including the Node PNG comparison dependencies `pixelmatch` and `pngjs`, and configure `test` as `vitest run` plus `e2e:design-system` as `node e2e/run.mjs design-system-regression`; the latter may fail until Task 14 creates the runner. Configure jsdom, setup and coverage-independent focused execution. Add the approved light/dark color, field, overlay, feedback, geometry and z-index tokens; retain only documented temporary aliases for old callers until Task 13 cleanup. Map every public semantic token in Tailwind. Add only `apps/web/e2e/artifacts/**` to `.gitignore`; Task 14's exact manifest and 16 approved PNG paths remain unignored. Update `.claude/rules/web-ui.md` so no later task adds package scripts, test setup, tokens, legacy aliases or E2E ignore rules.

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

In `ui/button/Button.test.tsx`, render the four public primitives; assert default native `type="button"`, loading has `aria-busy="true"` and suppresses `onClick`, ButtonLink is an anchor, IconButton has its accessible name, and a `// @ts-expect-error` fixture rejects danger-pill.

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
- Produces: `CloseReason`, controlled `Dialog`, `Sheet`, `AlertDialog`, `ModalSurface` and their exact public props from `ui/modal`; existing overlays remain untouched until Task 13 cleanup.

- [ ] **Step 1: Write failing overlay tests.**

In `modal.test.tsx`, assert Dialog returns focus to its trigger after close, `Escape` calls `onRequestClose('escape')`, outside click calls `onRequestClose('outside')`, `busy` suppresses close requests, AlertDialog Escape calls `onCancel`, and the mobile/desktop Sheet uses one component with the 768px media-query class.

- [ ] **Step 2: Run the tests before creating the behavior layer.**

Run: `pnpm --filter @moment/web test -- modal.test.tsx`

Expected: FAIL because the new `ui/modal` directory and exports do not exist.

- [ ] **Step 3: Implement controlled surfaces and migrate existing overlays without changing their services.**

Build `ModalSurface` with react-aria focus containment, inert background, scroll lock, portal z-layer, scrim and focus restoration. Export Dialog/Sheet with fixed Header/Body/Footer structure and AlertDialog with cancel-first focus, busy protection and close-reason semantics; Sheet changes from right-floating desktop to bottom near-full mobile at 768px. Keep existing Confirm, Lightbox and caller files untouched until Task 13 migrates and removes them.

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
- Create: `apps/web/src/ui/floating/index.ts`
- Create: `apps/web/src/ui/menu/Menu.tsx`
- Create: `apps/web/src/ui/menu/Menu.test.tsx`
- Create: `apps/web/src/ui/menu/index.ts`
- Create: `apps/web/src/ui/popover/Popover.tsx`
- Create: `apps/web/src/ui/popover/index.ts`
- Create: `apps/web/src/ui/tooltip/Tooltip.tsx`
- Create: `apps/web/src/ui/tooltip/index.ts`

**Interfaces:**

- Consumes: Task 2 semantic tokens, Task 3 button exports and Task 4 modal layering contract.
- Produces: `FloatingLayer`, `ResponsiveMenu`, `MenuItem`, `MenuLinkItem`, `MenuGroup`, `ContextMenu`, `Popover`, `ReactionPopover`, `MemberPopover` and `Tooltip`; menu callers do not read viewport width. Field creation waits for Task 6.

- [ ] **Step 1: Write failing floating-surface tests.**

In the new floating/menu tests, assert ArrowDown opens and focuses the first item, Escape restores trigger focus, desktop menu uses `role="menu"`, an under-768 viewport opens a modal ActionSheet with a separate “取消” action, and a ReactionPopover exposes grid arrow-key navigation.

- [ ] **Step 2: Run the focused test before creating the directories.**

Run: `pnpm --filter @moment/web test -- Menu.test.tsx`

Expected: FAIL because the new floating/menu/popover/tooltip directories and exports do not exist.

- [ ] **Step 3: Implement the floating and command-surface contracts.**

Implement the portal-based FloatingLayer for flip/shift, collision, outside dismissal, viewport exit and focus restoration. Build one declarative command collection for desktop Menu and mobile ActionSheet at 768px, plus Popover and short desktop Tooltip contracts. Keep all existing menu, hover-tip, reaction and date-time callers untouched until Task 13.

- [ ] **Step 4: Verify keyboard and viewport behavior.**

Run: `pnpm --filter @moment/web test -- Menu.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; the new directories contain no arbitrary z-index, full-screen outside button, custom window key listener, caller-supplied placement, width or shadow.

- [ ] **Step 5: Commit the floating command surfaces.**

```bash
git add apps/web/src/ui/floating/FloatingLayer.tsx apps/web/src/ui/floating/FloatingLayer.test.tsx apps/web/src/ui/floating/index.ts apps/web/src/ui/menu/Menu.tsx apps/web/src/ui/menu/Menu.test.tsx apps/web/src/ui/menu/index.ts apps/web/src/ui/popover/Popover.tsx apps/web/src/ui/popover/index.ts apps/web/src/ui/tooltip/Tooltip.tsx apps/web/src/ui/tooltip/index.ts
git commit -m "feat(web): create floating command primitives"
```

## Task 6: Create the Field family directory consuming Task 5

**Files:**

- Create: `apps/web/src/ui/field/Field.tsx`
- Create: `apps/web/src/ui/field/Field.test.tsx`
- Create: `apps/web/src/ui/field/index.ts`

**Interfaces:**

- Consumes: Tasks 2–5 token, button, modal and floating-surface contracts.
- Produces: `Field`, `Input`, `Textarea`, `Select`, `TextField`, `TextareaField`, `PasswordField`, `SelectField`, `DateTimeField`; each composed field accepts `{ label: string; name: string; isRequired?: boolean; isOptional?: boolean; description?: string; isInvalid?: boolean; errorMessage?: string }` plus native control props. Existing field callers remain untouched until Task 13.

- [ ] **Step 1: Write failing Field tests.**

In `Field.test.tsx`, assert TextField associates label/description/error IDs, error replaces description and sets `aria-invalid`, PasswordField toggles type without changing value or focus, and Textarea has `resize-none`, 16px text, 44px controls and the required 112px minimum height.

- [ ] **Step 2: Run the focused test before creating the directory.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx`

Expected: FAIL because the new `ui/field` directory and exports do not exist.

- [ ] **Step 3: Implement the fixed Field API.**

Use react-aria-components associations for stable IDs; expose no size/radius/tone variants; map default/hover/focus/error/disabled/readonly/autofill through Task 2 field tokens. Render “可选” only from `isOptional`; `isRequired` is native semantics without a star. Implement DateTimeField on top of Task 5 Popover behavior while preserving the existing date/time/timezone value contract. Do not edit or adapt any existing caller in this task.

- [ ] **Step 4: Verify Field semantics.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; the new field directory contains no `hint`, `error`, `rounded-*`, `border-line`, `h-10`, or `resize-y` compatibility API.

- [ ] **Step 5: Commit the Field family.**

```bash
git add apps/web/src/ui/field/Field.tsx apps/web/src/ui/field/Field.test.tsx apps/web/src/ui/field/index.ts
git commit -m "feat(web): create field primitives"
```

## Task 7: Create the Feedback family directory

**Files:**

- Create: `apps/web/src/ui/feedback/Feedback.tsx`
- Create: `apps/web/src/ui/feedback/Feedback.test.tsx`
- Create: `apps/web/src/ui/feedback/index.ts`

**Interfaces:**

- Consumes: Tasks 2–6 feedback/z tokens, Button and AlertDialog.
- Produces: `Banner({ tone: 'error' | 'warning' | 'info'; action?: { label: string; onPress(): void | Promise<void> }; children: string })`; `EmptyState({ variant: 'timeline' | 'plain'; scope: 'page' | 'section'; title: string; description: string; action?: { label: string; onPress(): void; emphasis: 'primary' | 'quiet' } })`; `ToastProvider`, `useToast().show({ key: string; message: string; action?: { label: string; onPress(): void | Promise<void> } })`; `TimelineSkeleton`, `FeedSkeleton`, `DetailSkeleton`, `SettingsSkeleton`, `InlineProgress({ variant: 'indeterminate' | 'determinate'; label: string; value?: number })`, and `usePending(loading: boolean)`.

- [ ] **Step 1: Write failing feedback tests.**

In `feedback.test.tsx`, assert Banner renders `role="alert"` for error and its action cannot double-submit; Toast shows one item, merges same keys, queues no more than two and pauses on focus; EmptyState rejects a second action by type; Skeleton is `aria-hidden`; determinate InlineProgress exposes `role="progressbar"` and `aria-valuenow`.

- [ ] **Step 2: Run tests before implementation.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx`

Expected: FAIL because the new `ui/feedback` directory and exports do not exist.

- [ ] **Step 3: Implement structured feedback primitives.**

Implement token-only structured Banner, EmptyState, ToastProvider, ToastRegion, skeleton templates, InlineProgress and `usePending` in the new directory. Keep one visible/two queued Toast timing and deduplication semantics. Export `ToastProvider` and `ToastRegion` as separate primitives; do not mount either into the app here, add compatibility adapters, or edit callers. Task 8 is the sole `App.tsx` owner and mounts exactly one provider/region; Task 13 performs migration and removes old paths.

- [ ] **Step 4: Verify feedback contracts.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; only Toast has a shadow; the new feedback directory uses no fixed position for content feedback, private `animate-pulse`, or legacy adapter.

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

In `chain-home.test.tsx`, use a fixed ChainHomeService fixture and assert chain source is absent in single-chain moment metadata, tags and body are one text-flow element, response link says `N 条回应`, own moment kebab opens ResponsiveMenu, the reaction trigger opens ReactionPopover, and dirty compose close opens `AlertDialog` with “继续记录”/“放弃记录”.

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
- Create: `apps/web/src/pages/timeline-variants.test.tsx`

**Interfaces:**

- Consumes: Tasks 4, 7, 9, 10 timeline/MomentSheet/Lightbox interfaces.
- Produces: `/` adds the “大家的日子 / 来自 N 条时光链” header and chain-color source link only for feed items; `/moments/:momentId` retains comment CRUD with ReplyComposer; `/share/:token` remains no-Shell/read-only and retains `st` media access.

- [ ] **Step 1: Write failing variant tests.**

In `timeline-variants.test.tsx`, assert a feed moment exposes `● {chainName}` link, the same MomentSheet with no `chainLookById` does not, moment detail renders a reply Field plus existing delete-own-comment action, and share has neither compose nor reaction triggers while opening MediaBlock through Lightbox.

- [ ] **Step 2: Run before page migration.**

Run: `pnpm --filter @moment/web test -- timeline-variants.test.tsx`

Expected: FAIL because feed header/source presentation, detail reply composition, and share’s old card/header styling have not been migrated.

- [ ] **Step 3: Recompose three variants on the sample contracts.**

Implement the feed header with one `记下此刻` primary action, use the existing `chainLookById` branch to render linkable color dot + chain name, and preserve feed filters/load semantics. Replace detail comment input/rows with Field and quiet/AlertDialog actions while retaining service mutations. Give share the same timeline/media visual grammar, retain its token/API access and expiry/unavailable semantics, and leave it read-only/no Shell.

- [ ] **Step 4: Verify the three route variants.**

Run: `pnpm --filter @moment/web test -- timeline-variants.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; only Task 11 Files change, source link appears only on feed, and no share change adds authentication, interaction, DTO, media URL, or share-token behavior.

- [ ] **Step 5: Commit feed/detail/share migration.**

```bash
git add apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/share-album/index.tsx apps/web/src/media/MediaBlock.tsx apps/web/src/timeline/lightbox.tsx apps/web/src/pages/timeline-variants.test.tsx
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
- Produces: semantic settings sections; `ToastProvider` only for invisible success such as saved preferences; owner/editor/viewer visibility unchanged; profile retains theme `system | light | dark`; notifications retain read/pagination behavior.

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

- Consumes: Tasks 3, 5, 7 and 8 public UI APIs, including Task 8's already-created and already-consumed NotFound route module; existing Login/Register/Invite services unchanged.
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
- Create: `apps/server/src/e2e/fixture-seeder.ts`
- Create: `apps/server/src/e2e/fixture-cli.ts`
- Create: `apps/server/src/e2e/fixture-cli.test.ts`
- Create: `apps/web/e2e/run.mjs`
- Create: `apps/web/e2e/lib/bridge.mjs`
- Create: `apps/web/e2e/lib/bridge.test.mjs`
- Create: `apps/web/e2e/lib/env.mjs`
- Create: `apps/web/e2e/lib/manifest.mjs`
- Create: `apps/web/e2e/lib/manifest.test.mjs`
- Create: `apps/web/e2e/fixtures/seed.mjs`
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

- Consumes: Task 2's package-owned `e2e:design-system` script, `pixelmatch`/`pngjs` dependencies and artifact-ignore rules; Task 8 `/__design-lab`; Task 9–13 route/UI contracts; the existing Drizzle schema; and a CSI daemon. Task 14 must not modify `apps/web/package.json`, `pnpm-lock.yaml`, `.gitignore`, app source, route/controller registration, or any legacy component path.
- Produces: config-owned `MOMENT_E2E`, `MOMENT_E2E_OWNER_EMAIL`, `MOMENT_E2E_OWNER_PASSWORD`, `MOMENT_E2E_VIEWER_EMAIL`, and `MOMENT_E2E_VIEWER_PASSWORD`; `assertE2eFixtureGuard(env: Pick<Config, 'MOMENT_E2E' | 'NODE_ENV' | 'MYSQL_DATABASE'>): void`, which permits fixture work only when `MOMENT_E2E === '1'`, `NODE_ENV === 'test'`, and `MYSQL_DATABASE === 'moment_e2e'`; `readE2eFixtureCredentials(env: Pick<Config, 'MOMENT_E2E_OWNER_EMAIL' | 'MOMENT_E2E_OWNER_PASSWORD' | 'MOMENT_E2E_VIEWER_EMAIL' | 'MOMENT_E2E_VIEWER_PASSWORD'>): E2eFixtureCredentials`; `runFixtureAction(action: 'preflight' | 'reset' | 'seed' | 'teardown'): Promise<E2eCliResult>`; and `fixture-cli.ts <preflight|reset|seed|teardown>`, whose successful stdout is one JSON object and whose stderr never includes credentials or MySQL connection fields. `preflight` returns exactly `{ mode: 'e2e', database: 'moment_e2e' }`; `seed` returns `DesignSystemFixture = { owner: { email }, viewer: { email }, chainId, momentId, shareToken, inviteToken, fixedNow, apiBaseUrl, webBaseUrl }` with no password; `reset` and `teardown` return `{ ok: true }`. Web produces `node e2e/run.mjs design-system-regression [--update-baselines]`; `seed({ action: 'reset' | 'seed' | 'teardown' }): Promise<DesignSystemFixture | { ok: true }>`; `assertE2eEnvironment(): WebE2eEnvironment`, whose owner/viewer passwords come directly from the runner's local environment and are never accepted from CLI stdout; `bridge.request(action: string, args: object): Promise<unknown>`, which sends `{ action, args, session: 'e2e-web-design-system-refactor' }`, requires `success === true`, and returns only `data`; `bridge.comparePng({ baselinePath, actualPath, threshold: 0.1, maxDiffPixels: 120 }): Promise<{ diffPixels: number; diffPath: string }>`; `loadBaselineManifest(): Promise<BaselineCase[]>` plus `node apps/web/e2e/lib/manifest.mjs --verify|--hashes`; one exact manifest and the 16 PNG files listed in this Task's Files; and ignored run evidence at `apps/web/e2e/artifacts/**`. Only `--update-baselines` may write one of those 16 PNG files; a normal run writes actual/diff/log evidence only under `artifacts/`.

- [ ] **Step 1: Write the failing guarded-CLI contract and natural-language case before automation.**

Create `apps/server/src/e2e/fixture-cli.test.ts` as Node's built-in test-runner unit test. Before any implementation, it must import the future guard/credential/CLI parsing exports and assert that each absent or invalid member of the triple guard fails before a seeder method can run: `MOMENT_E2E !== '1'`, `NODE_ENV !== 'test'`, and a missing or non-exact `MYSQL_DATABASE` (including another `_e2e` database name). Assert each missing/empty/invalid E2E email or password is rejected before `seed`, while `preflight`, `reset`, and `teardown` do not require credentials. Assert `preflight` serializes exactly `{ mode: 'e2e', database: 'moment_e2e' }`, `seed` stdout omits both password keys and password values, unsupported actions are rejected, and error text contains neither supplied credentials nor MySQL connection fields. Stub the seeder dependency; this test must neither import `db` nor open a pool, call `resetDb()`, run migrations, or use Jest.

Create `apps/web/e2e/lib/bridge.test.mjs` with an injected `fetch` stub; it must never contact `127.0.0.1:10088` or navigate Chrome. Assert the status preflight uses `GET /status`; command requests use `POST /command` and the exact top-level `{ action, args, session }` shape; `{ success: true, data: value }` returns `value`; `{ success: false, error }` rejects; `open` maps to `navigate`, `press` maps to `send_keys`, and both viewport operations map to `cdp` with their exact CDP method/params. Create `apps/web/e2e/lib/manifest.test.mjs` to require the exact two route slugs, two themes, four width/height pairs and 16 unique relative PNG paths listed in this task; after capture it must also reject a missing, duplicate, path-traversing or unlisted PNG.

Create the case as a human-readable acceptance journey, not an automation implementation: it contains user actions and visible outcomes only, with no CSS selector, `data-*` selector, XPath, CSI `@e` reference, or locator syntax. It must name these exact fixture inputs and invariants:

```text
owner.email    = MOMENT_E2E_OWNER_EMAIL (example for apps/server/.env.e2e: owner.e2e@moment.invalid)
owner.password = MOMENT_E2E_OWNER_PASSWORD
viewer.email   = MOMENT_E2E_VIEWER_EMAIL (example for apps/server/.env.e2e: viewer.e2e@moment.invalid)
viewer.password = MOMENT_E2E_VIEWER_PASSWORD
chainId        = 00000000-0000-4000-8000-000000000014
momentId       = 00000000-0000-4000-8000-000000000015
shareToken     = e2e-design-system-share-token
inviteToken    = e2e-design-system-invite-token
fixedNow       = 2026-08-18T09:30:00.000Z
apiBaseUrl     = http://127.0.0.1:3000/api
webBaseUrl     = http://127.0.0.1:5173
```

Passwords come only from ignored local `apps/server/.env.e2e` or CI's non-production secret store: do not put a password, access token, or MySQL connection field in any tracked fixture, case, suite, screenshot name, terminal output, or README. The case says to first reset then seed; to visit `/__design-lab`, `/`, `/chains/{chainId}`, `/chains/{chainId}?compose=1`, `/chains/{chainId}/settings`, `/moments/{momentId}`, `/me`, `/notifications`, `/share/{shareToken}`, `/invites/{inviteToken}`, `/login`, `/register`, and authenticated wildcard; and to verify the visible role/read-only/invite-from, reaction/comment/edit/delete, tag/order/date-anchor, loading/error/empty, and no-business-semantics-drift states. Cover light and dark at 390×844, 1024×900, 1440×900 and 1895×900; keyboard and overlay behavior; reduced motion; and a separate 1440×900 light-theme 200% zoom journey with visible labels and no horizontal clipping.

- [ ] **Step 2: Prove the new contracts fail before implementation.**

Run:

```bash
node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli.test.ts
node --test apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/manifest.test.mjs
pnpm --filter @moment/web e2e:design-system
```

Expected: the first command fails because the CLI guard/credential exports do not exist; the second fails because the bridge/manifest implementations and manifest file do not exist; the package command fails with Node's missing-module error for `apps/web/e2e/run.mjs`. The package command itself resolves because Task 2, the sole `package.json` owner, already installed the script. Do not edit `package.json` to make any command fail or pass.

- [ ] **Step 3: Implement the guarded local seeder, bridge, runner and suite.**

In `apps/server/src/config.ts`, add `MOMENT_E2E` as the literal `'0' | '1'` config value defaulting to `'0'` and add the four E2E credential variables as empty-string-to-`undefined` optional config values; email values use email validation and password values use the same minimum length as registration. In `apps/server/.env.example`, add `MOMENT_E2E=0`, the two `.invalid` example emails and blank `MOMENT_E2E_OWNER_PASSWORD=` / `MOMENT_E2E_VIEWER_PASSWORD=` lines with a comment that real values exist only in ignored `apps/server/.env.e2e` or CI's non-production secret store. Do not add that ignored file to Git and do not add another MySQL connection variable: it overrides the existing `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE=moment_e2e` fields. `fixture-cli.ts` reads environment only through `config`, accepts exactly one action argument, validates the triple guard before dynamically importing `fixture-seeder.ts`, and exits nonzero for a guard/action/seeder error without echoing environment values. The guard requires the entire database name to equal `moment_e2e`; an `_e2e` marker in another MySQL field or a different suffixed database is rejected. `preflight` is guard-only and reports the fixed JSON contract, so it cannot connect to MySQL. Only `seed` calls `readE2eFixtureCredentials(config)`; the other actions do not require credentials.

`fixture-seeder.ts` is the only DB-writing producer. It accepts credentials already parsed from `config` and never reads `process.env`. `reset` deletes the existing schema tables in foreign-key reverse order (`pushTokens`, `notifications`, `reactions`, `comments`, `momentTags`, `tags`, `outbox`, `media`, `moments`, `chainInvites`, `chainMembers`, `shareLinks`, `chains`, `refreshTokens`, `users`) and then inserts nothing. `seed` first performs that reset and then transactionally inserts the two configured E2E users, owner/viewer chain members, chain, fixed timestamped text moment, tag association, share link, and pending invite using the exact stable IDs/tokens from Step 1; it uses passwords only as bcrypt inputs and returns only the two emails plus stable public fixture identifiers. `teardown` invokes the same reset. Do not create an HTTP endpoint, controller, Express route, middleware exception, reset secret, or gateway; the CLI's three guards are the only authority boundary.

`fixtures/seed.mjs` is the only Web seed/reset producer. Before every action it requires `MOMENT_E2E=1`, both base URLs to be HTTP loopback URLs with exactly ports 3000 and 5173, and all four fixture credential variables. Resolve `repoRoot` from `new URL('../../../../', import.meta.url)` and the absolute CLI file from `new URL('../../../server/src/e2e/fixture-cli.ts', import.meta.url)`; invoke `child_process.execFile` with `process.execPath`, `['--loader', 'ts-node/esm', fixtureCliPath, action]`, `{ cwd: repoRoot, env: inheritedGuardedEnv }`. This exact absolute-path plus repo-root-cwd contract must work when `pnpm --filter @moment/web` starts the runner with `process.cwd()` equal to `<repo>/apps/web`. Parse only the CLI's JSON stdout and reject a nonzero child status. Run `preflight` before every write action and reject unless its JSON is exactly `{ mode: 'e2e', database: 'moment_e2e' }`. A failed child is fatal and identifies only its action/exit status; it never puts credentials, MySQL connection fields or stderr text into artifacts. `reset` clears the dedicated E2E database, `seed` returns the password-free `DesignSystemFixture`, and `teardown` invokes reset again. The Web runner obtains passwords separately from `assertE2eEnvironment()` and never expects them from the child result.

`lib/env.mjs` exports `assertE2eEnvironment()`, `waitForReadiness()`, and `waitForVisualIdle()`. Its README commands are exact and must run in three terminals after sourcing ignored `apps/server/.env.e2e` whose server database is `moment_e2e`:

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

`WAIT_FOR_NETWORK_IDLE_SCRIPT` is a fixed source string exported beside the bridge and used by the fetch-stub contract test; it observes the suite's tracked fetch/XHR counter and returns only after zero pending requests has remained stable for 500 ms. The bridge records actual image, pixel diff and JSON assertion evidence in the ignored artifacts directory. The suite is the only file with stable locators: semantic role/name, label, or unique `id`/`data-testid` locators only; no classes, positional selectors, CSS layout selectors, XPath, or `@e` references.

Create `apps/web/e2e/baselines/manifest.json` as the sole baseline producer list with these exact entries; `manifest.mjs` rejects any other route slug, theme, viewport, relative file, duplicate, missing file after capture, or extra PNG under the baseline root:

| Route slug   | Route               | Theme | Viewport | PNG path                    |
| ------------ | ------------------- | ----- | -------- | --------------------------- |
| `design-lab` | `/__design-lab`     | light | 390×844  | `design-lab/light/390.png`  |
| `design-lab` | `/__design-lab`     | light | 1024×900 | `design-lab/light/1024.png` |
| `design-lab` | `/__design-lab`     | light | 1440×900 | `design-lab/light/1440.png` |
| `design-lab` | `/__design-lab`     | light | 1895×900 | `design-lab/light/1895.png` |
| `design-lab` | `/__design-lab`     | dark  | 390×844  | `design-lab/dark/390.png`   |
| `design-lab` | `/__design-lab`     | dark  | 1024×900 | `design-lab/dark/1024.png`  |
| `design-lab` | `/__design-lab`     | dark  | 1440×900 | `design-lab/dark/1440.png`  |
| `design-lab` | `/__design-lab`     | dark  | 1895×900 | `design-lab/dark/1895.png`  |
| `chain-home` | `/chains/{chainId}` | light | 390×844  | `chain-home/light/390.png`  |
| `chain-home` | `/chains/{chainId}` | light | 1024×900 | `chain-home/light/1024.png` |
| `chain-home` | `/chains/{chainId}` | light | 1440×900 | `chain-home/light/1440.png` |
| `chain-home` | `/chains/{chainId}` | light | 1895×900 | `chain-home/light/1895.png` |
| `chain-home` | `/chains/{chainId}` | dark  | 390×844  | `chain-home/dark/390.png`   |
| `chain-home` | `/chains/{chainId}` | dark  | 1024×900 | `chain-home/dark/1024.png`  |
| `chain-home` | `/chains/{chainId}` | dark  | 1440×900 | `chain-home/dark/1440.png`  |
| `chain-home` | `/chains/{chainId}` | dark  | 1895×900 | `chain-home/dark/1895.png`  |

For each state, wait for `document.fonts.ready`, decoded rendered images/video poster promises, two `requestAnimationFrame` frames after layout, and no tracked fetch/XHR for 500 ms before the screenshot or comparison. The runner iterates the manifest's 16 entries and no computed or caller-supplied baseline path; compare with threshold `0.1` and `maxDiffPixels: 120`, fail on either exceeded value, and retain `artifacts/{runId}/{routeSlug}-{theme}-{width}.actual.png`, `.diff.png`, and `.json`. At 390 px assert focus order, Tab/Shift+Tab, Escape, outside click and focus restoration for each overlay; at 767 px assert ResponsiveMenu is an ActionSheet; at 768 px assert it is anchored; resize an open menu/sheet across the boundary and assert it closes and returns focus. Assert Popover collision, AlertDialog safe default/cancel flow, and dirty Sheet protection. At 200% call `setPageScaleFactor(2)`, assert `visualViewport.scale >= 1.99`, assert each tested control has `scrollWidth <= clientWidth` and an in-viewport bounding rectangle, and save both the screenshot and JSON scale/geometry evidence outside the baseline set.

- [ ] **Step 4: Verify the guarded CLI and capture approved tracked baselines once, then prove ordinary replay is read-only.**

Run the pure server test without Jest or a database:

```bash
node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli.test.ts
node --test apps/web/e2e/lib/bridge.test.mjs
```

Expected: PASS; the server test does not import `db`, open a pool, call `resetDb()`, run migrations, invoke `pnpm --filter @moment/server test`, or invoke repository-wide `pnpm test`; the bridge test uses only its fetch stub and proves the action/args/data contract without contacting CSI or navigating Chrome.

Run the baseline update only after human visual approval:

```bash
pnpm --filter @moment/web e2e:design-system -- --update-baselines
node apps/web/e2e/lib/manifest.mjs --verify
node --test apps/web/e2e/lib/manifest.test.mjs
git status --short --untracked-files=all -- apps/web/e2e/baselines
```

Expected: the status lists exactly `manifest.json` plus the 16 PNG Files declared by this task; manifest verification proves the complete two-route × two-theme × four-viewport matrix, all paths are unique and no unlisted PNG exists. Neither `artifacts/` nor a credential is tracked. Any unsupported artifact-update flag, baseline auto-update, or write outside the exact manifest set is rejected.

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

Expected: both ordinary runs pass; the before/after digest files are identical; the manifest and all 16 PNGs remain byte-identical; actual/diff/JSON evidence is ignored; no `@e` reference exists; and every required viewport/theme, overlay/responsive boundary, idle wait, and 200% zoom assertion has machine evidence.

- [ ] **Step 5: Commit the replayable regression suite.**

```bash
git add apps/web/e2e/run.mjs apps/web/e2e/lib/bridge.mjs apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/env.mjs apps/web/e2e/lib/manifest.mjs apps/web/e2e/lib/manifest.test.mjs apps/web/e2e/fixtures/seed.mjs apps/web/e2e/cases/design-system-regression.md apps/web/e2e/suites/design-system-regression.mjs apps/web/e2e/baselines/manifest.json
git add apps/web/e2e/baselines/design-lab/light/390.png apps/web/e2e/baselines/design-lab/light/1024.png apps/web/e2e/baselines/design-lab/light/1440.png apps/web/e2e/baselines/design-lab/light/1895.png apps/web/e2e/baselines/design-lab/dark/390.png apps/web/e2e/baselines/design-lab/dark/1024.png apps/web/e2e/baselines/design-lab/dark/1440.png apps/web/e2e/baselines/design-lab/dark/1895.png
git add apps/web/e2e/baselines/chain-home/light/390.png apps/web/e2e/baselines/chain-home/light/1024.png apps/web/e2e/baselines/chain-home/light/1440.png apps/web/e2e/baselines/chain-home/light/1895.png apps/web/e2e/baselines/chain-home/dark/390.png apps/web/e2e/baselines/chain-home/dark/1024.png apps/web/e2e/baselines/chain-home/dark/1440.png apps/web/e2e/baselines/chain-home/dark/1895.png apps/web/e2e/README.md
git add apps/server/src/config.ts apps/server/.env.example apps/server/src/e2e/fixture-seeder.ts apps/server/src/e2e/fixture-cli.ts apps/server/src/e2e/fixture-cli.test.ts
git commit -m "test(web): add guarded design system visual regression"
```

## Task 15: Run final static gates and whole-site acceptance

**Files:**

- Verify: every tracked file changed by Tasks 1–14

**Interfaces:**

- Consumes: complete, serial Task 1–14 implementation; Task 2's package-owned commands and ignore rules; and Task 14's standard CSI action/args/data bridge, guarded fixture CLI, exact baseline manifest and 16 PNGs.
- Produces: a verified Web design-system refactor with no API/DTO/RAB semantic drift, no prohibited visual escape hatches, no normal-run baseline mutation, ignored runtime evidence, a complete manifest-owned PNG set, and documented command output.
- Cleanup ownership: Task 13 is the sole owner of legacy UI deletion; Task 15 only verifies its post-cleanup invariant and never deletes or stages those paths again.

- [ ] **Step 1: Run focused Web automated gates first.**

Run: `node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli.test.ts && node --test apps/web/e2e/lib/bridge.test.mjs apps/web/e2e/lib/manifest.test.mjs && pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`

Expected: every command exits 0; the server-side CLI check remains a pure no-database Node test (no `resetDb()`, migration, `pnpm --filter @moment/server test`, or repository-wide `pnpm test`); the bridge test proves CSI uses action/args/data without contacting the daemon; the manifest test proves exactly 16 complete PNGs; and the Web build proves Task 1’s `react-dom/client` link fix remains valid.

- [ ] **Step 2: Run the full replayable visual/interaction matrix.**

Run: `pnpm --filter @moment/web e2e:design-system`

Expected: exit 0 for the manifest's `design-lab` and `chain-home` baselines at 390/1024/1440/1895 in light/dark, plus the full route journey, reduced motion, Tab/Shift+Tab, Escape, outside interactions, Modal/Sheet/AlertDialog/Menu/Popover/Tooltip layering, 767px ActionSheet/768px anchored behavior, resize-close/focus restoration, and documented 200% zoom evidence.

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

Expected: diff/build and manifest verification exit 0; normal acceptance did not change the manifest or any of its 16 PNGs; runtime artifacts are ignored and every manifest path is tracked; status lists only deliberate implementation files and approved CSI baseline images. Do not run `pnpm test`, because it reaches the server’s real test database. Do not delete, restore, stage, or otherwise clean up an old component path in this task.

- [ ] **Step 5: Record the acceptance result without creating a cleanup or baseline commit.**

Record the exact commands, exit codes, CSI run ID, baseline `git diff --exit-code` result, and 200% zoom evidence path in the execution handoff. Task 15 has no Files to modify and therefore makes no commit; any later documentation-only commit is owned by the coordinator, never used to stage legacy cleanup or generated artifacts.

## Self-review checklist

- [ ] All 15 required deliveries map one-to-one to Tasks 1–15, including the broken `react-dom/client` baseline, test facility/tokens, all five component families, dev-only lab, Shell/Timeline, every requested page group, CSI replay, and final static/whole-site verification.
- [ ] Tasks 2–14 declare their shared owner exactly once: Task 2 alone owns `apps/web/package.json`, `pnpm-lock.yaml` and `.gitignore`; Task 8 alone creates `pages/not-found.tsx`, consumes it from `App.tsx` and owns the toast integration test; Task 13 owns only the eight tracked legacy deletions and never removes the absent Floating ghost; Task 14 alone owns its listed server E2E CLI, Web E2E paths, manifest and 16 exact PNGs; Task 15 verifies and owns no modified file.
- [ ] All exported interfaces named by a later task are produced in an earlier task, including Task 8 NotFound before Task 13 entry migration; every state-changing page still delegates data/business semantics to its existing RAB Service.
- [ ] No task uses placeholders, open-ended paths, “same as another task”, or a generic test instruction; each has files, consumes/produces interfaces, an initial failure, minimum implementation, passing command, and a commit.
- [ ] Before handoff, run `pnpm exec prettier --check docs/superpowers/plans/2026-08-18-web-design-system-refactor.md`, scan the plan for prohibited placeholders and retired CSI/DB/baseline forms, inspect all Task Files for unique ownership and producer-before-consumer ordering, run the structure and exact 16-PNG manifest checks, and run `git diff --check`.
