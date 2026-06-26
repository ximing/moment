# 设计系统视觉回归（design-system-regression）

被测应用：本地开发服务器 `http://127.0.0.1:5173`（Vite dev，经同源 `/api` 代理到
`http://127.0.0.1:3000` 的 E2E 专用后端）。启动方式与三终端命令见 `e2e/README.md`。
本用例由 `e2e/suites/design-system-regression.mjs` 固化重放；基线清单的唯一来源是
`e2e/baselines/manifest.json`（24 张 PNG，三路由 × 明暗 × 四视口）。

## Fixture 输入与不变量

```text
owner.email    = MOMENT_E2E_OWNER_EMAIL (example for apps/server/.env.e2e: owner.e2e@moment.invalid)
owner.password = MOMENT_E2E_OWNER_PASSWORD
owner.id       = 00000000-0000-4000-8000-000000000011
owner.nickname = 林晓满
viewer.email   = MOMENT_E2E_VIEWER_EMAIL (example for apps/server/.env.e2e: viewer.e2e@moment.invalid)
viewer.password = MOMENT_E2E_VIEWER_PASSWORD
viewer.id      = 00000000-0000-4000-8000-000000000012
viewer.nickname = 周小禾
tagId          = 00000000-0000-4000-8000-000000000013
chainId        = 00000000-0000-4000-8000-000000000014
momentId       = 00000000-0000-4000-8000-000000000015
imageMomentId  = 00000000-0000-4000-8000-000000000016
mediaId        = 00000000-0000-4000-8000-000000000017
shareLinkId    = 00000000-0000-4000-8000-000000000018
inviteId       = 00000000-0000-4000-8000-000000000019
shareToken     = e2e-design-system-share-token
inviteToken    = e2e-design-system-invite-token
fixedNow       = 2026-08-18T09:30:00.000Z
apiBaseUrl     = http://127.0.0.1:3000/api
webBaseUrl     = http://127.0.0.1:5173
```

口令只来自被 gitignore 的 `apps/server/.env.e2e` 或 CI 的非生产 secret store：任何
tracked 的 fixture、用例、套件、截图命名、终端输出或 README 都不得出现口令、
访问令牌或 MySQL 连接字段。

数据准备顺序固定：先 reset，再 seed。两次登录都必须是经过可见 `/login` 表单的
真实 `/api/auth/login`——fixture 对象或 localStorage 注入永远不能替代任一登录。

## 场景 1：viewer 可见登录与只读权限

1. 打开 `/login`，看到「登录时刻」表单（邮箱、密码、登录按钮）。【预期】未登录访问 `/` 会被送到登录页。
2. 在可见表单里填入 viewer 邮箱与口令并提交。【预期】真实登录成功后进入首页，界面出现昵称「周小禾」。
3. 在首页与链页检查 viewer 权限。【预期】能看到两条时刻内容，但没有可用的编辑、删除、成员管理等写操作入口；只读语义完整。
4. 打开头像菜单并点「退出登录」。【预期】回到登录页，Toast 区域被清空，再访问 `/` 会重新要求登录。

## 场景 2：owner 可见登录与写权限

1. 在可见 `/login` 表单填入 owner 邮箱与口令并提交。【预期】登录成功，界面出现昵称「林晓满」。
2. 进入链页与设置页。【预期】owner 可见编辑、删除、成员管理等写操作入口。
3. 保持这次真实 owner 会话，供后续 feed/chain 截图矩阵使用。【预期】全程不直接改写令牌存储、不合成登录态。

## 场景 3：路由旅程与可见内容断言

依次访问并验证可见状态：`/__design-lab`、`/`、`/chains/{chainId}`、
`/chains/{chainId}?compose=1`、`/chains/{chainId}/settings`、`/moments/{momentId}`、
`/me`、`/notifications`、`/share/{shareToken}`、`/invites/{inviteToken}`、`/login`、
`/register`、登录后的任意不存在路径。逐页验证：角色与只读/邀请来源提示、
回应/评论/编辑/删除入口、标签/排序/日期锚点、加载/错误/空态，以及各页无业务语义漂移。

必须点名可见验证的 fixture 内容：

- 长链名「我们一起走过的很长很长的时光链名字」完整可见；
- 长标签「跨年旅行与新年第一束光和家人的漫长回忆」完整可见；
- 纯文字时刻「2025 年最后一天：一起把这一年的温柔收好。」（happenedAt `2025-12-31T15:30:00.000Z`）；
- 单图时刻「2026 年第一天：新年的第一束光。」（happenedAt `2026-01-01T00:30:00.000Z`），图片解码渲染成功；
- 2025 / 2026 年轨边界同屏可见。

`/` 与 `/chains/{chainId}` 在截图前必须同时呈现：两条时刻、解码后的图片、
长链名、长标签与跨年索引；`/` 额外显示「大家的日子」标题，链路由证明单链变体。

## 场景 4：截图矩阵

对 manifest 列出的 24 个状态逐一执行：设置视口与主题、导航、断言该状态
`requiredContent` 的全部标签在可见 DOM 与已解码媒体中成立，等待字体就绪、
图片/海报解码完成、布局后两帧渲染、500 ms 无在途请求，然后截图或与基线比较
（pixelmatch 阈值 0.1，上限 120 个差异像素）。覆盖明/暗 ×
390×844 / 1024×900 / 1440×900 / 1895×900。

## 场景 5：键盘、浮层与响应式边界

- 390 px：对每个浮层（菜单、Dialog、Sheet、AlertDialog、Popover）验证焦点顺序、
  Tab / Shift+Tab 循环、Escape 关闭、外部点击关闭与焦点归还触发器。
- 767 px：链页/用户菜单的响应式菜单呈现为底部 ActionSheet。
- 768 px：同一菜单呈现为锚定浮层。
- 菜单/Sheet 打开时跨越 767/768 边界调整视口。【预期】浮层关闭并把焦点还给触发器。
- Popover 在视口边缘不溢出（碰撞回退）；AlertDialog 默认焦点在安全项，
  取消流程不触发破坏动作；内容被修改过的 Sheet 有防误关保护。
- 模拟偏好减弱动态效果。【预期】页面尊重 reduced motion，无长时动画残留。

## 场景 6：200% 缩放旅程

在 1440×900 浅色主题下把页面缩放到 200%。【预期】`visualViewport.scale ≥ 1.99`；
每个被测控件无横向裁剪（内容不溢出可视宽度、包围盒落在视口内）；标签完整可见。
截图与几何证据只落入被忽略的 artifacts 目录，不进入基线集。

## 收尾

每次运行（正常、失败、中断、含更新基线）都由 runner 负责 teardown：清空 fixture
数据与上传对象，使下一次 reset → seed 结果完全确定。
