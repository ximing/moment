# 时刻 Moment — App（RN）设计 Token 与主题体系设计规范

> 日期：2026-08-20
> 状态：草稿；待用户复核书面规范后实施
> 对齐蓝本：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)、[`2026-08-18-web-button-design.md`](./2026-08-18-web-button-design.md)、[`2026-08-18-web-field-input-design.md`](./2026-08-18-web-field-input-design.md)、[`2026-08-18-web-feedback-design.md`](./2026-08-18-web-feedback-design.md)、[`2026-08-18-web-modal-dialog-sheet-design.md`](./2026-08-18-web-modal-dialog-sheet-design.md)、[`2026-08-18-web-menu-popover-tooltip-design.md`](./2026-08-18-web-menu-popover-tooltip-design.md)
> Token 取值来源：[`apps/web/src/styles/tokens.css`](../../../apps/web/src/styles/tokens.css)

本文定义 `apps/app`（Expo React Native）的视觉 Token 层、主题基建与基础组件升级方案。语义层与 Web 设计体系同源——同一套 ink / surface / action / danger 语义；取值与落地形态按 RN 平台能力调整，不照搬 CSS 机制。本文不创造第二套品牌语言。

## 1. 背景与范围

### 1.1 现状

`apps/app/src` 目前没有任何主题基建，全部样式为组件内 `StyleSheet.create` 硬编码：

- 18 个源文件散落 hex 字面量约 100 处；频次最高的是 `#fff`（23）、主蓝 `#4a90d9`（18）、灰 `#999`（17）、危险红 `#d33`（14），另有 `#aaa / #ddd / #888 / #444 / #f6f6f6 / #f2f2f2 / #eee / #222` 等一次性灰色。
- 主蓝 `#4a90d9`、危险红 `#d33` 与 Web 已批准规范（珊瑚 `--action #c94a3a`、`--danger #b83a30`）不一致，两端已不是同一产品气质。
- 8 个薄组件（`Screen / Field / Loading / ErrorText / MomentCard / MediaGrid / SegmentBar / RequireAuth`）各自写死颜色与尺寸；11 个 feature 页面同样内联硬编码。
- 无深色主题；系统切深色后界面保持浅色硬编码值。

### 1.2 范围

- 建立 `apps/app/src/theme/` Token 层与 `useTheme()` hook。
- 升级 8 个现有薄组件消费 theme；新增 Button 组件（见 §4）。
- 制定分页迁移策略与验收门禁（§5、§6）。

### 1.3 非目标

- 不动任何业务逻辑、rab 三层分层、Service 与路由结构；纯 UI 层工作。
- 不引入 NativeWind / Unistyles / tamagui 等第三方样式库（评估记录见 §7，推荐零依赖）。
- 不重写页面布局、不做大规模组件重构；迁移是「换值不换结构」的渐进收敛。
- 不实现 Toast / Banner / Dialog / Menu / Empty 等 Web 已有组件族的 RN 对应物（Button 除外）；它们在各自后续 spec 中定义。
- 不做视觉回归基建；验收走 lint + tsc + 模拟器手测（§6）。
- 不改变媒体管线、推送、深链接等任何既有偏好。

## 2. 设计目标

1. **语义同源**：App 与 Web 消费同一套语义命名（ink / muted / surface / action / danger / select / tag…），两端看起来是同一个产品。
2. **单一真相源**：`src/theme/tokens.ts` 是唯一允许出现 hex 字面量的文件；组件与页面只消费语义 token。
3. **深浅双主题一次到位**：跟随系统 `Appearance`，不为后续补深色留二次审计的债（理由见 §3.4）。
4. **贴合现状、渐进迁移**：保留 `StyleSheet.create` 心智与薄组件形态，不引入新范式；页面可逐页收敛。
5. **零新增依赖**：只用 RN 内置 `useColorScheme` 与现有 Expo 依赖。

## 3. Theme 设计

### 3.1 目录结构

```text
apps/app/src/theme/
  tokens.ts      # 色板（light/dark）+ 共享几何/字号/动效常量；唯一含 hex 的文件
  theme.ts       # Theme 类型与 themes: { light, dark } 组装
  use-theme.ts   # useTheme() hook
```

