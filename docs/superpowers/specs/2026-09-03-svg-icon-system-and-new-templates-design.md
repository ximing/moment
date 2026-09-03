# 时刻 Moment — SVG 图标系统与读书笔记/职业生涯模板 Design

> 日期：2026-09-03
> 状态：设计已与用户对齐，待实施
> 范围：packages/icons（新增）+ dto + server（一处列宽迁移）+ web + app
> 权威边界：模板 DSL 语义、manifest 结构、聚合视图与模板编辑规则以 `2026-08-20-chain-templates-design.md` 为准，本文只扩展 icon 取值约定并新增两个官方模板；链图标/用户头像的自由 emoji 语义以 `packages/dto/src/chains.ts` 的 `ChainIcon` 现状为准，**本文不动它**；web UI 规范以根 CLAUDE.md 列出的 C 端设计规范为准。

## 0. 产品决策（已与用户对齐）

- **新增两个官方模板**：`reading`（读书笔记）与 `career`（职业生涯），官方模板从三个扩到五个。
- **UI 中的 emoji 全面替换为自绘 SVG 图标系统**：风格为「彩色面性」（Fluent 风：柔和渐变、圆润饱满、无描边）。emoji 在不同平台字体下渲染不一致（iOS/Android/各浏览器观感漂移），自绘 SVG 让双端与时间线、聚合视图、分享页视觉完全统一。
- **画一次，双端一致**：`svg/*.svg` 是唯一画稿源，web 经 SVGR 生成 React 组件，app 经 react-native-svg-transformer import 同一份文件。
- **存量数据零迁移**：已入库的封闭 emoji 词表值（mood 5、reaction 10）继续以 emoji 存储与传输，只在渲染层经映射表换成 SVG；reaction 的通知去重键、计数分组、worker 推送文案逻辑一律不碰。
- **链图标与用户头像的自由 emoji 输入保持不变**：`ChainIcon` 允许任意单个 emoji（含 ZWJ/肤色序列），这是用户表达自由，不属于「UI chrome 的 emoji」，渲染走 AppIcon 的文本兜底分支，天然不受影响。
- **装饰性 emoji 换单色线性图标**：📍📅💬⚙️ 等 UI 装饰与 RN Tab 栏图标不属于彩色面性体系，web 用既有 lucide 封装，app 用 lucide path + react-native-svg 自绘单色。
- **通知链路保留 emoji 字符**：app 通知中心（`apps/app/src/features/notifications/index.tsx`）直接渲染通知 payload 的 body 文本（worker 生成的推送文案），其中的 reaction emoji 以系统字体显示——刻意保留，不改。理由：通知文案是纯文本（系统推送与通知中心共用同一份 worker 文案），拆出结构化 reaction 字段需要改通知 payload 契约与 worker 文案模板，收益仅是通知列表里一颗小图标；且把 emoji 换成 icon key 原文（如「给你的时刻点了 reaction-like」）反而更难读。重启条件：通知中心改版为富文本/结构化渲染时，reaction 位再接入 AppIcon。

## 1. 术语表

| 术语 | 含义 |
|---|---|
| 彩色面性图标 | 本项目的彩色 SVG 图标风格：柔和渐变填充、圆润饱满造型、无描边（Fluent Emoji 风），区别于 lucide 单色线性图标 |
| icon key | 图标注册表中一枚图标的唯一标识，小写 slug（如 `mood-joy`、`milestone-promotion`、`tpl-reading`），遵循与模板 key 相同的 `^[a-z][a-z0-9-]{0,49}$` 规范 |
| 图标注册表 | `packages/icons` 的 `manifest.ts`：icon key → `{ file, label, tone }` 的全集映射，是所有合法 icon key 的唯一真相源 |
| 封闭词表 | 取值集合固定的数据词表（mood 5 项、reaction 10 项、baby 里程碑 8 项、rating 4 档），与「自由 emoji」相对 |
| 自由 emoji | 用户任意输入的单个 emoji（链图标、用户头像），取值不封闭，不进图标注册表 |
| `EMOJI_TO_ICON` | dto 新增的 emoji → icon key 映射表，覆盖全部有存量的封闭 emoji 词表值 |
| AppIcon | web/app 各自的图标渲染组件，按「注册表 → 映射 → 原文兜底」三级规则渲染一个字符串值 |

