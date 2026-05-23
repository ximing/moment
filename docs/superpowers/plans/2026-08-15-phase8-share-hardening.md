# Phase 8: 分享与加固（share_links + 匿名公开页 + sweeper + 生产部署）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec §1（链接分享可见性）、§3（share_links 表）、§4（Chains share-links 端点 + Public 匿名端点）、§5.3（media `?st=` share 透传点）、§5.5（防孤儿 sweeper + S3 lifecycle）、§9（生产 docker-compose + 备份）的剩余全部内容：share_links 表与 owner 管理端点、匿名只读公开 API 与 web `/share/:token` 公开页、媒体读取的 share token 透传、worker 媒体 sweeper（dry-run 先行）、S3 bucket lifecycle 配置脚本、生产化 compose（server/worker/mysql/backup）与 README 运维章节，并结清 Phase 1 评审遗留的 express-rate-limit IPv6 keyGenerator 问题（升级 v8）。

**Architecture:** 全部在既有 monorepo 上增量：`@moment/dto` 新增 `share.ts`；`@moment/server` 新增 `src/share/`（ShareLinkService + 管理 controller + 匿名公开 controller）、`src/worker/sweeper.ts`（周期清理，复用 worker 单循环）、handlers 注册 `moment.deleted`；改造 Phase 3 预留的 `MediaService.resolveAccessUrl(user, mediaId, st?)` 透传接缝（去掉 GET 的 `@Authorized()`，匿名 + 有效 st 放行 302）。`@moment/api-client` 追加 4 个 typed 方法；`apps/web` 新增匿名路由 `/share/:token`。worker 不引入 node-cron——复用 Phase 5 的单 `while(running)` 循环，按 `SWEEPER_INTERVAL_MS` 节拍顺带跑 sweeper，优雅退出语义零改动。

**Tech Stack:** 继承 Phase 1–7（Express + routing-controllers + TypeDI + Drizzle + mysql2、zod 3、Jest + supertest、React 19 + Vite + TanStack Query）。变更依赖：`express-rate-limit` ^7 → ^8（`ipKeyGenerator` 修复 IPv6 /56 分组）。生产化：Docker 多阶段构建（node:22-alpine + corepack pnpm）、mysql:8.4 镜像派生 backup sidecar（mysqldump + awscli，while/sleep 循环，不装 cron daemon）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§1 链可见性、§3 share_links、§4 Chains/Public/Media API、§5.3 媒体读取、§5.5 防孤儿、§6 安全、§9 部署运维）；`docs/superpowers/plans/CONVENTIONS.md` §2/§3.1/§3.3/§3.4/§3.5/§3.6/§4。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- 假设 Phase 1–7 已按计划执行完毕，以下符号直接引用、不得改名：`ChainPolicy`/`requireChainRole`（CONVENTIONS §3.1）、`queryMomentPage`（`src/feed/moment-query.ts`）、`serializeMoments(rows, viewerId?)`（`src/moments/moment-serializer.ts`）、`getStorage()/setStorageAdapter`（`src/storage/factory.ts`）、`alignedGetPresign`（`src/media/presign-ttl.ts`）、`MediaService.resolveAccessUrl`（Phase 3 预留 st 接缝）、`handlers`/`OutboxHandler`（`src/worker/handlers.ts`）、`runOutboxBatch`（`src/worker/processor.ts`）、`OUTBOX_MOMENT_DELETED`（`src/outbox/types.ts`）、fixtures（`tests/helpers/fixtures.ts` 的 `registerUser/createChain/addMember/insertMoment/app`）、`installMockStorage`（`tests/helpers/storage.ts`）、api-client 的 `Http`/`createMomentClient`/`ApiError`。
- **公开页互动数据决策**：`GET /api/public/share/:token` 复用 `serializeMoments(page.rows)`（不传 viewerId → `myReaction` 恒 null），**返回只读计数**（`commentCount`/`reactions` 计数对匿名可见，属链主主动公开内容的一部分）；匿名**不可**评论/点表情（无匿名写端点，spec §4 Public 原文），web 公开页不渲染任何互动/编辑入口。
- **`?st=` 优先级决策**：`GET /api/media/:id` 只要带 `st` 参数即走 share token 校验路径（忽略登录态）；不带 `st` 走原登录/成员路径。跨链媒体、未绑定 moment 的 media、软删 moment 的 media 在 st 路径下一律 404 `MEDIA_NOT_FOUND`（不泄露存在性）；token 无效/过期/吊销一律 404 `SHARE_NOT_FOUND`。
- **share token 存储决策**：`randomBytes(32).toString('hex')`（64 字符），库存**明文**（与 `chain_invites.token` 同策略，spec §6 只要求不可猜测 + 唯一索引；owner 列表需完整展示以便复制）。刷新哈希化留 backlog。
- **`moment.deleted` handler 决策**：只把该 moment 的 `ready` media 行置 `status='orphaned'`（幂等，对齐 media 表预留枚举），**不物理删**；物理清理由周期 sweeper 按 30 天保留期执行（spec §5.5「sweeper 延迟物理清理」）。
- **sweeper dry-run 先行**：`SWEEPER_DRY_RUN=true` 时只打日志不删任何行/对象；生产首次部署先以 dry-run 跑一轮观察，再关开关（写进 README 运维章节）。单轮每类最多处理 500 行，下一轮继续，避免长事务与 S3 风暴。
- **backup 环境变量决策**：`BACKUP_S3_*`/`BACKUP_INTERVAL_SECONDS` 仅 backup sidecar 的 shell 脚本读取，**不进** `apps/server/src/config.ts`（server/worker 进程不读），只进 `.env.example`（注明 sidecar 专用）。server 进程新增的 `SWEEPER_*`/`MEDIA_*` 变量照常同步 config.ts + `.env.example`。
- **compose 不含 web service**：web 是静态构建产物（`pnpm --filter @moment/web build` → `apps/web/dist`），生产用任意静态托管/nginx 同源反代 `/api` 即可（README 写明）；compose services 严格按 spec §9：server/worker/mysql/backup。
- **Phase 6 页面组件未入契约**（其计划 Tasks 5–10 的组件名未钉死），`/share/:token` 公开页交付**自包含**只读时间线（`ShareMomentCard`），只复用已钉死的基建（`client` 单例、Tailwind、`m.url` 稳定入口相对路径）。若 Phase 6 落地了可复用的只读 moment 卡片，执行者可替换 `ShareMomentCard` 内部实现，页面行为与本计划测试/验收保持一致即可。
- 删链级联：`share_links.chain_id` 是 FK，`ChainService.remove` 的删链事务中必须追加 `share_links` 删除（本计划 Task 2 兑现：插在所有级联删除最前面、`tx.delete(chains)` 之前）。
- **路由总表偏离声明**：spec §4 含 `DELETE /share-links/:id`（吊销），CONVENTIONS §3.6 Phase 8 行原本未列该路由；Task 3 落地时必须同步把 CONVENTIONS §3.6 Phase 8 行更新为 `/api/chains/:chainId/share-links*`、`/api/share-links/:id`、`/api/public/share/:token`（CONVENTIONS 是所有计划的契约基准，不允许只落代码不改表）。
- **ready 未绑定 moment 的 media 行暂不回收**：sweeper 只清 `uploading` 超期行与软删超期 moment 的媒体；`ready` 但未绑定 moment 的中间态（上传完成、尚未发帖）DB 行永久保留（其 tmp 对象由 bucket lifecycle 7 天规则兜底），spec §5.5 未要求回收，后续如需再立项。
- 每 Task 一个 commit，conventional commits（`feat(server): ...` / `feat(dto): ...` / `feat(api-client): ...` / `feat(web): ...` / `chore: ...`）。

---

### Task 1: packages/dto — share.ts（TDD）

**Files:**
- Test: `packages/dto/src/share.test.ts`
- Create: `packages/dto/src/share.ts`
- Modify: `packages/dto/src/index.ts`（re-export）

**Interfaces:**
- Consumes: `MomentResponse`（`src/moments.ts`，Phase 3/5）。
- Produces（Task 3/4/8 与 web/app 依赖，不得改名）:
  - `createShareLinkInputSchema` / `CreateShareLinkInput`（`{ expiresAt?: ISO datetime }`，缺省永不过期）
  - `publicShareQuerySchema` / `PublicShareQuery`（`{ cursor?: string; limit: number 默认 20，1–50 }`）
  - `ShareLinkDto = { id; chainId; token; expiresAt: string|null; revokedAt: string|null; createdAt: string }`
  - `ShareLinkListResponse = { items: ShareLinkDto[] }`
  - `PublicShareChainInfo = { name: string; description: string | null }`
  - `PublicShareResponse = { chain: PublicShareChainInfo; moments: MomentResponse[]; nextCursor: string | null }`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/share.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareLinkInputSchema, publicShareQuerySchema } from './share.js';

test('createShareLinkInputSchema：空对象合法（永不过期）', () => {
  assert.deepEqual(createShareLinkInputSchema.parse({}), {});
});

test('createShareLinkInputSchema：接受 ISO datetime，拒绝垃圾串与裸日期', () => {
  const iso = new Date('2027-01-01T00:00:00.000Z').toISOString();
  assert.deepEqual(createShareLinkInputSchema.parse({ expiresAt: iso }), { expiresAt: iso });
  assert.throws(() => createShareLinkInputSchema.parse({ expiresAt: 'not-a-date' }));
  assert.throws(() => createShareLinkInputSchema.parse({ expiresAt: '2027-01-01' }));
});

