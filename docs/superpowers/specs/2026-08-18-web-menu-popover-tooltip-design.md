# 时刻 Moment — Web Menu / Popover / Tooltip 组件设计规范

> 日期：2026-08-18
> 状态：视觉与交互方向已确认；待实现
> 上位规范：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)
> Button 规范：[`2026-08-18-web-button-design.md`](./2026-08-18-web-button-design.md)
> Modal 规范：[`2026-08-18-web-modal-dialog-sheet-design.md`](./2026-08-18-web-modal-dialog-sheet-design.md)
> Field 规范：[`2026-08-18-web-field-input-design.md`](./2026-08-18-web-field-input-design.md)
> 视觉参考：[`2026-08-18-web-menu-action-sheet-directions.html`](../mocks/2026-08-18-web-menu-action-sheet-directions.html)
> 可编辑源稿：[`fragment.html`](../mocks/2026-08-18-web-menu-action-sheet-directions.fragment.html)

本文定义 `apps/web` 中 Menu、移动端 ActionSheet、ContextMenu、Popover 与 Tooltip 的职责、视觉、定位、状态、键盘和触控规则。方向采用已确认的 B 方案“柔和浮层”：真实浮层可以使用克制阴影，但不使用横向分割线、厚描边或卡片式动作矩阵。

## 1. 设计目标

浮层用于在不打断时间线阅读的前提下，提供就近命令、上下文内容和辅助解释。

1. 桌面命令靠近触发点，移动命令统一沉到底部，保持触控舒适。
2. 用职责边界区分 Menu、Popover 与 Tooltip，不再按外观混用。
3. 统一 Portal、定位、碰撞、Outside Click、焦点恢复和层级。
4. 用留白与状态色组织命令，不依赖横线、厚边框或多层卡片。
5. 保留 C 端轻盈感，同时覆盖键盘、读屏、触控与危险操作。

## 2. 组件边界

| 组件             | 用途                                         | 禁止场景                         |
| ---------------- | -------------------------------------------- | -------------------------------- |
| `ResponsiveMenu` | 一组立即执行的命令                           | 表单、长说明、图片、复杂状态     |
| `ActionSheet`    | ResponsiveMenu 的移动端承载面                | 发布编辑、长任务、业务直接调用   |
| `ContextMenu`    | 桌面右键或键盘快捷入口                       | 移动端唯一入口、触控长按唯一入口 |
| `Popover`        | 表情、成员信息、日期等锚定上下文内容         | 一组纯命令、最终确认、长任务     |
| `Tooltip`        | 解释图标或陌生控件的短纯文本                 | 操作、成员资料、错误、必要说明   |
| `FloatingLayer`  | Portal、定位、碰撞、层级与关闭策略的内部能力 | 业务直接引用或自定义新的浮层类型 |

- Menu 不做桌面级联子菜单。复杂路径进入页面、Dialog 或 Sheet。
- 一个 Menu 最多 6 个操作；超过后分组仍过长，则重新设计入口。
- 分组只使用 8–12px 留白与可选标题，不使用 MenuSeparator。
- Popover 不强制在移动端转 ActionSheet；它按内容类型选择锚定、平台 Picker 或专用底部 Picker。
- Tooltip 不支持点按常驻；需要触控访问的信息必须使用 Popover 或可见文字。

## 3. 响应式命令模型

`ResponsiveMenu` 对业务暴露一套命令集合，在不同视口提供两种确定形态：

```text
≥ 768px：Trigger → anchored Menu
< 768px：Trigger → modal ActionSheet
```

- 所有命令型 Menu 在移动端统一转为 ActionSheet，包括时刻 `···`、链设置、头像菜单和 ContextMenu 的可见替代入口。
- ActionSheet 是内容高度自适应的短命令面，不是发布编辑器使用的近全高 Sheet。
- 业务不读取视口宽度，也不分别维护桌面和移动命令。
- 响应式断点在打开期间变化时直接关闭当前浮层，不在屏幕中间变形。
- ContextMenu 仅保留桌面快捷方式；移动端必须有可见 `···` 或其它明确 Trigger 打开同一命令集合。

## 4. 解剖结构

### 4.1 桌面 Menu

```text
┌────────────────────────────────┐
│ [Icon] Label       [Count/Key] │
│ [Icon] Label       [Count/Key] │
│           8–12px group space   │
│ Group label                    │
│ [Icon] Danger action          │
└────────────────────────────────┘
```

