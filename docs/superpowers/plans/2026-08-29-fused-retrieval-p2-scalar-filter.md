# 融合检索 P2：GET feed / 链列表标量过滤（person_id / place / happened_from|to）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GET `/api/feed` 与 GET `/api/chains/:chainId/moments` 真正按 query 的 `person_id` / `place` / `happened_from` / `happened_to`（HTTP snake_case）做 MySQL 硬 AND 过滤；`RANGE_REQUIRES_HAPPENED_AT` 在 feed HTTP 层可测；链列表改为 `listMomentsQuerySchema.parse(req.query)`；month-index 不加这些参数。

**Architecture:** 过滤只进既有 `queryMomentPage`（feed 与链内列表、以及 share-album 已共用的唯一 moments 分页查询）。`personId` 用 `moment_persons` 半连接（同现网 `tagId`）；`place` 对 `moments.place_name` **整串相等**；`happenedFrom`/`happenedTo` 是 `happened_at` 闭区间（`gte` + `lte`）。Feed 在 P1 已 `feedQuerySchema.parse(req.query)`，本计划只把新字段映射进 `FeedService` → `queryMomentPage`。链列表仍手选 `{ cursor, limit, before }`，本计划改为吃完整 `req.query`。不改 ChainPolicy、不改 `{h,i}`/`{c,i}` 游标、不走向量、不改 serializer。

**Tech Stack:** drizzle-orm 0.45（`eq` / `inArray` / `gte` / `lte`）/ routing-controllers 0.11 + TypeDI / zod ^3.22（本计划不改 schema，只消费 P1）/ jest + supertest（真实 MySQL 测试库，`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§5 仅硬过滤形态与 `{h,i}` 游标、§6.1 GET 硬过滤、§6.6 `RANGE_REQUIRES_HAPPENED_AT`、§9 GET 测试策略、§11 P2 出口）

**上游契约:** `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`（执行时假设 P1 已在本分支落地；本计划消费其 Produces，不重定义 dto / 不重跑迁移）

## Global Constraints

- 冻结名逐字不得改：`queryMomentPage` / `MomentPageQuery.personId` / `MomentPageQuery.place` / `MomentPageQuery.happenedFrom` / `MomentPageQuery.happenedTo` / HTTP query `person_id` `place` `happened_from` `happened_to` / 错误码 `RANGE_REQUIRES_HAPPENED_AT`（既有 `BEFORE_REQUIRES_HAPPENED_AT` 不改名）/ `listMomentsQuerySchema.parse(req.query)`。
- CONVENTIONS §3 **只追加不改语义**：不改 `ChainPolicy` / `requireChainRole`；不改 feed `{h,i}`/`{c,i}` 编解码（`src/feed/cursor.ts` 本计划不碰）；媒体稳定入口不改；不改 `serializeMoments`。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已追加 `person_id`/`place`/`happened_*` query 到 §3.6）。
- **不重定义 dto**：`feedQuerySchema` / `listMomentsQuerySchema` / `isoDatetime` / `uuidLoose` / RANGE superRefine 以 P1 为准。`packages/dto` 本计划零 diff。
- GET chip 的人物过滤仍是**单个** `person_id`（不是数组）。跨链多 id 析取属 P6。
- month-index **不加** `person_id` / `place` / `happened_*`（schema 已由 P1 strip；本计划不得给 `queryMonthIndex` 加这些谓词）。
- GET 区间比较的是 `moments.happened_at`，**不是** `wall_date`。`tz_offset` 仍只属于 month-index query，feed/list 标量区间不读它。
- 搜索框 `POST /api/search`、search `before`、向量 `{d,i}`、compress/Lance/embed/jobs/api-client/web/app **本计划不做**。
- server 测试打 `.env` 指向的测试库：`pnpm --filter @moment/server test -- <file>`（`package.json` 的 `test` 脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)` + `beforeEach(resetDb)`。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤**。

**Spec 引用与偏差（逐条注明）：**