test('publicShareQuerySchema：limit 默认 20、字符串可 coerce、超界拒绝', () => {
  assert.deepEqual(publicShareQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(publicShareQuerySchema.parse({ limit: '30' }), { limit: 30 });
  assert.throws(() => publicShareQuerySchema.parse({ limit: 0 }));
  assert.throws(() => publicShareQuerySchema.parse({ limit: 51 }));
});

test('publicShareQuerySchema：cursor 空串与超长拒绝（Phase 4 游标边界约定，Phase 5/8 复用同一约定）', () => {
  assert.throws(() => publicShareQuerySchema.parse({ cursor: '' }));
  assert.throws(() => publicShareQuerySchema.parse({ cursor: 'x'.repeat(1025) }));
  assert.deepEqual(publicShareQuerySchema.parse({ cursor: 'abc' }), { cursor: 'abc', limit: 20 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './share.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/share.ts`：
```ts
import { z } from 'zod';
import type { MomentResponse } from './moments.js';

/** owner 创建分享链接：expiresAt 缺省 = 永不过期（spec §1：可设过期） */
export const createShareLinkInputSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

/** 匿名公开页游标分页（固定 happened_at 排序，游标格式与 feed 一致，CONVENTIONS §3.4） */
export const publicShareQuerySchema = z.object({
  // Phase 4 游标边界约定（Phase 5/8 复用同一约定）：空串与 >1024 属 schema 校验错 → 400 VALIDATION_ERROR
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PublicShareQuery = z.infer<typeof publicShareQuerySchema>;

export interface ShareLinkDto {
  id: string;
  chainId: string;
  /** 明文 token（与 chain_invites.token 同策略；分享 URL 由客户端拼 /share/:token） */
  token: string;
  /** ISO 8601，null = 永不过期 */
  expiresAt: string | null;
  /** ISO 8601，null = 未吊销 */
  revokedAt: string | null;
  createdAt: string;
}

export interface ShareLinkListResponse {
  items: ShareLinkDto[];
}

export interface PublicShareChainInfo {
  name: string;
  description: string | null;
}

/** 匿名只读视图：计数只读展示（commentCount/reactions），myReaction 恒 null */
export interface PublicShareResponse {
  chain: PublicShareChainInfo;
  moments: MomentResponse[];
  nextCursor: string | null;
}
```

`packages/dto/src/index.ts` 末尾追加一行：
```ts
export * from './share.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 4 个新测试 PASS（既有测试保持 PASS）；dist 生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): share 域 zod schema 与共享类型"
```

---

### Task 2: share_links 表 + 迁移 + resetDb 扩展 + 删链级联

**Files:**
- Create: `apps/server/src/db/schema/share-links.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 追加）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 扩展）
- Modify: `apps/server/src/chains/chain.service.ts`（`remove` 删链事务追加 share_links 删除）
- Create: `apps/server/drizzle/000X_*.sql`（`drizzle-kit generate` 产物）

**Interfaces:**
- Consumes: Phase 2 的 `chains`/`chainMembers` 表对象、`ChainService.remove`（其删链事务内已含 reactions/comments/momentTags/tags/media/moments/chainInvites/chainMembers 级联删除）。
- Produces（Task 3–6 依赖，不得改名）:
  - `shareLinks` 表对象（列：`id/chainId/token/createdBy/expiresAt/revokedAt/createdAt`；`token char(64) unique`，索引 `idx_share_links_chain(chain_id)`）；`ShareLink`（$inferSelect）/ `NewShareLink`（$inferInsert）
  - 扩展后的 `resetDb()`（share_links 先于 chains/users 清空）
  - `ChainService.remove` 删链同事务删除 share_links（FK 约束要求）

- [ ] **Step 1: 写表定义**

`apps/server/src/db/schema/share-links.ts`：
```ts
import { char, index, mysqlTable, timestamp } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const shareLinks = mysqlTable(
  'share_links',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    /** 64 字符 hex（randomBytes(32)），不可猜测 + 唯一索引（spec §6） */
    token: char('token', { length: 64 }).notNull().unique(),
    createdBy: char('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** null = 永不过期 */
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }),
    /** null = 未吊销；吊销置时间戳（一链多链接、单独吊销，spec §1） */
    revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
    /**
     * fsp:3 毫秒精度（本表特例，全仓其余表为秒级）：
     * 1) owner 列表 ORDER BY created_at DESC 在秒级下同秒并列 → filesort 顺序不确定（测试 flaky）；
     * 2) 与 JS Date 毫秒精度一致，ShareLinkService.create 返回内存行与 list 回查行精度自洽。
     */
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('idx_share_links_chain').on(t.chainId)]
);

export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;
```

`apps/server/src/db/schema.ts` 末尾追加一行：
```ts
export * from './schema/share-links.js';
```

- [ ] **Step 2: 扩展 resetDb**

`apps/server/tests/helpers/db.ts`：import 区把 `shareLinks` 并入既有 schema import；`resetDb()` 函数体中、**删除 `chains` 的那一行之前**插入（share_links 引用 chains.id 与 users.id，必须先于二者清空；放链域各表同段即可）：
```ts
  await db.delete(shareLinks);
```

- [ ] **Step 3: 删链级联（FK 约束的硬要求）**

`apps/server/src/chains/chain.service.ts` 的 `remove` 方法事务内、`tx.delete(chains)` 之前任意位置插入一行（建议放在所有级联删除的最前面，即 `reactions` 删除之前）：
```ts
      await tx.delete(shareLinks).where(eq(shareLinks.chainId, chainId));
```
import 区把 `shareLinks` 并入既有 schema import。

- [ ] **Step 4: 生成迁移并跑通**

确认 `apps/server/.env` 指向测试库后：
Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成 `drizzle/000X_*.sql`（含 `share_links` 建表——三个 timestamp 列均为 `timestamp(3)`——+ `token` 唯一索引 + `idx_share_links_chain`）；输出 `migrations applied`；库中出现 `share_links` 表。

- [ ] **Step 5: 验证既有测试全绿**

Run: `pnpm --filter @moment/server test`
Expected: Phase 1–7 全部既有测试 PASS（globalSetup 重跑迁移；resetDb 新增 delete 与删链级联不影响既有用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): share_links 表、迁移、resetDb 扩展与删链级联"
```

---

### Task 3: ShareLinkService + owner 管理端点（TDD）

**Files:**
- Create: `apps/server/src/share/share-link.service.ts`、`apps/server/src/share/share-links.controller.ts`
- Modify: `apps/server/src/app.ts`（注册两个 controller）
- Modify: `docs/superpowers/plans/CONVENTIONS.md`（§3.6 Phase 8 行追加 `/api/share-links/:id`，见 Global Constraints 偏离声明）
- Test: `apps/server/tests/share/share-links.test.ts`

**Interfaces:**
- Consumes: Task 1 dto、Task 2 `shareLinks` 表、`ChainPolicy`/`requireChainRole('owner')`（CONVENTIONS §3.1）、fixtures。
- Produces（Task 4/5/8 依赖，不得改名）:
  - `class ShareLinkService`（`@Service()`）：
    - `create(userId: string, chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto>`（鉴权在 `requireChainRole('owner')` 中间件，service 不重复）
    - `list(chainId: string): Promise<ShareLinkListResponse>`（含已吊销，createdAt 倒序，owner 管理视图）
    - `revoke(userId: string, shareLinkId: string): Promise<void>`（资源 id 反查链 → `ChainPolicy.require(userId, chainId, 'owner')`；不存在 → `NotFoundError('SHARE_LINK_NOT_FOUND')`；重复吊销幂等 204）
    - `findValidByToken(token: string): Promise<ShareLink | null>`（有效 = 存在 + `revokedAt` null +（`expiresAt` null 或 > now）；无效一律 null——Task 4/5 的匿名路径统一消费）
  - HTTP：`POST /api/chains/:chainId/share-links`（owner，201）、`GET /api/chains/:chainId/share-links`（owner）、`DELETE /api/share-links/:id`（owner，204）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/share/share-links.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, shareLinks } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

let owner: { id: string; token: string };
let editor: { id: string; token: string };
let viewer: { id: string; token: string };
let outsider: { id: string; token: string };
let chainId: string;

beforeEach(async () => {
  await resetDb();
  owner = await registerUser();
  editor = await registerUser();
  viewer = await registerUser();
  outsider = await registerUser();
  chainId = await createChain(owner.id, '宝宝成长');
  await addMember(chainId, editor.id, 'editor');
  await addMember(chainId, viewer.id, 'viewer');
});
afterAll(closeDb);

describe('POST /api/chains/:chainId/share-links', () => {
  it('owner 创建：201，token 为 64 字符 hex，默认永不过期', async () => {
    const res = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.expiresAt).toBeNull();
    expect(res.body.revokedAt).toBeNull();
    expect(res.body.chainId).toBe(chainId);
  });

  it('带 expiresAt：透传 ISO 时间', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt });
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBe(expiresAt);
  });

  it('editor/viewer 创建 → 403 CHAIN_ROLE_INSUFFICIENT；非成员 → 404 CHAIN_NOT_FOUND', async () => {
    const asEditor = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({});
    expect(asEditor.status).toBe(403);
    expect(asEditor.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asViewer = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({});
    expect(asViewer.status).toBe(403);

    const asOutsider = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({});
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('非法 expiresAt → 400 VALIDATION_ERROR；未登录 → 401', async () => {
    const bad = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: 'not-a-date' });
    expect(bad.status).toBe(400);

    const anon = await request(app).post(`/api/chains/${chainId}/share-links`).send({});
    expect(anon.status).toBe(401);
  });
});

describe('GET /api/chains/:chainId/share-links', () => {
  it('owner 列表：含已吊销，createdAt 倒序；非 owner → 403', async () => {
    const a = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const b = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${a.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    const res = await request(app)
      .get(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].id).toBe(b.body.id); // 倒序：后建在前
    expect(res.body.items[1].revokedAt).not.toBeNull();

    const denied = await request(app)
      .get(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(denied.status).toBe(403);
  });
});

describe('DELETE /api/share-links/:id', () => {
  it('owner 吊销 204；重复吊销幂等 204；库中 revoked_at 落库', async () => {
    const created = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});

    const del = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(204);

    const again = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(again.status).toBe(204);

    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, created.body.id));
    expect(row.revokedAt).not.toBeNull();
  });

  it('editor 吊销 → 403；非成员 → 404；不存在 id → 404 SHARE_LINK_NOT_FOUND', async () => {
    const created = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});

    const asEditor = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(asEditor.status).toBe(403);

    const asOutsider = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(404);

    const missing = await request(app)
      .delete('/api/share-links/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SHARE_LINK_NOT_FOUND');
  });
});

