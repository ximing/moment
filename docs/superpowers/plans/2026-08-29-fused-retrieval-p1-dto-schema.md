# 融合检索 P1：dto query/search/jobs + schema 八列 + getObject + processor last_error 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的跨端契约与数据/存储/outbox 基座：`@moment/dto` 新建 search/jobs 域、扩展 feed/链列表 GET query 与 `MomentMedia.derivedUrl`/`posterDerivedUrl`；server 给 `media` 加派生六列、`moments.embed_hash`、`outbox.last_error`，追加 `moment.compress`/`moment.embed` 类型常量；存储适配器追加有界 `getObject`；processor 持久化 `last_error` 并对 `NonRetryableCompressError`/`NonRetryableEmbeddingError`（按 `error.name`）立即 `failed`。

**Architecture:** dto 包只放 schema 与纯类型（`packages/dto/CLAUDE.md`），单文件布局（test glob 只匹配 `src/*.test.ts`）。server 表定义在 `src/db/schema/`，经 barrel 导出；迁移由 `drizzle-kit generate` 从 snapshot 差分生成（禁手写 SQL）。`getObject` 是 CONVENTIONS §3.3 的**追加**方法，实现按行上 `storageMeta` 选桶/prefix（与 `generateAccessUrl` 同），流式读取并在 `maxBytes` 处中止。processor 仍是 outbox 状态机唯一写手：handler **不得**自改 `outbox.status`。本计划不接 GET 过滤行为、不写 compress/embed handler、不连 Lance、不加 embedding 环境变量。CONVENTIONS §3 的允许追加（`getObject`、`last_error`、融合检索路由总表）由 Task 8 一次性写入；不改 ChainPolicy / feed `{h,i}` / 媒体稳定入口句。

**Tech Stack:** zod ^3.22（勿用 v4 API）/ tsx --test（node:test）/ drizzle-orm 0.45 mysql-core / drizzle-kit 0.31 / jest `--runInBand` + 真实 MySQL 测试库 / AWS SDK `GetObjectCommand` + Node async iterable 有界读。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§2.1 media 派生列与 MomentMedia、§2.2 `embed_hash`、§2.3 outbox 常量/`last_error`/processor、§2.4 `getObject`、§2.6 迁移、§6.1 GET query、§6.2 search dto、§6.4 jobs dto、§11 P1 出口）

## Global Constraints

- 本计划冻结名逐字不得改（P2–P10 靠此对齐）：`searchInputSchema` / `SearchTime` / `SearchParsed` / `SearchResponse` / `SearchInput` / `INTENT_MAX_QUERY_CHARS` / `SEARCH_DEFAULT_LIMIT` / `SEARCH_MAX_LIMIT` / `ChainJobDto` / `ChainJobListResponse` / `MomentMedia.derivedUrl` / `MomentMedia.posterDerivedUrl` / `feedQuerySchema` 与 `listMomentsQuerySchema` 的 `person_id`/`place`/`happened_from`/`happened_to` / `media.derived_s3_key|derived_mime|derived_size|derived_width|derived_height|derived_status` / `moments.embed_hash` / `outbox.last_error` / `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED` / `getObject(key, metadata, maxBytes)` / processor 对 `error.name === 'NonRetryableCompressError' | 'NonRetryableEmbeddingError'` 立即 failed。
- CONVENTIONS §3 **只追加不改语义**：不改 `ChainPolicy` / `requireChainRole`；不改 feed `{h,i}`/`{c,i}` 游标；媒体稳定入口仍是 `/api/media/:id`（`?variant=derived` 的路由行为属 P3）；既有存储方法名零改动；既有 outbox 列不改名。允许的追加（`getObject`、`last_error`、§3.6 融合检索行）**只**在 Task 8 写入；P2–P10 禁止再改 `CONVENTIONS.md`。
- P1 **不**加 `DASHSCOPE_*` / `MULTIMODAL_*` / `LANCEDB_PATH` / `BA_AUTH_TOKEN` / `INTERNAL_API_BASE_URL`（P4/P5）。不改 `apps/server/.env`。
- 立即失败集合**仅**上述两个 `error.name`。`NonRetryableLLMError` 仍走 5 档退避（extract/recap 语义不动）。handler 实现与 class 本体属 P3/P5；本计划只让 processor 认 name。
- 无新表：`resetDb()` 删除顺序不变（只给既有表加可空列）。
- dto 测试 glob 是 `src/*.test.ts`（只匹配顶层）——search/jobs 必须是 `packages/dto/src/search.ts` + `jobs.ts` 及同目录 `*.test.ts`。
- server 测试打 `.env` 指向的测试库：`pnpm --filter @moment/server test -- <file>`（`package.json` 的 `test` 脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)`。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤**（与部分 people-place 旧 prompt「SubAgent 跳过 commit」不同）。

**Spec 引用与偏差（逐条注明）：**

1. **`MomentMedia.derivedUrl` / `posterDerivedUrl` 在 P1 声明为可选（`?: string | null`），必填化随 P3 serializer 一并收紧**：spec §2.1 要字段存在，但 `momentSerializer()` 与 web/app 的 `MomentMedia` 字面量在 P1 不产出这两键——必填会让 server typecheck 与 `apps/web/src/media/MediaBlock.test.tsx` 等立即红。P1 不实现 `/api/media/:id?variant=derived`（P3）。运行时无派生时语义就是 null；P3 按 `derived_status==='ready'` 填稳定入口后把字段改为必填 `string | null`。
2. **`isoDatetime` 从 `packages/dto/src/feed.ts` 导出**（spec §6.1）。`feed.ts` 对 `moments.ts` 只 `import type`，无运行时环；`search.ts` 与 `listMomentsQuerySchema` 直接 `import { isoDatetime } from './feed.js'`。`listMomentsQuerySchema` 既有 `before` **仍用** `isoTimestampSchema`（spec 字面：不改既有松紧）。
3. **`FeedQuery.personId|place|happenedFrom|happenedTo` 是 api-client 映射，属 P8**：本计划只在 dto 钉 GET snake_case。`packages/api-client/src/client.ts` 的 `FeedQuery` / `listChainMoments` query **本计划不改**。dto 注释写明 camelCase 对应，供 P8 逐字抄。
4. **GET `/api/feed` 在 P1 就会吃到新 query 校验，但过滤不生效**：`FeedController` 已 `feedQuerySchema.parse(req.query)`。非法 `person_id` / `happened_from>happened_to` / `order=created_at`+区间会 400；合法新字段被 parse 后 **service 丢弃**（`feed.service` 仍只取 cursor/chainIds/tagId/order/limit/before）。过滤进 `queryMomentPage` 属 P2。链列表 GET 仍 `parse({ cursor, limit, before })`，新字段要到 P2 才 `parse(req.query)`。RANGE 的 **API 测试**属 P2；P1 只做 dto schema 测试。
5. **processor 对立即失败仍 `attempts += 1`**：spec「不占 5 档退避」钉死为：不写 `next_retry_at`、不走 `RETRY_DELAYS_MS`、直接 `status=failed`。这次执行仍计入 `attempts`（jobs 能看到试过一次）。未注册 type 的 `last_error='NO_HANDLER'`（精确字符串）。
6. **`getObject` 超限抛 `ObjectTooLargeError`（`error.name === 'ObjectTooLargeError'`，`message === 'OBJECT_TOO_LARGE'`）**：spec §2.4 只说「超 maxBytes 抛错」未给类名。P3 compress 把该类（或任意超限错误）包装成 `NonRetryableCompressError`。有界读抽到 `apps/server/src/storage/bounded-read.ts`，便于不打真桶测流式上限。
7. **`SEARCH_DEFAULT_LIMIT=20` / `SEARCH_MAX_LIMIT=50` 放在 `packages/dto/src/search.ts`**：spec §5 未指定文件；`searchInputSchema.limit` 已是 `max(50).optional()`（缺省不在 zod，由 P6 handler 用常量补 20）。P6 从 dto import，不在 server 再抄一份。
8. **P1 不创建 `NonRetryableCompressError` / `NonRetryableEmbeddingError` class**：processor 只认 `error.name`。class 本体随 P3/P5 handler 落地。本计划测试用 `const e = new Error('...'); e.name = 'NonRetryableCompressError'`。
9. **CONVENTIONS §3 的允许追加集中在 Task 8**（spec-review：只追加 `getObject`、`last_error`、新路由）。T3/T6 只改代码。§3.6 把 P3–P7 才落地的 path / query 预先登记，避免撞车；P2–P10 禁止再改该文件。

## File map

| 路径 | 职责 |
|---|---|
| `packages/dto/src/search.ts` | `searchInputSchema` + `SearchTime`/`SearchParsed`/`SearchResponse`/`SearchInput` + 上限常量 |
| `packages/dto/src/jobs.ts` | `ChainJobDto` / `ChainJobListResponse` |
| `packages/dto/src/feed.ts` | 导出 `isoDatetime`/`uuidLoose`；GET feed 新 snake_case 字段 + RANGE/from>to superRefine |
| `packages/dto/src/moments.ts` | `MomentMedia` 两可选 URL；`listMomentsQuerySchema` 新字段 |
| `packages/dto/src/index.ts` | barrel 两行 |
| `apps/server/src/db/schema/media.ts` | 派生六列 |
| `apps/server/src/db/schema/moments.ts` | `embedHash` |
| `apps/server/src/db/schema/outbox.ts` | `lastError` |
| `apps/server/src/outbox/types.ts` | `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED` + payload 类型 + `OutboxType` |
| `apps/server/drizzle/0017_*` | drizzle-kit generate（八列，全可空） |
| `apps/server/src/storage/bounded-read.ts` | `readBodyWithLimit` / `abortS3Body` / `ObjectTooLargeError` |
| `apps/server/src/storage/base.adapter.ts` | 接口追加 `getObject` |
| `apps/server/src/storage/s3.adapter.ts` | GetObject + 有界读；按 metadata 选桶/prefix |
| `apps/server/tests/helpers/storage.ts` | mock 补 `getObject` |
| `apps/server/src/worker/processor.ts` | 写 `last_error`；两 name 立即 failed |
| `docs/superpowers/plans/CONVENTIONS.md` | Task 8：§3.2 `last_error`、§3.3 `getObject`、§3.6 融合检索行 |
| `apps/server/tests/conventions-fused-retrieval.test.ts` | 锁上述追加；ChainPolicy / `{h,i}` 句未改 |

**本计划明确不改：** `chain-policy.ts`、feed cursor、`momentSerializer`（P3）、`queryMomentPage`（P2）、handlers 注册表（P3/P5）、`config.ts` / `.env.example`、api-client、web/app。CONVENTIONS.md **只**允许 Task 8 追加，禁止改 §3.1 ChainPolicy 签名与 §3.4 游标/`/api/media/:id` 稳定入口句。

---

### Task 1: dto search 域 + jobs 域 + 导出 `isoDatetime`

**Files:**
- Create: `packages/dto/src/search.ts`
- Create: `packages/dto/src/search.test.ts`
- Create: `packages/dto/src/jobs.ts`
- Create: `packages/dto/src/jobs.test.ts`
- Modify: `packages/dto/src/feed.ts:6-10`（`const isoDatetime` → `export const isoDatetime`）
- Modify: `packages/dto/src/index.ts`（barrel 加两行）

**Interfaces:**
- Consumes:
  - `isoDatetime`（现 `packages/dto/src/feed.ts` 未导出的 local schema；本 Task 改为 export；正则与 refine message `INVALID_TIMESTAMP` 一字不改）
  - `MomentResponse`（`./moments.js`，仅 type）
  - zod ^3.22
- Produces:
  - `INTENT_MAX_QUERY_CHARS`（`500`）
  - `SEARCH_DEFAULT_LIMIT`（`20`）
  - `SEARCH_MAX_LIMIT`（`50`）
  - `searchInputSchema` / `type SearchInput = z.infer<typeof searchInputSchema>`
  - `type SearchTime = { kind: 'range'; from: string; to: string } | { kind: 'wall_date'; year: number; month: number; day: number }`
  - `interface SearchParsed { personNames: string[]; place: string | null; time: SearchTime | null; text: string }`
  - `interface SearchResponse { moments: MomentResponse[]; nextCursor: string | null; parsed: SearchParsed }`
  - `interface ChainJobDto { id: string; type: 'moment.compress' \| 'moment.embed'; status: 'pending' \| 'done' \| 'failed'; momentId: string; mediaId: string \| null; attempts: number; lastError: string \| null; createdAt: string; processedAt: string \| null }`
  - `interface ChainJobListResponse { jobs: ChainJobDto[] }`
  - `isoDatetime` 从 `feed.ts` 导出（search `happenedFrom`/`happenedTo` 复用）

- [ ] **Step 1: 写失败测试**

Create `packages/dto/src/search.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDatetime } from './feed.js';
import {
  INTENT_MAX_QUERY_CHARS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  searchInputSchema,
  type SearchInput,
  type SearchParsed,
  type SearchResponse,
  type SearchTime,
} from './search.js';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

