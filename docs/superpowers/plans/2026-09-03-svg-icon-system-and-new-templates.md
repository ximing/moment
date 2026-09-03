# SVG 图标系统与读书笔记/职业生涯模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `packages/icons` 彩色面性 SVG 图标系统（40 枚词表图标），双端以 AppIcon 三级解析替换 UI 中的词表 emoji 渲染，并落地 reading / career 两个新官方模板。

**Architecture:** `svg/*.svg` 是唯一画稿源；web 经 vite-plugin-svgr、app 经 react-native-svg-transformer 消费同一份文件。存量封闭 emoji 词表（mood 5 / reaction 10 / baby 里程碑 8 / 旧模板 icon 3）零迁移，只在渲染层经 dto 新增的 `EMOJI_TO_ICON` 映射换 SVG；新值（rating 4 档、career 里程碑 8、模板 icon 5）从第一天起就是 icon key。唯一 DB 变更是 `templates.icon` varchar(8)→varchar(50)。`summarizePayload` 三端从「按 kind 名分派」泛化为「按 payload 形态分派」，让无正文 career-event / reflection 能以摘要兜底发布。

**Tech Stack:** TypeScript（ESM NodeNext）、vite-plugin-svgr、react-native-svg-transformer + react-native-svg@15.12.1（既有依赖）、zod（dto）、Drizzle + drizzle-kit（server 迁移）、vitest（web/app/dto 经 tsx --test）、Jest + supertest（server，打 `.env` 测试库）。

**Spec:** `docs/superpowers/specs/2026-09-03-svg-icon-system-and-new-templates-design.md`（本文档处处引用其 §节号，执行时随带阅读）

## Global Constraints

- ESM NodeNext：TS 相对 import 一律带 `.js` 后缀。
- `svg/*.svg` 是唯一画稿源；禁止在 web/app 内联第二份彩色 SVG 源码（spec §2.1）。
- 词表只增不减；新增图标 = 加 svg + 注册表项 +（如属存量 emoji）补 `EMOJI_TO_ICON`（spec §2.3）。
- 不改动：`packages/dto/src/comments.ts`（REACTION_EMOJIS / 入库值 / 去重键 / 分组）、`packages/dto/src/chains.ts`（ChainIcon 自由 emoji）、worker 推送文案与通知 payload（spec §3.4）。
- 测试只打 `.env` 指向的测试库；server 触库测试 `afterAll(closeDb)`、`--runInBand`；禁止两个 jest 会话并行。
- web 改动遵守 `apps/web/CLAUDE.md` 与 `.claude/rules/web-ui.md`（Token、不另建样式约定）；server 迁移遵守 `apps/server/CLAUDE.md`（drizzle-kit generate，不手写 SQL 改表）。
- app 新代码禁止字面量 hex/rgba：`pnpm --filter @moment/app lint:tokens` 用 grep 拦截 `src/` 下的 `#xxx`/`rgba(` 字面量，唯一豁免 `src/theme/tokens.ts`；颜色一律从 `src/theme/tokens.ts` 语义 token 引（经 `useTheme()`）。
- 判定口径：渲染「用户数据里的字符串」用 AppIcon；渲染「代码里写死的装饰字符」用单色 Icon（web = 既有 lucide 封装，app = 本计划新建）。两者不混用（spec §4.4）。
- 每 Task 一个 commit，conventional commits（`feat(icons):` / `feat(dto):` / `feat(server):` / `feat(web):` / `feat(app):`）。
- 期序：P1→P2→P3 固定；P4 可与 P3 并行；P5 依赖 P1（rating 画稿）与 P2（列宽）。

---

## P1 — packages/icons 基建 + 首批画稿 32 枚 + 双端 AppIcon + dto EMOJI_TO_ICON

**出口标准（spec §6）：** 注册表项 ↔ svg 目录 parity、EMOJI_TO_ICON parity 测试通过；双端 AppIcon 三分支单测通过。

> P1 注册表共 32 个 key（mood 5 + reaction 10 + rating 4 + tpl 5 + baby 里程碑 8），svg 文件 31 个——`reaction-sweet` 是 `mood-love` 的别名，指向同一 `mood-love.svg`（spec §3.1 🥰 冲突决策）。

### Task P1-1: 首批画稿 32 枚（31 个 svg 文件）

**Files:**
- Create: `packages/icons/svg/*.svg`（31 个文件，清单见下）

**Interfaces:**
- Consumes: 无（首批落地，纯画稿）。
- Produces: `packages/icons/svg/<file>.svg` 文件集，文件名与 P1-2 注册表每个 entry 的 `file` 字段逐一对应。

画稿清单（31 个文件；`reaction-sweet` 无独立文件，复用 `mood-love.svg`）：

```
mood-joy  mood-love  mood-cry  mood-angry  mood-sleepy
reaction-like  reaction-love  reaction-laugh  reaction-wow  reaction-sad
reaction-celebrate  reaction-clap  reaction-strong  reaction-thanks
rating-love  rating-good  rating-ok  rating-pass
milestone-first-smile  milestone-first-roll  milestone-first-sit  milestone-first-crawl
milestone-first-stand  milestone-first-steps  milestone-first-word  milestone-first-tooth
tpl-baby  tpl-travel  tpl-daily  tpl-reading  tpl-career
```

执行口径（spec §2.2，逐枚遵守，不展开设计每枚图）：

1. viewBox 统一 `0 0 32 32`，主体视觉留白 2px（主体不超出 2–30 区间）。
2. 彩色面性（Fluent Emoji 风）：柔和渐变填充（同色系两档以内，用 `<linearGradient>`/`<radialGradient>`）、圆润饱满造型、无描边（不写 `stroke`）、无文字（不写 `<text>`）。
3. 色彩基调遵循 P1-2 注册表每枚的 `tone`（amber/rose/sky/green/purple/neutral）。
4. 单文件 < 8KB（纯 path/渐变，不内嵌位图/`<image>`）；31 枚合计 < 320KB。
5. 同一词表内视觉成组：reaction 10 枚（实画 9 枚）构图重心与主色明度一致；rating 4 枚为心形填充档位数列——饱满红心（超爱）→ 递减 → 空心/灰心（不推荐）（spec §2.3 附注）；mood 5 枚同一脸型/五官语言。
6. 每枚含 `<title>` 子元素写中文 label（无障碍兜底，值取 P1-2 注册表 label）。

- [ ] **Step 1: 按上表逐枚产出 31 个 svg 文件**

每枚svg骨架示例（`mood-joy.svg`，仅为结构示范，造型自行发挥但遵守口径 1–6）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <title>开心</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFD666"/>
      <stop offset="1" stop-color="#F5A623"/>
    </linearGradient>
  </defs>
  <!-- 圆润主体，无 stroke -->
  <circle cx="16" cy="16" r="13" fill="url(#g)"/>
</svg>
```

- [ ] **Step 2: 体积与结构校验**

Run: `ls packages/icons/svg/*.svg | wc -l`（期望 31）；`find packages/icons/svg -name '*.svg' -size +8k`（期望无输出）；`grep -l 'stroke=' packages/icons/svg/*.svg`（期望无输出）；`du -ck packages/icons/svg/*.svg | tail -1`（期望 total < 320）。
Expected: 全部满足；不满足的回到 Step 1 修正。

- [ ] **Step 3: 画稿人工走查（DoD）**

拼一张 contact sheet（如临时 HTML 一页平铺 31 枚，或在浏览器/Finder 逐枚浏览），逐项确认：① 同词表成组（reaction 9 枚构图重心/主色明度一致；mood 5 枚同一脸型语言；rating 4 枚心形档位递减可辨）；② 风格统一为彩色面性（柔和渐变、圆润、无描边、无文字），无混入线性/扁平单色风格的漂移稿；③ 每枚 tone 与 spec §2.3 词表一致。走查不通过的回 Step 1 重画。**机器校验（Step 2）不能替代本步。**

- [ ] **Step 4: Commit**

```bash
git add packages/icons/svg/
git commit -m "feat(icons): 首批 32 枚彩色面性画稿（mood/reaction/rating/tpl/baby 里程碑）"
```

### Task P1-2: packages/icons 包脚手架 + 图标注册表 + svg parity 测试

**Files:**
- Create: `packages/icons/package.json`
- Create: `packages/icons/tsconfig.json`
- Create: `packages/icons/eslint.config.js`
- Create: `packages/icons/src/manifest.ts`
- Test: `packages/icons/src/manifest.test.ts`
- Modify: `pnpm-workspace.yaml`（实施时验证：`packages/*` 通常已覆盖，若已覆盖则本文件不改）

**Interfaces:**
- Consumes: Task P1-1 的 31 个 svg 文件。
- Produces（后续所有 Task 依赖）：

```ts
// packages/icons/src/manifest.ts
export interface IconManifestEntry {
  /** svg/ 下的文件名（含扩展名） */
  file: string;
  /** 中文标签，用于无障碍文本（aria-label / accessibilityLabel）与表情含义展示 */
  label: string;
  /** 色彩基调 hint：供绘制与视觉走查参考，不影响运行时渲染 */
  tone: 'amber' | 'rose' | 'sky' | 'green' | 'purple' | 'neutral';
}
export const ICON_MANIFEST: { readonly [K in string]: IconManifestEntry } /* as const satisfies … */;
export type IconKey = keyof typeof ICON_MANIFEST;
export function hasIconKey(value: string): value is IconKey;
```

- [ ] **Step 1: 包脚手架**

`packages/icons/package.json`（对齐 `packages/dto/package.json` 形态；**`exports` 必须含 `./svg/*` 子路径**——app 已开 `unstable_enablePackageExports`，缺子路径双端无法 import svg，spec §2.1 要点 1）：

```json
{
  "name": "@moment/icons",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/manifest.js",
  "types": "./dist/manifest.d.ts",
  "exports": {
    ".": {
      "types": "./dist/manifest.d.ts",
      "default": "./dist/manifest.js"
    },
    "./svg/*": "./svg/*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsx --test src/*.test.ts",
    "lint": "eslint src/",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@moment/dto": "workspace:*",
    "@moment/eslint-config": "workspace:*",
    "@moment/typescript-config": "workspace:*",
    "eslint": "^9.19.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

注意：`@moment/dto` 只在 devDependencies（parity 测试用）；icons 运行时不依赖任何端，dto 不反向依赖 icons（spec §2.1）。

`packages/icons/tsconfig.json` 与 `eslint.config.js` 复制 `packages/dto/` 同名文件并按需改路径（实施时验证 dto 两文件内容后对齐）。

- [ ] **Step 2: 写失败测试（svg parity）**

`packages/icons/src/manifest.test.ts`（P1 阶段只跑「注册表 → svg 存在」与「file 字段唯一文件名合法」两项；40 枚计数断言在 P5-1 加入；EMOJI_TO_ICON parity 在 P1-3 加入）：

```ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ICON_MANIFEST, hasIconKey } from './manifest.js';

const svgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svg');

test('每个注册表项的 file 指向的 svg 文件存在（别名形态允许多 key 同文件）', () => {
  for (const [key, entry] of Object.entries(ICON_MANIFEST)) {
    assert.match(key, /^[a-z][a-z0-9-]{0,49}$/, `key 不合 slug 规范: ${key}`);
    assert.ok(existsSync(path.join(svgDir, entry.file)), `svg 缺失: ${entry.file} (${key})`);
    assert.ok(entry.label.length > 0, `label 为空: ${key}`);
  }
});

test('hasIconKey 命中与拒绝', () => {
  assert.equal(hasIconKey('mood-joy'), true);
  assert.equal(hasIconKey('reaction-sweet'), true);
  assert.equal(hasIconKey('😄'), false);
  assert.equal(hasIconKey('not-a-key'), false);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/icons test`
Expected: FAIL——`Cannot find module './manifest.js'`（manifest.ts 尚未创建）。

- [ ] **Step 4: 实现注册表**

`packages/icons/src/manifest.ts`（32 个 key 全集，label/tone 逐字取自 spec §2.3 词表）：

```ts
export interface IconManifestEntry {
  /** svg/ 下的文件名（含扩展名） */
  file: string;
  /** 中文标签，用于无障碍文本（aria-label / accessibilityLabel）与表情含义展示 */
  label: string;
  /** 色彩基调 hint：供绘制与视觉走查参考，不影响运行时渲染 */
  tone: 'amber' | 'rose' | 'sky' | 'green' | 'purple' | 'neutral';
}