describe('删链级联（Task 2 兑现）', () => {
  it('含 share link 的链可正常删除（204），share_links 行同步清除', async () => {
    await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const res = await request(app)
      .delete(`/api/chains/${chainId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(shareLinks).where(eq(shareLinks.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(chains).where(eq(chains.id, chainId))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- share`
Expected: FAIL（`/api/chains/:chainId/share-links` 404）

- [ ] **Step 3: 实现**

`apps/server/src/share/share-link.service.ts`：
```ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateShareLinkInput, ShareLinkDto, ShareLinkListResponse } from '@moment/dto';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { shareLinks, type ShareLink } from '../db/schema.js';

function toDto(row: ShareLink): ShareLinkDto {
  return {
    id: row.id,
    chainId: row.chainId,
    token: row.token,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Service()
export class ShareLinkService {
  constructor(private readonly policy: ChainPolicy) {}

  /**
   * 创建（owner 鉴权在 requireChainRole 中间件完成，CONVENTIONS §3.1：controller 内禁止手写角色判断）。
   * 直接返回内存行是安全的：Task 2 三个 timestamp 列为 fsp:3，与 JS Date 毫秒精度一致，
   * create 的 201 响应与后续 list 回查响应精度自洽（无需回查或截断）。
   */
  async create(userId: string, chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto> {
    const row: ShareLink = {
      id: randomUUID(),
      chainId,
      token: randomBytes(32).toString('hex'), // 64 字符不可猜测（spec §6）
      createdBy: userId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: null,
      createdAt: new Date(),
    };
    await db.insert(shareLinks).values(row);
    return toDto(row);
  }

  /** owner 管理视图：含已吊销（可审计），createdAt 倒序 */
  async list(chainId: string): Promise<ShareLinkListResponse> {
    const rows = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.chainId, chainId))
      .orderBy(desc(shareLinks.createdAt));
    return { items: rows.map(toDto) };
  }

  /** 吊销（幂等）：资源 id 反查链 → ChainPolicy（非成员 404 CHAIN_NOT_FOUND、非 owner 403 CHAIN_ROLE_INSUFFICIENT） */
  async revoke(userId: string, shareLinkId: string): Promise<void> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, shareLinkId)).limit(1);
    if (!row) throw new NotFoundError('SHARE_LINK_NOT_FOUND');
    await this.policy.require(userId, row.chainId, 'owner');
    if (row.revokedAt) return; // 幂等
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, row.id));
  }

  /** 有效 = 存在 + 未吊销 + 未过期；无效一律 null（匿名路径统一 404，不区分原因） */
  async findValidByToken(token: string): Promise<ShareLink | null> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }
}
```

`apps/server/src/share/share-links.controller.ts`：
```ts
import {
  createShareLinkInputSchema,
  type ShareLinkDto,
  type ShareLinkListResponse,
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
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { ShareLinkService } from './share-link.service.js';

@JsonController('/chains/:chainId/share-links')
@Service()
export class ShareLinksController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Post('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  @HttpCode(201)
  create(
    @Param('chainId') chainId: string,
    @CurrentUser() user: UserProfile,
    @Body() body: unknown
  ): Promise<ShareLinkDto> {
    return this.shareLinks.create(user.id, chainId, createShareLinkInputSchema.parse(body));
  }

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  list(@Param('chainId') chainId: string): Promise<ShareLinkListResponse> {
    return this.shareLinks.list(chainId);
  }
}

@JsonController('/share-links')
@Service()
export class ShareLinkItemController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Delete('/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.shareLinks.revoke(user.id, id);
  }
}
```

`apps/server/src/app.ts`：import 区追加
```ts
import { ShareLinkItemController, ShareLinksController } from './share/share-links.controller.js';
```
`useExpressServer` 的 `controllers` 数组追加 `ShareLinksController, ShareLinkItemController`（位置不限，保持既有条目不动）。

`docs/superpowers/plans/CONVENTIONS.md` §3.6 路由总表 Phase 8 行更新为（兑现 Global Constraints 偏离声明，本 Task 落了 `DELETE /api/share-links/:id`）：
```
| Phase 8 | `/api/chains/:chainId/share-links*`、`/api/share-links/:id`、`/api/public/share/:token` |
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- share`
Expected: share-links 9 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server docs/superpowers/plans/CONVENTIONS.md
git commit -m "feat(server): share_links owner 管理端点（创建/列表/吊销）"
```

---

### Task 4: 匿名公开 API（GET /api/public/share/:token）+ 限流（TDD）

**Files:**
- Create: `apps/server/src/share/public-share.controller.ts`
- Modify: `apps/server/src/share/share-link.service.ts`（追加 `getSharedChain`）
- Modify: `apps/server/src/middlewares/rate-limit.ts`（追加 `publicShareRateLimiter`）
- Modify: `apps/server/src/app.ts`（注册 PublicShareController + 挂限流）
- Test: `apps/server/tests/share/public-share.test.ts`

**Interfaces:**
- Consumes: Task 3 `ShareLinkService.findValidByToken`、`queryMomentPage`（`src/feed/moment-query.ts`，自带 `deleted_at IS NULL` 过滤）、`serializeMoments`（不传 viewerId → `myReaction: null`，Phase 5 契约）、`chains` 表、`publicShareQuerySchema`。
- Produces:
  - `ShareLinkService.getSharedChain(token: string, query: PublicShareQuery): Promise<PublicShareResponse>`（token 无效/过期/吊销 → `NotFoundError('SHARE_NOT_FOUND')`；固定 `order: 'happened_at'`）
  - `publicShareRateLimiter`（IP 维度 60s/60 次；test 环境 1000）挂在 `/api/public`
  - HTTP：`GET /api/public/share/:token?cursor=&limit=`（**匿名**，不挂 `@Authorized()`）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/share/public-share.test.ts`：
```ts
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { shareLinks } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

let owner: { id: string; token: string };
let chainId: string;
let shareToken: string;

beforeEach(async () => {
  await resetDb();
  owner = await registerUser();
  chainId = await createChain(owner.id, '宝宝成长');
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({});
  shareToken = res.body.token;
});
afterAll(closeDb);

describe('GET /api/public/share/:token（匿名）', () => {
  it('有效 token：200，返回链信息 + moments，无需登录', async () => {
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z'), content: '第一次翻身' });
    const res = await request(app).get(`/api/public/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.chain).toEqual({ name: '宝宝成长', description: null });
    expect(res.body.moments).toHaveLength(1);
    expect(res.body.moments[0].content).toBe('第一次翻身');
    // 只读计数存在，匿名视角 myReaction 恒 null（Global Constraints 决策）
    expect(res.body.moments[0].commentCount).toBe(0);
    expect(res.body.moments[0].myReaction).toBeNull();
    expect(res.body.nextCursor).toBeNull();
  });

  it('游标翻页：25 条分两页取完，不丢不重；软删 moment 不出现', async () => {
    const base = Date.UTC(2026, 7, 1);
    for (let i = 0; i < 25; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(base + i * 60_000), content: `m-${i}` });
    }
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(base - 60_000),
      content: 'deleted',
      deletedAt: new Date(),
    });

    const page1 = await request(app).get(`/api/public/share/${shareToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.moments).toHaveLength(20);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app).get(
      `/api/public/share/${shareToken}?cursor=${encodeURIComponent(page1.body.nextCursor)}`
    );
    expect(page2.status).toBe(200);
    expect(page2.body.moments).toHaveLength(5);
    expect(page2.body.nextCursor).toBeNull();

    const ids = new Set([...page1.body.moments, ...page2.body.moments].map((m: { id: string }) => m.id));
    expect(ids.size).toBe(25);
    expect([...page1.body.moments, ...page2.body.moments].some((m: { content: string }) => m.content === 'deleted')).toBe(false);
  });

  it('跨链隔离：别的链的 moment 不出现', async () => {
    const other = await registerUser();
    const otherChain = await createChain(other.id, '别的链');
    await insertMoment({ chainId: otherChain, authorId: other.id, happenedAt: new Date(), content: 'secret' });
    const res = await request(app).get(`/api/public/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(0);
  });

  it('未知 token / 吊销 / 过期 → 一律 404 SHARE_NOT_FOUND（不区分原因）', async () => {
    const unknown = await request(app).get(`/api/public/share/${'0'.repeat(64)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SHARE_NOT_FOUND');

    // 吊销
    const revoked = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${revoked.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const afterRevoke = await request(app).get(`/api/public/share/${revoked.body.token}`);
    expect(afterRevoke.status).toBe(404);
    expect(afterRevoke.body.error.code).toBe('SHARE_NOT_FOUND');

    // 过期（直插一个 expiresAt 在过去的链接，绕过创建时的未来时间惯例）
    const expired = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await db
      .update(shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareLinks.id, expired.body.id));
    const afterExpire = await request(app).get(`/api/public/share/${expired.body.token}`);
    expect(afterExpire.status).toBe(404);
    expect(afterExpire.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('limit 超界 → 400 VALIDATION_ERROR；非法 cursor → 400 INVALID_CURSOR', async () => {
    const badLimit = await request(app).get(`/api/public/share/${shareToken}?limit=51`);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe('VALIDATION_ERROR');

    const badCursor = await request(app).get(`/api/public/share/${shareToken}?cursor=!!!junk`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- public-share`
Expected: FAIL（`/api/public/share/:token` 404 `NOT_FOUND`）

- [ ] **Step 3: 实现**

`apps/server/src/share/share-link.service.ts` 追加（import 区补充 `PublicShareQuery`/`PublicShareResponse`（@moment/dto）、`chains`（并入 schema import）、`queryMomentPage`、`serializeMoments`）：
```ts
// —— import 区补充（合并进文件顶部既有 import）——
import type { PublicShareQuery, PublicShareResponse } from '@moment/dto'; // 与既有 dto import 合并
import { chains, shareLinks, type ShareLink } from '../db/schema.js'; // chains 并入既有 schema import
import { queryMomentPage } from '../feed/moment-query.js';
import { serializeMoments } from '../moments/moment-serializer.js';
```
类内追加方法：
```ts
  /**
   * 匿名只读视图（spec §4 Public）：token 无效/过期/吊销一律 404 SHARE_NOT_FOUND；
   * 固定 happened_at 排序，复用 feed 查询 builder（自带 deleted_at IS NULL，CONVENTIONS §3.4）；
   * serializeMoments 不传 viewerId → myReaction 恒 null（计数只读，见计划 Global Constraints 决策）。
   */
  async getSharedChain(token: string, query: PublicShareQuery): Promise<PublicShareResponse> {
    const link = await this.findValidByToken(token);
    if (!link) throw new NotFoundError('SHARE_NOT_FOUND');

    const [chain] = await db
      .select({ name: chains.name, description: chains.description })
      .from(chains)
      .where(eq(chains.id, link.chainId))
      .limit(1);
    if (!chain) throw new NotFoundError('SHARE_NOT_FOUND');

    const page = await queryMomentPage({
      chainIds: [link.chainId],
      order: 'happened_at',
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      chain: { name: chain.name, description: chain.description },
      moments: await serializeMoments(page.rows),
      nextCursor: page.nextCursor,
    };
  }
```

`apps/server/src/share/public-share.controller.ts`：
```ts
import { publicShareQuerySchema, type PublicShareResponse } from '@moment/dto';
import { Get, JsonController, Param, QueryParam } from 'routing-controllers';
import { Service } from 'typedi';
import { ShareLinkService } from './share-link.service.js';

/** 匿名公开端点（spec §4 Public）：不挂 @Authorized，无任何写操作。 */
@JsonController('/public')
@Service()
export class PublicShareController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Get('/share/:token')
  getShared(
    @Param('token') token: string,
    @QueryParam('cursor') cursor: string | undefined,
    @QueryParam('limit') limit: string | undefined
  ): Promise<PublicShareResponse> {
    return this.shareLinks.getSharedChain(token, publicShareQuerySchema.parse({ cursor, limit }));
  }
}
```

`apps/server/src/middlewares/rate-limit.ts` 末尾追加：
```ts
/** 匿名公开端点：IP 维度 60s/60 次（公开页一次浏览 = 1 次 API + N 次 media 302，媒体不走本 limiter）。 */
export const publicShareRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
```

`apps/server/src/app.ts`：import 区追加
```ts
import { PublicShareController } from './share/public-share.controller.js';
```
`controllers` 数组追加 `PublicShareController`；既有限流挂载行（`app.use('/api/auth/login', ...)` 等）旁边追加：
```ts
  app.use('/api/public', publicShareRateLimiter);
```
（`publicShareRateLimiter` 并入既有 rate-limit import。挂载位置必须在 `useExpressServer` 之前，与既有限流一致。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- public-share`
Expected: public-share 6 个用例 PASS；share-links 9 个保持 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 匿名公开 API /api/public/share/:token 与限流"
```

---

### Task 5: GET /api/media/:id 的 `?st=` share 透传（TDD，兑现 Phase 3 接缝）

**Files:**
- Modify: `apps/server/src/media/media.service.ts`（`resolveAccessUrl` 实现 st 路径；构造器注入 `ShareLinkService`）
- Modify: `apps/server/src/media/media.controller.ts`（GET /:id 去掉 `@Authorized()`，`@CurrentUser()` 可空）
- Test: `apps/server/tests/media/media-access.test.ts`（替换 `?st=` 403 用例为 share 鉴权矩阵）、`apps/server/tests/share/share-media.test.ts`（新建，完整矩阵放这里）

**Interfaces:**
- Consumes: Phase 3 `MediaService.resolveAccessUrl`/`alignedGetPresign`/`installMockStorage`、Task 3 `ShareLinkService.findValidByToken`、`moments`/`media` 表。
- Produces:
  - `MediaService.resolveAccessUrl(user: UserProfile | null, mediaId: string, st?: string): Promise<string>`（签名第一参改为可空；`st !== undefined` 走 share 校验并忽略登录态——Global Constraints 决策）
  - HTTP：`GET /api/media/:id?st=` 行为矩阵：匿名+有效 st+本链 media → 302；st 无效/过期/吊销 → 404 `SHARE_NOT_FOUND`；跨链/未绑定/软删 moment 的 media → 404 `MEDIA_NOT_FOUND`；无 st 且未登录 → 401。

- [ ] **Step 1: 写失败测试（新建矩阵 + 改造旧用例）**

新建 `apps/server/tests/share/share-media.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, shareLinks } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

let storage: Record<string, jest.Mock>;
let owner: { id: string; token: string };
let other: { id: string; token: string };
let chainId: string;
let otherChainId: string;
let shareToken: string;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

/** 直插 ready media（可绑定 moment）。 */
async function insertReadyMedia(uploaderId: string, momentId: string | null): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId,
    uploaderId,
    s3Key: `chains/x/y/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
  });
  return id;
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  owner = await registerUser();
  other = await registerUser();
  chainId = await createChain(owner.id, '公开链');
  otherChainId = await createChain(other.id, '别的链');
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({});
  shareToken = res.body.token;
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

describe('GET /api/media/:id?st=（share token 透传，spec §5.3）', () => {
  it('匿名 + 有效 st + 本链 media → 302 预签名', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    const res = await request(app).get(`/api/media/${mediaId}?st=${shareToken}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalled();
  });

  it('有效 st + 跨链 media → 404 MEDIA_NOT_FOUND（不泄露存在性）', async () => {
    const otherMoment = await insertMoment({ chainId: otherChainId, authorId: other.id, happenedAt: new Date() });
    const foreignMedia = await insertReadyMedia(other.id, otherMoment);

    const res = await request(app).get(`/api/media/${foreignMedia}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('st 吊销/过期/未知 → 404 SHARE_NOT_FOUND', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    // 吊销
    const revoked = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${revoked.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const r1 = await request(app).get(`/api/media/${mediaId}?st=${revoked.body.token}`);
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe('SHARE_NOT_FOUND');

    // 过期
    const expiring = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await db
      .update(shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareLinks.id, expiring.body.id));
    const r2 = await request(app).get(`/api/media/${mediaId}?st=${expiring.body.token}`);
    expect(r2.status).toBe(404);
    expect(r2.body.error.code).toBe('SHARE_NOT_FOUND');

    // 未知
    const r3 = await request(app).get(`/api/media/${mediaId}?st=${'f'.repeat(64)}`);
    expect(r3.status).toBe(404);
    expect(r3.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('有效 st + 未绑定 moment 的 media → 404（tmp/半成品不外发）', async () => {
    const unbound = await insertReadyMedia(owner.id, null);
    const res = await request(app).get(`/api/media/${unbound}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('有效 st + 软删 moment 的 media → 404', async () => {
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      deletedAt: new Date(),
    });
    const mediaId = await insertReadyMedia(owner.id, momentId);
    const res = await request(app).get(`/api/media/${mediaId}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('匿名 无 st → 401；st 存在时忽略登录态（有效 st + 非成员登录 → 仍 302）', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    const anon = await request(app).get(`/api/media/${mediaId}`);
    expect(anon.status).toBe(401);

    const loggedInOutsider = await request(app)
      .get(`/api/media/${mediaId}?st=${shareToken}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(loggedInOutsider.status).toBe(302);
  });
});
```

改造 `apps/server/tests/media/media-access.test.ts` 的既有用例「带 ?st= share token → 403 SHARE_NOT_SUPPORTED（Phase 8 实现透传）」——整个 `it(...)` 替换为：
```ts
  it('带 ?st= 未知 share token → 404 SHARE_NOT_FOUND（Phase 8 已落地透传，完整矩阵见 tests/share/share-media.test.ts）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}?st=${'0'.repeat(64)}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SHARE_NOT_FOUND');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- media`
Expected: FAIL（新矩阵匿名用例 401/403 与预期不符；旧改造用例仍 403 `SHARE_NOT_SUPPORTED`）

- [ ] **Step 3: 实现**

`apps/server/src/media/media.service.ts`：
1. import 区补充（合并进既有 import）：`UnauthorizedError`（routing-controllers——既有行 `import { ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';` 改为 `import { HttpError, NotFoundError, UnauthorizedError } from 'routing-controllers';`：**`HttpError` 必须保留**（presign/complete/abort 的 4xx/409 仍在用）；`ForbiddenError` 唯一使用点是本 Task 删除的 `SHARE_NOT_SUPPORTED` 分支，随之一并移除）、`ShareLinkService`（`../share/share-link.service.js`）、`Media` 类型（schema import 带 `type Media`）。
2. 构造器改为双依赖：
```ts
  constructor(
    private readonly policy: ChainPolicy,
    private readonly shareLinks: ShareLinkService
  ) {}
```
3. `resolveAccessUrl` 整体替换（含新增的私有方法）：
```ts
  /**
   * 鉴权后返回预签名 GET URL（302 目标）：
   * - st !== undefined：share token 透传路径（spec §5.3），忽略登录态；
   * - 无 st：登录 + 成员/uploader 校验（Phase 3 原语义）；
   * - 已绑定 moment：moment 未软删时校验所属链 viewer；未绑定：仅 uploader 本人。
   */
  async resolveAccessUrl(user: UserProfile | null, mediaId: string, st?: string): Promise<string> {
    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row || row.status !== 'ready') throw new NotFoundError('MEDIA_NOT_FOUND');

    if (st !== undefined) {
      await this.assertShareAccess(st, row);
    } else {
      if (!user) throw new UnauthorizedError('UNAUTHORIZED');
      if (row.momentId) {
        const [m] = await db
          .select({ chainId: moments.chainId, deletedAt: moments.deletedAt })
          .from(moments)
          .where(eq(moments.id, row.momentId))
          .limit(1);
        if (!m || m.deletedAt) throw new NotFoundError('MEDIA_NOT_FOUND');
        await this.policy.require(user.id, m.chainId, 'viewer');
      } else if (row.uploaderId !== user.id) {
        throw new NotFoundError('MEDIA_NOT_FOUND');
      }
    }

    const { signingDate, expiresIn } = alignedGetPresign();
    return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, expiresIn, signingDate);
  }

  /** share token 透传：token 有效 + media 绑定该链未软删 moment → 放行；其余一律 404，不泄露存在性。 */
  private async assertShareAccess(token: string, row: Media): Promise<void> {
    const link = await this.shareLinks.findValidByToken(token);
    if (!link) throw new NotFoundError('SHARE_NOT_FOUND');
    if (!row.momentId) throw new NotFoundError('MEDIA_NOT_FOUND');
    const [m] = await db
      .select({ chainId: moments.chainId, deletedAt: moments.deletedAt })
      .from(moments)
      .where(eq(moments.id, row.momentId))
      .limit(1);
    if (!m || m.deletedAt || m.chainId !== link.chainId) {
      throw new NotFoundError('MEDIA_NOT_FOUND'); // 跨链媒体拒绝
    }
  }
```

`apps/server/src/media/media.controller.ts` 的 GET /:id 方法：仅去掉 `@Authorized()` 装饰器、`@CurrentUser()` 形参类型改为 `UserProfile | null`、返回类型改为 `Promise<Response>`（`@QueryParam` 的 options 与其余装饰器保持不动）：
```ts
  @Get('/:id')
  async access(
    @Param('id') id: string,
    @QueryParam('st', { required: false, type: String }) st: string | undefined,
    @CurrentUser() user: UserProfile | null,
    @Res() res: Response
  ): Promise<Response> {
    const url = await this.mediaService.resolveAccessUrl(user, id, st);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, url);
  }
```
（去掉 `@Authorized()` 后匿名请求不再被框架 401 拦截，`currentUserChecker` 返回 null 透传进 service；无 st 时由 service 抛 `UnauthorizedError('UNAUTHORIZED')` 维持 401 语义——既有「未登录 → 401」用例不受影响。若 `@Authorized` 的 import 因此无其他使用点，从 import 中移除。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: share-media 6 个新用例 + 改造后的 media-access + 既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): /api/media/:id 的 ?st= share token 透传（匿名 302）"
```

---

### Task 6: worker sweeper（moment.deleted handler + 周期清理 + config 扩展，TDD）

**Files:**
- Modify: `apps/server/src/config.ts`（追加 `SWEEPER_INTERVAL_MS`/`SWEEPER_DRY_RUN`/`MEDIA_UPLOADING_TTL_HOURS`/`MOMENT_SOFT_DELETE_RETENTION_DAYS`）
- Modify: `apps/server/.env.example`、`apps/server/.env`（占位值）
- Create: `apps/server/src/worker/sweeper.ts`
- Modify: `apps/server/src/worker/handlers.ts`（整体替换 Phase 5 已注册的 `handleMomentDeleted` no-op 函数体；**注册表行保持不动**——`'moment.deleted'` 键 Phase 5 已注册）
- Modify: `apps/server/src/worker/index.ts`（主循环按节拍跑 sweeper）
- Test: `apps/server/tests/worker/sweeper.test.ts`
- Modify: `apps/server/tests/worker/handlers.test.ts`（仅更新「moment.deleted no-op」用例的标题/注释语义；注册表 `toHaveLength(4)` 与逐键 `toBe` 断言 Phase 5 已就位，不动）
- （`apps/server/tests/worker/processor.test.ts` **无需改动**：其未注册 type 用例用的是 `'future.sweep'`，本 Phase 后仍是未注册类型）

**Interfaces:**
- Consumes: `getStorage()`（CONVENTIONS §3.3）、`media`/`moments` 表、`OutboxHandler`/`handlers`、`OUTBOX_MOMENT_DELETED`、Phase 5 worker 主循环。
- Produces:
  - `sweepStaleUploadingMedia(now?: Date, opts?: { dryRun?: boolean }): Promise<SweepResult>`——清 `status='uploading'` 且 `createdAt < now - MEDIA_UPLOADING_TTL_HOURS` 的 media：有 `uploadId` 先 `abortMultipart`，再 `deleteFile`，最后硬删行
  - `sweepSoftDeletedMomentMedia(now?: Date, opts?: { dryRun?: boolean }): Promise<SweepResult>`——清软删超 `MOMENT_SOFT_DELETE_RETENTION_DAYS` 天 moment 的全部 media（S3 对象 + media 行硬删）
  - `SweepResult = { scanned: number; deletedRows: number; deletedObjects: number; abortedUploads: number; dryRun: boolean }`
  - `handleMomentDeleted: OutboxHandler`（替换 Phase 5 no-op 实现：ready → orphaned，幂等；`handlers['moment.deleted']` 注册表行 Phase 5 已存在，本 Task 不动）
  - config 新字段：`SWEEPER_INTERVAL_MS`(3600000)、`SWEEPER_DRY_RUN`(false)、`MEDIA_UPLOADING_TTL_HOURS`(24)、`MOMENT_SOFT_DELETE_RETENTION_DAYS`(30)

- [ ] **Step 1: 扩展 config（先于测试，模块加载期强校验）**

`apps/server/src/config.ts` 的 envSchema 追加四个字段（位置跟在 `WORKER_BATCH_SIZE` 之后）：
```ts
  // Sweeper（worker 进程；spec §5.5 防孤儿）
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  // dry-run 先行：true 时只打日志不删行/对象（生产首轮观察用）
  SWEEPER_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MEDIA_UPLOADING_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  MOMENT_SOFT_DELETE_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
```

`apps/server/.env.example` 末尾追加：
```dotenv

# Sweeper（worker 进程；生产首轮建议 SWEEPER_DRY_RUN=true 观察后再关）
SWEEPER_INTERVAL_MS=3600000
SWEEPER_DRY_RUN=false
MEDIA_UPLOADING_TTL_HOURS=24
MOMENT_SOFT_DELETE_RETENTION_DAYS=30
```

`apps/server/.env`（已 gitignore）追加占位（四个变量全带 `.default()`，缺了不会炸测试——此处只为与 `.env.example` 保持同步、让本地 dev 可显式调整）：
```bash
grep -q '^SWEEPER_DRY_RUN=' apps/server/.env || cat >> apps/server/.env <<'EOF'
SWEEPER_INTERVAL_MS=3600000
SWEEPER_DRY_RUN=false
MEDIA_UPLOADING_TTL_HOURS=24
MOMENT_SOFT_DELETE_RETENTION_DAYS=30
EOF
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/worker/sweeper.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentDeleted, handlers } from '../../src/worker/handlers.js';
import { sweepSoftDeletedMomentMedia, sweepStaleUploadingMedia } from '../../src/worker/sweeper.js';

let storage: Record<string, jest.Mock>;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

/** 直插最小链 + moment（sweeper 只关心 moments.deletedAt 与 media 行）。 */
async function insertMomentWithMedia(opts: {
  momentDeletedAt?: Date | null;
  mediaStatus?: 'uploading' | 'ready' | 'orphaned';
  mediaCreatedAt?: Date;
  uploadId?: string | null;
}): Promise<{ momentId: string; mediaId: string }> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  const { chains } = await import('../../src/db/schema.js');
  await db.insert(chains).values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private' });
  const momentId = randomUUID();
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: 'media',
    content: 'x',
    happenedAt: new Date(),
    happenedTzOffset: 0,
    deletedAt: opts.momentDeletedAt ?? null,
  });
  const mediaId = randomUUID();
  await db.insert(media).values({
    id: mediaId,
    momentId,
    uploaderId: userId,
    s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: opts.mediaStatus ?? 'ready',
    storageMeta: TEST_META,
    uploadId: opts.uploadId ?? null,
    createdAt: opts.mediaCreatedAt ?? new Date(),
  });
  return { momentId, mediaId };
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

describe('sweepStaleUploadingMedia（uploading 超 24h，spec §5.5）', () => {
  it('超期 uploading：abort multipart + deleteFile + 硬删行；未超期与 ready 不动', async () => {
    const stale = await insertMomentWithMedia({
      mediaStatus: 'uploading',
      mediaCreatedAt: new Date(Date.now() - 25 * 3_600_000),
      uploadId: 'upload-123',
    });
    const fresh = await insertMomentWithMedia({ mediaStatus: 'uploading' });
    const ready = await insertMomentWithMedia({
      mediaStatus: 'ready',
      mediaCreatedAt: new Date(Date.now() - 48 * 3_600_000),
    });

    const result = await sweepStaleUploadingMedia();

    expect(result.scanned).toBe(1);
    expect(result.abortedUploads).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(result.deletedRows).toBe(1);
    expect(storage.abortMultipart).toHaveBeenCalledWith(
      expect.stringContaining(stale.mediaId),
      'upload-123'
    );
    expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringContaining(stale.mediaId), TEST_META);
    expect(await db.select().from(media).where(eq(media.id, stale.mediaId))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, fresh.mediaId))).toHaveLength(1);
    expect(await db.select().from(media).where(eq(media.id, ready.mediaId))).toHaveLength(1);
  });

  it('dry-run：只日志不删行不调存储', async () => {
    const stale = await insertMomentWithMedia({
      mediaStatus: 'uploading',
      mediaCreatedAt: new Date(Date.now() - 25 * 3_600_000),
    });
    const result = await sweepStaleUploadingMedia(new Date(), { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.deletedRows).toBe(0);
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(await db.select().from(media).where(eq(media.id, stale.mediaId))).toHaveLength(1);
  });
});

describe('sweepSoftDeletedMomentMedia（软删超 30 天 moment 的媒体）', () => {
  it('超期：S3 对象 + media 行硬删；未超期与活 moment 的媒体不动', async () => {
    const old = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    const recent = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 86_400_000),
    });
    const alive = await insertMomentWithMedia({});

    const result = await sweepSoftDeletedMomentMedia();

    expect(result.scanned).toBe(1);
    expect(result.deletedRows).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringContaining(old.mediaId), TEST_META);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, recent.mediaId))).toHaveLength(1);
    expect(await db.select().from(media).where(eq(media.id, alive.mediaId))).toHaveLength(1);
  });

  it('deleteFile 失败：行保留、下轮重试（正式对象无 lifecycle 兜底，删行即永久孤儿）', async () => {
    const old = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 down'));

    const result = await sweepSoftDeletedMomentMedia();
    expect(result.scanned).toBe(1);
    expect(result.deletedObjects).toBe(0);
    expect(result.deletedRows).toBe(0);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(1);

    // 下轮重试成功 → 行正常删除
    const retry = await sweepSoftDeletedMomentMedia();
    expect(retry.deletedRows).toBe(1);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(0);
  });
});

