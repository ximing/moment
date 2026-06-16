# 时刻 Moment — Web Button 组件设计规范

> 日期：2026-08-18
> 状态：设计方向已确认；待用户复核书面规范
> 上位规范：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)
> 视觉参考：[`2026-08-18-web-button-direction-comparison.html`](../mocks/2026-08-18-web-button-direction-comparison.html)
> 可编辑源稿：[`fragment.html`](../mocks/2026-08-18-web-button-direction-comparison.fragment.html)

本文定义 `apps/web` 中 Button、ButtonLink 与 IconButton 的语义、轮廓、尺寸、状态、文案和组合方式。颜色、字体与页面基调以 Web C 端视觉规范为准；本文不创造第二套品牌语言。

## 1. 设计目标

Button 的任务是让用户明确知道“现在能做什么”和“做完会发生什么”。它不负责装饰页面，也不通过大量描边、阴影或等权排列制造功能感。

1. 用清楚的强调层级代替 B 端式按钮矩阵。
2. 同时支持 C 端亲和力与复杂任务场景的秩序。
3. 让轮廓、颜色、尺寸和状态各自表达单一维度，避免变体爆炸。
4. 保持触控舒适、键盘可见、文案可预期。

## 2. 组件家族

| 组件         | 用途                                     | 禁止替代                       |
| ------------ | ---------------------------------------- | ------------------------------ |
| `Button`     | 触发提交、保存、创建、确认等当前页动作   | 不承担导航语义                 |
| `ButtonLink` | 以按钮外观进入页面、下一步或外部目标     | 不用 `button` 包裹链接         |
| `IconButton` | 更多、关闭、添加媒体等空间明确的图标动作 | 不用于含糊或必须解释的核心动作 |

Tag、筛选项、Segment、状态胶囊、MenuItem 和文本链接不是 Button 变体，必须由各自组件表达。

## 3. 两个独立设计维度

Button 只允许通过 `variant` 表达语义层级，通过 `shape` 表达场景气质。两者不得合并成 `coralPill`、`outlineRounded` 一类组合名称。

### 3.1 Variant：动作层级

| Variant     | 外观                         | 使用场景                         |
| ----------- | ---------------------------- | -------------------------------- |
| `primary`   | 珊瑚动作色实心               | 一个操作组中的唯一主操作         |
| `secondary` | 约 7% 暖墨色面，无描边       | 需要实体点击面的次级操作         |
| `quiet`     | 透明背景，使用墨色或弱化文字 | 取消、返回、暂不处理等低强调操作 |
| `danger`    | 危险色实心                   | 最终且不可逆的确认动作           |

- 每个操作组最多一个实心高强调按钮。
- `secondary` 不使用描边，避免增加横线与分割感。
- Modal 的取消动作优先使用 `quiet`，不与主操作做成两个等权描边按钮。
- 删除入口、MenuItem 和危险区入口只使用危险色文字或低强调面；只有最终确认使用 `danger` 实心按钮。
- 页面不得为普通成功、信息或品牌分类新增绿、蓝、紫色 Button。

### 3.2 Shape：轮廓气质

| Shape      | 轮廓                   | 使用场景                                                             |
| ---------- | ---------------------- | -------------------------------------------------------------------- |
| `standard` | 11px 圆角，默认        | Modal、表单、设置、保存、删除确认、多按钮组合等任务型场景            |
| `pill`     | 完整胶囊，横向留白更宽 | “记下此刻”“记录第一刻”“接受邀请”等独立、积极、面向用户的短文案主行动 |

- `standard` 是默认值；页面不能只为“看起来更活泼”切换到 `pill`。
- 同一操作组中的实体按钮使用相同 Shape。
- `danger` 固定使用 `standard`，不把不可逆行为处理成轻快胶囊。
- IconButton 始终为圆形，不跟随 `shape`。
- Pill 只用于短、积极、独立的用户行动，不用于设置页工具操作或密集列表。

## 4. 解剖结构

```text
┌──────────────────────────────────────┐
│ [leading icon / spinner] Label [→]  │
└──────────────────────────────────────┘
```

- Leading icon：添加、上传、删除等带明确对象的动作。
- Trailing icon：只用于进入、下一步或外部跳转等方向动作。
- Spinner：Loading 时替换 Leading icon；没有 Leading icon 时占据同一图标槽。
- Label：必须始终存在；IconButton 除外。

禁止同时使用前后两个图标，禁止把状态 Badge、计数或下拉箭头随意塞进基础 Button。