export const ICON_MANIFEST = {
  'mood-joy': { file: 'mood-joy.svg', label: '开心', tone: 'amber' },
  'mood-love': { file: 'mood-love.svg', label: '幸福', tone: 'rose' },
  'mood-cry': { file: 'mood-cry.svg', label: '难过', tone: 'sky' },
  'mood-angry': { file: 'mood-angry.svg', label: '烦躁', tone: 'rose' },
  'mood-sleepy': { file: 'mood-sleepy.svg', label: '困倦', tone: 'purple' },
  'reaction-like': { file: 'reaction-like.svg', label: '点赞', tone: 'sky' },
  'reaction-love': { file: 'reaction-love.svg', label: '爱心', tone: 'rose' },
  'reaction-laugh': { file: 'reaction-laugh.svg', label: '笑哭', tone: 'amber' },
  'reaction-wow': { file: 'reaction-wow.svg', label: '惊讶', tone: 'amber' },
  'reaction-sad': { file: 'reaction-sad.svg', label: '难过', tone: 'sky' },
  'reaction-celebrate': { file: 'reaction-celebrate.svg', label: '庆祝', tone: 'purple' },
  // reaction-sweet 是 mood-love 的别名：🥰 同存于 mood 与 reaction 词表，映射表是纯函数无法按场景分叉（spec §3.1）
  'reaction-sweet': { file: 'mood-love.svg', label: '喜爱', tone: 'rose' },
  'reaction-clap': { file: 'reaction-clap.svg', label: '鼓掌', tone: 'amber' },
  'reaction-strong': { file: 'reaction-strong.svg', label: '加油', tone: 'green' },
  'reaction-thanks': { file: 'reaction-thanks.svg', label: '感谢', tone: 'amber' },
  'rating-love': { file: 'rating-love.svg', label: '超爱', tone: 'rose' },
  'rating-good': { file: 'rating-good.svg', label: '推荐', tone: 'amber' },
  'rating-ok': { file: 'rating-ok.svg', label: '一般', tone: 'neutral' },
  'rating-pass': { file: 'rating-pass.svg', label: '不推荐', tone: 'sky' },
  'milestone-first-smile': { file: 'milestone-first-smile.svg', label: '第一次微笑', tone: 'amber' },
  'milestone-first-roll': { file: 'milestone-first-roll.svg', label: '第一次翻身', tone: 'green' },
  'milestone-first-sit': { file: 'milestone-first-sit.svg', label: '第一次独坐', tone: 'sky' },
  'milestone-first-crawl': { file: 'milestone-first-crawl.svg', label: '第一次爬', tone: 'green' },
  'milestone-first-stand': { file: 'milestone-first-stand.svg', label: '第一次站立', tone: 'purple' },
  'milestone-first-steps': { file: 'milestone-first-steps.svg', label: '第一次走路', tone: 'amber' },
  'milestone-first-word': { file: 'milestone-first-word.svg', label: '第一次开口', tone: 'sky' },
  'milestone-first-tooth': { file: 'milestone-first-tooth.svg', label: '第一颗牙', tone: 'neutral' },
  'tpl-baby': { file: 'tpl-baby.svg', label: '宝宝成长', tone: 'rose' },
  'tpl-travel': { file: 'tpl-travel.svg', label: '旅行', tone: 'sky' },
  'tpl-daily': { file: 'tpl-daily.svg', label: '日常生活', tone: 'amber' },
  'tpl-reading': { file: 'tpl-reading.svg', label: '读书笔记', tone: 'green' },
  'tpl-career': { file: 'tpl-career.svg', label: '职业生涯', tone: 'purple' },
} as const satisfies Record<string, IconManifestEntry>;

export type IconKey = keyof typeof ICON_MANIFEST;

export function hasIconKey(value: string): value is IconKey {
  return Object.prototype.hasOwnProperty.call(ICON_MANIFEST, value);
}
```

- [ ] **Step 5: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/icons test && pnpm --filter @moment/icons build && pnpm --filter @moment/icons lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/icons/package.json packages/icons/tsconfig.json packages/icons/eslint.config.js packages/icons/src/
git commit -m "feat(icons): @moment/icons 包脚手架与图标注册表（32 key）"
```

### Task P1-3: dto 新增 EMOJI_TO_ICON 映射表 + icons↔dto parity

**Files:**
- Create: `packages/dto/src/icons.ts`
- Modify: `packages/dto/src/index.ts`（barrel 加一行）
- Test: `packages/icons/src/manifest.test.ts`（追加 parity 用例）

**Interfaces:**
- Consumes: Task P1-2 的 `ICON_MANIFEST` / `hasIconKey` / `IconKey`。
- Produces: `EMOJI_TO_ICON: Readonly<Record<string, string>>`（web/app AppIcon 与 parity 测试消费）。

- [ ] **Step 1: 写失败测试（parity）**

在 `packages/icons/src/manifest.test.ts` 追加：

```ts
import { EMOJI_TO_ICON } from '@moment/dto';

test('EMOJI_TO_ICON 全部值 ∈ 注册表', () => {
  for (const [emoji, key] of Object.entries(EMOJI_TO_ICON)) {
    assert.ok(hasIconKey(key), `EMOJI_TO_ICON['${emoji}'] = '${key}' 不在注册表`);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/icons test`
Expected: FAIL——`@moment/dto` 无 `EMOJI_TO_ICON` 导出。

- [ ] **Step 3: 实现映射表**

`packages/dto/src/icons.ts`（逐字取自 spec §3.1，含 🥰 冲突决策注释）：

```ts
/** 存量封闭 emoji 词表 → icon key。数据继续存 emoji，仅渲染层映射（spec §3.1）。 */
export const EMOJI_TO_ICON: Readonly<Record<string, string>> = {
  // daily 模板 mood（5）
  '😄': 'mood-joy',
  '🥰': 'mood-love',
  '😭': 'mood-cry',
  '😤': 'mood-angry',
  '😴': 'mood-sleepy',
  // reaction 白名单（REACTION_EMOJIS 共 10 项；🥰 已在上方 mood 区映射，此处不重复列——
  // 🥰 冲突决策：reaction-sweet 在注册表中是 mood-love 的别名，EMOJI_TO_ICON['🥰'] = 'mood-love'，见 spec §3.1）
  '👍': 'reaction-like',
  '❤️': 'reaction-love',
  '😂': 'reaction-laugh',
  '😮': 'reaction-wow',
  '😢': 'reaction-sad',
  '🎉': 'reaction-celebrate',
  '👏': 'reaction-clap',
  '💪': 'reaction-strong',
  '🙏': 'reaction-thanks',
  // baby 里程碑目录（8）
  '😊': 'milestone-first-smile',
  '🔄': 'milestone-first-roll',
  '🪑': 'milestone-first-sit',
  '🐾': 'milestone-first-crawl',
  '🧍': 'milestone-first-stand',
  '👣': 'milestone-first-steps',
  '💬': 'milestone-first-word',
  '🦷': 'milestone-first-tooth',
  // 旧官方模板 icon（3，防御性兼容：seed 会改写 DB，但客户端可能持有旧 manifest 缓存）
  '👶': 'tpl-baby',
  '✈️': 'tpl-travel',
  '🏠': 'tpl-daily',
};
```

`packages/dto/src/index.ts` 追加一行（与既有 barrel 风格一致，实施时验证文件内既有 re-export 写法）：

```ts
export * from './icons.js';
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto build && pnpm --filter @moment/dto test && pnpm --filter @moment/icons test`
Expected: 全绿（dto 先 build，icons parity 测试才解析得到 dist 或源码——实施时验证 `@moment/dto` 在 tsx --test 下的解析方式，若走 dist 则保持「先 build dto 再跑 icons 测试」顺序，与 `pnpm build` 先构建依赖包的既有约定一致）。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/icons.ts packages/dto/src/index.ts packages/icons/src/manifest.test.ts
git commit -m "feat(dto): 新增 EMOJI_TO_ICON 存量封闭词表→icon key 映射"
```

### Task P1-4: web SVGR 接入 + AppIcon 组件

**Files:**
- Modify: `apps/web/package.json`（加 `vite-plugin-svgr` devDependency、`@moment/icons` dependency）
- Modify: `apps/web/vite.config.ts`（plugins 加 svgr——实施时验证既有 plugins 数组形态后追加，不重写配置）
- Modify: `apps/web/vitest.config.ts`（**独立配置，不继承 vite.config.ts**——plugins 现仅 `react()`；必须同步加 `svgr()`，否则 `AppIcon.test.tsx` 解析不了 `*.svg?react`。保留既有 react/react-dom 钉版 alias、`resolve.dedupe` 与 `deps.optimizer.client` 段，只在 plugins 数组追加一项）
- Modify: `apps/web/src/env.d.ts`（追加 `/// <reference types="vite-plugin-svgr/client" />`）
- Create: `apps/web/src/ui/app-icon-components.ts`
- Create: `apps/web/src/ui/AppIcon.tsx`
- Test: `apps/web/src/ui/AppIcon.test.tsx`

**Interfaces:**
- Consumes: `@moment/icons` 的 `ICON_MANIFEST / IconKey / hasIconKey`、`@moment/dto` 的 `EMOJI_TO_ICON`。
- Produces（P2/P3 全部 web 替换点消费）：

```ts
// apps/web/src/ui/AppIcon.tsx
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null;
export function AppIcon(props: { value: string; size?: number; className?: string }): ReactElement;
```

- [ ] **Step 1: 构建接入（spec §2.1 要点 1/3/4）**

- `pnpm --filter @moment/web add -D vite-plugin-svgr` 并 `pnpm --filter @moment/web add @moment/icons@workspace:*`（实施时验证 web 包名）。
- `apps/web/vite.config.ts` 的 plugins 数组追加 `svgr()`（从 `vite-plugin-svgr` 导入）。
- `apps/web/vitest.config.ts` 的 plugins 数组同样追加 `svgr()`——该文件是独立 vitest 配置（defineConfig from 'vitest/config'，plugins 现仅 `[react()]`），不继承 vite.config.ts；其 react/react-dom alias、`dedupe`、`deps.optimizer.client.include` 段（双 React 实例修复）一字不动。
- `apps/web/src/env.d.ts` 顶部追加 `/// <reference types="vite-plugin-svgr/client" />`。

- [ ] **Step 2: 写失败测试（三分支）**

`apps/web/src/ui/AppIcon.test.tsx`（渲染 API 对齐既有 `apps/web/src/shell/chain-nav-list.test.tsx` 的写法，实施时验证其使用的 render 工具）：