describe('handleMomentDeleted（outbox moment.deleted → 标记 orphaned，幂等）', () => {
  it('ready → orphaned；重复调用不报错不再变', async () => {
    const { momentId, mediaId } = await insertMomentWithMedia({
      momentDeletedAt: new Date(),
      mediaStatus: 'ready',
    });
    await handleMomentDeleted({ momentId, chainId: 'ignored' }, { push: undefined as never });
    let [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');

    await handleMomentDeleted({ momentId, chainId: 'ignored' }, { push: undefined as never });
    [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');
  });

  it('handlers 注册表含 moment.deleted', () => {
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(Object.keys(handlers)).toHaveLength(4);
  });
});
```

改造 `apps/server/tests/worker/handlers.test.ts`：**仅**把既有「moment.deleted no-op：直接成功、不产生任何通知（Phase 8 替换为 sweeper）」用例的标题改为「moment.deleted：无匹配 media 行时静默成功、不产生通知（Phase 8 已替换为 orphaned 标记实现）」——断言本体（`resolves.toBeUndefined()` + notifications 为空）不动，payload 中的 `'m-x'` 无匹配 media 行，新旧实现下该用例均通过。「handlers 注册表」用例（`toHaveLength(4)` + 逐键 `toBe`，Phase 5 已就位）保持不动。`processor.test.ts` 无需任何改动（未注册 type 用例为 `'future.sweep'`）。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- worker`
Expected: FAIL——红灯**只有** `Cannot find module '../../src/worker/sweeper.js'`（sweeper.test.ts 整个文件加载失败）。handlers 注册表长度断言与 processor 未注册 type 用例在实现前即为 PASS（`moment.deleted` 自 Phase 5 起已注册，本 Task 只替换其实现）。

- [ ] **Step 4: 实现**

`apps/server/src/worker/sweeper.ts`：
```ts
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, moments, type Media } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { logger } from '../utils/logger.js';

export interface SweepResult {
  scanned: number;
  deletedRows: number;
  deletedObjects: number;
  abortedUploads: number;
  dryRun: boolean;
}

/** 单轮每类最多处理行数：防爆量长事务与 S3 请求风暴；剩余下一轮继续。 */
const BATCH_LIMIT = 500;

function newResult(dryRun: boolean): SweepResult {
  return { scanned: 0, deletedRows: 0, deletedObjects: 0, abortedUploads: 0, dryRun };
}

/**
 * 单行的 S3 清理：abort 未完成 multipart（若有 uploadId）+ deleteFile。
 * 返回 false = deleteFile 失败：**行保留、下轮重试**——正式对象（chains/... 前缀）不在任何 bucket
 * lifecycle 规则覆盖内（也不可能加，会误删活对象），若删行即成永久孤儿且无重试路径。
 * abort 失败只告警不阻塞：未完成 multipart 由 lifecycle 的 AbortIncompleteMultipartUpload 7 天规则兜底（Task 7）。
 */
async function destroyMediaObject(row: Media, result: SweepResult): Promise<boolean> {
  const storage = getStorage();
  if (row.uploadId) {
    try {
      await storage.abortMultipart(row.s3Key, row.uploadId);
      result.abortedUploads += 1;
    } catch (err) {
      logger.warn('sweeper abort multipart failed（AbortIncompleteMultipartUpload lifecycle 兜底）', {
        mediaId: row.id,
        err: String(err),
      });
    }
  }
  try {
    await storage.deleteFile(row.s3Key, row.storageMeta);
    result.deletedObjects += 1;
    return true;
  } catch (err) {
    logger.warn('sweeper delete object failed（保留行，下轮重试）', {
      mediaId: row.id,
      key: row.s3Key,
      err: String(err),
    });
    return false;
  }
}

/** uploading 超 MEDIA_UPLOADING_TTL_HOURS 的 media 行 + S3 对象（防孤儿，spec §5.5）。 */
export async function sweepStaleUploadingMedia(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<SweepResult> {
  const result = newResult(opts?.dryRun ?? config.SWEEPER_DRY_RUN);
  const cutoff = new Date(now.getTime() - config.MEDIA_UPLOADING_TTL_HOURS * 3_600_000);
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.status, 'uploading'), lt(media.createdAt, cutoff)))
    .orderBy(asc(media.createdAt)) // FIFO：持续积压时老行优先，避免无 ORDER BY 的选择不确定饿死老行
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const row of rows) {
    if (result.dryRun) {
      logger.info('sweeper dry-run: would delete stale uploading media', {
        mediaId: row.id,
        key: row.s3Key,
        createdAt: row.createdAt,
      });
      continue;
    }
    if (!(await destroyMediaObject(row, result))) continue; // 对象删除失败：行留下轮重试
    await db.delete(media).where(eq(media.id, row.id));
    result.deletedRows += 1;
  }
  logger.info('sweeper stale uploading media done', { ...result });
  return result;
}

/** 软删超 MOMENT_SOFT_DELETE_RETENTION_DAYS 天 moment 的媒体：S3 对象 + media 行硬删。 */
export async function sweepSoftDeletedMomentMedia(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<SweepResult> {
  const result = newResult(opts?.dryRun ?? config.SWEEPER_DRY_RUN);
  const cutoff = new Date(now.getTime() - config.MOMENT_SOFT_DELETE_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(media)
    .innerJoin(moments, eq(media.momentId, moments.id))
    .where(and(isNotNull(moments.deletedAt), lt(moments.deletedAt, cutoff)))
    .orderBy(asc(moments.deletedAt)) // FIFO：同上，老行优先
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const { media: row } of rows) {
    if (result.dryRun) {
      logger.info('sweeper dry-run: would delete media of soft-deleted moment', {
        mediaId: row.id,
        momentId: row.momentId,
        key: row.s3Key,
      });
      continue;
    }
    if (!(await destroyMediaObject(row, result))) continue; // 对象删除失败：行留下轮重试
    await db.delete(media).where(eq(media.id, row.id));
    result.deletedRows += 1;
  }
  logger.info('sweeper soft-deleted moment media done', { ...result });
  return result;
}
```

`apps/server/src/worker/handlers.ts`：
1. import 区把 `media` 并入既有 schema import，`and` 并入既有 drizzle-orm import。
2. **整体替换** Phase 5 的 no-op 实现——即把 `export const handleMomentDeleted: OutboxHandler = async () => {};` 连同其上方「moment.deleted：Phase 5 为 no-op——……Phase 8 替换为媒体清理 sweeper。」注释一起替换为（**禁止**在文件里再追加一份同名导出 = 重复标识符；**禁止**在 `handlers` 注册表再追加 `'moment.deleted'` 键 = 对象重复键，tsc 直接报错——注册表行 `'moment.deleted': handleMomentDeleted` Phase 5 已存在，保持不动）：
```ts
/**
 * moment.deleted：只把该 moment 的 ready media 标记为 orphaned（幂等），不物理删——
 * 物理清理由 sweeper 按 30 天保留期执行（spec §5.5「sweeper 延迟物理清理」）。
 */
export const handleMomentDeleted: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;
  await db
    .update(media)
    .set({ status: 'orphaned' })
    .where(and(eq(media.momentId, momentId), eq(media.status, 'ready')));
};
```

`apps/server/src/worker/index.ts`：import 区追加
```ts
import { sweepSoftDeletedMomentMedia, sweepStaleUploadingMedia } from './sweeper.js';
```
`main()` 的 `while (running)` 循环内、`await sleep(config.WORKER_POLL_INTERVAL_MS)` 之前插入 sweeper 节拍（启动即先跑一轮——`lastSweep` 初始 0；dry-run 先行的运维语义见 README）：
```ts
    if (Date.now() - lastSweep >= config.SWEEPER_INTERVAL_MS) {
      lastSweep = Date.now();
      try {
        await sweepStaleUploadingMedia();
        await sweepSoftDeletedMomentMedia();
      } catch (err) {
        logger.error('sweeper crashed', err);
      }
    }
```
`main()` 函数体开头（`logger.info('worker started', ...)` 之前）声明：
```ts
  let lastSweep = 0;
```

- [ ] **Step 5: 运行确认通过 + worker 手动冒烟**

Run: `pnpm --filter @moment/server test`
Expected: sweeper 6 个新用例 + 改造后的 handlers + 既有全部 PASS（processor.test.ts 无改动）。

手动冒烟（dry-run 观察日志，dev 库随便造不造数据都行；**记录 PID 而非 `kill %1`**——非交互 shell 无 job control，Phase 5 已踩过）：
```bash
SWEEPER_DRY_RUN=true pnpm --filter @moment/server worker &
WPID=$!
sleep 5
kill $WPID
```
Expected: 日志依次出现 `worker started`、`sweeper stale uploading media done`（`dryRun:true`）、`sweeper soft-deleted moment media done`；kill 后 `worker stopped` 进程退出。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): worker sweeper（uploading 24h/软删 30d 媒体清理 + moment.deleted handler，dry-run 先行）"
```

---

### Task 7: S3 bucket lifecycle 配置脚本（tmp/ 7 天过期 + 未完成 multipart 7 天中止）

**Files:**
- Create: `apps/server/scripts/setup-s3-lifecycle.ts`
- Modify: `apps/server/package.json`（script `setup:s3-lifecycle`）

**Interfaces:**
- Consumes: `config`（ATTACHMENT_S3_*）、`logger`。
- Produces: `pnpm --filter @moment/server setup:s3-lifecycle` 一次性配置命令（幂等，PutBucketLifecycleConfiguration 全量覆盖式）；规则 ID `moment-tmp-expire-7d` 与 `moment-abort-incomplete-multipart-7d`。

- [ ] **Step 1: 实现脚本**

`apps/server/scripts/setup-s3-lifecycle.ts`：
```ts
/**
 * 一次性配置 bucket lifecycle（spec §5.5 防孤儿）：
 * - {prefix}/tmp/ 前缀 7 天未 complete 自动删（孤儿上传兜底）；
 * - AbortIncompleteMultipartUpload 7 天（中止未完成分片，隐藏账单）。
 * 幂等：PutBucketLifecycleConfiguration 为全量覆盖式配置。
 * 运行：pnpm --filter @moment/server setup:s3-lifecycle（读 apps/server/.env 的真实凭据）。
 */
import { PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

const endpoint = config.ATTACHMENT_S3_ENDPOINT || undefined;
// 与 src/storage/s3.adapter.ts 同一判定：阿里云 OSS 走 virtual-hosted-style（path-style 会被拒），
// 其余自建 endpoint 走 path-style；无 endpoint（AWS 官方）不设 forcePathStyle。
const isAliyunOSS = endpoint?.includes(config.ATTACHMENT_S3_REGION) || endpoint?.includes('aliyuncs');
const client = new S3Client({
  region: config.ATTACHMENT_S3_REGION,
  endpoint,
  ...(endpoint ? { forcePathStyle: !isAliyunOSS } : {}),
  credentials: {
    accessKeyId: config.ATTACHMENT_S3_ACCESS_KEY_ID,
    secretAccessKey: config.ATTACHMENT_S3_SECRET_ACCESS_KEY,
  },
});

const tmpPrefix = `${config.ATTACHMENT_S3_PREFIX}/tmp/`;

await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: config.ATTACHMENT_S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'moment-tmp-expire-7d',
          Status: 'Enabled',
          Filter: { Prefix: tmpPrefix },
          Expiration: { Days: 7 },
        },
        {
          ID: 'moment-abort-incomplete-multipart-7d',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  })
);

