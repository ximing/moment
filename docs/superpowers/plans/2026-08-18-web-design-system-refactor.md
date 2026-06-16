# Web Design System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web C 端从 sticker/card 视觉迁移为已批准的日子线设计系统，同时保持所有业务、API、DTO、路由、权限、媒体、分享、日期锚定和 RAB 语义不变。

**Architecture:** 严格串行地先修复可重复构建与测试基础，再以 `tokens.css → Tailwind 语义映射 → ui 基元 → Shell/Timeline → 页面组合` 推进。Task 2–8 是共享热点的唯一 owner；Task 9–13 只使用这些公开接口，绝不回写 tokens、通用 UI 或 RAB Service 的业务语义。Task 14 将受控 seed 的 CSI 流程固化为可重放视觉回归，Task 15 只做全量质量门与验收。

**Tech Stack:** pnpm workspace、Vite 7、React 19、TypeScript、Tailwind CSS、react-aria-components、@rabjs/react、Vitest + React Testing Library、CSI。

**Spec:** `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`; `docs/superpowers/specs/2026-08-18-web-button-design.md`; `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`; `docs/superpowers/specs/2026-08-18-web-field-input-design.md`; `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`; `docs/superpowers/specs/2026-08-18-web-feedback-design.md`.

## Global Constraints

- 执行顺序固定为 Task 1 → 15；同一时刻只允许当前 Task 修改其列出的共享热点。
- 不修改 `packages/dto/**`、`apps/server/**`、`apps/web/src/api/client.ts`、任一 RAB Service 的状态含义或请求路径；跨域刷新仍只经既有 `'global'` 事件。
- 保留 `App.tsx` 现有路由集合与 `/chains/:chainId/compose` 重定向；页面从 `useParams` 调 `service.hydrate(id)`、跳转留在组件。
- 组件颜色、尺寸、圆角、阴影、z-index 一律从 `apps/web/src/styles/tokens.css` 与 Tailwind 语义映射消费；业务页不得写十六进制、一次性 `px-[…]`、`h-[…]`、页面私有阴影或 `z-40/z-50`。
- 页面网格只用 4/8/12/16/20/24/32px；动态业务内容用系统字体，固定“时刻/今天/昨天/记下此刻”才可使用 Smiley Sans；所有交互均有可见 `focus-visible`。
- Web 测试不得运行 `pnpm test` 或 `resetDb()`；CSI 只用专用测试帐号和受控 seed，绝不依赖个人登录态或生产数据库。

---

## File ownership map

| Owner task | Exact shared files it alone may modify                                                                                                                                                                                            | Consumers after it lands |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 2          | `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/styles/tokens.css`, `apps/web/tailwind.config.js`, `.claude/rules/web-ui.md`                                  | 3–15                     |
| 3          | `apps/web/src/ui/Button.tsx`                                                                                                                                                                                                      | 4–15                     |
| 4          | `apps/web/src/ui/modal.tsx`, `apps/web/src/ui/Confirm.tsx`, `apps/web/src/timeline/lightbox.tsx`, `apps/web/src/shell/create-chain-dialog/index.tsx`                                                                              | 5–15                     |
| 5          | `apps/web/src/ui/Field.tsx`, `apps/web/src/ui/HappenedAtField.tsx`                                                                                                                                                                | 6–15                     |
| 6          | `apps/web/src/ui/Menu.tsx`, `apps/web/src/ui/floating-layer.tsx`, `apps/web/src/ui/popover.tsx`, `apps/web/src/ui/tooltip.tsx`, `apps/web/src/ui/HoverTip.tsx`, `apps/web/src/shell/user-menu.tsx`                                | 7–15                     |
| 7          | `apps/web/src/ui/Banner.tsx`, `apps/web/src/ui/Empty.tsx`, `apps/web/src/ui/feedback.tsx`, `apps/web/src/ui/use-pending.ts`                                                                                                       | 8–15                     |
| 8          | `apps/web/src/pages/design-lab/index.tsx`, `apps/web/src/App.tsx`                                                                                                                                                                 | 9–15                     |
| 9          | `apps/web/src/shell/Shell.tsx`, `apps/web/src/timeline/timeline.tsx`, `apps/web/src/timeline/timeline-rail.tsx`, `apps/web/src/compose/composer-entry.tsx`, `apps/web/src/compose/compose-fab.tsx`                                | 10–15                    |
| 10         | `apps/web/src/pages/chain-home/index.tsx`, `apps/web/src/pages/chain-home/chain-audience.tsx`, `apps/web/src/timeline/moment-sheet.tsx`, `apps/web/src/timeline/reaction-bar.tsx`, `apps/web/src/compose/compose-panel/index.tsx` | 11–15                    |

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
node -e "console.log(require('node:path').dirname(require('node:module').createRequire('./apps/web/vite.config.ts').resolve('react-dom/package.json')))"
pnpm --filter @moment/web build
pnpm --filter @moment/web typecheck
git diff --exit-code -- pnpm-lock.yaml
```

Expected: the path resolves to the installed `react-dom` package root; build and typecheck exit 0 without a Web-local `react-dom` symlink; `pnpm-lock.yaml` is byte-for-byte unchanged.

- [ ] **Step 4: Record the reproducible baseline and commit the task.**

Create `docs/superpowers/verification/2026-08-18-web-build-baseline.md` with this exact result table, replacing only `<pnpm-version>` with `pnpm --version` output:

Record the no-symlink fail-first and pass results, including the root package existence check, build, typecheck, path resolution, and unchanged lockfile in `docs/superpowers/verification/2026-08-18-web-build-baseline.md`.

Then commit only the two Task 1 tracked files:

```bash
git add apps/web/vite.config.ts docs/superpowers/verification/2026-08-18-web-build-baseline.md
git commit -m "feat(web): make react-dom alias hoist-safe"
```

## Task 2: Add Web test infrastructure and promote tokens to the single visual source

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/styles/tokens.test.ts`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/tailwind.config.js`
- Modify: `.claude/rules/web-ui.md`

**Interfaces:**

- Consumes: Task 1 buildable Vite importer; existing `:root[data-theme='dark']` theme contract.
- Produces: `pnpm --filter @moment/web test` runs Vitest in jsdom; Tailwind names `bg-bg`, `bg-surface`, `text-ink`, `text-muted`, `bg-action`, `text-action-fg`, `text-danger`, `bg-field`, `bg-floating`, `bg-feedback-info`, `z-floating`, `z-overlay`, `z-toast`; CSS custom properties in the six approved specs.

- [ ] **Step 1: Write the failing token contract test.**

Create `apps/web/src/styles/tokens.test.ts` that reads `tokens.css` and asserts both `:root` and `:root[data-theme='dark']` define `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--stroke`, `--action`, `--date`, `--tag`, `--focus`, `--danger`, `--field-bg`, `--scrim`, `--floating-bg`, `--feedback-error-bg`, `--z-floating`, `--z-overlay`, `--z-toast`, plus a reduced-motion rule.

- [ ] **Step 2: Run the test before adding Vitest and record the expected failure.**

Run: `pnpm --filter @moment/web test -- tokens.test.ts`

Expected: FAIL because the package has no `test` script and no Vitest configuration.

- [ ] **Step 3: Add the minimum runnable test facility and complete the semantic token layer.**

Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event` and `@testing-library/jest-dom` as Web development dependencies. Configure `test.environment = 'jsdom'`, load `src/test/setup.ts`, and expose `test` as `vitest run`. In `tokens.css`, add the approved light/dark color and component tokens while retaining only explicit, documented temporary aliases for existing pre-migration callers; keep `--dot-pink`, `--dot-blue`, `--dot-mint`, `--dot-purple` exclusively for chain identity. In Tailwind map every produced semantic color/z-index/width/height token and mark legacy `shadow-sticker`, `control-sm`, `today` and `knot-*` mappings for removal by Task 15. Update `.claude/rules/web-ui.md` to make new code consume semantic tokens and forbid introducing further legacy aliases.

