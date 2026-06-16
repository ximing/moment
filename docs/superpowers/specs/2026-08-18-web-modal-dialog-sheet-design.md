# 时刻 Moment — Web Modal / Dialog / Sheet 组件设计规范

> 日期：2026-08-18
> 状态：设计方向已确认；待用户复核书面规范
> 上位规范：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)
> Button 规范：[`2026-08-18-web-button-design.md`](./2026-08-18-web-button-design.md)
> 视觉参考：[`2026-08-18-web-modal-surface-comparison.html`](../mocks/2026-08-18-web-modal-surface-comparison.html)
> 可编辑源稿：[`fragment.html`](../mocks/2026-08-18-web-modal-surface-comparison.fragment.html)

本文定义 `apps/web` 中 Modal 行为层，以及 Dialog、AlertDialog、Sheet 与 Lightbox 的职责、几何、层级、关闭策略、滚动、动效和无障碍规则。它不改变发布、编辑、删除、媒体或权限业务语义。

## 1. 设计目标

浮层用于暂时把注意力从时间线移到一个明确任务，同时尽可能保留用户对“我从哪里来”的感知。

1. 不把所有浮层都处理成居中白盒。
2. 长任务保留页面上下文，短任务保持集中。
3. 层级依靠遮罩、空间和浮层阴影，不依靠内部横线。
4. 统一焦点、滚动锁、关闭原因和层级，停止页面手写遮罩。
5. 防止误触丢失记录，同时不引入草稿持久化。

## 2. 组件分类

`Modal` 是统一的行为层，不是可被业务直接选择的外观组件。业务使用以下明确组件：

| 组件          | 形态                           | 适用场景                       | 禁止场景                     |
| ------------- | ------------------------------ | ------------------------------ | ---------------------------- |
| `Dialog`      | 居中有限面板                   | 创建链、简短表单               | 长表单、时间索引、发布编辑器 |
| `AlertDialog` | 居中小确认面板                 | 放弃草稿、删除、转让、撤销     | 普通信息展示、长内容         |
| `Sheet`       | 桌面右侧悬浮、移动端底部近全高 | 记下／编辑时刻、移动端时间索引 | 单句确认、轻提示             |
| `Lightbox`    | 全视口媒体查看                 | 图片、视频浏览                 | 普通表单、确认               |

Popover、Menu、Tooltip 不属于 Modal 家族；它们不锁定页面滚动，也不使整个页面 inert。

## 3. 当前产品场景映射

| 现有场景                     | 目标组件                   | 原因                           |
| ---------------------------- | -------------------------- | ------------------------------ |
| 创建链                       | Dialog                     | 有限字段、任务明确             |
| 记下／编辑时刻               | Sheet                      | 内容较长，需要保留时间线所在感 |
| 替换图片或视频               | AlertDialog，叠在 Sheet 上 | 对当前草稿的二级确认           |
| 删除时刻                     | AlertDialog                | 最终不可逆操作                 |
| 撤销分享链接、转让链、删除链 | AlertDialog                | 需要明确结果或输入确认         |
| 移动端时间索引               | Sheet                      | 上下文工具，不适合居中弹窗     |
| 图片与视频查看               | Lightbox                   | 沉浸式媒体任务                 |

桌面时间索引保持页面右侧 Rail，不为了复用 Sheet 而改成抽屉。

## 4. 层级与嵌套

允许的最大层级为：

```text
页面 → Dialog / Sheet → AlertDialog
```

- 只允许一层 Dialog 或 Sheet。
- 允许其上再出现一层 AlertDialog，例如替换媒体或放弃草稿。
- 禁止 Dialog 中再套普通 Dialog，禁止 Sheet 中再开第二个 Sheet。
- 子 AlertDialog 打开时冻结父浮层；关闭后焦点返回父浮层中的触发点。
- Lightbox 是独立查看模式，不与普通 Modal 同时叠加。
- Popover 可以在 Dialog / Sheet 内使用，但必须渲染在当前浮层之上、AlertDialog 之下。