## 2. 图标资产包 `packages/icons`（新增包）

### 2.1 包结构与消费方式

```
packages/icons/
  package.json        # name: @moment/icons，workspace 包
  svg/                # 唯一画稿源，一枚图标一个 .svg 文件
    mood-joy.svg
    ...
  src/
    manifest.ts       # 图标注册表：ICON_MANIFEST + IconKey 类型
    manifest.test.ts  # 注册表与 svg/ 目录 parity、与 dto EMOJI_TO_ICON parity
```

- **`svg/*.svg` 是唯一画稿源**，禁止在任何一端内联第二份 SVG 源码。
- `manifest.ts` 导出：

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
  // ……全集见 §2.3
} as const satisfies Record<string, IconManifestEntry>;
export type IconKey = keyof typeof ICON_MANIFEST;
export function hasIconKey(value: string): value is IconKey;
```

- **web 消费**：构建期用 `vite-plugin-svgr`（SVGR 的 Vite 集成）把 `svg/` import 为 React 组件，web 侧生成（或手写维护）`key → 组件` 索引，`AppIcon` 按 key 取组件；类型用 `vite-plugin-svgr/client`。
- **app 消费**：metro 配置 `react-native-svg-transformer`（`react-native-svg@15.12.1` 已是既有依赖），`import MoodJoy from '@moment/icons/svg/mood-joy.svg'` 直接得到组件，无需另存画稿；app 需手写 `*.svg` 模块的 TS 声明（`declarations.d.ts`）。
- 依赖方向：`@moment/icons` 不依赖任何端；parity 测试需要读 dto 的 `EMOJI_TO_ICON`，`@moment/icons` 以 devDependency 引 `@moment/dto`（dto 不反向依赖 icons，无环）。

**构建接入四个实施要点（P1 一次做对）：**

1. `@moment/icons` 的 package.json `exports` 必须包含 `./svg/*` 子路径（或干脆不声明 `exports`），否则双端无法 import svg 文件——app 侧已开启 `unstable_enablePackageExports`，exports 缺子路径会直接解析失败。
2. app 的 `metro.config.js` **是在既有自定义配置上叠加**（该文件已有 monorepo watchFolders / package exports / react 钉版逻辑）：追加 `transformer.babelTransformerPath = require.resolve('react-native-svg-transformer')`、`resolver.assetExts` 移除 `'svg'`、`resolver.sourceExts` 增加 `'svg'`，不得整体重写。
3. TS 声明分工：app 手写 `declare module '*.svg'`（组件类型为 `React.ComponentType<SvgProps>`）；web 在既有 `apps/web/src/env.d.ts` 追加 `vite-plugin-svgr/client` 引用。
4. web/app 各自 package.json 显式声明 `"@moment/icons": "workspace:*"` 依赖，使 icons 进入 pnpm build / turbo 拓扑（先构建依赖包再起 dev 的既有约定自动覆盖）。

### 2.2 画稿规范

- viewBox 统一 `0 0 32 32`，主体视觉留白 2px；彩色面性风格：柔和渐变（同色系两档以内）、圆润造型、无描边、无文字。
- 单文件体积目标 < 8KB（纯 path/渐变，不内嵌位图）；全包 40 枚预算 < 320KB，双端按 key 引用，web 端随 SVGR tree-shaking 只打包用到的图标。
- 同一词表内（如 reaction 10 枚）视觉成组：构图重心、主色明度一致。

### 2.3 icon key 全集词表（40 枚）

命名规范：`<集合>-<语义>`，集合前缀为 `mood` / `reaction` / `rating` / `milestone` / `tpl`。全集即 `ICON_MANIFEST` 的完整 key 集合，实现时逐枚按下表落 `svg/` 与注册表：

| icon key | label | 对应存量 emoji（无则「—」） | tone |
|---|---|---|---|
| `mood-joy` | 开心 | 😄 | amber |
| `mood-love` | 幸福 | 🥰 | rose |
| `mood-cry` | 难过 | 😭 | sky |
| `mood-angry` | 烦躁 | 😤 | rose |
| `mood-sleepy` | 困倦 | 😴 | purple |
| `reaction-like` | 点赞 | 👍 | sky |
| `reaction-love` | 爱心 | ❤️ | rose |
| `reaction-laugh` | 笑哭 | 😂 | amber |
| `reaction-wow` | 惊讶 | 😮 | amber |
| `reaction-sad` | 难过 | 😢 | sky |
| `reaction-celebrate` | 庆祝 | 🎉 | purple |
| `reaction-sweet` | 喜爱 | 🥰（与 `mood-love` 共用画稿，见 §3.1） | rose |
| `reaction-clap` | 鼓掌 | 👏 | amber |
| `reaction-strong` | 加油 | 💪 | green |
| `reaction-thanks` | 感谢 | 🙏 | amber |
| `rating-love` | 超爱 | — | rose |
| `rating-good` | 推荐 | — | amber |
| `rating-ok` | 一般 | — | neutral |
| `rating-pass` | 不推荐 | — | sky |
| `milestone-first-smile` | 第一次微笑 | 😊 | amber |
| `milestone-first-roll` | 第一次翻身 | 🔄 | green |
| `milestone-first-sit` | 第一次独坐 | 🪑 | sky |
| `milestone-first-crawl` | 第一次爬 | 🐾 | green |
| `milestone-first-stand` | 第一次站立 | 🧍 | purple |
| `milestone-first-steps` | 第一次走路 | 👣 | amber |
| `milestone-first-word` | 第一次开口 | 💬 | sky |
| `milestone-first-tooth` | 第一颗牙 | 🦷 | neutral |
| `milestone-join` | 入职 | — | green |
| `milestone-promotion` | 晋升 | — | rose |
| `milestone-transfer` | 转岗 | — | sky |
| `milestone-job-hop` | 跳槽 | — | purple |
| `milestone-leave` | 离职 | — | neutral |
| `milestone-award` | 获奖 | — | amber |
| `milestone-major-project` | 重大项目 | — | sky |
| `milestone-certification` | 职业认证 | — | green |
| `tpl-baby` | 宝宝成长 | 👶 | rose |
| `tpl-travel` | 旅行 | ✈️ | sky |
| `tpl-daily` | 日常生活 | 🏠 | amber |
| `tpl-reading` | 读书笔记 | — | green |
| `tpl-career` | 职业生涯 | — | purple |

- rating 4 枚为心形填充档位数列：从饱满红心（超爱）到空心/灰心（不推荐）递减。
- 词表只增不减；新增图标 = 加 svg + 注册表项 +（如属存量 emoji）补 `EMOJI_TO_ICON`。

## 3. 契约层：存量值不动，新值用语义 key

### 3.1 存量封闭词表：`EMOJI_TO_ICON` 渲染映射

dto 新增文件 `packages/dto/src/icons.ts`（加入 `src/index.ts` barrel，遵循「每业务域一文件」约定）：

```ts
/** 存量封闭 emoji 词表 → icon key。数据继续存 emoji，仅渲染层映射（spec §3.1）。 */
export const EMOJI_TO_ICON: Readonly<Record<string, string>> = {
  // daily 模板 mood（5）
  '😄': 'mood-joy',
  '🥰': 'mood-love',
  '😭': 'mood-cry',
  '😤': 'mood-angry',
  '😴': 'mood-sleepy',
  // reaction 白名单（REACTION_EMOJIS 共 10 项；🥰 已在上方 mood 区映射，此处不重复列，见下「🥰 冲突决策」）
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

**🥰 冲突决策**：🥰 同时在 mood 词表（幸福）与 reaction 白名单（喜爱）中。映射表是 emoji → 单一 key 的纯函数，无法按场景分叉；因此 `reaction-sweet` 在注册表中是 `mood-love` 的**别名**（指向同一 svg 文件、独立 label），`EMOJI_TO_ICON['🥰'] = 'mood-love'`。心情线与 reaction 条上同一 emoji 渲染同一画稿——这是刻意的一致，不是缺陷。

零迁移、零校验破坏的边界：

- mood 值仍散在 `moments.payload` JSON 里以 emoji 存储，server 校验逻辑（`momentFieldPayloadJsonSchema` 的 enum）不变。
- reaction 值仍按 `REACTION_EMOJIS` 白名单入库（`reactions.emoji` varchar(16)）；它同时进入应用层通知去重键（`notification.service` 按 payload.emoji 判重）与计数分组键，**不新增 key 形态、不改 worker 推送文案**。推送通知与 app 通知中心的文本中继续显示 emoji 字符（系统通知无法渲染自定义 SVG），这是刻意保留，取舍理由与重启条件见 §0。
- baby 里程碑 icon 本就不落库（moment 只存 `catalog_key`，渲染时从模板 manifest 解析 icon），seed 改写 manifest 后历史时刻渲染自动跟随，见 §3.3。

### 3.2 新值直接写 icon key

以下新事物的取值从一开始就是 icon key，不存在 emoji 存量：

- reading 模板 `rating` 字段的 4 档选项（`rating-love` / `rating-good` / `rating-ok` / `rating-pass`）——值直接入 `moments.payload`。
- career 模板 milestoneCatalog 8 项的 icon（`milestone-join` 等）。
- 全部 5 个官方模板的 `templates.icon`（`tpl-baby` / `tpl-travel` / `tpl-daily` / `tpl-reading` / `tpl-career`）。

**emoji-picker 字段类型语义泛化**：`emoji-picker` 从「选项是 emoji」泛化为「选项是单选图形标记（emoji 或 icon key）」。词表不加新字段类型：值校验仍是字符串 enum（`momentFieldPayloadJsonSchema` 逻辑不变），渲染走 AppIcon。这是 reading 模板 `rating` 字段复用 `emoji-picker` 的依据。

### 3.3 唯一 DB 变更与 meta-schema 放宽

- `templates.icon`：`varchar(8)` → `varchar(50)`（ALTER COLUMN MODIFY，drizzle-kit 生成迁移，与代码同批部署）。50 与 icon key 规范 `^[a-z][a-z0-9-]{0,49}$` 的最大长度对齐；现存 emoji 值（≤8）自然兼容。
- `manifestJsonSchema` 的 `milestoneCatalog[].icon`：`maxLength: 8` → `maxLength: 50`。
- dto 模板 CRUD 输入校验同步放宽：`createTemplateInputSchema.icon` 与 `updateTemplateInputSchema.icon` 的 `.max(8)` → `.max(50)`。「icon 从词表选、禁止 URL」的语义保留，词表定义从「单个 emoji / 短符号」扩为「单个 emoji / 短符号 / icon key」。
- 官方模板 seed（`apps/server/src/templates/official-templates.seed.ts`）**代码零改动**：`OFFICIAL_TEMPLATES` 是唯一数据源，icon 与 manifest 列本就在 `onDuplicateKeyUpdate` 的 upsert 集合里，dto 常量变更后 migrate/resetDb 自动把 DB 行改写成 key 形态。official 模板演进不 bump `version`（沿用 seed 现状与模板 spec §3.4「official 增量编辑由 dto 侧人工保证」）。
- baby 模板 milestoneCatalog 的 icon 从 emoji 换成 key，属于官方模板的增量安全变更：存量 moment 只存 `catalog_key`，`AggregateMilestoneItem.icon`（类型 `string | null`，不变）在查询时从当前 manifest 解析，历史时刻渲染自动跟随新图标。

### 3.4 契约改动点逐条清单

| 文件 | 改什么 |
|---|---|
| `packages/icons/`（新包） | 见 §2：svg 画稿 + `manifest.ts` 注册表 + parity 测试 |
| `packages/dto/src/icons.ts`（新文件） | `EMOJI_TO_ICON` 映射表（§3.1），加入 `src/index.ts` barrel |
| `packages/dto/src/templates.ts` | ① `manifestJsonSchema` 的 `milestoneCatalog[].icon` maxLength 8→50；② `OfficialTemplate.key` 联合类型加 `'reading' \| 'career'`；③ `OFFICIAL_TEMPLATES` 三模板 `icon` 换 `tpl-*` key、baby 的 `milestoneCatalog[].icon` 换 `milestone-first-*` key；④ 新增 reading/career 两份完整 manifest（§5）；⑤ `createTemplateInputSchema`/`updateTemplateInputSchema` 的 icon max 8→50 |
| `apps/server/src/db/schema/templates.ts` | `icon` 列 `varchar(8)` → `varchar(50)`，drizzle-kit 产出迁移 |
| `apps/server/src/templates/official-templates.seed.ts` | 不改代码（upsert 集合已覆盖 icon/manifest） |
| `packages/dto/src/comments.ts` | **不改**：`REACTION_EMOJIS` 白名单、reaction 入库值、去重键/分组语义全部保持 |
| `packages/dto/src/chains.ts` | **不改**：`ChainIcon` 自由 emoji 语义保持 |
| worker / notifications | **不改**：reaction 推送文案继续显示 emoji 字符 |
| 聚合端点 | **不改契约**：`AggregateMilestoneItem.icon` 类型已是 `string \| null`；值形态从 emoji 变为 icon key 由渲染层 AppIcon 吸收 |

**配套实现改动（非 API 契约，但属本 spec 范围，随 P5 交付）：**

| 文件 | 改什么 |
|---|---|
| `apps/web/src/lib/template.ts` | `summarizePayload` 泛化（§5 设计要点）：分派条件从 `kind === 'milestone'` 改为按 payload 形态——含 `catalog_key`/`custom_label` 走 `resolveMilestoneLabel`；含 `topic` 走主题摘要 |
| `apps/app/src/lib/template.ts` | 同上，与 web 保持同一规则 |
| `apps/server/src/llm/recap/input.ts` | recap 的 `summarizePayload` 同步泛化：payload 含 `catalog_key`/`custom_label` 的 kind 一律走目录解析（前缀取该 kind 在 manifest 中的 label，career-event → 【职业事件】，milestone → 【里程碑】保持现状）；新增 `reflection` 摘要分支（【思考】+ topic） |
| `apps/web/src/compose/compose-panel/compose-panel.service.ts`、`apps/app/src/features/compose/compose.service.ts` | **不改代码**：无正文 kind moment 的 content 兜底调用点不变，泛化在 lib 内生效 |

### 3.5 兼容性小结

- 服务端旧数据（mood emoji、reaction emoji、user 模板 emoji icon）全部原样可用，渲染经映射或兜底。
- 客户端旧版本读新数据：唯一新值形态是 icon key 字符串。旧客户端会把它当普通文本渲染（如读书笔记的 `rating-love` 原文），属可接受退化；web/app 同批发版，不做旧客户端适配。
- API 无新增端点、无破坏性字段变更；`Chain`/`Moment` DTO 结构不变。

## 4. 渲染层：AppIcon 三级解析规则

### 4.1 解析规则（双端一致）

```
AppIcon(value, size):
  1. value ∈ 图标注册表（hasIconKey）        → 渲染对应 SVG，无障碍文本取注册表 label
  2. value ∈ EMOJI_TO_ICON                   → 渲染映射目标的 SVG，无障碍文本取映射目标 label
  3. 都不中                                   → 原文本兜底渲染（web <span> / app <Text>，字号 ≈ size）
```

- 自由 emoji 的链图标（`ChainMark.tsx`、`Avatar.tsx`）与用户自建模板的 emoji icon 天然落第 3 分支，**行为与现状一致**。
- AppIcon 不吞未知值、不报错——兜底就是设计的一部分（用户表达自由优先）。

### 4.2 web 实现与替换点

- 新组件 `apps/web/src/ui/AppIcon.tsx`（与既有 `ui/Icon.tsx` 单色封装并列：Icon = lucide 单色，AppIcon = 彩色面性/emoji 值渲染）。
- 替换点（emoji 值渲染一律改走 AppIcon）：
  - 模板选择器：`shell/create-chain-dialog`（模板卡片 icon）
  - 发布器：`compose/template-fields.tsx`（mood emoji-picker 选项、里程碑目录 chips、reading 的 rating 选项）
  - 聚合视图：`chain/aggregate-views.tsx`（moodline 心情点、milestone-axis 节点 icon）
  - 表情：`timeline/reaction-bar.tsx`（表情条）与 `ui/popover/Popover.tsx` 的 `ReactionPopover`（十格选择面板）
  - 时刻摘要：`timeline/moment-sheet.tsx`（mood/里程碑摘要位）
  - 分享页：`pages/share-album` 等只读渲染复用上述组件的自动跟随；个别直接渲染 emoji 文本的散点逐一改走 AppIcon
- `ChainMark.tsx`、`Avatar.tsx` 包一层 AppIcon 调用（自由 emoji 走兜底，视觉不变，但此后若链图标词表扩展可无缝升级）。

### 4.3 app 实现与替换点

- 新组件 `apps/app/src/components/AppIcon.tsx`，metro 配置 `react-native-svg-transformer` 后按 key import 同一份 svg。
- 替换点与 web 对称：`features/chains-new`（模板选择）、`features/compose/template-fields.tsx`（mood/里程碑/rating）、`features/chain-home/aggregate-views.tsx`（moodline/milestone-axis）、`components/MomentCard.tsx` 与 `features/moment/index.tsx`（reaction 条与时刻摘要）。

### 4.4 装饰 emoji 清扫（非数据值，静态替换）

装饰 emoji 是写死在 UI chrome 里的字符（📍📅💬⚙️ 等），不是数据值，**不经 EMOJI_TO_ICON**，逐处静态替换为单色线性图标：

- web：用既有 `src/ui/Icon.tsx`（lucide）封装替换，颜色/尺寸遵循 C 端设计规范。
- app：新建 `src/components/Icon.tsx`——以 lucide 图标的 24×24 path 数据为源（内联常量，不引入运行时图标库），用既有 react-native-svg 渲染单色；Tab 栏（`app/(tabs)/_layout.tsx`）的 emoji 文本图标一并替换。
- 判定口径：渲染「用户数据里的字符串」用 AppIcon；渲染「代码里写死的装饰字符」用单色 Icon。两者不混用。

## 5. 两个新官方模板（完整 manifest）

以下 TS 常量加入 `OFFICIAL_TEMPLATES`（`packages/dto/src/templates.ts`），均通过 `manifestJsonSchema` 校验（kind/field/catalog key 符合 slug 规范，icon ≤ 50）：

```ts
{
  key: 'reading',
  name: '读书笔记',
  description: '记录在读的书与读后心得，给每本书一个推荐度',
  icon: 'tpl-reading',
  manifest: {
    version: 1,
    momentFields: [
      { key: 'book', type: 'text', label: '在读的书' },
      {
        key: 'rating',
        type: 'emoji-picker',
        label: '推荐度',
        options: ['rating-love', 'rating-good', 'rating-ok', 'rating-pass'],
      },
    ],
    // 无 kinds、无 views、无 chainPayloadSchema
  },
},
{
  key: 'career',
  name: '职业生涯',
  description: '职业事件轨迹与阶段性思考，见证职业成长',
  icon: 'tpl-career',
  manifest: {
    version: 1,
    kinds: [
      {
        key: 'career-event',
        label: '职业事件',
        payloadSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            catalog_key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,49}$' },
            custom_label: { type: 'string', minLength: 1, maxLength: 50 },
            note: { type: 'string', maxLength: 500 },
          },
          anyOf: [{ required: ['catalog_key'] }, { required: ['custom_label'] }],
        },
        publisher: { entry: 'button', label: '记一个职业事件' },
      },
      {
        key: 'reflection',
        label: '思考',
        payloadSchema: {
          type: 'object',
          required: ['topic'],
          additionalProperties: false,
          properties: {
            topic: { type: 'string', minLength: 1, maxLength: 50 },
            decision: { type: 'string', maxLength: 500 },
            next_step: { type: 'string', maxLength: 500 },
          },
        },
        publisher: { entry: 'button', label: '记一条思考' },
      },
    ],
    views: [
      { type: 'milestone-axis', label: '职业轨迹', source: { kind: 'career-event' } },
    ],
    milestoneCatalog: [
      { key: 'join', label: '入职', icon: 'milestone-join' },
      { key: 'promotion', label: '晋升', icon: 'milestone-promotion' },
      { key: 'transfer', label: '转岗', icon: 'milestone-transfer' },
      { key: 'job-hop', label: '跳槽', icon: 'milestone-job-hop' },
      { key: 'leave', label: '离职', icon: 'milestone-leave' },
      { key: 'award', label: '获奖', icon: 'milestone-award' },
      { key: 'major-project', label: '重大项目', icon: 'milestone-major-project' },
      { key: 'certification', label: '职业认证', icon: 'milestone-certification' },
    ],
  },
},
```

设计要点：

- `career-event` 的 payloadSchema 与 baby `milestone` 完全同构（`catalog_key`/`custom_label` 二选一 + `note` ≤ 500），payload 校验路径零新代码；但**摘要路径需要泛化，不是零改动**：
  - 现状：`summarizePayload` 硬编码 `kind === 'milestone'` 才走里程碑目录解析——`apps/web/src/lib/template.ts`、`apps/app/src/lib/template.ts`、`apps/server/src/llm/recap/input.ts` 三处各自实现。kind moment 无正文时的发布链路依赖它兜底填 `content`（web `compose-panel.service.ts`、app `compose.service.ts`：text 类型 `content` 空且 kind 非 standard 时以摘要作正文），而 dto 对 text moment 强制 `content` 非空（`CONTENT_REQUIRED`）。career-event 的 payload 含 `catalog_key` 但 kind 不是 `milestone`，摘要落兜底返回 `''`，无正文的职业事件会被「选一项或写一句，再发布」/ server `CONTENT_REQUIRED` 拦截。
  - 修法：`summarizePayload` 三端同步泛化，分派条件从 kind 名改为 payload 形态——**payload 含 `catalog_key` 或 `custom_label` 的 kind 一律走里程碑目录解析**（career-event 与 milestone 同路径）；**payload 含 `topic` 走主题摘要**（reflection 摘要 = topic，它同样是必填字段，可无正文发布）。server recap 版的前缀取该 kind 在 manifest 中的 label（milestone → 【里程碑】保持现状，career-event → 【职业事件】，reflection → 【思考】）。metric 分支与未知 payload 返回 `''` 的兜底不变。
- `reflection` 只有 `topic` 必填（1–50 字），`decision`（决策/结论）与 `next_step`（下一步行动）可选（≤500）；不出现在任何聚合视图，按普通结构化时刻在时间线展示。
- reading 无聚合视图：读书是低频记录，「推荐度分布」之类投影价值不抵复杂度；重启条件：出现「我的书架/年度读书统计」的真实诉求。
- 里程碑 icon 不落库：career 里程碑 moment 只存 `catalog_key`，渲染时从 manifest 解析 icon key，经 AppIcon 命中注册表出 SVG。

## 6. 落地分期

| 期 | 范围 | 出口标准 |
|---|---|---|
| P1 | `packages/icons` 基建（包、注册表、SVGR/transformer 接入，含 §2.1 四个实施要点）+ 首批画稿 32 枚（mood 5 + reaction 10 + rating 4 + tpl 5 + baby 里程碑 8）+ 双端 AppIcon 组件 + dto `EMOJI_TO_ICON` | 注册表项 ↔ svg 目录 parity（每个注册表项的 `file` 指向的文件存在）与 EMOJI_TO_ICON parity 测试通过；双端 AppIcon 三分支单测通过 |
| P2 | 官方三模板图标化：`OFFICIAL_TEMPLATES` 的 icon 与 baby catalog icon 换 key + `templates.icon` 列宽迁移 + dto 三处 maxLength 放宽 | 迁移与代码同批部署；migrate 后 DB 中三模板 icon 为 `tpl-*`；模板选择器渲染 SVG；存量链/时刻渲染回归通过 |
| P3 | reaction / mood 渲染切换：reaction-bar、ReactionPopover、moodline、mood 选择器、moment 摘要改走 AppIcon（双端） | 契约零改动（`comments.ts` diff 为空）；reaction 去重键/分组/推送既有测试不改动全部通过 |
| P4 | 装饰 emoji 清扫：web 换 lucide 封装，app 新建单色 Icon 组件并替换 Tab 栏 | 双端源码中 UI chrome 不再含装饰 emoji（数据默认值与测试夹具除外） |
| P5 | 新增 reading / career 模板：dto 常量 + `OfficialTemplate.key` 联合扩展 + career 里程碑画稿 8 枚 + **`summarizePayload` 三端泛化（§5，含 reflection 摘要分支）** + 双端渲染验证 + dto 注释同步清扫（`TemplateDto.key` 注释的官方 slug 列举补 reading/career、`createTemplateInputSchema` icon 注释语义从「单个 emoji/短符号」更新为含 icon key） | 模板列表出现 5 个官方模板；建链→发 career-event/reflection（含无正文、摘要兜底场景）/带 rating 的读书笔记→「职业轨迹」轴渲染 SVG；注册表全集 40 枚计数断言通过 |

P1→P2→P3 顺序固定（P2 依赖注册表与列宽，P3 依赖 AppIcon）；P4 与 P3 可并行；P5 依赖 P1（rating 画稿）与 P2（列宽）。

## 7. 测试策略

- `packages/icons`：每个注册表项的 `file` 指向的 svg 文件存在（parity；**不要求 key 与文件一一对应**，兼容 `reaction-sweet` 共用 `mood-love.svg` 的别名形态）；`EMOJI_TO_ICON` 全部值 ∈ 注册表（parity）；40 枚全集计数断言在 P5 随 career 画稿交付时加入（P1 只跑前两项）。
- dto：`templates.test.ts` 更新——5 份官方 manifest 过 `manifestJsonSchema`；icon maxLength 50 边界（51 拒收）；rating 字段经 `momentFieldPayloadJsonSchema` 派生 enum 校验。
- server：迁移后 `templates.icon` 列宽 50；seed 幂等且把旧 emoji icon 改写为 key；带 icon key 的 user 模板可建（>8 字符不再 400）。
- 摘要泛化（P5）：三端 `summarizePayload` 单测——career-event 含 catalog_key/custom_label 出目录 label、reflection 出 topic、baby milestone 摘要回归不变、metric 分支不变；发布链路回归——无正文 career-event/reflection 以摘要兜底通过 `CONTENT_REQUIRED`（正反例）；server recap input 对 career-event/reflection 出【职业事件】/【思考】前缀。
- 回归：reaction 全流程（入库/去重/分组/推送文案）既有测试零改动通过；含 emoji mood 的存量 moment 校验与渲染不变。
- web/app：AppIcon 三分支单测（命中注册表 / 命中映射 / 原文兜底含 ZWJ 自由 emoji）；替换点快照或组件测试更新。

## 8. 验收标准（整体）

1. 双端时间线、聚合视图、reaction 条、模板选择器中不再出现系统字体渲染的词表 emoji，全部为彩色面性 SVG；视觉双端一致。
2. 链图标/用户头像的自由 emoji（含 ZWJ/肤色序列）输入与渲染与现状完全一致。
3. 数据库中 mood/reaction 值与既有行零变更；通知去重、计数分组、推送文案行为不变。
4. 官方模板 5 个：baby/travel/daily 图标化无损迁移，reading/career 可按 §5 manifest 全流程使用（建链、发布——含无正文 career-event/reflection 以摘要兜底发布、聚合、分享页只读）。
5. `pnpm build` / `pnpm test` / `pnpm lint` 全绿。

## 9. 演进路径

| 假设 | 演进触发 |
|---|---|
| 词表图标 40 枚覆盖当前需求 | 新模板/新 reaction 需要新图标：词表只增不减，加 svg + 注册表项即可，双端自动可用 |
| 自由 emoji 链图标长期走兜底 | 若未来想给链图标也提供图标选择器：在 ChainMark 上游加选择 UI，AppIcon 已天然支持 |
| 彩色面性一套风格 | 若引入暗色适配变体：注册表 `tone` 字段已预留扩展位，svg 内可用 currentColor/媒体查询演进 |