- [ ] **Step 4: Run the focused test and baseline static gates.**

Run: `pnpm --filter @moment/web test -- tokens.test.ts && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: all exit 0; every new component contract uses semantic tokens, while any listed legacy alias is confined to its transition mapping.

- [ ] **Step 5: Commit the infrastructure and token contract.**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/styles/tokens.test.ts apps/web/src/styles/tokens.css apps/web/tailwind.config.js .claude/rules/web-ui.md
git commit -m "feat(web): establish design system tokens and tests"
```

## Task 3: Replace the Button family

**Files:**

- Modify: `apps/web/src/ui/Button.tsx`
- Create: `apps/web/src/ui/Button.test.tsx`
- Modify: `apps/web/src/compose/compose-fab.tsx`
- Modify: `apps/web/src/compose/composer-entry.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Modify: `apps/web/src/pages/notifications/index.tsx`
- Modify: `apps/web/src/pages/login/index.tsx`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/invite/index.tsx`
- Modify: `apps/web/src/pages/register/index.tsx`
- Modify: `apps/web/src/pages/moment/index.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/me/index.tsx`

**Interfaces:**

- Consumes: Task 2 control, focus and action tokens.
- Produces: `Button(props: ButtonProps)`, `ButtonLink(props: ButtonLinkProps)`, `IconButton(props: IconButtonProps)` where `ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'`, `ButtonShape = 'standard' | 'pill'`, and `type ButtonProps = CommonButtonProps & ({ variant?: Exclude<ButtonVariant, 'danger'>; shape?: ButtonShape } | { variant: 'danger'; shape?: 'standard' })`; `danger + pill` is rejected by this discriminated union.

- [ ] **Step 1: Write failing Button behavior tests.**

In `Button.test.tsx`, render `<Button>保存更改</Button>`, `<Button loading>发布</Button>`, `<ButtonLink to="/invites/x">接受邀请</ButtonLink>`, and `<IconButton icon={MoreHorizontal} label="更多操作" />`; assert default native `type="button"`, loading has `aria-busy="true"` and does not invoke `onClick`, ButtonLink is an anchor, and IconButton has its accessible name. Add a `// @ts-expect-error` compilation fixture for `<Button variant="danger" shape="pill">删除</Button>`.

- [ ] **Step 2: Run the focused test before implementation.**

Run: `pnpm --filter @moment/web test -- Button.test.tsx`

Expected: FAIL because existing `Button` has `ghost/sm`, no loading/link/icon APIs, and allows the invalid shape.

- [ ] **Step 3: Implement the minimum Button family and migrate its two global compose entry points.**

