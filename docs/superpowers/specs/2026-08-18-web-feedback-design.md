# 时刻 Moment — Web Feedback 组件设计规范

> 日期：2026-08-18
> 状态：视觉与交互方向已确认；待实现
> 上位规范：[`2026-08-17-web-c-end-redesign.md`](./2026-08-17-web-c-end-redesign.md)
> Button 规范：[`2026-08-18-web-button-design.md`](./2026-08-18-web-button-design.md)
> Modal 规范：[`2026-08-18-web-modal-dialog-sheet-design.md`](./2026-08-18-web-modal-dialog-sheet-design.md)
> Field 规范：[`2026-08-18-web-field-input-design.md`](./2026-08-18-web-field-input-design.md)
> 视觉参考：[`2026-08-18-web-feedback-directions.html`](../mocks/2026-08-18-web-feedback-directions.html)
> 可编辑源稿：[`fragment.html`](../mocks/2026-08-18-web-feedback-directions.fragment.html)

本文定义 `apps/web` 中 Banner、Toast、EmptyState、Skeleton 与 InlineProgress 的职责、视觉、状态、响应式和无障碍规则。方向采用已确认的 B 方案“柔色信号”：持续反馈融入内容，短暂反馈才成为真实浮层；空状态与加载骨架延续“日子线”，不再堆叠错误卡片和通用灰块。

危险确认不属于 Feedback 家族。现有 `Confirm` 由 Modal 规范中的 `AlertDialog` 统一替代。

## 1. 设计目标

1. 让用户快速理解发生了什么、是否需要行动，以及反馈会持续多久。
2. 根据反馈范围选择组件，不用 Toast、Banner 或 EmptyState 互相替代。
3. 保持 C 端的轻盈和人情味，不引入后台式消息盒、绿色成功层或卡片矩阵。
4. 让时间线在空、加载和追加状态下仍保留产品“所在感”。
5. 统一播报、计时、等待和错误恢复，避免页面各自拼反馈状态。

## 2. 组件边界与选择规则

| 情况                             | 组件              | 说明                                       |
| -------------------------------- | ----------------- | ------------------------------------------ |
| 单一字段不合法                   | `FieldError`      | 贴近字段，由 Field 规范负责                |
| 当前页面或当前任务持续存在的问题 | `Banner`          | 在问题解决或场景离开前保留                 |
| 结果不明显的轻量成功             | `Toast`           | 短暂确认，不要求用户处理                   |
| 没有内容、无搜索结果或内容不可见 | `EmptyState`      | 解释当前状态与合理下一步                   |
| 首次加载且结构已知               | 结构化 `Skeleton` | 维持布局和时间线骨架                       |
| 加载更多、上传或后台同步         | `InlineProgress`  | 表示内容仍在继续                           |
| 不可逆或高风险操作               | `AlertDialog`     | 由 Modal 规范负责，不提供 Feedback Confirm |

选择顺序：

```text
需要确认高风险动作？ → AlertDialog
某个字段有问题？     → FieldError
当前任务持续受阻？   → Banner
结果已在界面中可见？ → 不额外反馈
结果不明显但已完成？ → Toast
当前确实没有内容？   → EmptyState
首次已知结构加载？   → Skeleton
已有内容继续加载？   → InlineProgress
```

全局限制：

- 不用 Toast 承载表单错误、权限错误、网络长错误或必须处理的信息。
- 不用 Banner 表达普通成功。
- 不把真实错误伪装成 EmptyState。
- Skeleton 不模拟完整文字、头像、按钮或可点击控件。
- 同一视觉区域最多一个 Banner。
- 不新增绿色成功色层；成功主要由结果、图标和文案表达。

## 3. 视觉方向：柔色信号

### 3.1 层级原则

- Banner 属于内容流：柔和语义色面，无边框、无阴影。
- Toast 属于真实浮层：允许一层克制阴影，不再嵌套卡片。
- EmptyState 属于页面状态：依靠留白和日子线，不使用独立大卡片。
- Skeleton 属于结构预告：沿用时间线节点，不复制内容卡片外观。
- InlineProgress 属于进行中内容：靠近正在延续的位置，不覆盖页面。

### 3.2 Feedback Token

所有 Token 落入 `apps/web/src/styles/tokens.css`，业务组件不得写死色值。