建议层级 Token：

| Token                 | 值  | 用途                        |
| --------------------- | --- | --------------------------- |
| `--z-overlay`         | 60  | Dialog / Sheet 与基础遮罩   |
| `--z-overlay-popover` | 61  | 当前浮层内的 Popover / Menu |
| `--z-overlay-nested`  | 70  | 子 AlertDialog              |
| `--z-lightbox`        | 80  | 独立媒体查看                |

业务页面不得继续写任意 `z-40 / z-50` 竞争层级。

## 5. 几何 Token

| Token                      | 值            | 用途                         |
| -------------------------- | ------------- | ---------------------------- |
| `--dialog-w`               | 480px         | Form Dialog 最大宽度         |
| `--alert-dialog-w`         | 400px         | AlertDialog 最大宽度         |
| `--sheet-w`                | 520px         | 桌面 Sheet 宽度              |
| `--overlay-radius`         | 24px          | Dialog 与桌面悬浮 Sheet 圆角 |
| `--sheet-mobile-radius`    | 24px 24px 0 0 | 移动端 Sheet 圆角            |
| `--overlay-gap`            | 12px          | 桌面 Sheet 与视口距离        |
| `--sheet-mobile-top-gap`   | 10px          | 移动端 Sheet 顶部呼吸区      |
| `--overlay-padding`        | 24px          | 桌面内容内边距               |
| `--overlay-padding-mobile` | 20px          | 移动端内容内边距             |
| `--overlay-action-gap`     | 8px           | Footer 操作间距              |

### 5.1 Dialog

- Form Dialog 宽度为 `min(480px, calc(100vw - 32px))`。
- AlertDialog 宽度为 `min(400px, calc(100vw - 32px))`。
- Dialog 内容超过约 `70dvh` 时，不增加 Large Dialog，场景应升级为 Sheet。
- AlertDialog 原则上不出现内部滚动；文案必须足够短。

### 5.2 桌面 Sheet

- `min-width: 768px` 时从右侧进入。
- 宽度为 `min(520px, calc(100vw - 24px))`。
- 距顶部、右侧、底部各 12px，四角 24px。
- 不贴边做传统后台 Drawer；悬浮间距是本产品的 C 端识别细节。

### 5.3 移动端 Sheet

- `< 768px` 时从底部进入。
- 宽度 100%，高度最多为 `calc(100dvh - 10px)`。
- 底部贴合视口与 Safe Area，只保留顶部圆角。
- 不显示拖拽把手；关闭由清楚的 IconButton 和关闭策略负责，避免暗示可随意下滑丢草稿。

## 6. 遮罩、边缘与阴影

新增 Overlay 专用 Token：

| Token              | 浅色                              | 深色                           |
| ------------------ | --------------------------------- | ------------------------------ |
| `--scrim`          | `rgb(43 32 28 / 36%)`             | `rgb(0 0 0 / 58%)`             |
| `--scrim-nested`   | `rgb(43 32 28 / 22%)`             | `rgb(0 0 0 / 36%)`             |
| `--overlay-shadow` | `0 24px 64px rgb(43 32 28 / 24%)` | `0 24px 64px rgb(0 0 0 / 48%)` |

- 不使用背景模糊，遮罩下仍能辨认时间线结构。
- 浮层是允许使用阴影的少数对象；内容卡片继续禁用阴影。
- 浅色主题不额外画重边框；深色主题允许 1px 的低对比边缘以区分 Surface。
- 子 AlertDialog 使用 `--scrim-nested`，避免两层遮罩叠成纯黑。

## 7. 结构与布局

Dialog 与 Sheet 使用固定三段结构：

```text
Header：Title / optional context / Close
Body：任务内容、字段、错误与进度
Footer：Quiet / Primary 或 Danger 操作
```