1. **HTTP 信封 `error.code` 仍是 `VALIDATION_ERROR`，机器码在 `error.details[].message`**：与现网 `before + order=created_at` 相同（`ErrorHandlerMiddleware` 把所有 `ZodError` 映成 400 `VALIDATION_ERROR`）。P2 的 RANGE 测试同时断言 `status=400`、`error.code==='VALIDATION_ERROR'`、以及 `details` 含 `message==='RANGE_REQUIRES_HAPPENED_AT'`。不新抛 `BadRequestError('RANGE_REQUIRES_HAPPENED_AT')`（那会把信封 code 改成该机器码，与现网 BEFORE 路径分叉）。
2. **GET `/api/feed` 的 RANGE / from>to / 非法 `person_id` 在 P1 落地后就会 400**（`FeedController` 已 `parse(req.query)`）。这些用例**不是**本计划的红灯来源；红灯是「合法新字段被 service 丢弃 → 不过滤」。实现时不要为了制造红灯去拆 P1 schema。
3. **`queryMomentPage` 在 `order !== 'happened_at'` 时忽略 `happenedFrom`/`happenedTo`/`before`**（与现网 `before` 防御同一形状）。HTTP 层 dto 已拒绝区间 + `created_at`；SQL 层不对 `created_at` 列做区间。`personId`/`place`/`tagId` 与 `order` 无关，照常过滤。
4. **`place` 用 SQL `eq(moments.placeName, place)`，不是 LIKE / 不是子串**：spec §0/§6.1「chip GET 的 `place` **整串相等**（零命中 = 空列表）」。列 collation 跟随现网 `place_name`（utf8mb4）；测试用互不包含的中文专名钉「非子串」。
5. **`MomentService.list` 的 query 类型收成 P1 的 `ListMomentsQuery`**（含 snake_case 四字段）。`limit` 仍在 service 里 `Number` 解析，非法 → `INVALID_LIMIT`（不改成 zod coerce）。
6. **share-album 的 `queryMomentPage` 调用不加这些过滤**（spec：分享页无搜索/无 chip GET）。可选字段缺省 = 旧行为。
7. **api-client `FeedQuery` camelCase 属 P8**：本计划不改 `packages/api-client`。server 内部 `FeedQueryParsed` 继续 camelCase（`personId`/`happenedFrom`/`happenedTo`），与现网 `tagId` 一致。

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/src/feed/moment-query.ts` | `MomentPageQuery` 四可选字段 + SQL 谓词 |
| `apps/server/tests/feed/moment-query-filters.test.ts` | 直打 `queryMomentPage` 的 SQL 契约 |
| `apps/server/src/feed/feed.service.ts` | `FeedQueryParsed` 映射到 `queryMomentPage` |
| `apps/server/src/feed/feed.controller.ts` | snake_case → camelCase |
| `apps/server/tests/feed/feed-scalar-filter.test.ts` | GET `/api/feed` HTTP |
| `apps/server/tests/feed/month-index.test.ts` | 锁：带 person_id/place/happened_* 也不改计数 |
| `apps/server/src/moments/moment.controller.ts` | `parse(req.query)` |
| `apps/server/src/moments/moment.service.ts` | `list(..., ListMomentsQuery)` 映射四字段 |
| `apps/server/tests/moments/list-scalar-filter.test.ts` | GET `/api/chains/:chainId/moments` HTTP |

**本计划明确不改：** `packages/dto/**`、`src/feed/cursor.ts`、`src/feed/month-index.ts`、`src/chains/chain-policy.ts`、`src/moments/moment-serializer.ts`、`src/share/share-link.service.ts`、handlers / Lance / `POST /api/search`、api-client / web / app、`config.ts` / `.env`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: `queryMomentPage` 增加 personId / place / happenedFrom / happenedTo

**Files:**
- Modify: `apps/server/src/feed/moment-query.ts:1`（import `gte`/`lte` + `momentPersons`）
- Modify: `apps/server/src/feed/moment-query.ts:6-15`（`MomentPageQuery` 四可选字段）
- Modify: `apps/server/src/feed/moment-query.ts:50-67`（`before` 之后、select 之前追加三个谓词块）
- Create: `apps/server/tests/feed/moment-query-filters.test.ts`

**Interfaces:**
- Consumes:
  - 既有 `queryMomentPage(query: MomentPageQuery): Promise<MomentPage>`
  - 既有 `MomentPageQuery.{ chainIds, order, limit, cursor?, tagId?, before? }`
  - P1 不改本文件；`momentPersons`（`src/db/schema.js` barrel，M1 已落地）
  - drizzle `eq` / `inArray` / `gte` / `lte`（`gte`/`lte` 为本 Task 新 import）
  - 测试夹具：`insertMoment` / `insertPerson` / `attachPerson` / `attachTag` / `createChain` / `registerUser`（`tests/helpers/fixtures.js`）
- Produces（P6 硬过滤可复用单 `personId`；跨链析取不得压进本字段）:
  - `MomentPageQuery.personId?: string` — `inArray(moments.id, select momentId from moment_persons where person_id=?)`（同 `tagId`）
  - `MomentPageQuery.place?: string` — `eq(moments.placeName, place)`（整串相等）
  - `MomentPageQuery.happenedFrom?: string` — 仅 `order==='happened_at'` 时 `gte(moments.happenedAt, new Date(happenedFrom))`
  - `MomentPageQuery.happenedTo?: string` — 仅 `order==='happened_at'` 时 `lte(moments.happenedAt, new Date(happenedTo))`
  - 与既有 `tagId` / `before`（`happened_at < before`）AND；游标仍 `encodeCursor`/`decodeCursor`（`{h,i}` / `{c,i}`）
  - 缺省四字段 = P2 之前行为（share-album 调用不传则不过滤）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/feed/moment-query-filters.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { decodeCursor } from '../../src/feed/cursor.js';
import { queryMomentPage } from '../../src/feed/moment-query.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  app,
  attachPerson,
  attachTag,
  createChain,
  insertMoment,
  insertPerson,
  registerUser,
} from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setPlace(momentId: string, name: string): Promise<void> {
  await db
    .update(moments)
    .set({
      placeLat: 39.9042,
      placeLng: 116.4074,
      placeName: name,
      placeSource: 'manual',
    })
    .where(eq(moments.id, momentId));
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

describe('queryMomentPage 标量过滤（fused-retrieval spec §6.1）', () => {
  it('personId：semi-join moment_persons；未关联 / 他链 person / 不存在 id → 空页（不抛）', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const chainA = await createChain(owner.id, 'A');
    const chainB = await createChain(other.id, 'B');
    const grandma = await insertPerson({ chainId: chainA, name: '外婆' });
    const foreign = await insertPerson({ chainId: chainB, name: '外人' });
    const hit = await insertMoment({
      chainId: chainA,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId: chainA,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    void miss;

    const page = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: grandma,
    });
    expect(ids(page.rows)).toEqual([hit]);

    const noLink = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: foreign,
    });
    expect(noLink.rows).toEqual([]);
    expect(noLink.nextCursor).toBeNull();

    const missing = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: '00000000-0000-4000-8000-000000000099',
    });
    expect(missing.rows).toEqual([]);
  });

  it('personId：软删 moment 不出现', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const live = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const gone = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
      deletedAt: new Date(),
    });
    await attachPerson(live, personId);
    await attachPerson(gone, personId);

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      personId,
    });
    expect(ids(page.rows)).toEqual([live]);
  });

  it('place：整串相等；子串不命中；零命中空页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const park = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const other = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
    });
    const unnamed = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-08T00:00:00Z'),
    });
    await setPlace(park, '朝阳公园');
    await setPlace(other, '奥林匹克公园');

    const exact = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '朝阳公园',
    });
    expect(ids(exact.rows)).toEqual([park]);

    const substring = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '朝阳',
    });
    expect(substring.rows).toEqual([]);

    const none = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '不存在的地方',
    });
    expect(none.rows).toEqual([]);
    void unnamed;
  });

  it('happenedFrom/To：happened_at 闭区间 [from, to]；只用 happened_at 不用 wall_date', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const before = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T23:59:59.000Z'),
    });
    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T12:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-31T23:59:59.999Z'),
    });
    const after = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-01T00:00:00.000Z',
      happenedTo: '2026-08-31T23:59:59.999Z',
    });
    expect(ids(page.rows)).toEqual([toEdge, mid, fromEdge]);
    void before;
    void after;
  });

  it('happenedFrom/To：比较 UTC 瞬时（带偏移 ISO 经 Date 解析）；不按 wall_date 分桶', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    // 同一 UTC 瞬时、不同 happened_tz_offset → 不同 wall_date（东八 08-01 vs UTC 07-31）
    const east8 = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T16:30:00Z'),
      happenedTzOffset: -480,
    });
    const utc = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T16:30:00Z'),
      happenedTzOffset: 0,
    });

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-01T00:00:00+08:00', // UTC 7/31 16:00
      happenedTo: '2026-07-31T17:00:00Z',
    });
    expect(new Set(ids(page.rows))).toEqual(new Set([east8, utc]));
  });

  it('只 from / 只 to 各自生效', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const a = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const b = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00Z'),
    });

    const fromOnly = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-10T00:00:00.000Z',
    });
    expect(ids(fromOnly.rows)).toEqual([b]);

    const toOnly = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedTo: '2026-08-10T00:00:00.000Z',
    });
    expect(ids(toOnly.rows)).toEqual([a]);
  });

  it('personId + tagId + place + happened_* + before 全部 AND；before 仍严格 <', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const tagRes = await request(app)
      .post(`/api/chains/${chainId}/tags`)
      .set(auth(owner.token))
      .send({ name: '野餐' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;

    async function seed(at: string, opts: { person?: boolean; tag?: boolean; place?: string }) {
      const id = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(at),
      });
      if (opts.person) await attachPerson(id, personId);
      if (opts.tag) await attachTag(id, tagId);
      if (opts.place) await setPlace(id, opts.place);
      return id;
    }

    const hit = await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });
    await seed('2026-08-10T00:00:00.000Z', { tag: true, place: '朝阳公园' }); // 无人
    await seed('2026-08-10T00:00:00.000Z', { person: true, place: '朝阳公园' }); // 无 tag
    await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '奥林匹克公园',
    });
    await seed('2026-08-20T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    }); // 晚于 before
    const beforeEdge = await seed('2026-08-15T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    }); // happened_at === before → 排除

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      personId,
      tagId,
      place: '朝阳公园',
      happenedFrom: '2026-08-01T00:00:00.000Z',
      happenedTo: '2026-08-31T00:00:00.000Z',
      before: '2026-08-15T00:00:00.000Z',
    });
    expect(ids(page.rows)).toEqual([hit]);
    void beforeEdge;
  });

  it('personId 与 order=created_at 可共存；区间在 created_at 下被忽略（不得打 happened_at，也不得打 timeCol/created_at）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const olderEvent = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    const newerEvent = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    const createdBeforeRange = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    const unattached = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T00:00:00Z'),
      createdAt: new Date('2026-08-25T00:00:00Z'),
    });
    await attachPerson(olderEvent, personId);
    await attachPerson(newerEvent, personId);
    await attachPerson(createdBeforeRange, personId);

    const byCreated = await queryMomentPage({
      chainIds: [chainId],
      order: 'created_at',
      limit: 20,
      personId,
      // 若误 gte(happened_at) → 丢掉 olderEvent；若误 gte(timeCol/created_at) → 丢掉 createdBeforeRange
      happenedFrom: '2026-08-01T00:00:00.000Z',
    });
    expect(ids(byCreated.rows)).toEqual([olderEvent, newerEvent, createdBeforeRange]);
    void unattached;
  });

  it('过滤后仍用 {h,i} 游标翻页；坏游标仍 INVALID_CURSOR（先于空结果）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: same }); // 无人物，不得漏进翻页

    const p1 = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 1,
      personId,
    });
    expect(p1.rows).toHaveLength(1);
    expect(p1.nextCursor).toBeTruthy();
    const decoded = decodeCursor('happened_at', p1.nextCursor!);
    expect(decoded).toEqual({ time: same.getTime(), id: p1.rows[0].id });
    const raw = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as {
      h?: unknown;
      c?: unknown;
      d?: unknown;
      i?: unknown;
    };
    expect(raw).toEqual({ h: same.getTime(), i: p1.rows[0].id });
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();

    const p2 = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 1,
      personId,
      cursor: p1.nextCursor!,
    });
    expect(p2.rows).toHaveLength(1);
    expect(p2.rows[0].id).not.toBe(p1.rows[0].id);
    expect(new Set([p1.rows[0].id, p2.rows[0].id])).toEqual(new Set([a, b]));

    await expect(
      queryMomentPage({
        chainIds: [chainId],
        order: 'happened_at',
        limit: 20,
        personId,
        cursor: '!!!not-base64!!!',
      }),
    ).rejects.toMatchObject({ message: 'INVALID_CURSOR' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/feed/moment-query-filters.test.ts`

Expected: FAIL。server `tsconfig` 继承 `isolatedModules: true`，ts-jest **只转译、不做过量属性类型检查**——红灯是运行时「新字段被忽略 → 未过滤全集」：`personId` 仍返回未关联行、`place: '朝阳'` 仍命中 `朝阳公园`、闭区间含 7 月/9 月、`order=created_at` 下列出未关联行。软删排除 / 坏游标 `INVALID_CURSOR` 是既有行为锁，实现前就可能绿，**不是**停手条件。不要为了红灯去改 dto 或关掉 `isolatedModules`。

- [ ] **Step 3: 最小实现**

Modify `apps/server/src/feed/moment-query.ts` 整文件替换为：
```ts
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { momentPersons, moments, momentTags, type Moment } from '../db/schema.js';
import { decodeCursor, encodeCursor, type MomentOrder } from './cursor.js';

export interface MomentPageQuery {
  /** 可见范围（feed=我的链子集；链内列表=单链）。可为空数组：返回空页（游标仍先校验）。 */
  chainIds: string[];
  order: MomentOrder;
  limit: number;
  cursor?: string;
  tagId?: string;
  /** 日期锚定：happened_at < before（严格小于）。仅 happened_at 语义下由调用方传入。 */
  before?: string;
  /** GET chip 单个人物（spec §6.1）；semi-join moment_persons，同 tagId。 */
  personId?: string;
  /** GET chip 地点整串相等（spec §0/§6.1），零命中空页。 */
  place?: string;
  /** happened_at 闭区间下界（ISO）。仅 order=happened_at 时生效。 */
  happenedFrom?: string;
  /** happened_at 闭区间上界（ISO）。仅 order=happened_at 时生效。 */
  happenedTo?: string;
}