const base = {
  q: '去年今天和外婆',
  tzOffset: -480,
};

test('INTENT / SEARCH 上限常量锁定（spec §3.1 / §5）', () => {
  assert.equal(INTENT_MAX_QUERY_CHARS, 500);
  assert.equal(SEARCH_DEFAULT_LIMIT, 20);
  assert.equal(SEARCH_MAX_LIMIT, 50);
});

test('searchInputSchema：最小合法 body（q+tzOffset）', () => {
  const r = searchInputSchema.parse(base);
  assert.equal(r.q, '去年今天和外婆');
  assert.equal(r.tzOffset, -480);
  assert.equal(r.limit, undefined);
  assert.equal(r.cursor, undefined);
  assert.equal(r.chainIds, undefined);
});

test('searchInputSchema：q trim + 空串拒绝 + 上限 500', () => {
  assert.equal(searchInputSchema.parse({ ...base, q: '  外婆  ' }).q, '外婆');
  assert.ok(!searchInputSchema.safeParse({ ...base, q: '   ' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, q: '' }).success);
  assert.ok(searchInputSchema.safeParse({ ...base, q: 'x'.repeat(500) }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, q: 'x'.repeat(501) }).success);
});

test('searchInputSchema：缺 tzOffset 拒绝；范围 -840..840 整数', () => {
  assert.ok(!searchInputSchema.safeParse({ q: '外婆' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: -841 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: 841 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: -480.5 }).success);
  assert.equal(searchInputSchema.parse({ ...base, tzOffset: 840 }).tzOffset, 840);
});

test('searchInputSchema：可选 uuid 字段；limit 1..50', () => {
  const r = searchInputSchema.parse({
    ...base,
    chainIds: [UUID_A],
    personId: UUID_A,
    tagId: UUID_B,
    place: '朝阳公园',
    cursor: 'abc',
    limit: 50,
  });
  assert.deepEqual(r.chainIds, [UUID_A]);
  assert.equal(r.limit, 50);
  assert.ok(!searchInputSchema.safeParse({ ...base, personId: 'nope' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, limit: 0 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, limit: 51 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, cursor: '' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, cursor: 'x'.repeat(1025) }).success);
});

test('searchInputSchema：place trim 1..255', () => {
  assert.equal(searchInputSchema.parse({ ...base, place: '  朝阳公园  ' }).place, '朝阳公园');
  assert.ok(!searchInputSchema.safeParse({ ...base, place: '' }).success);
  assert.ok(searchInputSchema.safeParse({ ...base, place: 'x'.repeat(255) }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, place: 'x'.repeat(256) }).success);
});