Implement the discriminated prop union, `primary/secondary/quiet/danger` state classes, standard 40px/pill 44px geometry, spinner slot, focus ring and reduced-motion behavior exclusively from tokens. `className` may affect outer placement only. In every file listed in this Task, replace `ghost` with the specifically intended `secondary` or `quiet` action, replace `sm` with quiet/menu/icon composition, and replace arbitrary action styling with Button, ButtonLink or IconButton; do not keep any legacy Button adapter. Make `ComposeFab` use the only independent `primary + pill` action and `ComposerEntry` use the same action label.

- [ ] **Step 4: Verify Button contracts and compilation.**

Run: `pnpm --filter @moment/web test -- Button.test.tsx && pnpm --filter @moment/web typecheck`

Expected: all tests pass; TypeScript rejects the danger-pill fixture and no source imports or passes `size`, `ghost`, or `sm` to Button.

- [ ] **Step 5: Commit the Button family.**

```bash
git add apps/web/src/ui/Button.tsx apps/web/src/ui/Button.test.tsx apps/web/src/compose/compose-fab.tsx apps/web/src/compose/composer-entry.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/pages/chain-settings/sections.tsx apps/web/src/pages/notifications/index.tsx apps/web/src/pages/login/index.tsx apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/invite/index.tsx apps/web/src/pages/register/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/me/index.tsx
git commit -m "feat(web): replace button family"
```

## Task 4: Establish Modal, Dialog, Sheet, AlertDialog and Lightbox behavior

**Files:**

- Create: `apps/web/src/ui/modal.tsx`
- Create: `apps/web/src/ui/modal.test.tsx`
- Delete: `apps/web/src/ui/Confirm.tsx`
- Modify: `apps/web/src/timeline/lightbox.tsx`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`

**Interfaces:**

- Consumes: Task 2 overlay tokens and Task 3 `Button`/`IconButton`.
- Produces: `type CloseReason = 'close-button' | 'escape' | 'outside'`; controlled `Dialog`, `Sheet`, and `AlertDialog` props `{ open: boolean; title: string; busy?: boolean; onRequestClose?: (reason: CloseReason) => void }`; AlertDialog additionally has `{ body: string; confirmLabel: string; cancelLabel: string; danger?: boolean; onConfirm(): void | Promise<void>; onCancel(): void }`; `Lightbox` retains its current media-navigation props.

- [ ] **Step 1: Write failing overlay tests.**

In `modal.test.tsx`, assert Dialog returns focus to its trigger after close, `Escape` calls `onRequestClose('escape')`, outside click calls `onRequestClose('outside')`, `busy` suppresses close requests, AlertDialog Escape calls `onCancel`, and the mobile/desktop Sheet uses one component with the 768px media-query class.

- [ ] **Step 2: Run the tests before creating the behavior layer.**

Run: `pnpm --filter @moment/web test -- modal.test.tsx`

Expected: FAIL because no `ui/modal.tsx` export exists and Confirm/Lightbox use independent fixed overlays.

- [ ] **Step 3: Implement controlled surfaces and migrate existing overlays without changing their services.**

Build an internal `ModalSurface` with react-aria Modal/Dialog focus containment, inert background, scroll lock, portal z-layer, scrim and focus restoration. Dialog/Sheet provide the fixed Header/Body/Footer structure; Sheet changes from right-floating desktop to bottom near-full mobile at 768px. AlertDialog never closes outside and initially focuses cancel. Convert every existing Confirm caller listed in this Task directly to AlertDialog, preserve callback/input-confirmation contracts and concrete outcome labels, then delete `Confirm.tsx`. Move Lightbox to `--z-lightbox`, retain arrow navigation, and migrate create-chain to Dialog while preserving its service truth source.

- [ ] **Step 4: Verify focus, close reasons and existing callers.**

Run: `pnpm --filter @moment/web test -- modal.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: all exit 0; no modified file contains `fixed inset-0`, `z-40`, `z-50`, or a window Escape listener.

- [ ] **Step 5: Commit modal behavior.**

```bash
git add apps/web/src/ui/modal.tsx apps/web/src/ui/modal.test.tsx apps/web/src/timeline/lightbox.tsx apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/pages/chain-settings/sections.tsx
git rm apps/web/src/ui/Confirm.tsx
git commit -m "feat(web): unify modal dialog and sheet behavior"
```

## Task 5: Implement Field and DateTimeField

**Files:**

- Modify: `apps/web/src/ui/Field.tsx`
- Modify: `apps/web/src/ui/HappenedAtField.tsx`
- Create: `apps/web/src/ui/Field.test.tsx`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Modify: `apps/web/src/pages/login/index.tsx`
- Modify: `apps/web/src/pages/register/index.tsx`
- Modify: `apps/web/src/pages/moment/index.tsx`

**Interfaces:**

- Consumes: Tasks 2–4 token, button and floating-surface contracts.
- Produces: `Field`, `Input`, `Textarea`, `Select`, `TextField`, `TextareaField`, `PasswordField`, `SelectField`, `DateTimeField`; each composed field accepts `{ label: string; name: string; isRequired?: boolean; isOptional?: boolean; description?: string; isInvalid?: boolean; errorMessage?: string }` plus native control props; `HappenedAtField` retains existing `{ value, onChange, hint }` business contract.

- [ ] **Step 1: Write failing Field tests.**

In `Field.test.tsx`, assert a TextField associates label/description/error IDs, error replaces description and sets `aria-invalid`, PasswordField toggles type without changing value or focus, and Textarea has `resize-none`, 16px text, 44px controls and the required 112px minimum height.