logger.info('bucket lifecycle configured', { bucket: config.ATTACHMENT_S3_BUCKET, tmpPrefix });
```

`apps/server/package.json` 的 scripts 追加一行：
```json
    "setup:s3-lifecycle": "tsx scripts/setup-s3-lifecycle.ts",
```

- [ ] **Step 2: 验证（真实桶，一次性手工执行）**

本脚本触真实 S3，不进自动化测试。验证步骤（生产/ staging 凭据就位后执行，结果写进部署记录）：
```bash
pnpm --filter @moment/server setup:s3-lifecycle
```
Expected: 输出 `bucket lifecycle configured` 日志行且无报错。

可选复核（装了 awscli 的机器）：
```bash
aws s3api get-bucket-lifecycle-configuration --bucket "$ATTACHMENT_S3_BUCKET" ${ATTACHMENT_S3_ENDPOINT:+--endpoint-url "$ATTACHMENT_S3_ENDPOINT"}
```
Expected: 返回 JSON 中含 `moment-tmp-expire-7d`（Expiration Days=7，Prefix=`{prefix}/tmp/`）与 `moment-abort-incomplete-multipart-7d`（DaysAfterInitiation=7）两条规则。

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts apps/server/package.json
git commit -m "feat(server): S3 bucket lifecycle 配置脚本（tmp/ 7d 过期 + 未完成 multipart 7d 中止）"
```

