# Phase 4: 标签与聚合时间线（tags + 复合游标 feed）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地链内标签（tags / moment_tags，含每链 100 上限与硬删级联）、moments 的 tagIds 写路径、跨链聚合 feed（`GET /api/feed`，`chain_id IN (...)` + `(happened_at, id)` 复合游标 + `tag_id` 过滤 + `order=created_at` 补发可见），并把 Phase 3 的链内 moments 列表重构为与 feed 共用同一查询 builder。

**Architecture:** 全部在 `@moment/server` + `@moment/dto`。新增 `src/tags/`（tag CRUD + moment_tags 重建）与 `src/feed/`（游标编解码、共用分页查询 builder、membership 一次加载、feed service/controller）。feed 请求入口一次查出我的 chain_id 集合（不 join `chain_members`），查询走 `moments(chain_id, happened_at, id)` 索引；tagId 过滤以 `moment_tags(tag_id, moment_id)` 为驱动表。序列化统一走 `momentSerializer`/`serializeMoments`（CONVENTIONS §3.4 唯一出口）。

**Tech Stack:** 继承 Phase 1（Express + routing-controllers + TypeDI + Drizzle + mysql2、zod 3、Jest + supertest）。本计划不新增依赖、不新增环境变量。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§3 tags/moment_tags、§4 Tags/Feed API、§5.1 Feed 查询、§5.6 补发可见性、§5.7 删除语义）；`docs/superpowers/plans/CONVENTIONS.md` §3.1/§3.4/§3.5/§3.6。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- tag `name`：trim 后 1–50 字符；`UNIQUE(chain_id, name)` 按**数据库默认排序规则判重（大小写不敏感）**——MySQL 8 默认 `utf8mb4_0900_ai_ci`，`Abc` 与 `abc` 视为重名 → `409 TAG_EXISTS`，与唯一索引行为一致（schema 不指定 collation，不做大小写敏感唯一）；每链上限 100 个，超限 `409 TAG_LIMIT_REACHED`（count-then-insert 为**软限制**，极端并发下可短暂略超 100，可接受，不做锁兜底）；重名 `409 TAG_EXISTS`（唯一索引兜底并发）。
- 每个 moment 最多挂 20 个 tag（`tagIds` 数组 max 20，入库前去重）；moment 上的 tag 必须全部属于该 moment 所在链，否则 `400 TAG_NOT_IN_CHAIN`（事务内校验，整笔回滚）。
- 删除 tag = 一个事务：先硬删 `moment_tags` 关联，再硬删 `tags` 行（spec §5.7）。
- 路由：除 CONVENTIONS §3.6 既有 `GET|POST /api/chains/:chainId/tags*` 外，新增非嵌套 `DELETE /api/tags/:id`（spec §4 明确要求，tagId 由 service 反查链；CONVENTIONS §3.6 Phase 4 行已含 `/api/tags/:id`（仅 DELETE），无需再改）。
- 查询参数命名遵循 spec §4（`cursor` / `chain_ids` / `tag_id` / `order` / `limit`，多词参数 snake_case），dto schema 字段名与之一致；service 层内部变量可保持 camelCase。
- feed：`limit` 1–50 默认 20；`order ∈ {happened_at, created_at}` 默认 `happened_at`；游标 opaque = base64url(JSON)（CONVENTIONS §3.4：`{h, i}` / `{c, i}`），编解码只允许存在于 `src/feed/cursor.ts`，feed 与链内列表共用，不得各自实现；解析失败 `400 INVALID_CURSOR`。边界划分（Phase 5/8 复用时同一约定）：空串（`?cursor=`）与超长（>1024）游标属 **schema 校验错 → `400 VALIDATION_ERROR`**（`min(1)`/`max(1024)` 拦截）；仅「通过 schema 校验但格式解码失败」（非 base64 / 非 JSON / 字段类型错）才走 `INVALID_CURSOR`。
- feed 权限：请求入口一次查出「我的 chain_id + role」集合（复用 `chain_members` 查询），feed 主查询**禁止 join `chain_members`**（spec §5.1）；`chain_ids` 参数只允许收窄到我的链，含非我的链 id 时**静默过滤**（不向探测者泄露链存在性，也不报错）。
- `tag_id` 过滤以 `moment_tags(tag_id, moment_id)` 为驱动表（子查询 semi-join），禁止先查全量 moments 再内存过滤。
- 序列化：moment → API 响应只经 `momentSerializer` / `serializeMoments`（`src/moments/moment-serializer.ts`）；本计划给 `MomentResponse` 增加 `tags: TagBrief[]`，Phase 5 的批量计数继续加在同一出口，禁止 N+1。
- 软删 moments（`deleted_at` 非空）不出现在 tag 计数、feed、链内列表。
- 触库测试文件必须 `beforeEach(resetDb)` + `afterAll(closeDb)`；`tags`/`moment_tags` 建表后必须扩展 `tests/helpers/db.ts` 的 `resetDb()`。

## Phase 2/3 依赖契约（本计划消费的既有符号，不得改名）

以下符号假设已由 Phase 2/3 计划落地（语义见 CONVENTIONS §3）。执行时若实际代码与本清单有出入，以 CONVENTIONS §3 的签名为准做等价移植，**禁止改公共符号名**。

```ts
// apps/server/src/chains/chain-policy.ts（CONVENTIONS §3.1）
export type ChainRole = 'viewer' | 'editor' | 'owner';
@Service()
export class ChainPolicy {
  /** 不足抛 ForbiddenError('CHAIN_ROLE_INSUFFICIENT')；非成员抛 NotFoundError('CHAIN_NOT_FOUND')。返回实际角色。 */
  require(userId: string, chainId: string, minRole: ChainRole): Promise<ChainRole>;
}
// apps/server/src/chains/require-chain-role.ts
export function requireChainRole(minRole: ChainRole): RequestHandler; // chainId 取自 params.chainId

// apps/server/src/db/schema/chains.ts
export const chains: { id; name; ownerId; visibility; /* ... */ };
export const chainMembers: { chainId; userId; role: 'owner'|'editor'|'viewer'; joinedAt };

// apps/server/src/db/schema/moments.ts
export const moments; // 列：id, chainId, authorId, type, content, happenedAt, happenedTzOffset, isBackfill, createdAt, updatedAt, deletedAt；索引 (chain_id, happened_at, id)
export type Moment = typeof moments.$inferSelect;

// apps/server/src/outbox/outbox.ts（CONVENTIONS §3.2）
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>;

// packages/dto/src/moments.ts
export const createMomentInputSchema; // { type:'text'|'media'|'video', content, happenedAt(ISO), happenedTzOffset, isBackfill?, mediaIds? }
export const updateMomentInputSchema; // { content?, happenedAt?, happenedTzOffset?, mediaIds? }
export const listMomentsQuerySchema;  // { cursor?, limit }（默认 limit 20）
export interface MomentResponse;      // 见 Task 4（本计划加 tags 字段）
export interface MomentListResponse;  // { moments: MomentResponse[]; nextCursor: string | null }

// apps/server/src/moments/moment.service.ts
@Service()
export class MomentService {
  /** create 内部单事务：插 moment + 绑定 media + emitOutbox('moment.created')（spec §3 事务边界）。 */
  create(chainId: string, input: CreateMomentInput, authorId: string): Promise<MomentResponse>;
  /** update 内部单事务：更新 moment（+ media 重建）+ emitOutbox；仅作者或 owner 可改（Phase 3 已实现）。 */
  update(momentId: string, input: UpdateMomentInput, authorId: string): Promise<MomentResponse>;
  list(chainId: string, query: { cursor?: string; limit: number }): Promise<MomentListResponse>;
  get(momentId: string, userId: string): Promise<MomentResponse>; // service 层 ChainPolicy.require('viewer')
}

// apps/server/src/moments/moment-serializer.ts（CONVENTIONS §3.4）
export function momentSerializer(moment: Moment): MomentResponse;

// HTTP（Phase 3）：POST /api/chains/:chainId/moments（editor+）、GET /api/chains/:chainId/moments（viewer+）、
// GET|PATCH|DELETE /api/moments/:id；DELETE 为软删（置 deleted_at）。
// controllers 统一注册在 apps/server/src/app.ts 的 controllers 数组。
```

**`requireChainRole` 的两个前置要求（routing-controllers 0.11 执行顺序所致，Task 3 的 TagController 依赖）：**
0.11 中 `@Authorized` 的 authorization 检查发生在 route handler 执行链内（`routeHandler` 包装的 `execute` 里），**晚于 `beforeMiddlewares`（`@UseBefore`）执行** —— 即 `@UseBefore(requireChainRole(...))` 运行时 **authorizationChecker 还没跑、`request.user` 尚未挂上**（对携带合法 token 的请求也一样）。注意机制：authorization 不是一个排在 beforeMiddlewares 之后的独立 middleware 槽位，排查其他装饰器顺序问题时不要按此图外推。因此本计划消费的 `requireChainRole` 必须：