### 4.2 移动 ActionSheet

```text
Scrim
┌────────────────────────────────┐
│ Optional title                 │
│ Optional object context        │
│ [Icon] Action                  │
│ [Icon] Danger entry            │
│                                │
│             取消               │
└────────────────────────────────┘ + Safe Area
```

- ActionSheet 始终有可访问名称。
- 对象型命令建议显示标题和上下文，例如“这条时刻”“周末小家 · simon”。
- “取消”是独立的最后点击区，通过 8px 留白区分，不画分割线。
- 同一 MenuGroup 内要么全部带图标，要么全部不带，保证 Label 左缘一致。

## 5. 视觉方向与 Token

### 5.1 色彩与深度

| Token                    | 浅色                                                | 深色                                                 | 用途                   |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------- | ---------------------- |
| `--floating-bg`          | `--surface`                                         | `--surface`                                          | Menu / Popover / Sheet |
| `--floating-hover`       | `color-mix(in srgb, var(--ink) 6%, transparent)`    | `color-mix(in srgb, var(--ink) 8%, transparent)`     | Hover                  |
| `--floating-pressed`     | `color-mix(in srgb, var(--ink) 9%, transparent)`    | `color-mix(in srgb, var(--ink) 12%, transparent)`    | Pressed                |
| `--floating-danger-soft` | `color-mix(in srgb, var(--danger) 7%, transparent)` | `color-mix(in srgb, var(--danger) 10%, transparent)` | Danger Hover / Pressed |
| `--floating-edge`        | `transparent`                                       | `color-mix(in srgb, var(--line) 70%, transparent)`   | 深色浮层边缘           |
| `--floating-shadow`      | `0 18px 48px rgb(43 32 28 / 18%)`                   | `0 18px 48px rgb(0 0 0 / 44%)`                       | Menu / Popover         |
| `--action-sheet-shadow`  | `0 -18px 48px rgb(43 32 28 / 18%)`                  | `0 -18px 48px rgb(0 0 0 / 44%)`                      | ActionSheet            |
| `--tooltip-bg`           | `--ink`                                             | `--ink`                                              | Tooltip 反相色面       |
| `--tooltip-fg`           | `--bg`                                              | `--bg`                                               | Tooltip 反相文字       |

- 浅色 Menu / Popover 默认无描边；深色主题允许 1px 低对比边缘。
- 浮层是允许使用阴影的真实层级；页面内容卡片继续禁用阴影。
- MenuItem 默认透明，不把每项做成卡片。视觉稿中的柔和色面表示 Hover / Focus 状态。
- 危险项默认只改变文字和图标颜色，不显示红底。

### 5.2 桌面 Menu 几何

| Token                 | 值    | 用途                |
| --------------------- | ----- | ------------------- |
| `--menu-min-w`        | 176px | 默认最小宽度        |
| `--menu-max-w`        | 280px | 最大宽度            |
| `--menu-radius`       | 18px  | Menu 圆角           |
| `--menu-padding`      | 6px   | Menu 内留白         |
| `--menu-offset`       | 8px   | Trigger 到 Menu     |
| `--menu-item-h`       | 42px  | MenuItem 最小高度   |
| `--menu-item-px`      | 12px  | MenuItem 水平内边距 |
| `--menu-item-radius`  | 12px  | MenuItem 圆角       |
| `--menu-icon-size`    | 16px  | 图标                |
| `--menu-icon-gap`     | 10px  | 图标与 Label        |
| `--menu-viewport-gap` | 8px   | 浮层与视口最小间距  |

- Label 使用 14px / 500。
- 普通 Menu 按内容宽度；侧栏头像菜单允许与 Trigger 区域等宽。
- 默认首选 `bottom end`，由定位系统根据可用空间自动 Flip / Shift。
- KebabButton 使用 Button 规范的 IconButton，桌面点击区至少 40px，触控环境至少 44px。

### 5.3 移动 ActionSheet 几何

| Token                        | 值                            | 用途       |
| ---------------------------- | ----------------------------- | ---------- |
| `--action-sheet-radius`      | `24px 24px 0 0`               | 顶部圆角   |
| `--action-sheet-padding`     | 12px                          | 内容内边距 |
| `--action-sheet-item-h`      | 48px                          | 操作项高度 |
| `--action-sheet-item-radius` | 13px                          | 操作项圆角 |
| `--action-sheet-cancel-gap`  | 8px                           | 操作与取消 |
| `--action-sheet-safe-bottom` | `env(safe-area-inset-bottom)` | 底部安全区 |