| Token                          | 建议值                                                  | 用途                                |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------- |
| `--feedback-error-bg`          | `color-mix(in srgb, var(--danger) 10%, var(--surface))` | Error Banner                        |
| `--feedback-warning-bg`        | `color-mix(in srgb, var(--select) 18%, var(--surface))` | Warning Banner                      |
| `--feedback-info-bg`           | `color-mix(in srgb, var(--ink) 5%, var(--surface))`     | Info Banner                         |
| `--feedback-skeleton`          | `color-mix(in srgb, var(--ink) 7%, transparent)`        | Skeleton 色块                       |
| `--feedback-toast-bg`          | `var(--surface)`                                        | Toast 浮层                          |
| `--feedback-toast-shadow`      | `0 16px 40px rgb(43 32 28 / 18%)`                       | 浅色 Toast                          |
| `--feedback-toast-shadow-dark` | `0 16px 40px rgb(0 0 0 / 42%)`                          | 深色 Toast                          |
| `--z-toast`                    | `65`                                                    | Overlay 之上、嵌套 AlertDialog 之下 |

`color-mix()` 结果仍需在两套主题下校验文字和非文字对比度。反馈色面不得发展成新的蓝、绿、紫状态品牌层。

## 4. Banner

### 4.1 用途与禁止场景

Banner 表达当前页面、表单或内容区域中持续存在的信息。它可以提示刷新失败、权限变化、部分内容不可用或需要重试的请求。

禁止用 Banner：

- 庆祝保存、发布等普通成功；
- 罗列多条字段错误；
- 作为公告轮播或营销位；
- 替代危险操作确认；
- 在同一区域叠放多张消息卡。

### 4.2 解剖与几何

```text
┌──────────────────────────────────┐
│ [Optional icon] Message  [Action]│
└──────────────────────────────────┘
```

| Token                | 值   | 说明           |
| -------------------- | ---- | -------------- |
| `--banner-radius`    | 14px | 柔和色面圆角   |
| `--banner-py`        | 12px | 垂直内边距     |
| `--banner-px`        | 14px | 水平内边距     |
| `--banner-gap`       | 12px | 文案与操作间距 |
| `--banner-icon-size` | 16px | 可选系统图标   |

- 默认结构为一段 Message 和最多一个轻操作。
- 短文案与操作保持同一行；可用宽度不足时，操作落到下一行左侧。
- 操作使用 Button 规范的 Quiet Button，不使用下划线、实体主按钮或独立小卡片。
- 单句错误默认不显示图标；安全、网络中断等需要加强识别的系统状态才使用图标。
- Banner 不提供装饰性标题。确实需要标题和长正文时，应重新判断是否属于页面内容。

### 4.3 Tone 与状态

| Tone      | 语义                   | 背景                    | 前景与操作 |
| --------- | ---------------------- | ----------------------- | ---------- |
| `error`   | 当前任务失败、需要恢复 | `--feedback-error-bg`   | `--danger` |
| `warning` | 有风险但仍可继续       | `--feedback-warning-bg` | `--ink`    |
| `info`    | 持续的上下文说明       | `--feedback-info-bg`    | `--ink`    |

不提供 `success` Tone。

| 状态                 | 表现                                                |
| -------------------- | --------------------------------------------------- |
| Default              | 文案与可选操作可用                                  |
| Action hover / focus | 只改变 Quiet Button 自身状态                        |
| Action pending       | 操作显示 16px spinner，保持原标签宽度，阻止重复触发 |
| Resolved             | 问题解决后移除，不播放庆祝动效                      |

### 4.4 行为与 API

```tsx
<Banner tone="error" action={{ label: "再试一次", onPress: retry }}>
  没能刷新大家的日子
</Banner>
```

- `children` 只接受可读消息，不允许业务传入任意复杂布局。
- `action` 是一个固定结构对象，最多一个；组件负责 Button 外观和 pending 状态。
- `icon` 由组件语义映射；业务不得用任意插图占据 Banner。
- Banner 持续到问题解决或离开当前场景，不提供自动消失计时。

### 4.5 无障碍

- 阻断当前任务且刚刚发生的错误使用 `role="alert"`。
- 普通信息与非紧急状态使用 `role="status"`。
- Banner 出现时不主动移动焦点；操作失败后焦点仍留在原操作或错误字段。
- 图标为装饰时 `aria-hidden="true"`，不能重复播报 Tone 名称。

## 5. Toast

### 5.1 触发原则

Toast 只确认“结果不明显”的轻量成功，例如设置已保存、后台导出完成或跨页面动作已完成。

以下场景不显示 Toast：

- 复制链接后按钮已变为“已复制”；
- 发布、评论或删除后结果已直接反映在列表；
- 表单、权限和网络错误；
- 需要用户阅读或处理的长信息。