- [ ] **Step 2: Run the focused test before migration.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx`

Expected: FAIL because the current label wrapper has no ID associations, invalid API, password field, or no-resize textarea.

- [ ] **Step 3: Implement the fixed Field API and adapt create-chain/date-time.**

Use react-aria-components associations for stable IDs; expose no size/radius/tone variants; map default/hover/focus/error/disabled/readonly/autofill through field tokens. Render “可选” only from `isOptional`; `isRequired` is native semantics without a star. Convert every existing Field caller listed in this Task to composed field APIs, including compose and reply scene components; new code may not use `hint` or `error` props. Restyle HappenedAtField as DateTimeField with its existing date/time/timezone values, preserving the existing popover selection logic and business validation.

- [ ] **Step 4: Verify Field semantics and caller types.**

Run: `pnpm --filter @moment/web test -- Field.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; no caller of the modified files passes `hint`, `error`, `rounded-*`, `border-line`, `h-10`, or `resize-y` to a base control.

- [ ] **Step 5: Commit the Field family.**

```bash
git add apps/web/src/ui/Field.tsx apps/web/src/ui/HappenedAtField.tsx apps/web/src/ui/Field.test.tsx apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/pages/chain-settings/sections.tsx apps/web/src/pages/login/index.tsx apps/web/src/pages/register/index.tsx apps/web/src/pages/moment/index.tsx
git commit -m "feat(web): establish semantic field components"
```

## Task 6: Consolidate Menu, Popover, Tooltip and mobile ActionSheet

**Files:**

- Create: `apps/web/src/ui/floating-layer.tsx`
- Modify: `apps/web/src/ui/Menu.tsx`
- Create: `apps/web/src/ui/popover.tsx`
- Create: `apps/web/src/ui/tooltip.tsx`
- Create: `apps/web/src/ui/Menu.test.tsx`
- Modify: `apps/web/src/ui/HoverTip.tsx`
- Modify: `apps/web/src/shell/user-menu.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/timeline/reaction-bar.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`

**Interfaces:**

- Consumes: Tasks 2–5 z-layer, Button/IconButton, Modal and Field contracts.
- Produces: `ResponsiveMenu`, `MenuItem`, `MenuLinkItem`, `MenuGroup`, `ContextMenu`, `KebabButton`, `ReactionPopover`, `MemberPopover`, `Tooltip`; `ResponsiveMenu` accepts `{ 'aria-label': string; trigger: ReactNode; sheetTitle?: string; sheetContext?: string; onAction(key: string): void }`; `MenuItem` accepts `{ id: string; textValue: string; icon?: LucideIcon; tone?: 'danger'; children: ReactNode }`.

- [ ] **Step 1: Write failing responsive-menu tests.**

In `Menu.test.tsx`, assert ArrowDown opens and focuses the first item, Escape restores trigger focus, desktop menu uses `role="menu"`, an under-768 viewport opens a modal ActionSheet with a separate “取消” action, and a ReactionPopover exposes grid arrow-key navigation.

- [ ] **Step 2: Run tests before replacement.**

Run: `pnpm --filter @moment/web test -- Menu.test.tsx`

Expected: FAIL because Menu children require a `close()` callback and currently render an absolute menu plus a transparent full-screen button.

- [ ] **Step 3: Implement the one command collection and floating layer.**

Use a portal-based internal FloatingLayer for flip/shift, outside dismissal, viewport exit and focus restoration. At 768px ResponsiveMenu switches internally between anchored React Aria Menu and modal ActionSheet; do not let callers read viewport width. Implement ContextMenu only as a desktop shortcut with the same collection, MemberPopover in place of HoverTip, ReactionPopover instead of menu-based reactions, DateTime popover integration for Task 5, and Tooltip only for short desktop icon explanation. Convert every existing Menu caller listed in this Task from `children(close)` to a declarative command collection; do not retain a legacy adapter. Replace HoverTip’s implementation with MemberPopover and migrate UserMenu labels to “我的资料”, “通知”, “退出登录”.

- [ ] **Step 4: Verify keyboard/viewport behavior.**