- Header、Body、Footer 共享同一内容左右边缘。
- Header 与 Footer 不使用横向分割线；通过 20–24px 留白和 Surface 覆盖区分。
- Close 使用右上角圆形 IconButton，不使用文字“关闭”。
- AlertDialog 不显示右上角关闭按钮。
- Footer 遵循 Button 规范：不做两个等分按钮，不出现两个实心高强调操作。
- Sheet 可以显示简短上下文，例如链色点与链名；不复制页面完整页眉。
- 不使用超大警告图标、插画或装饰性编号。

## 8. 滚动规则

- 打开 Modal 后锁定页面滚动。
- Sheet 只有 Body 滚动；Header 与 Footer 固定。
- 禁止页面与 Sheet 同时滚动，禁止 Sheet 内出现第二个整页滚动容器。
- Dialog 允许 Body 在高度上受限，但达到 70dvh 设计阈值应转 Sheet。
- Header / Footer 固定时不用阴影或分割线，内容从其 Surface 下方自然进入和离开。
- iOS 使用动态视口单位与 Safe Area，键盘弹出时主字段和 Footer 仍可到达。

## 9. 关闭与草稿保护

`onRequestClose` 必须提供来源：

```ts
type CloseReason = "close-button" | "escape" | "outside";
```

基础组件只报告关闭意图，不自行决定业务状态：

- 内容为空时，Close、Escape、Outside 都可直接关闭。
- 正文、媒体、Tag、时间或字段发生变化后，任一关闭方式先打开“放弃这次记录？”AlertDialog。
- 放弃确认使用“继续记录”与“放弃记录”，不使用“确定 / 取消”。
- 提交或保存进行中，Dialog / Sheet 的 Close、Escape、Outside 全部失效。
- 基础组件不接收 `dirty`；业务 Service 根据实际数据判断并响应 `onRequestClose`。
- 本阶段不做草稿持久化。

AlertDialog 规则：

- Outside 不关闭。
- Escape 等价于更安全的次级操作。
- Danger 操作执行中禁止关闭和重复提交。
- Lightbox 例外：Outside 与 Escape 均可直接关闭。

## 10. 焦点与无障碍

- 底层行为使用现有 `react-aria-components` 的 Modal、Dialog 与 Focus 管理能力。
- 背景页面进入 inert，焦点不能离开当前顶层浮层。
- Sheet 打开后聚焦正文输入；创建链 Dialog 聚焦名称字段。
- AlertDialog 初始聚焦更安全的次级操作，不自动聚焦危险按钮。
- 关闭后焦点返回原触发按钮；关闭子 AlertDialog 后返回父浮层触发点。
- Title 与 Description 建立可访问关联；没有可见 Description 时仍需提供可访问描述。
- Close IconButton 必须有可读名称。
- Tab 顺序与视觉顺序一致；不使用 CSS `order` 颠倒 Footer 操作。
- 页面快捷键在 Modal 打开时暂停，Lightbox 自己接管左右方向键。

## 11. 动效

| 对象                 | 动效                      | 时长  |
| -------------------- | ------------------------- | ----- |
| Scrim                | 透明度淡入淡出            | 160ms |
| Dialog / AlertDialog | 上移 8px + Scale 0.98 → 1 | 180ms |
| 桌面 Sheet           | 从右侧进入                | 220ms |
| 移动端 Sheet         | 从底部进入                | 220ms |

- 使用确定性的 ease-out，不做弹簧回弹。
- 关闭动效可略快，但不能在业务完成前提前卸载。
- `prefers-reduced-motion` 下取消位移与缩放，只保留近乎即时的显隐。
- 不给 Sheet 内部各字段依次播放入场动画。

## 12. 状态、错误与请求

- `busy` 只禁止关闭和重复操作，不替业务管理请求。
- 表单错误显示在对应字段或 Body 顶部 Banner，不用新的错误 Modal 覆盖当前 Modal。
- 请求失败后保留用户输入和当前浮层，Footer 恢复可操作。
- 请求成功后先完成业务状态更新，再关闭浮层并恢复焦点。
- Sheet 中的上传进度放在 Body 中，不把 Footer 文案当作唯一进度反馈。
- AlertDialog 的确认 Button 使用 Button Loading 状态，并保留具体动词。