`theme/` 是纯 UI 层：不进 Service、不进 `src/lib/` 的业务逻辑、不被 `app/*.tsx` 薄壳以外的 Service 感知。

### 3.2 tokens.ts：语义 Token 与取值映射

取值从 `apps/web/src/styles/tokens.css` **浅色主题**实值映射；`color-mix()` 在 RN 不存在，一律预计算为静态 `rgba()` 字面量（mix 到 `transparent` 的保留 alpha 通道，mix 到 `surface` 的取两主题下的实算值）。

#### 基础色彩

| App token（camelCase） | Web token | 浅色值 | 深色值 |
| --- | --- | --- | --- |
| `bg` | `--bg` | `#f6f1ec` | `#171412` |
| `surface` | `--surface` | `#fffdfb` | `#26211e` |
| `ink` | `--ink` | `#2b201c` | `#f7efe9` |
| `muted` | `--muted` | `#6f5d54` | `#c3b5ad` |
| `line` | `--line` | `#d8c9c0` | `#463c37` |
| `stroke` | `--stroke` | `#b79989` | `#76675f` |
| `action` | `--action` | `#c94a3a` | `#ff755e` |
| `actionFg` | `--action-fg` | `#fffdfb` | `#241714` |
| `select` | `--select` | `#f2b84b` | `#f2b84b` |
| `selectFg` | `--select-fg` | `#2b201c` | `#2b201c` |
| `date` | `--date` | `#ded4ff` | `#433b5e` |
| `tag` | `--tag` | `#4b7562` | `#87c2a5` |
| `focus` | `--focus` | `#7656d8` | `#b59cff` |
| `danger` | `--danger` | `#b83a30` | `#ff8a72` |
| `dangerFg` | `--danger-fg` | `#fffdfb` | `#2b201c` |
| `dotPink / dotBlue / dotMint / dotPurple` | `--dot-*` | `#ff7aa2 / #5aa7d6 / #4cbe8a / #9b8fd0` | `#ff9bb8 / #86c4e4 / #78d4a8 / #c0b0e8` |

#### Field / 浮层 / 反馈色彩

| App token | Web 来源 | 浅色值 | 深色值 |
| --- | --- | --- | --- |
| `fieldBg` | `--field-bg` | `#f0e9e4` | `#1f1a17` |
| `fieldBgDisabled` | `--field-bg-disabled` | `#f3eeea` | `#201c19` |
| `scrim` | `--scrim` | `rgba(43,32,28,0.36)` | `rgba(0,0,0,0.58)` |
| `hoverSoft` | `--floating-hover`（ink 6%） | `rgba(43,32,28,0.06)` | `rgba(247,239,233,0.08)` |
| `pressedSoft` | `--floating-pressed`（ink 9%） | `rgba(43,32,28,0.09)` | `rgba(247,239,233,0.12)` |
| `secondaryBg` | Button §6 secondary（ink 7%） | `rgba(43,32,28,0.07)` | `rgba(247,239,233,0.08)`（沿用深色 hover 8% 档） |
| `dangerSoft` | `--floating-danger-soft`（danger 7%） | `rgba(184,58,48,0.07)` | `rgba(255,138,114,0.10)` |
| `feedbackErrorBg` | danger 10% mix surface | 实算 `#f5e4e1`（实现时以脚本/手算校准） | 实算（深色 surface 基底） |
| `feedbackSkeleton` | ink 7% | `rgba(43,32,28,0.07)` | `rgba(247,239,233,0.07)` |

> 实施时 mix 到 `surface` 的值用一次性脚本算出实值写死，并在 tokens.ts 注释标注来源算式，禁止运行时换算。

#### 间距 / 圆角 / 控件几何 / 字号（两主题共享）

