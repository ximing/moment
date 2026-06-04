# packages/dto — 跨端契约真相源

## 这个目录负责什么

- server / web / app 三端共享的 zod schema 与推导类型，是 API 请求/响应契约的**唯一真相源**。

## 放置约束

- 每个业务域一个文件（`auth.ts chains.ts moments.ts ...`），新文件必须加入 `src/index.ts` barrel。
- 只放 schema 与纯类型推导，不放任何运行时业务逻辑、不依赖 server/web 特定环境。

## 开发偏好

- 字段新增/改名是**跨端破坏性变更**：改这里必须同步 `@moment/server` 的使用方与 `packages/api-client`，并更新对应测试（同目录 `*.test.ts`）。
- schema 命名以 `xxxInputSchema` / `xxxSchema` 结尾，导出对应的 `z.infer` 类型。