- 宽度 100%，底部贴合视口，不做四周悬浮卡片。
- 操作文案使用 16px / 500；上下文使用 13px / 400 muted。
- 底部 Padding 为基础值加 Safe Area。
- 不显示拖拽把手，不实现下滑关闭手势。
- 不把每个操作做成独立色块；Hover / Focus / Pressed 才出现柔和底色。

## 6. MenuItem 类型与状态

### 6.1 类型

| 组件             | 语义                       |
| ---------------- | -------------------------- |
| `MenuItem`       | 立即执行命令               |
| `MenuLinkItem`   | 使用链接语义进入页面       |
| `MenuGroup`      | 对相关操作分组             |
| `MenuGroupLabel` | 两个以上分组时的可选短标题 |

第一阶段不提供 Checkbox Menu、Radio Menu 和级联子菜单。选择型需求优先使用 Popover 内的 ListBox / Segment。

### 6.2 内容

- Icon 可选，固定 16px，继承当前状态颜色。
- Count 使用普通等宽数字，不做高饱和 Badge。
- 键盘快捷键只在桌面显示，移动 ActionSheet 隐藏。
- 不显示级联箭头；MenuLinkItem 也不为装饰添加箭头。
- Label 使用明确对象和结果：“编辑时刻”“删除时刻”“链设置”“退出登录”。
- 文案可以两行，但一个 Menu 出现多条两行内容时应升级为任务型页面或 Sheet。

### 6.3 状态矩阵

| 状态          | 视觉                           | 行为                   |
| ------------- | ------------------------------ | ---------------------- |
| Default       | 透明底，`--ink` 文字           | 可聚焦、可执行         |
| Hover         | 柔和中性色面                   | 不位移、不加额外阴影   |
| Pressed       | 比 Hover 略深                  | 保持尺寸               |
| Focus Visible | 柔和色面 + 2px `--focus` 环    | 键盘位置明确           |
| Danger        | `--danger` 文字与图标          | 默认无红底             |
| Danger Hover  | 约 7–10% 危险色柔和底          | 仍不直接执行不可逆结果 |
| Disabled      | 低对比文字，无 Hover / Pressed | 不执行                 |

- 无权限操作直接隐藏，不展示 Disabled。
- 只有用户需要知道操作存在但暂时不可用时才显示 Disabled；原因使用简短尾部文本并建立可访问关联。
- MenuItem 不显示 Loading。选择后关闭浮层，请求状态由目标页面、Toast、Dialog 或 Sheet 表达。
- 危险项放在当前组最后，但不使用分割线。
- “退出登录”可恢复，不按不可逆危险操作处理；可进入独立末尾分组，但保持普通文字。
- 最终删除、转让、撤销等操作仍由 AlertDialog 确认，ActionSheet 只提供入口。

## 7. Menu 与 ActionSheet 行为

### 7.1 打开和关闭

- 点击、Enter、Space 打开桌面 Menu。
- ArrowDown 从 Trigger 打开并聚焦首个可用操作。
- ArrowUp 从 Trigger 打开并聚焦最后一个可用操作。
- 点击浮层外、Escape 或 Trigger 滚出视口后关闭。
- Tab 离开 Menu 时关闭，不在非 Modal Menu 内制造焦点陷阱。
- 关闭后焦点返回 Trigger；链接导航例外由路由目标管理新焦点。

### 7.2 键盘

- 上下方向键循环移动；Home / End 跳到首尾。
- Enter / Space 执行当前项。
- 支持按文字快速定位，MenuItem 必须提供稳定 `textValue`。
- Focus Visible 始终使用紫色焦点环，不只依赖 Hover 底色。
- Trigger 自动拥有 `aria-haspopup="menu"`、`aria-expanded` 与关联关系。

### 7.3 移动 ActionSheet