### 5.2 解剖与几何

```text
╭────────────────────────────────╮
│ [Optional icon] Message [Action]│
╰────────────────────────────────╯
```

| Token            | 值    | 说明         |
| ---------------- | ----- | ------------ |
| `--toast-min-h`  | 48px  | 最小高度     |
| `--toast-radius` | 18px  | 浮层圆角     |
| `--toast-px`     | 14px  | 水平内边距   |
| `--toast-max-w`  | 360px | 桌面最大宽度 |
| `--toast-gap`    | 10px  | 内部间距     |

- Toast 使用中性 `--surface`，不使用绿色成功底色。
- 可选成功图标使用 `--action`，不引入第二品牌色。
- 内容只有一行 Message 与可选轻操作，不放标题、说明段落或关闭按钮。
- 文案较长时允许自然换为两行，但应优先缩短；超过两行改用持续反馈。

### 5.3 位置与响应式

- 桌面端定位在当前内容区域底部居中，距离视口底部 24px；不放到传统后台式右下角。
- 移动端定位在 Safe Area 下方顶部居中，水平留 16px，顶部间距 12px。
- 移动端顶部位置避开底部导航、ActionSheet、Sheet 操作区和软键盘。
- ToastRegion 是 Shell 级唯一实例；业务页面不得创建私有角落 Toast 容器。
- Modal / Sheet 中触发的 Toast 仍进入全局 ToastRegion，`--z-toast: 65`；嵌套 AlertDialog 保持在其上方。

### 5.4 队列、计时与动作

| 类型          | 持续时间 | 动作               |
| ------------- | -------- | ------------------ |
| 普通确认      | 3.5s     | 无                 |
| 可撤销确认    | 6s       | 一个 Quiet Action  |
| Hover / Focus | 暂停     | 离开后继续剩余时间 |

- 同时只显示一个 Toast，最多等待两个。
- 相同 key 的连续反馈合并并刷新计时，不连续堆叠。
- 队列已满时丢弃最旧的未展示普通确认，不丢弃带撤销操作的 Toast。
- 页面切换不自动清空跨页反馈；用户退出登录时清空队列。
- 普通 Toast 不提供关闭按钮。必须手动确认的信息不应使用 Toast。

### 5.5 API 与状态

```tsx
const toast = useToast();

toast.show({
  key: "settings-saved",
  message: "设置已保存",
});

toast.show({
  key: `moment-${momentId}-hidden`,
  message: "已从汇总中隐藏",
  action: { label: "撤销", onPress: undo },
});
```

- API 不暴露任意 `tone`；第一阶段只提供中性成功确认。
- `message` 必须是字符串，`action` 最多一个，不能传入任意 ReactNode。
- 动作执行失败时关闭 Toast，并在原任务区域使用 Banner 表达错误。

### 5.6 动效与无障碍

- 进入：Opacity + 4px 位移，160ms `ease-out`。
- 退出：Opacity，120ms `ease-in`。
- `prefers-reduced-motion` 下仅改变透明度，不位移。
- ToastRegion 使用 `aria-live="polite"` 和 `aria-atomic="true"`，不抢焦点。
- 带动作 Toast 必须能通过 Tab 聚焦；计时在焦点进入时暂停。

## 6. EmptyState

### 6.1 两种布局

设计系统只提供两种视觉布局：

| Variant    | 场景                         | 识别方式                            |
| ---------- | ---------------------------- | ----------------------------------- |
| `timeline` | 单链时间线、汇总流、个人日子 | 珊瑚节点 + 短日子线，内容从线上生长 |
| `plain`    | 搜索、设置子列表、非时间内容 | 纯文本和留白，不强行套日子线        |

页面级与局部级通过 `scope="page | section"` 控制留白，不新增第三套视觉 Variant。

### 6.2 内容类型

| 内容类型    | 标题与说明                   | 操作                             |
| ----------- | ---------------------------- | -------------------------------- |
| First use   | 解释用户可以开始做什么       | 最多一个 Primary，例如“记下此刻” |
| No results  | 说明当前筛选或搜索没有结果   | 一个 Quiet，例如“清除筛选”       |
| Unavailable | 内容已删除、不可见或暂未开放 | 通常无操作，或一个明确返回入口   |

- 加载失败不属于 EmptyState，使用 Banner。
- 不使用“暂无数据”“列表为空”等系统术语。
- 不放多个按钮，不把产品教学、营销介绍或大幅插画塞进空状态。