test('searchInputSchema：happenedFrom/To 复用 isoDatetime；from>to 用 Date.parse（禁止字符串 >）', () => {
  const ok = searchInputSchema.parse({
    ...base,
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(ok.happenedFrom, '2026-08-01T00:00:00.000Z');
  assert.ok(!searchInputSchema.safeParse({ ...base, happenedFrom: '2026/08/01' }).success);
  assert.ok(!isoDatetime.safeParse('2026/08/01').success);

  // 字典序 from > to，但带偏移后 Date.parse(from) < Date.parse(to) → 合法（spec §6.1 陷阱）
  const offsetOk = searchInputSchema.safeParse({
    ...base,
    happenedFrom: '2026-08-01T00:00:00+08:00', // UTC 7/31 16:00
    happenedTo: '2026-07-31T23:00:00Z',
  });
  assert.ok(offsetOk.success);

  const bad = searchInputSchema.safeParse({
    ...base,
    happenedFrom: '2026-08-02T00:00:00.000Z',
    happenedTo: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happenedTo'));
  }
});

test('SearchTime / SearchParsed / SearchResponse 类型可赋值', () => {
  const range: SearchTime = { kind: 'range', from: '2026-06-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' };
  const wall: SearchTime = { kind: 'wall_date', year: 2025, month: 8, day: 29 };
  const parsed: SearchParsed = { personNames: ['外婆'], place: '朝阳公园', time: wall, text: '野餐' };
  const empty: SearchParsed = { personNames: [], place: null, time: null, text: '去年今天和外婆' };
  assert.equal(range.kind, 'range');
  assert.equal(parsed.time?.kind, 'wall_date');
  assert.equal(empty.place, null);

  const input: SearchInput = { q: '外婆', tzOffset: -480 };
  assert.equal(input.q, '外婆');

  const res: SearchResponse = { moments: [], nextCursor: null, parsed: empty };
  assert.equal(res.nextCursor, null);
});
```

Create `packages/dto/src/jobs.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
// 副作用 import：tsx 会擦除 `import type`，没有这一行 jobs.ts 缺席时本文件不会红
import './jobs.js';
import type { ChainJobDto, ChainJobListResponse } from './jobs.js';

test('ChainJobDto / ChainJobListResponse 类型可赋值（spec §6.4）', () => {
  const compress: ChainJobDto = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    type: 'moment.compress',
    status: 'pending',
    momentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    mediaId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    attempts: 1,
    lastError: 'OBJECT_TOO_LARGE',
    createdAt: '2026-08-29T00:00:00.000Z',
    processedAt: null,
  };
  const embed: ChainJobDto = {
    ...compress,
    type: 'moment.embed',
    status: 'failed',
    mediaId: null,
    lastError: null,
    processedAt: '2026-08-29T00:01:00.000Z',
  };
  const done: ChainJobDto = { ...embed, status: 'done' };
  const list: ChainJobListResponse = { jobs: [compress, embed, done] };
  assert.equal(list.jobs.length, 3);
  assert.equal(list.jobs[0].type, 'moment.compress');
  assert.equal(list.jobs[1].mediaId, null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`Cannot find module './search.js'` 和/或 `Cannot find module './jobs.js'`。

- [ ] **Step 3: 导出 `isoDatetime`**

Modify `packages/dto/src/feed.ts`：把第 7 行 `const isoDatetime` 改为 `export const isoDatetime`（正则、refine、注释一字不改）。

- [ ] **Step 4: 实现 `search.ts`**

Create `packages/dto/src/search.ts`：
```ts
import { z } from 'zod';
import { isoDatetime } from './feed.js';
import type { MomentResponse } from './moments.js';

/** POST /api/search 的 q 上限（spec §3.1）；超长 400 VALIDATION_ERROR。路由/handler 属 P6。 */
export const INTENT_MAX_QUERY_CHARS = 500;
/** spec §5：limit 缺省 20（zod 不补默认，P6 handler 用本常量） */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export type SearchTime =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'wall_date'; year: number; month: number; day: number };

export interface SearchParsed {
  personNames: string[];
  place: string | null;
  time: SearchTime | null;
  text: string;
}

export interface SearchResponse {
  moments: MomentResponse[];
  nextCursor: string | null;
  parsed: SearchParsed;
}

/**
 * POST /api/search body（spec §6.2）。camelCase。
 * 无 before / order / source。tzOffset 必填。
 * personId/tagId/chainIds 用 z.string().uuid()（严于 GET chip 的 uuidLoose）。
 */
export const searchInputSchema = z
  .object({
    q: z.string().trim().min(1).max(INTENT_MAX_QUERY_CHARS),
    chainIds: z.array(z.string().uuid()).optional(),
    tzOffset: z.number().int().min(-840).max(840),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    personId: z.string().uuid().optional(),
    tagId: z.string().uuid().optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happenedFrom: isoDatetime.optional(),
    happenedTo: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.happenedFrom && val.happenedTo && Date.parse(val.happenedFrom) > Date.parse(val.happenedTo)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happenedTo'] });
    }
  });
export type SearchInput = z.infer<typeof searchInputSchema>;
```

- [ ] **Step 5: 实现 `jobs.ts`**

Create `packages/dto/src/jobs.ts`：
```ts
/**
 * GET /api/chains/:chainId/jobs 响应（spec §6.4）。路由/handler 属 P7。
 * type 仅投影 moment.compress / moment.embed；mediaId：compress 取 payload.mediaId，embed 恒 null。
 */
export interface ChainJobDto {
  id: string;
  type: 'moment.compress' | 'moment.embed';
  status: 'pending' | 'done' | 'failed';
  momentId: string;
  mediaId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ChainJobListResponse {
  jobs: ChainJobDto[];
}
```

- [ ] **Step 6: 接 barrel**

Modify `packages/dto/src/index.ts` — 在 `export * from './persons.js';` 之后追加：
```ts
export * from './search.js';
export * from './jobs.js';
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS（search.test + jobs.test 全过；feed/moments 既有测试无回归）。

- [ ] **Step 8: 构建确认**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。

- [ ] **Step 9: Commit**

```bash
git add packages/dto/src/search.ts packages/dto/src/search.test.ts packages/dto/src/jobs.ts packages/dto/src/jobs.test.ts packages/dto/src/feed.ts packages/dto/src/index.ts
git commit -m "feat(dto): add search and jobs contracts and export isoDatetime"
```

---

### Task 2: dto GET query 新字段 + MomentMedia 派生 URL 类型

**Files:**
- Modify: `packages/dto/src/feed.ts:4`（`uuidLoose` 改为 export）与 `19-37`（feedQuerySchema 字段 + superRefine）
- Modify: `packages/dto/src/moments.ts`（MomentMedia 两字段；listMomentsQuerySchema；从 feed 引入 `isoDatetime`/`uuidLoose`）
- Test: `packages/dto/src/feed.test.ts`（追加）
- Test: `packages/dto/src/moments.test.ts`（追加）

**Interfaces:**
- Consumes:
  - `isoDatetime`（Task 1 已 export）
  - 既有 `uuidLoose` local regex（本 Task 改为 `export const uuidLoose`）
  - 既有 `feedQuerySchema` / `listMomentsQuerySchema` / `MomentMedia` / `monthIndexQuerySchema`
- Produces:
  - `uuidLoose` 从 `feed.ts` 导出
  - `feedQuerySchema` 增加 `person_id` / `place` / `happened_from` / `happened_to`（HTTP snake_case）
  - `feedQuerySchema` superRefine：`Date.parse(happened_from) > Date.parse(happened_to)` → message `VALIDATION_ERROR` path `happened_to`；`(happened_from|happened_to) + order=created_at` → `RANGE_REQUIRES_HAPPENED_AT`；既有 `BEFORE_REQUIRES_HAPPENED_AT` 不改名
  - `listMomentsQuerySchema` 增加同样四字段；`happened_*` 用 `isoDatetime`；`before` 仍 `isoTimestampSchema`；`limit` 仍 `z.string().optional()`；from>to 同样 `VALIDATION_ERROR`；**无** `RANGE_REQUIRES_HAPPENED_AT`（链列表恒 happened_at）
  - `monthIndexQuerySchema` **不加**这些字段
  - `MomentMedia.derivedUrl?: string | null`、`MomentMedia.posterDerivedUrl?: string | null`（偏差 1）
  - 注释钉死 P8 `FeedQuery` 映射：`personId←person_id`、`place←place`、`happenedFrom←happened_from`、`happenedTo←happened_to`

- [ ] **Step 1: 写失败测试**

Modify `packages/dto/src/feed.test.ts` — 文件头 import 改为：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedQuerySchema, monthIndexQuerySchema } from './feed.js';
```

文件末尾追加：
```ts
const UUID_A = '00000000-0000-4000-8000-000000000001';

test('feedQuerySchema：person_id 与 tag_id 同一 uuidLoose（非更严 z.uuid）', () => {
  assert.equal(feedQuerySchema.parse({ person_id: UUID_A }).person_id, UUID_A);
  assert.throws(() => feedQuerySchema.parse({ person_id: 'nope' }));
  // 全默认仍无新字段
  const q = feedQuerySchema.parse({});
  assert.equal(q.person_id, undefined);
  assert.equal(q.place, undefined);
  assert.equal(q.happened_from, undefined);
  assert.equal(q.happened_to, undefined);
});

test('feedQuerySchema：place trim 1..255', () => {
  assert.equal(feedQuerySchema.parse({ place: '  朝阳公园  ' }).place, '朝阳公园');
  assert.throws(() => feedQuerySchema.parse({ place: '' }));
  assert.throws(() => feedQuerySchema.parse({ place: 'x'.repeat(256) }));
});

test('feedQuerySchema：happened_from/to 用 isoDatetime，拒绝 2026/08/01', () => {
  const q = feedQuerySchema.parse({
    happened_from: '2026-08-01T00:00:00.000Z',
    happened_to: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(q.happened_from, '2026-08-01T00:00:00.000Z');
  assert.throws(() => feedQuerySchema.parse({ happened_from: '2026/08/01' }));
});

test('feedQuerySchema：happened_from > happened_to 用 Date.parse，带偏移不靠字典序', () => {
  // 字典序 from > to，瞬时 from < to → 合法
  const ok = feedQuerySchema.safeParse({
    happened_from: '2026-08-01T00:00:00+08:00',
    happened_to: '2026-07-31T23:00:00Z',
  });
  assert.ok(ok.success);

  const bad = feedQuerySchema.safeParse({
    happened_from: '2026-08-02T00:00:00.000Z',
    happened_to: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happened_to'));
  }
});

test('feedQuerySchema：区间 + order=created_at → RANGE_REQUIRES_HAPPENED_AT；before 仍 BEFORE_REQUIRES_HAPPENED_AT', () => {
  const range = feedQuerySchema.safeParse({
    happened_from: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!range.success);
  if (!range.success) {
    assert.ok(range.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
  const onlyTo = feedQuerySchema.safeParse({
    happened_to: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!onlyTo.success);

  const before = feedQuerySchema.safeParse({
    before: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!before.success);
  if (!before.success) {
    assert.ok(before.error.issues.some((i) => i.message === 'BEFORE_REQUIRES_HAPPENED_AT'));
    assert.ok(!before.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
});

test('monthIndexQuerySchema 不加 person_id/place/happened_*（spec §6.1）', () => {
  const q = monthIndexQuerySchema.parse({
    tz_offset: '0',
    person_id: UUID_A,
    place: '朝阳公园',
    happened_from: '2026-08-01T00:00:00.000Z',
  });
  assert.equal((q as { person_id?: string }).person_id, undefined);
  assert.equal((q as { place?: string }).place, undefined);
  assert.equal((q as { happened_from?: string }).happened_from, undefined);
});
```

Modify `packages/dto/src/moments.test.ts` — 文件末尾追加：
```ts
test('listMomentsQuerySchema：person_id/place/happened_from/to；before 松紧不变；limit 仍是 string', () => {
  const q = listMomentsQuerySchema.parse({
    person_id: UUID_A,
    place: '朝阳公园',
    happened_from: '2026-08-01T00:00:00.000Z',
    happened_to: '2026-08-31T23:59:59.999Z',
    cursor: 'abc',
    limit: '50',
  });
  assert.equal(q.person_id, UUID_A);
  assert.equal(q.place, '朝阳公园');
  assert.equal(q.limit, '50');
  assert.ok(!listMomentsQuerySchema.safeParse({ person_id: 'nope' }).success);
  assert.ok(!listMomentsQuerySchema.safeParse({ happened_from: '2026/08/01' }).success);
  // 既有 before 仍走 isoTimestampSchema：Date.parse 宽松串继续合法（isoDatetime 会拒 2026/08/01）
  assert.ok(listMomentsQuerySchema.safeParse({ before: '2026/08/01' }).success);
});

test('listMomentsQuerySchema：from>to → VALIDATION_ERROR；无 RANGE_REQUIRES_HAPPENED_AT（无 order 字段）', () => {
  const bad = listMomentsQuerySchema.safeParse({
    happened_from: '2026-08-02T00:00:00.000Z',
    happened_to: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR'));
    assert.ok(!bad.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
});

test('MomentMedia：derivedUrl / posterDerivedUrl 可赋值；P1 可省略（偏差 1）', () => {
  const ready: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'image/jpeg',
    width: 64,
    height: 48,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: `/api/media/${UUID_A}?variant=derived`,
    posterDerivedUrl: null,
  };
  assert.equal(ready.derivedUrl, `/api/media/${UUID_A}?variant=derived`);

  const video: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 12,
    sortOrder: 0,
    posterMediaId: UUID_B,
    posterUrl: `/api/media/${UUID_B}`,
    derivedUrl: null,
    posterDerivedUrl: `/api/media/${UUID_B}?variant=derived`,
  };
  assert.equal(video.posterDerivedUrl, `/api/media/${UUID_B}?variant=derived`);

  // P1 可选：既有字面量不带这两键必须仍是合法 MomentMedia。
  // dto `tsconfig.json` exclude `*.test.ts`，tsx 也不做类型检查——可选性由实现 `?:` 与本 Task Step 6 的 server typecheck 把关（serializer 媒体字面量缺这两键）。
  const legacy: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'image/jpeg',
    width: 64,
    height: 48,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
  };
  assert.equal(legacy.derivedUrl, undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL。schema 用例因未知键被 strip 后缺 `person_id` 断言失败，和/或 `RANGE_REQUIRES_HAPPENED_AT` 不出现。`derivedUrl` 运行时断言 `legacy.derivedUrl === undefined` 在实现前也成立——**红灯以 feed/list schema 用例为准**。若只有类型用例不红（tsx 不检查），以 `feedQuerySchema.parse({ person_id: UUID_A }).person_id` 为 `undefined` 作为红灯。

- [ ] **Step 3: 实现 feed.ts 增量**

Modify `packages/dto/src/feed.ts`：

把 `const uuidLoose = ...` 改为：
```ts
/** GET query 与 tag_id 同一宽松 uuid（spec §6.1：不要用更严的 z.string().uuid()） */
export const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

把 `feedQuerySchema` 的 object 在 `before: isoDatetime.optional(),` 之后、`})` 之前追加（并更新 superRefine）：
```ts
    /**
     * HTTP query snake_case（spec §6.1）。api-client FeedQuery（P8）camelCase 映射：
     * personId ← person_id；place ← place；happenedFrom ← happened_from；happenedTo ← happened_to。
     * 过滤进 queryMomentPage 属 P2；本 schema 只做校验。
     */
    person_id: z.string().regex(uuidLoose).optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happened_from: isoDatetime.optional(),
    happened_to: isoDatetime.optional(),
```

`superRefine` 整段替换为：
```ts
  .superRefine((val, ctx) => {
    if (val.before !== undefined && val.order === 'created_at') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BEFORE_REQUIRES_HAPPENED_AT', path: ['before'] });
    }
    if ((val.happened_from !== undefined || val.happened_to !== undefined) && val.order === 'created_at') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RANGE_REQUIRES_HAPPENED_AT',
        path: ['happened_from'],
      });
    }
    if (
      val.happened_from !== undefined &&
      val.happened_to !== undefined &&
      Date.parse(val.happened_from) > Date.parse(val.happened_to)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happened_to'] });
    }
  });
```

- [ ] **Step 4: 实现 moments.ts 增量**

Modify `packages/dto/src/moments.ts` 文件头 import 区，在 persons 那行之后追加：
```ts
import { isoDatetime, uuidLoose } from './feed.js';
```

`MomentMedia` 接口在 `posterUrl: string | null;` 之后追加：
```ts
  /**
   * 派生图稳定入口 `/api/media/:id?variant=derived`；仅 derived_status=ready 非空（spec §2.1）。
   * P1 可选：serializer 在 P3 才产出（见计划偏差 1）。不内嵌预签名（CONVENTIONS §3.4）。
   */
  derivedUrl?: string | null;
  /**
   * 视频封面派生入口 `/api/media/:posterId?variant=derived`；仅视频行且封面 ready 非空，否则 null。
   * 图片行恒 null。P1 可选（偏差 1），P3 必填化。
   */
  posterDerivedUrl?: string | null;
```

`listMomentsQuerySchema` 整段替换为：
```ts
/** 链内列表 query：cursor 空串/超长走 VALIDATION_ERROR；limit 仍由 service 解析为 INVALID_LIMIT。 */
export const listMomentsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.string().optional(),
    /** 日期锚定（spec §4.2）：happened_at < before；链内列表恒 happened_at 语义，天然可用 */
    before: isoTimestampSchema.optional(),
    person_id: z.string().regex(uuidLoose).optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happened_from: isoDatetime.optional(),
    happened_to: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.happened_from !== undefined &&
      val.happened_to !== undefined &&
      Date.parse(val.happened_from) > Date.parse(val.happened_to)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happened_to'] });
    }
  });
export type ListMomentsQuery = z.infer<typeof listMomentsQuerySchema>;
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，既有 + 本 Task 新增用例全过。

- [ ] **Step 6: 构建 + lint + server typecheck（锁偏差 1：字段必须可选）**

Run:
```bash
pnpm --filter @moment/dto build && pnpm --filter @moment/dto lint
pnpm --filter @moment/server typecheck
```
Expected: 全部 exit 0。若把 `derivedUrl`/`posterDerivedUrl` 写成必填，server typecheck 会在 `moment-serializer.ts` 的 media 字面量上报缺属性（dto 自己的 `build` 不编 `*.test.ts`，拦不住）。

- [ ] **Step 7: Commit**

```bash
git add packages/dto/src/feed.ts packages/dto/src/feed.test.ts packages/dto/src/moments.ts packages/dto/src/moments.test.ts
git commit -m "feat(dto): add feed/list scalar query fields and derived media URLs"
```

---

### Task 3: server schema 八列 + outbox 两常量

**Files:**
- Modify: `apps/server/src/db/schema/media.ts`（派生六列，钉在 `uploadId` 之前）
- Modify: `apps/server/src/db/schema/moments.ts`（`embedHash`，钉在 `aiExtractHash` 之后、`createdAt` 之前）
- Modify: `apps/server/src/db/schema/outbox.ts`（`lastError`，钉在 `processedAt` 之前）
- Modify: `apps/server/src/outbox/types.ts`（两常量 + payload 类型 + `OutboxType`）
- Test: `apps/server/tests/outbox/outbox.test.ts`（追加常量断言）

**Interfaces:**
- Consumes:
  - drizzle-orm mysql-core 既有 import：`media.ts` 已有 `bigint, char, int, mysqlEnum, varchar`；`moments.ts` 已有 `char`；`outbox.ts` 已有 `varchar`
  - 既有 `OutboxType` 联合（只追加，不改旧成员）
- Produces:
  - `Media` 增加：`derivedS3Key: string | null`、`derivedMime: string | null`、`derivedSize: number | null`、`derivedWidth: number | null`、`derivedHeight: number | null`、`derivedStatus: 'pending' | 'ready' | 'skipped' | 'failed' | null`
  - `Moment` 增加：`embedHash: string | null`
  - `OutboxRow` 增加：`lastError: string | null`
  - `OUTBOX_MOMENT_COMPRESS = 'moment.compress'`
  - `OUTBOX_MOMENT_EMBED = 'moment.embed'`
  - `interface MomentCompressPayload { momentId: string; chainId: string; mediaId: string }`
  - `interface MomentEmbedPayload { momentId: string; chainId: string }`
  - `OutboxType` 含上述两常量
  - **不加索引**（spec §2.7）

- [ ] **Step 1: 写失败测试**

Modify `apps/server/tests/outbox/outbox.test.ts` — 文件顶 import 改为（新常量从 `types.js` 引，与 geocode/extract 一致；**不**让 `outbox.ts` re-export）：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import {
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_DELETED,
  emitOutbox,
} from '../../src/outbox/outbox.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { closeDb, resetDb } from '../helpers/db.js';
```

在 `emitOutbox` describe 之后追加：
```ts
describe('outbox 类型常量（fused-retrieval spec §2.3）', () => {
  it('COMPRESS / EMBED 字符串与 payload 形状锁定', async () => {
    expect(OUTBOX_MOMENT_COMPRESS).toBe('moment.compress');
    expect(OUTBOX_MOMENT_EMBED).toBe('moment.embed');

    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, {
        momentId: 'm-1',
        chainId: 'c-1',
        mediaId: 'media-1',
      });
      await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId: 'm-1', chainId: 'c-1' });
    });
    const rows = await db.select().from(outbox);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(['moment.compress', 'moment.embed']);
    const compress = rows.find((r) => r.type === 'moment.compress');
    expect(compress?.payload).toEqual({ momentId: 'm-1', chainId: 'c-1', mediaId: 'media-1' });
    const embed = rows.find((r) => r.type === 'moment.embed');
    expect(embed?.payload).toEqual({ momentId: 'm-1', chainId: 'c-1' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/outbox/outbox.test.ts`
Expected: FAIL，`OUTBOX_MOMENT_COMPRESS` 不是 `types.js` 的 export（TS/jest 编译或运行错误）。

- [ ] **Step 3: 实现 types.ts**

Modify `apps/server/src/outbox/types.ts` — 在 `OUTBOX_MOMENT_EXTRACT` 之后、`export type OutboxType` 之前追加：
```ts
/** 派生图压缩（spec fused-retrieval §2.3）：payload camelCase { momentId, chainId, mediaId }；handler 属 P3 */
export const OUTBOX_MOMENT_COMPRESS = 'moment.compress';
export interface MomentCompressPayload {
  momentId: string;
  chainId: string;
  mediaId: string;
}

/** 向量嵌入（spec fused-retrieval §2.3）：payload camelCase { momentId, chainId }；handler 属 P5 */
export const OUTBOX_MOMENT_EMBED = 'moment.embed';
export interface MomentEmbedPayload {
  momentId: string;
  chainId: string;
}
```

`OutboxType` 联合追加 `| typeof OUTBOX_MOMENT_COMPRESS | typeof OUTBOX_MOMENT_EMBED`。

- [ ] **Step 4: 运行确认通过（仅常量 + emit；schema 尚未加列）**

Run: `pnpm --filter @moment/server test -- tests/outbox/outbox.test.ts`
Expected: PASS。此时 drizzle SELECT 还不含 `last_error`，与现网表结构一致。

- [ ] **Step 5: media 六列**

Modify `apps/server/src/db/schema/media.ts` — 在 `uploadId: varchar('upload_id', { length: 128 }),` **之前**插入：
```ts
    /**
     * 派生 WebP（spec fused-retrieval §2.1）：相对 key chains/{chainId}/{momentId}/{mediaId}.derived.webp。
     * 非静态可压图（GIF/HEIC/HEIF/音视频）六列恒 NULL。本计划只加列，compress 属 P3。
     */
    derivedS3Key: varchar('derived_s3_key', { length: 512 }),
    derivedMime: varchar('derived_mime', { length: 100 }),
    derivedSize: bigint('derived_size', { mode: 'number' }),
    derivedWidth: int('derived_width'),
    derivedHeight: int('derived_height'),
    derivedStatus: mysqlEnum('derived_status', ['pending', 'ready', 'skipped', 'failed']),
```

- [ ] **Step 6: moments.embed_hash**

Modify `apps/server/src/db/schema/moments.ts` — 在 `aiExtractHash: char('ai_extract_hash', { length: 64 }),` 之后追加：
```ts
    /** 上次嵌入指纹 sha256(...)（spec fused-retrieval §2.2）；NULL = 从未嵌入。computeEmbedHash 属 P5 */
    embedHash: char('embed_hash', { length: 64 }),
```

- [ ] **Step 7: outbox.last_error**

Modify `apps/server/src/db/schema/outbox.ts` — 在 `processedAt` **之前**追加：
```ts
    /** 最近一次 handler 错误摘要（spec fused-retrieval §2.3）；仅 processor 写，handler 不得改 outbox.status */
    lastError: varchar('last_error', { length: 512 }),
```

- [ ] **Step 8: typecheck（不要再跑触库 jest）**

Run: `pnpm --filter @moment/server typecheck`
Expected: exit 0。

**禁止**在本 Step 跑 `outbox.test.ts` 或任何 `db.select().from(outbox|media|moments)` 的测试：schema 已含 `lastError` / 派生六列 / `embedHash`，但 Task 4 才 migrate。drizzle 会把新列编进 SELECT，MySQL 报 `Unknown column`。gold people-place P1 Task 3 同样只 typecheck、把触库放到 migrate 之后。全量 jest 也要等 Task 4。

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/db/schema/media.ts apps/server/src/db/schema/moments.ts apps/server/src/db/schema/outbox.ts apps/server/src/outbox/types.ts apps/server/tests/outbox/outbox.test.ts
git commit -m "feat(server): add derived media columns, embed_hash, last_error, compress/embed outbox types"
```

---

### Task 4: drizzle-kit generate 迁移 + 测试库应用

**Files:**
- Create: `apps/server/drizzle/0017_<随机名>.sql` + `apps/server/drizzle/meta/0017_snapshot.json`（`drizzle-kit generate` 生成；当前 journal 最后是 idx=16 / `0016_empty_cobalt_man`，下一档预期 0017，以实际生成为准）
- Modify: `apps/server/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: Task 3 schema；`apps/server/drizzle.config.ts`（schema `./src/db/schema.ts`，out `./drizzle`）
- Produces: 迁移 0017（八列全可空、无索引、无回填）；测试库已应用

- [ ] **Step 1: 生成迁移**

Run: `pnpm --filter @moment/server migrate:generate`
Expected: `New migration created`，生成 `apps/server/drizzle/0017_<随机名>.sql`、`meta/0017_snapshot.json`，`_journal.json` 追加 idx=17。**禁手写 SQL**。若 generate 报冲突或要求 rename，停手报告，不交互式抉择。

- [ ] **Step 2: 人工核对生成的 SQL（全部满足才进 Step 3）**

打开生成的 `0017_*.sql`，核对：

1. 有且仅有以下变更（**无 DROP、无对既有列 MODIFY、无重建 chk_chains_***）：
   - `ALTER TABLE media ADD` 六列，全部可空无默认：`derived_s3_key varchar(512)`、`derived_mime varchar(100)`、`derived_size bigint`、`derived_width int`、`derived_height int`、`derived_status enum('pending','ready','skipped','failed')`。
   - `ALTER TABLE moments ADD embed_hash char(64)` 可空。
   - `ALTER TABLE outbox ADD last_error varchar(512)` 可空。
2. **无** CREATE INDEX / 无存量 UPDATE。
3. 列顺序以 drizzle 输出为准，不手工重排。

任一条不满足：核对 Task 3 schema，修正后删掉本次 0017 文件与 journal 条目再 generate；**不手工编辑 SQL 补救**。

- [ ] **Step 3: 测试库应用**

Run: `pnpm --filter @moment/server migrate`
Expected: 应用 0017 成功（`.env` 测试库；严禁生产库）。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 4: 验证落库形态**

Run:
```bash
pnpm --filter @moment/server exec tsx -e "
import { pool } from './src/db/index.js';
const [mediaCols] = await pool.query(\"SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media' AND COLUMN_NAME LIKE 'derived_%' ORDER BY COLUMN_NAME\");
console.log('media', JSON.stringify(mediaCols, null, 2));
const [momentCols] = await pool.query(\"SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moments' AND COLUMN_NAME = 'embed_hash'\");
console.log('moments', JSON.stringify(momentCols, null, 2));
const [outboxCols] = await pool.query(\"SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox' AND COLUMN_NAME = 'last_error'\");
console.log('outbox', JSON.stringify(outboxCols, null, 2));
await pool.end();
"
```
Expected:
- media 六行，IS_NULLABLE=YES：`derived_height int`、`derived_mime varchar(100)`、`derived_s3_key varchar(512)`、`derived_size bigint`、`derived_status enum('pending','ready','skipped','failed')`、`derived_width int`
- moments：`embed_hash char(64) YES`
- outbox：`last_error varchar(512) YES`

- [ ] **Step 5: 触库回归（Task 3 的 outbox 常量测试现在 SELECT 含 last_error）**

Run: `pnpm --filter @moment/server test -- tests/outbox/outbox.test.ts`
Expected: PASS（jest globalSetup 也会再跑一次 migrate，已应用则 no-op）。`emitOutbox` 不写 `lastError`，默认 NULL。

- [ ] **Step 6: Commit**

```bash
git add apps/server/drizzle/0017_*.sql apps/server/drizzle/meta/0017_snapshot.json apps/server/drizzle/meta/_journal.json
git commit -m "feat(server): add migration for derived media, embed_hash, and outbox last_error"
```

---

### Task 5: 触库冒烟（八列默认 NULL + 可写回）

**Files:**
- Create: `apps/server/tests/db/fused-retrieval-schema.test.ts`
- 不改 `tests/helpers/db.ts`（无新表，resetDb 顺序不变，spec §2.6）

**Interfaces:**
- Consumes:
  - `media` / `moments` / `outbox`（`../../src/db/schema.js`）
  - `resetDb` / `closeDb`、`registerUser` / `createChain` / `insertMoment`
  - `currentStorageMeta` 不必须；直插 media 时手写 `storageMeta`
  - 迁移 0017 已应用（jest globalSetup migrate）
- Produces: 无新符号。证明八列默认 NULL、enum/hash/last_error 可写回。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/db/fused-retrieval-schema.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('fused-retrieval schema 冒烟（P1：八列，spec §2.1/§2.2/§2.3）', () => {
  it('media 派生六列与 moments.embed_hash、outbox.last_error 默认 NULL', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const mediaId = randomUUID();
    await db.insert(media).values({
      id: mediaId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
      mime: 'image/jpeg',
      size: 1024,
      status: 'ready',
      storageMeta: {
        bucket: 'moment-test-placeholder',
        prefix: 'test/attachments',
        region: 'us-east-1',
        isPublicBucket: 'false',
      },
    });

    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.derivedS3Key).toBeNull();
    expect(row.derivedMime).toBeNull();
    expect(row.derivedSize).toBeNull();
    expect(row.derivedWidth).toBeNull();
    expect(row.derivedHeight).toBeNull();
    expect(row.derivedStatus).toBeNull();

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(m.aiExtractHash).toBeNull();

    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.lastError).toBeNull();
  });

  it('派生列 / embed_hash / last_error 可写可读回', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const mediaId = randomUUID();
    await db.insert(media).values({
      id: mediaId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
      mime: 'image/jpeg',
      size: 2048,
      status: 'ready',
      storageMeta: {
        bucket: 'moment-test-placeholder',
        prefix: 'test/attachments',
        region: 'us-east-1',
        isPublicBucket: 'false',
      },
    });

    await db
      .update(media)
      .set({
        derivedS3Key: `chains/${chainId}/${momentId}/${mediaId}.derived.webp`,
        derivedMime: 'image/webp',
        derivedSize: 800,
        derivedWidth: 512,
        derivedHeight: 384,
        derivedStatus: 'ready',
      })
      .where(eq(media.id, mediaId));
    const [ready] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(ready.derivedMime).toBe('image/webp');
    expect(ready.derivedSize).toBe(800);
    expect(ready.derivedWidth).toBe(512);
    expect(ready.derivedStatus).toBe('ready');

    for (const status of ['pending', 'skipped', 'failed'] as const) {
      await db.update(media).set({ derivedStatus: status }).where(eq(media.id, mediaId));
      const [s] = await db.select().from(media).where(eq(media.id, mediaId));
      expect(s.derivedStatus).toBe(status);
    }

    const hash = 'b'.repeat(64);
    await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBe(hash);

    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'failed',
      lastError: 'x'.repeat(512),
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.lastError).toHaveLength(512);
    expect(ob.type).toBe('moment.embed');
  });
});
```

- [ ] **Step 2: 运行确认失败**

若 Task 4 已 migrate，本测试在 Task 3 列已存在时应 **直接绿**（列已落地）。红灯只在「忘写 schema / 未 migrate」时出现。

**本 Task 的门禁不是 TDD 红灯，而是迁移后的运行时证明。** 先跑：

Run: `pnpm --filter @moment/server test -- tests/db/fused-retrieval-schema.test.ts`
Expected: 若 FAIL（`derivedS3Key` undefined / unknown column），停手核对 Task 3/4。若 PASS，进 Step 3。

不要为了制造红灯去删列。

- [ ] **Step 3: 运行确认通过**

同上命令。Expected: PASS，2 个用例全过。瞬时 ECONNRESET 重跑。

- [ ] **Step 4: lint + typecheck**

Run: `pnpm --filter @moment/server lint && pnpm --filter @moment/server typecheck`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/db/fused-retrieval-schema.test.ts
git commit -m "test(server): smoke derived media, embed_hash, and outbox last_error columns"
```