- 打开后锁定页面滚动，背景进入 inert，内部使用 Modal 焦点约束。
- 键盘或读屏打开时初始聚焦首个非危险操作；不自动聚焦危险项。
- 点击 Scrim、“取消”、Escape 或 Android Back 均关闭。
- 选择普通命令后先关闭 ActionSheet，再执行导航或打开下一层 Dialog / Sheet。
- 危险入口先关闭 ActionSheet，再打开 AlertDialog。
- ActionSheet 与 AlertDialog 不同时保持两个可操作层。
- 第一阶段不实现下滑关闭，避免与页面滚动和 Safe Area 冲突。

### 7.4 ContextMenu

- 桌面支持右键与 `Shift + F10`，打开后复用 Menu 键盘模型。
- ContextMenu 只提供快捷路径，不能承载普通用户找不到的唯一操作。
- 移动端不依赖长按，使用可见 Trigger 打开相同命令的 ActionSheet。
- 不再渲染语义错误的“全屏透明关闭按钮”；Outside Click 由 Overlay 基础能力处理。

## 8. Popover

Popover 是锚定的上下文内容，不锁页面滚动，不让背景 inert。

### 8.1 基础视觉与行为

- 圆角 20px，使用 `--floating-bg`、`--floating-shadow` 与深色低对比边缘。
- Trigger Offset 8px，距视口边缘至少 8px。
- 自动 Flip / Shift；锚点滚出视口后关闭。
- 不使用指向 Trigger 的小三角箭头。
- 点击外部、Escape 或焦点离开完整交互区域后关闭。
- Interactive Popover 由键盘打开时焦点进入首个逻辑控件；纯信息 Popover 保持 Trigger 焦点并建立描述关系。
- Popover 内不再打开 Menu。进入下一任务前先关闭当前 Popover。
- 业务不直接传任意宽度、圆角、阴影和 Placement 组合新的 Popover 类型。

### 8.2 ReactionPopover

- 替代当前 ReactionBar 中借用的 Menu。
- 桌面与移动端都保持锚定，不转 ActionSheet。
- 使用紧凑 Emoji Grid；桌面点击区至少 40px，触控环境至少 44px。
- 打开后聚焦当前表情或第一个表情。
- 方向键按网格移动，Enter / Space 选择。
- 选择后立即关闭并将焦点返回表情入口。

### 8.3 MemberPopover

- 替代成员头像当前的 HoverTip。
- 展示姓名、角色等身份信息，最大宽度 240px。
- 桌面 Hover / Focus 延迟约 300ms 打开；指针移入 Popover 时保持。
- 桌面点击可以固定打开；移动端点击打开。
- 点击外部或 Escape 关闭。
- 若以后加入“查看成员”，只保留一个明确入口；命令增多时重新判断是否升级为其它表面。

### 8.4 DateTimePopover

- 桌面承载日期和时间复合选择，最大宽度约 420px。
- 内部使用 Dialog / Calendar 语义，视觉仍属于 Popover。
- 移动端优先平台日期时间选择器或专用底部 Picker，不把桌面日历塞进窄 Popover。
- 日期、时间与时区业务语义继续属于 DateTimeField。

## 9. Tooltip

- 只解释图标或陌生控件，不承载操作、成员资料、错误或必要信息。
- 内容为简短纯文本，建议不超过 20 个中文字符，最多两行。
- 桌面 Hover / Focus 延迟约 600ms 打开，离开或 Blur 后约 100ms 关闭。
- Escape 可以关闭；点击不固定。
- `pointer: coarse` 环境不展示 Tooltip。移动端依靠可见文案或可访问名称理解控件。
- IconButton 即使有 Tooltip，也必须有独立 `aria-label`。
- 禁止使用原生 `title` 属性，避免原生与设计系统提示重叠。
- 使用 `--tooltip-bg / --tooltip-fg` 反相色面。
- 圆角 9px，Padding 6px 9px，文字 12px / 400。
- 默认位于 Trigger 上方，自动 Flip；无箭头，仅使用极轻阴影。

## 10. 层级、Portal 与并存

| Token                  | 值  | 用途                    |
| ---------------------- | --- | ----------------------- |
| `--z-floating`         | 50  | 页面 Menu / Popover     |
| `--z-overlay`          | 60  | Modal / Dialog / Sheet  |
| `--z-overlay-floating` | 61  | Modal 内 Menu / Popover |
| `--z-tooltip`          | 62  | 当前交互层 Tooltip      |
| `--z-overlay-nested`   | 70  | 嵌套 AlertDialog        |
| `--z-lightbox`         | 80  | 独立媒体查看            |