## 5. 尺寸 Token

| Token                       | 值   | 用途                     |
| --------------------------- | ---- | ------------------------ |
| `--control-h`               | 40px | Standard Button 默认高度 |
| `--control-h-prominent`     | 44px | Pill 与触控主行动高度    |
| `--button-px`               | 16px | Standard 横向内边距      |
| `--button-pill-px`          | 20px | Pill 横向内边距          |
| `--button-radius`           | 11px | Standard 圆角            |
| `--button-icon-gap`         | 8px  | 图标与文字间距           |
| `--icon-button-size`        | 40px | 桌面 IconButton          |
| `--touch-control-min`       | 44px | 触控环境最小交互区域     |
| `--focus-ring-w`            | 2px  | 焦点环宽度               |
| `--focus-ring-offset`       | 2px  | 焦点环与控件间距         |
| `--button-pressed-scale`    | 0.98 | 按压反馈                 |
| `--button-disabled-opacity` | 0.42 | Disabled 整体透明度      |

不提供 32px 的小型实体 Button。紧凑操作改用 Quiet Button、MenuItem 或 IconButton；触控环境下 IconButton 提升到 44 × 44px。

## 6. 色彩与状态

- Primary：`--action / --action-fg`。
- Secondary：`color-mix(in srgb, var(--ink) 7%, transparent) / --ink`。
- Quiet：透明 / `--muted`，Hover 后提升至 `--ink`。
- Danger：`--danger / --danger-fg`。
- Focus：2px 紫色焦点环，Offset 2px。

按钮本身不使用阴影。所有 Variant 必须覆盖：

| 状态     | 视觉与行为                                              |
| -------- | ------------------------------------------------------- |
| Default  | 使用 Variant 与 Shape 的基础色面                        |
| Hover    | 色面加深约 6%；Quiet 出现轻色面；不位移、不加阴影       |
| Pressed  | 缩放至 98%，持续 160–180ms                              |
| Focus    | 2px 焦点环，与 Hover 可同时存在                         |
| Disabled | 透明度 42%，移除 Hover / Pressed，禁止点击              |
| Loading  | 保持原尺寸，显示 Spinner 和明确进行中文案，禁止重复触发 |

Loading 不等于 Disabled 的静态样式。组件保留进入 Loading 前的最小宽度，避免“创建”变为“创建中…”时操作区跳动。`prefers-reduced-motion` 下取消缩放，Spinner 保留识别操作进行中所需的最小运动。

## 7. 图标与文案

- 图标统一 16px，继承当前文字颜色。
- 普通文字 Button 最多一个图标；不为装饰性平衡添加图标。
- 添加、上传、删除等对象动作使用 Leading icon；箭头只用于进入或下一步。
- “记下此刻”可以使用右箭头；“保存”“取消”不需要图标。
- IconButton 必须提供可读的 `label`；SVG 标记为装饰。
- 桌面端对含义不够普遍的 IconButton 提供 Tooltip；移动端不能依赖 Hover 解释核心动作。

| 避免 | 使用                         |
| ---- | ---------------------------- |
| 确定 | 删除时刻 / 换成图片 / 退出   |
| 提交 | 发布 / 保存更改 / 发送回应   |
| OK   | 知道了                       |
| 继续 | 下一步 / 接受邀请 / 开始记录 |

- 中文文案优先 2–6 个字，不使用感叹号或模糊系统词。
- Modal 的最终按钮复述结果：标题“删除这条时刻？”，按钮“删除时刻”。
- Loading 文案保留动作：“创建中…”“发布中…”“删除中…”。
- Button 不截断文字；空间不足由操作组换行或切换响应式布局。

## 8. 操作组组合

### 8.1 独立情绪型行动

一个 Pill Primary 独立出现，例如“记下此刻”。周围不再放等权 Secondary，不通过阴影强化。

### 8.2 桌面 Modal

操作区右对齐，间距 8px：

```text
先不换（Quiet Standard）  换成图片（Primary Standard）
```

禁止两个描边按钮、两个实心按钮或等分铺满底部。

### 8.3 移动端 Dialog / Sheet

- 短文案且空间足够时保持内容宽度并右对齐。
- 空间不足时，Quiet 位于主按钮之前，Primary 可以全宽并放在操作流最后。
- 不做两个等宽的 50% 按钮。
- DOM 顺序必须与视觉和键盘顺序一致，禁止只用 CSS `order` 颠倒操作。

### 8.4 表单与设置