---

### Task 8: api-client share 方法 + web `/share/:token` 公开只读页

**Files:**
- Modify: `packages/api-client/src/client.ts`（interface 与实现追加 4 方法）
- Test: `packages/api-client/src/client.test.ts`（追加 share describe）
- Create: `apps/web/src/pages/SharePage.tsx`
- Modify: `apps/web/src/App.tsx`（匿名路由 `/share/:token`）

**Interfaces:**
- Consumes: api-client `Http`/`MomentClient`/`ApiError`、Task 1 dto（`ShareLinkDto`/`ShareLinkListResponse`/`PublicShareResponse`/`CreateShareLinkInput`）、web 的 `client` 单例（`src/api/client.ts`）、Tailwind。
- Produces（Phase 7 app 端与后续 web 链设置页依赖，方法名不得改）:
  - `MomentClient.createShareLink(chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto>`
  - `MomentClient.listShareLinks(chainId: string): Promise<ShareLinkListResponse>`
  - `MomentClient.revokeShareLink(shareLinkId: string): Promise<void>`
  - `MomentClient.getPublicShare(token: string, cursor?: string): Promise<PublicShareResponse>`（`skipAuth: true`——匿名可用且永不触发 refresh）
  - web 路由 `/share/:token`（匿名，AppShell 之外，全屏只读页）

- [ ] **Step 1: 写失败测试（api-client）**

`packages/api-client/src/client.test.ts` 末尾追加（自包含 harness，不依赖文件内既有 helper）：
```ts
describe('share 方法', () => {
  const anonTokenStore = {
    getAccessToken: () => null,
    getRefreshToken: () => null,
    setTokens: () => undefined,
    clear: () => undefined,
  };

  function capture(status: number, body: unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('createShareLink：POST /api/chains/:chainId/share-links', async () => {
    const dto = {
      id: 'sl-1',
      chainId: 'c-1',
      token: 'a'.repeat(64),
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-08-16T00:00:00.000Z',
    };
    const { calls, fetchImpl } = capture(201, dto);
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    const res = await client.createShareLink('c-1', {});
    assert.equal(res.token, dto.token);
    assert.equal(calls[0]!.url, 'http://test.local/api/chains/c-1/share-links');
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {});
  });

  it('listShareLinks / revokeShareLink：GET 与 DELETE（204 → undefined）', async () => {
    const { calls, fetchImpl } = capture(200, { items: [] });
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    const res = await client.listShareLinks('c-1');
    assert.deepEqual(res.items, []);
    assert.equal(calls[0]!.url, 'http://test.local/api/chains/c-1/share-links');
    assert.equal(calls[0]!.init?.method ?? 'GET', 'GET');

    const del = capture(204, undefined);
    const client2 = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl: del.fetchImpl });
    await assert.doesNotReject(() => client2.revokeShareLink('sl-1'));
    assert.equal(del.calls[0]!.url, 'http://test.local/api/share-links/sl-1');
    assert.equal(del.calls[0]!.init?.method, 'DELETE');
  });

  it('getPublicShare：skipAuth（无 Authorization），cursor 进 query', async () => {
    const body = { chain: { name: 'c', description: null }, moments: [], nextCursor: null };
    const { calls, fetchImpl } = capture(200, body);
    const client = createMomentClient({ baseUrl: 'http://test.local', tokenStore: anonTokenStore, fetchImpl });
    await client.getPublicShare('tok-1');
    assert.equal(calls[0]!.url, 'http://test.local/api/public/share/tok-1');
    assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, undefined);

    await client.getPublicShare('tok-1', 'cur/sor+1');
    assert.equal(calls[1]!.url, `http://test.local/api/public/share/tok-1?cursor=${encodeURIComponent('cur/sor+1')}`);
  });
});
```
（import 区追加 `describe, it`（并入既有 `node:test` import）、`assert`（`node:assert/strict`）、`createMomentClient`（若既有 import 已含则合并）。**注意**：api-client 测试运行器是 `tsx --test`（node:test + assert），node:test 没有 `expect`，断言一律用 `assert.equal/deepEqual/doesNotReject`，禁止 jest 风格。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL（`client.createShareLink is not a function`）

- [ ] **Step 3: 实现（api-client）**

`packages/api-client/src/client.ts`：
1. import 区追加 dto 类型（并入既有 `@moment/dto` import）：
```ts
  CreateShareLinkInput,
  PublicShareResponse,
  ShareLinkDto,
  ShareLinkListResponse,
```
2. `MomentClient` interface 追加（放在 `mediaUrl` 声明之后）：
```ts
  // share links & public
  createShareLink(chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto>;
  listShareLinks(chainId: string): Promise<ShareLinkListResponse>;
  revokeShareLink(shareLinkId: string): Promise<void>;
  getPublicShare(token: string, cursor?: string): Promise<PublicShareResponse>;
```
3. 返回对象实现追加（与既有方法同风格，`http` 为既有局部变量）：
```ts
    createShareLink: (chainId, input) =>
      http.request<ShareLinkDto>(`/api/chains/${chainId}/share-links`, { method: 'POST', body: input }),
    listShareLinks: (chainId) => http.request<ShareLinkListResponse>(`/api/chains/${chainId}/share-links`),
    revokeShareLink: (shareLinkId) =>
      http.request<void>(`/api/share-links/${shareLinkId}`, { method: 'DELETE' }),
    getPublicShare: (token, cursor) =>
      http.request<PublicShareResponse>(`/api/public/share/${token}`, {
        query: { cursor },
        skipAuth: true, // 匿名可用；永不触发 refresh
      }),
```

- [ ] **Step 4: 运行确认通过（api-client）**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build`
Expected: share 3 个新用例 + 既有全部 PASS；构建成功。

- [ ] **Step 5: 实现（web 公开页）**

`apps/web/src/pages/SharePage.tsx`：
```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiError } from '@moment/api-client';
import type { MomentMedia, MomentResponse } from '@moment/dto';
import { client } from '@/api/client';

/** 媒体稳定入口 + share token 透传（spec §5.3）：m.url 是 /api/media/:id 相对路径（CONVENTIONS §3.4）。 */
function mediaSrc(m: MomentMedia, token: string): string {
  return `${m.url}?st=${encodeURIComponent(token)}`;
}

function ShareMomentCard({ moment, token }: { moment: MomentResponse; token: string }) {
  const happened = new Date(moment.happenedAt).toLocaleString();
  return (
    <article className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">{moment.author.nickname}</span>
        <time className="shrink-0 text-xs text-gray-400">{happened}</time>
      </div>
      {moment.content && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{moment.content}</p>}
      {moment.media.length > 0 && (
        <div className={`mt-3 grid gap-1 ${moment.media.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {moment.media.map((md) =>
            md.mime.startsWith('video/') ? (
              <video key={md.id} src={mediaSrc(md, token)} controls preload="metadata" className="w-full rounded" />
            ) : (
              <img
                key={md.id}
                src={mediaSrc(md, token)}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded object-cover"
              />
            )
          )}
        </div>
      )}
      {/* 只读计数（计划决策：计数展示、无互动入口） */}
      {(moment.commentCount > 0 || moment.reactions.length > 0) && (
        <div className="mt-2 flex gap-3 text-xs text-gray-400">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji} {r.count}
            </span>
          ))}
          {moment.commentCount > 0 && <span>{moment.commentCount} 条评论</span>}
        </div>
      )}
    </article>
  );
}

