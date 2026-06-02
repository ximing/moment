# 计划编写约定与跨计划接口契约（Phase 2–8 必读）

本文件是 Phase 2–8 所有实施计划的**强制约定**。目的：7 份计划由不同人/Agent 编写、再由其他 Agent 顺序执行，接口必须严丝合缝。

## 0. 计划文档格式

完全对齐 Phase 1 计划（`2026-08-15-phase1-scaffold-auth.md`）：

- 头部：Goal / Architecture / Tech Stack / Spec 引用 / Global Constraints（只写本计划**新增**的约束，通用约束继承 Phase 1，不要重复抄）。
- 每个 Task：**Files**（Create/Modify/Test 精确路径）、**Interfaces**（Consumes = 依赖的既有符号精确签名；Produces = 后续 Task/计划依赖的符号精确签名）、**Steps**（写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → commit）。
- 代码必须完整可运行；严禁 TBD/TODO/「适当处理」「类似 Task N」等占位。
- 每 Task 一个 commit，conventional commits（`feat(server): ...` / `feat(web): ...` / `feat(app): ...`）。
- 写完自查：spec 覆盖、占位符扫描、跨 Task 类型一致性。

## 1. 代码基线（Phase 1 已落地，可直接引用）

假设 `2026-08-15-phase1-scaffold-auth.md` 已执行完毕。可用符号：

- `@moment/dto`：`registerInputSchema/loginInputSchema/refreshInputSchema`、`AuthTokens/UserProfile/AuthResponse`。
- `@moment/server`：
  - `src/config.ts` → `config`（zod 校验环境；新增环境变量必须同步改这里 + `apps/server/.env.example`）
  - `src/db/index.ts` → `db, pool`；`src/db/schema.ts` → barrel（`export * from './schema/xxx.js'`）
  - `src/utils/logger.ts` → `logger`
  - `src/middlewares/error-handler.ts` → 统一错误结构 `{error:{code,message,details?}}`
  - `src/auth/auth.service.ts` → `AuthService.toProfile(user)` / `getUserEntity(userId)`
  - `src/auth/authorization.ts` → authorizationChecker 已把 `UserProfile` 挂到 `request.user`
  - `createApp()`（helmet/cors/json/routing-controllers routePrefix `/api`/404 兜底）
- 测试基建：`apps/server/tests/helpers/db.ts` → `resetDb()/closeDb()`；jest globalSetup 自动跑迁移；触库测试文件必须 `afterAll(closeDb)`。
- 工程约定：ESM NodeNext，相对 import 带 `.js` 后缀；业务错误抛 `HttpError` 系且 `message` 为 UPPER_SNAKE 机器码。

## 2. 数据表约定

- 主键统一 `char('id', { length: 36 }).primaryKey()`，应用层 `randomUUID()` 生成（`refresh_tokens` 的自增 bigint 是唯一例外）。
- 时间列：`timestamp('xxx', { mode: 'date' })`，`createdAt` 一律 `.notNull().defaultNow()`。
- 软删除仅 `moments`、`comments`（`deleted_at`）；关联/状态表（members、moment_tags、reactions）硬删除。
- 每个新表所在的计划必须：建表 → `drizzle-kit generate` → migrate → **扩展 `resetDb()`（按外键依赖逆序 delete）**。
- 索引严格按 spec §3/§5.1（如 `moments(chain_id, happened_at, id)`、`notifications(user_id, read_at)`）。

## 3. 跨计划接口契约（不得改名/改语义）

### 3.1 链权限（Phase 2 建立，之后所有计划消费）

```ts
// src/chains/chain-policy.ts
export type ChainRole = 'viewer' | 'editor' | 'owner'; // 偏序 viewer < editor < owner
@Service()
export class ChainPolicy {
  /** 不足抛 ForbiddenError('CHAIN_ROLE_INSUFFICIENT')；非成员抛 NotFoundError('CHAIN_NOT_FOUND')。返回实际角色。 */
  require(userId: string, chainId: string, minRole: ChainRole): Promise<ChainRole>;
}
// src/chains/require-chain-role.ts
/** 中间件工厂：@UseBefore(requireChainRole('editor'))。chainId 取自 params.chainId；角色挂 request.chainRole。 */
export function requireChainRole(minRole: ChainRole): RequestHandler;
```

- 链内资源路由**一律嵌套**：`/api/chains/:chainId/moments`、`/api/chains/:chainId/tags` 等。
- 按资源 id 反查链的读接口（如 `GET /api/moments/:id`）在 service 层调 `ChainPolicy.require`。
- controller 内**禁止**手写角色判断。

### 3.2 Outbox（Phase 3 建表 + emit；Phase 5 建 worker 消费）