### 6.3 几何与排版

| Token                    | 值                | 说明           |
| ------------------------ | ----------------- | -------------- |
| `--empty-max-w`          | 320px             | 文案最大宽度   |
| `--empty-page-py`        | 64px              | 桌面页面级留白 |
| `--empty-page-py-mobile` | 48px              | 移动页面级留白 |
| `--empty-section-py`     | 32px              | 局部列表留白   |
| `--empty-title`          | 16px / 24px / 600 | 标题           |
| `--empty-body`           | 14px / 22px / 400 | 说明           |
| `--empty-action-gap`     | 16px              | 文案到操作     |

- EmptyState 不使用卡片边框、阴影或独立大色块。
- Timeline Variant 的节点为 8px，日子线只延伸到当前内容高度，不贯穿整页。
- 动态业务文字使用系统字体；“记下此刻”等已固化固定词可使用品牌字体。

### 6.4 API

```tsx
<EmptyState
  variant="timeline"
  scope="page"
  title="还没有记下任何一刻"
  description="第一条记忆会从这条日子线上长出来"
  action={{ label: "记下此刻", onPress: openComposer, emphasis: "primary" }}
/>
```

- 组件接收结构化文字和至多一个 Action，不接受任意 children。
- `variant` 只决定是否使用时间线签名；业务状态由文案和 Action 语义表达。
- 空状态不是错误，不使用 `role="alert"`，页面进入时也不主动聚焦。

## 7. Skeleton

### 7.1 公开模板

业务只引用以下结构化模板：

| 模板               | 场景                  |
| ------------------ | --------------------- |
| `TimelineSkeleton` | 链详情、个人时间线    |
| `FeedSkeleton`     | 汇总流和普通内容列表  |
| `DetailSkeleton`   | 详情与 Sheet 首次加载 |
| `SettingsSkeleton` | 设置页分组结构        |

自由宽高的 Skeleton primitive 只供上述模板内部组合，不从公共 UI 入口导出给业务页面。

### 7.2 视觉与结构

- TimelineSkeleton 保留节点和纵向日子线，提前表达内容将出现的位置。
- 只表达节点、内容区域、媒体比例和必要高度，不模拟完整文字、头像、按钮或交互状态。
- 无边框、无阴影，不复刻旧卡片轮廓。
- 色块使用 `--feedback-skeleton`，两套主题都保持低对比。
- 骨架高度尽量接近最终内容，媒体使用已知 aspect-ratio，避免布局位移。
- Skeleton 数量由首屏可见结构决定，不固定渲染大量占位项。

### 7.3 延迟与动效

| Token                    | 值    | 说明             |
| ------------------------ | ----- | ---------------- |
| `--skeleton-delay`       | 180ms | 快速请求不显示   |
| `--skeleton-min-visible` | 280ms | 已出现后避免闪烁 |
| `--skeleton-cycle`       | 1.4s  | 低对比呼吸周期   |

- 使用透明度轻微呼吸，不使用横向 Shimmer 扫光。
- 数据在延迟内完成时直接显示真实内容。
- Skeleton 已出现时至少维持 280ms，再自然替换真实内容。
- `prefers-reduced-motion` 下保持静态。
- 已有内容后的继续加载不使用 Skeleton，改用 InlineProgress。

### 7.4 无障碍

- 加载区域设置 `aria-busy="true"`，完成后恢复 `false`。
- Skeleton 图形整体 `aria-hidden="true"`。
- 页面必须保留可访问名称，例如区域 Heading；长时间加载由可读状态文字补充，不能依赖动画表达。

## 8. InlineProgress

### 8.1 类型与场景

| Variant         | 场景                 | 表现                        |
| --------------- | -------------------- | --------------------------- |
| `indeterminate` | 加载更多、后台同步   | 16px spinner + 简短文案     |
| `determinate`   | 可计算进度的媒体上传 | 细进度条 + 百分比或文件状态 |

- 时间线加载更多放在日子线末端，使用小节点与“正在加载更多”，不插入新卡片。
- 按钮自身提交继续使用 Button Loading，不叠加 InlineProgress。
- 全页首次加载使用 Skeleton，不使用一个居中的大 Spinner。
- 超过约 1s 的过程必须显示可读文案，不能只转圈。

### 8.2 几何、状态与 API