1. **自己解析 `Authorization: Bearer <token>` 取 userId**（复用 Phase 2 的 token→userId 逻辑），不读 `request.user`；
2. **取不到 userId 时（匿名或 token 解析失败）直接 `next()` 放行**，把 401 留给 `@Authorized()` 产生；取到 userId 后再按 CONVENTIONS §3.1 的语义判角色（不足 403 `CHAIN_ROLE_INSUFFICIENT`、非成员 404 `CHAIN_NOT_FOUND`）。
3. **错误必须经 `next(err)` 传递**：Express 4 不捕获 async middleware 的 promise rejection。移植/改写时，`ChainPolicy.require(...)` 等会抛错的 await 调用必须 try/catch 后 `next(err)`（或写成非 async、手动 `.catch(next)`），严禁写成 async 函数内直接 throw——否则 403/404 路径的请求会挂起（supertest 超时而非收到错误响应）。
4. **已知语义瑕疵（接受并记录）**：该中间件自解析 token 取 userId，通常不检查 `passwordChangedAt`（取决于 Phase 2 的 token→userId 逻辑是否含吊销检查）——改密后的旧 access token 会先命中 403/404 而非 401（`@Authorized` 的吊销检查到不了）。本计划接受该瑕疵；核对 Phase 2 实现时一并检查其 token 解析是否校验 `passwordChangedAt`，并在执行记录中注明现状。

执行 Task 3 前先核对 Phase 2 的 `require-chain-role.ts` 实现是否满足以上两点；不满足则按 CONVENTIONS §3.1 的签名做**等价移植（改实现不改签名）**，禁止改公共符号名。

---

### Task 1: tags + moment_tags 表、迁移与 resetDb 扩展

**Files:**
- Create: `apps/server/src/db/schema/tags.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 加一行）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 扩展）
- Create: `apps/server/drizzle/000X_*.sql`（`drizzle-kit generate` 产物）

**Interfaces:**
- Consumes: `chains`/`moments` 表对象（Phase 2/3 契约）。
- Produces（Task 3/4/6 依赖，不得改名）:
  - `tags` 表对象（列：`id/chainId/name/createdAt`；`UNIQUE(chain_id, name)`）
  - `momentTags` 表对象（列：`momentId/tagId`；联合主键 `(moment_id, tag_id)` + 索引 `(tag_id, moment_id)`）
  - `Tag` 类型（`typeof tags.$inferSelect`）
  - `resetDb()` 扩展后能清空 `moment_tags`/`tags`

- [ ] **Step 1: 写表定义**

`apps/server/src/db/schema/tags.ts`：
```ts
import {
  char,
  index,
  mysqlTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { moments } from './moments.js';

export const tags = mysqlTable(
  'tags',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    name: varchar('name', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_tags_chain_name').on(t.chainId, t.name)],
);

export const momentTags = mysqlTable(
  'moment_tags',
  {
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    tagId: char('tag_id', { length: 36 })
      .notNull()
      .references(() => tags.id),
  },
  (t) => [
    primaryKey({ columns: [t.momentId, t.tagId] }),
    // feed tagId 过滤的驱动索引：以 (tag_id, moment_id) 圈出小结果集再回表（spec §5.1）
    index('idx_moment_tags_tag_moment').on(t.tagId, t.momentId),
  ],
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type MomentTag = typeof momentTags.$inferSelect;
```

`apps/server/src/db/schema.ts` 追加一行（保留既有行）：
```ts
export * from './schema/tags.js';
```

- [ ] **Step 2: 扩展 resetDb**

`apps/server/tests/helpers/db.ts`：import 区加：
```ts
import { momentTags, tags } from '../../src/db/schema.js';
```
`resetDb()` 函数体**最前面**（第一个 `delete` 之前）插入两行（`moment_tags` 是全库最叶子表，先清它永远是安全的；`tags` 引用 `chains`，先于 `chains` 清理也安全）：
```ts
  await db.delete(momentTags);
  await db.delete(tags);
```

- [ ] **Step 3: 生成迁移并跑通**

确认 `apps/server/.env` 指向测试库后：
Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成新 `drizzle/000X_*.sql`（`CREATE TABLE tags` / `CREATE TABLE moment_tags`，含 `uk_tags_chain_name` 与 `idx_moment_tags_tag_moment`）；输出 `migrations applied`。

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有测试全部 PASS（globalSetup 重跑迁移，`resetDb` 新增 delete 不影响无表外场景）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): tags 与 moment_tags 表、迁移与 resetDb 扩展"
```

---

### Task 2: packages/dto — tags schema 与类型（TDD）

**Files:**
- Test: `packages/dto/src/tags.test.ts`
- Create: `packages/dto/src/tags.ts`
- Modify: `packages/dto/src/index.ts`（re-export）

**Interfaces:**
- Produces（Task 3/4/6 依赖，不得改名）:
  - `tagCreateInputSchema` / `TagCreateInput`（name trim 后 1–50）
  - `TagBrief = { id: string; name: string }`（挂在 moment 上的最小 tag 视图）
  - `TagResponse = { id: string; name: string; momentCount: number; createdAt: string }`
  - `TagListResponse = { tags: TagResponse[] }`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/tags.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tagCreateInputSchema } from './tags.js';

test('tagCreateInputSchema trim 名称', () => {
  const input = tagCreateInputSchema.parse({ name: '  周岁  ' });
  assert.equal(input.name, '周岁');
});

test('tagCreateInputSchema 拒绝空名', () => {
  assert.throws(() => tagCreateInputSchema.parse({ name: '   ' }));
});

test('tagCreateInputSchema 拒绝超长名（>50）', () => {
  assert.throws(() => tagCreateInputSchema.parse({ name: 'x'.repeat(51) }));
});

test('tagCreateInputSchema 接受 50 字符名', () => {
  const input = tagCreateInputSchema.parse({ name: 'x'.repeat(50) });
  assert.equal(input.name.length, 50);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './tags.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/tags.ts`：
```ts
import { z } from 'zod';

export const tagCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
export type TagCreateInput = z.infer<typeof tagCreateInputSchema>;

/** 挂在 moment 响应上的最小 tag 视图。 */
export interface TagBrief {
  id: string;
  name: string;
}

/** 链内 tag 列表项（momentCount 不含软删 moment）。 */
export interface TagResponse {
  id: string;
  name: string;
  momentCount: number;
  /** ISO 8601 */
  createdAt: string;
}

export interface TagListResponse {
  tags: TagResponse[];
}
```

`packages/dto/src/index.ts` 追加一行（保留既有行）：
```ts
export * from './tags.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 4 个新测试 PASS，既有测试 PASS，`dist/tags.d.ts` 生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): tags schema 与 TagBrief/TagResponse 类型"
```

---

### Task 3: tag service + controller（TDD：CRUD / 上限 / 重名 / 级联删 / 权限）

**Files:**
- Create: `apps/server/tests/helpers/fixtures.ts`
- Test: `apps/server/tests/tags/tags.test.ts`
- Create: `apps/server/src/tags/tag.service.ts`、`apps/server/src/tags/tag.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 数组加 `TagController`）

**Interfaces:**
- Consumes: `tags`/`momentTags`/`moments`/`chainMembers` 表、`ChainPolicy`/`requireChainRole`（CONVENTIONS §3.1）、Task 2 的 dto。
- Produces:
  - `class TagService`（`@Service()`）：
    - `list(chainId: string): Promise<TagListResponse>`（含每 tag moment 数，一次 GROUP BY，软删不计入）
    - `create(chainId: string, input: TagCreateInput): Promise<TagResponse>`（上限 100 → `HttpError(409,'TAG_LIMIT_REACHED')`；重名 → `HttpError(409,'TAG_EXISTS')`）
    - `remove(tagId: string, userId: string): Promise<void>`（反查链 → `ChainPolicy.require(userId, chainId, 'editor')` → 单事务先删 `moment_tags` 再删 `tags`；不存在 → `NotFoundError('TAG_NOT_FOUND')`）
  - HTTP：`GET /api/chains/:chainId/tags`（viewer+）、`POST /api/chains/:chainId/tags`（editor+，201）、`DELETE /api/tags/:id`（editor+，204）

- [ ] **Step 1: 测试 fixtures（本 Task 及 Task 4/6 共用）**

`apps/server/tests/helpers/fixtures.ts`：
```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, momentTags, moments } from '../../src/db/schema.js';

export const app = createApp();

let seq = 0;

/** 走真实 API 注册，拿到 userId 与可用 access token。 */
export async function registerUser(): Promise<{ id: string; token: string }> {
  const email = `u${++seq}-${Date.now()}-${randomUUID().slice(0, 8)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: `user${seq}` });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}

/** 直插链 + owner 成员行（绕过邀请流程，测试只关心权限判定本身）。 */
export async function createChain(ownerId: string, name = '测试链'): Promise<string> {
  const id = randomUUID();
  await db.insert(chains).values({ id, name, ownerId, visibility: 'private' });
  await db.insert(chainMembers).values({ chainId: id, userId: ownerId, role: 'owner', joinedAt: new Date() });
  return id;
}

export async function addMember(
  chainId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  await db.insert(chainMembers).values({ chainId, userId, role, joinedAt: new Date() });
}

/** 直插 moment（feed/标签测试需要精确控制 happenedAt/createdAt/deletedAt）。 */
export async function insertMoment(opts: {
  chainId: string;
  authorId: string;
  happenedAt: Date;
  createdAt?: Date;
  content?: string;
  isBackfill?: boolean;
  deletedAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const at = opts.createdAt ?? new Date();
  await db.insert(moments).values({
    id,
    chainId: opts.chainId,
    authorId: opts.authorId,
    type: 'text',
    content: opts.content ?? '内容',
    happenedAt: opts.happenedAt,
    happenedTzOffset: 0,
    isBackfill: opts.isBackfill ?? false,
    createdAt: at,
    updatedAt: at,
    deletedAt: opts.deletedAt ?? null,
  });
  return id;
}

/** 直插 moment-tag 关联。 */
export async function attachTag(momentId: string, tagId: string): Promise<void> {
  await db.insert(momentTags).values({ momentId, tagId });
}
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/tags/tags.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentTags } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 标准三人场景：owner + viewer 在链内，outsider 在链外。 */
async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  return { owner, viewer, outsider, chainId };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/chains/:chainId/tags', () => {
  it('viewer 可读，返回每 tag 的 moment 数（软删不计入），按 name 排序', async () => {
    const { owner, viewer, chainId } = await setup();
    const t1 = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'b-tag' });
    const t2 = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'a-tag' });
    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);

    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-02T00:00:00Z') });
    const m3 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-01-03T00:00:00Z'), deletedAt: new Date(),
    });
    await attachTag(m1, t1.body.id);
    await attachTag(m2, t1.body.id);
    await attachTag(m3, t1.body.id); // 软删 moment，不应计数

    const res = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.tags.map((t: { name: string }) => t.name)).toEqual(['a-tag', 'b-tag']);
    const bTag = res.body.tags.find((t: { name: string }) => t.name === 'b-tag');
    expect(bTag.momentCount).toBe(2);
    expect(typeof bTag.createdAt).toBe('string');
  });

  it('非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const { viewer, outsider, chainId } = await setup();
    const forbidden = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(outsider.token));
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/tags`);
    expect(anon.status).toBe(401);
    void viewer;
  });
});