---

### Task 6: `getObject` 有界读取 + mock 补齐

**Files:**
- Create: `apps/server/src/storage/bounded-read.ts`
- Modify: `apps/server/src/storage/base.adapter.ts:32-70`（接口 + 抽象方法）
- Modify: `apps/server/src/storage/s3.adapter.ts`（实现 `getObject`；`GetObjectCommand` 已 import）
- Modify: `apps/server/tests/helpers/storage.ts:16-35`（mock 补 `getObject`）
- Modify: `apps/server/tests/storage/factory.test.ts:5-18`（`fakeAdapter` 补 `getObject`）
- Modify: `apps/server/tests/storage/s3-it.test.ts`（追加 skippable 用例）
- Test: `apps/server/tests/storage/bounded-read.test.ts`
- Test: `apps/server/tests/storage/get-object.test.ts`（mock 契约）

**Interfaces:**
- Consumes:
  - `UnifiedStorageAdapter` / `BaseUnifiedStorageAdapter` / `StorageMetadata`（`base.adapter.ts`）
  - `S3UnifiedStorageAdapter.bucketFrom` / `fullFor` / `this.client`（与 `generateAccessUrl`/`deleteFile` 同一选桶/prefix）
  - `MAX_IMAGE_BYTES`（dto，s3-it 用例用；单元测试用更小上限）
  - `setStorageAdapter` / `installMockStorage`