| App token | Web 来源 | 值 | 用途 |
| --- | --- | --- | --- |
| `space1..space8` | `--space-*` | `4 / 8 / 12 / 16 / 20 / 24 / 32` | 页面与组件间距只许用这些档 |
| `radiusMd / radiusLg` | `--radius-md / lg` | `14 / 20` | 内容色面 |
| `buttonRadius` | `--button-radius` | `11` | 实体按钮 |
| `fieldRadius` | `--field-radius` | `13` | 输入框 |
| `controlH / controlHProminent` | `--control-h(-prominent)` | `40 / 44` | 按钮高度 |
| `fieldH` | `--field-h` | `44` | 输入框高度 |
| `touchMin` | `--touch-control-min` | `44` | 一切可交互元素最小命中区（对齐 Apple HIG） |
| `buttonPx / buttonPillPx` | `--button-px / --button-pill-px` | `16 / 20` | 按钮横向内边距 |
| `pressedScale` | `--button-pressed-scale` | `0.98` | 按压反馈 |
| `disabledOpacity` | `--button-disabled-opacity` | `0.42` | 禁用态 |
| `fontCaption / fontSupport / fontLabel / fontBody / fontInput` | `--field-support-size` 等 | `12 / 13 / 14 / 15 / 16` | 字号全集；`fontInput` 16 对齐 web 输入字号 |
| `easeMs / easeInMs` | `--ease / --ease-in` | `180 / 120` | RN `Animated` / `LayoutAnimation` 时长 |

不做：阴影 token（RN 阴影分平台，需要时由各组件 spec 单独定义）、z-index token（RN 无层叠上下文问题，浮层用 `Modal`）、focus ring（RN 无键盘焦点环等价物；无障碍改走 `accessibility*` props）。

### 3.3 useTheme() hook

```ts
// src/theme/use-theme.ts
export function useTheme(): Theme {
  const scheme = useColorScheme(); // RN 内置，跟随系统 Appearance
  return scheme === 'dark' ? themes.dark : themes.light;
}
```

- **无 Provider、无 Context**：主题 = 系统外观的纯函数，不属于业务态，不违反「禁止 React Context 管业务态」约束；也避免在 `_layout.tsx` 加一层包裹。未来若做应用内「跟随系统 / 浅色 / 深色」三档设置，再引入一个纯 UI 的 ThemeProvider（挂账，见 §7）。
- `expo-status-bar` 的 `style` 同步按 scheme 切换。
- `app.config.ts` 的 `userInterfaceStyle` 保持/设为 `automatic`（实施时确认）。

组件消费范式（保留 StyleSheet 心智，仅把静态表换成 theme 工厂）：

```tsx
export function MomentCard(...) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  ...
}
const createStyles = (t: Theme) => StyleSheet.create({
  card: { padding: t.space4, borderBottomColor: t.line, backgroundColor: t.surface },
  ...
});
```

- `createStyles` 为模块级纯函数；`useMemo` 以 theme 引用为依赖，theme 对象本身稳定（模块级常量），切主题时才重建。
- 静态、与 theme 无关的布局样式可继续留在模块级 `StyleSheet.create`，不要求一刀切。

### 3.4 深色主题：本轮做（推荐）

推荐同轮交付深色，而非挂账：

1. **边际成本极低**：web dark 色值已在 tokens.css 全部定义，映射表照抄即可；`useColorScheme` 是 RN 内置能力，无新依赖、无架构改动。
2. **后补代价高**：若先只迁浅色，之后补深色要重新审计每个页面的语义配对是否正确（`#fff` 到底该是 `surface` 还是 `bg`），等于做两遍。
3. **语义映射天然双主题**：本轮的核心产出就是「hex → 语义名」的映射，语义名一旦正确，深色是免费副产品。
4. web 端 dark 已上线，app 不做反而两端不一致。

## 4. 基础组件升级

### 4.1 现有 8 薄组件的消费改造

