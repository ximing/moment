# apps/app — Expo React Native 客户端

## 这个目录负责什么

- 移动端客户端（Expo），消费同一套 `@moment/dto` / `@moment/api-client` 契约。

## 放置约束

- 可复用 UI 组件放 `src/components/`；API、认证、推送、媒体等逻辑放 `src/lib/`，不要把请求逻辑写进组件。

## 开发偏好

- token 存取只经 `src/lib/token-store.ts`；API 调用集中在 `src/lib/api.ts`。
- 深链接/邀请路径新增时同步检查 `app.config.ts` 的 scheme 配置。