- Produces:
  - `class ObjectTooLargeError extends Error`（`name='ObjectTooLargeError'`，`message='OBJECT_TOO_LARGE'`，字段 `key`/`maxBytes`）
  - `abortS3Body(body: unknown): void`
  - `readBodyWithLimit(body: AsyncIterable<Uint8Array>, maxBytes: number, key: string): Promise<Buffer>`
  - `UnifiedStorageAdapter.getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>`
  - `BaseUnifiedStorageAdapter` 对应 `abstract getObject`
  - `S3UnifiedStorageAdapter.getObject`：GetObject → ContentLength > maxBytes 则 abort + throw → 否则 `readBodyWithLimit`
  - `installMockStorage().getObject` 默认 `mockResolvedValue(Buffer.alloc(0))`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/storage/bounded-read.test.ts`：
```ts
import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { ObjectTooLargeError, abortS3Body, readBodyWithLimit } from '../../src/storage/bounded-read.js';

async function* chunksOf(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield Buffer.from(p);
}

describe('readBodyWithLimit', () => {
  it('拼接所有 chunk，总长 == maxBytes 合法', async () => {
    const buf = await readBodyWithLimit(chunksOf('hel', 'lo'), 5, 'k');
    expect(buf.toString()).toBe('hello');
  });

  it('空 body 返回空 Buffer', async () => {
    const buf = await readBodyWithLimit(chunksOf(), 10, 'k');
    expect(buf.length).toBe(0);
  });

  it('总长超过 maxBytes → ObjectTooLargeError，不返回部分缓冲', async () => {
    await expect(readBodyWithLimit(chunksOf('hello', 'world'), 8, 'chains/a/b/c.jpg')).rejects.toMatchObject({
      name: 'ObjectTooLargeError',
      message: 'OBJECT_TOO_LARGE',
      key: 'chains/a/b/c.jpg',
      maxBytes: 8,
    });
    expect(new ObjectTooLargeError('k', 1)).toBeInstanceOf(Error);
  });

  it('单 chunk 就超限也抛', async () => {
    await expect(readBodyWithLimit(chunksOf('abcd'), 3, 'k')).rejects.toBeInstanceOf(ObjectTooLargeError);
  });
});