Run: `pnpm --filter @moment/web test -- Menu.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; no modified source retains a full-screen outside button, custom window key listener, arbitrary z-index, or caller-supplied placement/width/shadow.

- [ ] **Step 5: Commit floating command surfaces.**

```bash
git add apps/web/src/ui/floating-layer.tsx apps/web/src/ui/Menu.tsx apps/web/src/ui/popover.tsx apps/web/src/ui/tooltip.tsx apps/web/src/ui/Menu.test.tsx apps/web/src/ui/HoverTip.tsx apps/web/src/shell/user-menu.tsx apps/web/src/shell/Shell.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/reaction-bar.tsx apps/web/src/pages/chain-home/index.tsx
git commit -m "feat(web): unify menus popovers and tooltips"
```

## Task 7: Build the Feedback family

**Files:**

- Modify: `apps/web/src/ui/Banner.tsx`
- Modify: `apps/web/src/ui/Empty.tsx`
- Create: `apps/web/src/ui/feedback.tsx`
- Create: `apps/web/src/ui/use-pending.ts`
- Create: `apps/web/src/ui/feedback.test.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/index.tsx`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Modify: `apps/web/src/pages/login/index.tsx`
- Modify: `apps/web/src/pages/register/index.tsx`
- Modify: `apps/web/src/pages/invite/index.tsx`
- Modify: `apps/web/src/pages/moment/index.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/me/index.tsx`

**Interfaces:**

- Consumes: Tasks 2–6 feedback/z tokens, Button and AlertDialog.
- Produces: `Banner({ tone: 'error' | 'warning' | 'info'; action?: { label: string; onPress(): void | Promise<void> }; children: string })`; `EmptyState({ variant: 'timeline' | 'plain'; scope: 'page' | 'section'; title: string; description: string; action?: { label: string; onPress(): void; emphasis: 'primary' | 'quiet' } })`; `ToastProvider`, `useToast().show({ key: string; message: string; action?: { label: string; onPress(): void | Promise<void> } })`; `TimelineSkeleton`, `FeedSkeleton`, `DetailSkeleton`, `SettingsSkeleton`, `InlineProgress({ variant: 'indeterminate' | 'determinate'; label: string; value?: number })`, and `usePending(loading: boolean)`.

- [ ] **Step 1: Write failing feedback tests.**

In `feedback.test.tsx`, assert Banner renders `role="alert"` for error and its action cannot double-submit; Toast shows one item, merges same keys, queues no more than two and pauses on focus; EmptyState rejects a second action by type; Skeleton is `aria-hidden`; determinate InlineProgress exposes `role="progressbar"` and `aria-valuenow`.

- [ ] **Step 2: Run tests before implementation.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx`

Expected: FAIL because Toast/Progress/Skeleton exports do not exist and current Banner/Empty accept the old arbitrary API.

- [ ] **Step 3: Implement structured feedback and mount one global toast region.**

Replace card-style Banner and arbitrary Empty with token-only structured components. Convert every existing Banner/Empty caller listed in this Task to structured messages/actions; do not retain legacy component adapters. Implement ToastProvider queue/timers (3.5s ordinary, 6s undo, one visible/two queued, clear at logout), pending hook (180ms delay, 280ms min visible), four fixed skeleton templates and InlineProgress. Mount ToastProvider/ToastRegion once in Shell; do not add toast on mutations whose visible list result already proves success. Confirm remains an AlertDialog, not a feedback component.

- [ ] **Step 4: Verify feedback contracts.**

Run: `pnpm --filter @moment/web test -- feedback.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; only Toast has a shadow; Banner/EmptyState/Skeleton/InlineProgress use no fixed position or private `animate-pulse`, and no legacy feedback adapter remains.

- [ ] **Step 5: Commit feedback primitives.**

```bash
git add apps/web/src/ui/Banner.tsx apps/web/src/ui/Empty.tsx apps/web/src/ui/feedback.tsx apps/web/src/ui/use-pending.ts apps/web/src/ui/feedback.test.tsx apps/web/src/shell/Shell.tsx apps/web/src/timeline/timeline.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/pages/chain-settings/index.tsx apps/web/src/pages/chain-settings/sections.tsx apps/web/src/pages/login/index.tsx apps/web/src/pages/register/index.tsx apps/web/src/pages/invite/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/me/index.tsx
git commit -m "feat(web): add structured feedback components"
```

## Task 8: Add the development-only Design Lab

**Files:**

- Create: `apps/web/src/pages/design-lab/index.tsx`
- Create: `apps/web/src/pages/design-lab/design-lab.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: public Task 3–7 UI exports and existing `ThemeService` data-theme behavior.
- Produces: development-only `/__design-lab` route with deterministic fixture props, light/dark switch, and 390/1024/1440/1895 container presets; production route tree contains no Design Lab route.

- [ ] **Step 1: Write failing route-boundary tests.**

In `design-lab.test.tsx`, stub `import.meta.env.DEV` true/false and assert the Design Lab renders Button/Field/Modal/Menu/Feedback trigger sections only when DEV is true, with all four labelled viewport presets.

- [ ] **Step 2: Run before adding the route.**

Run: `pnpm --filter @moment/web test -- design-lab.test.tsx`

Expected: FAIL because no Design Lab module or `/__design-lab` route exists.

- [ ] **Step 3: Implement the isolated visual harness.**

Create a static fixture page with real interactive triggers for Button states, fields (error/password/date), Dialog/Sheet/AlertDialog, Menu/Popover/Tooltip and all Feedback variants. Register `<Route path="/__design-lab" ...>` only inside `if (import.meta.env.DEV)`; use local component state and fixed strings only—no client, service, seed, or production navigation changes.

- [ ] **Step 4: Verify dev visibility and production omission.**

Run: `pnpm --filter @moment/web test -- design-lab.test.tsx && pnpm --filter @moment/web build`

Expected: PASS; production build succeeds and its route source does not contain a runtime-accessible `__design-lab` branch.

- [ ] **Step 5: Commit the lab.**

```bash
git add apps/web/src/pages/design-lab/index.tsx apps/web/src/pages/design-lab/design-lab.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): add development design lab"
```

## Task 9: Refactor Shell and Timeline structural primitives

**Files:**

- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Modify: `apps/web/src/timeline/timeline-rail.tsx`
- Modify: `apps/web/src/compose/composer-entry.tsx`
- Modify: `apps/web/src/compose/compose-fab.tsx`
- Create: `apps/web/src/timeline/timeline.test.tsx`

**Interfaces:**