```ts
// src/outbox/outbox.ts
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** 在业务事务内调用，同事务落 outbox 行（status='pending'）。 */
export async function emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>;
// src/outbox/types.ts — 所有 type 常量集中在此（如 'moment.created'、'comment.created'、'invite.created'）
```

outbox 表列：`id char(36) pk, type varchar(64), payload json, status enum('pending','done','failed') default 'pending', attempts int default 0, next_retry_at timestamp null, created_at, processed_at null`。索引 `(status, next_retry_at)`。

### 3.3 存储（Phase 3 建立，沿用 aimo unified-storage-adapter）

```
src/storage/base.adapter.ts   → UnifiedStorageAdapter 接口 + BaseUnifiedStorageAdapter
src/storage/s3.adapter.ts     → S3 实现（含 multipart）
src/storage/factory.ts        → getStorage(): UnifiedStorageAdapter（按 config 创建的单例）
```

接口方法（实现者可拆分文件，但方法名不得改）：`uploadFile / deleteFile / fileExists / headObject / copyObject / generateAccessUrl(key, meta, expiresIn) / presignPut(key, meta, expiresIn) / initMultipart(key, meta) / presignPart(key, uploadId, partNumber, expiresIn) / completeMultipart(key, uploadId, parts) / abortMultipart(key, uploadId)`。

- key 布局：`{ATTACHMENT_S3_PREFIX}/tmp/{mediaId}.{ext}` → complete 时服务端 copy 到 `{prefix}/chains/{chainId}/{momentId}/{mediaId}.{ext}` 并删 tmp。
- media 行 `storage_meta`（json）记录写入时存储配置；读取一律按行上 meta 签名，不用全局配置。
- 环境变量沿用 `ATTACHMENT_S3_*` + `PRESIGN_GET_TTL_SECONDS`(3600) / `PRESIGN_PUT_TTL_SECONDS`(900)，config.ts 相应扩展。
- **测试策略**：单元/集成测试 mock `UnifiedStorageAdapter`（通过 factory 的可注入点替换）；另提供 `RUN_S3_IT=1` 才跑的真实桶 smoke 测试（默认跳过，用 `describe.skipIf` / 条件跳过），严禁默认测试依赖外部桶状态。

### 3.4 Feed 游标与序列化器（Phase 4 建立，Phase 5 扩展）

- 游标 = base64url(JSON)，`order=happened_at` 时 `{h: <epochMs>, i: <momentId>}`；`order=created_at` 时 `{c: <epochMs>, i: <momentId>}`。解析失败抛 `BadRequestError('INVALID_CURSOR')`。
- `momentSerializer`（`src/moments/moment-serializer.ts`）是 moment → API 响应的**唯一出口**；Phase 5 在其上加批量计数（一次 `GROUP BY`，禁止 N+1）。
- 媒体 URL：响应中 media 只出稳定入口 `/api/media/:id`（相对路径），**不得**内嵌预签名 URL。

### 3.5 dto 扩展约定

每个计划在 `packages/dto/src/` 新增领域文件（`chains.ts`、`moments.ts`、`tags.ts`、`comments.ts`、`notifications.ts`、`share.ts`…），`index.ts` re-export，并配 `*.test.ts`（`tsx --test src/*.test.ts`）。请求 schema 用 zod；响应类型用 interface。

### 3.6 路由总表（各计划严格遵守，避免撞车）

| 计划 | 路由 |
|---|---|
| Phase 2 | `/api/chains*`、`/api/invites/:token/accept`、`/api/invites/:inviteId`（DELETE 吊销） |
| Phase 3 | `/api/chains/:chainId/moments*`、`/api/moments/:id`、`/api/media/*` |
| Phase 4 | `/api/chains/:chainId/tags*`、`/api/tags/:id`（仅 DELETE）、`/api/feed` |
| Phase 5 | `/api/moments/:id/comments*`、`/api/moments/:id/reaction`、`/api/notifications*`、`/api/devices/push-token` |
| Phase 8 | `/api/chains/:chainId/share-links*`、`/api/share-links/:id`、`/api/public/share/:token` |

## 4. 各端测试策略

- server：Jest + supertest 打真实 MySQL 测试库（`.env`，严禁生产库）；外部服务（S3/Expo Push）一律 mock（见 3.3 / Phase 5 的 PushService 注入点）。
- dto / api-client：`tsx --test` 或 vitest（计划作者二选一并在计划中写明），网络层用 msw 或手写 mock fetch。
- web / app：本阶段只做 typecheck + build + lint + 手动验收清单（写进计划的 DoD）；组件测试不进这些计划。

## 5. 计划间依赖顺序（执行方严格按编号顺序执行）

Phase 2 → 3 → 4 → 5 →（6、7 可并行）→ 8。Phase 6/7 依赖 2–5 的 API 全部就绪；Phase 8 依赖 3（media）、5（worker）。