describe('abortS3Body', () => {
  it('对带 destroy 的流调用 destroy，不抛', () => {
    const r = Readable.from([Buffer.from('x')]);
    const spy = jest.spyOn(r, 'destroy');
    abortS3Body(r);
    expect(spy).toHaveBeenCalled();
  });

  it('对 null / 无 destroy 的对象静默', () => {
    expect(() => abortS3Body(null)).not.toThrow();
    expect(() => abortS3Body({})).not.toThrow();
  });
});
```

Create `apps/server/tests/storage/get-object.test.ts`：
```ts
import { MAX_IMAGE_BYTES } from '@moment/dto';
import type { StorageMetadata } from '../../src/storage/base.adapter.js';
import { getStorage, setStorageAdapter } from '../../src/storage/factory.js';
import { installMockStorage } from '../helpers/storage.js';

afterEach(() => setStorageAdapter(null));

const meta: StorageMetadata = {
  bucket: 'b',
  prefix: 'p',
  region: 'us-east-1',
  isPublicBucket: 'false',
};

describe('installMockStorage getObject（spec §2.4）', () => {
  it('默认返回空 Buffer；可 mockResolvedValue', async () => {
    const storage = installMockStorage();
    await expect(storage.getObject('k', meta, MAX_IMAGE_BYTES)).resolves.toEqual(Buffer.alloc(0));
    storage.getObject.mockResolvedValueOnce(Buffer.from('webp'));
    await expect(getStorage().getObject('k', meta, 4)).resolves.toEqual(Buffer.from('webp'));
    expect(storage.getObject).toHaveBeenCalledWith('k', meta, 4);
  });
});
```

Modify `apps/server/tests/storage/s3-it.test.ts` — 在最后一个 `it` 之后追加：
```ts
  it('getObject 有界读取：小对象返回原字节；超 maxBytes 抛 ObjectTooLargeError', async () => {
    const key = `tmp/getobj-${randomUUID()}.bin`;
    const body = Buffer.from('hello-get-object');
    await storage.uploadFile(key, body);
    const meta = currentStorageMeta();
    const got = await storage.getObject(key, meta, 1024);
    expect(Buffer.compare(got, body)).toBe(0);
    await expect(storage.getObject(key, meta, 4)).rejects.toMatchObject({ name: 'ObjectTooLargeError' });
    await storage.deleteFile(key, meta);
  });
```

（`s3-it.test.ts` 顶部已有 `getStorage`/`currentStorageMeta`/`randomUUID`。`describe` 已按 `RUN_S3_IT` skip。新增用例不改默认测试对外部桶的依赖。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/storage/bounded-read.test.ts`
Expected: FAIL，`Cannot find module '../../src/storage/bounded-read.js'`。

- [ ] **Step 3: 实现 bounded-read.ts**

Create `apps/server/src/storage/bounded-read.ts`：
```ts
/** getObject 超 maxBytes（spec fused-retrieval §2.4）。P3 再包装为 NonRetryableCompressError。 */
export class ObjectTooLargeError extends Error {
  readonly key: string;
  readonly maxBytes: number;
  constructor(key: string, maxBytes: number) {
    super('OBJECT_TOO_LARGE');
    this.name = 'ObjectTooLargeError';
    this.key = key;
    this.maxBytes = maxBytes;
  }
}

/** 中止 SDK 流，避免超限后仍把对象读完。无 destroy 则 no-op。 */
export function abortS3Body(body: unknown): void {
  if (body && typeof body === 'object' && 'destroy' in body && typeof (body as { destroy: unknown }).destroy === 'function') {
    (body as { destroy: (err?: Error) => void }).destroy();
  }
}

/**
 * 有界拼接。总长 > maxBytes 时抛 ObjectTooLargeError 并 abort。
 * 不得改用 transformToByteArray（无界）。
 */
export async function readBodyWithLimit(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  key: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        abortS3Body(body);
        throw new ObjectTooLargeError(key, maxBytes);
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    abortS3Body(body);
    throw err;
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}
```