- Consumes: Tasks 2–8 components; existing Timeline props and `MonthIndexEntry[]` data source.
- Produces: the unchanged Timeline/TimelineRail public data props; wide `208px / 760px / 32px / 184px` adjacent workspace at >=1400px; 900–1399 top bar and centered 760px main column; <900px top bar with TimelineRail rendered through Sheet; year-section month index consuming existing entries.

- [ ] **Step 1: Write failing timeline structural tests.**

In `timeline.test.tsx`, assert Timeline uses an `aria-label="日子线"` dashed stroke hook, `created_at` suppresses date knots, TimelineRail groups `MonthIndexEntry[]` by year with only one expanded historic year, and the mobile month trigger opens the Sheet rather than a fixed right drawer.

- [ ] **Step 2: Run tests before structural migration.**

Run: `pnpm --filter @moment/web test -- timeline.test.tsx`

Expected: FAIL because TimelineRail presents a flat list/fixed drawer and Timeline uses old knot/sticker semantics.

- [ ] **Step 3: Implement the three layouts and time-reading structure.**

Change Shell grid only through token-backed layout classes: wide sidebar 208, main 760, 32 gap and neighboring 184 rail; top-bar navigation at 900–1399 and <900; no mobile bottom navigation. Retain chain navigation, avatar, context menu and ComposePanel mount. Make Timeline’s line dashed `--stroke`, today/yesterday/older knots semantic without content shadow, and swap first load/next page states to Task 7 skeleton/progress. Group existing month entries by year, expose current-month trigger on smaller screens, retain tag/order/filter and date-anchor semantics, and move only the presentation into Sheet.

- [ ] **Step 4: Verify structural contract.**

Run: `pnpm --filter @moment/web test -- timeline.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; `Shell.tsx`, `timeline.tsx`, and `timeline-rail.tsx` contain no `fixed right-0`, `shadow-sticker`, `border-t`, or private drawer overlay.

- [ ] **Step 5: Commit Shell/Timeline foundations.**

```bash
git add apps/web/src/shell/Shell.tsx apps/web/src/timeline/timeline.tsx apps/web/src/timeline/timeline-rail.tsx apps/web/src/compose/composer-entry.tsx apps/web/src/compose/compose-fab.tsx apps/web/src/timeline/timeline.test.tsx
git commit -m "feat(web): rebuild shell and timeline structure"
```

## Task 10: Deliver the single-chain sample page

**Files:**

- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/chain-home/chain-audience.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/timeline/reaction-bar.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Create: `apps/web/src/pages/chain-home/chain-home.test.tsx`

**Interfaces:**

- Consumes: Tasks 3–9 public UI/Timestamp APIs and existing `ChainHomeService`/`ComposePanelService` methods unchanged.
- Produces: `/chains/:chainId` renders member cluster/visibility/kebab header, time-line MomentSheet, Sheet composer, `ReactionPopover`, and direct tags text flow; it preserves existing service calls, role conditions, tag filter/order query and date anchor.

- [ ] **Step 1: Write failing sample-page tests.**

In `chain-home.test.tsx`, use a fixed ChainHomeService fixture and assert chain source is absent in single-chain moment metadata, tags and body are one text-flow element, response link says `N 条回应`, own moment kebab opens ResponsiveMenu, the reaction trigger opens ReactionPopover, and dirty compose close opens `AlertDialog` with “继续记录”/“放弃记录”.

- [ ] **Step 2: Run tests before composing the page.**

Run: `pnpm --filter @moment/web test -- chain-home.test.tsx`

Expected: FAIL because current MomentSheet separates tags, says “评论”, uses the old reaction bar and ComposePanel directly drops drafts on Escape.

- [ ] **Step 3: Compose the sample without changing business ownership.**

Keep `hydrate(chainId)`, chain membership/visibility data, edit/delete callbacks, upload flow and filters intact. Render chain audience header with the member avatars, visibility and permission-gated right kebab; format pure text on `--surface` without shadow, media as its own base, tags before body in the same 16px text flow, left 30–32px emotion trigger and right response link. Convert ComposePanel to Sheet, reuse Field/Button/DateTimeField and show AlertDialog only when its current service state is dirty; preserve media replacement confirmation, progress/failure and submission refresh behavior.

- [ ] **Step 4: Verify the sample route.**

Run: `pnpm --filter @moment/web test -- chain-home.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; the changed page has no API client calls, direct fetch, service-to-service loads, or chain-source metadata in the single-chain variant.

- [ ] **Step 5: Commit the sample page.**