describe('POST /api/chains/:chainId/tags', () => {
  it('editor 创建 201；owner 亦可；重名 409 TAG_EXISTS', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');

    const created = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(editor.token)).send({ name: '周岁' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('周岁');
    expect(created.body.momentCount).toBe(0);
    expect(created.body.id).toBeTruthy();

    const byOwner = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '另一个' });
    expect(byOwner.status).toBe(201);

    const dup = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '周岁' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TAG_EXISTS');
  });

  it('viewer 403；非成员 404；空名 400 VALIDATION_ERROR（用 owner，权限中间件先于 zod parse，viewer 到不了校验层）', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const forbidden = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(viewer.token)).send({ name: 'x' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const notMember = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(outsider.token)).send({ name: 'x' });
    expect(notMember.status).toBe(404);

    // 注意：空名校验用例必须用 editor+ 身份（owner），否则会被 requireChainRole 先拦成 403
    const badBody = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '' });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('每链第 101 个 tag 返回 409 TAG_LIMIT_REACHED', async () => {
    const { owner, chainId } = await setup();
    for (let i = 0; i < 100; i++) {
      const res = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: `tag-${i}` });
      expect(res.status).toBe(201);
    }
    const over = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'tag-100' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('TAG_LIMIT_REACHED');
  });
});

describe('DELETE /api/tags/:id', () => {
  it('editor 可删：先硬删 moment_tags 关联再删 tag，一个事务', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const tag = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '游泳' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachTag(momentId, tag.body.id);

    const res = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(editor.token));
    expect(res.status).toBe(204);

    const links = await db.select().from(momentTags).where(eq(momentTags.tagId, tag.body.id));
    expect(links).toHaveLength(0);
    const list = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(owner.token));
    expect(list.body.tags).toHaveLength(0);
  });

  it('viewer 403；非成员 404 CHAIN_NOT_FOUND；不存在 404 TAG_NOT_FOUND', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const tag = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 't' });

    const asViewer = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(viewer.token));
    expect(asViewer.status).toBe(403);

    const asOutsider = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(outsider.token));
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app).delete(`/api/tags/00000000-0000-4000-8000-000000000000`).set(auth(owner.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TAG_NOT_FOUND');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`Cannot find module '../../src/tags/tag.service.js'` 或路由 404）

- [ ] **Step 4: 实现**

`apps/server/src/tags/tag.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { TagCreateInput, TagListResponse, TagResponse } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { momentTags, moments, tags, type Tag } from '../db/schema.js';

const MAX_TAGS_PER_CHAIN = 100;

@Service()
export class TagService {
  constructor(private policy: ChainPolicy) {}

  /** 一次 GROUP BY 取全部 tag + moment 数（软删 moment 不计入），禁止 N+1。 */
  async list(chainId: string): Promise<TagListResponse> {
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        createdAt: tags.createdAt,
        momentCount: sql<number>`count(${moments.id})`,
      })
      .from(tags)
      .leftJoin(momentTags, eq(momentTags.tagId, tags.id))
      .leftJoin(moments, and(eq(moments.id, momentTags.momentId), isNull(moments.deletedAt)))
      .where(eq(tags.chainId, chainId))
      .groupBy(tags.id)
      .orderBy(asc(tags.name));
    return {
      tags: rows.map((r) => ({
        id: r.id,
        name: r.name,
        momentCount: Number(r.momentCount),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async create(chainId: string, input: TagCreateInput): Promise<TagResponse> {
    // 权限由 controller 的 requireChainRole('editor') 保证，这里不再判断角色
    const [{ value: existing }] = await db
      .select({ value: count() })
      .from(tags)
      .where(eq(tags.chainId, chainId));
    if (Number(existing) >= MAX_TAGS_PER_CHAIN) {
      throw new HttpError(409, 'TAG_LIMIT_REACHED');
    }

    const [dup] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.chainId, chainId), eq(tags.name, input.name)))
      .limit(1);
    if (dup) throw new HttpError(409, 'TAG_EXISTS');

    const row: Tag = { id: randomUUID(), chainId, name: input.name, createdAt: new Date() };
    try {
      await db.insert(tags).values(row);
    } catch (err) {
      // 并发下唯一索引兜底：两个请求同时穿过前置检查
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'TAG_EXISTS');
      throw err;
    }
    return { id: row.id, name: row.name, momentCount: 0, createdAt: row.createdAt.toISOString() };
  }

  /**
   * DELETE /api/tags/:id 非嵌套路由：service 层反查链后走 ChainPolicy（CONVENTIONS §3.1）。
   * 注：tag 不存在 → TAG_NOT_FOUND，tag 存在但非成员 → CHAIN_NOT_FOUND，同为 404；探测者理论上
   * 可据此区分 tag 是否存在，泄露面极小，本计划显式声明该差异可接受，不归并。
   */
  async remove(tagId: string, userId: string): Promise<void> {
    const [tag] = await db.select().from(tags).where(eq(tags.id, tagId)).limit(1);
    if (!tag) throw new NotFoundError('TAG_NOT_FOUND');
    await this.policy.require(userId, tag.chainId, 'editor');

    await db.transaction(async (tx) => {
      // 硬删语义（spec §5.7）：先清 moment_tags 关联，再删 tag，一个事务
      await tx.delete(momentTags).where(eq(momentTags.tagId, tagId));
      await tx.delete(tags).where(eq(tags.id, tagId));
    });
  }
}
```

`apps/server/src/tags/tag.controller.ts`：
```ts
import { tagCreateInputSchema, type TagListResponse, type TagResponse, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Params,
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js'; // 0.11 中 @UseBefore 先于 @Authorized 执行：前置契约见「Phase 2/3 依赖契约」
import { TagService } from './tag.service.js';

@JsonController()
@Service()
export class TagController {
  constructor(private tagService: TagService) {}

  @Get('/chains/:chainId/tags')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Params() params: { chainId: string }): Promise<TagListResponse> {
    return this.tagService.list(params.chainId);
  }

  @Post('/chains/:chainId/tags')
  @Authorized()
  @HttpCode(201)
  @UseBefore(requireChainRole('editor'))
  create(@Params() params: { chainId: string }, @Body() body: unknown): Promise<TagResponse> {
    return this.tagService.create(params.chainId, tagCreateInputSchema.parse(body));
  }

  /** 非嵌套路由，chainId 由 service 反查，角色校验在 service 层 ChainPolicy（CONVENTIONS §3.1）。 */
  @Delete('/tags/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Params() params: { id: string }, @CurrentUser() user: UserProfile): Promise<void> {
    return this.tagService.remove(params.id, user.id);
  }
}
```

`apps/server/src/app.ts` 修改点：import 区加：
```ts
import { TagController } from './tags/tag.controller.js';
```
`controllers: [...]` 数组中加入 `TagController`（保留既有项）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: tags 7 个用例 PASS，既有全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): tag CRUD（每链上限/重名/级联硬删/链权限）"
```

---

### Task 4: moments 集成 tagIds（dto 扩展 + serializer 批量化 + 事务内重建 moment_tags）（TDD）

**Files:**
- Modify: `packages/dto/src/moments.ts`（create/update schema 加 `tagIds`；`MomentResponse` 加 `tags`）
- Modify: `apps/server/src/moments/moment-serializer.ts`（签名加 extras；新增 `serializeMoments`）
- Create: `apps/server/src/tags/replace-moment-tags.ts`
- Modify: `apps/server/src/moments/moment.service.ts`（create/update 事务内调用；单条响应用 `serializeMoments`）
- Modify: `apps/server/tests/moments/moment-serializer.test.ts`（Phase 3 的三参 `momentSerializer(m, media, author)` 调用同步迁移为 extras 形式，否则新签名下 tsc 编译失败）
- Test: `packages/dto/src/moments-tags.test.ts`、`apps/server/tests/moments/moment-tags.test.ts`

**Interfaces:**
- Consumes: Phase 3 契约（`createMomentInputSchema`/`updateMomentInputSchema`/`MomentResponse`/`momentSerializer`/`MomentService`/`DbTx`）、Task 1/2 产物。
- Produces（Task 6/7 及 Phase 5 依赖，不得改名）:
  - `createMomentInputSchema`/`updateMomentInputSchema` 新增可选 `tagIds: string[]`（uuid，max 20）
  - `MomentResponse` 新增 `tags: TagBrief[]`
  - `momentSerializer(moment: Moment, extras?: { tags?: TagBrief[] }): MomentResponse`（第二参可选，默认 `tags: []`。注意：Phase 3 终态是 `(m, media, author)` **三参**签名而非单参，本 Task 的签名变更是破坏性的——`tests/moments/moment-serializer.test.ts` 的三参调用必须同步迁移为 extras 形式（Files 已列入），`moment.service` 的直接调用则由本 Task 改走 `serializeMoments`）
  - `serializeMoments(rows: Moment[]): Promise<MomentResponse[]>`（`src/moments/moment-serializer.ts`；tag 一次 `inArray` 批量查，禁止 N+1）
  - `replaceMomentTags(tx: DbTx, momentId: string, chainId: string, tagIds: string[]): Promise<void>`（`src/tags/replace-moment-tags.ts`；全量校验属于该链，否则 `BadRequestError('TAG_NOT_IN_CHAIN')`，在调用方事务内执行）

- [ ] **Step 1: 写 dto 失败测试**

`packages/dto/src/moments-tags.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentInputSchema, updateMomentInputSchema } from './moments.js';