| Token                       | 值    | 说明               |
| --------------------------- | ----- | ------------------ |
| `--inline-progress-min-h`   | 44px  | 稳定占位与触控邻接 |
| `--inline-progress-spinner` | 16px  | 不确定进度图形     |
| `--inline-progress-track-h` | 4px   | 确定进度轨道       |
| `--inline-progress-radius`  | 999px | 进度轨道圆角       |

```tsx
<InlineProgress variant="indeterminate" label="正在加载更多" />

<InlineProgress
  variant="determinate"
  label="正在上传照片"
  value={64}
/>
```

- 确定进度使用原生或等价 `role="progressbar"`，提供 `aria-valuemin`、`aria-valuemax` 与 `aria-valuenow`。
- 不确定进度提供明确的可访问名称，不伪造百分比。
- 失败后 InlineProgress 结束，由最近的 Banner 表达恢复动作。

## 9. Confirm 的归属

Feedback 不提供 `Confirm` API。`apps/web/src/ui/Confirm.tsx` 标记废弃，调用迁移到 Modal 规范的 `AlertDialog`：

- 只用于删除链、删除记忆、退出共享关系等不可逆或高风险动作。
- 桌面与移动端都保持居中 AlertDialog，不转换为底部 ActionSheet。
- 标题直接描述动作，例如“删除这条记忆？”，正文说明后果，不写笼统的“你确定吗？”。
- 取消在左、危险操作在右；初始焦点落在取消。
- 点击遮罩不关闭，Escape 等同取消。
- 危险操作执行时使用 Button Loading 并阻止重复提交。
- 删除结果已在界面可见时不再弹 Toast。
- 删除整条链等高影响动作可以要求输入链名称；普通单条内容删除不增加该负担。

具体宽度、遮罩、嵌套、焦点恢复与文案规则以 Modal 规范为准，本文不建立第二套确认组件。

## 10. 状态矩阵

| 组件           | Default      | Pending             | Success                 | Error                       | Disabled                    |
| -------------- | ------------ | ------------------- | ----------------------- | --------------------------- | --------------------------- |
| Banner         | 持续消息     | Action 自身 loading | 解决后移除              | 保持并允许重试              | Action 可禁用，消息仍可读   |
| Toast          | 单条确认     | 不承载长任务        | 3.5s / 6s 后退出        | 转为本地 Banner             | Action 执行时防重复         |
| EmptyState     | 无内容说明   | 不承担加载          | Action 后由真实内容替换 | 错误改用 Banner             | Action 遵循 Button Disabled |
| Skeleton       | 首次加载结构 | 低对比呼吸          | 替换为真实内容          | 替换为 Banner / Error State | 不适用                      |
| InlineProgress | 进行中文案   | Spinner 或进度条    | 从流中移除              | 结束并由 Banner 接管        | 不适用                      |

## 11. 文案规则

### 11.1 基本结构

- 先说结果或状态，再给下一步。
- 使用用户熟悉的对象：“这条记忆”“大家的日子”“分享链接”。
- 避免错误码、接口名、HTTP 状态和内部权限术语。
- 操作使用明确动词：“再试一次”“清除筛选”“撤销”。
- 保持平静，不用多个感叹号，不用“操作失败”“暂无数据”等后台文案。

### 11.2 推荐示例

| 场景          | 推荐                          | 避免                 |
| ------------- | ----------------------------- | -------------------- |
| Feed 刷新失败 | 没能刷新大家的日子 / 再试一次 | 数据加载异常，请重试 |
| 设置保存      | 设置已保存                    | 操作成功！           |
| 首次空链      | 还没有记下任何一刻 / 记下此刻 | 暂无数据             |
| 搜索无结果    | 没找到相关记忆 / 清除筛选     | 查询结果为空         |
| 加载更多      | 正在加载更多                  | Loading...           |
| 删除确认      | 删除这条记忆？删除后无法恢复  | 确认删除吗？         |

## 12. 响应式与跨设备

- Banner、EmptyState 与 Skeleton 跟随所在内容列，不扩张到桌面全屏宽度。
- Banner 在窄屏允许 Action 换行，不压缩或截断文案。
- Toast 以 768px 为位置切换点：桌面内容区底部居中，移动 Safe Area 下方顶部居中。
- EmptyState 页面留白从 64px 降到 48px；日子线比例不放大。
- Skeleton 模板在响应式下与真实布局使用同一容器宽度和媒体比例。
- InlineProgress 贴近内容末端；移动端不被底部导航或 Safe Area 遮挡。
- 横竖屏切换时 ToastRegion 重算位置，不重新播报或重置计时。

## 13. 实现约束

