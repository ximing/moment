# 时刻 Moment — Web Field / Input / Textarea 组件设计规范

> 日期：2026-08-18
> 状态：视觉与交互方向已确认；待实现
> 上位规范：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)
> Button 规范：[`2026-08-18-web-button-design.md`](./2026-08-18-web-button-design.md)
> Modal 规范：[`2026-08-18-web-modal-dialog-sheet-design.md`](./2026-08-18-web-modal-dialog-sheet-design.md)
> 视觉参考：[`2026-08-18-web-field-direction-comparison.html`](../mocks/2026-08-18-web-field-direction-comparison.html)
> 可编辑源稿：[`fragment.html`](../mocks/2026-08-18-web-field-direction-comparison.fragment.html)

本文定义 `apps/web` 中 Field、Input、Textarea、Select、PasswordField 与 DateTimeField 的结构、视觉、状态、校验、跨端行为和 API。表单控件统一采用已确认的 B 方案“柔和色面”：默认无描边、无阴影，Focus 与 Error 通过状态环表达。

## 1. 设计目标

Field 的任务是让用户自然地写下内容、完成设置和理解问题，而不是把页面切成一格格后台表单。

1. 用柔和色面表达可输入区域，减少连续描边和横向分割。
2. Label 始终可见，让 Placeholder 只承担示例而不是字段名称。
3. 统一登录、创建链、邀请、设置、评论与发布编辑器的状态语言。
4. 错误出现得及时但不打断输入，并明确告诉用户如何修正。
5. 保留原生表单语义、自动填充、密码管理与移动键盘能力。

## 2. 组件家族

组件分成基础层与常用组合层。

### 2.1 基础层

| 组件               | 职责                                           | 不能承担                        |
| ------------------ | ---------------------------------------------- | ------------------------------- |
| `Field`            | Label、可选标记、Description、Error 与 ID 关联 | 不拥有业务校验和输入值          |
| `Input`            | 单行原生输入                                   | 不直接拼 Label、错误或任意装饰  |
| `Textarea`         | 多行原生输入                                   | 不承担发布器工具栏和媒体上传    |
| `Select`           | 单值选择及键盘行为                             | 不替代 Menu、Segment 或筛选胶囊 |
| `FieldDescription` | 提示、说明、字符计数的支持信息区               | 不显示业务级 Banner             |
| `FieldError`       | 当前字段的可操作错误信息                       | 不显示请求失败或全表单错误      |

### 2.2 组合层

| 组件            | 适用场景                                        |
| --------------- | ----------------------------------------------- |
| `TextField`     | 邮箱、昵称、链名称、邀请地址等单行字段          |
| `TextareaField` | 简介、补充说明和普通长文本                      |
| `PasswordField` | 密码输入与显示／隐藏                            |
| `SelectField`   | 带 Label、提示和错误的单选                      |
| `DateTimeField` | 日期与时间的复合输入，现有 HappenedAtField 归入 |

普通业务页面优先使用组合层。只有复合字段或专门场景才能手动组合基础层。

`ComposerTextarea`、`ReplyComposer`、`MediaPicker` 与 `FilePicker` 是场景组件：它们复用 Field Token 和状态，但不扩充基础 Textarea 的职责。

## 3. 解剖结构

```text
Label row：Label                               可选
Control：   [Prefix] Value / Placeholder [End action]
Support：   Description / Error                 Count
```

- 结构顺序固定为 Label → Control → Support。
- Label 始终显示，不允许用 Placeholder 替代。
- 必填是视觉默认，不显示红色星号；只有非必填业务字段在 Label 右侧显示“可选”。
- Description 与 Error 使用同一行位；出现 Error 时替换 Description，避免垂直堆叠和页面跳动。
- Character Count 位于 Support 右侧，不覆盖 Textarea 内容。
- Prefix、Suffix 与 End Action 都不是必选槽；同一字段最多一个主要尾部动作。

## 4. 视觉方向与 Token

### 4.1 色面

Field 使用专用组件 Token，实施时写入 `tokens.css`，再映射到 UI 组件。业务页面禁止写死色值。

| Token                 | 浅色       | 深色       | 用途                        |
| --------------------- | ---------- | ---------- | --------------------------- |
| `--field-bg`          | `#f0e9e4`  | `#1f1a17`  | 默认输入色面                |
| `--field-bg-hover`    | `#ebe2dc`  | `#231d1a`  | Hover                       |
| `--field-bg-disabled` | `#f3eeea`  | `#201c19`  | Disabled                    |
| `--field-placeholder` | `--muted`  | `--muted`  | Placeholder，保持 AA 可读性 |
| `--field-focus`       | `--focus`  | `--focus`  | Focus 环                    |
| `--field-danger`      | `--danger` | `--danger` | Error 环与错误文字          |