const baseInput = {
  type: 'text' as const,
  content: '内容',
  happenedAt: '2026-01-01T00:00:00.000Z',
  happenedTzOffset: -480,
};

test('createMomentInputSchema 接受合法 tagIds 且去重由服务端处理', () => {
  const input = createMomentInputSchema.parse({
    ...baseInput,
    tagIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
  });
  assert.equal(input.tagIds?.length, 2);
});

test('createMomentInputSchema 的 tagIds 可省略', () => {
  const input = createMomentInputSchema.parse(baseInput);
  assert.equal(input.tagIds, undefined);
});

test('createMomentInputSchema 拒绝非 uuid 的 tagId', () => {
  assert.throws(() => createMomentInputSchema.parse({ ...baseInput, tagIds: ['not-a-uuid'] }));
});

test('createMomentInputSchema 拒绝超过 20 个 tag', () => {
  const tagIds = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.throws(() => createMomentInputSchema.parse({ ...baseInput, tagIds }));
});

test('updateMomentInputSchema 接受仅含 tagIds 的部分更新', () => {
  const input = updateMomentInputSchema.parse({
    tagIds: ['00000000-0000-4000-8000-000000000003'],
  });
  assert.deepEqual(input.tagIds, ['00000000-0000-4000-8000-000000000003']);
});
```

- [ ] **Step 2: 运行确认 dto 失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`tagIds` 不存在于 schema，parse 抛 ZodError）

- [ ] **Step 3: 实现 dto 扩展**

`packages/dto/src/moments.ts` 修改点（在既有文件上做五处增量）：

1. import 区加：
```ts
import type { TagBrief } from './tags.js';
```
2. 文件内新增共享片段（放在 schema 定义之前）：
```ts
const uuidSchema = z.string().uuid();
export const momentTagIdsSchema = z.array(uuidSchema).max(20);
```
3. `createMomentInputSchema` 的对象字面量中追加一个字段：
```ts
  tagIds: momentTagIdsSchema.optional(),
```
4. `updateMomentInputSchema` 的对象字面量中追加一个字段：
```ts
  tagIds: momentTagIdsSchema.optional(),
```
5. `MomentResponse` 接口追加一个字段：
```ts
  /** moment 上的标签（同一 moment 内按 tagId 升序——确定性排序，非插入顺序） */
  tags: TagBrief[];
```

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: dto 全部 PASS（含 Step 1 的 5 个）。

- [ ] **Step 4: 写 server 失败测试**

`apps/server/tests/moments/moment-tags.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentTags, moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const editor = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, editor.id, 'editor');
  return { owner, editor, chainId };
}

async function createTag(chainId: string, token: string, name: string): Promise<string> {
  const res = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const momentBody = (tagIds: string[]) => ({
  type: 'text',
  content: '一条 moment',
  happenedAt: '2026-01-01T00:00:00.000Z',
  happenedTzOffset: -480,
  tagIds,
});

describe('POST /api/chains/:chainId/moments 携带 tagIds', () => {
  it('创建成功且响应含 tags；moment_tags 落库', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const tagB = await createTag(chainId, editor.token, 'B');

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA, tagB]));
    expect(res.status).toBe(201);
    expect(res.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['A', 'B']);

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, res.body.id));
    expect(links.map((l) => l.tagId).sort()).toEqual([tagA, tagB].sort());
  });

  it('tagIds 去重后入库；空数组等同无 tag', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');

    const dup = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA, tagA]));
    expect(dup.status).toBe(201);
    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, dup.body.id));
    expect(links).toHaveLength(1);

    const none = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([]));
    expect(none.status).toBe(201);
    expect(none.body.tags).toEqual([]);
  });

  it('引用其他链的 tag 返回 400 TAG_NOT_IN_CHAIN 且整笔回滚（moment 不落库）', async () => {
    const { editor, chainId } = await setup();
    const otherOwner = await registerUser();
    const otherChain = await createChain(otherOwner.id);
    const foreignTag = await createTag(otherChain, otherOwner.token, '别人的');

    const before = await db.select({ id: moments.id }).from(moments);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([foreignTag]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TAG_NOT_IN_CHAIN');

    const after = await db.select({ id: moments.id }).from(moments);
    expect(after).toHaveLength(before.length);
  });
});

describe('PATCH /api/moments/:id 携带 tagIds', () => {
  it('tagIds 全量重建关联；不传 tagIds 则保持不变', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const tagB = await createTag(chainId, editor.token, 'B');

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;

    const patched = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(editor.token))
      .send({ tagIds: [tagB] });
    expect(patched.status).toBe(200);
    expect(patched.body.tags.map((t: { id: string }) => t.id)).toEqual([tagB]);

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(links.map((l) => l.tagId)).toEqual([tagB]);

    // 不带 tagIds 的部分更新不动 moment_tags
    await request(app).patch(`/api/moments/${momentId}`).set(auth(editor.token)).send({ content: '改内容' });
    const linksAfter = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(linksAfter.map((l) => l.tagId)).toEqual([tagB]);
  });

  it('PATCH 引用他链 tag 返回 400 TAG_NOT_IN_CHAIN 且关联不被破坏', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const otherOwner = await registerUser();
    const otherChain = await createChain(otherOwner.id);
    const foreignTag = await createTag(otherChain, otherOwner.token, '别人的');

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    const momentId = created.body.id as string;

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(editor.token))
      .send({ tagIds: [foreignTag] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TAG_NOT_IN_CHAIN');

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(links.map((l) => l.tagId)).toEqual([tagA]);
  });
});