```bash
git add apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/chain-home/chain-audience.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/reaction-bar.tsx apps/web/src/compose/compose-panel/index.tsx apps/web/src/pages/chain-home/chain-home.test.tsx
git commit -m "feat(web): redesign single chain timeline"
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

Expected: PASS; source link appears only on feed, and no share change adds authentication, interaction, DTO, media URL, or share-token behavior.

- [ ] **Step 5: Commit feed/detail/share migration.**

```bash
git add apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/share-album/index.tsx apps/web/src/media/MediaBlock.tsx apps/web/src/timeline/lightbox.tsx apps/web/src/pages/timeline-variants.test.tsx
git commit -m "feat(web): align feed detail and share views"
```

## Task 12: Migrate settings, profile and notifications

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

Replace per-section card stacks, small entity buttons, private input styles and arbitrary confirmations with Field/Button/ResponsiveMenu/Banner/AlertDialog. Keep every existing service call, server error mapping and role guard exactly as is. Use a plain EmptyState where a settings sublist has no contents; make Me a quiet content stack retaining avatar upload/clear, three theme states and logout; make notification rows quiet with existing mark-read/load-more actions and structured loading/empty/error feedback.

- [ ] **Step 4: Verify role and feedback contracts.**

Run: `pnpm --filter @moment/web test -- settings-account.test.tsx && pnpm --filter @moment/web typecheck`

Expected: PASS; role branch output is unchanged except visual/components, and destructive outcomes do not add a duplicate Toast.

- [ ] **Step 5: Commit account/settings migration.**

```bash
git add apps/web/src/pages/chain-settings/index.tsx apps/web/src/pages/chain-settings/sections.tsx apps/web/src/chain/ChainLookPicker.tsx apps/web/src/pages/me/index.tsx apps/web/src/ui/ThemeToggle.tsx apps/web/src/ui/Avatar.tsx apps/web/src/pages/notifications/index.tsx apps/web/src/pages/settings-account.test.tsx
git commit -m "feat(web): redesign settings account and notifications"
```

## Task 13: Migrate authentication, invitation and not-found entry states

**Files:**

- Modify: `apps/web/src/pages/auth-frame.tsx`
- Modify: `apps/web/src/pages/login/index.tsx`
- Modify: `apps/web/src/pages/register/index.tsx`
- Modify: `apps/web/src/pages/invite/index.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/entry-states.test.tsx`

**Interfaces:**

- Consumes: Tasks 3, 5 and 7 public UI APIs; existing Login/Register/Invite services unchanged.
- Produces: auth forms use TextField/PasswordField/Banner/Button; invite keeps `from` preservation and accepted-chain navigation; unauthenticated wildcard redirects to `/login`, authenticated wildcard remains the approved “没有这个页面” plain EmptyState; `/chains/:chainId/compose` redirect is unchanged.

- [ ] **Step 1: Write failing entry-flow tests.**

In `entry-states.test.tsx`, assert login/register inputs have `autocomplete="email"`, `current-password`/`new-password`, concrete field errors, and submit Button loading; invite redirect preserves its existing `from` query; authenticated wildcard shows “没有这个页面”; ComposeRedirect produces `/chains/x?compose=1`.

- [ ] **Step 2: Run before migration.**

Run: `pnpm --filter @moment/web test -- entry-states.test.tsx`

Expected: FAIL because legacy Field/Button composition and not-found paragraph do not meet the new semantics.

- [ ] **Step 3: Recompose all entry surfaces without altering flows.**

Use AuthFrame only for layout and shared tokens, TextField/PasswordField for native semantics, Banner for service errors and one explicit submit Button per form. Preserve the existing schemas, service calls, `from` redirect and invite accept behavior. Replace the raw NotFound paragraph with plain EmptyState (no fake error/Toast) while preserving both redirect branches and the compose redirect string verbatim.

- [ ] **Step 4: Verify entry behavior and route preservation.**

Run: `pnpm --filter @moment/web test -- entry-states.test.tsx && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`

Expected: PASS; route paths, params and redirect targets exactly match the pre-task App contract.

- [ ] **Step 5: Commit entry-state migration.**

```bash
git add apps/web/src/pages/auth-frame.tsx apps/web/src/pages/login/index.tsx apps/web/src/pages/register/index.tsx apps/web/src/pages/invite/index.tsx apps/web/src/App.tsx apps/web/src/pages/entry-states.test.tsx
git commit -m "feat(web): redesign authentication and entry states"
```

## Task 14: Add replayable CSI E2E and visual regression coverage

**Files:**

- Create: `apps/web/e2e/run.mjs`
- Create: `apps/web/e2e/lib/bridge.mjs`
- Create: `apps/web/e2e/lib/env.mjs`
- Create: `apps/web/e2e/cases/design-system-regression.md`
- Create: `apps/web/e2e/suites/design-system-regression.mjs`
- Create: `apps/web/e2e/fixtures/design-system-seed.json`
- Create: `apps/web/e2e/artifacts/.gitkeep`
- Modify: `apps/web/package.json`
- Create: `apps/web/README.md`

**Interfaces:**

- Consumes: Task 8 `/__design-lab`; Task 9–13 route/UI contracts; CSI daemon and a dedicated seed loader supplied by the local test environment.
- Produces: `pnpm --filter @moment/web e2e:design-system` runs `node e2e/run.mjs design-system-regression`; fixture keys `ownerEmail`, `viewerEmail`, `chainId`, `momentId`, `shareToken`, `inviteToken`, `fixedNow`, `baseUrl`; evidence screenshots follow `{route}-{theme}-{width}.png` in `apps/web/e2e/artifacts/`.

- [ ] **Step 1: Write the executable scenario specification before automation.**

In `e2e/cases/design-system-regression.md`, declare `baseUrl`, the exact dedicated test-account credentials and seed reset command from `fixtures/design-system-seed.json`, then enumerate each exact route/state and machine-checkable assertion: `/__design-lab`, `/`, `/chains/{chainId}`, `/chains/{chainId}?compose=1`, `/chains/{chainId}/settings`, `/moments/{momentId}`, `/me`, `/notifications`, `/share/{shareToken}`, `/invites/{inviteToken}`, `/login`, `/register`, and authenticated `*`; document 390×844, 1024×900, 1440×900 and 1895×900 under light and dark themes, keyboard/overlay checks, and reduced-motion verification.

- [ ] **Step 2: Run the scenario command before its runner exists.**

Run: `pnpm --filter @moment/web e2e:design-system`

Expected: FAIL because package.json has no `e2e:design-system` script and no CSI suite.

- [ ] **Step 3: Implement the CSI replay suite and deterministic fixture protocol.**

Copy the CSI e2e scaffold into `apps/web/e2e/`; `run.mjs` discovers suites, `lib/bridge.mjs` sends one named `e2e-web-design-system-refactor` session to the daemon, and `lib/env.mjs` ensures the daemon, opens the page, polls observable readiness and writes evidence screenshots. Solidify `suites/design-system-regression.mjs` from the verified case using only stable aria/data/id selectors—never `@e` refs. It resets/loads `design-system-seed.json`, authenticates only with fixture accounts, waits for font/media/API idle, selects theme, sets each viewport, and saves/asserts named screenshots. For all overlay triggers, replay Tab/Shift+Tab, Escape, outside click, focus restoration, 768px Menu→ActionSheet behavior, Popover collision, AlertDialog safety and dirty Sheet protection. For every route, assert no changed business behavior: role visibility, share read-only mode, invite/from flow, reaction/comment/edit/delete permissions, tag/order/date-anchor filters, and no API/DTO mutation. Add the exact package script and concise README prerequisites (CSI daemon, local server, seed command).

- [ ] **Step 4: Capture and replay the approved matrix.**

Run: `pnpm --filter @moment/web e2e:design-system -- --update-artifacts`

Expected: creates only the documented evidence image names after human approval.

Run: `pnpm --filter @moment/web e2e:design-system && pnpm --filter @moment/web e2e:design-system && node apps/web/e2e/run.mjs`

Expected: all three replay commands pass; the suite has no `@e` references and all 390/1024/1440/1895 × light/dark screenshots plus keyboard/overlay assertions match their machine-checkable case expectations.

- [ ] **Step 5: Commit the replayable regression suite.**

```bash
git add apps/web/e2e/run.mjs apps/web/e2e/lib/bridge.mjs apps/web/e2e/lib/env.mjs apps/web/e2e/cases/design-system-regression.md apps/web/e2e/suites/design-system-regression.mjs apps/web/e2e/fixtures/design-system-seed.json apps/web/e2e/artifacts/.gitkeep apps/web/package.json apps/web/README.md
git commit -m "test(web): add design system visual regression"
```

## Task 15: Run final static gates and whole-site acceptance

**Files:**

- Modify: `docs/superpowers/plans/2026-08-18-web-design-system-refactor.md` (check off only completed execution steps; no plan-content edits)
- Verify: every tracked file changed by Tasks 1–14

**Interfaces:**

- Consumes: complete, serial Task 1–14 implementation and CSI command.
- Produces: a verified Web design-system refactor with no API/DTO/RAB semantic drift, no prohibited visual escape hatches, and documented final command output.

- [ ] **Step 1: Run focused Web automated gates first.**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`