export interface MomentPage {
  rows: Moment[];
  nextCursor: string | null;
}

/**
 * feed 与链内 moments 列表共用的分页查询（spec §5.1 / fused-retrieval §6.1）：
 * WHERE chain_id IN (...) AND deleted_at IS NULL
 *   AND (time, id) < (cursorTime, cursorId)
 *   AND 可选 tagId / personId / place / happenedFrom / happenedTo / before
 * ORDER BY time DESC, id DESC LIMIT n+1
 */
export async function queryMomentPage(query: MomentPageQuery): Promise<MomentPage> {
  const cursor = query.cursor ? decodeCursor(query.order, query.cursor) : undefined;
  if (query.chainIds.length === 0) {
    return { rows: [], nextCursor: null };
  }
  const timeCol = query.order === 'happened_at' ? moments.happenedAt : moments.createdAt;

  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];

  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      or(
        lt(timeCol, cursorTime),
        and(eq(timeCol, cursorTime), lt(moments.id, cursor.id)),
      ) as SQL,
    );
  }

  // before 与 cursor / happenedTo 共存：全部 AND，取更严上界（spec §6.1）。
  // order=created_at + before/区间 已在 feedQuerySchema 层拒绝。
  // 防御：不对 created_at 列做 happened_at 锚定。
  if (query.before && query.order === 'happened_at') {
    conditions.push(lt(moments.happenedAt, new Date(query.before)));
  }

  if (query.happenedFrom && query.order === 'happened_at') {
    conditions.push(gte(moments.happenedAt, new Date(query.happenedFrom)));
  }
  if (query.happenedTo && query.order === 'happened_at') {
    conditions.push(lte(moments.happenedAt, new Date(query.happenedTo)));
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

  if (query.personId) {
    conditions.push(
      inArray(
        moments.id,
        db
          .select({ id: momentPersons.momentId })
          .from(momentPersons)
          .where(eq(momentPersons.personId, query.personId)),
      ),
    );
  }

  if (query.place) {
    conditions.push(eq(moments.placeName, query.place));
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

不要改 `cursor.ts`。不要给 `queryMonthIndex` 加这些字段。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/feed/moment-query-filters.test.ts`

Expected: PASS。

- [ ] **Step 5: 既有 query 调用方回归**

Run: `pnpm --filter @moment/server test -- tests/feed/feed.test.ts tests/feed/feed-before.test.ts tests/moments/list-refactor.test.ts tests/moments/moment-list-crud.test.ts`

Expected: PASS。缺省新字段时行为与本 Task 之前相同。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/feed/moment-query.ts apps/server/tests/feed/moment-query-filters.test.ts
git commit -m "feat(server): filter queryMomentPage by person, place, and happened range"
```

---

### Task 2: GET `/api/feed` 映射新 query + RANGE HTTP + month-index 不加过滤

**Files:**
- Modify: `apps/server/src/feed/feed.service.ts:9-17`（`FeedQueryParsed` 四字段）与 `:30-37`（传入 `queryMomentPage`）
- Modify: `apps/server/src/feed/feed.controller.ts:22-29`（snake_case → camelCase）
- Create: `apps/server/tests/feed/feed-scalar-filter.test.ts`
- Test: `apps/server/tests/feed/month-index.test.ts`（文件末尾追加一锁；**不改** `month-index.ts` / `monthIndexQuerySchema`）

**Interfaces:**
- Consumes:
  - P1 `feedQuerySchema`：`person_id?: string`（`uuidLoose`）、`place?: string`、`happened_from?: string`、`happened_to?: string`；superRefine `RANGE_REQUIRES_HAPPENED_AT` / `VALIDATION_ERROR` path `happened_to` / 既有 `BEFORE_REQUIRES_HAPPENED_AT`
  - P1 偏差 4：`FeedController` 已 `feedQuerySchema.parse(req.query)`
  - Task 1 `queryMomentPage` / `MomentPageQuery.personId|place|happenedFrom|happenedTo`
  - 既有 `FeedQueryParsed.{ cursor?, chainIds?, tagId?, order, limit, before? }`
  - 既有 `FeedService.feed(userId, query): Promise<FeedResponse>`（签名不改名；query 形状扩展）
- Produces:
  - `FeedQueryParsed.personId?: string`
  - `FeedQueryParsed.place?: string`
  - `FeedQueryParsed.happenedFrom?: string`
  - `FeedQueryParsed.happenedTo?: string`
  - `FeedController.feed` 映射：`personId ← query.person_id`、`place ← query.place`、`happenedFrom ← query.happened_from`、`happenedTo ← query.happened_to`（既有 `tagId ← tag_id` 形状）
  - `FeedService.feed` 把上述四字段原样传入 `queryMomentPage`
  - HTTP：合法过滤 200；他链/不存在 `person_id` → 200 空页（同现网 `tag_id`）；区间 + `order=created_at` → 400 信封 `VALIDATION_ERROR` 且 details 含 `RANGE_REQUIRES_HAPPENED_AT`；`happened_from > happened_to`（`Date.parse`）→ 400 `VALIDATION_ERROR`
  - `queryMonthIndex` / `FeedService.monthIndex` **不**增加这些字段

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/feed/feed-scalar-filter.test.ts`：
```ts
import request from 'supertest';
import type { Response } from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  addMember,
  app,
  attachPerson,
  attachTag,
  createChain,
  insertMoment,
  insertPerson,
  registerUser,
} from '../helpers/fixtures.js';

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

function issueMessages(res: Response): string[] {
  const details = res.body.error?.details as { message?: string }[] | undefined;
  return Array.isArray(details) ? details.map((d) => d.message ?? '') : [];
}

async function setPlace(momentId: string, name: string): Promise<void> {
  await db
    .update(moments)
    .set({
      placeLat: 39.9042,
      placeLng: 116.4074,
      placeName: name,
      placeSource: 'manual',
    })
    .where(eq(moments.id, momentId));
}

describe('GET /api/feed 标量过滤（fused-retrieval spec §6.1 / §9）', () => {
  it('person_id 只返回关联该人的 moment；他链/不存在 person → 200 空页（同 tag_id）', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const chainA = await createChain(alice.id, 'A');
    const chainC = await createChain(carol.id, 'C');
    const grandma = await insertPerson({ chainId: chainA, name: '外婆' });
    const foreign = await insertPerson({ chainId: chainC, name: '外人' });
    const hit = await insertMoment({
      chainId: chainA,
      authorId: alice.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await insertMoment({
      chainId: chainA,
      authorId: alice.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);

    const res = await getFeed(alice.token, `?person_id=${grandma}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);
    expect(res.body.moments[0].persons.some((p: { id: string }) => p.id === grandma)).toBe(true);

    const other = await getFeed(alice.token, `?person_id=${foreign}`);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ moments: [], nextCursor: null });

    const missing = await getFeed(alice.token, '?person_id=00000000-0000-4000-8000-000000000099');
    expect(missing.status).toBe(200);
    expect(missing.body.moments).toEqual([]);
  });

  it('place 整串相等；子串 朝阳 打不中 朝阳公园', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const park = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const other = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
    });
    await setPlace(park, '朝阳公园');
    await setPlace(other, '奥林匹克公园');

    const exact = await getFeed(owner.token, `?place=${encodeURIComponent('朝阳公园')}`);
    expect(exact.status).toBe(200);
    expect(ids(exact)).toEqual([park]);

    const sub = await getFeed(owner.token, `?place=${encodeURIComponent('朝阳')}`);
    expect(sub.status).toBe(200);
    expect(sub.body.moments).toEqual([]);
  });

  it('happened_from/to 闭区间；与 tag_id/before AND', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const tagRes = await request(app)
      .post(`/api/chains/${chainId}/tags`)
      .set(auth(owner.token))
      .send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;
    const personId = await insertPerson({ chainId, name: '朵朵' });

    async function seed(at: string, opts: { person?: boolean; tag?: boolean; place?: string }) {
      const id = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(at),
      });
      if (opts.person) await attachPerson(id, personId);
      if (opts.tag) await attachTag(id, tagId);
      if (opts.place) await setPlace(id, opts.place);
      return id;
    }

    const hit = await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });
    await seed('2026-08-10T00:00:00.000Z', { tag: true, place: '朝阳公园' });
    await seed('2026-08-10T00:00:00.000Z', { person: true, place: '朝阳公园' });
    await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '奥林匹克公园',
    });
    await seed('2026-08-15T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });
    await seed('2026-08-20T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });

    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-08-31T23:59:59.999Z');
    const before = encodeURIComponent('2026-08-15T00:00:00.000Z');
    const res = await getFeed(
      owner.token,
      `?person_id=${personId}&tag_id=${tagId}&place=${encodeURIComponent('朝阳公园')}&happened_from=${from}&happened_to=${to}&before=${before}`,
    );
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);
  });

  it('happened_from/to + order=created_at → 400 RANGE_REQUIRES_HAPPENED_AT（信封仍 VALIDATION_ERROR）', async () => {
    const owner = await registerUser();
    await createChain(owner.id);
    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const res = await getFeed(owner.token, `?order=created_at&happened_from=${from}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(issueMessages(res)).toContain('RANGE_REQUIRES_HAPPENED_AT');

    const onlyTo = await getFeed(
      owner.token,
      `?order=created_at&happened_to=${encodeURIComponent('2026-08-31T00:00:00.000Z')}`,
    );
    expect(onlyTo.status).toBe(400);
    expect(issueMessages(onlyTo)).toContain('RANGE_REQUIRES_HAPPENED_AT');

    const before = await getFeed(
      owner.token,
      `?order=created_at&before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
    );
    expect(before.status).toBe(400);
    expect(issueMessages(before)).toContain('BEFORE_REQUIRES_HAPPENED_AT');
    expect(issueMessages(before)).not.toContain('RANGE_REQUIRES_HAPPENED_AT');
  });

  it('happened_from > happened_to 用 Date.parse，带偏移不靠字典序', async () => {
    const owner = await registerUser();
    await createChain(owner.id);

    const ok = await getFeed(
      owner.token,
      `?happened_from=${encodeURIComponent('2026-08-01T00:00:00+08:00')}&happened_to=${encodeURIComponent('2026-07-31T23:00:00Z')}`,
    );
    expect(ok.status).toBe(200);

    const bad = await getFeed(
      owner.token,
      `?happened_from=${encodeURIComponent('2026-08-02T00:00:00.000Z')}&happened_to=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      (bad.body.error.details as { message: string; path: unknown[] }[]).some(
        (i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happened_to',
      ),
    ).toBe(true);
  });

  it('非法 person_id → 400 VALIDATION_ERROR；chip GET 游标仍是 {h,i} 不是 {d,i}', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);

    const nope = await getFeed(owner.token, '?person_id=nope');
    expect(nope.status).toBe(400);
    expect(nope.body.error.code).toBe('VALIDATION_ERROR');

    const p1 = await getFeed(owner.token, `?person_id=${personId}&limit=1`);
    expect(p1.status).toBe(200);
    expect(p1.body.moments).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const raw = JSON.parse(Buffer.from(p1.body.nextCursor as string, 'base64url').toString('utf8')) as {
      h?: unknown;
      c?: unknown;
      d?: unknown;
      i?: unknown;
    };
    expect(typeof raw.h).toBe('number');
    expect(typeof raw.i).toBe('string');
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();
  });

  it('viewer 成员可过滤；未登录 401', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    const personId = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await attachPerson(hit, personId);

    const res = await getFeed(viewer.token, `?person_id=${personId}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);

    const anon = await request(app).get(`/api/feed?person_id=${personId}`);
    expect(anon.status).toBe(401);
  });
});
```

Modify `apps/server/tests/feed/month-index.test.ts` — **只改 fixtures 那一行**（补 `attachPerson` / `insertPerson`；保留 `import request from 'supertest'`、`closeDb`/`resetDb`、`auth`）：
```ts
import { addMember, app, attachPerson, attachTag, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
```

在现有 `describe('GET /api/feed/month-index')` 最后一个 `it` 之后、describe 闭合 `});` 之前追加：
```ts
  it('person_id/place/happened_* 不加进月份索引（spec §6.1；未知键 strip，计数不变）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const tagged = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-02T00:00:00Z'),
    });
    await attachPerson(tagged, personId);

    const baseline = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(owner.token));
    expect(baseline.status).toBe(200);
    expect(baseline.body).toEqual({ months: [{ month: '2026-08', count: 2 }] });

    // 9 月闭区间 / 他 person / 无此地名：任一谓词若误进 queryMonthIndex，8 月 count 都会变
    const withChip = await request(app)
      .get(
        `/api/feed/month-index?tz_offset=0&person_id=${personId}&place=${encodeURIComponent('朝阳公园')}&happened_from=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&happened_to=${encodeURIComponent('2026-09-30T23:59:59.999Z')}`,
      )
      .set(auth(owner.token));
    expect(withChip.status).toBe(200);
    expect(withChip.body).toEqual({ months: [{ month: '2026-08', count: 2 }] });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/feed/feed-scalar-filter.test.ts tests/feed/month-index.test.ts`

Expected: FAIL。**红灯以过滤用例为准**：`?person_id=` / `?place=` 仍返回链上全部 moment（FeedService 丢弃新字段）。下列用例在 P1 之后可能已经绿，**不是**停手条件：RANGE / from>to / 非法 `person_id` 的 400、month-index 计数不变（P1 strip + 本计划不得把过滤漏进 `queryMonthIndex`——该锁实现前就是绿的，用来拦误加）。

- [ ] **Step 3: 映射 FeedQueryParsed + controller**

Modify `apps/server/src/feed/feed.service.ts` — `FeedQueryParsed` 替换为：
```ts
export interface FeedQueryParsed {
  cursor?: string;
  /** 未传 = 全部我的链；传了 = 与我的链求交集（收窄） */
  chainIds?: string[];
  tagId?: string;
  order: MomentOrder;
  limit: number;
  before?: string;
  personId?: string;
  place?: string;
  happenedFrom?: string;
  happenedTo?: string;
}
```

`queryMomentPage({...})` 调用替换为：
```ts
    const page = await queryMomentPage({
      chainIds: scope,
      order: query.order,
      limit: query.limit,
      cursor: query.cursor,
      tagId: query.tagId,
      before: query.before,
      personId: query.personId,
      place: query.place,
      happenedFrom: query.happenedFrom,
      happenedTo: query.happenedTo,
    });
```

`monthIndex` 方法体一字不改。

Modify `apps/server/src/feed/feed.controller.ts` — `feed()` 里 `return this.feedService.feed(...)` 替换为：
```ts
    return this.feedService.feed(user.id, {
      cursor: query.cursor,
      chainIds: query.chain_ids?.split(','),
      tagId: query.tag_id,
      order: query.order,
      limit: query.limit,
      before: query.before,
      personId: query.person_id,
      place: query.place,
      happenedFrom: query.happened_from,
      happenedTo: query.happened_to,
    });
```

`monthIndex()` 映射一字不改。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/feed/feed-scalar-filter.test.ts tests/feed/month-index.test.ts tests/feed/feed.test.ts tests/feed/feed-before.test.ts`

Expected: PASS（新过滤 + 既有 feed / before / month-index 无回归）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/feed/feed.service.ts apps/server/src/feed/feed.controller.ts \
  apps/server/tests/feed/feed-scalar-filter.test.ts apps/server/tests/feed/month-index.test.ts
git commit -m "feat(server): honor GET feed person_id place happened_from/to"
```

---

### Task 3: 链列表 `parse(req.query)` + 同一套标量过滤 + `INVALID_LIMIT` 不变

**Files:**
- Modify: `apps/server/src/moments/moment.controller.ts:1-21`（import `Req` + `Request`；去掉 `QueryParam`）与 `:43-52`（`list` 改为 `parse(req.query)`）
- Modify: `apps/server/src/moments/moment.service.ts:1-6`（`ListMomentsQuery` 类型）与 `:202-226`（`list` 把四字段传入 `queryMomentPage`）
- Create: `apps/server/tests/moments/list-scalar-filter.test.ts`

**Interfaces:**
- Consumes:
  - P1 `listMomentsQuerySchema` / `type ListMomentsQuery = z.infer<typeof listMomentsQuerySchema>`：
    `{ cursor?: string; limit?: string; before?: string; person_id?: string; place?: string; happened_from?: string; happened_to?: string }`
  - P1：`happened_*` 用 `isoDatetime`；`before` 仍 `isoTimestampSchema`；`limit` 仍 `z.string().optional()`；from>to → superRefine `VALIDATION_ERROR` path `happened_to`；**无** `order` 字段、**无** `RANGE_REQUIRES_HAPPENED_AT`、**无** `tag_id`（链列表从未有 tag query；AND tag 只在 T1 SQL / T2 feed 测；本 Task 不得给 list schema 加 `tag_id`）
  - Task 1 `queryMomentPage` 四字段
  - 既有 `MomentService.list(userId, chainId, query): Promise<MomentListResponse>`；`ChainPolicy.require(userId, chainId, 'viewer')`（本方法内已有，不改 policy）
  - 既有 `@UseBefore(requireChainRole('viewer'))`（controller 不手写角色）
- Produces:
  - `MomentController.list`：`listMomentsQuerySchema.parse(req.query)`（不再 `parse({ cursor, limit, before })`）
  - `MomentService.list(userId: string, chainId: string, query: ListMomentsQuery): Promise<MomentListResponse>`
  - 映射：`personId: query.person_id`、`place: query.place`、`happenedFrom: query.happened_from`、`happenedTo: query.happened_to`、`before: query.before`、`cursor: query.cursor`；`order: 'happened_at'` 固定
  - `limit` 仍 service 内解析：缺省 20；非整数或越出 1..50 → `BadRequestError('INVALID_LIMIT')`
  - 非成员仍 404 `CHAIN_NOT_FOUND`（policy）；合法 `person_id` 他链/不存在 → **成员**看到空页，不是 404

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/list-scalar-filter.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  addMember,
  app,
  attachPerson,
  createChain,
  insertMoment,
  insertPerson,
  registerUser,
} from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setPlace(momentId: string, name: string): Promise<void> {
  await db
    .update(moments)
    .set({
      placeLat: 39.9042,
      placeLng: 116.4074,
      placeName: name,
      placeSource: 'manual',
    })
    .where(eq(moments.id, momentId));
}

describe('GET /api/chains/:chainId/moments 标量过滤（spec §6.1 parse(req.query)）', () => {
  it('person_id / place 过滤；子串不命中；他链 person 空页；非成员 404', async () => {
    const owner = await registerUser();
    const outsider = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    await setPlace(hit, '朝阳公园');
    await setPlace(miss, '奥林匹克公园');

    const byPerson = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${grandma}`)
      .set(auth(owner.token));
    expect(byPerson.status).toBe(200);
    expect(byPerson.body.items.map((m: { id: string }) => m.id)).toEqual([hit]);

    const byPlace = await request(app)
      .get(`/api/chains/${chainId}/moments?place=${encodeURIComponent('朝阳公园')}`)
      .set(auth(owner.token));
    expect(byPlace.status).toBe(200);
    expect(byPlace.body.items.map((m: { id: string }) => m.id)).toEqual([hit]);

    const sub = await request(app)
      .get(`/api/chains/${chainId}/moments?place=${encodeURIComponent('朝阳')}`)
      .set(auth(owner.token));
    expect(sub.status).toBe(200);
    expect(sub.body.items).toEqual([]);

    const foreignPerson = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${foreign}`)
      .set(auth(owner.token));
    expect(foreignPerson.status).toBe(200);
    expect(foreignPerson.body.items).toEqual([]);

    const denied = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${grandma}`)
      .set(auth(outsider.token));
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('happened_from/to 闭区间；与 before AND（before 仍严格 <）；viewer 可读', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');

    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-21T00:00:00.000Z'),
    });

    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-08-20T00:00:00.000Z');
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?happened_from=${from}&happened_to=${to}`)
      .set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([toEdge, mid, fromEdge]);

    const withBefore = await request(app)
      .get(
        `/api/chains/${chainId}/moments?happened_from=${from}&happened_to=${to}&before=${encodeURIComponent('2026-08-20T00:00:00.000Z')}`,
      )
      .set(auth(viewer.token));
    expect(withBefore.status).toBe(200);
    expect(withBefore.body.items.map((m: { id: string }) => m.id)).toEqual([mid, fromEdge]);
  });

  it('from>to → 400 VALIDATION_ERROR；无 RANGE_REQUIRES_HAPPENED_AT（无 order）；query 上的 order 被 strip', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const bad = await request(app)
      .get(
        `/api/chains/${chainId}/moments?happened_from=${encodeURIComponent('2026-08-02T00:00:00.000Z')}&happened_to=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
      )
      .set(auth(owner.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const messages = (bad.body.error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toContain('VALIDATION_ERROR');
    expect(messages).not.toContain('RANGE_REQUIRES_HAPPENED_AT');

    // 链列表恒 happened_at：即使乱传 order=created_at 也不走 RANGE；区间仍按 happened_at 过滤
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    const inRange = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    const stripped = await request(app)
      .get(
        `/api/chains/${chainId}/moments?order=created_at&happened_from=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
      )
      .set(auth(owner.token));
    expect(stripped.status).toBe(200);
    expect(stripped.body.items.map((m: { id: string }) => m.id)).toEqual([inRange]);
  });

  it('parse(req.query) 吃完整 query：非法 person_id 400；limit 越界仍 INVALID_LIMIT（非 VALIDATION_ERROR）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const nope = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=nope`)
      .set(auth(owner.token));
    expect(nope.status).toBe(400);
    expect(nope.body.error.code).toBe('VALIDATION_ERROR');

    const over = await request(app)
      .get(`/api/chains/${chainId}/moments?limit=51`)
      .set(auth(owner.token));
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('INVALID_LIMIT');

    const zero = await request(app)
      .get(`/api/chains/${chainId}/moments?limit=0`)
      .set(auth(owner.token));
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('INVALID_LIMIT');
  });

  it('过滤翻页游标仍是 {h,i}', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);

    const p1 = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${personId}&limit=1`)
      .set(auth(owner.token));
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(1);
    const raw = JSON.parse(Buffer.from(p1.body.nextCursor as string, 'base64url').toString('utf8')) as {
      h?: unknown;
      d?: unknown;
      c?: unknown;
    };
    expect(typeof raw.h).toBe('number');
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/list-scalar-filter.test.ts`

Expected: FAIL。红灯：`parse({ cursor, limit, before })` 丢掉 `person_id`/`place`/`happened_*` → 列表仍是全链时刻。`from>to` 在改 `parse(req.query)` 之前也可能仍 200（schema 没看到这两键）——它会在 Step 3 的 parse 切换后先变 400，**过滤用例**才是必须从红到绿的闸。非法 `person_id` 同理（改 parse 前被 strip，改 parse 后 400）。`limit` 越界 `INVALID_LIMIT` 是既有行为锁，实现前就绿。

- [ ] **Step 3: controller parse(req.query) + service 映射**

Modify `apps/server/src/moments/moment.controller.ts` — **只改 import 与 `list`，不要整文件替换**（`create` 与 `MomentItemController` 一字不改；不要手写角色判断）。

1. 在 dto import 之后追加（对齐 `feed.controller.ts`）：
```ts
import type { Request } from 'express';
```

2. `routing-controllers` import：**加入 `Req`，去掉 `QueryParam`**。其余装饰器（含 `Delete` / `OnUndefined` / `Patch`，给 `MomentItemController` 用）保持不动。

3. 只把 `list` 方法替换为：
```ts
  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(
    @Param('chainId') chainId: string,
    @Req() req: Request,
    @CurrentUser() user: UserProfile
  ): Promise<MomentListResponse> {
    const query = listMomentsQuerySchema.parse(req.query);
    return this.momentService.list(user.id, chainId, query);
  }
```

Modify `apps/server/src/moments/moment.service.ts` — 顶部 dto import 替换为：
```ts
import type { CreateMomentInput, ListMomentsQuery, MomentListResponse, MomentResponse, PatchMomentInput } from '@moment/dto';
```

`list` 方法整段替换为：
```ts
  /** 链内时间线：与 feed 共用 queryMomentPage（order 固定 happened_at，游标同格式）。 */
  async list(userId: string, chainId: string, query: ListMomentsQuery): Promise<MomentListResponse> {
    await this.policy.require(userId, chainId, 'viewer');

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit,
      cursor: query.cursor,
      before: query.before,
      personId: query.person_id,
      place: query.place,
      happenedFrom: query.happened_from,
      happenedTo: query.happened_to,
    });
    return { items: await serializeMoments(page.rows, userId, { includePrivate: true }), nextCursor: page.nextCursor };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/list-scalar-filter.test.ts`

Expected: PASS。

- [ ] **Step 5: 链列表 + feed 回归 + typecheck/lint**

Run:
```bash
pnpm --filter @moment/server test -- tests/moments/list-scalar-filter.test.ts tests/moments/list-refactor.test.ts tests/moments/moment-list-crud.test.ts tests/feed/feed-scalar-filter.test.ts tests/feed/moment-query-filters.test.ts tests/feed/feed-before.test.ts
pnpm --filter @moment/server typecheck
pnpm --filter @moment/server lint
```

Expected: 测试全绿；typecheck/lint exit 0。`list-refactor` 的空串 cursor / 坏游标 / 软删仍过。`moment-list-crud` 的 `INVALID_LIMIT` / `CHAIN_NOT_FOUND` 仍过。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/moments/moment.controller.ts apps/server/src/moments/moment.service.ts \
  apps/server/tests/moments/list-scalar-filter.test.ts
git commit -m "feat(server): parse list moments query object for scalar filters"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test -- tests/feed/moment-query-filters.test.ts tests/feed/feed-scalar-filter.test.ts tests/moments/list-scalar-filter.test.ts tests/feed/month-index.test.ts tests/feed/feed.test.ts tests/feed/feed-before.test.ts tests/moments/list-refactor.test.ts tests/moments/moment-list-crud.test.ts` 全绿
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] GET `/api/feed` 与 GET `/api/chains/:chainId/moments` 均消费 `person_id` / `place` / `happened_from` / `happened_to`（snake_case）；闭区间；place 整串相等；`person_id` 他链/不存在 → 空页（list 非成员仍 404 `CHAIN_NOT_FOUND`）
- [ ] `person_id`/`place`/`happened_*` 与既有 `tag_id`/`before` AND；`happened_*` 与 `before` 共存取更严上界（before 仍严格 `<`）
- [ ] feed：`happened_from|to` + `order=created_at` → 400，details 含 `RANGE_REQUIRES_HAPPENED_AT`；既有 `BEFORE_REQUIRES_HAPPENED_AT` 不改名；`happened_from > happened_to` 用 `Date.parse`
- [ ] 链列表：`listMomentsQuerySchema.parse(req.query)`；无 `RANGE_REQUIRES_HAPPENED_AT`；`limit` 非法仍 `INVALID_LIMIT`
- [ ] month-index 带这些 query 键时计数不变
- [ ] 游标仍 `{h,i}` / `{c,i}`，chip GET **不**产生 `{d,i}`
- [ ] 未泄漏 P3–P10：无 compress/derivedUrl、无 Lance/BA、无 `getEmbeddingProvider`、无 `POST /api/search`、无 jobs 路由、无 api-client/web/app、无 embedding env
- [ ] CONVENTIONS §3：`ChainPolicy` 未改；`cursor.ts` 未改；share-album 调用未加过滤；dto 零 diff；`CONVENTIONS.md` 文件零 diff

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P2）**：§6.1 四 query 字段、person semi-join、place 等值、闭区间、RANGE、list `parse(req.query)`、`INVALID_LIMIT`、month-index 不加、GET 单 `person_id`、他链空页、与 `tag_id`/`before` AND（tag 在 T1 SQL + T2 feed；链列表 schema **无** `tag_id`）、chip GET 零 LLM/零向量/`{h,i}`。§3.2 丢链规则 / search / wall_date 意图属 P6，本计划只钉 GET 不用 `wall_date`。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：Task 1 `MomentPageQuery.personId|place|happenedFrom|happenedTo` 被 Task 2 `FeedQueryParsed` 与 Task 3 `ListMomentsQuery` snake→camel 逐字传入；P1 `listMomentsQuerySchema` / `feedQuerySchema` 字段名未在本计划改写。