- 底层交互和无障碍优先复用 `react-aria-components` 能力；计时与队列集中在 ToastProvider。
- 页面不得手写 `animate-pulse`、fixed Toast、错误色卡片或私有 Confirm。
- 组件颜色只引用 Token；业务不得通过 `className` 覆盖 Tone、阴影、圆角和动效。
- `Banner`、`EmptyState` 与 `InlineProgress` 暴露结构化 Props，不接受任意布局型 children；Banner 只允许消息 children。
- ToastProvider 在应用 Shell 挂载一次，SSR / Hydration 前不启动计时。
- Skeleton 的延迟和最短可见时间由统一 pending hook 管理，页面不复制定时器。
- 网络恢复、重试与请求状态仍由页面 Service 管理；UI 组件不自行请求数据。

## 14. 当前代码迁移映射

| 当前实现                         | 目标                                                |
| -------------------------------- | --------------------------------------------------- |
| `apps/web/src/ui/Banner.tsx`     | 去除 border、shadow 和下划线动作，迁移到柔色 Banner |
| `apps/web/src/ui/Empty.tsx`      | 收敛为 `EmptyState`，提供 timeline / plain 两种布局 |
| `apps/web/src/ui/Confirm.tsx`    | 标记废弃，调用迁移到 `AlertDialog` 后删除           |
| 页面内复制按钮的“已复制”         | 保持原位状态，不增加 Toast                          |
| 设置保存等无明显结果             | 使用全局 ToastProvider                              |
| Timeline 内 `animate-pulse` 灰卡 | 替换为结构化 TimelineSkeleton / FeedSkeleton        |
| 分页与上传转圈                   | 使用 InlineProgress；按钮提交继续用 Button Loading  |

迁移顺序建议：

1. 建立 Token、ToastProvider 与统一 pending hook。
2. 重构 Banner 和 EmptyState，保持业务语义不变。
3. 建立四个 Skeleton 模板并替换页面私有占位。
4. 迁移加载更多与上传到 InlineProgress。
5. 按 Modal 规范迁移 Confirm → AlertDialog，清除旧组件。
6. 扫描并删除页面私有错误卡、Toast、Spinner 和 `animate-pulse`。

## 15. 视觉与行为验收

### 15.1 必测视口

- 390 × 844：移动端 Toast 顶部 Safe Area、Banner 换行、空状态与日子线。
- 768 × 1024：Toast 位置切换、内容列与 Feedback 对齐。
- 1440 × 900：桌面内容区域底部 Toast，不漂到后台式右下角。
- 1895 × 900：宽屏 Feedback 仍跟随内容列，不贴视口边缘。

### 15.2 必测状态

1. Error / Warning / Info Banner，含无 Action、Action、Action pending 与长文案。
2. 普通 Toast、可撤销 Toast、去重、队列、路由切换和 Hover / Focus 暂停。
3. Timeline / Plain EmptyState，覆盖首次使用、无结果与不可见内容。
4. 四类 Skeleton 的延迟、最短展示、真实内容替换和 Reduced Motion。
5. InlineProgress 的不确定、确定进度、完成与失败接管。
6. AlertDialog 的安全初始焦点、Escape、遮罩点击、Loading 和焦点恢复。

### 15.3 视觉清单

- 除 Toast 之外，Feedback 内容没有阴影。
- Banner 没有边框、横线、下划线动作或成功绿色色面。
- Toast 同时只出现一个，位置不遮挡移动端底部交互。
- EmptyState 没有大插画或卡片容器，时间线场景保留日子线签名。
- Skeleton 不伪造正文、头像、按钮和操作栏。
- 加载更多没有插入新的 Skeleton 卡片。
- 删除成功后没有重复 Toast。

### 15.4 无障碍清单

- 使用键盘可操作所有 Banner / Toast Action，并有可见 Focus Ring。
- Toast 使用 polite live region，不抢焦点；紧急 Banner 才使用 alert。
- EmptyState 不被播报为错误。
- Skeleton 对读屏隐藏，真实加载区域正确维护 `aria-busy`。
- Progress 提供名称与正确 value；Reduced Motion 下无持续位移动画。
- 两主题文字和非文字状态均满足 WCAG AA。

## 16. 本轮范围

- 本规范只固化设计和交互契约，不实现组件，不修改业务逻辑或 API。
- 不建立 Notification Center、全局消息历史、离线同步中心或系统推送设计。
- 不扩展绿色成功品牌层，不新增营销 Banner 或公告轮播。
- Confirm 的实现细节继续以 Modal 规范为唯一真相源。
