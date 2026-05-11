# Phase 2: 时光链 chains + 成员/角色 + ChainPolicy + 邀请闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现时光链域：`chains`/`chain_members`/`chain_invites` 三表、集中的 `ChainPolicy` 与 `requireChainRole` 中间件（CONVENTIONS §3.1 契约）、链 CRUD + 成员管理 + owner 转让 + 邀请创建/吊销/接受完整闭环，全部端点有集成测试。

**Architecture:** 沿用 Phase 1 分层（controller → service → drizzle schema）。所有链内角色裁决集中在 `ChainPolicy`（controller 零手写角色判断）；链 CRUD/成员/邀请业务在 `ChainService`。路由严格遵守 CONVENTIONS §3.6：`/api/chains*` + `/api/invites/*`。moments/media/tags 尚不存在，删链级联与邀请通知 outbox 留注释锚点，由 Phase 3/5 补。

**Tech Stack:** 同 Phase 1（Express 4 + routing-controllers 0.11 + typedi / Drizzle 0.45 + mysql2 / zod 3 / Jest 29 ESM + supertest）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§1 权限模型/链可见性、§3 chains/chain_members/chain_invites 表与事务边界、§4 Chains API、§5.2 权限、§6 安全）；跨计划契约 `docs/superpowers/plans/CONVENTIONS.md` §3.1/§3.5/§3.6。

## Global Constraints

（通用约束继承 Phase 1：ESM NodeNext 相对 import 带 `.js`、HttpError 系 message 为 UPPER_SNAKE 机器码、触库测试 `afterAll(closeDb)`、每 Task 一个 conventional commit、zod ^3.22。以下为本计划**新增**。）

- `ChainPolicy` / `requireChainRole` 签名严格按 CONVENTIONS §3.1，Phase 3–8 直接消费，不得改名/改语义。
- 越权语义：非成员访问链或链内资源一律 404 `CHAIN_NOT_FOUND`（不泄露链存在性）；成员但角色不足 403 `CHAIN_ROLE_INSUFFICIENT`。
- controller 内禁止手写角色判断；角色裁决只在 `ChainPolicy` / `ChainService`（service 内通过 `policy.require` 裁决）。
- **routing-controllers 0.11 关键事实（已核源码 `ExpressDriver.registerAction`）：`@UseBefore` 中间件先于 `@Authorized` 的 authorizationChecker 执行**，因此 `requireChainRole` 读不到 authorizationChecker 填充的 `request.user`。本计划在 `useExpressServer` 之前挂全局 `populateUser` 中间件（Task 3）解决；这是后续所有 Phase 角色中间件能工作的前提。
- 新表必须扩展 `tests/helpers/db.ts` 的 `resetDb()`，按外键依赖逆序：`chain_invites → chain_members → chains → refresh_tokens → users`。
- `chains.cover_media_id` 引用未来的 media 表：**本阶段不加外键**（Phase 3 建 media 表时迁移补 FK）。
- 删链级联：members/invites 同事务硬删；moments/media 尚不存在，Phase 3 在 `ChainService.remove` 事务注释锚点处补级联。
- 邀请 accept 成功路径**不写 outbox**（outbox 表 Phase 3 建、邀请通知扇出 Phase 5 做），代码留注释锚点。
- 新增环境变量 `INVITE_TTL_DAYS`（默认 7）必须同步 `apps/server/src/config.ts` 与 `apps/server/.env.example`。
- 创建邀请开放给 owner/editor；owner 转让走独立端点 `POST /api/chains/:chainId/transfer`（两处均已回写 spec §1/§4，不是偏离）。
- 邀请接受使用独立的 `inviteAcceptRateLimiter`（IP + 账号/invitee 维度，60s/5 次，spec §4/§6），不复用 `authRateLimiter`，且只挂在 accept 路由上——`DELETE /api/invites/:inviteId`（owner 吊销）不被敏感限流误伤。

---

### Task 1: packages/dto — chains 域 zod schema 与共享类型（TDD）

**Files:**
- Test: `packages/dto/src/chains.test.ts`
- Create: `packages/dto/src/chains.ts`
- Modify: `packages/dto/src/index.ts`（加 re-export）

**Interfaces:**
- Consumes: Phase 1 的 `@moment/dto` 包骨架（`tsx --test src/*.test.ts`）。
- Produces（Task 4–6 与 Phase 3+ 依赖，不得改名）:
  - `chainVisibilitySchema` / `ChainVisibility`（`'private'|'link'|'public'`）
  - `chainRoleSchema` / `ChainRole`（`'owner'|'editor'|'viewer'`；与服务端 `chain-policy.ts` 的 `ChainRole` 结构一致，可互相赋值）
  - `inviteRoleSchema` / `InviteRole`（`'editor'|'viewer'`——owner 只能通过 transfer 产生）
  - `createChainInputSchema`/`CreateChainInput`、`updateChainInputSchema`/`UpdateChainInput`（空 patch 拒绝）
  - `updateMemberRoleInputSchema`/`UpdateMemberRoleInput`（role 仅 editor/viewer）
  - `transferChainInputSchema`/`TransferChainInput`、`createInviteInputSchema`/`CreateInviteInput`
  - 响应 interface：`ChainDto`、`ChainMemberDto`、`InviteDto`、`AcceptInviteResponse`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/chains.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createChainInputSchema,
  createInviteInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
} from './chains.js';

test('createChainInputSchema：visibility 默认 private，name trim', () => {
  const input = createChainInputSchema.parse({ name: '  宝宝成长  ' });
  assert.equal(input.name, '宝宝成长');
  assert.equal(input.visibility, 'private');
  assert.equal(input.description, undefined);
});

test('createChainInputSchema：拒绝空 name 与非法 visibility', () => {
  assert.throws(() => createChainInputSchema.parse({ name: '' }));
  assert.throws(() => createChainInputSchema.parse({ name: 'x', visibility: 'friends' }));
});

test('updateChainInputSchema：拒绝空 patch；description 可显式置 null', () => {
  assert.throws(() => updateChainInputSchema.parse({}));
  const ok = updateChainInputSchema.parse({ description: null });
  assert.equal(ok.description, null);
});

test('updateMemberRoleInputSchema：不允许 owner（转让走专门端点）', () => {
  assert.throws(() => updateMemberRoleInputSchema.parse({ role: 'owner' }));
  assert.equal(updateMemberRoleInputSchema.parse({ role: 'viewer' }).role, 'viewer');
});

test('createInviteInputSchema：role 默认 editor，仅允许 editor/viewer，email 归一化', () => {
  const def = createInviteInputSchema.parse({});
  assert.equal(def.role, 'editor');
  assert.equal(def.email, undefined);
  assert.throws(() => createInviteInputSchema.parse({ role: 'owner' }));
  const withEmail = createInviteInputSchema.parse({ email: '  A@B.COM ' });
  assert.equal(withEmail.email, 'a@b.com');
});