| 组件 | 现状硬编码 | 迁移语义 |
| --- | --- | --- |
| `Screen` | `#fff` 底 | `bg`；scroll padding/gap 走 `space4 / space3` |
| `Field` | `#ddd` 描边、`#fafafa` 底、`#aaa` 占位、`#555` 标签 | 对齐 web Field spec：无底框描边改 `fieldBg` 色面 + focus 时 `focus` 2px 描边；占位 `muted`；标签 `fontLabel` + `muted`；危险态 `danger`；高 `fieldH`、圆角 `fieldRadius` |
| `Loading` | 默认色 | `ActivityIndicator color={t.action}`，容器 `bg` |
| `ErrorText` | `#d33` | `danger` + `fontSupport` |
| `MomentCard` | `#eee` 分割线、`#999` 时间、`#4a90d9` tag | 分割线 `line`、时间/计数 `muted`、tag 文字 `tag`（`#4b7562`，对齐 web 正文 Tag 色）、卡底 `surface`、正文 `ink` |
| `MediaGrid` | `#eee` 占位、`#222` 视频底 | 占位 `feedbackSkeleton`；视频底 `ink`、其上文字 `bg`/`muted` 反色档 |
| `SegmentBar` | `#4a90d9` 选中实心 | 选中态用 `ink` 色面 + `bg` 文字（中性、不抢主动作）；未选中 `hoverSoft` 面 + `muted` 文字（选中态方案见 §6 决策点 5） |
| `RequireAuth` | 无样式 | 不变 |

### 4.2 新增组件：Button（本轮唯一新组件族）

对齐 web Button spec §3/§5/§6 的状态语义，RN 化裁剪：

```tsx
<Button
  variant="primary | secondary | quiet | danger"  // 默认 primary
  shape="standard | pill"                          // 默认 standard；danger+pill 类型层禁止
  loading={boolean}
  disabled={boolean}
  fullWidth={boolean}                              // 登录/注册/接受邀请等单任务页
  onPress={...}
>
  记下此刻
</Button>
```

- 色彩状态映射 web：primary = `action/actionFg`；secondary = `secondaryBg/ink`；quiet = 透明/`muted`（pressed 出现 `hoverSoft`）；danger = `danger/dangerFg`。
- 几何：高 `controlH`（pill 与全宽主行动用 `controlHProminent` 44）、圆角 `buttonRadius`、横 padding `buttonPx`/`buttonPillPx`、命中区不足 `touchMin` 时以 `hitSlop` 补齐。
- 状态：pressed 用 `Pressable` 态改透明度/色面（RN 无 hover；不做 scale 动画，避免每按钮带 Animated 开销——若做则用 `pressedScale 0.98`，列为 §6 决策点 6）；disabled 整体 `disabledOpacity` 且禁点；loading 显示 `ActivityIndicator` + 进行中文案（「发布中…」），保持原宽、禁止重复触发。
- 与 web 相同的组合纪律：一个操作组最多一个实心高强调按钮；删除入口只用危险色 quiet，最终确认才用 danger 实心；pill 只用于短、积极、独立主行动。
- 不提供 `color` / `size` / `compact` 等自由 props；`style` 只允许承担宽度与外部对齐。

IconButton、ButtonLink 本轮不做：RN 无链接语义，导航直接用 expo-router；图标策略未定（§6 决策点 7），空间明确的图标动作暂用 quiet Button + 文字/emoji。

### 4.3 不引入的组件

Toast / Banner / Empty / Dialog / Menu / Skeleton：web feedback 与 overlay spec 的 RN 对应物各自需要独立的交互与动画设计（RN `Modal`、手势、安全区），不属于「换值」范畴，各自后续立 spec。现有 `Alert.alert` 调用保持原样。

## 5. 迁移策略

### 5.1 顺序（每步独立可合入）

1. **Task 1 — theme 基建**：`src/theme/` 三文件 + `_layout.tsx` 的 StatusBar 联动；不改任何组件视觉。
2. **Task 2 — Button + 8 薄组件**：新 Button 落地；薄组件全部改消费 theme。
3. **Task 3 — 认证与单任务页**：login / register / invite / chains-new（表单密集，吃 Field + Button 红利最大）。
4. **Task 4 — 主时间线**：feed / chain-home / moment / compose / memories（MomentCard、SegmentBar 的消费方）。
5. **Task 5 — 剩余页面**：chains / chain-settings / me / notifications。
6. **Task 6 — 门禁收尾**：开启 §5.2 的 grep 门禁，清掉豁免清单外的残留。

每 Task 一个 commit（`feat(app): ...`），页面迁移只换样式值与组件调用，不动 Service、不动事件、不动路由。

### 5.2 验收门禁