- 所有浮层通过 Portal 渲染到当前 Overlay 容器。
- Modal 打开时关闭页面层已有的 Menu、Popover 与 Tooltip。
- 背景 Tooltip 不得穿过 Scrim。
- FloatingLayer 统一定位、碰撞、Outside Click、Dismiss 与焦点返回。
- ActionSheet 使用 Modal 行为层，但保持独立的短命令几何与 Menu 语义。

## 11. 动效

| 对象              | 动效                          | 时长  |
| ----------------- | ----------------------------- | ----- |
| Menu / Popover    | Opacity + 4px 位移 + 0.98 → 1 | 160ms |
| ActionSheet       | 从底部进入                    | 200ms |
| ActionSheet Scrim | Opacity                       | 160ms |
| Tooltip           | 仅淡入淡出                    | 100ms |

- Menu / Popover 的 Transform Origin 跟随实际 Placement。
- 不使用弹簧、回弹、循环或逐项动画。
- `prefers-reduced-motion` 下取消位移和缩放，只保留近乎即时显隐。

## 12. API 契约

### 12.1 ResponsiveMenu

```tsx
<ResponsiveMenu
  aria-label="这条时刻的操作"
  sheetTitle="这条时刻"
  sheetContext="周末小家 · simon"
  trigger={<IconButton icon={MoreHorizontal} label="更多操作" />}
  onAction={(key) => handleMomentAction(key)}
>
  <MenuItem id="edit" icon={Pencil} textValue="编辑时刻">
    编辑时刻
  </MenuItem>
  <MenuItem id="delete" icon={Trash2} textValue="删除时刻" tone="danger">
    删除时刻
  </MenuItem>
</ResponsiveMenu>
```

- 页面不再接收 `close()`；选择、关闭与焦点恢复由组件负责。
- 移动端 ActionSheet 由 ResponsiveMenu 内部切换，业务不自行判断视口。
- `ActionSheet` 与 `FloatingLayer` 是内部组件，业务不能直接引用。
- `MenuLinkItem` 使用链接语义，不用 Button 模拟导航。
- 不开放任意 `width`、`radius`、`shadow`、`offset` 或 `zIndex`。
- 侧栏等基础壳层可以通过受控语义参数请求 Trigger 等宽；普通业务不能传像素。
- 底层行为统一使用 `react-aria-components` 的 Menu、MenuTrigger、Popover、Dialog、Tooltip 与 Focus 管理能力。

### 12.2 场景 Popover

```tsx
<ReactionPopover
  trigger={<IconButton icon={Plus} label="加个表情" />}
  value={myReaction}
  onChange={onReact}
/>

<MemberPopover member={member}>
  <AvatarButton member={member} />
</MemberPopover>
```

- 业务优先使用 ReactionPopover、MemberPopover 与 DateTimeField。
- 新场景必须先判断它是 Menu、Tooltip、Dialog 还是确实需要新的场景 Popover。
- 基础 PopoverSurface 不作为页面通用容器。

### 12.3 Tooltip

```tsx
<Tooltip label="查看时间索引">
  <IconButton icon={CalendarDays} label="查看时间索引" />
</Tooltip>
```

- `label` 只接受纯文本。
- Tooltip 不替代 Trigger 的可访问名称。
- Placement 为内部自动决策，不开放页面像素偏移。

## 13. 无障碍

- Menu 使用 `role="menu"` / `menuitem` 与 React Aria Collection 键盘模型。
- ActionSheet 使用 Modal Dialog 行为包裹同一 Menu Collection，并有可访问标题。
- DOM 顺序与视觉顺序一致，不用 CSS `order` 调换危险项或取消项。
- Trigger、浮层与标题建立稳定关联；关闭后恢复 Trigger 焦点。
- Focus Visible 始终满足至少 3:1 非文字对比度。
- Danger 不只依赖颜色：文案必须明确对象和结果。
- Disabled 同时禁止执行，并以短文本提供原因。
- Tooltip 通过 Trigger 的描述关系呈现，不成为可聚焦元素。
- MemberPopover 等信息浮层在触控、键盘和读屏下都可到达。
- 200% 页面缩放时浮层必须 Flip / Shift，不被视口裁切。

## 14. 文案规则