- [ ] **Step 4: 接口追加 `getObject`**

Modify `apps/server/src/storage/base.adapter.ts` — `UnifiedStorageAdapter` 在 `abortMultipart(...)` 之后追加：
```ts
  /**
   * 有界读对象字节（spec fused-retrieval §2.4）。
   * 按行上 metadata 选桶/prefix（与 generateAccessUrl 同）。超 maxBytes 抛 ObjectTooLargeError。
   * 仅 worker compress（原图）与 embed（derived）可调用；请求线程零读像素。
   */
  getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>;
```

`BaseUnifiedStorageAdapter` 在 `abstract abortMultipart(...)` 之后追加：
```ts
  abstract getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>;
```

- [ ] **Step 5: S3 实现**

Modify `apps/server/src/storage/s3.adapter.ts` — import 区增加：
```ts
import { ObjectTooLargeError, abortS3Body, readBodyWithLimit } from './bounded-read.js';
```

在 `S3UnifiedStorageAdapter` 类内、`generateAccessUrl` **之前或 `deleteFile` 之后**追加：
```ts
  /**
   * 有界 GetObject（spec §2.4）。桶/prefix 来自行上 metadata，client/endpoint 与 generateAccessUrl 同（MVP 单桶）。
   * ContentLength 已知且超限时不把 body 读入内存。
   */
  async getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketFrom(metadata),
        Key: this.fullFor(key, metadata),
      }),
    );
    if (typeof res.ContentLength === 'number' && res.ContentLength > maxBytes) {
      abortS3Body(res.Body);
      throw new ObjectTooLargeError(key, maxBytes);
    }
    if (!res.Body) {
      throw new Error('S3 GetObject returned empty Body');
    }
    return readBodyWithLimit(res.Body as AsyncIterable<Uint8Array>, maxBytes, key);
  }
```

- [ ] **Step 6: mock / fakeAdapter 补方法**

Modify `apps/server/tests/helpers/storage.ts` — 在 `abortMultipart: ...` 之后追加：
```ts
    getObject: jest.fn<UnifiedStorageAdapter['getObject']>().mockResolvedValue(Buffer.alloc(0)),
```

Modify `apps/server/tests/storage/factory.test.ts` `fakeAdapter()` 同样追加：
```ts
    getObject: async () => Buffer.alloc(0),
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/storage/bounded-read.test.ts tests/storage/get-object.test.ts tests/storage/factory.test.ts`
Expected: PASS。

Run: `pnpm --filter @moment/server typecheck`
Expected: exit 0（所有 `UnifiedStorageAdapter` 字面量已补 `getObject`；仓库里只有 `helpers/storage.ts` 与 `factory.test.ts` 两处）。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/storage/bounded-read.ts apps/server/src/storage/base.adapter.ts apps/server/src/storage/s3.adapter.ts apps/server/tests/helpers/storage.ts apps/server/tests/storage/factory.test.ts apps/server/tests/storage/bounded-read.test.ts apps/server/tests/storage/get-object.test.ts apps/server/tests/storage/s3-it.test.ts
git commit -m "feat(server): add bounded getObject to storage adapter"
```

---

### Task 7: processor 持久化 `last_error` + 按 error.name 立即 failed

**Files:**
- Modify: `apps/server/src/worker/processor.ts`（成功/失败/无 handler 三路写 `lastError`；catch 增加立即失败）
- Test: `apps/server/tests/worker/processor.test.ts`（既有用例补 `lastError` 断言 + 新用例）

**Interfaces:**
- Consumes:
  - `runOutboxBatch` / `RETRY_DELAYS_MS` / `OutboxHandler` / `outbox.lastError`（Task 3/4）
  - 既有退避：`attempts > RETRY_DELAYS_MS.length` → failed（5 档用尽）
- Produces:
  - 成功：`status=done`，`lastError=null`（清掉上次重试残留）
  - 无 handler：`status=failed`，`lastError='NO_HANDLER'`
  - throw 且 `error.name` ∈ `{NonRetryableCompressError, NonRetryableEmbeddingError}`：立即 `status=failed`，`attempts+=1`，`nextRetryAt=null`，`processedAt=now`，`lastError=message.slice(0,512)`，**不**走 `RETRY_DELAYS_MS`
  - 其它 throw 且 `attempts <= 5`：保持 `pending`，写 `lastError`，档位退避
  - 其它 throw 且 `attempts > 5`：`failed` + `lastError`
  - `NonRetryableLLMError` **不**立即 failed（仍退避）
  - 注释钉死：handler 不得自写 `outbox.status=failed`（否则成功路径会盖成 done）
  - **不**注册 compress/embed handler（未注册 → NO_HANDLER；P3/P5 再挂）

- [ ] **Step 1: 写失败测试**

Modify `apps/server/tests/worker/processor.test.ts`：

1. 既有「成功处理」用例末尾追加：
```ts
    expect(row.lastError).toBeNull();
```

2. 既有「失败重试」用例末尾追加：
```ts
    expect(row.lastError).toBe('EXPO_DOWN');
```

3. 既有「attempts>5 → failed」对 `ob-3b` 追加：
```ts
    expect(row.lastError).toBe('STILL_DOWN');
```

4. 既有「未注册的 type」追加：
```ts
    expect(row.lastError).toBe('NO_HANDLER');
