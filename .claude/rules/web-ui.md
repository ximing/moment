---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
---

# Web Design System 入口

以下文件是 `apps/web` 视觉与组件行为的唯一真相源；所有页面和组件开发必须遵循它们，不得在本规则或业务页面另立 Button、浮层、输入或反馈样式：

- `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`
- `docs/superpowers/specs/2026-08-18-web-button-design.md`
- `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`
- `docs/superpowers/specs/2026-08-18-web-field-input-design.md`
- `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`
- `docs/superpowers/specs/2026-08-18-web-feedback-design.md`

## 跨页面约束

- 颜色、字号、间距、圆角、阴影和控件尺寸一律复用 `apps/web/src/styles/tokens.css` 与对应语义组件；禁止页面写十六进制颜色、一次性尺寸（如 `px-[18px]`、`h-[52px]`）或负边距通栏。
- 布局和内容间距只使用 4 / 8 / 12 / 16 / 20 / 24 / 32px 档位；宽屏壳层、日子线、响应式断点与页面级对齐以 C 端总规范为准。
- 时刻内容保持 `[头像 32] + gap 12 + [内容列]`：作者、正文、媒体、Tag 和互动共用内容列边缘。纯文字可使用 `--surface` 色面，但内容层不得添加卡片阴影；媒体自行作为底。
- 一行内输入使用 `min-w-0`、动作使用 `shrink-0`；空间不足时改为合理换行或纵向布局，不挤压文案。
- 图标使用 Lucide；反应继续使用 DTO emoji。所有可交互元素都要有可见的 `focus-visible` 状态。

## 设计体系基座的唯一 Owner（2026-08-18 起）

以下基座文件已在「Establish the Web test scripts and token owner」一次性建立，之后的任务只能消费、不得回写：

- `apps/web/package.json` scripts：测试统一走 `pnpm --filter @moment/web test`（Vitest + jsdom），视觉回归走 `pnpm --filter @moment/web e2e:design-system`；不得新增或修改 package scripts。
- `apps/web/vitest.config.ts` 与 `apps/web/src/test/setup.ts`：不得新增或替换测试 setup；组件测试就近放源码旁（`*.test.ts(x)`），用 `-- <file>` 聚焦执行。
- `apps/web/src/styles/tokens.css` 与 `apps/web/tailwind.config.js`：不得新增 token、改 token 值或新增 Tailwind 语义映射；组件颜色、几何、z-index 只能消费已发布的语义 token。
- `tokens.css` 中的 legacy 过渡 alias（`--today`、`--knot-*`、`--sticker-*`、`--dot-gold`、`--elev`、`--elev-sm`、`--control-h-sm`、`--radius-sm` 及对应 Tailwind `card` / `sticker` 映射）只服务既有调用方，由 Task 13 统一清理；新代码禁止调用。
- `.gitignore` 的 `apps/web/e2e/artifacts/**`：E2E 运行时产物的唯一 ignore 规则；`e2e/baselines/**` 与 manifest 是受控基线，必须保持入库；不得新增其它 E2E ignore 规则。