- 默认无边框、无阴影。
- Hover 只轻微改变底色，不上浮、不加投影。
- Focus 与 Error 环不占据布局空间。
- 浏览器 Autofill 必须重新映射到 `--field-bg`，不得残留突兀黄底或蓝底。

### 4.2 几何与排版

| Token                   | 值    | 用途                                  |
| ----------------------- | ----- | ------------------------------------- |
| `--field-h`             | 44px  | Input 与 Select 高度                  |
| `--field-radius`        | 13px  | 控件圆角                              |
| `--field-px`            | 14px  | 控件左右内边距                        |
| `--field-text-size`     | 16px  | 输入文字；避免 iOS Focus 自动缩放     |
| `--field-label-size`    | 14px  | Label                                 |
| `--field-support-size`  | 13px  | Description、Error、Count             |
| `--field-label-gap`     | 6px   | Label Row 到 Control                  |
| `--field-support-gap`   | 6px   | Control 到 Support                    |
| `--field-stack-gap`     | 18px  | 普通表单相邻 Field                    |
| `--field-stack-compact` | 14px  | 明确的紧凑字段组合                    |
| `--textarea-min-h`      | 112px | 普通 Textarea 最小高度                |
| `--field-icon-size`     | 16px  | Prefix、Suffix 与状态图标             |
| `--field-end-visual`    | 32px  | 尾部动作视觉尺寸                      |
| `--field-end-hit`       | 40px  | 尾部动作最小点击区；触控环境提升到 44 |
| `--field-ring-w`        | 2px   | Focus 与 Error 环                     |

`6 / 14 / 18px` 是 Field 内部光学校准 Token，不扩充页面布局间距档位。页面仍只使用上位规范的 4px 网格，不允许写散落的 `gap-[6px]`、`px-[14px]` 或 `space-y-[18px]`。

Label 使用 500 字重；输入文字 400；Support 文字 400。Placeholder 不使用斜体，不能比可读基线更浅。

## 5. 状态矩阵

| 状态          | 视觉                                | 行为                             |
| ------------- | ----------------------------------- | -------------------------------- |
| Default       | `--field-bg`，无描边                | 可输入                           |
| Hover         | `--field-bg-hover`                  | 只在支持 Hover 的设备出现        |
| Focus         | 2px `--focus` 环                    | 不改变尺寸与位置                 |
| Error         | 2px `--danger` 环 + 具体错误文案    | `aria-invalid=true`              |
| Focus + Error | Error 色优先，不叠加紫色            | 保留输入与修正                   |
| Disabled      | Disabled 色面与低对比文字           | 不可交互、不进入 Tab 顺序        |
| Readonly      | 更轻色面，文字保持可读              | 可以聚焦、选择和复制             |
| Async Loading | 尾部小型进度指示                    | 只锁定相关查询，不锁整个表单     |
| Autofill      | 恢复 Field 色面，文字与光标颜色正确 | 保留浏览器自动填充和密码管理能力 |

- Disabled 不通过简单降低整个 Field 的透明度处理，以免 Label 与现有值难以辨认。
- Readonly 只用于需要复制或参与表单语义的值；纯展示内容优先使用 Description / KeyValue，而不是假输入框。
- 不提供通用绿色 Success 状态。有效值不需要在长表单中逐项盖章。
- Loading、Clear 与 Password Toggle 不同时堆叠；组合组件决定唯一尾部动作。

## 6. 校验与错误

### 6.1 时机

1. 用户初次输入时不因为内容尚未完成而立即报错。
2. 字段 Blur 或表单 Submit 时开始显示错误。
3. 字段已经报错后，随用户继续输入实时更新；修正后立即移除。
4. Submit 失败后聚焦第一个错误字段，并滚动到键盘和固定 Footer 之外的可见位置。

### 6.2 文案

- 错误必须说明下一步：“请填写完整的邮箱地址”“密码至少需要 8 个字符”。
- 禁止只写“格式错误”“无效输入”“必填项”。
- 一个字段一次只显示最相关的一条错误，不罗列规则清单。
- 请求失败、权限变化与服务器异常放到表单 Banner 或页面反馈，不伪装成某个字段错误。
- Error 替换 Description；需要持续可见的重要业务说明放在字段组或表单正文中。

### 6.3 语义

- `label`、Control、Description 与 Error 必须通过稳定 ID 关联。
- Invalid 时设置 `aria-invalid="true"`，Error 进入 `aria-describedby`。
- 动态 Error 使用克制的 Live Region；不能在每次按键时重复播报整条表单。
- Character Count 只在接近硬上限时进入读屏提示。