| 避免 | 使用                         |
| ---- | ---------------------------- |
| 设置 | 链设置 / 通知设置            |
| 编辑 | 编辑时刻 / 编辑链资料        |
| 删除 | 删除时刻 / 删除整条链        |
| 退出 | 退出登录                     |
| 确定 | 删除时刻 / 撤销分享链接      |
| 更多 | Trigger 可访问名称“更多操作” |

- MenuItem 使用动词 + 对象，脱离页面上下文仍能理解。
- ActionSheet 标题命名当前对象，不写“操作菜单”。
- Tooltip 解释控件，不重复旁边已经可见的文字。
- 危险入口与 AlertDialog 最终按钮保持同一动词和对象。

## 15. 当前产品场景映射

| 当前场景            | 目标组件                              |
| ------------------- | ------------------------------------- |
| 时刻作者行 `···`    | ResponsiveMenu → 移动 ActionSheet     |
| 链页眉 `···`        | ResponsiveMenu → 移动 ActionSheet     |
| 顶栏 / 侧栏头像     | ResponsiveMenu；侧栏允许 Trigger 等宽 |
| 链导航右键          | ContextMenu + 可见链设置入口          |
| 加个表情            | ReactionPopover                       |
| 成员头像姓名 / 角色 | MemberPopover                         |
| 发生在日期时间      | DateTimePopover / 移动平台 Picker     |
| 不熟悉的 IconButton | Tooltip + 独立 aria-label             |

## 16. 当前实现迁移说明

- `apps/web/src/ui/Menu.tsx`：替换手写 open 状态、Window Keydown 和全屏透明关闭按钮，建立 ResponsiveMenu、MenuItem、MenuLinkItem、ContextMenu 与内部 ActionSheet。
- `apps/web/src/shell/user-menu.tsx`：移除侧栏私有浮层实现，复用 ResponsiveMenu；文案调整为“我的资料”“通知”“退出登录”。
- `apps/web/src/timeline/reaction-bar.tsx`：从 Menu 迁移到 ReactionPopover。
- `apps/web/src/ui/HoverTip.tsx`：由 MemberPopover 与真正 Tooltip 分工后删除。
- `apps/web/src/pages/chain-home/chain-audience.tsx`：成员头像迁移到 MemberPopover。
- `apps/web/src/ui/HappenedAtField.tsx`：保留日期逻辑，迁移到统一 Popover Token、层级和碰撞能力。
- `apps/web/src/shell/Shell.tsx`：ContextMenu 复用同一命令 Collection；移动端依靠可见入口，不增加长按依赖。
- 页面手写 `z-40 / z-50`、Outside Click、Escape 与 Placement 逐项迁移到 FloatingLayer。
- 实施时同步更新 `tokens.css`、Tailwind 语义映射和 `.claude/rules/web-ui.md`。

## 17. 响应式与视觉验收

视觉验收至少覆盖：

1. 390px：所有命令 Menu 转为底部 ActionSheet、Safe Area、Scrim、取消与长文案。
2. 767 / 768px：断点两侧形态正确，打开期间改变宽度会关闭。
3. 1024px：Menu 锚定、Flip / Shift、键盘与桌面 ContextMenu。
4. 1440 / 1895px：浮层保持内容宽度，不随大屏扩大。
5. 浅色 / 深色：边缘、阴影、Hover、Focus、Danger 与 Tooltip 反相色面。
6. 页面、Dialog、Sheet 内浮层层级；Modal 打开时清理背景 Tooltip。
7. Menu 1–6 项、两个分组、带图标、无图标、Count、Disabled 与长文案。
8. ReactionPopover、MemberPopover、DateTimePopover 与 Tooltip。
9. 鼠标、触控、Tab、方向键、Home / End、Enter、Space、Escape、Shift + F10。
10. 200% 缩放、`prefers-reduced-motion` 与 Trigger 滚出视口。

视觉参考中的 A 与 C 只用于方向对比，不进入组件系统。B“柔和浮层”是 Menu 和移动 ActionSheet 的唯一基础外观。

## 18. 非目标

- 本规范不实现组件，不修改业务 API、DTO、权限或日期语义。
- 不新增级联菜单、Checkbox Menu、Radio Menu、Command Palette 或触控长按菜单。
- 不把 Popover 当作任意内容容器，也不为业务开放自由 Placement 和几何 Props。
- 不在第一阶段实现 ActionSheet 下滑手势。
- 不把 Tooltip 当作移动端提示方案。
- 不创建独立设计系统包或 Storybook。