Expected: every command exits 0; the build proves Task 1’s `react-dom/client` link fix remains valid.

- [ ] **Step 2: Run the full replayable visual/interaction matrix.**

Run: `pnpm --filter @moment/web e2e:design-system`

Expected: exit 0 for 390/1024/1440/1895, light/dark, reduced motion, Tab/Shift+Tab, Escape, outside interactions, Modal/Sheet/AlertDialog/Menu/Popover/Tooltip layering, and the documented route states.

- [ ] **Step 3: Scan for forbidden implementation drift.**

Run: `result_ui=0; result_config=0; rg -n "(#[0-9A-Fa-f]{3,8}|z-(40|50)|shadow-sticker|control-sm|animate-pulse|fixed inset-0|\\bborder-t\\b|text-\[[^]]+\]|px-\[[^]]+\]|h-\[[^]]+\])" apps/web/src --glob '*.{ts,tsx}' || result_ui=$?; rg -n "(shadow-sticker|control-sm|today|knot-)" apps/web/tailwind.config.js || result_config=$?; test "$result_ui" -eq 1 && test "$result_config" -eq 1`

Expected: both `rg` commands exit 1 with no matches; CSS token literal declarations are intentionally outside the scan.

- [ ] **Step 4: Verify repository integrity and whole-workspace build.**

Run: `git diff --check && pnpm build && git status --short`

Expected: exit 0 for diff/build; status lists only deliberate implementation files and approved CSI baseline images. Do not run `pnpm test`, because it reaches the server’s real test database.

- [ ] **Step 5: Commit final acceptance metadata.**

```bash
git add docs/superpowers/plans/2026-08-18-web-design-system-refactor.md
git commit -m "docs(web): record design system verification"
```

## Self-review checklist

- [ ] All 15 required deliveries map one-to-one to Tasks 1–15, including the broken `react-dom/client` baseline, test facility/tokens, all five component families, dev-only lab, Shell/Timeline, every requested page group, CSI replay, and final static/whole-site verification.
- [ ] Tasks 2–10 declare their shared owner and no later task edits their owner-only files except explicitly listed Task 14 package script and Task 15 verification.
- [ ] All exported interfaces named by a later task are produced in an earlier task, and every state-changing page still delegates data/business semantics to its existing RAB Service.
- [ ] No task uses placeholders, open-ended paths, “same as another task”, or a generic test instruction; each has files, consumes/produces interfaces, an initial failure, minimum implementation, passing command, and a commit.