## 7. 内部元素

### 7.1 Password

- PasswordField 在右侧提供眼睛 IconButton。
- 可访问名称随状态变化：“显示密码”／“隐藏密码”。
- 切换类型不能清空值、移动光标或触发表单校验。
- 密码管理器、粘贴和浏览器生成密码保持可用。

### 7.2 Clear

- 只用于搜索框与可快速撤销的短文本字段。
- 有值并处于交互状态时出现；移动端聚焦且有值时显示。
- 不作为所有 Input 的默认能力，不与 Password Toggle 同时出现。
- 清空后焦点保留在 Input。

### 7.3 Prefix、Suffix 与 End Action

- Prefix 只放有语义的 16px 图标或固定文本，例如搜索、网址前缀。
- 静态 Suffix 用于单位等不可点击信息；它必须与 End Action 的圆形点击面明显区分。
- 不放为了视觉平衡而存在的装饰图标。
- 一个 Field 最多一个主要 End Action，不能把输入框变成工具栏。

### 7.4 Textarea

- 普通 Textarea 最小高度 112px，不显示浏览器拖拽角。
- `minRows` 可以在受控范围调整最小高度，不能传任意像素高度。
- 普通表单可按内容增长到场景上限；超过后内部滚动。
- Character Count 位于 Support 右侧，只在存在明确 `maxLength` 时显示。
- Composer 的媒体、Tag、时间和发布快捷键归 `ComposerTextarea`，不进入基础组件。

### 7.5 日期时间与文件

- DateTimeField 共享 Field 的 Label、色面、状态和支持信息区。
- 桌面可以使用 Popover 日历；移动端可以使用适合平台的日期时间选择器。
- 现有 HappenedAtField 的日期语义和业务规则不变，只迁移外观与 Field 关联。
- 原生 File Input 不伪装成 TextField；上传由 MediaPicker / FilePicker 提供缩略图、进度、替换和错误。

## 8. API 契约

```tsx
<TextField
  label="链名称"
  name="name"
  isRequired
  description="家人会在时间线上看到这个名字"
  value={name}
  onChange={setName}
/>

<TextareaField
  label="一句话"
  name="description"
  isOptional
  minRows={4}
  maxLength={120}
/>

<PasswordField
  label="密码"
  name="password"
  isRequired
  autoComplete="current-password"
/>
```

- 不开放 `variant`：所有 Field 使用 B 方案。
- 不开放任意 `size`、`radius`、`shadow`、`tone` 或像素高度。
- `className` 只控制 Field 外部宽度和布局，不覆盖内部色面、圆角、高度、间距和状态。
- `isRequired` 负责原生语义与校验，但视觉不显示星号。
- `isOptional` 在 Label 右侧显示“可选”。业务表单字段必须明确必填或可选；搜索等工具型输入可以都不传。
- `isInvalid` 与 `errorMessage` 成对使用；仅有 Error 文案不能绕过 Invalid 状态。
- `description` 与 Error 自动共享支持信息区。
- 保留原生 `name`、`value`、`onChange`、`onBlur`、`ref`、`type`、`inputMode`、`autoComplete` 与 `enterKeyHint`。
- Field 不拥有表单数据或业务校验；它只接收状态并正确呈现。
- 底层行为优先使用现有 `react-aria-components` 的 TextField、Label、FieldError 与关联能力。

## 9. 跨端与键盘

- 桌面与移动端都保持 44px Control，不创建移动端缩小版。
- 移动端 Field 默认填满容器宽度，页面不得通过 viewport 设置阻止缩放。
- 组件默认不 `autoFocus`；Dialog、Sheet 或业务场景决定初始焦点。
- 使用正确的 `type`、`inputMode`、`autoComplete` 与 `enterKeyHint`：
  - 邮箱使用 `type=email` 与 `autocomplete=email`。
  - 验证码使用 `inputmode=numeric` 与 `autocomplete=one-time-code`。
  - 登录与注册密码分别使用正确的 `current-password`／`new-password`。
- 单行 Input 中 Enter 可以提交表单；Textarea 中 Enter 始终换行。
- `Ctrl / Cmd + Enter` 发布只属于 Composer，不进入通用 Textarea。
- Tab 顺序与视觉顺序一致；Escape 不清空字段。
- Select、DateTimeField 与 End Action 遵循各自原生或 React Aria 键盘模型。
- iOS 键盘弹出后，当前字段、错误和 Sheet Footer 必须仍可滚动到达。

## 10. 无障碍

