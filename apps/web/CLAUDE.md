# apps/web — 家庭平板时间线（静态 Web）

## 这个目录负责什么

- 面向家庭平板的 Web 前端：时间线、发布面板、链设置/邀请/分享页。Vite + React + Tailwind，构建为纯静态产物。

## 放置约束

- 页面级组件放 `src/pages/`；时间线相关交互组件在 `src/timeline/`；通用无业务组件放 `src/ui/`；壳层（布局/导航）在 `src/shell/`。
- 所有 API 访问经 `src/api/`，类型来自 `@moment/dto` / `@moment/api-client`；组件里不手写 fetch。
- 页面私有逻辑下沉到对应页面目录或 `src/lib/`，不要进 `src/ui/`。

## 开发偏好

- 媒体与分享链接依赖**同源相对路径**：Web 与 API 必须同源部署，`/api` 反代到 server:3000；代码里不要写绝对 API 域名。
- 认证态、链上下文等跨页状态集中在 `src/auth/`、`src/chain/`，不要在页面组件里各自缓存 token。
- 发布相关状态变更优先走显式动作（提交/回调），避免 effect 里链式 setState。
- 视觉尺度与对齐网格见 `.claude/rules/web-ui.md`（Design System）。改 `apps/web/src/**` 必须走 token，禁止一次性 `px-[18px]` / 负边距通栏。
