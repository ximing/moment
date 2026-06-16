# apps/web — 家庭平板时间线（静态 Web）

## 这个目录负责什么

- 面向家庭平板的 Web 前端：时间线、发布面板、链设置/邀请/分享页。Vite + React + Tailwind，构建为纯静态产物。

## 放置约束

- 状态三层（rab）：全局 Service 在 `src/services/`（`register` 注册于 `main.tsx`，AuthService 排首）；页面组件 `src/pages/<name>/index.tsx` + 同目录 `<name>.service.ts`（`bindServices`）；组件级 Service 与组件同目录。跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- 时间线交互组件在 `src/timeline/`（`moment-sheet.tsx` + `moment-sheet.service.ts` 平铺同目录，每卡一实例）；通用无业务组件放 `src/ui/`；壳层在 `src/shell/`；发布面板在 `src/compose/compose-panel/`。
- 所有 API 访问经 `src/api/client.ts` 的 `client`；类型来自 `@moment/dto` / `@moment/api-client`；组件里不手写 fetch，不包空 ApiService。
- 页面私有纯逻辑下沉 `src/lib/`（如 `feed.ts`）；不进 `src/ui/`。
- 路由参数驱动：页面组件 `useParams` 后 `service.hydrate(id)`（Service 不碰 router）；路由跳转 `useNavigate` 留组件。

## 开发偏好

- 媒体与分享链接依赖**同源相对路径**：Web 与 API 必须同源部署，`/api` 反代到 server:3000；代码里不要写绝对 API 域名。
- 认证态等跨页状态集中在全局 Service（`src/services/`），不要在页面组件里各自缓存 token。
- 发布相关状态变更优先走显式动作（提交/回调），避免 effect 里链式 setState。

## Web C 端设计系统

所有 `apps/web` 页面与组件开发必须遵循以下已批准规范；页面不得复写 Button、Modal、Field、Menu / Popover / Tooltip 或 Feedback 的内部视觉、尺寸、状态和无障碍规则：

- `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`
- `docs/superpowers/specs/2026-08-18-web-button-design.md`
- `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`
- `docs/superpowers/specs/2026-08-18-web-field-input-design.md`
- `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`
- `docs/superpowers/specs/2026-08-18-web-feedback-design.md`

`.claude/rules/web-ui.md` 仅补充跨页面尺度和对齐约束。改 `apps/web/src/**` 必须走 Token，禁止一次性 `px-[18px]` 或负边距通栏。