- **grep 门禁**（写入 `apps/app/CLAUDE.md` 与 lint 脚本，作为收尾标准）：
  `grep -rnE "#[0-9a-fA-F]{3,8}\b" apps/app/src` 除 `src/theme/tokens.ts` 外必须为零命中；`rgba(` 字面量同理只允许在 tokens.ts。
- 可选加强：eslint `no-restricted-syntax` 禁 `StyleSheet.create` 内的 hex 字面量——推荐先用 grep 门禁（简单、无规则维护成本），eslint 规则列为 §6 决策点 9。
- 组件与页面禁止新增不进 token 表的一次性尺寸；间距只用 `space1..space8` 档。

### 5.3 验证方式

- `pnpm --filter @moment/app lint` 与 `pnpm --filter @moment/app typecheck` 全绿。
- 模拟器手测清单（浅色 + 深色各一遍）：登录/注册、feed 列表、时刻详情、compose 发布、链设置、通知；重点看 pressed/disabled/loading 三态与系统外观切换的实时响应。

## 6. 决策点清单（待拍板，均附推荐）

| # | 决策点 | 选项 | 推荐 |
| --- | --- | --- | --- |
| 1 | 深色主题范围 | A. 本轮同做　B. 只做浅色挂账 | **A**。增量成本≈照抄映射表，后补要二次审计全部语义配对；与 web 两端一致 |
| 2 | 是否引入 Button 族 | A. 本轮做（primary/secondary/quiet/danger + loading/disabled）　B. 只迁 token，按钮下轮 | **A**。按钮是表单页最大痛点，且语义直接照抄 web Button spec，设计成本已付过 |
| 3 | 样式方案 | A. 零依赖 JS theme 对象 + StyleSheet 工厂　B. NativeWind　C. Unistyles | **A**。babel/metro 零侵入；团队已有 token 心智；B/C 的编译链复杂度对「换值」目标不成比例 |
| 4 | 触控目标 | A. 44pt（HIG + web `--touch-control-min`）　B. 40pt | **A**。RN 是纯触控环境 |
| 5 | SegmentBar 选中态 | A. `ink` 色面 + `bg` 文字　B. `action` 实心　C. `select` 色面 | **A**。中性、不抢页面唯一主动作；web 无 Segment 规范，B 违反「一组一个实心高强调」，C 的琥珀色做大面积底偏跳 |
| 6 | pressed 反馈 | A. 透明度/色面变化（零动画开销）　B. 统一 0.98 scale（每按钮带 Animated） | **A**。列表内按钮多，scale 动画收益小开销实在；后续如需要再统一加 |
| 7 | 图标策略 | A. 维持 emoji/文本符号现状　B. 引入 lucide-react-native（需 react-native-svg 依赖） | **A 本轮**。B 涉及原生依赖与包体积，与 IconButton 一起在后续 spec 评估 |
| 8 | 应用内主题三档设置 | A. 只跟随系统　B. 加「跟随系统/浅色/深色」设置 | **A 本轮**。设置项涉及持久化与 UI 落点，挂账 |
| 9 | 门禁形态 | A. grep 门禁 + CLAUDE.md 约定　B. 再加 eslint no-restricted-syntax | **A**。零维护成本；B 的收益在 grep 已归零后边际 |
| 10 | `#4a90d9` 主蓝去留 | A. 全部退出，tag 用 `tag` 绿、选中用 `ink`　B. 保留为品牌蓝进 token | **A**。web 规范无此蓝，保留即第二套品牌语言 |

## 7. 附：第三方样式库评估记录（决策点 3 的依据）

- **NativeWind**：需要 babel preset + metro 配置 + Tailwind 编译链；核心卖点是 className 写法与媒体查询，RN 端我们用不到后者；tokens 仍需自行维护一份 JS 版。对「消灭硬编码」目标属于用编译链换一个写法偏好。
- **Unistyles**：C++ JSI 绑定、主题能力完整，但引入原生构建依赖与新范式（`StyleSheet.create` 签名变化），与「贴合现状、渐进迁移」冲突。
- **JS theme 对象（推荐）**：`useColorScheme` + 模块级常量 + `useMemo` 工厂即可覆盖双主题、类型安全（`Theme` 类型约束所有消费）、零依赖；重构面就是现状的 `StyleSheet.create` 平移。
