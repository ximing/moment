# apps/server — Express API

## 这个目录负责什么

- 全部后端能力：HTTP API（`routing-controllers` + TypeDI）、Drizzle/MySQL 数据层、后台 worker（outbox 消费、sweeper）、APNs 推送、S3 媒体存储。
- `src/` 按业务域分模块（`auth/ chains/ moments/ tags/ feed/ comments/ reactions/ media/ share/ notifications/ push/ devices/ outbox/ worker/ storage/`），每个模块内自行放 controller/service/repository。
- 基础设施在 `src/db/`（schema barrel + 连接）、`src/middlewares/`、`src/utils/`、`src/config.ts`。

## 放置约束

- 新业务域 = `src/<domain>/` 新目录，不要把域逻辑塞进 `controllers/` 或 `utils/`。
- 数据表定义放 `src/db/schema/`，通过 `src/db/schema.ts` barrel 导出；迁移文件在 `drizzle/`，由 `drizzle-kit generate` 生成，不手写 SQL 改表。
- 环境变量只经 `src/config.ts`（zod）读取，禁止散落 `process.env`。
- `dev` / `worker` 必须用 `nodemon + ts-node/esm`（与 aimo 相同），不要用 `tsx watch`：tsx/esbuild 不 emit `design:paramtypes`，TypeDI 构造注入会拿到 `ContainerInstance`，登录等接口会 500。脚本/迁移仍可用 tsx。

## 开发偏好（本项目强约定）

- 链权限一律走 `src/chains/chain-policy.ts` 的 `ChainPolicy.require()` 或 `@UseBefore(requireChainRole(...))`；controller 内**禁止**手写角色判断。
- 链内资源路由一律嵌套：`/api/chains/:chainId/<resource>`；按资源 id 反查链的读接口在 service 层调 `ChainPolicy.require`。
- 业务错误抛 `HttpError` 系，且 `message` 为 UPPER_SNAKE 机器码（如 `CHAIN_ROLE_INSUFFICIENT`）；统一错误结构 `{error:{code,message,details?}}`。
- 数据表约定：主键 `char('id', {length:36})` + 应用层 `randomUUID()`（`refresh_tokens` 自增 bigint 是唯一例外）；时间列 `timestamp(..., {mode:'date'})`，`createdAt` `.notNull().defaultNow()`；软删除仅 `moments`、`comments`。
- 新表落地流程：建表 → `drizzle-kit generate` → migrate → **扩展 `tests/helpers/db.ts` 的 `resetDb()`**（按外键依赖逆序 delete）。
- 事务性副作用走 outbox（先写 outbox 行，worker 异步消费），不要在请求线程里直接发推送/写远端。

## 测试

- 见 `.claude/rules/testing.md`：触库测试必须 `afterAll(closeDb)`，`--runInBand`，严禁指向生产库。