## 13. 文案规则

- Title 使用用户任务：“记下此刻”“开一条新的链”“删除这条时刻？”。
- 不使用“操作确认”“编辑记录”“系统提示”等系统词。
- AlertDialog Body 说明真实后果和是否可恢复，不重复标题。
- Button 复述结果：“删除时刻”“换成图片”“放弃记录”。
- 不在标题中使用感叹号；危险场景保持平静、明确。
- Close IconButton 的名称统一为“关闭”。

## 14. API 契约

底层 `ModalSurface` 为内部实现，不允许业务直接引用：

```tsx
<Dialog
  open={open}
  title="开一条新的链"
  footer={actions}
  busy={submitting}
  onRequestClose={handleClose}
>
  {form}
</Dialog>

<Sheet
  open={open}
  title="记下此刻"
  context={<ChainContext />}
  footer={actions}
  busy={submitting}
  onRequestClose={handleClose}
>
  {composer}
</Sheet>

<AlertDialog
  open={confirming}
  title="放弃这次记录？"
  body="已经写下的内容和选择的照片不会保留。"
  confirmLabel="放弃记录"
  cancelLabel="继续记录"
  danger
  busy={discarding}
  onConfirm={discard}
  onCancel={keepEditing}
/>
```

接口约束：

- 所有组件受控；`open` 的真相源留在页面或 Service。
- `onRequestClose(reason)` 只报告意图，业务决定关闭、确认或忽略。
- `busy` 控制不可关闭状态与无障碍 Busy 标记。
- Sheet 响应式形态内建，页面不传 `side="right"` 或自行判断设备。
- Title、Description、Body、Footer 是固定结构；不开放任意 Header / Container 替换。
- 页面可以提供 Context，但不能覆盖间距、圆角、遮罩、阴影与动效。
- Lightbox 保持独立 API，不强行抽象成 Dialog Variant。

## 15. 响应式与验收

视觉验收至少覆盖：

1. 390px：底部近全高 Sheet、软键盘、Safe Area、长标题与 Footer。
2. 768px 边界：Sheet 形态切换不跳错方向。
3. 1024px：右侧悬浮 Sheet 保留足够时间线上下文。
4. 1440px / 1895px：Sheet 固定 520px，不随大屏无限变宽。
5. 浅色 / 深色：Scrim、边缘和 Shadow 层级一致。
6. Dialog、AlertDialog、Sheet、嵌套 AlertDialog、Lightbox。
7. Empty / Dirty / Busy / Error / Long content。
8. Tab、Shift+Tab、Escape、Outside、关闭后焦点恢复。
9. `prefers-reduced-motion`。

## 16. 当前实现迁移说明

- `compose/compose-panel`：居中大 Modal 迁移为 Sheet，Service 和业务字段不变。
- `shell/create-chain-dialog`：迁移为 Dialog，删除页面手写遮罩。
- `ui/Confirm.tsx`：由 AlertDialog 替代，调用文案改成具体结果。
- `timeline/lightbox.tsx`：保留独立组件，迁移到统一层级、焦点和 IconButton 规则。
- `timeline/timeline-rail.tsx`：移动抽屉迁移为 Sheet；桌面 Rail 不变。
- `HappenedAtField` 中的 React Aria Dialog 是 Popover 内部语义，不属于 Modal Dialog，不套本规范的居中尺寸。
- 所有手写 `fixed inset-0` 浮层逐项迁移到统一行为层。

## 17. 非目标

- 本规范不实现组件，不修改业务 API、DTO、权限或上传流程。
- 不新增草稿持久化、拖拽关闭、手势动画或多步骤 Wizard。
- 不把 Menu、Popover、Tooltip 合并进 Modal。
- 不为所有页面建立全屏编辑路由。
- 不创建 Large Dialog 或允许业务自由选择 Sheet 方位。