/** 匿名只读公开页（spec §1 链接分享）：不挂 RequireAuth，无任何互动/编辑入口。 */
export function SharePage() {
  const { token = '' } = useParams();
  const query = useInfiniteQuery({
    queryKey: ['public-share', token],
    queryFn: ({ pageParam }) => client.getPublicShare(token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: token.length > 0,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">加载中…</p>
      </div>
    );
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">{notFound ? '分享链接不存在或已失效' : '加载失败，请稍后重试'}</p>
      </div>
    );
  }

  const chain = query.data.pages[0]?.chain;
  const moments = query.data.pages.flatMap((p) => p.moments);
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <h1 className="text-lg font-semibold text-gray-900">{chain?.name}</h1>
          {chain?.description && <p className="mt-1 text-sm text-gray-500">{chain.description}</p>}
          <p className="mt-1 text-xs text-gray-400">只读分享 · 时刻 Moment</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">
        {moments.length === 0 && <p className="py-16 text-center text-sm text-gray-400">还没有内容</p>}
        <div className="space-y-3">
          {moments.map((m) => (
            <ShareMomentCard key={m.id} moment={m} token={token} />
          ))}
        </div>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mt-4 w-full rounded border bg-white py-2 text-sm text-gray-600 disabled:opacity-50"
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </button>
        )}
      </main>
    </div>
  );
}
```

`apps/web/src/App.tsx`：import 区追加 `import { SharePage } from '@/pages/SharePage';`；路由表中 `<Route path="/register" ... />` 之后追加（**在 RequireAuth 布局之外**，匿名可访问）：
```tsx
      <Route path="/share/:token" element={<SharePage />} />
```

- [ ] **Step 6: web 三绿验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: typecheck/lint 无 error；vite build 成功。

手动验收（dev 环境，写进 DoD）：
```bash
pnpm dev
# 1) owner 登录 web，POST 创建 share link（或 curl）：
#    curl -X POST localhost:3000/api/chains/<chainId>/share-links -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{}'
# 2) 浏览器开无痕窗口访问 http://localhost:5173/share/<token>
```
Expected: 无痕（未登录）可看到链名 + 时间线 + 图片/视频正常加载（img src 带 `?st=`，经 302 到预签名 URL）；无评论/表情/编辑入口；吊销该链接后刷新显示「分享链接不存在或已失效」。

- [ ] **Step 7: Commit**

```bash
git add packages/api-client apps/web
git commit -m "feat(api-client,web): share typed methods 与 /share/:token 匿名只读公开页"
```

---

### Task 9: express-rate-limit v8 升级 + 敏感端点限流复核（TDD）

**Files:**
- Modify: `apps/server/package.json`（`express-rate-limit` ^7 → ^8）
- Modify: `apps/server/src/middlewares/rate-limit.ts`（named import + `ipKeyGenerator`）
- Test: `apps/server/tests/rate-limit.test.ts`（追加 ipKeyGenerator 行为用例）

**Interfaces:**
- Consumes: 既有 `authRateLimiter`/`loginRateLimiter`/`inviteAcceptRateLimiter`/`publicShareRateLimiter` 导出（名字不变）。
- Produces: `express-rate-limit@^8`；自定义 keyGenerator 一律经 `ipKeyGenerator(req.ip, 56)` 归一化（v8 `keyGeneratorIpFallback` 校验要求，修复 Phase 1 评审遗留的 IPv6 子网轮换绕过问题）；既有四个 limiter 导出符号签名零变化；**新增导出** `ipKey`/`loginKeyGenerator`/`inviteAcceptKeyGenerator`（limiter 的 keyGenerator 直接引用它们，供回归测试断言确实走了 ipKeyGenerator）。

**限流复核结论（spec §4/§6，写死为决策）：**
| 端点 | 限流 | 结论 |
|---|---|---|
| `POST /api/auth/register` | `authRateLimiter`（IP 60s/10） | 保持 |
| `POST /api/auth/login` | `loginRateLimiter`（IP+email 60s/5） | 保持，keyGenerator 换 ipKeyGenerator |
| `POST /api/invites/:token/accept` | `inviteAcceptRateLimiter`（IP+userId+token 60s/5） | 保持，keyGenerator 换 ipKeyGenerator |
| `GET /api/public/share/:token` | `publicShareRateLimiter`（IP 60s/60，Task 4 已挂） | 保持 |
| `POST/GET /api/chains/:chainId/share-links`、`DELETE /api/share-links/:id` | 不额外限流 | owner-only 低频管理操作，认证+`requireChainRole('owner')` 足够 |
| `GET /api/media/:id?st=` | 不单独限流 | 签名 HMAC 微秒级，token 即凭证，公开页刷媒体是正常流量；滥用面 = token 泄露，靠吊销兜底 |

- [ ] **Step 1: 写失败测试**

`apps/server/tests/rate-limit.test.ts`：**import 并入文件头部既有 import 区**（勿追加在文件末尾，避免 lint import 顺序告警）：
```ts
import { ipKeyGenerator } from 'express-rate-limit';
import { inviteAcceptKeyGenerator, loginKeyGenerator } from '../src/middlewares/rate-limit.js';
```
文件末尾追加用例：
```ts
describe('ipKeyGenerator（v8，IPv6 /56 归一化）', () => {
  it('同一 /56 子网内不同 IPv6 地址归并为同一 key；IPv4 原样返回', () => {
    const a = ipKeyGenerator('0123:4567:89ab:cd11:1111:1111:1111:1111', 56);
    const b = ipKeyGenerator('0123:4567:89ab:cd22:2222:2222:2222:2222', 56);
    expect(a).toBe(b);
    expect(ipKeyGenerator('203.0.113.7', 56)).toBe('203.0.113.7');
  });
});

describe('limiter keyGenerator 回归（修复 IPv6 /56 绕过：断言 limiter 确实走 ipKeyGenerator）', () => {
  // 同一 /56 子网（前 56 bit 相同）的两个地址
  const ipA = '0123:4567:89ab:cd11:1111:1111:1111:1111';
  const ipB = '0123:4567:89ab:cd22:2222:2222:2222:2222';

  it('loginKeyGenerator：同 /56 两地址 + 同 email（大小写不敏感）→ 同 key；email 参与 key', () => {
    const k1 = loginKeyGenerator({ ip: ipA, body: { email: 'A@b.com' } } as never);
    const k2 = loginKeyGenerator({ ip: ipB, body: { email: 'a@b.com' } } as never);
    expect(k1).toBe(k2);
    expect(loginKeyGenerator({ ip: ipA, body: { email: 'x@b.com' } } as never)).not.toBe(k1);
  });

  it('inviteAcceptKeyGenerator：同 /56 两地址（同 user/token）→ 同 key', () => {
    const base = { body: {}, params: { token: 't-1' }, user: { id: 'u-1' } };
    expect(inviteAcceptKeyGenerator({ ...base, ip: ipA } as never)).toBe(
      inviteAcceptKeyGenerator({ ...base, ip: ipB } as never)
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- rate-limit`
Expected: FAIL（`ipKeyGenerator` 在 v7 无导出；`loginKeyGenerator`/`inviteAcceptKeyGenerator` 尚未从 rate-limit.ts 导出）

- [ ] **Step 3: 升级依赖并改造**

```bash
pnpm --filter @moment/server add express-rate-limit@^8.1.0
```

`apps/server/src/middlewares/rate-limit.ts`（整体替换）：
```ts
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config.js';

const isTest = config.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };

/** IPv6 /56 归一化（v8 安全修复：防子网内轮换 IP 绕过限流）；IPv4 原样返回。导出供回归测试断言。 */
export function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '', 56);
}

/** 登录限流 key：归一化 IP + email（小写）。导出供回归测试断言确实走 ipKeyGenerator。 */
export function loginKeyGenerator(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
  return `${ipKey(req)}:${email}`;
}

/** 邀请接受限流 key：归一化 IP + invitee userId + invite token。导出供回归测试断言。 */
export function inviteAcceptKeyGenerator(req: Request): string {
  const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
  const token = typeof req.params?.token === 'string' ? req.params.token : '';
  return `${ipKey(req)}:${userId}:${token}`;
}

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
  keyGenerator: loginKeyGenerator,
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
  keyGenerator: inviteAcceptKeyGenerator,
  message,
});

/** 匿名公开端点：IP 维度 60s/60 次（公开页一次浏览 = 1 次 API + N 次 media 302，媒体不走本 limiter）。 */
export const publicShareRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm install && pnpm --filter @moment/server test`
Expected: rate-limit 全部用例（含新增 ipKeyGenerator）PASS；既有用例不受 v8 升级影响全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): express-rate-limit 升级 v8（ipKeyGenerator 修复 IPv6 /56 绕过）"
```

---

### Task 10: 生产 docker-compose（server/worker/mysql/backup）+ Dockerfile + .env.example 收尾

**Files:**
- Create: `apps/server/Dockerfile`、`.dockerignore`（根）
- Create: `backup/Dockerfile`、`backup/backup.sh`
- Modify: `docker-compose.yml`（追加 server/worker/backup 三 service，mysql 保持）
- Modify: `apps/server/.env.example`（backup sidecar 变量段）

**Interfaces:**
- Consumes: `apps/server` 的 `dist/index.js`（build 产物）与 `dist/worker/index.js`、`dist/db/migrate.js`。
- Produces:
  - `docker compose build && docker compose up -d` 一键起生产栈；`docker compose run --rm server node dist/db/migrate.js` 跑迁移
  - backup sidecar：每日 mysqldump | gzip → S3（while/sleep 循环，无 cron daemon；首次启动立即跑一轮）

- [ ] **Step 1: server 镜像（多阶段）**

`.dockerignore`（根）：
```
**/node_modules
**/dist
**/.env
**/.env.*
!.env.example
.git
docs
apps/web
apps/app
```

`apps/server/Dockerfile`（构建 context = 仓库根）：
```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# deps：全部依赖（含 devDependencies，供 build 使用）。
# 注意：pnpm 对缺失的 workspace 包 manifest 不报错（留悬空 symlink），所以 server/dto 直接依赖的
# workspace 包（@moment/dto、config/ 下的 @moment/typescript-config、@moment/eslint-config）的
# manifest 必须全部在下方 COPY 清单内——今后 server/dto 新增任何 workspace 依赖，必须同步本清单
# （deps 与 prod-deps 两处），否则静默拿到悬空依赖。
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config config
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/dto packages/dto
COPY apps/server apps/server
RUN pnpm --filter @moment/dto build && pnpm --filter @moment/server build

# prod-deps：仅生产依赖（manifest 清单与 deps 保持一致）。
# 取舍声明：runtime 只带 prod node_modules——不把 jest/tsx/typescript 等 devDependencies
# 打进运行镜像（体积与攻击面约减半）；代价是多一个 install 阶段（构建缓存下开销可忽略）。
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config config
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
```
（pnpm workspace 的依赖以 symlink 挂在根 `node_modules/.pnpm`；runtime 从 prod-deps 取 prod 依赖树（`apps/server/node_modules/@moment/dto` symlink 指向 `/app/packages/dto`，由 prod-deps 拷入、再从 build 覆盖 dist），只从 build 取构建产物（dist/drizzle/package.json），不带 build 阶段的 dev 依赖；worker 用同镜像改 command 即可；`drizzle/` 目录随镜像走是为了 `node dist/db/migrate.js` 能读到迁移 SQL。）