- 所有业务字段都有可见 Label；不能只提供 `aria-label` 和 Placeholder。
- 输入文字至少 16px；普通文字对比度至少 4.5:1。
- Focus 环与相邻颜色的非文字对比度至少 3:1。
- Hover 不承载唯一信息；Error 同时有状态环与文字。
- Disabled 不进入 Tab 顺序；Readonly 可以聚焦和复制。
- IconButton 必须有动态可访问名称，SVG 本身标记为装饰。
- 页面不能关闭缩放、粘贴、自动填充或密码管理。
- Field 底色、状态环与支持信息过渡为 120–160ms；`prefers-reduced-motion` 下接近即时。

## 11. 文案规则

| 避免           | 使用                                 |
| -------------- | ------------------------------------ |
| 用户名         | 你的名字 / 链名称（按真实对象命名）  |
| 描述           | 一句话 / 简介                        |
| 请输入邮箱     | name@example.com（作为 Placeholder） |
| 格式错误       | 请填写完整的邮箱地址                 |
| 该字段为必填项 | 请输入链名称                         |
| 密码不符合要求 | 密码至少需要 8 个字符                |

- Label 使用名词或用户能理解的对象，不把完整指令塞进 Label。
- Description 解释用途、影响或限制，不重复 Label。
- Placeholder 提供格式示例或轻提示，输入后消失也不影响理解。
- “可选”统一放在 Label Row 右侧，不写进 Label 括号。

## 12. 场景映射

| 产品场景        | 目标组件                                |
| --------------- | --------------------------------------- |
| 登录 / 注册邮箱 | TextField + 正确 Autofill               |
| 登录 / 注册密码 | PasswordField                           |
| 创建链          | TextField + TextareaField               |
| 链设置          | TextField / TextareaField / SelectField |
| 邀请邮箱        | TextField，Blur 或 Submit 后校验        |
| 记下／编辑时刻  | ComposerTextarea + DateTimeField        |
| 评论 / 回应     | ReplyComposer，不缩小基础 Field 点击区  |
| 日期与时间      | DateTimeField（迁移 HappenedAtField）   |
| 图片与视频      | MediaPicker / FilePicker                |

## 13. 响应式与视觉验收

视觉验收至少覆盖：

1. 390px：16px 输入文字、44px 控件、移动键盘、长错误、Sheet Footer 可达。
2. 1024px：Dialog 与桌面 Sheet 中字段宽度、尾部动作和 Focus 环不被裁切。
3. 1440px / 1895px：字段不因大屏无限变宽，遵循表单容器宽度。
4. 浅色 / 深色：Default、Hover、Focus、Error、Disabled、Readonly、Autofill。
5. Input、Textarea、Select、Password、日期时间、字符计数。
6. 必填、可选、Description、Error 替换和首错聚焦。
7. Tab、Shift+Tab、Enter、Escape、Password Toggle 与 Clear。
8. Chrome / Safari Autofill、密码管理器、iOS Focus 不缩放。
9. `prefers-reduced-motion` 与 200% 页面缩放。

视觉参考稿中的 A 与 C 只用于方向对比，不进入组件系统。B“柔和色面”是唯一基础 Field 外观。

## 14. 当前实现迁移说明

- `apps/web/src/ui/Field.tsx`：从 Label 包装器 + 手写描边控件迁移为本规范的基础层与组合层。
- 登录、注册、创建链与链设置：移除页面私有高度、描边和“（可选）”Label 文案，改用 Field API。
- `compose/compose-panel` 与 `timeline/moment-sheet`：正文输入迁移到 ComposerTextarea，媒体 File Input 迁移到 MediaPicker；不直接套普通 Textarea。
- `apps/web/src/ui/HappenedAtField.tsx`：保留日期逻辑，迁移到 DateTimeField 结构和状态 Token。
- 评论 / 回应：迁移到 ReplyComposer，复用 Field Focus、Error 和输入排版。
- 页面内原生 `input / textarea / select` 逐项判断：业务字段迁移到组件家族，Confirm 输入与上传控件按专用场景处理。
- 本规范实施时同步更新 `tokens.css`、Tailwind 语义映射与 `.claude/rules/web-ui.md` 的控件高度和 Field 内部 Token 约束。

## 15. 非目标

- 本规范不实现组件，不改表单数据、API、DTO、权限、上传或日期语义。
- 不引入表单状态库，不规定 Zod 等业务校验方案。
- 不把 Search、Tag Picker、Combobox、Menu 或 Media Picker 强行抽成 Input Variant。
- 不开放页面自由选择描边、下划线、紧凑高度或自定义圆角。
- 不创建独立设计系统包或 Storybook。