describe('GET /api/moments/:id 响应含 tags', () => {
  it('详情返回 tags 数组', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    const momentId = created.body.id as string;

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(editor.token));
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([{ id: tagA, name: 'A' }]);
  });
});
```

- [ ] **Step 5: 运行确认 server 失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`res.body.tags` 为 undefined；`TAG_NOT_IN_CHAIN` 用例收到 201）

- [ ] **Step 6: 实现**

`apps/server/src/tags/replace-moment-tags.ts`（新建）：
```ts
import { and, eq, inArray } from 'drizzle-orm';
import { BadRequestError } from 'routing-controllers';
import { momentTags, tags } from '../db/schema.js';
import type { DbTx } from '../outbox/outbox.js';

/**
 * 在调用方业务事务内全量重建 moment_tags（先删后插）。
 * 校验所有 tag 均属于 chainId，否则抛 TAG_NOT_IN_CHAIN，由事务回滚整笔操作。
 */
export async function replaceMomentTags(
  tx: DbTx,
  momentId: string,
  chainId: string,
  tagIds: string[],
): Promise<void> {
  await tx.delete(momentTags).where(eq(momentTags.momentId, momentId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;

  const found = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, unique), eq(tags.chainId, chainId)));
  if (found.length !== unique.length) {
    throw new BadRequestError('TAG_NOT_IN_CHAIN');
  }

  await tx.insert(momentTags).values(unique.map((tagId) => ({ momentId, tagId })));
}
```

`apps/server/src/moments/moment-serializer.ts` 修改点：

1. import 区加：
```ts
import type { TagBrief } from '@moment/dto';
import { asc, eq, inArray } from 'drizzle-orm';
import { momentTags, tags } from '../db/schema.js';
import { db } from '../db/index.js';
```
2. `momentSerializer` 签名与返回值修改（保留 Phase 3 既有字段映射不动，只加第二参与 tags 字段）。**执行时逐字段保留 Phase 3 的原映射（含 happenedTzOffset、media 等全部既有字段，一个不漏），仅追加 `tags` 字段**——下方 `...` 仅为篇幅省略，不是可重写映射的许可：
```ts
export function momentSerializer(
  moment: Moment,
  extras: { tags?: TagBrief[] } = {},
): MomentResponse {
  return {
    // 执行时逐字段原样保留 Phase 3 的映射（禁止借机重写/漏字段），再追加：
    tags: extras.tags ?? [],
  };
}
```
3. 文件末尾新增批量序列化出口（feed / 链内列表 / 详情统一走它，tag 一次 `inArray` 查出，禁止 N+1）：
```ts
/** 批量序列化：一次查出所有涉及 moment 的 tag（CONVENTIONS §3.4 唯一出口，Phase 5 在此加批量计数）。 */
export async function serializeMoments(rows: Moment[]): Promise<MomentResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const tagRows = await db
    .select({ momentId: momentTags.momentId, id: tags.id, name: tags.name })
    .from(momentTags)
    .innerJoin(tags, eq(tags.id, momentTags.tagId))
    .where(inArray(momentTags.momentId, ids))
    // MySQL 不保证无 ORDER BY 的返回顺序：显式排序保证每个 moment 的 tags 顺序确定（tagId 升序）
    .orderBy(asc(momentTags.momentId), asc(momentTags.tagId));
  const byMoment = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = byMoment.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    byMoment.set(t.momentId, list);
  }
  return rows.map((r) => momentSerializer(r, { tags: byMoment.get(r.id) ?? [] }));
}
```

`apps/server/src/moments/moment.service.ts` 修改点（对 Phase 3 已落地代码做四处增量）：

1. import 区加：
```ts
import { replaceMomentTags } from '../tags/replace-moment-tags.js';
import { serializeMoments } from './moment-serializer.js';
```
（若 `momentSerializer` 已 import，保留即可，二者并存。）

2. `create` 方法改造。**硬性要求：`serializeMoments` 必须在 `await db.transaction(...)` 返回之后（事务已提交）调用，严禁放在事务回调内**——`replaceMomentTags` 用 `tx` 在事务内写 `moment_tags`，而 `serializeMoments` 内部走全局 `db`（独立连接），MySQL REPEATABLE READ 下读不到未提交行，序列化若留在回调内，create 响应的 `tags` 恒为 `[]`。做法：让事务回调 return 插入后的 moment 行（变量统一命名 `created`，不用 Phase 3 的旧名），事务外再序列化。改造后的完整方法骨架（注释处为 Phase 3 既有逻辑，原样保留）：
```ts
  async create(chainId: string, input: CreateMomentInput, authorId: string): Promise<MomentResponse> {
    const created = await db.transaction(async (tx) => {
      // ...Phase 3 既有：插入 moment、绑定 media（逻辑原样保留）...
      const inserted /*: Moment */ = /* 插入后的 moment 行（Phase 3 既有的返回行或事务内重查） */;
      await replaceMomentTags(tx, inserted.id, chainId, input.tagIds ?? []); // emitOutbox 之前
      // ...Phase 3 既有：emitOutbox(tx, 'moment.created', ...)（原样保留）...
      return inserted;
    });
    return (await serializeMoments([created]))[0]; // 只能在事务提交之后
  }
```

3. `update` 方法改造，事务边界要求同上（**序列化必须在事务提交之后**，变量统一命名 `updated`）。在既有事务回调内、`emitOutbox(...)` **之前**追加（`tagIds` 未传 = 不动关联，传了 = 全量重建）：
```ts
      if (input.tagIds !== undefined) {
        await replaceMomentTags(tx, updated.id, updated.chainId, input.tagIds);
      }
```
改造后的完整方法骨架：
```ts
  async update(momentId: string, input: UpdateMomentInput, authorId: string): Promise<MomentResponse> {
    const updated = await db.transaction(async (tx) => {
      // ...Phase 3 既有：作者/owner 校验后的 moment 更新 + media 重建（逻辑原样保留）...
      if (input.tagIds !== undefined) {
        await replaceMomentTags(tx, updatedRow.id, updatedRow.chainId, input.tagIds); // emitOutbox 之前
      }
      // ...Phase 3 既有：emitOutbox(tx, ...)（原样保留）...
      return updatedRow /* 更新后的 moment 行（Phase 3 既有的返回行或事务内重查） */;
    });
    return (await serializeMoments([updated]))[0]; // 只能在事务提交之后
  }
```

4. `get` 方法：返回值改为 `return (await serializeMoments([moment]))[0];`（`moment` 为 Phase 3 中查出的行）。

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/dto test`
Expected: moment-tags 6 个用例 PASS；Phase 3 既有 moments 测试全部 PASS（`tests/moments/moment-serializer.test.ts` 的三参调用已迁移为 extras 形式并 PASS、响应多出 `tags: []` 不破坏既有断言——若 Phase 3 测试用了 `toEqual` 全量断言响应对象，把期望对象补上 `tags: [...]`，属预期小改）。

- [ ] **Step 8: Commit**

```bash
git add apps/server packages/dto
git commit -m "feat(server): moments 写路径接受 tagIds 并事务内重建 moment_tags"
```

---

### Task 5: packages/dto — feed 查询 schema 与响应类型（TDD）

**Files:**
- Test: `packages/dto/src/feed.test.ts`
- Create: `packages/dto/src/feed.ts`
- Modify: `packages/dto/src/index.ts`（re-export）

**Interfaces:**
- Produces（Task 6 依赖，不得改名）:
  - `feedQuerySchema` / `FeedQueryInput`：`{ cursor?: string; chain_ids?: string(逗号分隔 uuid); tag_id?: uuid; order: 'happened_at'|'created_at' 默认 happened_at; limit: number 默认 20 (1–50) }`（查询参数命名遵循 spec §4，多词 snake_case）
  - `FeedResponse = { moments: MomentResponse[]; nextCursor: string | null }`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/feed.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedQuerySchema } from './feed.js';

test('feedQuerySchema 全默认值', () => {
  const q = feedQuerySchema.parse({});
  assert.equal(q.order, 'happened_at');
  assert.equal(q.limit, 20);
  assert.equal(q.cursor, undefined);
  assert.equal(q.chain_ids, undefined);
  assert.equal(q.tag_id, undefined);
});

test('feedQuerySchema limit 由字符串 coerce，上限 50', () => {
  assert.equal(feedQuerySchema.parse({ limit: '7' }).limit, 7);
  assert.throws(() => feedQuerySchema.parse({ limit: '51' }));
  assert.throws(() => feedQuerySchema.parse({ limit: '0' }));
});