- [ ] **Step 2: backup sidecar**

`backup/Dockerfile`：
```dockerfile
FROM mysql:8.4
RUN microdnf install -y python3 python3-pip \
  && pip3 install --no-cache-dir awscli \
  && microdnf clean all
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
CMD ["/usr/local/bin/backup.sh"]
```

`backup/backup.sh`：
```bash
#!/bin/bash
# 每日 mysqldump → gzip → S3（spec §9）。while/sleep 循环，不依赖 cron daemon。
# 首次启动立即跑一轮（便于部署后立刻验证）；失败不退出，下一轮重试。
# --no-tablespaces 必需：mysql:8.4 官方镜像给 MYSQL_USER 的授权是库级（moment_dev.*），
# 不含全局 PROCESS；MySQL 8.0.21+ mysqldump 默认导出 tablespace 信息，无 PROCESS 直接报错退出。
set -uo pipefail

: "${MYSQL_HOST:?missing MYSQL_HOST}"
: "${MYSQL_USER:?missing MYSQL_USER}"
: "${MYSQL_PASSWORD:?missing MYSQL_PASSWORD}"
: "${MYSQL_DATABASE:?missing MYSQL_DATABASE}"
: "${BACKUP_S3_BUCKET:?missing BACKUP_S3_BUCKET}"

MYSQL_PORT="${MYSQL_PORT:-3306}"
PREFIX="${BACKUP_S3_PREFIX:-backups/mysql}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
# awscli 只认 AWS_* 变量：从 BACKUP_S3_* 映射（compose 的 ${} 插值读不到 env_file，必须在脚本内做）
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${BACKUP_S3_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${BACKUP_S3_SECRET_ACCESS_KEY:-}}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${BACKUP_S3_REGION:-us-east-1}}"
ENDPOINT_ARGS=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  ENDPOINT_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi

while true; do
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  FILE="moment-${MYSQL_DATABASE}-${TS}.sql.gz"
  echo "[backup] $(date -u +%FT%TZ) starting ${FILE}"
  if mysqldump -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" \
      --single-transaction --no-tablespaces --routines --triggers "$MYSQL_DATABASE" \
    | gzip \
    | aws s3 cp - "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${FILE}" "${ENDPOINT_ARGS[@]}"; then
    echo "[backup] $(date -u +%FT%TZ) uploaded s3://${BACKUP_S3_BUCKET}/${PREFIX}/${FILE}"
  else
    echo "[backup] $(date -u +%FT%TZ) FAILED ${FILE}（下一轮重试）" >&2
  fi
  sleep "$INTERVAL"
done
```
（备份保留期交给 bucket lifecycle 管理，不在脚本里删旧档——恢复演练见 README；awscli 凭据由脚本从 `BACKUP_S3_*` 映射为 `AWS_*`。）

- [ ] **Step 3: compose 扩展**

`docker-compose.yml`（整体替换；mysql service 与 volumes 保持 Phase 1 原样，新增三个 service）：
```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: moment_root_dev
      MYSQL_DATABASE: moment_dev
      MYSQL_USER: moment
      MYSQL_PASSWORD: moment_dev
    ports:
      - '3306:3306'
    volumes:
      - moment-mysql:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-umoment', '-pmoment_dev']
      interval: 5s
      timeout: 3s
      retries: 20

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    restart: unless-stopped
    env_file: apps/server/.env
    environment:
      NODE_ENV: production
      MYSQL_HOST: mysql
      MYSQL_PORT: '3306'
    ports:
      - '3000:3000'
    depends_on:
      mysql:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    restart: unless-stopped
    command: ['node', 'dist/worker/index.js']
    env_file: apps/server/.env
    environment:
      NODE_ENV: production
      MYSQL_HOST: mysql
      MYSQL_PORT: '3306'
    depends_on:
      mysql:
        condition: service_healthy

  backup:
    build:
      context: ./backup
    restart: unless-stopped
    env_file: apps/server/.env
    environment:
      MYSQL_HOST: mysql
      MYSQL_PORT: '3306'
    depends_on:
      mysql:
        condition: service_healthy

volumes:
  moment-mysql: {}
```
（`env_file` 提供 `MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE/BACKUP_S3_*`；`environment` 段覆盖 host/port 为 compose 内网值。生产部署时 mysql 的口令经 `.env` 或 compose override 换成强口令，dev 默认值只用于本地。）

- [ ] **Step 4: .env.example 收尾**

`apps/server/.env.example` 末尾追加：
```dotenv

# 备份 sidecar（仅 docker-compose backup 服务读取；server/worker 不读，故不进 config.ts）
BACKUP_INTERVAL_SECONDS=86400
BACKUP_S3_BUCKET=change-me-backup-bucket
BACKUP_S3_PREFIX=backups/mysql
BACKUP_S3_ENDPOINT=
BACKUP_S3_REGION=cn-beijing
BACKUP_S3_ACCESS_KEY_ID=change-me
BACKUP_S3_SECRET_ACCESS_KEY=change-me
```

- [ ] **Step 5: 生产 compose 手工验证（本 Task 验收，命令 + 预期输出）**

```bash
# 1) 构建（首次较久）
docker compose build
# Expected: server/worker 镜像构建成功（deps → build → runtime 三阶段无报错）

# 2) 起栈
docker compose up -d
# Expected: mysql healthy 后 server/worker/backup 三容器 Up

# 3) 迁移（生产语义：镜像内跑 migrate，不需要宿主机装依赖）
docker compose run --rm server node dist/db/migrate.js
# Expected: 输出 migrations applied

# 4) 健康与 API
curl -s localhost:3000/api/health
# Expected: {"status":"ok"}

# 5) worker 日志（outbox + sweeper 首轮）
docker compose logs --tail 20 worker
# Expected: 含 "worker started" 与两条 "sweeper ... done" 日志行

# 6) backup 首轮（需 .env 配好真实 BACKUP_S3_*）
docker compose logs --tail 5 backup
# Expected: 凭据就绪时含 "[backup] ... uploaded s3://..."；
#   BACKUP_S3_BUCKET 等变量完全缺失 → 脚本启动即报错（日志含 "missing BACKUP_S3_BUCKET"），容器 restart 循环重试；
#   变量存在但凭据/桶错误 → 每轮含 "[backup] ... FAILED"（脚本不退出，下一轮重试）
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .dockerignore apps/server/Dockerfile apps/server/.env.example backup/
git commit -m "chore: 生产 docker-compose（server/worker/mysql/backup）与镜像构建"
```

---

### Task 11: README 生产部署章节 + 全量回归 + DoD 手工验证

**Files:**
- Modify: `README.md`（追加「生产部署」章节）

**Interfaces:**
- Produces: 备份恢复演练步骤（可照抄执行）、sweeper dry-run 上线流程、web 静态部署说明。

- [ ] **Step 1: README 追加生产部署章节**

`README.md` 末尾追加（本计划在 markdown 中用四反引号包裹以保留内层代码块；写入文件时去掉最外层围栏）：

````markdown
## 生产部署

### 启动栈

```bash
# 1) 准备环境（真实凭据，已 gitignore，严禁提交）
cp apps/server/.env.example apps/server/.env   # 若不存在
# 编辑 .env：MYSQL_*（生产库）、JWT_SECRET（≥32 随机）、ATTACHMENT_S3_*（生产桶，PREFIX 如 prod/attachments）、BACKUP_S3_*

# 2) 一次性配置 S3 bucket lifecycle（tmp/ 7 天过期 + 未完成 multipart 7 天中止，spec §5.5）
pnpm install && pnpm --filter @moment/server setup:s3-lifecycle

# 3) 构建并启动（server + worker + mysql + backup）
docker compose build
docker compose up -d

# 4) 数据库迁移（首次与每次发版）
docker compose run --rm server node dist/db/migrate.js
```

### sweeper 上线流程（dry-run 先行）

首次部署（或调整保留期）时，先在 `.env` 设 `SWEEPER_DRY_RUN=true`，`docker compose up -d worker` 后观察一轮日志（`docker compose logs -f worker`，每 `SWEEPER_INTERVAL_MS` 一轮，默认 1h）确认 `would delete` 的行符合预期，再改回 `false` 重启 worker。

### 备份与恢复演练

backup sidecar 每 `BACKUP_INTERVAL_SECONDS`（默认 86400s）执行 `mysqldump --single-transaction | gzip | aws s3 cp` 到 `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/`；启动后立即跑首轮。**每季度至少做一次恢复演练**：

```bash
# 1) 找最新备份
aws s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} | tail -1

# 2) 恢复到一次性验证库（严禁直接覆盖生产库）
#    MYSQL_ROOT_PASSWORD 取部署时 compose 里为 mysql service 设定的值（本地 dev compose 默认为 moment_root_dev）。
#    导入/校验必须用 root：moment 用户只有 moment_dev.* 库级授权，对 root 新建的演练库无权限（Access denied）。
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "CREATE DATABASE moment_restore_drill"
aws s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<file>.sql.gz" - ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} \
  | gunzip \
  | docker compose exec -T mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill

# 3) 校验：表齐全 + 关键表行数与生产同量级
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill \
  -e "SHOW TABLES; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM moments; SELECT COUNT(*) FROM share_links;"

# 4) 销毁演练库
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "DROP DATABASE moment_restore_drill"
```

### web 部署

web 为静态产物：`pnpm --filter @moment/web build` → `apps/web/dist/`，托管到任意静态服务/nginx，与 API **同源**部署并反代 `/api` 到 server:3000（媒体 302 与分享页均依赖同源相对路径）。
````

- [ ] **Step 2: 全量回归**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、dto/api-client/server 全部测试 PASS。

- [ ] **Step 3: DoD 手工验证清单（逐项打勾）**

1. 生产 compose 全流程（Task 10 Step 5 六项）全部符合预期。
2. 分享闭环（dev 或 staging）：owner 创建 share link → 无痕窗口打开 `/share/:token` 看到时间线与媒体 → 吊销后公开页 404 文案 + 媒体 URL `?st=` 也 404 → 重新创建新链接恢复可用。
3. 过期链接：创建 `expiresAt` 为 1 分钟后的链接，等 90 秒后公开页与媒体均 404 `SHARE_NOT_FOUND`。
4. sweeper dry-run：`SWEEPER_DRY_RUN=true` 起 worker，日志出现 `would delete` 行（可提前在 dev 库直插超期 uploading media 行构造）。
5. S3 lifecycle：`get-bucket-lifecycle-configuration` 复核两条规则在位（Task 7 Step 2）。
6. 备份恢复演练四步全部跑通（README 章节命令）。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 生产部署章节（启动/迁移/sweeper dry-run/备份恢复演练/web 静态部署）"
```

---

## 完成标准（Phase 8 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿（含 share 域全部新测试与改造的 media/handlers/processor 用例）。
- spec 覆盖核对：§1 链接分享（多链接/单独吊销/可设过期 ✓）、§3 share_links 表 ✓、§4 Chains share-links 三端点 + Public 匿名端点 ✓、§5.3 `?st=` 透传 ✓、§5.5 防孤儿（sweeper 两类清理 + S3 lifecycle）✓、§9 compose 四 service + 备份恢复演练 ✓。
- 匿名访问矩阵全通：有效/吊销/过期/未知 token、跨链媒体拒绝、软删 moment 媒体拒绝、未绑定 media 拒绝、无 st 未登录 401。
- sweeper 单测（mock storage + 构造超期行）+ dry-run 日志先行；`moment.deleted` handler 注册且幂等。
- express-rate-limit v8：自定义 keyGenerator 全部经 `ipKeyGenerator`；敏感端点限流复核表落档（Task 9）。
- 生产 compose 手工验证清单（Task 10 Step 5 + Task 11 Step 3）逐项通过；真实凭据不进 git。