```tsx
import assert from 'node:assert/strict';
// 实施时验证：对齐 chain-nav-list.test.tsx 的 render 导入方式（@testing-library/react 或既有封装）
import { render, screen } from '@testing-library/react';
import { describe, it } from 'vitest';
import { AppIcon, resolveAppIcon } from './AppIcon.js';

describe('resolveAppIcon 三级解析', () => {
  it('命中注册表', () => {
    assert.deepEqual(resolveAppIcon('mood-joy'), { key: 'mood-joy', label: '开心' });
  });
  it('命中 EMOJI_TO_ICON 映射', () => {
    assert.deepEqual(resolveAppIcon('😄'), { key: 'mood-joy', label: '开心' });
  });
  it('🥰 映射到 mood-love（reaction-sweet 别名决策，spec §3.1）', () => {
    assert.deepEqual(resolveAppIcon('🥰'), { key: 'mood-love', label: '幸福' });
  });
  it('自由 emoji（含 ZWJ）与未知值落兜底', () => {
    assert.equal(resolveAppIcon('👨‍👩‍👧'), null);
    assert.equal(resolveAppIcon('whatever'), null);
  });
});

describe('AppIcon 渲染', () => {
  it('注册表值渲染 svg 且带 label 无障碍文本', () => {
    render(<AppIcon value="reaction-clap" size={24} />);
    assert.ok(screen.getByRole('img', { name: '鼓掌' }));
  });
  it('emoji 值渲染映射目标的 svg', () => {
    render(<AppIcon value="👍" size={24} />);
    assert.ok(screen.getByRole('img', { name: '点赞' }));
  });
  it('兜底渲染原文本', () => {
    render(<AppIcon value="👨‍👩‍👧" size={24} />);
    assert.ok(screen.getByText('👨‍👩‍👧'));
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web test -- AppIcon`
Expected: FAIL——模块不存在。

- [ ] **Step 4: 实现 key→组件索引与 AppIcon**

`apps/web/src/ui/app-icon-components.ts`（显式 import 31 个 svg；`reaction-sweet` 复用 `MoodLove` 组件）：

```ts
import type { ComponentType, SVGProps } from 'react';
import type { IconKey } from '@moment/icons';
import MoodJoy from '@moment/icons/svg/mood-joy.svg?react';
import MoodLove from '@moment/icons/svg/mood-love.svg?react';
import MoodCry from '@moment/icons/svg/mood-cry.svg?react';
import MoodAngry from '@moment/icons/svg/mood-angry.svg?react';
import MoodSleepy from '@moment/icons/svg/mood-sleepy.svg?react';
import ReactionLike from '@moment/icons/svg/reaction-like.svg?react';
import ReactionLove from '@moment/icons/svg/reaction-love.svg?react';
import ReactionLaugh from '@moment/icons/svg/reaction-laugh.svg?react';
import ReactionWow from '@moment/icons/svg/reaction-wow.svg?react';
import ReactionSad from '@moment/icons/svg/reaction-sad.svg?react';
import ReactionCelebrate from '@moment/icons/svg/reaction-celebrate.svg?react';
import ReactionClap from '@moment/icons/svg/reaction-clap.svg?react';
import ReactionStrong from '@moment/icons/svg/reaction-strong.svg?react';
import ReactionThanks from '@moment/icons/svg/reaction-thanks.svg?react';
import RatingLove from '@moment/icons/svg/rating-love.svg?react';
import RatingGood from '@moment/icons/svg/rating-good.svg?react';
import RatingOk from '@moment/icons/svg/rating-ok.svg?react';
import RatingPass from '@moment/icons/svg/rating-pass.svg?react';
import MilestoneFirstSmile from '@moment/icons/svg/milestone-first-smile.svg?react';
import MilestoneFirstRoll from '@moment/icons/svg/milestone-first-roll.svg?react';
import MilestoneFirstSit from '@moment/icons/svg/milestone-first-sit.svg?react';
import MilestoneFirstCrawl from '@moment/icons/svg/milestone-first-crawl.svg?react';
import MilestoneFirstStand from '@moment/icons/svg/milestone-first-stand.svg?react';
import MilestoneFirstSteps from '@moment/icons/svg/milestone-first-steps.svg?react';
import MilestoneFirstWord from '@moment/icons/svg/milestone-first-word.svg?react';
import MilestoneFirstTooth from '@moment/icons/svg/milestone-first-tooth.svg?react';
import TplBaby from '@moment/icons/svg/tpl-baby.svg?react';
import TplTravel from '@moment/icons/svg/tpl-travel.svg?react';
import TplDaily from '@moment/icons/svg/tpl-daily.svg?react';
import TplReading from '@moment/icons/svg/tpl-reading.svg?react';
import TplCareer from '@moment/icons/svg/tpl-career.svg?react';

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const APP_ICON_COMPONENTS: Record<IconKey, SvgComponent> = {
  'mood-joy': MoodJoy,
  'mood-love': MoodLove,
  'mood-cry': MoodCry,
  'mood-angry': MoodAngry,
  'mood-sleepy': MoodSleepy,
  'reaction-like': ReactionLike,
  'reaction-love': ReactionLove,
  'reaction-laugh': ReactionLaugh,
  'reaction-wow': ReactionWow,
  'reaction-sad': ReactionSad,
  'reaction-celebrate': ReactionCelebrate,
  'reaction-sweet': MoodLove, // 别名（spec §3.1）
  'reaction-clap': ReactionClap,
  'reaction-strong': ReactionStrong,
  'reaction-thanks': ReactionThanks,
  'rating-love': RatingLove,
  'rating-good': RatingGood,
  'rating-ok': RatingOk,
  'rating-pass': RatingPass,
  'milestone-first-smile': MilestoneFirstSmile,
  'milestone-first-roll': MilestoneFirstRoll,
  'milestone-first-sit': MilestoneFirstSit,
  'milestone-first-crawl': MilestoneFirstCrawl,
  'milestone-first-stand': MilestoneFirstStand,
  'milestone-first-steps': MilestoneFirstSteps,
  'milestone-first-word': MilestoneFirstWord,
  'milestone-first-tooth': MilestoneFirstTooth,
  'tpl-baby': TplBaby,
  'tpl-travel': TplTravel,
  'tpl-daily': TplDaily,
  'tpl-reading': TplReading,
  'tpl-career': TplCareer,
};
```

注：Record<IconKey, …> 会让 P5-1 扩展注册表后此处类型报错——刻意为之，强制索引同步（P5-1 会补 8 个 import）。

`apps/web/src/ui/AppIcon.tsx`（与 `ui/Icon.tsx` 并列：Icon = lucide 单色，AppIcon = 彩色面性/emoji 值渲染，spec §4.2）：

```tsx
import { EMOJI_TO_ICON } from '@moment/dto';
import { ICON_MANIFEST, hasIconKey, type IconKey } from '@moment/icons';
import { APP_ICON_COMPONENTS } from './app-icon-components.js';

/** 三级解析（spec §4.1）：注册表 → EMOJI_TO_ICON 映射 → null（调用方原文兜底）。 */
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null {
  if (hasIconKey(value)) return { key: value, label: ICON_MANIFEST[value].label };
  const mapped = EMOJI_TO_ICON[value];
  if (mapped && hasIconKey(mapped)) return { key: mapped, label: ICON_MANIFEST[mapped].label };
  return null;
}

/** 渲染一个字符串值：词表 icon key / 存量 emoji → 彩色面性 SVG；其余原文兜底。不吞未知值、不报错。 */
export function AppIcon({ value, size = 20, className }: { value: string; size?: number; className?: string }) {
  const hit = resolveAppIcon(value);
  if (!hit) {
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {value}
      </span>
    );
  }
  const Component = APP_ICON_COMPONENTS[hit.key];
  return <Component width={size} height={size} role="img" aria-label={hit.label} className={className} />;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/web test -- AppIcon && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/vitest.config.ts apps/web/src/env.d.ts apps/web/src/ui/app-icon-components.ts apps/web/src/ui/AppIcon.tsx apps/web/src/ui/AppIcon.test.tsx pnpm-lock.yaml
git commit -m "feat(web): 接入 SVGR 并新增 AppIcon 三级解析组件"
```

### Task P1-5: app react-native-svg-transformer 接入 + AppIcon 组件

**Files:**
- Modify: `apps/app/package.json`（加 `react-native-svg-transformer` devDependency、`@moment/icons` dependency；`react-native-svg@15.12.1` 已是既有依赖）
- Modify: `apps/app/metro.config.js`（**在既有自定义配置上叠加**，不得整体重写，spec §2.1 要点 2）
- Create: `apps/app/src/types/svg.d.ts`（`declare module '*.svg'`，要点 3；实施时验证 `src/types/` 是否已有声明文件可合并）
- Create: `apps/app/src/components/app-icon-resolve.ts`（**纯模块**：只依赖 `@moment/dto` + `@moment/icons`，不 import react-native / svg——app 无 vitest 配置、纯 node 环境跑测试，import 任何 `.tsx` 或 `.svg` 都会炸）
- Create: `apps/app/src/components/app-icon-components.ts`
- Create: `apps/app/src/components/AppIcon.tsx`（re-export `resolveAppIcon`）
- Test: `apps/app/src/components/app-icon-resolve.test.ts`（**只 import 纯模块**，与既有 `src/lib/*.test.ts` 同为纯逻辑 vitest）

**Interfaces:**
- Consumes: 同 P1-4。
- Produces（P2/P3/P4 app 侧消费）：

```ts
// apps/app/src/components/app-icon-resolve.ts（纯模块，测试与组件共用）
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null;
// apps/app/src/components/AppIcon.tsx
export { resolveAppIcon } from './app-icon-resolve.js';
export function AppIcon(props: { value: string; size?: number }): ReactElement;
```

- [ ] **Step 1: 构建接入（spec §2.1 要点 2/3/4）**

- `pnpm --filter @moment/app add -D react-native-svg-transformer` 并 `pnpm --filter @moment/app add @moment/icons@workspace:*`（实施时验证 app 包名）。
- `apps/app/metro.config.js` 在既有 config 对象上叠加（保留既有 monorepo watchFolders / package exports / react 钉版逻辑）：

```js
// 在既有 config 定义之后、module.exports 之前追加：
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};
config.resolver = {
  ...config.resolver,
  assetExts: config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...config.resolver.sourceExts, 'svg'],
};
```

- TS 声明（要点 3）：

```ts
// apps/app/src/types/svg.d.ts
declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';
  const content: React.ComponentType<SvgProps>;
  export default content;
}
```

（实施时验证：tsconfig include 是否覆盖该路径。）

- [ ] **Step 2: 写失败测试（三分支）**

`apps/app/src/components/app-icon-resolve.test.ts`（只测纯解析函数 `resolveAppIcon`——三分支语义由该函数完全决定；**严禁 import `AppIcon.tsx`**，它会拉入 react-native 与 31 个 `.svg`，node vitest 无法加载）：

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { resolveAppIcon } from './app-icon-resolve.js';