```

5. 文件末尾、`describe('runOutboxBatch')` 内追加：
```ts
  it('成功路径把上次 last_error 清掉', async () => {
    await emitRow('ob-clear', { lastError: 'OLD' });
    const handler = jest.fn<OutboxHandler>().mockResolvedValue(undefined);
    await runOutboxBatch({ push: okPush, handlers: { 'comment.created': handler } });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-clear'));
    expect(row.status).toBe('done');
    expect(row.lastError).toBeNull();
  });

  it('last_error 截断到 512', async () => {
    await emitRow('ob-long');
    const failing: OutboxHandler = async () => {
      throw new Error('E'.repeat(600));
    };
    await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-long'));
    expect(row.status).toBe('pending');
    expect(row.lastError).toHaveLength(512);
    expect(row.lastError).toBe('E'.repeat(512));
  });

  it('error.name=NonRetryableCompressError → 立即 failed，不占 5 档退避', async () => {
    await emitRow('ob-nrc');
    const failing: OutboxHandler = async () => {
      const err = new Error('bad jpeg');
      err.name = 'NonRetryableCompressError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-nrc'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).toBeNull();
    expect(row.processedAt).not.toBeNull();
    expect(row.lastError).toBe('bad jpeg');
  });

  it('error.name=NonRetryableEmbeddingError → 立即 failed', async () => {
    await emitRow('ob-nre');
    const failing: OutboxHandler = async () => {
      const err = new Error('dim mismatch');
      err.name = 'NonRetryableEmbeddingError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-nre'));
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('dim mismatch');
  });

  it('NonRetryableLLMError 仍走 5 档退避（不扩立即失败）', async () => {
    await emitRow('ob-llm');
    const failing: OutboxHandler = async () => {
      const err = new Error('LLM 4xx');
      err.name = 'NonRetryableLLMError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 1, failed: 0 });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-llm'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('LLM 4xx');
    expect(row.nextRetryAt).not.toBeNull();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/processor.test.ts`
Expected: FAIL。既有用例 `lastError` 为 null 而非 `'EXPO_DOWN'` / `'NO_HANDLER'`；立即失败用例 `status` 仍是 `pending`（走了退避）。

- [ ] **Step 3: 实现 processor**

Modify `apps/server/src/worker/processor.ts`。

在 `CLAIM_LEASE_MS` 之后追加：
```ts
/** spec fused-retrieval §2.3：仅 compress/embed 终败按 name 立即 failed。禁止扩到 NonRetryableLLMError。 */
const IMMEDIATE_FAIL_NAMES = new Set(['NonRetryableCompressError', 'NonRetryableEmbeddingError']);

function outboxLastError(err: unknown): string {
  const raw = err instanceof Error ? String(err.message ?? err) : String(err);
  return raw.slice(0, 512);
}

function isImmediateFail(err: unknown): boolean {
  return err instanceof Error && IMMEDIATE_FAIL_NAMES.has(err.name);
}
```

把 `runOutboxBatch` 的 JSDoc 第 2 点改成（保留 claim 租约描述）：
```
 * 2) 逐条分发 handler。handler 正常返回 → done 且 last_error=null。
 *    throw 且 error.name 为 NonRetryableCompressError / NonRetryableEmbeddingError → 立即 failed + last_error，不走 5 档退避。
 *    其它 throw → attempts+1 + 档位退避并写 last_error；attempts>5 → failed。
 *    未注册 type → 直接 failed，last_error='NO_HANDLER'。
 *    handler 禁止自改 outbox.status（成功路径会覆盖成 done，spec §2.3）。
```

无 handler 分支 `.set({...})` 改为：
```ts
        .set({ status: 'failed', processedAt: now(), nextRetryAt: null, lastError: 'NO_HANDLER' })
```

成功分支 `.set({...})` 改为：
```ts
        .set({ status: 'done', processedAt: now(), nextRetryAt: null, lastError: null })
```

`catch` 整段替换为：
```ts
    } catch (err) {
      const attempts = row.attempts + 1;
      const lastError = outboxLastError(err);
      if (isImmediateFail(err)) {
        logger.error('outbox entry immediate fail', { id: row.id, type: row.type, name: (err as Error).name, attempts, err });
        await db
          .update(outbox)
          .set({ status: 'failed', attempts, processedAt: now(), nextRetryAt: null, lastError })
          .where(eq(outbox.id, row.id));
        result.failed += 1;
      } else if (attempts > RETRY_DELAYS_MS.length) {
        logger.error('outbox entry exhausted retries', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ status: 'failed', attempts, processedAt: now(), nextRetryAt: null, lastError })
          .where(eq(outbox.id, row.id));
        result.failed += 1;
      } else {
        logger.warn('outbox entry failed; will retry', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ attempts, nextRetryAt: new Date(now().getTime() + RETRY_DELAYS_MS[attempts - 1]), lastError })
          .where(eq(outbox.id, row.id));
        result.retried += 1;
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/processor.test.ts`
Expected: PASS（既有 6 个 + 本 Task 5 个）。

- [ ] **Step 5: 回归（processor 调用方 + 存储 mock + schema 冒烟）**

Run: `pnpm --filter @moment/server test -- tests/worker tests/outbox tests/db/fused-retrieval-schema.test.ts tests/storage/bounded-read.test.ts tests/storage/get-object.test.ts`
Expected: PASS。既有 extract/geocode 经 `runOutboxBatch` 的测试：可重试错误仍 `pending`；终态路径不回归。

- [ ] **Step 6: lint + typecheck + dto 回归**

Run:
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build
pnpm --filter @moment/server lint && pnpm --filter @moment/server typecheck
```
Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/worker/processor.ts apps/server/tests/worker/processor.test.ts
git commit -m "feat(server): persist outbox last_error and fail compress/embed nonretryables immediately"
```

---

### Task 8: CONVENTIONS §3 追加 getObject / last_error / 融合检索路由总表

**Files:**
- Modify: `docs/superpowers/plans/CONVENTIONS.md`（§3.2 列追加 `last_error`；§3.2 类型举例追加 `'moment.compress'`/`'moment.embed'`；§3.3 方法追加 `getObject`；§3.6 追加融合检索行。**禁止**改 §3.1 ChainPolicy / `requireChainRole` 签名；**禁止**改 §3.4 feed `{h,i}`/`{c,i}` 与「媒体稳定入口 `/api/media/:id`」句）
- Test: `apps/server/tests/conventions-fused-retrieval.test.ts`

**Interfaces:**
- Consumes: 现网 `docs/superpowers/plans/CONVENTIONS.md` §3.1–§3.6 文本
- Produces（P2–P10 **只消费、禁止再改名**）:
  - §3.2 outbox 列含 `last_error varchar(512) null`（插在 `next_retry_at` 与 `created_at` 之间）
  - §3.2 `types.ts` 举例含 `'moment.compress'`、`'moment.embed'`
  - §3.3 方法表末尾追加 `getObject(key, metadata, maxBytes)`；另起一句：超 `maxBytes` 抛错；按行上 `storageMeta` 选桶/endpoint（与 `generateAccessUrl` 同）
  - §3.6 新行「融合检索（2026-08-29-fused-retrieval）」含：`POST /api/search`、`GET /api/chains/:chainId/jobs`、`POST /api/internal/embeddings`、`DELETE /api/internal/embeddings/:momentId`；既有 `GET /api/feed` / `GET /api/chains/:chainId/moments` 追加 query `person_id`/`place`/`happened_from`/`happened_to`；既有 `GET /api/media/:id` 追加 query `variant=original|derived`（缺省 original，不改稳定入口）
  - 既有 Phase 2–8 / 模板系统行一字不改

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/conventions-fused-retrieval.test.ts`（不触库、不 import db）：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('CONVENTIONS §3 fused-retrieval additive（spec-review：只追加 getObject / last_error / 新路由）', () => {
  const text = readFileSync(path.join(REPO_ROOT, 'docs/superpowers/plans/CONVENTIONS.md'), 'utf8');

  it('§3.2 追加 last_error，不改既有列名', () => {
    expect(text).toMatch(/last_error varchar\(512\) null/);
    expect(text).toMatch(/status enum\('pending','done','failed'\)/);
    expect(text).toContain("'moment.compress'");
    expect(text).toContain("'moment.embed'");
  });

  it('§3.3 追加 getObject，既有方法名仍在', () => {
    expect(text).toMatch(/getObject\(key, metadata, maxBytes\)/);
    expect(text).toContain('uploadFile / deleteFile');
    expect(text).toContain('abortMultipart');
  });

  it('§3.6 融合检索路由行；ChainPolicy / 媒体稳定入口句未改', () => {
    expect(text).toContain('融合检索（2026-08-29-fused-retrieval）');
    expect(text).toContain('POST /api/search');
    expect(text).toContain('GET /api/chains/:chainId/jobs');
    expect(text).toContain('POST /api/internal/embeddings');
    expect(text).toContain('DELETE /api/internal/embeddings/:momentId');
    expect(text).toContain('person_id');
    expect(text).toContain('variant=original|derived');
    expect(text).toContain("export function requireChainRole(minRole: ChainRole): RequestHandler;");
    expect(text).toContain('媒体 URL：响应中 media 只出稳定入口 `/api/media/:id`（相对路径），**不得**内嵌预签名 URL。');
    expect(text).toContain('`order=happened_at` 时 `{h: <epochMs>, i: <momentId>}`');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/conventions-fused-retrieval.test.ts`
Expected: FAIL。现网 CONVENTIONS 无 `last_error varchar(512)`、无 `getObject(key, metadata, maxBytes)`、无 `POST /api/search` / 融合检索行。不要为了红灯去改 ChainPolicy 段。

- [ ] **Step 3: 最小实现**

Modify `docs/superpowers/plans/CONVENTIONS.md`。

§3.2 `types.ts` 那行把举例换成（只追加两个 type 名）：
```
// src/outbox/types.ts — 所有 type 常量集中在此（如 'moment.created'、'comment.created'、'invite.created'、'moment.compress'、'moment.embed'）
```

§3.2 列描述整句替换为：
```
outbox 表列：`id char(36) pk, type varchar(64), payload json, status enum('pending','done','failed') default 'pending', attempts int default 0, next_retry_at timestamp null, last_error varchar(512) null, created_at, processed_at null`。索引 `(status, next_retry_at)`。
```

§3.3 方法名那句，在 `` `abortMultipart(key, uploadId)` `` 之后、句号之前追加 ` / getObject(key, metadata, maxBytes)`，并在该句后另起一段：
```
`getObject(key, metadata, maxBytes)` 是追加方法（融合检索）：超 `maxBytes` 抛错；按行上 `storageMeta` 选桶/endpoint（与 `generateAccessUrl` 同）；内部走 SDK GetObject / 有界流式读取。测试 mock 点仍 `installMockStorage` / `setStorageAdapter`。
```

§3.6 表在模板系统行**之后**追加一行（既有 Phase 2–8 / 模板系统行一字不改）：
```
| 融合检索（2026-08-29-fused-retrieval） | `POST /api/search`、`GET /api/chains/:chainId/jobs`、`POST /api/internal/embeddings`、`DELETE /api/internal/embeddings/:momentId`；既有 `GET /api/feed` / `GET /api/chains/:chainId/moments` 追加 query `person_id`/`place`/`happened_from`/`happened_to`；既有 `GET /api/media/:id` 追加 query `variant=original|derived`（缺省 original，不改稳定入口） |
```

不要改 §3.1 代码块。不要改 §3.4 游标形状或「稳定入口 `/api/media/:id`」那一句。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/conventions-fused-retrieval.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/CONVENTIONS.md apps/server/tests/conventions-fused-retrieval.test.ts
git commit -m "docs: add fused-retrieval getObject, last_error, and routes to CONVENTIONS"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（search + jobs + feed/list 新字段 + MomentMedia 可选字段 + 既有无回归）
- [ ] `pnpm --filter @moment/dto build` / `lint` exit 0
- [ ] `pnpm --filter @moment/server migrate` 在测试库应用 0017；Task 4 Step 4 information_schema 八列全 YES
- [ ] `pnpm --filter @moment/server test -- tests/db/fused-retrieval-schema.test.ts tests/outbox/outbox.test.ts tests/storage/bounded-read.test.ts tests/storage/get-object.test.ts tests/worker/processor.test.ts tests/conventions-fused-retrieval.test.ts` 全绿
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] `installMockStorage()` 含 `getObject`；`fakeAdapter` 含 `getObject`
- [ ] spec §11 P1 出口：dto（列表 query、search、derivedUrl/posterDerivedUrl、jobs）+ 迁移八列 + outbox 两常量 + `getObject` + processor `last_error`（含两 name 立即 failed）
- [ ] 未泄漏 P2–P10：无 `queryMomentPage` 过滤、无 compress/embed handler、无 Lance、无 `getEmbeddingProvider`、无 `POST /api/search` controller、无 jobs 路由、无 api-client、无 web/app、无 embedding env、无 bookworm Dockerfile。Task 8 只预留 CONVENTIONS 路由总表，不算实现这些路由
- [ ] CONVENTIONS §3 **只追加**：`last_error`、`getObject(key, metadata, maxBytes)`、§3.6 融合检索行（`POST /api/search` / `GET /api/chains/:chainId/jobs` / `POST|DELETE /api/internal/embeddings*` / feed·list·media query）；ChainPolicy / feed `{h,i}` / 媒体稳定入口句未改；`pnpm --filter @moment/server test -- tests/conventions-fused-retrieval.test.ts` 绿