默认使用 Standard。桌面不把保存按钮拉满；登录、注册、邀请接受等单任务页面可以全宽。列表内操作优先 MenuItem、Quiet 或 IconButton，不为密度使用小实体按钮。

## 9. API 契约

```tsx
<Button
  variant="primary | secondary | quiet | danger"
  shape="standard | pill"
  loading={boolean}
  leadingIcon={Icon}
  trailingIcon={Icon}
>
  保存更改
</Button>

<ButtonLink to="/invite" variant="primary" shape="pill">
  接受邀请
</ButtonLink>

<IconButton icon={MoreHorizontal} label="更多操作" />
```

- `variant` 默认 `primary`，`shape` 默认 `standard`。
- `danger + pill` 是非法组合，应在类型层阻止，不允许运行时静默改形状。
- Button 原生 `type` 默认 `button`；表单提交必须显式传 `type="submit"`。
- ButtonLink 渲染链接语义并复用 Button 外观，不用链接嵌套按钮。
- `className` 只能承担宽度和外部对齐；不得覆盖高度、内边距、圆角、颜色、阴影和状态。
- 不提供任意 `color`、`radius`、`size` 或 `compact` 参数。
- 业务页面不得复制 Button 的内部 Tailwind 类。

## 10. 无障碍

- Button 使用原生 `button`；ButtonLink 使用原生链接或路由链接。
- IconButton 必须有可访问名称，不能只依靠 Tooltip。
- Loading 使用 `aria-busy="true"` 并阻止重复提交；状态变化由邻近 Live Region 或表单反馈表达。
- Focus Visible 始终可见。
- Disabled 原因放在相邻帮助或错误文本中，不把必要说明藏在 Tooltip。
- 颜色不是唯一状态信号：Disabled 同时改变交互，Loading 同时出现 Spinner 与文案。
- 点击区域满足桌面 40px、触控 44px 基线。

## 11. 使用与禁止示例

| 场景         | 正确                           | 禁止                       |
| ------------ | ------------------------------ | -------------------------- |
| 发布时刻     | 一个 Pill Primary“记下此刻”    | 三个等权操作、按钮阴影     |
| Modal        | Quiet 取消 + Standard Primary  | 两个描边按钮、两个全宽按钮 |
| 删除时刻入口 | Danger MenuItem 或危险色 Quiet | 入口即实心红色             |
| 最终删除确认 | Standard Danger“删除时刻”      | Pill Danger、“确定”        |
| 设置列表     | Quiet / IconButton / MenuItem  | 32px 小实体按钮矩阵        |
| 页面导航     | ButtonLink                     | `button` 内嵌 `a`          |
| Tag / 筛选   | 使用专用组件                   | 复用 Pill Button           |

## 12. 响应式与视觉验收

- 390px：文案不得溢出；操作组可以换行；触控目标至少 44px。
- 1024px：Modal 操作区保持内容宽度与清晰层级。
- 1440px / 1895px：Button 不随容器无意义变宽；独立行动保持内容宽度。
- 深色主题保持相同层级，不为所有 Button 增加边框。
- Secondary、Quiet 和普通文字在两种主题下达到 AA。

验收覆盖 Standard / Pill、四种 Variant、全状态、三类图标结构、桌面 Modal、移动端 Sheet、发布入口、登录全宽按钮、长文案、键盘操作与 Loading 防重复提交。

视觉参考稿中的 A 与 B 都是合法语言：A 对应 Standard，B 对应 Pill；C 的 6px 方形按钮不进入设计系统。

## 13. 当前实现迁移说明

现有 `apps/web/src/ui/Button.tsx` 包含 `primary / ghost / danger / quiet` 与 `md / sm`：

- `ghost` 根据语义拆到 Secondary 或 Quiet。
- `sm` 不再作为基础实体按钮尺寸；调用迁移到 Quiet、IconButton 或 MenuItem。
- `danger` 只保留最终确认；普通删除入口降为危险色 Quiet 或 MenuItem。
- 页面内手写的普通 `button` 逐项判断是否应迁移到 Button、IconButton、MenuItem 或业务专用控件。
- Modal、Menu 与 Field 的组合迁移等待各自组件规范完成，不在 Button 阶段提前改代码。

## 14. 非目标

- 本规范不实现 Button，不改业务逻辑或 API。
- 不创建独立设计系统包或 Storybook。
- 不定义 FAB、Tag、Segment、MenuItem、Tooltip 的完整视觉；它们由后续组件规范负责。
- 不通过新增大量 Props 兼容现有页面的任意样式。