test('feedQuerySchema order 只接受两个枚举值', () => {
  assert.equal(feedQuerySchema.parse({ order: 'created_at' }).order, 'created_at');
  assert.throws(() => feedQuerySchema.parse({ order: 'updated_at' }));
});

test('feedQuerySchema chain_ids 必须是逗号分隔 uuid', () => {
  const ok = feedQuerySchema.parse({
    chain_ids: '00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002',
  });
  assert.equal(ok.chain_ids?.split(',').length, 2);
  assert.throws(() => feedQuerySchema.parse({ chain_ids: 'not-uuid' }));
  assert.throws(() => feedQuerySchema.parse({ chain_ids: '00000000-0000-4000-8000-000000000001,' }));
});

test('feedQuerySchema tag_id 必须 uuid', () => {
  assert.throws(() => feedQuerySchema.parse({ tag_id: 'nope' }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './feed.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/feed.ts`：
```ts
import { z } from 'zod';
import type { MomentResponse } from './moments.js';

const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const feedQuerySchema = z.object({
  /** opaque 游标（base64url(JSON)），首页不传 */
  cursor: z.string().min(1).max(1024).optional(),
  /** 逗号分隔的链 id，仅用于在「我的链」范围内收窄（参数名遵循 spec §4 snake_case） */
  chain_ids: z
    .string()
    .refine((v) => v.split(',').every((id) => uuidLoose.test(id)), {
      message: 'chain_ids 必须是逗号分隔的 uuid',
    })
    .optional(),
  tag_id: z.string().regex(uuidLoose).optional(),
  /** happened_at=事件时间（默认）；created_at=添加时间（补发可见，spec §5.6） */
  order: z.enum(['happened_at', 'created_at']).default('happened_at'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQueryInput = z.infer<typeof feedQuerySchema>;

export interface FeedResponse {
  moments: MomentResponse[];
  /** 还有下一页时为 opaque 游标，否则 null */
  nextCursor: string | null;
}
```

`packages/dto/src/index.ts` 追加一行（保留既有行）：
```ts
export * from './feed.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 5 个新测试 PASS，`dist/feed.d.ts` 生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): feed 查询 schema 与 FeedResponse 类型"
```

---

### Task 6: 复合游标 + 共用查询 builder + feed service/controller（TDD）

**Files:**
- Create: `apps/server/src/feed/cursor.ts`
- Create: `apps/server/src/feed/moment-query.ts`
- Create: `apps/server/src/feed/membership.ts`
- Create: `apps/server/src/feed/feed.service.ts`、`apps/server/src/feed/feed.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 数组加 `FeedController`）
- Test: `apps/server/tests/feed/feed.test.ts`

**Interfaces:**
- Consumes: `moments`/`momentTags`/`chainMembers` 表、`serializeMoments`（Task 4）、`feedQuerySchema`（Task 5）。
- Produces（Task 7 重构与 Phase 5 扩展依赖，不得改名）:
  - `type MomentOrder = 'happened_at' | 'created_at'`（`src/feed/cursor.ts`）
  - `encodeCursor(order: MomentOrder, time: number, id: string): string`
  - `decodeCursor(order: MomentOrder, raw: string): { time: number; id: string }`（失败抛 `BadRequestError('INVALID_CURSOR')`）
  - `queryMomentPage(query: { chainIds: string[]; order: MomentOrder; limit: number; cursor?: string; tagId?: string }): Promise<{ rows: Moment[]; nextCursor: string | null }>`（`src/feed/moment-query.ts`；feed 与链内列表共用）
  - `getMyChains(userId: string): Promise<Map<string, ChainRole>>`（`src/feed/membership.ts`）
  - `class FeedService { feed(userId: string, query: FeedQueryParsed): Promise<FeedResponse> }`
  - HTTP：`GET /api/feed?cursor=&chain_ids=&tag_id=&order=&limit=`（登录即可，范围=我的链；参数名遵循 spec §4）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/feed/feed.test.ts`：
```ts
import request from 'supertest';
import type { Response } from 'supertest';
import { db } from '../../src/db/index.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getFeed(token: string, query = ''): Promise<Response> {
  return request(app).get(`/api/feed${query}`).set(auth(token));
}

function ids(res: Response): string[] {
  return res.body.moments.map((m: { id: string }) => m.id);
}

/** 三条链：A（alice=owner）、B（alice=viewer、bob=owner）、C（carol 私有，alice 不可见）。 */
async function setupWorld() {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();
  // createChain 已插入 (chain, 创建者, 'owner') 成员行：alice 即 chainA 的 owner（owner ≥ editor，
  // feed 只要求成员身份）。chain_members 有 UNIQUE(chain_id, user_id)，不得再对 chainA addMember(alice)。
  const chainA = await createChain(alice.id, '链A');
  const chainB = await createChain(bob.id, '链B');
  const chainC = await createChain(carol.id, '链C');
  await addMember(chainB, alice.id, 'viewer');
  return { alice, bob, carol, chainA, chainB, chainC };
}

describe('GET /api/feed 跨链聚合与可见性', () => {
  it('只聚合「我的链」的 moments；软删不出现；按 happened_at 倒序；未登录 401', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const mA1 = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    const mA2 = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-03T00:00:00Z') });
    const mB = await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-05T00:00:00Z') });
    // 链C：alice 不是成员，绝不可见
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-07-01T00:00:00Z') });
    // 链A 软删 moment
    await insertMoment({
      chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z'), deletedAt: new Date(),
    });

    const res = await getFeed(alice.token);
    expect(res.status).toBe(200);
    expect(res.body.moments.length).toBe(3);
    expect(ids(res)).toEqual([mB, mA2, mA1]);
    expect(res.body.nextCursor).toBeNull();

    const anon = await request(app).get('/api/feed');
    expect(anon.status).toBe(401);
  });

  it('无任何链成员关系时返回空列表而非报错；但坏游标仍 400（校验先于空范围短路）', async () => {
    const loner = await registerUser();
    const res = await getFeed(loner.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moments: [], nextCursor: null });

    const badCursor = await getFeed(loner.token, `?cursor=${encodeURIComponent('!!!not-base64!!!')}`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('GET /api/feed 复合游标翻页', () => {
  it('同一 happened_at 的多个 moment 翻页不丢不重', async () => {
    const { alice, chainA } = await setupWorld();
    const same = new Date('2026-06-01T12:00:00Z');
    const expected: string[] = [];
    for (let i = 0; i < 5; i++) {
      expected.push(await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: same }));
    }
    // 用不同时间隔开，验证游标在「同时间戳边界」也正确
    const older = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-05-01T00:00:00Z') });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const q = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const res = await getFeed(alice.token, q);
      expect(res.status).toBe(200);
      collected.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    // 全集 6 条全部出现且仅出现一次，顺序全局倒序（同时间戳内按 id 倒序）
    expect(collected).toHaveLength(6);
    expect(new Set(collected).size).toBe(6);
    expect(collected.slice(0, 5).every((id) => expected.includes(id))).toBe(true);
    expect(collected[5]).toBe(older);
  });

  it('游标损坏返回 400 INVALID_CURSOR（非 base64 / 非 JSON / 字段类型错）', async () => {
    const { alice, chainA } = await setupWorld();
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date() });

    const notBase64 = await getFeed(alice.token, `?cursor=${encodeURIComponent('!!!not-base64!!!')}`);
    expect(notBase64.status).toBe(400);
    expect(notBase64.body.error.code).toBe('INVALID_CURSOR');

    const notJson = await getFeed(alice.token, `?cursor=${encodeURIComponent(Buffer.from('garbage', 'utf8').toString('base64url'))}`);
    expect(notJson.status).toBe(400);
    expect(notJson.body.error.code).toBe('INVALID_CURSOR');

    const wrongTypes = await getFeed(alice.token, `?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ h: 'x', i: 1 }), 'utf8').toString('base64url'))}`);
    expect(wrongTypes.status).toBe(400);
    expect(wrongTypes.body.error.code).toBe('INVALID_CURSOR');
  });

  it('order=created_at 与 order=happened_at 使用同一游标格式语义（c 键）', async () => {
    const { alice, chainA } = await setupWorld();
    await insertMoment({
      chainId: chainA, authorId: alice.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'), createdAt: new Date('2026-06-10T00:00:00Z'),
    });
    await insertMoment({
      chainId: chainA, authorId: alice.id,
      happenedAt: new Date('2026-07-01T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const res = await getFeed(alice.token, '?order=created_at&limit=1');
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    // created_at 更新的（6-10 创建的）在前
    expect(res.body.moments[0].happenedAt).toBe(new Date('2026-05-01T00:00:00Z').toISOString());
    expect(res.body.nextCursor).toBeTruthy();

    const page2 = await getFeed(alice.token, `?order=created_at&limit=1&cursor=${encodeURIComponent(res.body.nextCursor!)}`);
    expect(page2.status).toBe(200);
    expect(page2.body.moments[0].happenedAt).toBe(new Date('2026-07-01T00:00:00Z').toISOString());
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('GET /api/feed 补发可见性（spec §5.6）', () => {
  it('补发 moment 按 happened_at 沉底、按 created_at 置顶', async () => {
    const { alice, chainA } = await setupWorld();
    // 先发两条「当下」moment
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-20T00:00:00Z'), createdAt: new Date('2026-06-20T00:00:00Z') });
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-21T00:00:00Z'), createdAt: new Date('2026-06-21T00:00:00Z') });
    // 6-22 补发一条 6-01 的旧事（is_backfill）
    const backfill = await insertMoment({
      chainId: chainA, authorId: alice.id, isBackfill: true,
      happenedAt: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-06-22T00:00:00Z'),
    });

    const byHappened = await getFeed(alice.token, '?order=happened_at');
    expect(ids(byHappened)[0]).not.toBe(backfill); // 事件时间最旧，排最后

    const byCreated = await getFeed(alice.token, '?order=created_at');
    expect(ids(byCreated)[0]).toBe(backfill); // 添加时间最新，排最前（补发可被其他成员发现）
  });
});

describe('GET /api/feed 过滤', () => {
  it('tagId 只返回带该 tag 的 moment', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const tagRes = await request(app).post(`/api/chains/${chainA}/tags`).set(auth(alice.token)).send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;

    const tagged = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-02T00:00:00Z') });
    await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-03T00:00:00Z') });
    await attachTag(tagged, tagId);

    const res = await getFeed(alice.token, `?tag_id=${tagId}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([tagged]);

    // 非我的链（chainC，carol 私有）的 tag：静默返回空，不报错也不泄露——tag_id 维度的越权语义由本断言覆盖
    // （chainB 的 tag 不行：alice 是 chainB 的 viewer，chainB 属于 alice 的可见范围）
    const otherTag = await request(app).post(`/api/chains/${chainC}/tags`).set(auth(carol.token)).send({ name: '他链' });
    const foreign = await getFeed(alice.token, `?tag_id=${otherTag.body.id}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.moments).toEqual([]);
  });

  it('chain_ids 收窄到我的链子集；含非我的链 id 时静默过滤', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const mA = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-02T00:00:00Z') });
    await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const narrowed = await getFeed(alice.token, `?chain_ids=${chainA}`);
    expect(narrowed.status).toBe(200);
    expect(ids(narrowed)).toEqual([mA]);

    // chainC 不是 alice 的链：不报错、不泄露，等价于只剩 chainA
    const withForeign = await getFeed(alice.token, `?chain_ids=${chainA},${chainC}`);
    expect(withForeign.status).toBe(200);
    expect(ids(withForeign)).toEqual([mA]);

    // chain_ids 全部不是我的链 → 空列表
    const allForeign = await getFeed(alice.token, `?chain_ids=${chainC}`);
    expect(allForeign.status).toBe(200);
    expect(allForeign.body).toEqual({ moments: [], nextCursor: null });
  });

  it('limit 非法返回 400 VALIDATION_ERROR', async () => {
    const { alice } = await setupWorld();
    const res = await getFeed(alice.token, '?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('feed 响应的 moments 含 tags 字段（走 serializeMoments）', async () => {
    const { alice, chainA } = await setupWorld();
    const tagRes = await request(app).post(`/api/chains/${chainA}/tags`).set(auth(alice.token)).send({ name: 'T' });
    const m = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await attachTag(m, tagRes.body.id);
    const res = await getFeed(alice.token);
    expect(res.body.moments[0].tags).toEqual([{ id: tagRes.body.id, name: 'T' }]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`/api/feed` 404）

- [ ] **Step 3: 实现**

`apps/server/src/feed/cursor.ts`：
```ts
import { BadRequestError } from 'routing-controllers';

export type MomentOrder = 'happened_at' | 'created_at';

export interface DecodedCursor {
  /** epoch ms */
  time: number;
  id: string;
}

/**
 * CONVENTIONS §3.4：游标 = base64url(JSON)。
 * order=happened_at → {h: epochMs, i: momentId}；order=created_at → {c: epochMs, i: momentId}。
 */
export function encodeCursor(order: MomentOrder, time: number, id: string): string {
  const payload = order === 'happened_at' ? { h: time, i: id } : { c: time, i: id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(order: MomentOrder, raw: string): DecodedCursor {
  let parsed: { h?: unknown; c?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const time = order === 'happened_at' ? parsed.h : parsed.c;
  if (
    typeof time !== 'number' ||
    !Number.isInteger(time) ||
    !Number.isSafeInteger(time) ||
    typeof parsed.i !== 'string' ||
    parsed.i.length === 0
  ) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { time, id: parsed.i };
}
```

`apps/server/src/feed/moment-query.ts`：
```ts
import { and, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, momentTags, type Moment } from '../db/schema.js';
import { decodeCursor, encodeCursor, type MomentOrder } from './cursor.js';

export interface MomentPageQuery {
  /** 可见范围（feed=我的链子集；链内列表=单链）。可为空数组：返回空页（游标仍先校验）。 */
  chainIds: string[];
  order: MomentOrder;
  limit: number;
  cursor?: string;
  tagId?: string;
}

export interface MomentPage {
  rows: Moment[];
  nextCursor: string | null;
}

/**
 * feed 与链内 moments 列表共用的分页查询（spec §5.1）：
 * WHERE chain_id IN (...) AND deleted_at IS NULL
 *   AND (time, id) < (cursorTime, cursorId)   -- 复合游标，OR 展开以走索引
 * ORDER BY time DESC, id DESC LIMIT n+1       -- 多取 1 条判断 hasMore
 * tagId 过滤以 moment_tags(tag_id, moment_id) 为驱动表（semi-join 子查询）。
 */
export async function queryMomentPage(query: MomentPageQuery): Promise<MomentPage> {
  // 游标校验前置：即使可见范围为空，坏游标也恒 400 INVALID_CURSOR（而非 200 空列表）
  const cursor = query.cursor ? decodeCursor(query.order, query.cursor) : undefined;
  if (query.chainIds.length === 0) {
    return { rows: [], nextCursor: null };
  }
  const timeCol = query.order === 'happened_at' ? moments.happenedAt : moments.createdAt;

  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];

  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      // or() 的签名返回 SQL | undefined，此处两个参数恒非空，运行时不可能为 undefined，断言安全
      or(
        lt(timeCol, cursorTime),
        and(eq(timeCol, cursorTime), lt(moments.id, cursor.id)),
      ) as SQL,
    );
  }

  if (query.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db
          .select({ id: momentTags.momentId })
          .from(momentTags)
          .where(eq(momentTags.tagId, query.tagId)),
      ),
    );
  }

  const rows = await db
    .select()
    .from(moments)
    .where(and(...conditions))
    .orderBy(desc(timeCol), desc(moments.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          query.order,
          (query.order === 'happened_at' ? last.happenedAt : last.createdAt).getTime(),
          last.id,
        )
      : null;
  return { rows: page, nextCursor };
}
```

`apps/server/src/feed/membership.ts`：
```ts
import { eq } from 'drizzle-orm';
import type { ChainRole } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { chainMembers } from '../db/schema.js';