describe('resolveAppIcon 三级解析', () => {
  it('命中注册表', () => {
    assert.deepEqual(resolveAppIcon('milestone-first-tooth'), { key: 'milestone-first-tooth', label: '第一颗牙' });
  });
  it('命中 EMOJI_TO_ICON 映射', () => {
    assert.deepEqual(resolveAppIcon('😴'), { key: 'mood-sleepy', label: '困倦' });
  });
  it('🥰 映射到 mood-love（别名决策）', () => {
    assert.deepEqual(resolveAppIcon('🥰'), { key: 'mood-love', label: '幸福' });
  });
  it('自由 emoji（含 ZWJ/肤色）与未知值落兜底', () => {
    assert.equal(resolveAppIcon('👨‍👩‍👧'), null);
    assert.equal(resolveAppIcon('👍🏽'), null);
    assert.equal(resolveAppIcon('whatever'), null);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/app test -- app-icon-resolve`
Expected: FAIL——模块不存在。

- [ ] **Step 4: 实现纯解析模块、key→组件索引与 AppIcon**

`apps/app/src/components/app-icon-resolve.ts`（纯模块，不 import react/react-native/svg）：

```ts
import { EMOJI_TO_ICON } from '@moment/dto';
import { ICON_MANIFEST, hasIconKey, type IconKey } from '@moment/icons';

/** 三级解析（spec §4.1）：注册表 → EMOJI_TO_ICON 映射 → null（调用方原文兜底）。 */
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null {
  if (hasIconKey(value)) return { key: value, label: ICON_MANIFEST[value].label };
  const mapped = EMOJI_TO_ICON[value];
  if (mapped && hasIconKey(mapped)) return { key: mapped, label: ICON_MANIFEST[mapped].label };
  return null;
}
```

`apps/app/src/components/app-icon-components.ts`——与 P1-4 web 版同结构，import 不带 `?react`（transformer 直接返回组件），`reaction-sweet` 同样复用 `MoodLove`（31 个 import 全量列出，不得省略）：

```ts
import type { ComponentType } from 'react';
import type { SvgProps } from 'react-native-svg';
import type { IconKey } from '@moment/icons';
import MoodJoy from '@moment/icons/svg/mood-joy.svg';
import MoodLove from '@moment/icons/svg/mood-love.svg';
import MoodCry from '@moment/icons/svg/mood-cry.svg';
import MoodAngry from '@moment/icons/svg/mood-angry.svg';
import MoodSleepy from '@moment/icons/svg/mood-sleepy.svg';
import ReactionLike from '@moment/icons/svg/reaction-like.svg';
import ReactionLove from '@moment/icons/svg/reaction-love.svg';
import ReactionLaugh from '@moment/icons/svg/reaction-laugh.svg';
import ReactionWow from '@moment/icons/svg/reaction-wow.svg';
import ReactionSad from '@moment/icons/svg/reaction-sad.svg';
import ReactionCelebrate from '@moment/icons/svg/reaction-celebrate.svg';
import ReactionClap from '@moment/icons/svg/reaction-clap.svg';
import ReactionStrong from '@moment/icons/svg/reaction-strong.svg';
import ReactionThanks from '@moment/icons/svg/reaction-thanks.svg';
import RatingLove from '@moment/icons/svg/rating-love.svg';
import RatingGood from '@moment/icons/svg/rating-good.svg';
import RatingOk from '@moment/icons/svg/rating-ok.svg';
import RatingPass from '@moment/icons/svg/rating-pass.svg';
import MilestoneFirstSmile from '@moment/icons/svg/milestone-first-smile.svg';
import MilestoneFirstRoll from '@moment/icons/svg/milestone-first-roll.svg';
import MilestoneFirstSit from '@moment/icons/svg/milestone-first-sit.svg';
import MilestoneFirstCrawl from '@moment/icons/svg/milestone-first-crawl.svg';
import MilestoneFirstStand from '@moment/icons/svg/milestone-first-stand.svg';
import MilestoneFirstSteps from '@moment/icons/svg/milestone-first-steps.svg';
import MilestoneFirstWord from '@moment/icons/svg/milestone-first-word.svg';
import MilestoneFirstTooth from '@moment/icons/svg/milestone-first-tooth.svg';
import TplBaby from '@moment/icons/svg/tpl-baby.svg';
import TplTravel from '@moment/icons/svg/tpl-travel.svg';
import TplDaily from '@moment/icons/svg/tpl-daily.svg';
import TplReading from '@moment/icons/svg/tpl-reading.svg';
import TplCareer from '@moment/icons/svg/tpl-career.svg';

type SvgComponent = ComponentType<SvgProps>;

export const APP_ICON_COMPONENTS: Record<IconKey, SvgComponent> = {
  'mood-joy': MoodJoy,
  'mood-love': MoodLove,
  'mood-cry': MoodCry,
  'mood-angry': MoodAngry,
  'mood-sleepy': MoodSleepy,
  'reaction-like': ReactionLike,
  'reaction-love': ReactionLove,
  'reaction-laugh': ReactionLaugh,
  'reaction-wow': ReactionWow,
  'reaction-sad': ReactionSad,
  'reaction-celebrate': ReactionCelebrate,
  'reaction-sweet': MoodLove, // 别名（spec §3.1）
  'reaction-clap': ReactionClap,
  'reaction-strong': ReactionStrong,
  'reaction-thanks': ReactionThanks,
  'rating-love': RatingLove,
  'rating-good': RatingGood,
  'rating-ok': RatingOk,
  'rating-pass': RatingPass,
  'milestone-first-smile': MilestoneFirstSmile,
  'milestone-first-roll': MilestoneFirstRoll,
  'milestone-first-sit': MilestoneFirstSit,
  'milestone-first-crawl': MilestoneFirstCrawl,
  'milestone-first-stand': MilestoneFirstStand,
  'milestone-first-steps': MilestoneFirstSteps,
  'milestone-first-word': MilestoneFirstWord,
  'milestone-first-tooth': MilestoneFirstTooth,
  'tpl-baby': TplBaby,
  'tpl-travel': TplTravel,
  'tpl-daily': TplDaily,
  'tpl-reading': TplReading,
  'tpl-career': TplCareer,
};
```

注：Record<IconKey, …> 会让 P5-1 扩展注册表后此处类型报错——刻意为之，强制索引同步（P5-1 会补 8 个 import）。

`apps/app/src/components/AppIcon.tsx`：

```tsx
import { Text } from 'react-native';
import { resolveAppIcon } from './app-icon-resolve.js';
import { APP_ICON_COMPONENTS } from './app-icon-components.js';

export { resolveAppIcon } from './app-icon-resolve.js';

/** 渲染一个字符串值：词表 icon key / 存量 emoji → 彩色面性 SVG；其余 <Text> 原文兜底。 */
export function AppIcon({ value, size = 20 }: { value: string; size?: number }) {
  const hit = resolveAppIcon(value);
  if (!hit) {
    return <Text style={{ fontSize: size, lineHeight: size * 1.2 }}>{value}</Text>;
  }
  const Component = APP_ICON_COMPONENTS[hit.key];
  return <Component width={size} height={size} accessibilityLabel={hit.label} />;
}
```

- [ ] **Step 5: 运行确认通过 + 真机构建验证**

Run: `pnpm --filter @moment/app test -- app-icon-resolve && pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint`
Expected: 全绿。
另手动验证：`pnpm --filter @moment/app start` 后 metro bundle 不因 svg import 报错（实施时验证一次冷启动 bundle）。

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json apps/app/metro.config.js apps/app/src/types/ apps/app/src/components/app-icon-resolve.ts apps/app/src/components/app-icon-components.ts apps/app/src/components/AppIcon.tsx apps/app/src/components/app-icon-resolve.test.ts pnpm-lock.yaml
git commit -m "feat(app): 接入 react-native-svg-transformer 并新增 AppIcon 三级解析组件"
```

---

## P2 — 官方三模板图标化 + templates.icon 列宽迁移

**出口标准（spec §6）：** 迁移与代码同批部署；migrate 后 DB 三模板 icon 为 `tpl-*`；模板选择器渲染 SVG；存量链/时刻渲染回归通过。

### Task P2-1: dto 三模板 icon 换 key + 三处 maxLength 8→50

**Files:**
- Modify: `packages/dto/src/templates.ts`（`manifestJsonSchema.milestoneCatalog[].icon` maxLength 8→50；`OFFICIAL_TEMPLATES` 三模板 `icon` 换 `tpl-*`；baby `milestoneCatalog[].icon` 8 项换 `milestone-first-*`；`createTemplateInputSchema.icon` / `updateTemplateInputSchema.icon` `.max(8)`→`.max(50)`）
- Test: `packages/dto/src/templates.test.ts`

**Interfaces:**
- Consumes: P1 注册表 key 名（`tpl-baby/tpl-travel/tpl-daily/milestone-first-*`）。
- Produces: 不改任何导出签名；`OFFICIAL_TEMPLATES` 数据形态变化（icon 值为 icon key）供 P2-2 seed 与 P2-3 渲染消费。

- [ ] **Step 1: 写失败测试**

`packages/dto/src/templates.test.ts` 追加（既有断言风格实施时验证后对齐）：

```ts
// 三官方模板 icon 为注册表 key 形态（OFFICIAL_TEMPLATES / validateManifest / createTemplateInputSchema
// 已在既有测试文件 import，直接复用其夹具）
test('官方三模板 icon 为 tpl-* key，baby catalog icon 为 milestone-first-* key', () => {
  const byKey = new Map(OFFICIAL_TEMPLATES.map((t) => [t.key, t]));
  assert.equal(byKey.get('baby')!.icon, 'tpl-baby');
  assert.equal(byKey.get('travel')!.icon, 'tpl-travel');
  assert.equal(byKey.get('daily')!.icon, 'tpl-daily');
  const babyCatalog = byKey.get('baby')!.manifest.milestoneCatalog!;
  assert.deepEqual(
    babyCatalog.map((c) => c.icon),
    ['milestone-first-smile', 'milestone-first-roll', 'milestone-first-sit', 'milestone-first-crawl',
     'milestone-first-stand', 'milestone-first-steps', 'milestone-first-word', 'milestone-first-tooth'],
  );
});

// icon maxLength 50 边界
test('createTemplateInputSchema icon 50 收 51 拒', () => {
  const base = { name: 'x', manifest: { version: 1 } };
  assert.ok(createTemplateInputSchema.safeParse({ ...base, icon: 'a'.repeat(50) }).success);
  assert.ok(!createTemplateInputSchema.safeParse({ ...base, icon: 'a'.repeat(51) }).success);
});
test('updateTemplateInputSchema icon 50 收 51 拒', () => {
  assert.ok(updateTemplateInputSchema.safeParse({ icon: 'a'.repeat(50) }).success);
  assert.ok(!updateTemplateInputSchema.safeParse({ icon: 'a'.repeat(51) }).success);
});
test('manifest milestoneCatalog icon 50 收 51 拒（ajv 直测，同既有 meta-schema 用例写法）', () => {
  const catalog = (icon: string) => [{ key: 'first-smile', label: '第一次微笑', icon }];
  assert.equal(
    validateManifest({ version: 1, milestoneCatalog: catalog('a'.repeat(50)) }),
    true,
    JSON.stringify(validateManifest.errors),
  );
  assert.equal(validateManifest({ version: 1, milestoneCatalog: catalog('a'.repeat(51)) }), false);
});
```

（`validateManifest` = 既有测试文件顶部的 `ajv.compile(manifestJsonSchema)`；`OFFICIAL_TEMPLATES[].manifest` 的类型字段名实施时验证，按 `OfficialTemplate` 接口现状取。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: 新用例 FAIL（当前 icon 仍是 emoji、max 仍是 8）。

- [ ] **Step 3: 最小实现**

`packages/dto/src/templates.ts` 五处改动（实施时验证行号）：
1. `manifestJsonSchema` 的 `milestoneCatalog[].icon`：`maxLength: 8` → `maxLength: 50`。
2. `OFFICIAL_TEMPLATES` baby/travel/daily 的 `icon` 分别改 `'tpl-baby'` / `'tpl-travel'` / `'tpl-daily'`。
3. baby `milestoneCatalog` 8 项 `icon` 按 spec §2.3 词表换 `milestone-first-*`（smile/roll/sit/crawl/stand/steps/word/tooth 顺序保持现状）。
4. `createTemplateInputSchema.icon` 与 `updateTemplateInputSchema.icon`：`.max(8)` → `.max(50)`（「从词表选、禁止 URL」语义保留，注释在 P5-2 统一清扫）。
5. baby 模板其余字段不动。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/templates.ts packages/dto/src/templates.test.ts
git commit -m "feat(dto): 官方三模板 icon 与 baby 里程碑目录换 icon key，icon 长度放宽至 50"
```

### Task P2-2: server templates.icon 列宽迁移 + seed 改写验证

**Files:**
- Modify: `apps/server/src/db/schema/templates.ts:18`（`varchar('icon', { length: 8 })` → `{ length: 50 }`）
- Create: `apps/server/drizzle/<timestamp>_*.sql`（drizzle-kit 生成，不手写）
- Test: `apps/server/tests/templates-icon.test.ts`（新文件；或并入既有 templates 测试文件，实施时验证后定）

**Interfaces:**
- Consumes: P2-1 的 `OFFICIAL_TEMPLATES`（icon 已是 key）；`apps/server/src/templates/official-templates.seed.ts` **不改代码**（icon/manifest 本就在 onDuplicateKeyUpdate upsert 集合，spec §3.3——实施时读该文件验证一次）。
- Produces: 迁移后 `templates.icon` varchar(50)，DB 行 icon 为 `tpl-*`。

- [ ] **Step 1: 写失败测试**

`apps/server/tests/templates-icon.test.ts`（触库，`afterAll(closeDb)`；`resetDb()` 走既有约定。`templates` 表 schema 导出名、`seedOfficialTemplates` 无参幂等——均已确认：`apps/server/src/templates/official-templates.seed.ts` 导出 `seedOfficialTemplates(): Promise<void>`）：

```ts
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { templates } from '../src/db/schema/templates.js';
import { seedOfficialTemplates } from '../src/templates/official-templates.seed.js';
import { auth, createUser, type TestUser } from './helpers/auth.js';
import { closeDb, resetDb } from './helpers/db.js';
import { listenLocal } from './helpers/http-server.js';

const app = listenLocal(createApp());

let alice: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app, 'alice');
});
afterAll(closeDb);

describe('templates.icon 列宽与 seed 图标化', () => {
  it('information_schema 中 templates.icon 为 varchar(50)', async () => {
    const [rows] = await pool.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'templates' AND COLUMN_NAME = 'icon'`,
    );
    expect(Number((rows as Array<{ len: number }>)[0].len)).toBe(50);
  });

  it('seed 幂等且把三官方模板 icon 改写为 tpl-* key', async () => {
    // 模拟旧数据：把 baby icon 改回 emoji，跑 seed 应被 upsert 回 key
    await db.update(templates).set({ icon: '👶' }).where(eq(templates.key, 'baby'));
    await seedOfficialTemplates();
    const rows = await db
      .select({ key: templates.key, icon: templates.icon })
      .from(templates)
      .where(inArray(templates.key, ['baby', 'travel', 'daily']));
    const byKey = new Map(rows.map((r) => [r.key, r.icon]));
    expect(byKey.get('baby')).toBe('tpl-baby');
    expect(byKey.get('travel')).toBe('tpl-travel');
    expect(byKey.get('daily')).toBe('tpl-daily');

    // 幂等：再跑一次，官方行数不变
    const countBefore = rows.length;
    await seedOfficialTemplates();
    const rowsAfter = await db
      .select({ key: templates.key })
      .from(templates)
      .where(inArray(templates.key, ['baby', 'travel', 'daily']));
    expect(rowsAfter.length).toBe(countBefore);
  });

  it('带 icon key（>8 字符）的 user 模板可建 201，51 字符 400', async () => {
    const ok = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: '读书', icon: 'tpl-reading', manifest: { version: 1 } });
    expect(ok.status).toBe(201);
    expect(ok.body.icon).toBe('tpl-reading');

    const tooLong = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: 'x', icon: 'a'.repeat(51), manifest: { version: 1 } });
    expect(tooLong.status).toBe(400);
  });
});
```

（`listenLocal` / `auth` / `createUser` 用法照搬 `tests/templates/templates.crud.test.ts`；`pool` 自 `src/db/index.ts` 导出，见 CONVENTIONS §1。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- templates-icon`
Expected: FAIL——列宽仍是 8，icon>8 的创建被 varchar(8) 截断或校验 400。

- [ ] **Step 3: 最小实现 + 迁移**

1. `apps/server/src/db/schema/templates.ts`：`icon: varchar('icon', { length: 8 }).notNull()` → `{ length: 50 }`。
2. Run: `pnpm --filter @moment/server exec drizzle-kit generate`（实施时验证 generate 命令的既有 npm script 名）。
3. 检查生成的迁移 SQL 为 `ALTER TABLE `templates` MODIFY COLUMN `icon` varchar(50) NOT NULL` 一类（ALTER COLUMN MODIFY，与代码同批部署，spec §3.3）。
4. Run: `pnpm --filter @moment/server migrate`（只打 `.env` 测试库）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- templates-icon`
Expected: PASS（jest globalSetup 已自动跑迁移；远程共享测试库勿并行跑第二个 jest 会话）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema/templates.ts apps/server/drizzle/ apps/server/tests/templates-icon.test.ts
git commit -m "feat(server): templates.icon 列宽 8→50 迁移"
```

### Task P2-3: 双端模板选择器改走 AppIcon

**Files:**
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`（模板卡片 icon 渲染处）
- Modify: `apps/app/src/features/chains-new/index.tsx`（模板选择渲染处）
- Test: 双端各加/改组件测试（web 可参考既有测试形态；app 复用 P1-5 的 resolveAppIcon 测试思路，只断言传给 AppIcon 的 value）

**Interfaces:**
- Consumes: P1-4 `apps/web/src/ui/AppIcon.tsx`、P1-5 `apps/app/src/components/AppIcon.tsx`。
- Produces: 无新符号。

- [ ] **Step 1: 定位现状渲染点**

Run: `grep -n "icon" apps/web/src/shell/create-chain-dialog/index.tsx apps/app/src/features/chains-new/index.tsx`
确认两处模板 icon 当前以文本渲染 emoji 的位置。

- [ ] **Step 2: 写失败测试**

web：`apps/web/src/shell/create-chain-dialog.service.test.ts` 同目录或新建组件测试，断言选择官方模板时渲染出 `role="img"` 且 `aria-label` 为模板 icon key 对应注册表 label（如 baby → 「宝宝成长」）。实施时验证既有 create-chain-dialog 测试形态后写用例。
app：断言模板选择处使用 AppIcon 且 `resolveAppIcon('tpl-baby')` 命中（组件树断言按既有 app 测试可行度取舍，至少覆盖 service/解析层）。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web test -- create-chain-dialog`；`pnpm --filter @moment/app test -- chains-new`（或对应新测试文件名）
Expected: FAIL。

- [ ] **Step 4: 最小实现**

两处把模板 icon 的文本节点换成 `<AppIcon value={template.icon} size={…} />`（size 沿用该处既有 emoji 字号的视觉等效值，web 遵守 web-ui 规则走 Token，实施时验证该处字号来源）。用户自建模板的自由 emoji icon 自动落兜底分支，视觉不变。

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/app test && pnpm --filter @moment/app typecheck`
Expected: 全绿；存量链/时刻渲染相关既有测试零改动通过。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell/create-chain-dialog/ apps/app/src/features/chains-new/
git commit -m "feat(web): 模板选择器图标改走 AppIcon"
```
（web/app 分两个 commit 亦可；若分开，app 为 `feat(app): 模板选择器图标改走 AppIcon`。）

---

## P3 — reaction / mood 渲染切换（双端）

**出口标准（spec §6）：** 契约零改动（`git diff` 中 `packages/dto/src/comments.ts` 为空）；reaction 去重键/分组/推送既有测试不改动全部通过。

### Task P3-1: web reaction-bar / ReactionPopover / moodline / mood 选择器 / moment 摘要切换

**Files:**
- Modify: `apps/web/src/timeline/reaction-bar.tsx`
- Modify: `apps/web/src/ui/popover/Popover.tsx`（`ReactionPopover` 十格选择面板）
- Modify: `apps/web/src/chain/aggregate-views.tsx`（moodline 心情点、milestone-axis 节点 icon）
- Modify: `apps/web/src/compose/template-fields.tsx`（mood emoji-picker 选项、里程碑目录 chips）
- Modify: `apps/web/src/timeline/moment-sheet.tsx`（mood/里程碑摘要位）
- Modify: `apps/web/src/chain/ChainMark.tsx`、`apps/web/src/ui/Avatar.tsx`（包一层 AppIcon，自由 emoji 走兜底，视觉不变，spec §4.2 末条）
- Test: 上述组件的既有测试按新渲染更新（实施时逐个 grep `*.test.tsx` 引用）

**Interfaces:**
- Consumes: P1-4 `AppIcon` / `resolveAppIcon`。
- Produces: 无新符号。

- [ ] **Step 1: 逐个定位 emoji 渲染点**

Run: `grep -n "emoji\|mood\|reaction" apps/web/src/timeline/reaction-bar.tsx apps/web/src/ui/popover/Popover.tsx apps/web/src/chain/aggregate-views.tsx apps/web/src/compose/template-fields.tsx apps/web/src/timeline/moment-sheet.tsx | head -40`
列出每处「渲染数据值里的 emoji 字符串」的位置，逐一定为 AppIcon 替换点。**注意判定口径**：只换数据值渲染；代码里写死的装饰字符留给 P4。

- [ ] **Step 2: 写/改失败测试**

对 reaction-bar 与 ReactionPopover：断言 `👍` 渲染为 `role="img" name="点赞"` 的 SVG 而非文本节点。对 moodline：mood 值 `😄` 渲染为 `aria-label="开心"`。对 ChainMark：自由 emoji 链图标（含 ZWJ，如 `👨‍👩‍👧`）仍渲染原文本节点（兜底回归）。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web test`
Expected: 新断言 FAIL。

- [ ] **Step 4: 最小实现**

逐处把 emoji 文本节点换成 `<AppIcon value={…} size={…} />`。size 取该处既有 emoji 字号的视觉等效值（web-ui 规则：走 Token，不写一次性 px）。ReactionPopover 的选项按钮无障碍名同步换成注册表 label。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): reaction/mood/里程碑数据值渲染切换 AppIcon"
```

### Task P3-2: app reaction / mood / 里程碑渲染切换（与 web 对称）

**Files:**
- Modify: `apps/app/src/features/compose/template-fields.tsx`（mood/里程碑 chips）
- Modify: `apps/app/src/features/chain-home/aggregate-views.tsx`（moodline/milestone-axis）
- Modify: `apps/app/src/components/MomentCard.tsx`、`apps/app/src/features/moment/index.tsx`（reaction 条与时刻摘要）
- Test: 相关既有测试更新（实施时 grep 定位）

**Interfaces:**
- Consumes: P1-5 `AppIcon` / `resolveAppIcon`。
- Produces: 无新符号。

- [ ] **Step 1: 定位渲染点**

Run: `grep -n "emoji\|mood\|reaction" apps/app/src/components/MomentCard.tsx apps/app/src/features/moment/index.tsx apps/app/src/features/compose/template-fields.tsx apps/app/src/features/chain-home/aggregate-views.tsx | head -40`

- [ ] **Step 2: 写/改失败测试**

与 P3-1 对称：reaction 值 `❤️` 处断言经 `resolveAppIcon('❤️')` 命中 `reaction-love`；自由 emoji 兜底回归。组件树断言按 app 测试基建可行度取舍，解析层断言必须覆盖全部替换点用到的值（10 个 reaction emoji + 5 个 mood emoji 各一例）。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/app test`
Expected: 新断言 FAIL。

- [ ] **Step 4: 最小实现**

逐处换 `<AppIcon value={…} size={…} />`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/app test && pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/
git commit -m "feat(app): reaction/mood/里程碑数据值渲染切换 AppIcon"
```

### Task P3-3: reaction 契约回归验证（零改动）

**Files:**
- 无改动（纯验证任务）。

**Interfaces:**
- Consumes: 既有 server reaction 测试套件。
- Produces: 出口标准的书面确认。

- [ ] **Step 1: 契约 diff 为空确认**

Run: `git log --oneline -- packages/dto/src/comments.ts | head -3` 确认本计划期间无提交触碰该文件；再 `git diff <P1 起点 commit>..HEAD -- packages/dto/src/comments.ts`（P1 起点 = 本计划首个 commit 的父提交，执行时记录）。
Expected: 无提交 / 空输出。若非空，回退该文件改动。

- [ ] **Step 2: reaction 全流程既有测试零改动通过**

Run: `pnpm --filter @moment/server test -- reaction` 及 notification/worker 相关既有套件（实施时 `ls apps/server/tests/` 定位 reaction / notification / worker 推送测试文件，全部跑一遍）。
Expected: 全部 PASS 且测试文件本身 diff 为空。

- [ ] **Step 3: 无需 commit（无改动）**

---

## P4 — 装饰 emoji 清扫（可与 P3 并行）

**出口标准（spec §6）：** 双端源码中 UI chrome 不再含装饰 emoji（数据默认值与测试夹具除外）。

### Task P4-1: web 装饰 emoji → 既有 lucide 封装

**Files:**
- Modify: 全部含装饰 emoji 的 web 源文件（Step 1 扫描定位）
- Test: 受影响组件的既有测试同步更新

**Interfaces:**
- Consumes: 既有 `apps/web/src/ui/Icon.tsx`（lucide 单色封装）。
- Produces: 无新符号。

- [ ] **Step 1: 扫描定位**

Run:

```bash
grep -rnoP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]' apps/web/src --include='*.tsx' --include='*.ts' | grep -v test
```

逐个判定（spec §4.4 口径）：渲染「用户数据里的字符串」→ 不动（应已在 P3 走 AppIcon）；「代码里写死的装饰字符」（📍📅💬⚙️ 等）→ 换 lucide Icon；数据默认值与测试夹具 → 不动。把判定清单写进 commit message 或 PR 描述备查。

- [ ] **Step 2: 写/改失败测试**

对替换处所在组件的既有测试，断言不再渲染该 emoji 文本（`queryByText('📍')` 为 null）。无既有测试的散点并入下一步手动验收。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web test`
Expected: 新断言 FAIL。

- [ ] **Step 4: 最小实现**

逐处换 `<Icon name="…" />`（lucide 名按语义选：📍→MapPin、📅→Calendar、💬→MessageCircle、⚙️→Settings 等，实施时验证 `ui/Icon.tsx` 的 name 词表），颜色/尺寸遵循 C 端设计规范（Token）。

- [ ] **Step 5: 运行确认通过 + 清扫复查**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web lint && pnpm --filter @moment/web typecheck`，再跑 Step 1 的 grep 确认无残留（除豁免项）。
Expected: 全绿，grep 仅剩豁免项。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): 装饰 emoji 清扫为 lucide 单色图标"
```

### Task P4-2: app 新建单色 Icon 组件 + 装饰 emoji 清扫 + Tab 栏

**Files:**
- Create: `apps/app/src/components/app-line-icons.ts`（**纯数据模块**：lucide 24×24 path 数据内联常量，不 import react/react-native-svg——app 纯 node vitest 才能加载它做测试）
- Create: `apps/app/src/components/Icon.tsx`（只做渲染，import 上面的纯模块 + react-native-svg + `useTheme`，不引入运行时图标库，spec §4.4）
- Test: `apps/app/src/components/app-line-icons.test.ts`（只 import 纯数据模块）
- Modify: `apps/app/app/(tabs)/_layout.tsx`（Tab 栏 emoji 文本图标替换）
- Modify: 其余含装饰 emoji 的 app 源文件（扫描定位）

**Interfaces:**
- Consumes: 既有 `react-native-svg`、`src/theme/use-theme.ts` 的 `useTheme()`。
- Produces（app 后续 UI 通用）：

```ts
// apps/app/src/components/app-line-icons.ts（纯数据）
export const APP_LINE_ICONS = { 'map-pin': …, calendar: …, 'message-circle': …, settings: …, … } as const;
export type AppLineIconName = keyof typeof APP_LINE_ICONS;
// apps/app/src/components/Icon.tsx
export function Icon(props: { name: AppLineIconName; size?: number; color?: string }): ReactElement;
```

- [ ] **Step 1: 扫描定位 + 确定词表**

Run: `grep -rnoP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]' apps/app/app apps/app/src --include='*.tsx' --include='*.ts' | grep -v test`
按 P4-1 同口径判定，得出本端需要的 icon 名清单（至少覆盖 Tab 栏用到的全部）。

- [ ] **Step 2: 写失败测试**

```ts
// apps/app/src/components/app-line-icons.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { APP_LINE_ICONS } from './app-line-icons.js';

describe('APP_LINE_ICONS 词表', () => {
  it('覆盖装饰 emoji 清扫所需全部名字', () => {
    for (const name of ['map-pin', 'calendar', 'message-circle', 'settings' /* …Step 1 清单 */]) {
      assert.ok(name in APP_LINE_ICONS, `缺少 ${name}`);
      assert.ok(APP_LINE_ICONS[name as keyof typeof APP_LINE_ICONS].length > 0);
    }
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/app test -- app-line-icons`
Expected: FAIL——模块不存在。

- [ ] **Step 4: 实现 Icon 组件并替换**

`apps/app/src/components/app-line-icons.ts`（纯数据，无 JSX、无 react-native 依赖）：

```ts
/** lucide 单色线性图标 path 数据（24×24，内联常量，不引入运行时图标库；spec §4.4）。词表只增不减。 */
export const APP_LINE_ICONS = {
  // path d 数据逐枚从 lucide 对应图标复制（实施时验证 lucide 官网/既有 web ui/Icon.tsx 引用的 lucide 包版本，取同源 path）
  'map-pin': 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  // ……按 Step 1 清单补齐；上例 path 仅为结构示范，实施时以 lucide 官方 path 为准（含圆/多段时可用多 Path）
} as const;

export type AppLineIconName = keyof typeof APP_LINE_ICONS;
```

`apps/app/src/components/Icon.tsx`（只做渲染；**颜色默认取主题 token**——`lint:tokens` 拦 hex/rgba 字面量，唯一豁免 `src/theme/tokens.ts`，见 Global Constraints）：

```tsx
import { Path, Svg } from 'react-native-svg';
import { useTheme } from '../theme/use-theme.js';
import { APP_LINE_ICONS, type AppLineIconName } from './app-line-icons.js';

export type { AppLineIconName } from './app-line-icons.js';

/** 单色线性图标。缺省色 = 次级文字 token（装饰图标语义）；调用方可显式覆盖（值同样须来自 token）。 */
export function Icon({ name, size = 24, color }: { name: AppLineIconName; size?: number; color?: string }) {
  const theme = useTheme();
  const strokeColor = color ?? theme.colors.muted;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={APP_LINE_ICONS[name]} />
    </Svg>
  );
}
```

（`useTheme(): Theme` 已确认存在（`src/theme/use-theme.ts`，跟随系统外观的纯函数）；`theme.colors.muted` 字段名实施时对 `ColorTokens` 接口验证后取用，次级语义不符则换 `ink`。）

注：多图元 lucide 图标（如 map-pin 的圆心）单条 path 无法表达时，把 value 改为 `string[]` 逐条渲染，或拆 `<Circle>`——实施时按实际图标定，保持词表签名稳定。

逐处替换装饰 emoji（含 `app/(tabs)/_layout.tsx` Tab 栏）为 `<Icon name="…" />`；替换处需要强调色时传 `color={theme.colors.xxx}` 而非字面量。

- [ ] **Step 5: 运行确认通过 + 清扫复查**

Run: `pnpm --filter @moment/app test && pnpm --filter @moment/app lint && pnpm --filter @moment/app typecheck`（`lint` 内含 `lint:tokens`，hex/rgba 字面量会被拦），再跑 Step 1 grep 确认无残留（除豁免项）。
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/app-line-icons.ts apps/app/src/components/Icon.tsx apps/app/src/components/app-line-icons.test.ts "apps/app/app/(tabs)/_layout.tsx" apps/app/src/
git commit -m "feat(app): 新建单色 Icon 组件，装饰 emoji 与 Tab 栏图标清扫"
```

---

## P5 — 新增 reading / career 模板（依赖 P1 画稿与 P2 列宽）

**出口标准（spec §6）：** 模板列表出现 5 个官方模板；建链→发 career-event/reflection（含无正文摘要兜底）/带 rating 读书笔记→「职业轨迹」轴渲染 SVG；注册表全集 40 枚计数断言通过。

### Task P5-1: career 里程碑画稿 8 枚 + 注册表扩 40 + 计数断言

**Files:**
- Create: `packages/icons/svg/milestone-{join,promotion,transfer,job-hop,leave,award,major-project,certification}.svg`（8 个）
- Modify: `packages/icons/src/manifest.ts`（追加 8 个 entry）
- Modify: `packages/icons/src/manifest.test.ts`（加 40 枚全集计数断言）
- Modify: `apps/web/src/ui/app-icon-components.ts`、`apps/app/src/components/app-icon-components.ts`（Record<IconKey,…> 类型报错驱动，补 8 个 import 与映射）

**Interfaces:**
- Consumes: P1 基建；spec §2.3 career 里程碑词表（label/tone）。
- Produces: `IconKey` 扩为 40 枚全集。

- [ ] **Step 1: 画稿 8 枚**

口径同 P1-1（viewBox `0 0 32 32`、留白 2px、彩色面性、无描边、`<title>` 写 label、单文件 < 8KB）；label/tone 逐字取 spec §2.3：入职 green / 晋升 rose / 转岗 sky / 跳槽 purple / 离职 neutral / 获奖 amber / 重大项目 sky / 职业认证 green。8 枚与 baby 里程碑 8 枚视觉成组（构图重心、主色明度一致）。
校验同 P1-1 Step 2，并补总量断言：`ls packages/icons/svg/*.svg | wc -l`（期望 39）、`du -ck packages/icons/svg/*.svg | tail -1`（**40 枚注册表 / 39 文件总量仍 < 320KB**，spec §2.2 全包预算）。

- [ ] **Step 1.5: 画稿人工走查（DoD，同 P1-1 Step 3）**

contact sheet 或逐枚浏览：career 8 枚与 baby 8 枚同组风格不漂移；16 枚 milestone 一起过目，构图重心与主色明度一致；每枚 label/tone 与 spec §2.3 一致。不通过回 Step 1 重画。

- [ ] **Step 2: 写失败测试（计数断言 + parity 自动覆盖新文件）**

`packages/icons/src/manifest.test.ts` 追加：

```ts
test('注册表全集 40 枚（spec §7：P5 随 career 画稿交付时加入）', () => {
  assert.equal(Object.keys(ICON_MANIFEST).length, 40);
});
```

同时把 P1 既有 parity 用例预期从 32 调整为不做硬编码计数（保持逐 entry 文件存在断言即可，计数由本条负责）。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/icons test`
Expected: FAIL——当前 32 枚。

- [ ] **Step 4: 最小实现**

`packages/icons/src/manifest.ts` 在 baby 里程碑之后追加（顺序按 spec §2.3）：

```ts
  'milestone-join': { file: 'milestone-join.svg', label: '入职', tone: 'green' },
  'milestone-promotion': { file: 'milestone-promotion.svg', label: '晋升', tone: 'rose' },
  'milestone-transfer': { file: 'milestone-transfer.svg', label: '转岗', tone: 'sky' },
  'milestone-job-hop': { file: 'milestone-job-hop.svg', label: '跳槽', tone: 'purple' },
  'milestone-leave': { file: 'milestone-leave.svg', label: '离职', tone: 'neutral' },
  'milestone-award': { file: 'milestone-award.svg', label: '获奖', tone: 'amber' },
  'milestone-major-project': { file: 'milestone-major-project.svg', label: '重大项目', tone: 'sky' },
  'milestone-certification': { file: 'milestone-certification.svg', label: '职业认证', tone: 'green' },
```

双端 `app-icon-components.ts` 补 8 个 import 与映射（`Record<IconKey, …>` 此时类型报错，逐处补齐即消）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/icons test && pnpm --filter @moment/icons build && pnpm --filter @moment/web typecheck && pnpm --filter @moment/app typecheck`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/icons/ apps/web/src/ui/app-icon-components.ts apps/app/src/components/app-icon-components.ts
git commit -m "feat(icons): career 里程碑画稿 8 枚，注册表全集 40"
```

### Task P5-2: dto 新增 reading / career 官方模板 + key 联合扩展 + 注释清扫

**Files:**
- Modify: `packages/dto/src/templates.ts`（`OfficialTemplate.key` 联合加 `'reading' | 'career'`；`OFFICIAL_TEMPLATES` 追加两份完整 manifest；`TemplateDto.key` 注释官方 slug 列举补 reading/career；`createTemplateInputSchema` icon 注释从「单个 emoji/短符号」更新为「单个 emoji / 短符号 / icon key」）
- Test: `packages/dto/src/templates.test.ts`

**Interfaces:**
- Consumes: P5-1 的 `milestone-*`/`tpl-*` key（manifest 中 icon 值引用）。
- Produces: `OFFICIAL_TEMPLATES` 全长 5 份；server seed 随之在下次 migrate/resetDb 自动 upsert（spec §3.3，零代码改动）。

- [ ] **Step 1: 写失败测试**

```ts
test('官方模板共 5 份且全部过 manifestJsonSchema', () => {
  assert.deepEqual(
    OFFICIAL_TEMPLATES.map((t) => t.key),
    ['baby', 'travel', 'daily', 'reading', 'career'], // 实施时验证既有顺序约定后对齐
  );
  for (const t of OFFICIAL_TEMPLATES) {
    assert.equal(validateManifest(t.manifest), true, `${t.key}: ${JSON.stringify(validateManifest.errors)}`);
  }
});

test('reading rating 字段：icon key 选项经 momentFieldPayloadJsonSchema 派生 enum 校验', () => {
  const reading = OFFICIAL_TEMPLATES.find((t) => t.key === 'reading')!;
  const ratingField = reading.manifest.momentFields!.find((f) => f.key === 'rating')!;
  assert.equal(ratingField.type, 'emoji-picker');
  const validate = ajv.compile(momentFieldPayloadJsonSchema(ratingField));
  assert.equal(validate('rating-love'), true);
  assert.equal(validate('rating-pass'), true);
  assert.equal(validate('❤️'), false);
  assert.equal(validate('rating-nope'), false);
});

test('career-event payloadSchema 与 baby milestone 同构：catalog_key/custom_label 二选一', () => {
  const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!;
  const careerEvent = career.manifest.kinds!.find((k) => k.key === 'career-event')!;
  const validate = ajv.compile(careerEvent.payloadSchema);
  assert.equal(validate({ catalog_key: 'promotion' }), true);
  assert.equal(validate({ catalog_key: 'promotion', note: '带组 8 人' }), true);
  assert.equal(validate({ custom_label: '内部转组' }), true);
  assert.equal(validate({}), false, JSON.stringify(validate.errors));
  assert.equal(validate({ catalog_key: 'PROMOTION' }), false); // pattern 拒大写
  assert.equal(validate({ catalog_key: 'promotion', hacker: 1 }), false); // additionalProperties
});

test('reflection payloadSchema：topic 必填 1-50，decision/next_step 可选 ≤500', () => {
  const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!;
  const reflection = career.manifest.kinds!.find((k) => k.key === 'reflection')!;
  const validate = ajv.compile(reflection.payloadSchema);
  assert.equal(validate({ topic: '要不要接这个新机会' }), true);
  assert.equal(validate({ topic: 't', decision: 'd', next_step: 'n' }), true);
  assert.equal(validate({}), false);
  assert.equal(validate({ topic: '' }), false);
  assert.equal(validate({ topic: 'x'.repeat(51) }), false);
});
```

（`ajv` / `validateManifest` / `momentFieldPayloadJsonSchema` 均已在 `templates.test.ts` 顶部就绪；`OfficialTemplate.manifest.kinds[].payloadSchema` 的字段类型实施时对 `OfficialTemplate` 接口验证——若为 `Record<string, unknown>`，`ajv.compile` 直接收。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: 新用例 FAIL（模板不存在）。

- [ ] **Step 3: 最小实现**

`packages/dto/src/templates.ts`：
1. `OfficialTemplate.key` 联合类型追加 `'reading' | 'career'`。
2. `OFFICIAL_TEMPLATES` 追加 spec §5 两份完整 TS 常量（reading：momentFields book/rating，无 kinds/views/chainPayloadSchema；career：kinds career-event/reflection、views milestone-axis、milestoneCatalog 8 项）——逐字复制 spec §5 代码块。
3. 注释清扫：`TemplateDto.key` 注释的官方 slug 列举补 reading/career；`createTemplateInputSchema` icon 注释语义从「单个 emoji/短符号」更新为「单个 emoji / 短符号 / icon key」（spec §6 P5 范围）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 全绿。

- [ ] **Step 5: server 侧联动验证（seed upsert 新模板）**

Run: `pnpm --filter @moment/server test -- templates`
Expected: 既有模板测试全绿；实施时验证 migrate/resetDb 后 DB 出现 reading/career 两行（seed upsert 自动生效，零代码改动——若既有测试未覆盖，在 `tests/templates-icon.test.ts` 或模板测试里补一条「官方模板 5 行且 icon 为 tpl-*」断言）。

- [ ] **Step 6: Commit**

```bash
git add packages/dto/src/templates.ts packages/dto/src/templates.test.ts
git commit -m "feat(dto): 新增 reading/career 官方模板，官方模板扩至 5 个"
```

### Task P5-3: web/app summarizePayload 泛化（payload 形态分派）

**Files:**
- Modify: `apps/web/src/lib/template.ts`（`summarizePayload`，第 78–91 行区域）
- Modify: `apps/app/src/lib/template.ts`（同函数，与 web 同规则）
- Test: 双端 `template` 相关测试文件（实施时定位既有 `summarizePayload` 用例所在文件）

**Interfaces:**
- Consumes: 既有 `resolveMilestoneLabel(manifest, payload): { label: string; icon: string | null }`（两端同名同签名，不改）。
- Produces: 签名不变 `summarizePayload(manifest: TemplateManifest, kind: string, payload: Record<string, unknown> | null): string`；分派语义改变（spec §5）。调用点 `apps/web/src/compose/compose-panel/compose-panel.service.ts` 与 `apps/app/src/features/compose/compose.service.ts` **不改代码**（spec §3.4 配套表）。

泛化后的完整实现（两端逐字一致）：

```ts
/**
 * kind moment 的正文兜底摘要（Global Constraints：text 类型 content 必填，
 * 用户只填结构化字段时用它兜底）。standard / 无法摘要时返回 ''（调用方不兜底）。
 *
 * 分派按 payload 形态而非 kind 名（spec §5）：
 * - 含 catalog_key / custom_label → 里程碑目录解析（milestone 与 career-event 同路径）
 * - 含 topic → 主题摘要（reflection）
 * - metric 分支与未知 payload 返回 '' 的兜底不变
 */
export function summarizePayload(
  manifest: TemplateManifest,
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return '';
  if (typeof payload.catalog_key === 'string' || typeof payload.custom_label === 'string') {
    return resolveMilestoneLabel(manifest, payload).label;
  }
  if (typeof payload.topic === 'string') return payload.topic;
  const metric = typeof payload.metric === 'string' ? payload.metric : undefined;
  if (metric !== undefined && typeof payload.value === 'number') {
    const unit = typeof payload.unit === 'string' ? payload.unit : '';
    return `${METRIC_LABELS[metric] ?? metric} ${payload.value}${unit}`;
  }
  return '';
}
```

（实施时验证：`kind` 参数保留以兼容调用方按位置传参；若 lint/tsc 报未使用参数则改名为 `_kind` 并同步注释。）

- [ ] **Step 1: 写失败测试（两端同套用例）**

```ts
// 夹具：career manifest 取自 OFFICIAL_TEMPLATES（实施时验证 import 路径）
describe('summarizePayload 泛化（spec §5）', () => {
  it('career-event 含 catalog_key 出目录 label', () => {
    assert.equal(summarizePayload(careerManifest, 'career-event', { catalog_key: 'promotion' }), '晋升');
  });
  it('career-event 含 custom_label 出原文', () => {
    assert.equal(summarizePayload(careerManifest, 'career-event', { custom_label: '内部转组' }), '内部转组');
  });
  it('reflection 出 topic', () => {
    assert.equal(summarizePayload(careerManifest, 'reflection', { topic: '要不要接这个机会' }), '要不要接这个机会');
  });
  it('baby milestone 摘要回归不变', () => {
    assert.equal(summarizePayload(babyManifest, 'milestone', { catalog_key: 'first-steps' }), '第一次走路');
  });
  it('metric 分支不变', () => {
    assert.equal(summarizePayload(babyManifest, 'metric', { metric: 'height', value: 52, unit: 'cm' }), '身高 52cm');
  });
  it('未知 payload 返回空串兜底不变', () => {
    assert.equal(summarizePayload(careerManifest, 'whatever', { foo: 1 }), '');
    assert.equal(summarizePayload(careerManifest, 'standard', null), '');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- template`；`pnpm --filter @moment/app test -- template`
Expected: 前三条 FAIL（现状 career-event 落兜底 `''`）。

- [ ] **Step 3: 最小实现**

两端按上方完整实现替换 `summarizePayload` 函数体。

- [ ] **Step 4: 运行确认通过 + 发布链路回归**

Run: 双端 `test && typecheck && lint`；另跑既有 compose 相关测试（`compose-panel.service` / `compose.service` 用例）确认「无正文 kind moment 以摘要兜底通过 CONTENT_REQUIRED」的正反例回归不破坏。
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/template.ts apps/app/src/lib/template.ts apps/web/src/ apps/app/src/
git commit -m "feat(web): summarizePayload 按 payload 形态分派泛化"
```
（web/app 分两个 commit 亦可，app 为 `feat(app): …`。）

### Task P5-4: server recap summarizePayload 泛化（含 kind label 前缀）

**Files:**
- Modify: `apps/server/src/llm/recap/input.ts`（`summarizePayload` 第 105–137 行区域 + 调用点第 217 行 + `meta` 组装处补 `kindLabels`）
- Test: `apps/server/tests/recaps/recap-summarize.test.ts`（新建；经公开入口 `buildRecapInput` 黑盒断言，`summarizePayload` 保持模块私有不导出）

**Interfaces:**
- Consumes: manifest.kinds 的 label（career-event → 「职业事件」、milestone → 「里程碑」、reflection → 「思考」）。
- Produces: 无导出签名变化（模块内函数）。

- [ ] **Step 1: 写失败测试**

`summarizePayload` 是模块内私有函数，经公开入口 `buildRecapInput(chainId, period)` 黑盒断言序列化行——新建 `apps/server/tests/recaps/recap-summarize.test.ts`（夹具完全照搬 `recap-degraded-e2e.test.ts` 的 helper 组合）：

```ts
import { createApp } from '../../src/app.js';
import { buildRecapInput } from '../../src/llm/recap/input.js';
import { seedOfficialTemplates } from '../../src/templates/official-templates.seed.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;

beforeEach(async () => {
  await resetDb(); // resetDb 只清 user scope 模板，官方模板保留；幂等 seed 兜底确保 career 行就位
  await seedOfficialTemplates();
  owner = await createUser(app, 'owner');
});
afterAll(closeDb);

describe('recap summarizePayload 泛化（spec 2026-09-03 §5）', () => {
  it('career-event 出【职业事件】前缀 + 目录 label', async () => {
    const chain = await createChain(app, owner, '职业', 'career');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'career-event',
      payload: { catalog_key: 'promotion' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments).toHaveLength(1);
    expect(input.moments[0].line).toContain('【职业事件】晋升');
  });

  it('reflection 出【思考】+ topic', async () => {
    const chain = await createChain(app, owner, '职业', 'career');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'reflection',
      payload: { topic: '要不要接这个机会' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments[0].line).toContain('【思考】要不要接这个机会');
  });

  it('milestone 前缀保持【里程碑】回归', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'milestone',
      payload: { catalog_key: 'first-steps' },
    });
    const input = await buildRecapInput(chain.id, '2026-08');
    expect(input.moments[0].line).toContain('【里程碑】第一次走路');
  });

  it('metric/standard 分支不变', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({
      chainId: chain.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      kind: 'metric',
      payload: { metric: 'height', value: 52, unit: 'cm' },
    });
    const daily = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: daily.id,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T01:00:00Z'),
      payload: { mood: '😄' },
    });
    const babyInput = await buildRecapInput(chain.id, '2026-08');
    expect(babyInput.moments[0].line).toContain('【记录】height 52cm');
    const dailyInput = await buildRecapInput(daily.id, '2026-08');
    expect(dailyInput.moments[0].line).toContain('【心情】😄');
  });
});
```

（`createChain(app, owner, name, templateKey)` 返回 `{id}`、`insertMoment` content 缺省 '内容'、`buildRecapInput(chainId, 'YYYY-MM')`——均已对照 `tests/helpers/chains.js`、`tests/helpers/fixtures.ts`、`src/llm/recap/input.ts` 确认。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- recap`
Expected: 前两条 FAIL。

- [ ] **Step 3: 最小实现**

`apps/server/src/llm/recap/input.ts`：
1. `meta` 组装处（第 34–49 行区域，实施时验证）除 `milestoneCatalog` 外补 `kindLabels: Map<string, string>`，自 `manifest.kinds` 建（`(manifest.kinds ?? []).map((k) => [k.key, k.label])`）。
2. `summarizePayload` 签名加 `kindLabels: Map<string, string>`，函数体改为：

```ts
/** payload 摘要（spec §4.2 + 2026-09-03 §5 泛化：按 payload 形态分派，前缀取 kind 在 manifest 中的 label）。 */
function summarizePayload(
  kind: string,
  payload: Record<string, unknown> | null,
  milestoneCatalog: Map<string, { label: string; icon: string | null }>,
  kindLabels: Map<string, string>,
): string {
  if (!payload) return '';
  // 含 catalog_key / custom_label → 目录解析（milestone →【里程碑】、career-event →【职业事件】）
  if (typeof payload.catalog_key === 'string' || typeof payload.custom_label === 'string') {
    const catalogKey = payload.catalog_key as string | undefined;
    const hit = catalogKey ? milestoneCatalog.get(catalogKey) : undefined;
    const label = hit?.label ?? (payload.custom_label as string | undefined) ?? catalogKey ?? '';
    return `【${kindLabels.get(kind) ?? kind}】${label}`;
  }
  // 含 topic → 主题摘要（reflection →【思考】）
  if (typeof payload.topic === 'string') {
    return `【${kindLabels.get(kind) ?? kind}】${payload.topic}`;
  }
  switch (kind) {
    case 'metric': {
      const metric = String(payload.metric ?? '');
      const value = payload.value;
      const unit = String(payload.unit ?? '');
      return `【记录】${metric} ${value}${unit}`;
    }
    case 'standard': {
      // daily 的 mood、travel 的 geo 在 standard payload 内
      const mood = payload.mood;
      if (typeof mood === 'string') return `【心情】${mood}`;
      const geo = payload.geo as { place_name?: string; lat?: number; lng?: number } | undefined;
      if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
        return `【位置】${geo.place_name ?? ''}`;
      }
      return '';
    }
    default:
      return '';
  }
}
```

3. 调用点（第 217 行）改为 `summarizePayload(r.kind, r.payload, meta.milestoneCatalog, meta.kindLabels)`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- recap && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/llm/recap/input.ts apps/server/tests/
git commit -m "feat(server): recap summarizePayload 按 payload 形态分派，前缀取 kind label"
```

### Task P5-5: 双端渲染验证与整体验收

**Files:**
- Modify: `apps/web/src/compose/template-fields.tsx`、`apps/app/src/features/compose/template-fields.tsx`（若 P3 未覆盖：rating emoji-picker 选项此时已是 icon key 值，确认走 AppIcon——P3-1/P3-2 的 emoji-picker 替换已按「选项值经 AppIcon」实现则本步只是验证）
- 无其他代码改动预期；发现问题回到对应 Task 修。

**Interfaces:**
- Consumes: 全部前序 Task。
- Produces: 验收记录。

- [ ] **Step 1: rating 选项渲染验证**

新 release 下 reading 模板 rating 字段 options 为 `rating-*` key，发布器 emoji-picker 选项经 AppIcon 命中注册表出 SVG（P3 替换点已含 template-fields，此处补一条断言：`rating-love` 渲染 `aria-label="超爱"`）。
Run: `pnpm --filter @moment/web test -- template-fields`；`pnpm --filter @moment/app test -- template-fields`

- [ ] **Step 2: 端到端手动验收清单（写进 DoD，逐项打勾）**

前置：`pnpm build && pnpm dev`，DB 已 migrate。
1. 模板列表/建链对话框出现 5 个官方模板，icon 均为彩色 SVG。
2. 用 career 模板建链 → 发一条 career-event（选「晋升」，不写正文）→ 以摘要兜底发布成功（不被「选一项或写一句，再发布」/ CONTENT_REQUIRED 拦截）。
3. 发一条 reflection（只填 topic，不写正文）→ 发布成功，时间线摘要为 topic。
4. 「职业轨迹」轴渲染 career-event 节点，icon 为彩色 SVG。
5. 用 reading 模板建链 → 发带 rating 的读书笔记 → 推荐度选项与展示均为 SVG。
6. 存量链回归：含 emoji mood 的 daily 时刻渲染为对应 SVG；reaction 条十格全部 SVG；自由 emoji 链图标/头像原样。
7. 分享页只读渲染自动跟随（复用组件，抽查一页）。
8. app 端对称走查 1–6（spec §8 验收 1/2/4）。

- [ ] **Step 3: 全量绿**

Run: `pnpm build && pnpm test && pnpm lint`
Expected: 全绿（spec §8.5）。server 测试勿与其他 jest 会话并行。

- [ ] **Step 4: Commit（仅当有修补改动）**

按实际改动分包 scope 提交（示例）：web 修补 `feat(web): rating 选项渲染与 P5 验收修补`；app 修补 `feat(app): …`；server/dto 修补同理。不混包一把 `git add -A`。
（无改动则跳过 commit，在任务记录中注明。）

---

## 自查记录（写完计划后执行）

- **Spec 覆盖**：§2 包与画稿 → P1-1/P1-2/P1-5、P5-1；§3.1 EMOJI_TO_ICON → P1-3；§3.3 DB 变更与 meta-schema 放宽 → P2-1/P2-2；§3.4 逐条清单 → P1/P2/P5 各 Task（comments.ts / chains.ts / worker 不改由 P3-3 与 Global Constraints 双重把守）；§4 渲染层 → P1-4/P1-5（AppIcon）+ P2-3/P3（替换点）+ P4（装饰清扫）；§5 新模板与 summarizePayload 泛化 → P5-2/P5-3/P5-4；§6 分期与期序 → 本计划 P1–P5 与依赖注记一致；§7 测试策略 → parity（P1-2/P1-3/P5-1）、dto（P2-1/P5-2）、server（P2-2/P5-4）、摘要泛化（P5-3/P5-4）、reaction 回归（P3-3）、AppIcon 三分支（P1-4/P1-5）全覆盖；§8 验收 → P5-5。
- **占位符扫描**：除明确标注「实施时验证」（行号、既有测试夹具形态、metro 既有配置细节）外无 TBD/TODO；所有接口签名与关键代码块完整。
- **跨 Task 类型一致性**：`ICON_MANIFEST/IconKey/hasIconKey`（P1-2 定义 → P1-3/P1-4/P1-5/P5-1 消费）、`EMOJI_TO_ICON`（P1-3 定义 → P1-4/P1-5 消费）、`resolveAppIcon`（web 在 `AppIcon.tsx`、app 在纯模块 `app-icon-resolve.ts` 并由 `AppIcon.tsx` re-export，两端同签名 → P2-3/P3/P5-5 消费）、`resolveMilestoneLabel`/`summarizePayload`（签名不变，P5-3 改语义、P5-4 server 版加 `kindLabels` 参数）、`APP_LINE_ICONS`（P4-2 定义于纯数据模块 `app-line-icons.ts`，`Icon.tsx` 只渲染）——名称与签名前后一致。

## 修订记录（评审后 v2）

- **P1-4**：`apps/web/vitest.config.ts` 加入 Files 与 Step 1——独立 vitest 配置（plugins 仅 `react()`），必须与 vite.config.ts 同步加 `svgr()`，否则 `*.svg?react` 在测试中解析失败；既有 react/react-dom 钉版 alias 与 `deps.optimizer.client` 段不动。
- **P1-5**：`resolveAppIcon` 抽到纯模块 `app-icon-resolve.ts`（只依赖 dto/icons manifest），测试改 `app-icon-resolve.test.ts` 只 import 纯模块——app 纯 node vitest 加载不了 `.tsx`/`.svg`；`AppIcon.tsx` re-export 保持消费方签名不变；`app-icon-components.ts` 31 个 import 全量列出，消除「略去重复列表」占位。
- **P4-2**：`APP_LINE_ICONS` path 数据拆到纯数据模块 `app-line-icons.ts`（同理由），测试随之改名；`Icon.tsx` 颜色默认取 `useTheme()` 语义 token（`theme.colors.muted`），不再出现 `'#000'` 字面量；Global Constraints 新增「app 新代码禁止字面量 hex/rgba（lint:tokens grep 拦截，唯一豁免 theme/tokens.ts）」。
- **测试补全**：P2-1（milestoneCatalog icon 边界 ajv 用例）、P2-2（整文件：information_schema 列宽走 `pool.query`、seed 改写+幂等、>8 字符 icon 建模板 201/51 字符 400）、P5-2（rating 派生 enum / career-event 二选一 / reflection 必填边界，全部经既有 ajv 实例直测）、P5-4（新建 `tests/recaps/recap-summarize.test.ts`，经 `buildRecapInput` 黑盒断言四条分支，夹具照搬 recap-degraded-e2e 的 helper 组合）。
- **画稿 DoD**：P1-1 Step 3 / P5-1 Step 1.5 增加人工走查（contact sheet 或逐枚浏览，同词表成组 + 风格不漂移）；P5-1 Step 1 补 40 枚总量 < 320KB 断言（`du -ck`）。
- **杂项**：Interfaces 返回值类型 `JSX.Element` → `ReactElement`；P5-5 修补 commit 按实际改动分包 scope。
