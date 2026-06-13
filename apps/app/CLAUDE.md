# apps/app — Expo React Native 客户端

## 这个目录负责什么

- 移动端客户端（Expo + expo-router），消费同一套 `@moment/dto` / `@moment/api-client` 契约。

## 放置约束

- 状态三层（rab）：全局 Service 在 `src/services/`（`register` 注册于 `src/services/register.ts`，`app/_layout.tsx` 模块级调用，AuthService 排首）；页面组件 `src/features/<name>/index.tsx` + 同目录 `<name>.service.ts`（`bindServices`，模块级 bind 一次）。跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- `app/*.tsx` 是薄壳：解析参数 → `service.hydrate(params)`（组件 `useEffect`）→ 渲染 feature；跳转（`router.push/back`）留组件，Service 不碰 router。
- 可复用无业务组件放 `src/components/`；纯逻辑放 `src/lib/`。

## 开发偏好

- token 存取只经 `src/lib/token-store.ts`（`onAuthCleared` 是登出/refresh 失效的单路径桥）；API 调用集中在 `src/lib/api.ts`（`client` / `apiUrl` / `webUrl`）。
- SecureStore 异步：`AuthService.ready` 是登录闸；`applyAuth` 必须先 `await setTokens` 再发任何带 token 的调用。
- 媒体管线：图片压缩后 Blob 进内存；视频一律 `fileUri` + `rn-put` 分片读盘，整文件不进内存。
- 深链接/邀请路径新增时同步检查 `app.config.ts` 的 scheme 配置。
- 推送未接入（spec 2026-08-18 起下线 Expo Push；接入国内方案时另立计划）。