/**
 * 请求入口一次性查出「我的 chain_id + role」集合（spec §5.1）。
 * feed 主查询只消费 chainId 列表，禁止 join chain_members。
 * （短 TTL 进程内缓存留待容量需要时加，YAGNI。）
 */
export async function getMyChains(userId: string): Promise<Map<string, ChainRole>> {
  const rows = await db
    .select({ chainId: chainMembers.chainId, role: chainMembers.role })
    .from(chainMembers)
    .where(eq(chainMembers.userId, userId));
  return new Map(rows.map((r) => [r.chainId, r.role as ChainRole]));
}
```

`apps/server/src/feed/feed.service.ts`：
```ts
import type { FeedResponse } from '@moment/dto';
import { Service } from 'typedi';
import { serializeMoments } from '../moments/moment-serializer.js';
import { getMyChains } from './membership.js';
import { queryMomentPage } from './moment-query.js';
import type { MomentOrder } from './cursor.js';

export interface FeedQueryParsed {
  cursor?: string;
  /** 未传 = 全部我的链；传了 = 与我的链求交集（收窄） */
  chainIds?: string[];
  tagId?: string;
  order: MomentOrder;
  limit: number;
}

@Service()
export class FeedService {
  async feed(userId: string, query: FeedQueryParsed): Promise<FeedResponse> {
    const myChains = await getMyChains(userId);
    let scope = [...myChains.keys()];
    if (query.chainIds) {
      // 静默过滤非我的链：不报错也不泄露链存在性（spec §5.1 / 本计划 Global Constraints）
      scope = query.chainIds.filter((id) => myChains.has(id));
    }
    // scope 为空时不提前返回：由 queryMomentPage 统一处理（返回空页，但坏游标仍 400 INVALID_CURSOR）

    const page = await queryMomentPage({
      chainIds: scope,
      order: query.order,
      limit: query.limit,
      cursor: query.cursor,
      tagId: query.tagId,
    });
    return { moments: await serializeMoments(page.rows), nextCursor: page.nextCursor };
  }
}
```

`apps/server/src/feed/feed.controller.ts`：
```ts
import { feedQuerySchema, type FeedResponse, type UserProfile } from '@moment/dto';
import type { Request } from 'express';
import { Authorized, CurrentUser, Get, JsonController, Req } from 'routing-controllers';
import { Service } from 'typedi';
import { FeedService } from './feed.service.js';