test('transferChainInputSchema：要求 userId', () => {
  assert.throws(() => transferChainInputSchema.parse({}));
  assert.equal(transferChainInputSchema.parse({ userId: 'u1' }).userId, 'u1');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './chains.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/chains.ts`：
```ts
import { z } from 'zod';

export const chainVisibilitySchema = z.enum(['private', 'link', 'public']);
export type ChainVisibility = z.infer<typeof chainVisibilitySchema>;

export const chainRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ChainRole = z.infer<typeof chainRoleSchema>;

/** 邀请/改角色允许的目标角色——owner 只能通过 transfer 端点产生。 */
export const inviteRoleSchema = z.enum(['editor', 'viewer']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const createChainInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullish(),
  visibility: chainVisibilitySchema.default('private'),
});
export type CreateChainInput = z.infer<typeof createChainInputSchema>;

export const updateChainInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: chainVisibilitySchema.optional(),
    // coverMediaId 的校验依赖 media 归属判断，属 Phase 3，本阶段不支持改封面。
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field required',
  });
export type UpdateChainInput = z.infer<typeof updateChainInputSchema>;

export const updateMemberRoleInputSchema = z.object({
  role: inviteRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>;

export const transferChainInputSchema = z.object({
  userId: z.string().min(1).max(36),
});
export type TransferChainInput = z.infer<typeof transferChainInputSchema>;

export const createInviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255).nullish(),
  role: inviteRoleSchema.default('editor'),
});
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

export interface ChainDto {
  id: string;
  name: string;
  description: string | null;
  coverMediaId: string | null;
  visibility: ChainVisibility;
  ownerId: string;
  /** 当前请求用户在该链中的角色；仅在「我参与的链」语境下返回 */
  myRole?: ChainRole;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface ChainMemberDto {
  userId: string;
  nickname: string;
  role: ChainRole;
  /** ISO 8601 */
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  chainId: string;
  token: string;
  email: string | null;
  role: InviteRole;
  createdBy: string;
  /** ISO 8601 */
  expiresAt: string;
  /** ISO 8601，未接受为 null */
  acceptedAt: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface AcceptInviteResponse {
  chainId: string;
  role: ChainRole;
  /** true = 已是成员（幂等返回），未做任何写入 */
  alreadyMember: boolean;
}
```

`packages/dto/src/index.ts`（整体替换）：
```ts
export * from './auth.js';
export * from './chains.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: chains 6 个测试 + auth 5 个测试 PASS；`dist/chains.js` 生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): chains 域 zod schema 与共享类型"
```

---

### Task 2: chains / chain_members / chain_invites 三表 + 迁移 + resetDb 扩展

**Files:**
- Create: `apps/server/src/db/schema/chains.ts`、`apps/server/src/db/schema/chain-members.ts`、`apps/server/src/db/schema/chain-invites.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 加三行）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 扩展）
- Create: `apps/server/drizzle/0001_*.sql`（`drizzle-kit generate` 产物）
- Test: `apps/server/tests/chains/schema.test.ts`

**Interfaces:**
- Consumes: Phase 1 的 `users` 表、`db`、`resetDb`/`closeDb`、jest globalSetup 自动迁移。
- Produces（Task 3–6 依赖，不得改名）:
  - `chains` 表对象（列：`id/name/description/coverMediaId/visibility/ownerId/createdAt/updatedAt`）、类型 `Chain`/`NewChain`
  - `chainMembers` 表对象（列：`chainId/userId/role/joinedAt`，联合主键 `(chain_id,user_id)`）、类型 `ChainMember`
  - `chainInvites` 表对象（列：`id/chainId/token/email/role/createdBy/expiresAt/acceptedAt/createdAt`）、类型 `ChainInvite`/`NewChainInvite`
  - `resetDb()` 清表顺序扩展为：chain_invites → chain_members → chains → refresh_tokens → users

- [ ] **Step 1: 写失败测试**

`apps/server/tests/chains/schema.test.ts`：
```ts
import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('chains 域三表', () => {
  it('可写入并读回；默认值/枚举/联合主键生效', async () => {
    await db.insert(users).values({ id: 'u1', email: 'u1@t.com', passwordHash: 'x', nickname: 'u1' });
    await db.insert(chains).values({ id: 'c1', name: '链', ownerId: 'u1' });
    await db.insert(chainMembers).values({ chainId: 'c1', userId: 'u1', role: 'owner' });
    await db.insert(chainInvites).values({
      id: 'i1',
      chainId: 'c1',
      token: 'a'.repeat(64),
      role: 'editor',
      createdBy: 'u1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const [chain] = await db.select().from(chains);
    expect(chain.visibility).toBe('private'); // 默认值
    expect(chain.description).toBeNull();
    expect(chain.coverMediaId).toBeNull();

    const [invite] = await db.select().from(chainInvites);
    expect(invite.role).toBe('editor');
    expect(invite.acceptedAt).toBeNull();

    // 联合主键 (chain_id, user_id)：重复写入报错
    await expect(
      db.insert(chainMembers).values({ chainId: 'c1', userId: 'u1', role: 'viewer' })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- schema`
Expected: FAIL（`chains`/`chainMembers`/`chainInvites` 不是 schema 的导出成员）

- [ ] **Step 3: 写表定义 + barrel + resetDb 扩展**

`apps/server/src/db/schema/chains.ts`：
```ts
import { char, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const chains = mysqlTable('chains', {
  id: char('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  // 引用未来的 media.id——media 表属 Phase 3，本阶段不加外键，Phase 3 迁移时补 FK。
  coverMediaId: char('cover_media_id', { length: 36 }),
  visibility: mysqlEnum('visibility', ['private', 'link', 'public']).notNull().default('private'),
  ownerId: char('owner_id', { length: 36 })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
});

export type Chain = typeof chains.$inferSelect;
export type NewChain = typeof chains.$inferInsert;
```

`apps/server/src/db/schema/chain-members.ts`：
```ts
import { char, index, mysqlEnum, mysqlTable, primaryKey, timestamp } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const chainMembers = mysqlTable(
  'chain_members',
  {
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull(),
    joinedAt: timestamp('joined_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.userId] }), index('idx_chain_members_user').on(t.userId)]
);

export type ChainMember = typeof chainMembers.$inferSelect;
```

`apps/server/src/db/schema/chain-invites.ts`：
```ts
import { char, index, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const chainInvites = mysqlTable(
  'chain_invites',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    // 48 字节随机 base64url（64 字符，~384bit 熵）。MySQL utf8mb4 默认 CI collation 下比较/唯一
    // 会折叠大小写，有效熵略降（~336bit），爆破仍不可行，可接受；share_links 等同型 token 沿用本约定。
    token: char('token', { length: 64 }).notNull().unique(),
    email: varchar('email', { length: 255 }),
    role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),
    createdBy: char('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_chain_invites_chain').on(t.chainId)]
);

export type ChainInvite = typeof chainInvites.$inferSelect;
export type NewChainInvite = typeof chainInvites.$inferInsert;
```

`apps/server/src/db/schema.ts`（整体替换）：
```ts
export * from './schema/users.js';
export * from './schema/refresh-tokens.js';
export * from './schema/chains.js';
export * from './schema/chain-members.js';
export * from './schema/chain-invites.js';
```

`apps/server/tests/helpers/db.ts`（整体替换）：
```ts
import { db, pool } from '../../src/db/index.js';
import { chainInvites, chainMembers, chains, refreshTokens, users } from '../../src/db/schema.js';

/** 每个用例前清表：按外键依赖逆序（先子表后父表）。仅允许对测试库使用。 */
export async function resetDb(): Promise<void> {
  await db.delete(chainInvites);
  await db.delete(chainMembers);
  await db.delete(chains);
  await db.delete(refreshTokens);
  await db.delete(users);
}

/** 测试文件收尾关闭连接池（不关闭 jest 进程会因 open handle 挂住不退出）。 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 4: 生成迁移并跑通**

确认 `apps/server/.env` 指向测试库后：
Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成 `drizzle/0001_*.sql`（含 `chains`、`chain_members`、`chain_invites` 三表）；输出 `migrations applied`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: 新 schema 测试 PASS；Phase 1 全部既有测试保持 PASS（resetDb 改动不破坏旧用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): chains/chain_members/chain_invites 三表、迁移与 resetDb 扩展"
```

---

### Task 3: ChainPolicy + requireChainRole 中间件 + populateUser 装配（契约任务）

**Files:**
- Create: `apps/server/src/chains/chain-policy.ts`、`apps/server/src/chains/require-chain-role.ts`
- Modify: `apps/server/src/auth/authorization.ts`（新增 `populateUser`，authorizationChecker 加短路）
- Modify: `apps/server/src/app.ts`（`useExpressServer` 前挂 `populateUser`）
- Test: `apps/server/tests/chains/chain-policy.test.ts`、`apps/server/tests/chains/require-chain-role.test.ts`

**Interfaces:**
- Consumes: `chains`/`chainMembers`（Task 2）、`users`、`TokenService`/`AuthService`（Phase 1）。
- Produces（**CONVENTIONS §3.1 契约，Phase 3–8 逐字消费，不得改名**）:
  - `export type ChainRole = 'viewer' | 'editor' | 'owner'`（偏序 viewer < editor < owner）
  - `class ChainPolicy`（`@Service()`）：`require(userId: string, chainId: string, minRole: ChainRole): Promise<ChainRole>`——角色不足抛 `ForbiddenError('CHAIN_ROLE_INSUFFICIENT')`；链不存在或非成员抛 `NotFoundError('CHAIN_NOT_FOUND')`；通过时返回实际角色。
  - `requireChainRole(minRole: ChainRole): RequestHandler`——`chainId` 取自 `params.chainId`，角色挂 `request.chainRole`；未登录抛 `UnauthorizedError('UNAUTHORIZED')`。
  - `populateUser: RequestHandler`（全局前置填充 `request.user`；无效/缺失 token 不拒绝，交由 `@Authorized`）。

**为什么需要 populateUser（执行者必须理解，勿删）：** routing-controllers 0.11 的路由注册顺序是 `route → routeGuard → @UseBefore 中间件 → @Authorized 检查 → handler`（见 `ExpressDriver.registerAction`），所以 `requireChainRole` 执行时 authorizationChecker 还没跑、`request.user` 尚未填充。`populateUser` 作为全局 express 中间件挂在 `useExpressServer` 之前，提前把 `request.user` 填好；`@Authorized` 仍在更靠后的位置做强制拒绝，语义不变。

- [ ] **Step 1: 写失败测试（policy 矩阵）**

`apps/server/tests/chains/chain-policy.test.ts`：
```ts
import { Container } from 'typedi';
import { ChainPolicy, type ChainRole } from '../../src/chains/chain-policy.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

const policy = () => Container.get(ChainPolicy);

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values([
    { id: 'user-owner', email: 'o@t.com', passwordHash: 'x', nickname: 'o' },
    { id: 'user-editor', email: 'e@t.com', passwordHash: 'x', nickname: 'e' },
    { id: 'user-viewer', email: 'v@t.com', passwordHash: 'x', nickname: 'v' },
    { id: 'user-stranger', email: 's@t.com', passwordHash: 'x', nickname: 's' },
  ]);
  await db.insert(chains).values({ id: 'chain-1', name: 'c', ownerId: 'user-owner' });
  await db.insert(chainMembers).values([
    { chainId: 'chain-1', userId: 'user-owner', role: 'owner' },
    { chainId: 'chain-1', userId: 'user-editor', role: 'editor' },
    { chainId: 'chain-1', userId: 'user-viewer', role: 'viewer' },
  ]);
});
afterAll(closeDb);

describe('ChainPolicy.require 角色矩阵（3 角色 × 3 最低要求）', () => {
  const ORDER: ChainRole[] = ['viewer', 'editor', 'owner'];
  const usersByRole: Record<ChainRole, string> = {
    viewer: 'user-viewer',
    editor: 'user-editor',
    owner: 'user-owner',
  };
  const cases = ORDER.flatMap((actual) => ORDER.map((min) => [actual, min] as [ChainRole, ChainRole]));

  it.each(cases)('实际角色 %s / 要求 %s', async (actual, min) => {
    const allowed = ORDER.indexOf(actual) >= ORDER.indexOf(min);
    const run = () => policy().require(usersByRole[actual], 'chain-1', min);
    if (allowed) {
      await expect(run()).resolves.toBe(actual);
    } else {
      await expect(run()).rejects.toMatchObject({ httpCode: 403, message: 'CHAIN_ROLE_INSUFFICIENT' });
    }
  });

  it('非成员 → 404 CHAIN_NOT_FOUND（不泄露链存在性）', async () => {
    await expect(policy().require('user-stranger', 'chain-1', 'viewer')).rejects.toMatchObject({
      httpCode: 404,
      message: 'CHAIN_NOT_FOUND',
    });
  });

  it('链不存在 → 404 CHAIN_NOT_FOUND', async () => {
    await expect(policy().require('user-owner', 'no-such-chain', 'viewer')).rejects.toMatchObject({
      httpCode: 404,
      message: 'CHAIN_NOT_FOUND',
    });
  });
});
```

- [ ] **Step 2: 写失败测试（requireChainRole 中间件 harness）**

`apps/server/tests/chains/require-chain-role.test.ts`：
```ts
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { populateUser } from '../../src/auth/authorization.js';
import { TokenService } from '../../src/auth/token.service.js';
import { requireChainRole } from '../../src/chains/require-chain-role.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

/** 最小 harness：populateUser + requireChainRole('editor') + 与 ErrorHandlerMiddleware 同语义的错误处理。 */
function harness(): express.Express {
  const app = express();
  app.use(populateUser);
  app.get('/x/:chainId', requireChainRole('editor'), (req, res) => {
    res.json({ chainRole: (req as unknown as { chainRole: string }).chainRole });
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { httpCode?: number; message?: string; name?: string };
    const status = e.httpCode ?? 500;
    const code = e.message && /^[A-Z0-9_]+$/.test(e.message) ? e.message : e.name;
    res.status(status).json({ error: { code, message: e.message } });
  });
  return app;
}

async function insertMember(id: string, role: 'owner' | 'editor' | 'viewer'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@t.com`, passwordHash: 'x', nickname: id });
  await db.insert(chainMembers).values({ chainId: 'chain-1', userId: id, role });
  return Container.get(TokenService).signAccessToken(id);
}

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ id: 'u-owner', email: 'owner@t.com', passwordHash: 'x', nickname: 'o' });
  await db.insert(chains).values({ id: 'chain-1', name: 'c', ownerId: 'u-owner' });
});
afterAll(closeDb);

describe('requireChainRole 中间件', () => {
  it('editor 成员放行并把角色挂到 request.chainRole', async () => {
    const token = await insertMember('u-editor', 'editor');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.chainRole).toBe('editor');
  });

  it('viewer 成员 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const token = await insertMember('u-viewer', 'viewer');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非成员 → 404 CHAIN_NOT_FOUND', async () => {
    await db.insert(users).values({ id: 'u-stranger', email: 's@t.com', passwordHash: 'x', nickname: 's' });
    const token = Container.get(TokenService).signAccessToken('u-stranger');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('链不存在 → 404 CHAIN_NOT_FOUND', async () => {
    const token = await insertMember('u-editor2', 'editor');
    const res = await request(harness()).get('/x/no-such-chain').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('无 token → 401 UNAUTHORIZED', async () => {
    const res = await request(harness()).get('/x/chain-1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- chains`
Expected: FAIL（`Cannot find module '../../src/chains/chain-policy.js'` 等）

- [ ] **Step 4: 实现 ChainPolicy + requireChainRole + populateUser**

`apps/server/src/chains/chain-policy.ts`：
```ts
import { and, eq } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains } from '../db/schema.js';

export type ChainRole = 'viewer' | 'editor' | 'owner'; // 偏序 viewer < editor < owner

const ROLE_ORDER: Record<ChainRole, number> = { viewer: 0, editor: 1, owner: 2 };

@Service()
export class ChainPolicy {
  /** 不足抛 ForbiddenError('CHAIN_ROLE_INSUFFICIENT')；非成员抛 NotFoundError('CHAIN_NOT_FOUND')。返回实际角色。 */
  async require(userId: string, chainId: string, minRole: ChainRole): Promise<ChainRole> {
    const [chain] = await db.select({ id: chains.id }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND');

    const [member] = await db
      .select({ role: chainMembers.role })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)))
      .limit(1);
    // 非成员与「链不存在」同码：不对外泄露链的存在性
    if (!member) throw new NotFoundError('CHAIN_NOT_FOUND');

    if (ROLE_ORDER[member.role] < ROLE_ORDER[minRole]) {
      throw new ForbiddenError('CHAIN_ROLE_INSUFFICIENT');
    }
    return member.role;
  }
}
```

`apps/server/src/chains/require-chain-role.ts`：
```ts
import type { UserProfile } from '@moment/dto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { BadRequestError, UnauthorizedError } from 'routing-controllers';
import { Container } from 'typedi';
import { ChainPolicy, type ChainRole } from './chain-policy.js';

/**
 * 中间件工厂：@UseBefore(requireChainRole('editor'))。
 * chainId 取自 params.chainId；角色挂 request.chainRole。
 * 依赖 request.user——由全局 populateUser 中间件在 useExpressServer 之前填充
 * （@UseBefore 先于 @Authorized 的 authorizationChecker 执行，见 app.ts 注释）。
 */
export function requireChainRole(minRole: ChainRole): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = (req as unknown as { user?: UserProfile }).user;
      if (!user) throw new UnauthorizedError('UNAUTHORIZED');
      const chainId = req.params.chainId;
      if (!chainId) throw new BadRequestError('CHAIN_ID_REQUIRED');
      const role = await Container.get(ChainPolicy).require(user.id, chainId, minRole);
      (req as unknown as { chainRole: ChainRole }).chainRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

`apps/server/src/auth/authorization.ts`（整体替换）：
```ts
import type { UserProfile } from '@moment/dto';
import type { NextFunction, Request, Response } from 'express';
import type { Action } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * routing-controllers 鉴权钩子：校验 Bearer access token，
 * 并拒绝签发时间早于 passwordChangedAt 的旧 token（改密即全端下线）。
 */
export async function authorizationChecker(action: Action, _roles: string[]): Promise<boolean> {
  // populateUser 已完成同样的校验（含 passwordChangedAt），直接采信，避免重复查库
  if ((action.request as unknown as { user?: UserProfile }).user) return true;
  const header: string | undefined = action.request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const { userId, iat } = Container.get(TokenService).verifyAccessToken(header.slice(7));
    const auth = Container.get(AuthService);
    const user = await auth.getUserEntity(userId);
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000) return false;
    (action.request as unknown as { user: UserProfile }).user = auth.toProfile(user);
    return true;
  } catch {
    return false;
  }
}

export async function currentUserChecker(action: Action): Promise<UserProfile | null> {
  return (action.request as unknown as { user?: UserProfile }).user ?? null;
}

/**
 * 全局前置中间件：请求带有效 Bearer token 时填充 request.user；无效/缺失 token 不拒绝
 * （保持匿名，由受保护路由上的 @Authorized 统一 401）。
 * 必须在 useExpressServer 之前挂载——routing-controllers 0.11 中 @UseBefore 中间件
 * （如 requireChainRole）先于 @Authorized 的 authorizationChecker 执行，依赖 request.user 已就绪。
 */
export async function populateUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const { userId, iat } = Container.get(TokenService).verifyAccessToken(header.slice(7));
      const auth = Container.get(AuthService);
      const user = await auth.getUserEntity(userId);
      if (!(user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000)) {
        (req as unknown as { user: UserProfile }).user = auth.toProfile(user);
      }
    } catch {
      // 缺失/无效 token：保持匿名
    }
  }
  next();
}
```

`apps/server/src/app.ts`（整体替换）：
```ts
import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker, populateUser } from './auth/authorization.js';
import { HealthController } from './controllers/health.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';
import { authRateLimiter, loginRateLimiter } from './middlewares/rate-limit.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/register', authRateLimiter);

  // 在 routing-controllers 路由前解析 Bearer token 并填充 request.user：
  // @UseBefore 中间件（requireChainRole 等）先于 @Authorized 的 authorizationChecker 执行，
  // 角色中间件依赖 request.user，必须提前挂载。
  app.use(populateUser);

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
    authorizationChecker,
    currentUserChecker,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: policy 矩阵 11 个 + harness 5 个 PASS；Phase 1 全部既有测试保持 PASS（authorizationChecker 短路不改变行为：register/login/me/refresh/logout 全流程不变）。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): ChainPolicy 与 requireChainRole 中间件（链角色契约）+ populateUser 装配"
```

---

### Task 4: 链 CRUD 端点（POST/GET 列表/GET 详情/PATCH/DELETE）

**Files:**
- Create: `apps/server/tests/helpers/auth.ts`、`apps/server/tests/helpers/chains.ts`
- Test: `apps/server/tests/chains/chains.crud.test.ts`
- Create: `apps/server/src/chains/chain.service.ts`、`apps/server/src/chains/chains.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 加 `ChainsController`）

**Interfaces:**
- Consumes: Task 1 dto（`createChainInputSchema`/`updateChainInputSchema`/`ChainDto`）、Task 3 的 `ChainPolicy`/`requireChainRole`、Task 2 表对象。
- Produces（Task 5/6 与 Phase 3+ 依赖）:
  - `class ChainService`（`@Service()`，构造注入 `ChainPolicy`）：
    - `create(userId: string, input: CreateChainInput): Promise<ChainDto>`（同事务插 chain + owner member）
    - `listMine(userId: string): Promise<ChainDto[]>`（join chain_members，含 myRole，createdAt 倒序）
    - `getById(userId: string, chainId: string): Promise<ChainDto>`（内部 `policy.require(userId, chainId, 'viewer')`）
    - `update(userId: string, chainId: string, input: UpdateChainInput): Promise<ChainDto>`
    - `remove(userId: string, chainId: string): Promise<void>`（同事务硬删 invites → members → chain）
  - HTTP：`POST /api/chains`（201）、`GET /api/chains`、`GET /api/chains/:chainId`、`PATCH /api/chains/:chainId`、`DELETE /api/chains/:chainId`（204）
  - 测试辅助：`tests/helpers/auth.ts` → `createUser(app, email, nickname?): Promise<TestUser>`（`TestUser = { id, email, accessToken }`）、`auth(user: TestUser): string`；`tests/helpers/chains.ts` → `createChain(app, owner, name?): Promise<ChainDto>`、`addMember(chainId, userId, role): Promise<void>`（直接入库，供权限测试准备数据）

- [ ] **Step 1: 写测试辅助 + 失败测试**

`apps/server/tests/helpers/auth.ts`：
```ts
import type { AuthResponse } from '@moment/dto';
import type { Express } from 'express';
import request from 'supertest';

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

/** 走真实注册接口造用户（密码统一 secret123），返回 id/email/accessToken。 */
export async function createUser(app: Express, email: string, nickname?: string): Promise<TestUser> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: nickname ?? email.split('@')[0] });
  if (res.status !== 201) {
    throw new Error(`createUser(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as AuthResponse;
  return { id: body.user.id, email: body.user.email, accessToken: body.tokens.accessToken };
}

/** Authorization 头值。 */
export function auth(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}
```

`apps/server/tests/helpers/chains.ts`：
```ts
import type { ChainDto, ChainRole } from '@moment/dto';
import type { Express } from 'express';
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { chainMembers } from '../../src/db/schema.js';
import { auth, type TestUser } from './auth.js';

/** 走真实 API 建链，返回 ChainDto。 */
export async function createChain(app: Express, owner: TestUser, name = '测试链'): Promise<ChainDto> {
  const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name });
  if (res.status !== 201) {
    throw new Error(`createChain failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as ChainDto;
}

/** 直接入库加成员（绕过邀请流程，供权限矩阵类测试准备数据）。 */
export async function addMember(chainId: string, userId: string, role: ChainRole): Promise<void> {
  await db.insert(chainMembers).values({ chainId, userId, role });
}
```

`apps/server/tests/chains/chains.crud.test.ts`：
```ts
import type { ChainDto } from '@moment/dto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let owner: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

describe('POST /api/chains', () => {
  it('201：创建者同事务成为 owner 成员，visibility 默认 private', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝成长', description: '记录每一天' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.name).toBe('宝宝成长');
    expect(chain.description).toBe('记录每一天');
    expect(chain.visibility).toBe('private');
    expect(chain.ownerId).toBe(owner.id);
    expect(chain.myRole).toBe('owner');
    expect(chain.coverMediaId).toBeNull();

    const members = await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id));
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(owner.id);
    expect(members[0].role).toBe('owner');
  });

  it('未登录 401；空 name 400 VALIDATION_ERROR', async () => {
    expect((await request(app).post('/api/chains').send({ name: 'x' })).status).toBe(401);
    const bad = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/chains', () => {
  it('只返回我参与的链，含我的角色', async () => {
    const mine = await createChain(app, owner, '我的链');
    const other = await createChain(app, outsider, '别人的链');
    // owner 以 viewer 身份加入 outsider 的链
    await addMember(other.id, owner.id, 'viewer');

    const res = await request(app).get('/api/chains').set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const list = res.body as ChainDto[];
    expect(list).toHaveLength(2);
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(byId[mine.id].myRole).toBe('owner');
    expect(byId[other.id].myRole).toBe('viewer');

    // outsider 的列表只有自己创建的链
    const res2 = await request(app).get('/api/chains').set('Authorization', auth(outsider));
    const list2 = res2.body as ChainDto[];
    expect(list2.map((c) => c.id)).toEqual([other.id]);
  });
});

describe('GET /api/chains/:chainId', () => {
  it('viewer+ 成员可读；非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const chain = await createChain(app, owner);
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chain.id, viewer.id, 'viewer');

    const ok = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(viewer));
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(chain.id);
    expect(ok.body.myRole).toBe('viewer');

    const nf = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');

    expect((await request(app).get(`/api/chains/${chain.id}`)).status).toBe(401);
  });
});

describe('PATCH /api/chains/:chainId', () => {
  it('owner 可改 name/description/visibility；editor/viewer 403；非成员 404；空 patch 400', async () => {
    const chain = await createChain(app, owner);
    const editor = await createUser(app, 'editor@example.com');
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chain.id, editor.id, 'editor');
    await addMember(chain.id, viewer.id, 'viewer');

    const res = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ name: '新名字', visibility: 'link', description: null });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('新名字');
    expect(res.body.visibility).toBe('link');
    expect(res.body.description).toBeNull();

    const forbidden = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor))
      .send({ name: 'x' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const viewerPatch = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(viewer))
      .send({ name: 'x' });
    expect(viewerPatch.status).toBe(403);
    expect(viewerPatch.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(outsider))
      .send({ name: 'x' });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');

    const empty = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/chains/:chainId', () => {
  it('owner 删除 204：members/invites 同事务硬删；editor 403', async () => {
    const chain = await createChain(app, owner);
    const editor = await createUser(app, 'editor@example.com');
    await addMember(chain.id, editor.id, 'editor');
    await db.insert(chainInvites).values({
      id: 'invite-1',
      chainId: chain.id,
      token: 't'.repeat(64),
      role: 'editor',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const forbidden = await request(app)
      .delete(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);

    const res = await request(app).delete(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(204);

    expect(await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id))).toHaveLength(0);
    expect(await db.select().from(chainInvites).where(eq(chainInvites.chainId, chain.id))).toHaveLength(0);
    const gone = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(gone.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- chains.crud`
Expected: FAIL（`POST /api/chains` 404）

- [ ] **Step 3: 实现 ChainService（CRUD 部分）+ ChainsController**

`apps/server/src/chains/chain.service.ts`：
```ts
import type { ChainDto, CreateChainInput, UpdateChainInput } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, type Chain } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';

@Service()
export class ChainService {
  constructor(private policy: ChainPolicy) {}

  /** 创建链：同事务把创建者写为 owner 成员（spec §3 事务边界）。 */
  async create(userId: string, input: CreateChainInput): Promise<ChainDto> {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(chains).values({
        id,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        ownerId: userId,
      });
      await tx.insert(chainMembers).values({ chainId: id, userId, role: 'owner' });
    });
    return this.getById(userId, id);
  }

  /** 我参与的链（含我的角色），createdAt 倒序。 */
  async listMine(userId: string): Promise<ChainDto[]> {
    const rows = await db
      .select({ chain: chains, role: chainMembers.role })
      .from(chainMembers)
      .innerJoin(chains, eq(chainMembers.chainId, chains.id))
      .where(eq(chainMembers.userId, userId))
      .orderBy(desc(chains.createdAt));
    return rows.map((r) => this.toChainDto(r.chain, r.role));
  }

  /** 详情：service 层过 ChainPolicy（读接口同样验成员身份，防 IDOR）。 */
  async getById(userId: string, chainId: string): Promise<ChainDto> {
    const role = await this.policy.require(userId, chainId, 'viewer');
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    return this.toChainDto(chain, role);
  }

  /** owner 改链设置（coverMediaId 属 Phase 3，本阶段不可改）。 */
  async update(userId: string, chainId: string, input: UpdateChainInput): Promise<ChainDto> {
    await this.policy.require(userId, chainId, 'owner');
    await db
      .update(chains)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chains.id, chainId));
    return this.getById(userId, chainId);
  }

  /**
   * owner 删链：同事务硬删 invites → members → chain。
   * 级联锚点：moments/media/tags/comments 等链内内容属 Phase 3+，
   * 届时在本事务最前面追加对应删除/软删逻辑。
   */
  async remove(userId: string, chainId: string): Promise<void> {
    await this.policy.require(userId, chainId, 'owner');
    await db.transaction(async (tx) => {
      await tx.delete(chainInvites).where(eq(chainInvites.chainId, chainId));
      await tx.delete(chainMembers).where(eq(chainMembers.chainId, chainId));
      await tx.delete(chains).where(eq(chains.id, chainId));
    });
  }

  private toChainDto(chain: Chain, myRole?: ChainRole): ChainDto {
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      coverMediaId: chain.coverMediaId,
      visibility: chain.visibility,
      ownerId: chain.ownerId,
      ...(myRole ? { myRole } : {}),
      createdAt: chain.createdAt.toISOString(),
      updatedAt: chain.updatedAt.toISOString(),
    };
  }
}
```

`apps/server/src/chains/chains.controller.ts`：
```ts
import {
  createChainInputSchema,
  updateChainInputSchema,
  type ChainDto,
  type UserProfile,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Patch,
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ChainService } from './chain.service.js';
import { requireChainRole } from './require-chain-role.js';

@JsonController('/chains')
@Service()
@Authorized()
export class ChainsController {
  constructor(private chainService: ChainService) {}

  @Post('/')
  @HttpCode(201)
  create(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<ChainDto> {
    return this.chainService.create(user.id, createChainInputSchema.parse(body));
  }

  @Get('/')
  list(@CurrentUser() user: UserProfile): Promise<ChainDto[]> {
    return this.chainService.listMine(user.id);
  }

  @Get('/:chainId')
  @UseBefore(requireChainRole('viewer'))
  getOne(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<ChainDto> {
    return this.chainService.getById(user.id, chainId);
  }

  @Patch('/:chainId')
  @UseBefore(requireChainRole('owner'))
  update(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<ChainDto> {
    return this.chainService.update(user.id, chainId, updateChainInputSchema.parse(body));
  }

  @Delete('/:chainId')
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('owner'))
  remove(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<void> {
    return this.chainService.remove(user.id, chainId);
  }
}
```

`apps/server/src/app.ts` 中 `useExpressServer` 的 controllers 行替换为（其余不动）：
```ts
    controllers: [HealthController, AuthController, ChainsController],
```
并在文件顶部 import 区加：
```ts
import { ChainsController } from './chains/chains.controller.js';
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: chains.crud 6 个测试 PASS；既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 链 CRUD 端点（创建/列表/详情/修改/删除）"
```

---

### Task 5: 成员管理 + owner 转让（GET members / PATCH role / DELETE member / POST transfer）

**Files:**
- Test: `apps/server/tests/chains/chains.members.test.ts`
- Modify: `apps/server/src/chains/chain.service.ts`（追加成员方法）
- Modify: `apps/server/src/chains/chains.controller.ts`（追加 4 条路由）

**Interfaces:**
- Consumes: Task 4 的 `ChainService`/`ChainsController`、helpers（`createUser/auth/createChain/addMember`）、dto（`updateMemberRoleInputSchema`/`transferChainInputSchema`/`ChainMemberDto`/`InviteRole`）。
- Produces（Phase 3+ 依赖的 HTTP 语义）:
  - `ChainService.listMembers(userId, chainId): Promise<ChainMemberDto[]>`（viewer+，joinedAt 升序）
  - `ChainService.updateMemberRole(actorId, chainId, targetUserId, role: InviteRole): Promise<ChainMemberDto>`——改自己 `400 CANNOT_CHANGE_OWN_ROLE`；目标非成员 `404 MEMBER_NOT_FOUND`；role=owner 已被 dto schema 拒（400）
  - `ChainService.removeMember(actorId, chainId, targetUserId): Promise<void>`——owner 移除他人或本人退链；owner 退链 `409 OWNER_MUST_TRANSFER`；非 owner 移除他人 `403 CHAIN_ROLE_INSUFFICIENT`；目标非成员 `404 MEMBER_NOT_FOUND`
  - `ChainService.transfer(actorId, chainId, targetUserId): Promise<ChainDto>`——同事务：旧 owner→editor、新 owner→owner、`chains.owner_id` 更新；转给自己 `400 CANNOT_TRANSFER_TO_SELF`；目标非成员 `404 MEMBER_NOT_FOUND`；返回以旧 owner 视角的 ChainDto（`myRole: 'editor'`）
  - HTTP：`GET /api/chains/:chainId/members`、`PATCH /api/chains/:chainId/members/:userId`、`DELETE /api/chains/:chainId/members/:userId`（204）、`POST /api/chains/:chainId/transfer`

- [ ] **Step 1: 写失败测试**

`apps/server/tests/chains/chains.members.test.ts`：
```ts
import type { ChainDto, ChainMemberDto } from '@moment/dto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

interface Fixture {
  owner: TestUser;
  editor: TestUser;
  viewer: TestUser;
  outsider: TestUser;
  chain: ChainDto;
}

async function setup(): Promise<Fixture> {
  const owner = await createUser(app, 'owner@example.com');
  const editor = await createUser(app, 'editor@example.com');
  const viewer = await createUser(app, 'viewer@example.com');
  const outsider = await createUser(app, 'outsider@example.com');
  const chain = await createChain(app, owner, '成员测试链');
  await addMember(chain.id, editor.id, 'editor');
  await addMember(chain.id, viewer.id, 'viewer');
  return { owner, editor, viewer, outsider, chain };
}

beforeEach(resetDb);
afterAll(closeDb);

describe('GET /api/chains/:chainId/members', () => {
  it('viewer+ 成员可见成员列表（含角色与昵称）；非成员 404', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const res = await request(app)
      .get(`/api/chains/${chain.id}/members`)
      .set('Authorization', auth(viewer));
    expect(res.status).toBe(200);
    const members = res.body as ChainMemberDto[];
    expect(members).toHaveLength(3);
    const byUser = Object.fromEntries(members.map((m) => [m.userId, m]));
    expect(byUser[owner.id].role).toBe('owner');
    expect(byUser[editor.id].role).toBe('editor');
    expect(byUser[viewer.id].role).toBe('viewer');
    expect(byUser[owner.id].nickname).toBe('owner');

    const nf = await request(app)
      .get(`/api/chains/${chain.id}/members`)
      .set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('PATCH /api/chains/:chainId/members/:userId', () => {
  it('owner 改他人角色 editor→viewer 200', async () => {
    const { owner, editor, chain } = await setup();
    const res = await request(app)
      .patch(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(editor.id);
    expect(res.body.role).toBe('viewer');
  });

  it('owner 改自己 400 CANNOT_CHANGE_OWN_ROLE；改成 owner 被 schema 拒 400', async () => {
    const { owner, editor, chain } = await setup();
    const self = await request(app)
      .patch(`/api/chains/${chain.id}/members/${owner.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'editor' });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');

    const toOwner = await request(app)
      .patch(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'owner' });
    expect(toOwner.status).toBe(400);
    expect(toOwner.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('editor 改角色 403；目标非成员 404 MEMBER_NOT_FOUND', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const forbidden = await request(app)
      .patch(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(editor))
      .send({ role: 'viewer' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .patch(`/api/chains/${chain.id}/members/${outsider.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'viewer' });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');
  });
});

describe('DELETE /api/chains/:chainId/members/:userId', () => {
  it('owner 移除他人 204；本人退链 204；owner 退链 409 OWNER_MUST_TRANSFER', async () => {
    const { owner, editor, viewer, chain } = await setup();

    const byeViewer = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(owner));
    expect(byeViewer.status).toBe(204);

    const selfLeave = await request(app)
      .delete(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(editor));
    expect(selfLeave.status).toBe(204);

    const ownerLeave = await request(app)
      .delete(`/api/chains/${chain.id}/members/${owner.id}`)
      .set('Authorization', auth(owner));
    expect(ownerLeave.status).toBe(409);
    expect(ownerLeave.body.error.code).toBe('OWNER_MUST_TRANSFER');

    const remaining = await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(owner.id);
  });

  it('editor 移除他人 403；目标非成员 404 MEMBER_NOT_FOUND；非成员操作 404 CHAIN_NOT_FOUND', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const forbidden = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .delete(`/api/chains/${chain.id}/members/${outsider.id}`)
      .set('Authorization', auth(owner));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');

    const stranger = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(outsider));
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('POST /api/chains/:chainId/transfer', () => {
  it('owner 转让：同事务改两边角色与 chains.owner_id；旧 owner 变 editor', async () => {
    const { owner, editor, chain } = await setup();
    const res = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: editor.id });
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(editor.id);
    expect(res.body.myRole).toBe('editor');

    const rows = await db
      .select()
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chain.id)));
    const roleOf = Object.fromEntries(rows.map((r) => [r.userId, r.role]));
    expect(roleOf[owner.id]).toBe('editor');
    expect(roleOf[editor.id]).toBe('owner');

    const [updated] = await db.select().from(chains).where(eq(chains.id, chain.id));
    expect(updated.ownerId).toBe(editor.id);

    // 转让后：新 owner 可改链设置，旧 owner 不可
    const ok = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor))
      .send({ name: '新 owner 改名' });
    expect(ok.status).toBe(200);
    const no = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ name: '旧 owner 改名' });
    expect(no.status).toBe(403);
  });

  it('转给自己 400 CANNOT_TRANSFER_TO_SELF；目标非成员 404；非 owner 发起 403', async () => {
    const { owner, editor, outsider, chain } = await setup();
    const self = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: owner.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_TRANSFER_TO_SELF');

    const nf = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: outsider.id });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');

    const forbidden = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(editor))
      .send({ userId: owner.id });
    expect(forbidden.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- chains.members`
Expected: FAIL（`/api/chains/:chainId/members` 等路由 404）

- [ ] **Step 3: 实现成员方法 + 路由**

`apps/server/src/chains/chain.service.ts`：
1) import 块整体替换为：
```ts
import type { ChainDto, ChainMemberDto, CreateChainInput, InviteRole, UpdateChainInput } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { BadRequestError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, users, type Chain } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';
```
2) 在 `ChainService` 类中（`toChainDto` 之前）追加以下方法：
```ts
  /** 成员列表（viewer+），joinedAt 升序（owner 通常在最前）。 */
  async listMembers(userId: string, chainId: string): Promise<ChainMemberDto[]> {
    await this.policy.require(userId, chainId, 'viewer');
    const rows = await db
      .select({ member: chainMembers, nickname: users.nickname })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(eq(chainMembers.chainId, chainId))
      .orderBy(chainMembers.joinedAt);
    return rows.map((r) => ({
      userId: r.member.userId,
      nickname: r.nickname,
      role: r.member.role,
      joinedAt: r.member.joinedAt.toISOString(),
    }));
  }

  /** owner 改他人角色（仅 editor/viewer——role=owner 已被 dto schema 拒绝；转让走 transfer）。 */
  async updateMemberRole(
    actorId: string,
    chainId: string,
    targetUserId: string,
    role: InviteRole
  ): Promise<ChainMemberDto> {
    if (targetUserId === actorId) throw new BadRequestError('CANNOT_CHANGE_OWN_ROLE');
    await this.policy.require(actorId, chainId, 'owner');
    const [row] = await db
      .select({ member: chainMembers, nickname: users.nickname })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!row) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db
      .update(chainMembers)
      .set({ role })
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
    return { userId: targetUserId, nickname: row.nickname, role, joinedAt: row.member.joinedAt.toISOString() };
  }

  /**
   * 移除成员：owner 可移除他人；editor/viewer 可移除自己（退链）。
   * owner 退链被拒——必须先 transfer 或删链（spec §5.7）。
   */
  async removeMember(actorId: string, chainId: string, targetUserId: string): Promise<void> {
    const actorRole = await this.policy.require(actorId, chainId, 'viewer');
    if (targetUserId === actorId) {
      if (actorRole === 'owner') throw new HttpError(409, 'OWNER_MUST_TRANSFER');
    } else {
      await this.policy.require(actorId, chainId, 'owner');
    }
    const [target] = await db
      .select({ userId: chainMembers.userId })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!target) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db
      .delete(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
  }

  /** owner 转让：同事务改 chains.owner_id 与两边 members 角色（spec §3 事务边界）。 */
  async transfer(actorId: string, chainId: string, targetUserId: string): Promise<ChainDto> {
    if (targetUserId === actorId) throw new BadRequestError('CANNOT_TRANSFER_TO_SELF');
    await this.policy.require(actorId, chainId, 'owner');
    const [target] = await db
      .select({ userId: chainMembers.userId })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!target) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db.transaction(async (tx) => {
      await tx
        .update(chainMembers)
        .set({ role: 'editor' })
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, actorId)));
      await tx
        .update(chainMembers)
        .set({ role: 'owner' })
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
      await tx.update(chains).set({ ownerId: targetUserId, updatedAt: new Date() }).where(eq(chains.id, chainId));
    });
    return this.getById(actorId, chainId);
  }
```

`apps/server/src/chains/chains.controller.ts`：
1) import 块中 dto 部分替换为：
```ts
import {
  createChainInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
  type ChainDto,
  type ChainMemberDto,
  type UserProfile,
} from '@moment/dto';
```
2) 在 `ChainsController` 类中（`remove` 方法之后）追加：
```ts
  @Get('/:chainId/members')
  @UseBefore(requireChainRole('viewer'))
  listMembers(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<ChainMemberDto[]> {
    return this.chainService.listMembers(user.id, chainId);
  }

  @Patch('/:chainId/members/:userId')
  @UseBefore(requireChainRole('owner'))
  updateMemberRole(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown
  ): Promise<ChainMemberDto> {
    return this.chainService.updateMemberRole(
      user.id,
      chainId,
      targetUserId,
      updateMemberRoleInputSchema.parse(body).role
    );
  }

  @Delete('/:chainId/members/:userId')
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('viewer'))
  removeMember(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Param('userId') targetUserId: string
  ): Promise<void> {
    // viewer 中间件只挡非成员（404）；「本人退链 vs owner 移除他人」的分支裁决在 service 内经 ChainPolicy 完成
    return this.chainService.removeMember(user.id, chainId, targetUserId);
  }

  @Post('/:chainId/transfer')
  @UseBefore(requireChainRole('owner'))
  transfer(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<ChainDto> {
    return this.chainService.transfer(user.id, chainId, transferChainInputSchema.parse(body).userId);
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: chains.members 8 个测试 PASS；既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 链成员管理与 owner 转让端点"
```

---

### Task 6: 邀请闭环（创建/列表/吊销/接受）+ INVITE_TTL_DAYS + accept 限流

**Files:**
- Test: `apps/server/tests/chains/chains.invites.test.ts`
- Modify: `apps/server/src/config.ts`（加 `INVITE_TTL_DAYS`）
- Modify: `apps/server/src/middlewares/rate-limit.ts`（加 `inviteAcceptRateLimiter`）
- Modify: `apps/server/src/chains/chain.service.ts`（追加邀请方法）
- Modify: `apps/server/src/chains/chains.controller.ts`（追加 2 条链内邀请路由）
- Create: `apps/server/src/chains/invites.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 加 `InvitesController`；accept 路由挂 `inviteAcceptRateLimiter`）
- Modify: `apps/server/.env.example`（加 `INVITE_TTL_DAYS=7`）

**Interfaces:**
- Consumes: Task 4/5 全部、`authRateLimiter`（Phase 1）、dto（`createInviteInputSchema`/`InviteDto`/`AcceptInviteResponse`）。
- Produces（Phase 3+ 依赖）:
  - `config.INVITE_TTL_DAYS: number`（默认 7）
  - `ChainService.createInvite(userId, chainId, input: CreateInviteInput): Promise<InviteDto>`（editor+；token = 48 字节随机 base64url 共 64 字符；过期 = now + INVITE_TTL_DAYS 天）
  - `ChainService.listInvites(userId, chainId): Promise<InviteDto[]>`（owner）
  - `ChainService.revokeInvite(userId, inviteId): Promise<void>`（owner，硬删；不存在 `404 INVITE_NOT_FOUND`）
  - `ChainService.acceptInvite(user: UserProfile, token: string): Promise<AcceptInviteResponse>`——判定顺序：不存在 `404 INVITE_NOT_FOUND` → 已是成员 `200 alreadyMember:true`（幂等，不写库）→ email 不匹配 `403 INVITE_EMAIL_MISMATCH` → 已被他人接受 `410 INVITE_ALREADY_ACCEPTED` → 过期 `410 INVITE_EXPIRED` → 同事务写 member + accepted_at
  - HTTP：`POST /api/chains/:chainId/invites`（201）、`GET /api/chains/:chainId/invites`、`DELETE /api/invites/:inviteId`（204）、`POST /api/invites/:token/accept`（`@Authorized` + `inviteAcceptRateLimiter`）
  - `inviteAcceptRateLimiter`（IP + 账号/invitee 维度，60s/5 次；test 环境 1000）——只挂 accept 路由，不覆盖 `DELETE /api/invites/:inviteId`

- [ ] **Step 1: 写失败测试**

`apps/server/tests/chains/chains.invites.test.ts`：
```ts
import type { ChainDto, InviteDto } from '@moment/dto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainInvites } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let invitee: TestUser;
let chain: ChainDto;

async function createInvite(user: TestUser, chainId: string, body: object = {}): Promise<InviteDto> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/invites`)
    .set('Authorization', auth(user))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createInvite failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as InviteDto;
}

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  editor = await createUser(app, 'editor@example.com');
  viewer = await createUser(app, 'viewer@example.com');
  invitee = await createUser(app, 'invitee@example.com');
  chain = await createChain(app, owner, '邀请测试链');
  await addMember(chain.id, editor.id, 'editor');
  await addMember(chain.id, viewer.id, 'viewer');
});
afterAll(closeDb);

describe('POST /api/chains/:chainId/invites', () => {
  it('owner/editor 可创建：token 64 字符不可猜测，role 默认 editor，过期约 7 天，email 归一化', async () => {
    const byOwner = await createInvite(owner, chain.id, { email: '  Invited@Example.COM ' });
    expect(byOwner.token).toHaveLength(64);
    expect(byOwner.role).toBe('editor');
    expect(byOwner.email).toBe('invited@example.com');
    expect(byOwner.chainId).toBe(chain.id);
    expect(byOwner.acceptedAt).toBeNull();
    expect(new Date(byOwner.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const byEditor = await createInvite(editor, chain.id, { role: 'viewer' });
    expect(byEditor.role).toBe('viewer');

    // 两次 token 不同（不可猜测随机）
    expect(byEditor.token).not.toBe(byOwner.token);
  });

  it('viewer 创建 403；role=owner 400；非成员 404', async () => {
    const forbidden = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(viewer))
      .send({});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const badRole = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner))
      .send({ role: 'owner' });
    expect(badRole.status).toBe(400);

    const stranger = await createUser(app, 'stranger@example.com');
    const nf = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(stranger))
      .send({});
    expect(nf.status).toBe(404);
  });
});

describe('GET /api/chains/:chainId/invites', () => {
  it('owner 可见列表；editor 403', async () => {
    const invite = await createInvite(owner, chain.id);
    const res = await request(app)
      .get(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const list = res.body as InviteDto[];
    expect(list).toHaveLength(1);
    expect(list[0].token).toBe(invite.token);

    const forbidden = await request(app)
      .get(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
  });
});

describe('DELETE /api/invites/:inviteId', () => {
  it('owner 吊销 204（硬删）；editor 403；不存在 404 INVITE_NOT_FOUND', async () => {
    const invite = await createInvite(owner, chain.id);

    const forbidden = await request(app)
      .delete(`/api/invites/${invite.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const res = await request(app).delete(`/api/invites/${invite.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(204);
    expect(await db.select().from(chainInvites).where(eq(chainInvites.id, invite.id))).toHaveLength(0);

    const nf = await request(app).delete(`/api/invites/${invite.id}`).set('Authorization', auth(owner));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('INVITE_NOT_FOUND');
  });
});

describe('POST /api/invites/:token/accept', () => {
  it('接受成功：同事务写 member + accepted_at；幂等再接受返回 alreadyMember', async () => {
    const invite = await createInvite(owner, chain.id, { role: 'viewer' });

    const res = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chainId: chain.id, role: 'viewer', alreadyMember: false });

    const [row] = await db.select().from(chainInvites).where(eq(chainInvites.id, invite.id));
    expect(row.acceptedAt).not.toBeNull();

    // 幂等：已是成员再接受 → 200 原角色，不写库
    const again = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ chainId: chain.id, role: 'viewer', alreadyMember: true });

    // invitee 现在能以 viewer 身份读链
    const detail = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(invitee));
    expect(detail.status).toBe(200);
    expect(detail.body.myRole).toBe('viewer');
  });

  it('email 绑定的邀请：邮箱不匹配 403 INVITE_EMAIL_MISMATCH；匹配则放行', async () => {
    const bound = await createInvite(owner, chain.id, { email: 'invitee@example.com' });

    // 注意：必须用「非成员」用户测 mismatch——已是成员会命中幂等分支先返回 200
    const other = await createUser(app, 'other@example.com');
    const mismatch = await request(app)
      .post(`/api/invites/${bound.token}/accept`)
      .set('Authorization', auth(other));
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('INVITE_EMAIL_MISMATCH');

    const ok = await request(app)
      .post(`/api/invites/${bound.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(ok.status).toBe(200);
    expect(ok.body.alreadyMember).toBe(false);
  });

  it('未知 token 404 INVITE_NOT_FOUND；未登录 401', async () => {
    const nf = await request(app)
      .post(`/api/invites/${'n'.repeat(64)}/accept`)
      .set('Authorization', auth(invitee));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('INVITE_NOT_FOUND');

    const invite = await createInvite(owner, chain.id);
    expect((await request(app).post(`/api/invites/${invite.token}/accept`)).status).toBe(401);
  });

  it('过期 410 INVITE_EXPIRED；已被他人接受 410 INVITE_ALREADY_ACCEPTED', async () => {
    // 直接入库造一个已过期邀请
    await db.insert(chainInvites).values({
      id: 'expired-invite',
      chainId: chain.id,
      token: 'e'.repeat(64),
      role: 'editor',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await request(app)
      .post(`/api/invites/${'e'.repeat(64)}/accept`)
      .set('Authorization', auth(invitee));
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('INVITE_EXPIRED');

    // invitee 先接受；第二个用户再接受同一 token → 410
    const invite = await createInvite(owner, chain.id);
    await request(app).post(`/api/invites/${invite.token}/accept`).set('Authorization', auth(invitee));
    const late = await createUser(app, 'late@example.com');
    const res = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(late));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_ALREADY_ACCEPTED');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- chains.invites`
Expected: FAIL（`/api/chains/:chainId/invites` 与 `/api/invites/*` 路由 404）

- [ ] **Step 3: 实现邀请方法 + InvitesController + config + 限流**

`apps/server/src/config.ts` 的 `envSchema` 中（`REFRESH_TOKEN_TTL_DAYS` 行之后）加一行：
```ts
  INVITE_TTL_DAYS: z.coerce.number().default(7),
```

`apps/server/src/chains/chain.service.ts`：
1) import 块整体替换为：
```ts
import type {
  AcceptInviteResponse,
  ChainDto,
  ChainMemberDto,
  CreateChainInput,
  CreateInviteInput,
  InviteDto,
  InviteRole,
  UpdateChainInput,
  UserProfile,
} from '@moment/dto';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, users, type Chain, type ChainInvite } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';
```
2) 在 `ChainService` 类中（`toChainDto` 之前）追加以下方法：
```ts
  /** editor+ 生成邀请：token 为 48 字节随机 base64url（64 字符，不可猜测），默认 INVITE_TTL_DAYS 天过期。 */
  async createInvite(userId: string, chainId: string, input: CreateInviteInput): Promise<InviteDto> {
    await this.policy.require(userId, chainId, 'editor');
    const id = randomUUID();
    await db.insert(chainInvites).values({
      id,
      chainId,
      token: randomBytes(48).toString('base64url'),
      email: input.email ?? null,
      role: input.role,
      createdBy: userId,
      expiresAt: new Date(Date.now() + config.INVITE_TTL_DAYS * 86_400_000),
    });
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.id, id)).limit(1);
    return this.toInviteDto(invite);
  }

  /** owner 查看本链全部邀请（含 token，用于复制分享）。 */
  async listInvites(userId: string, chainId: string): Promise<InviteDto[]> {
    await this.policy.require(userId, chainId, 'owner');
    const rows = await db
      .select()
      .from(chainInvites)
      .where(eq(chainInvites.chainId, chainId))
      .orderBy(desc(chainInvites.createdAt));
    return rows.map((r) => this.toInviteDto(r));
  }

  /** owner 吊销邀请：硬删除。 */
  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.id, inviteId)).limit(1);
    if (!invite) throw new NotFoundError('INVITE_NOT_FOUND');
    await this.policy.require(userId, invite.chainId, 'owner');
    await db.delete(chainInvites).where(eq(chainInvites.id, inviteId));
  }

  /**
   * 接受邀请（登录用户）。判定顺序固定：
   * 不存在 404 → 已是成员 200 幂等 → email 不匹配 403 → 已被接受 410 → 过期 410 → 同事务写 member + accepted_at。
   */
  async acceptInvite(user: UserProfile, token: string): Promise<AcceptInviteResponse> {
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.token, token)).limit(1);
    if (!invite) throw new NotFoundError('INVITE_NOT_FOUND');

    // 幂等：已是成员直接返回现有角色（不写库、不看邀请状态）
    const [member] = await db
      .select({ role: chainMembers.role })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, invite.chainId), eq(chainMembers.userId, user.id)))
      .limit(1);
    if (member) return { chainId: invite.chainId, role: member.role, alreadyMember: true };

    // 两侧 email 均已小写归一化（注册与创建邀请时的 zod schema）
    if (invite.email && invite.email !== user.email) throw new ForbiddenError('INVITE_EMAIL_MISMATCH');
    if (invite.acceptedAt) throw new HttpError(410, 'INVITE_ALREADY_ACCEPTED');
    if (invite.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'INVITE_EXPIRED');

    await db.transaction(async (tx) => {
      await tx.insert(chainMembers).values({ chainId: invite.chainId, userId: user.id, role: invite.role });
      await tx.update(chainInvites).set({ acceptedAt: new Date() }).where(eq(chainInvites.id, invite.id));
      // outbox 锚点：「被邀请入链」通知扇出属 Phase 5（outbox 表 Phase 3 才建立），此处不写。
    });
    return { chainId: invite.chainId, role: invite.role, alreadyMember: false };
  }
```
3) 在 `toChainDto` 之后追加私有序列化方法：
```ts
  private toInviteDto(invite: ChainInvite): InviteDto {
    return {
      id: invite.id,
      chainId: invite.chainId,
      token: invite.token,
      email: invite.email,
      role: invite.role,
      createdBy: invite.createdBy,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : null,
      createdAt: invite.createdAt.toISOString(),
    };
  }
```

`apps/server/src/chains/chains.controller.ts`：
1) import 块中 dto 部分整体替换为：
```ts
import {
  createChainInputSchema,
  createInviteInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
  type ChainDto,
  type ChainMemberDto,
  type InviteDto,
  type UserProfile,
} from '@moment/dto';
```
2) 在 `ChainsController` 类中（`transfer` 方法之后）追加：
```ts
  @Post('/:chainId/invites')
  @HttpCode(201)
  @UseBefore(requireChainRole('editor'))
  createInvite(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<InviteDto> {
    return this.chainService.createInvite(user.id, chainId, createInviteInputSchema.parse(body));
  }

  @Get('/:chainId/invites')
  @UseBefore(requireChainRole('owner'))
  listInvites(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<InviteDto[]> {
    return this.chainService.listInvites(user.id, chainId);
  }
```

`apps/server/src/middlewares/rate-limit.ts`（整体替换）：
```ts
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const isTest = config.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };

/** 注册等敏感端点：IP 维度，60s/10 次。测试环境放宽避免用例互踩。 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** 登录：IP + 账号双维度（spec §4/§6），60s/5 次，防分布式 IP 爆破同一账号。 */
export const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
  message,
});

/**
 * 邀请接受：IP + 账号（invitee）+ invite token 三维度（spec §4/§6），60s/5 次。
 * 只挂在 `POST /api/invites/:token/accept` 上（populateUser 之后注册，req.user 可读），
 * 不覆盖 DELETE /api/invites/:inviteId 的 owner 吊销操作。
 */
export const inviteAcceptRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
    const token = typeof req.params?.token === 'string' ? req.params.token : '';
    return `${req.ip}:${userId}:${token}`;
  },
  message,
});
```

`apps/server/src/chains/invites.controller.ts`：
```ts
import type { AcceptInviteResponse, UserProfile } from '@moment/dto';
import {
  Authorized,
  CurrentUser,
  Delete,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ChainService } from './chain.service.js';

@JsonController('/invites')
@Service()
@Authorized()
export class InvitesController {
  constructor(private chainService: ChainService) {}

  @Delete('/:inviteId')
  @HttpCode(204)
  @OnUndefined(204)
  revoke(@CurrentUser() user: UserProfile, @Param('inviteId') inviteId: string): Promise<void> {
    return this.chainService.revokeInvite(user.id, inviteId);
  }

  @Post('/:token/accept')
  accept(@CurrentUser() user: UserProfile, @Param('token') token: string): Promise<AcceptInviteResponse> {
    return this.chainService.acceptInvite(user, token);
  }
}
```

`apps/server/src/app.ts`（整体替换）：
```ts
import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker, populateUser } from './auth/authorization.js';
import { ChainsController } from './chains/chains.controller.js';
import { InvitesController } from './chains/invites.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';
import { authRateLimiter, inviteAcceptRateLimiter, loginRateLimiter } from './middlewares/rate-limit.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/register', authRateLimiter);

  // 在 routing-controllers 路由前解析 Bearer token 并填充 request.user：
  // @UseBefore 中间件（requireChainRole 等）先于 @Authorized 的 authorizationChecker 执行，
  // 角色中间件依赖 request.user，必须提前挂载。
  app.use(populateUser);

  // 邀请接受限流（spec §4/§6：IP + 账号维度）——挂在 populateUser 之后，keyGenerator 可读 req.user。
  // 命中后 next() 落入 routing-controllers 的同名 POST 路由，不影响其注册。
  app.post('/api/invites/:token/accept', inviteAcceptRateLimiter);

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController, ChainsController, InvitesController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
    authorizationChecker,
    currentUserChecker,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
```

`apps/server/.env.example` 在 `REFRESH_TOKEN_TTL_DAYS=30` 行之后加一行：
```dotenv
INVITE_TTL_DAYS=7
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: chains.invites 8 个测试 PASS；既有全部 PASS。

- [ ] **Step 5: 全量验证**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、全部测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): 链邀请闭环（创建/列表/吊销/接受）与 INVITE_TTL_DAYS"
```

---

## 完成标准（Phase 2 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿（含 Phase 1 回归）。
- `chain_policy` 单测覆盖 3 角色 × 3 最低要求全矩阵 + 非成员/链不存在两条 404。
- 手动 curl 验证：注册 A/B → A 建链 → A 发邀请 → B accept → B 可读链（viewer）→ A 转让 → B 成为 owner 可改链、A 变 editor 不可改。
- 越权语义全通：非成员访问任何 `/api/chains/:chainId*` 一律 404 `CHAIN_NOT_FOUND`；owner 退链 409 `OWNER_MUST_TRANSFER`。
- `resetDb()` 清表顺序含三张新表；`config.ts` 与 `.env.example` 均含 `INVITE_TTL_DAYS`。
- CONVENTIONS §3.1 契约符号（`ChainRole`/`ChainPolicy.require`/`requireChainRole`）与本文档签名逐字一致，可供 Phase 3 直接 import。