@JsonController()
@Service()
export class FeedController {
  constructor(private feedService: FeedService) {}

  @Get('/feed')
  @Authorized()
  feed(@Req() req: Request, @CurrentUser() user: UserProfile): Promise<FeedResponse> {
    const query = feedQuerySchema.parse(req.query);
    return this.feedService.feed(user.id, {
      cursor: query.cursor,
      chainIds: query.chain_ids?.split(','),
      tagId: query.tag_id,
      order: query.order,
      limit: query.limit,
    });
  }
}
```

`apps/server/src/app.ts` 修改点：import 区加：
```ts
import { FeedController } from './feed/feed.controller.js';
```
`controllers: [...]` 数组中加入 `FeedController`（保留既有项）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: feed 10 个用例 PASS，既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 复合游标 feed（跨链聚合/tag 过滤/补发排序/chain_ids 收窄）"
```

---

### Task 7: 链内 moments 列表重构为共用查询 builder（TDD 回归）

**Files:**
- Test: `apps/server/tests/moments/list-refactor.test.ts`
- Modify: `apps/server/src/moments/moment.service.ts`（`list` 方法整体替换为走 `queryMomentPage`）
- Modify: 删除 Phase 3 链内列表私有的游标编解码（若 `src/moments/` 下存在 `moment-cursor.ts` 或等价内联实现，删除并全仓 grep 确认无引用）

**Interfaces:**
- Consumes: `queryMomentPage`（Task 6）、`serializeMoments`（Task 4）、Phase 3 的 `listMomentsQuerySchema`/`MomentListResponse`。
- Produces: `MomentService.list(chainId: string, query: { cursor?: string; limit: number }): Promise<MomentListResponse>`（签名不变，实现改为共用 builder；链内列表固定 `order: 'happened_at'`，游标格式与 feed 完全一致）。

- [ ] **Step 1: 写失败/防退化测试**

`apps/server/tests/moments/list-refactor.test.ts`：
```ts
import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/chains/:chainId/moments（共用 builder 重构后行为）', () => {
  it('跨页稳定：同 happened_at 多 moment 翻页不丢不重，nextCursor 与 feed 同格式', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const same = new Date('2026-06-01T12:00:00Z');
    for (let i = 0; i < 4; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const q = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const res = await request(app).get(`/api/chains/${chainId}/moments${q}`).set(auth(owner.token));
      expect(res.status).toBe(200);
      collected.push(...res.body.moments.map((m: { id: string }) => m.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(collected).toHaveLength(4);
    expect(new Set(collected).size).toBe(4);
  });

  it('软删 moment 不出现在链内列表', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-06-02T00:00:00Z'), deletedAt: new Date(),
    });
    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
  });

  it('游标损坏返回 400 INVALID_CURSOR（与 feed 一致）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?cursor=${encodeURIComponent('%%%bad%%%')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('响应 moments 含 tags 字段', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.moments[0].tags).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认现状**

Run: `pnpm --filter @moment/server test -- list-refactor`
Expected: 记录现状基线即可，FAIL 与全 PASS 均有可能——若 Phase 3 私有游标恰好与本计划同格式同错误码，4 个用例可能全过，属正常（本步只做重构前现状快照，不预设失败）。行为的真正锁定在 Step 4 重构后全 PASS。

- [ ] **Step 3: 重构 `MomentService.list`**

`apps/server/src/moments/moment.service.ts`：

1. import 区加：
```ts
import { queryMomentPage } from '../feed/moment-query.js';
```
2. `list` 方法整体替换为（签名与 `MomentListResponse` 语义不变）：
```ts
  /** 链内时间线：与 feed 共用 queryMomentPage（order 固定 happened_at，游标同格式）。 */
  async list(chainId: string, query: { cursor?: string; limit: number }): Promise<MomentListResponse> {
    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: query.limit,
      cursor: query.cursor,
    });
    return { moments: await serializeMoments(page.rows), nextCursor: page.nextCursor };
  }
```
（链的成员资格校验保持在既有 controller 层 `requireChainRole('viewer')`，不在 list 内重复。）
3. 删除 Phase 3 链内列表私有游标编解码：若存在 `src/moments/moment-cursor.ts`（或 service 内的 encode/decode 私有函数），删除文件/函数，并执行：
Run: `grep -rn "moment-cursor" apps/server/src apps/server/tests || true`
Expected: 无输出（无残留引用）。若 Phase 3 将游标逻辑内联在 `moment.service.ts`，删除内联函数即可。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: list-refactor 4 个用例 PASS；Phase 3 既有链内列表测试全部 PASS（若旧测试断言了旧游标字面值，改为从上一页响应取 `nextCursor` 传递——游标是 opaque，测试不得手写字面值）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "refactor(server): 链内 moments 列表复用 feed 查询 builder 与游标"
```

---

### Task 8: 全量验证与 DoD

**Files:**
- 无新增文件；验证-only。

**Interfaces:**
- Consumes: Task 1–7 全部产物。
- Produces: Phase 4 DoD 达成确认（Phase 5 将消费 `serializeMoments`、`queryMomentPage`、`momentSerializer` 扩展位）。

- [ ] **Step 1: 全量构建与测试**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、全部测试 PASS（dto：auth + moments-tags + tags + feed；server：health/auth 既有 + tags + moment-tags + feed + list-refactor + Phase 2/3 既有）。

- [ ] **Step 2: 手动验收（可选，dev 环境）**

```bash
pnpm --filter @moment/server dev
# 1) 注册拿 token
curl -s -X POST localhost:3000/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"p4@test.com","password":"secret123","nickname":"p4"}'
# 2) 用 Phase 2 的建链接口造一条链（或直接用已有链），再：
curl -s "localhost:3000/api/chains/<chainId>/tags" -H "Authorization: Bearer <token>"
curl -s -X POST "localhost:3000/api/chains/<chainId>/tags" -H "Authorization: Bearer <token>" \
  -H 'content-type: application/json' -d '{"name":"周岁"}'
# 3) 发一条带 tag 的 moment，然后翻 feed（把 nextCursor 传入下一页）
curl -s "localhost:3000/api/feed?limit=2&tag_id=<tagId>" -H "Authorization: Bearer <token>"
```
Expected: tags CRUD、feed 翻页/过滤/排序与自动化测试行为一致。

- [ ] **Step 3: Commit（如有 lint 修复）**

```bash
git add -A && git commit -m "chore(server): phase 4 全量验证收尾"
```
（无改动则跳过本 commit。）

---

## 完成标准（Phase 4 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿。
- `tags`、`moment_tags` 表存在于测试库；`UNIQUE(chain_id, name)`、联合主键 `(moment_id, tag_id)`、索引 `idx_moment_tags_tag_moment(tag_id, moment_id)` 均已建立；`resetDb()` 已覆盖两表。
- tag：viewer 可读（含 moment 数，软删不计）、editor+ 可建（每链 ≤100、重名 409）、editor+ 可删（单事务级联清 `moment_tags`）；controller 内无手写角色判断。
- moments：`POST /api/chains/:chainId/moments` 与 `PATCH /api/moments/:id` 接受 `tagIds`，跨链 tag 整笔回滚 400 `TAG_NOT_IN_CHAIN`；create/update/get/list/feed 响应均含 `tags`，全部经 `momentSerializer`/`serializeMoments`（无 N+1）。
- feed：只聚合我的链（无 `chain_members` join）；`(happened_at, id)` / `(created_at, id)` 复合游标翻页同时间戳不丢不重；`tag_id` 以 `moment_tags` 驱动过滤；`order=created_at` 让补发可见；`chain_ids` 收窄且非我的链静默过滤；游标损坏恒 400 `INVALID_CURSOR`（含空范围场景）；查询参数命名与 spec §4 一致（snake_case）。
- 链内 `GET /api/chains/:chainId/moments` 与 feed 共用 `queryMomentPage` + `src/feed/cursor.ts`，全仓无第二份游标实现。
- 本计划未引入新环境变量（`config.ts` 与 `.env.example` 无需改动）。



