# 融合检索 P7：GET /api/chains/:chainId/jobs owner-only 任务列表 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的链主任务列表：`GET /api/chains/:chainId/jobs` 仅 owner，投影 `moment.compress` / `moment.embed`，应用层滤 `payload.chainId`，`lastError` 来自 `outbox.last_error`，无游标，默认 `pending,failed`，最多 50 条。

**Architecture:** 新域 `apps/server/src/jobs/`（独立于 search，不塞进 `src/search/`）。`JobsController` 链内嵌套，`@UseBefore(requireChainRole('owner'))`，controller **禁止**手写角色判断。query 契约放 dto `chainJobsQuerySchema`（P1 只钉了响应 interface）。`JobsService.list` SQL 只按 outbox **列** `type` + `status` 过滤并 `ORDER BY created_at DESC`（**禁止** SQL `.limit()`）；`payload.chainId === params.chainId` 在 JS 完成（禁止 MySQL JSON 函数）；缺 `payload.momentId` 的脏行 skip + `logger.warn`；他链/脏行 skip **不计入** `limit`，累计到 `query.limit` 条合法 DTO 即停。测试直插 P1/P5 形状的 outbox 行，不跑 compress/embed handler。

**Tech Stack:** routing-controllers 0.11 + TypeDI / zod ^3.22（勿用 v4 API）/ drizzle-orm 0.45（`inArray` / `desc`）/ jest `--runInBand` + supertest + 真实 MySQL 测试库 / dto `tsx --test src/*.test.ts`。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§2.3 `last_error`、§6.4 任务列表、§6.6 `CHAIN_ROLE_INSUFFICIENT` / `CHAIN_NOT_FOUND` / `VALIDATION_ERROR`、§8 jobs 仅 owner、§9 jobs 测试、§10 不做 jobs 游标/重试、§11 P7 出口）

**上游契约:**
- P1 `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`（CLEAN）：`packages/dto/src/jobs.ts` 的 `ChainJobDto` / `ChainJobListResponse`（**本计划不得改字段名/字面量**）；`outbox.lastError` ↔ SQL `last_error`；`OUTBOX_MOMENT_COMPRESS = 'moment.compress'` / `OUTBOX_MOMENT_EMBED = 'moment.embed'`；`MomentCompressPayload { momentId, chainId, mediaId }`；`MomentEmbedPayload { momentId, chainId }`。
- P5 `docs/superpowers/plans/2026-08-29-fused-retrieval-p5-embed.md`：emit 的 payload 形状与 P1 相同。本计划**直插**这些行，不调用 `handleMomentCompress` / `handleMomentEmbed`。
- 现网：`requireChainRole` / `ChainPolicy.require`（不足 403 `CHAIN_ROLE_INSUFFICIENT`，非成员/无链 404 `CHAIN_NOT_FOUND`）；嵌套路由范式见 `ShareLinksController` / `RecapController`；`ErrorHandlerMiddleware` 把 `ZodError` 映成 400 `{ error: { code: 'VALIDATION_ERROR' } }`。

执行时假设 P1 已在本分支落地（`jobs.ts`、`outbox.last_error` 列、两 type 常量）。P2–P6 与本计划正交；`app.ts` 的 `controllers` 若已含 `InternalEmbeddingsController`（P4）或 `SearchController`（P6），**一字不删**，只追加 `JobsController`。

## Global Constraints

- 冻结名逐字不得改：`GET /api/chains/:chainId/jobs` / `JobsController` / `JobsService.list` / `chainJobsQuerySchema` / `ChainJobsQuery` / `CHAIN_JOBS_DEFAULT_LIMIT=50` / `CHAIN_JOBS_MAX_LIMIT=50` / `ChainJobDto` / `ChainJobListResponse` / `lastError`（来自 `outbox.last_error`）/ `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED` / `@UseBefore(requireChainRole('owner'))` / 错误码 `VALIDATION_ERROR` `CHAIN_ROLE_INSUFFICIENT` `CHAIN_NOT_FOUND`。
- CONVENTIONS §3.1：链内资源嵌套 `/api/chains/:chainId/jobs`；鉴权只走 `requireChainRole('owner')`；**不改** `chain-policy.ts` / `require-chain-role.ts`；controller 内禁止手写角色判断、禁止再调 `ChainPolicy.require`。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已预留该嵌套路由）。
- **应用层**滤 `payload.chainId === params.chainId`。禁止 `JSON_EXTRACT` / `JSON_UNQUOTE` / `JSON_CONTAINS` / `payload->>` / drizzle `sql\`...\`` 读 JSON。禁止 SQL `.limit()` / 先 `LIMIT n` 再滤链。他链、缺 `chainId`、缺 `momentId` 的行 skip 后**不计入** `limit`（否则最新脏行/他链会把更早的本链任务挤掉）。
- **无游标**：不发明 `cursor` / `nextCursor` / `before`。query 多出来的键 zod 默认 strip。超过 50 条 v1 截断。v1 **无**重试端点。
- 只投影 `type ∈ {moment.compress, moment.embed}`。`moment.extract` / `moment.created` / `recap.generate` 等一律不出现。默认 status `pending,failed`（不返回 `done`，除非 query 显式包含）。
- `mediaId`：compress 取 `payload.mediaId`（非非空 string 则 `null`）；embed **恒** `null`。
- **不**做 api-client `listChainJobs`（P8）、web 处理中 UI（P8）、app（P9）、search（P6）、`backfill:embed`（P10）。不改 `apps/server/.env`。无新表，不改 `resetDb()` 删除顺序。
- server 测试：`pnpm --filter @moment/server test -- <file>`（脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)` + `beforeEach(resetDb)`。严禁生产库。dto：`pnpm --filter @moment/dto test`（`tsx --test src/*.test.ts`）。改 dto 后必须 `pnpm --filter @moment/dto build` 再跑 server 测试（server 消费 `dist/`）。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **query schema 放 dto `chainJobsQuerySchema`，不放 server。** spec §6.4 把 query 写在 `packages/dto/src/jobs.ts` 段，但 P1 只落地响应 interface（路由属 P7）。本计划在同一文件追加 zod（CONVENTIONS §3.5：请求 schema 用 zod）。`ChainJobDto` / `ChainJobListResponse` 零改名。
2. **非法 `limit` 走 ZodError → HTTP 400 `VALIDATION_ERROR`，不用 `INVALID_LIMIT`。** spec §6.6：`INVALID_LIMIT`「仅链列表 GET」。jobs 的 `limit` 与非法 status 同一信封。
3. **SQL 一次查出匹配 `type`+`status` 的全部候选（`orderBy desc(createdAt)`），JS 滤 `chainId`、跳脏行，再截 `limit`。** 家庭量级（spec §10）可接受。不把 `limit` 推进 SQL（偏差原因见 Task 2 的「他链更新、本链更早」用例）。
4. **缺 `payload.momentId`（`undefined` / 非 string / `''`）skip + warn；缺 `chainId` 或 `chainId !== params.chainId` 静默丢弃（不 warn）。** payload 非普通对象同样静默丢弃。
5. **embed 的 `mediaId` 恒 `null`，即使 payload 误带 `mediaId`。** compress 的 `mediaId` 非非空 string 时字段为 `null`，行仍返回（只要有 `momentId`）。
6. **未登录 401 与 `ShareLinksController` / recaps 同形**（`@Authorized()`），只断言 `status===401`。
7. **`app.ts` 只追加 `JobsController`。** 不删 P4 `InternalEmbeddingsController`、P6 `SearchController`（若已在 `controllers` 数组中）。
8. **测试直插 outbox 行**，不跑 P3/P5 handler。payload 用 P1/P5 形状，以便 P8 看到的行与 worker 发射一致。
9. **`?cursor=` / `?before=` / `?order=` strip，200，body 无 `nextCursor`。** 不发明分页。
10. **status csv：每段 `trim`，去重保序。** spec 未写空格；`' pending , failed '` 视为合法。`status=` 或 `status=,,,`（trim 后零段）→ `VALIDATION_ERROR`。大小写敏感：`PENDING` 非法。
11. **`created_at` 平局不按 `id` 二次排序。** 测试插入秒级间隔时间戳。响应 `createdAt`/`processedAt` 只断言 ISO-8601 前缀与相对顺序，不断言与插入 `Date#toISOString()` 字面量相等（MySQL timestamp 会话时区 / fsp）。
12. **`JobsService.list` 不调 `ChainPolicy.require`。** 与 `ShareLinkService.list` 同形：中间件已保证 owner。
13. **脏行/他链 skip 不计入 `limit`。** 与偏差 3 同一原因：截断只发生在「本链合法 DTO」序列上。

## File map

| 路径 | 职责 |
|---|---|
| `packages/dto/src/jobs.ts` | P1 响应类型保持不动；追加 `chainJobsQuerySchema` / `ChainJobsQuery` / 两个 limit 常量 |
| `packages/dto/src/jobs.test.ts` | 保留 P1 类型用例；追加 query 解析 |
| `apps/server/src/jobs/jobs.service.ts` | `list`：type/status SQL + 应用层 chainId + 脏行 + 截断 + 序列化 |
| `apps/server/src/jobs/jobs.controller.ts` | `GET /api/chains/:chainId/jobs` + `requireChainRole('owner')` |
| `apps/server/src/app.ts` | `controllers` 追加 `JobsController` |
| `apps/server/tests/jobs/jobs.service.test.ts` | 滤链 / 脏行 / 排序 / lastError / 不含 extract·created·recap / mediaId / 截断 |
| `apps/server/tests/jobs/jobs.http.test.ts` | owner/editor/viewer/非成员/未登录 + query HTTP |

**本计划明确不改：** `chain-policy.ts`、`require-chain-role.ts`、`packages/dto/src/index.ts`（P1 已 re-export jobs）、`packages/dto/src/search.ts`、feed cursor、`moment-serializer.ts`、outbox processor、api-client、web/app、`tests/helpers/db.ts` 删除顺序、`apps/server/.env`、Dockerfile/compose/nginx、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: dto `chainJobsQuerySchema`（status csv + limit 1..50）

**Files:**
- Modify: `packages/dto/src/jobs.ts`（P1 已有 `ChainJobDto` / `ChainJobListResponse`；本 Task 前置 `import { z } from 'zod'` 并在两 interface **之后**追加 schema。不得改 interface 字段）
- Modify: `packages/dto/src/jobs.test.ts`（保留 P1「类型可赋值」用例，追加 query 用例；可整文件替换为下方完整内容）
- **不改:** `packages/dto/src/index.ts`（P1 已 `export * from './jobs.js'`；新 export 经 barrel 自动露出。禁止再写一份 `export * from './jobs.js'`）

**Interfaces:**
- Consumes:
  - P1 `ChainJobDto` / `ChainJobListResponse`（字段与字面量零改）
  - zod ^3.22
- Produces:
  - `CHAIN_JOBS_DEFAULT_LIMIT`（`50`）
  - `CHAIN_JOBS_MAX_LIMIT`（`50`）
  - `chainJobsQuerySchema`
  - `type ChainJobsQuery = z.infer<typeof chainJobsQuerySchema>`，运行时形状 `{ status: Array<'pending' \| 'failed' \| 'done'>; limit: number }`
  - 缺省：`status` 省略 → `['pending', 'failed']`；`limit` 省略 → `50`

- [ ] **Step 1: 写失败测试**

将 `packages/dto/src/jobs.test.ts` 写成：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAIN_JOBS_DEFAULT_LIMIT,
  CHAIN_JOBS_MAX_LIMIT,
  chainJobsQuerySchema,
  type ChainJobDto,
  type ChainJobListResponse,
  type ChainJobsQuery,
} from './jobs.js';

test('ChainJobDto / ChainJobListResponse 类型可赋值（spec §6.4 / P1）', () => {
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

test('CHAIN_JOBS limit 常量锁定（spec §6.4：1..50 默认 50）', () => {
  assert.equal(CHAIN_JOBS_DEFAULT_LIMIT, 50);
  assert.equal(CHAIN_JOBS_MAX_LIMIT, 50);
});

test('chainJobsQuerySchema：缺省 status=pending,failed 且 limit=50', () => {
  const r = chainJobsQuerySchema.parse({});
  assert.deepEqual(r.status, ['pending', 'failed']);
  assert.equal(r.limit, 50);
  const typed: ChainJobsQuery = r;
  assert.equal(typed.limit, 50);
});

test('chainJobsQuerySchema：status csv trim + 去重保序；单段合法', () => {
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'done' }).status, ['done']);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'pending,failed,done' }).status, [
    'pending',
    'failed',
    'done',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: ' pending , failed ' }).status, [
    'pending',
    'failed',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'failed,pending,failed' }).status, [
    'failed',
    'pending',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'pending,' }).status, ['pending']);
});

test('chainJobsQuerySchema：非法 status / 空 csv → 失败且 message 含 VALIDATION_ERROR', () => {
  for (const status of ['PENDING', 'pending,foo', 'pending,done,nope', '', ',,,', ' , ']) {
    const bad = chainJobsQuerySchema.safeParse({ status });
    assert.equal(bad.success, false, `expected reject status=${JSON.stringify(status)}`);
    if (!bad.success) {
      assert.ok(
        bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'status'),
        JSON.stringify(bad.error.issues),
      );
    }
  }
});

test('chainJobsQuerySchema：limit 1..50；query 字符串 coerce；非法拒绝', () => {
  assert.equal(chainJobsQuerySchema.parse({ limit: '1' }).limit, 1);
  assert.equal(chainJobsQuerySchema.parse({ limit: 50 }).limit, 50);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 0 }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 51 }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 'abc' }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: '' }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 1.5 }).success);
});

test('chainJobsQuerySchema：未知键 cursor/before/order strip，不失败', () => {
  const r = chainJobsQuerySchema.parse({
    status: 'done',
    limit: '3',
    cursor: 'abc',
    before: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.deepEqual(r, { status: ['done'], limit: 3 });
  assert.equal('cursor' in r, false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL。`chainJobsQuerySchema` / `CHAIN_JOBS_DEFAULT_LIMIT` / `CHAIN_JOBS_MAX_LIMIT` 不是 `jobs.ts` 的 export（`Cannot find module` 仅当 P1 `jobs.ts` 缺失——那时停手，先落地 P1）。不要为了红灯去删 P1 的两个 interface。

- [ ] **Step 3: 实现 `jobs.ts`**

将 `packages/dto/src/jobs.ts` 写成下列完整文件（两 interface 与 P1 逐字相同）：
```ts
import { z } from 'zod';

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

/** spec §6.4：缺省与上限都是 50；超过 50 条 v1 截断。 */
export const CHAIN_JOBS_DEFAULT_LIMIT = 50;
export const CHAIN_JOBS_MAX_LIMIT = 50;

const JOB_STATUS = z.enum(['pending', 'failed', 'done']);

/**
 * GET /api/chains/:chainId/jobs query（spec §6.4）。
 * status 可选 csv，默认 pending,failed；limit 1..50 默认 50。
 * 无 cursor。未知键 strip。api-client listChainJobs 属 P8，query 形状供其逐字抄。
 */
export const chainJobsQuerySchema = z
  .object({
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(CHAIN_JOBS_MAX_LIMIT).optional(),
  })
  .superRefine((val, ctx) => {
    const raw = val.status === undefined ? 'pending,failed' : val.status;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['status'] });
      return;
    }
    for (const p of parts) {
      if (!JOB_STATUS.safeParse(p).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['status'] });
        return;
      }
    }
  })
  .transform((val) => {
    const raw = val.status === undefined ? 'pending,failed' : val.status;
    const status: Array<'pending' | 'failed' | 'done'> = [];
    for (const p of raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
      if (p === 'pending' || p === 'failed' || p === 'done') {
        if (!status.includes(p)) status.push(p);
      }
    }
    return { status, limit: val.limit ?? CHAIN_JOBS_DEFAULT_LIMIT };
  });
export type ChainJobsQuery = z.infer<typeof chainJobsQuerySchema>;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS（jobs 新旧用例 + 既有 search/feed/moments 无回归）。

- [ ] **Step 5: 构建 dto（server 消费 dist）**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add packages/dto/src/jobs.ts packages/dto/src/jobs.test.ts
git commit -m "feat(dto): add chainJobsQuerySchema for GET chain jobs"
```

---

### Task 2: `JobsService.list`（应用层 chainId、脏行、排序、截断）

**Files:**
- Create: `apps/server/src/jobs/jobs.service.ts`
- Create: `apps/server/tests/jobs/jobs.service.test.ts`

**Interfaces:**
- Consumes:
  - `chainJobsQuerySchema` 产出的 `ChainJobsQuery`：`{ status: Array<'pending' | 'failed' | 'done'>; limit: number }`
  - `ChainJobDto` / `ChainJobListResponse`（P1）
  - `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED`（`apps/server/src/outbox/types.js`）
  - `OUTBOX_MOMENT_EXTRACT` / `OUTBOX_MOMENT_CREATED` / `OUTBOX_RECAP_GENERATE`（现网，反例：同链也不出现）
  - `outbox` 表（P1 `lastError: string | null`）
  - `logger.warn(msg, meta?)`
  - drizzle `and` / `desc` / `inArray`（**禁止** `.limit()` / `sql\`...\``）
- Produces:
  - `class JobsService` `@Service()`
  - `list(chainId: string, query: ChainJobsQuery): Promise<ChainJobListResponse>`
  - 序列化：`createdAt` / `processedAt` → `Date#toISOString()`；`processedAt` / `lastError` 空则 `null`；embed `mediaId` 恒 `null`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/jobs/jobs.service.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import {
  OUTBOX_MOMENT_COMPRESS,
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_EMBED,
  OUTBOX_MOMENT_EXTRACT,
  OUTBOX_RECAP_GENERATE,
} from '../../src/outbox/types.js';
import { logger } from '../../src/utils/logger.js';
import { closeDb, resetDb } from '../helpers/db.js';

const SERVICE_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/jobs/jobs.service.ts');
const CHAIN_A = '11111111-1111-4111-8111-111111111111';
const CHAIN_B = '22222222-2222-4222-8222-222222222222';
const MOMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MOMENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEDIA_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(resetDb);
afterAll(closeDb);

async function insertJob(over: {
  id?: string;
  type: string;
  status?: 'pending' | 'done' | 'failed';
  payload: object;
  createdAt: Date;
  processedAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
}): Promise<string> {
  const id = over.id ?? randomUUID();
  await db.insert(outbox).values({
    id,
    type: over.type,
    payload: over.payload,
    status: over.status ?? 'pending',
    attempts: over.attempts ?? 0,
    createdAt: over.createdAt,
    processedAt: over.processedAt ?? null,
    lastError: over.lastError ?? null,
  });
  return id;
}

const t = (sec: number) => new Date(Date.UTC(2026, 7, 29, 12, 0, sec));

describe('JobsService.list（spec §6.4）', () => {
  it('不在 SQL 用 JSON 函数滤 payload.chainId；无 SQL LIMIT；不调 ChainPolicy', () => {
    const src = readFileSync(SERVICE_SRC, 'utf8');
    expect(src.toLowerCase()).not.toMatch(/json_|payload->>|payload->|\.limit\s*\(/);
    expect(src).not.toMatch(/sql\s*\x60/);
    expect(src).not.toMatch(/ChainPolicy|CHAIN_ROLE_INSUFFICIENT|requireChainRole/);
  });

  it('只投影 compress/embed；extract/created/recap 同链也不出现；默认不返回 done', async () => {
    await insertJob({
      type: OUTBOX_MOMENT_EXTRACT,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_CREATED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(10),
    });
    await insertJob({
      type: OUTBOX_RECAP_GENERATE,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, period: '2026-08' },
      createdAt: t(11),
    });
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(8),
      processedAt: t(8),
    });
    const pendingId = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(7),
    });
    const failedId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(6),
      attempts: 1,
      lastError: 'dim mismatch',
      processedAt: t(6),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([pendingId, failedId]);
    expect(res.jobs.every((j) => j.type === 'moment.compress' || j.type === 'moment.embed')).toBe(true);
  });

  it('应用层滤 payload.chainId：他链更新的 2 条 + 本链更早 1 条，limit=2 仍返回本链', async () => {
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_B, chainId: CHAIN_B, mediaId: MEDIA_A },
      createdAt: t(20),
    });
    await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_B, chainId: CHAIN_B },
      createdAt: t(19),
    });
    const own = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(1),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0].id).toBe(own);
    expect(res.jobs[0].momentId).toBe(MOMENT_A);
  });

  it('ORDER BY created_at DESC；lastError 映射；embed mediaId 恒 null', async () => {
    const older = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(1),
      attempts: 1,
      lastError: 'OBJECT_TOO_LARGE',
      processedAt: t(2),
    });
    const newer = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(3),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([newer, older]);
    expect(res.jobs[0]).toMatchObject({
      type: 'moment.embed',
      status: 'pending',
      momentId: MOMENT_A,
      mediaId: null,
      attempts: 0,
      lastError: null,
      processedAt: null,
    });
    expect(res.jobs[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.jobs[1]).toMatchObject({
      type: 'moment.compress',
      status: 'failed',
      mediaId: MEDIA_A,
      attempts: 1,
      lastError: 'OBJECT_TOO_LARGE',
    });
    expect(res.jobs[1].processedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(res.jobs[0].createdAt)).toBeGreaterThan(Date.parse(res.jobs[1].createdAt));
  });

  it('缺 payload.momentId 的脏行跳过并 warn；合法行仍返回', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const dirtyId = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(5),
      });
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: '', chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(4),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(3),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
      expect(warn).toHaveBeenCalledWith(
        'jobs: skip outbox row missing payload.momentId',
        expect.objectContaining({ id: dirtyId, type: OUTBOX_MOMENT_COMPRESS }),
      );
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('缺 payload.chainId 或 chainId 不符：静默丢弃且不 warn', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, mediaId: MEDIA_A },
        createdAt: t(5),
      });
      await insertJob({
        type: OUTBOX_MOMENT_EMBED,
        payload: { momentId: MOMENT_A, chainId: CHAIN_B },
        createdAt: t(4),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(3),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('脏行不计入 limit：最新 2 条缺 momentId + 更早 1 条合法，limit=2 仍返回合法行', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(9),
      });
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(8),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(1),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
    } finally {
      warn.mockRestore();
    }
  });

  it('compress 缺/空 mediaId 仍返回且 mediaId=null', async () => {
    const missing = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(2),
    });
    const empty = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: '' },
      createdAt: t(1),
    });
    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([missing, empty]);
    expect(res.jobs[0].mediaId).toBeNull();
    expect(res.jobs[1].mediaId).toBeNull();
  });

  it('status=done 才返回 done；limit 截断为最新 N 条（本链 3 条 limit=2）', async () => {
    const a = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(1),
      processedAt: t(1),
    });
    const b = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(2),
    });
    const c = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(3),
    });
    const d = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(4),
    });

    const doneOnly = await new JobsService().list(CHAIN_A, { status: ['done'], limit: 50 });
    expect(doneOnly.jobs.map((j) => j.id)).toEqual([a]);

    const top = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
    expect(top.jobs.map((j) => j.id)).toEqual([d, c]);
    expect(top.jobs.map((j) => j.id)).not.toContain(b);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/jobs/jobs.service.test.ts`
Expected: FAIL，`Cannot find module '../../src/jobs/jobs.service.js'`（或等价）。若失败是 `Unknown column 'last_error'` / `OUTBOX_MOMENT_COMPRESS is not exported`：停手，P1 未落地。若 `chainJobsQuerySchema` 类型在 `@moment/dto` 缺失：先 `pnpm --filter @moment/dto build`。不要为了红灯去改 dto 测试。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/jobs/jobs.service.ts`：
```ts
import type { ChainJobDto, ChainJobListResponse, ChainJobsQuery } from '@moment/dto';
import { and, desc, inArray } from 'drizzle-orm';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { outbox, type OutboxRow } from '../db/schema.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

const JOB_TYPES = [OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED] as const;

function asPayloadObject(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function toDto(row: OutboxRow, payload: Record<string, unknown>, momentId: string): ChainJobDto | null {
  const type = row.type;
  if (type !== OUTBOX_MOMENT_COMPRESS && type !== OUTBOX_MOMENT_EMBED) return null;
  return {
    id: row.id,
    type,
    status: row.status,
    momentId,
    mediaId:
      type === OUTBOX_MOMENT_EMBED
        ? null
        : typeof payload.mediaId === 'string' && payload.mediaId.length > 0
          ? payload.mediaId
          : null,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}

@Service()
export class JobsService {
  async list(chainId: string, query: ChainJobsQuery): Promise<ChainJobListResponse> {
    const rows = await db
      .select()
      .from(outbox)
      .where(and(inArray(outbox.type, [...JOB_TYPES]), inArray(outbox.status, query.status)))
      .orderBy(desc(outbox.createdAt));

    const jobs: ChainJobDto[] = [];
    for (const row of rows) {
      const payload = asPayloadObject(row.payload);
      if (!payload || payload.chainId !== chainId) continue;
      const momentId = payload.momentId;
      if (typeof momentId !== 'string' || momentId.length === 0) {
        logger.warn('jobs: skip outbox row missing payload.momentId', { id: row.id, type: row.type });
        continue;
      }
      const dto = toDto(row, payload, momentId);
      if (!dto) continue;
      jobs.push(dto);
      if (jobs.length >= query.limit) break;
    }
    return { jobs };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/jobs/jobs.service.test.ts`
Expected: PASS。时间断言只钉 ISO 前缀 + 新旧 `Date.parse` 大小（避免 MySQL session TZ / timestamp fsp 把 `.000Z` 字面量打红）；排序契约以 **id 数组**为准。**禁止**为了绿灯删掉 `lastError` / `mediaId` 断言。脏行/他链 skip 不计入 `limit` 的两则也必须绿。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/jobs/jobs.service.ts apps/server/tests/jobs/jobs.service.test.ts
git commit -m "feat(server): list chain jobs from outbox with app-layer chainId filter"
```

---

### Task 3: `JobsController` + owner-only HTTP

**Files:**
- Create: `apps/server/src/jobs/jobs.controller.ts`
- Modify: `apps/server/src/app.ts`（import `JobsController`；`controllers` 数组**末尾**追加。禁止删除 `InternalEmbeddingsController` / `SearchController` / 任何既有项）
- Create: `apps/server/tests/jobs/jobs.http.test.ts`

**Interfaces:**
- Consumes:
  - `JobsService.list(chainId: string, query: ChainJobsQuery): Promise<ChainJobListResponse>`
  - `chainJobsQuerySchema.parse(req.query)`
  - `requireChainRole('owner')`（`apps/server/src/chains/require-chain-role.ts`）
  - `@Authorized()` + `@JsonController('/chains/:chainId/jobs')` + `@Get('/')`
  - 测试夹具：`registerUser` / `createChain` / `addMember` / `app`（`tests/helpers/fixtures.js`）
- Produces:
  - `class JobsController` `@Service()`
  - HTTP `GET /api/chains/:chainId/jobs` → 200 `ChainJobListResponse`
  - editor/viewer → 403 `CHAIN_ROLE_INSUFFICIENT`
  - 非成员 / 链不存在 → 404 `CHAIN_NOT_FOUND`
  - 未登录 → 401
  - 非法 status/limit → 400 `VALIDATION_ERROR`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/jobs/jobs.http.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import {
  OUTBOX_MOMENT_COMPRESS,
  OUTBOX_MOMENT_EMBED,
  OUTBOX_MOMENT_EXTRACT,
} from '../../src/outbox/types.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const MOMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEDIA_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(resetDb);
afterAll(closeDb);

async function insertJob(over: {
  type: string;
  status?: 'pending' | 'done' | 'failed';
  payload: object;
  createdAt: Date;
  processedAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(outbox).values({
    id,
    type: over.type,
    payload: over.payload,
    status: over.status ?? 'pending',
    attempts: over.attempts ?? 0,
    createdAt: over.createdAt,
    processedAt: over.processedAt ?? null,
    lastError: over.lastError ?? null,
  });
  return id;
}

const t = (sec: number) => new Date(Date.UTC(2026, 7, 29, 12, 0, sec));

describe('GET /api/chains/:chainId/jobs（spec §6.4 / §9）', () => {
  it('app.ts 注册 JobsController；controller 用 requireChainRole(owner)，不手写角色码', () => {
    const appSrc = readFileSync(path.join(SERVER_SRC, 'app.ts'), 'utf8');
    expect(appSrc).toContain('JobsController');
    expect(appSrc).toContain('RecapController');
    expect(appSrc).toContain('ShareLinksController');
    const ctrl = readFileSync(path.join(SERVER_SRC, 'jobs/jobs.controller.ts'), 'utf8');
    expect(ctrl).toContain("@JsonController('/chains/:chainId/jobs')");
    expect(ctrl).toContain('@Authorized()');
    expect(ctrl).toContain("requireChainRole('owner')");
    expect(ctrl).not.toContain('CHAIN_ROLE_INSUFFICIENT');
    expect(ctrl).not.toContain('ChainPolicy');
  });

  it('owner 200：映射 lastError/mediaId；默认不含 done 与 extract；createdAt 倒序', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id, '宝宝成长');
    await insertJob({
      type: OUTBOX_MOMENT_EXTRACT,
      payload: { momentId: MOMENT_A, chainId },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(8),
      processedAt: t(8),
    });
    const pendingId = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(7),
    });
    const failedId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(6),
      attempts: 2,
      lastError: 'OBJECT_TOO_LARGE',
      processedAt: t(6),
    });

    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['jobs']);
    expect(res.body.nextCursor).toBeUndefined();
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([pendingId, failedId]);
    expect(res.body.jobs[0]).toMatchObject({
      type: 'moment.compress',
      status: 'pending',
      momentId: MOMENT_A,
      mediaId: MEDIA_A,
      lastError: null,
    });
    expect(res.body.jobs[1]).toMatchObject({
      type: 'moment.embed',
      status: 'failed',
      momentId: MOMENT_A,
      mediaId: null,
      attempts: 2,
      lastError: 'OBJECT_TOO_LARGE',
    });
  });

  it('应用层 payload.chainId：他链更新的任务不出现在本链 GET', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(other.id);
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: otherChain, mediaId: MEDIA_A },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: otherChain },
      createdAt: t(8),
    });
    const own = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(1),
    });
    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([own]);
  });

  it('editor/viewer → 403 CHAIN_ROLE_INSUFFICIENT；非成员与不存在的链 → 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const viewer = await registerUser();
    const outsider = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, editor.id, 'editor');
    await addMember(chainId, viewer.id, 'viewer');

    const asEditor = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(asEditor.status).toBe(403);
    expect(asEditor.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asViewer = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asOutsider = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app)
      .get('/api/chains/99999999-9999-4999-8999-999999999999/jobs')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/jobs`);
    expect(anon.status).toBe(401);
  });

  it('非法 status / limit=51 → 400 VALIDATION_ERROR；?cursor= strip 仍 200', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    const badStatus = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ status: 'pending,nope' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR');

    const badLimit = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ limit: 51 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe('VALIDATION_ERROR');

    const withCursor = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ cursor: 'abc', before: '2026-08-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(withCursor.status).toBe(200);
    expect(withCursor.body).toEqual({ jobs: [] });
    expect(withCursor.body.nextCursor).toBeUndefined();
  });

  it('status=done 返回 done；默认不返回；v1 无重试端点', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const doneId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId },
      createdAt: t(1),
      processedAt: t(1),
    });

    const def = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(def.status).toBe(200);
    expect(def.body.jobs).toEqual([]);

    const done = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ status: 'done' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(done.status).toBe(200);
    expect(done.body.jobs).toHaveLength(1);
    expect(done.body.jobs[0].id).toBe(doneId);

    const retry = await request(app)
      .post(`/api/chains/${chainId}/jobs/${doneId}/retry`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(retry.status).toBe(404);
  });

  it('本链 51 条 pending：默认返回 50 条且是最新的；不含最早那条', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      ids.push(
        await insertJob({
          type: OUTBOX_MOMENT_COMPRESS,
          payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
          createdAt: t(i),
        }),
      );
    }
    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(50);
    expect(res.body.jobs[0].id).toBe(ids[50]);
    expect(res.body.jobs[49].id).toBe(ids[1]);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).not.toContain(ids[0]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/jobs/jobs.http.test.ts`
Expected: FAIL。红灯来源：`jobs.controller.ts` 不存在，和/或 `GET /api/chains/:id/jobs` 落 `notFoundFallback` 404 `NOT_FOUND`（不是 `CHAIN_NOT_FOUND`）。**不要**为了红灯去改 Task 2 service。若 `fixtures.js` 的 `app` 在本文件 import 时 `createApp()` 因缺 controller 仍能起（只是路由 404）——这正是本 Step 的失败形态。

- [ ] **Step 3: 实现 controller 并注册**

Create `apps/server/src/jobs/jobs.controller.ts`：
```ts
import { chainJobsQuerySchema, type ChainJobListResponse } from '@moment/dto';
import type { Request } from 'express';
import { Authorized, Get, JsonController, Param, Req, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { JobsService } from './jobs.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1）；仅 owner（spec fused-retrieval §6.4） */
@JsonController('/chains/:chainId/jobs')
@Service()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  list(@Param('chainId') chainId: string, @Req() req: Request): Promise<ChainJobListResponse> {
    const query = chainJobsQuerySchema.parse(req.query);
    return this.jobsService.list(chainId, query);
  }
}
```

Modify `apps/server/src/app.ts`：
1. 在其它 controller import 之后追加：
```ts
import { JobsController } from './jobs/jobs.controller.js';
```
2. 在 `useExpressServer` 的 `controllers: [` 数组**最后一个元素之后**追加 `JobsController`。若末项已是 `SearchController`，结果为 `..., SearchController, JobsController]`。禁止删除 `InternalEmbeddingsController`、`SearchController` 或任何既有项。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/jobs/jobs.http.test.ts tests/jobs/jobs.service.test.ts`
Expected: PASS。

回归（本 Task 动了 `app.ts`，确认既有链嵌套 owner 路由未掉）：
Run: `pnpm --filter @moment/server test -- tests/share/share-links.test.ts tests/health.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + dto 回归**

Run:
```bash
pnpm --filter @moment/dto test
pnpm --filter @moment/dto build
pnpm --filter @moment/server typecheck
```
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/jobs/jobs.controller.ts apps/server/src/app.ts apps/server/tests/jobs/jobs.http.test.ts
git commit -m "feat(server): add owner-only GET /api/chains/:chainId/jobs"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（`chainJobsQuerySchema` + P1 `ChainJobDto` 类型用例）
- [ ] `pnpm --filter @moment/dto build` exit 0
- [ ] `pnpm --filter @moment/server test -- tests/jobs/jobs.service.test.ts tests/jobs/jobs.http.test.ts` 全绿（脚本已 `--runInBand`）
- [ ] spec §9 jobs：owner 200；editor 403；非成员 404；不含 extract；默认不返回 done
- [ ] spec §6.4：应用层 `payload.chainId`；`ORDER BY created_at DESC`；无游标；`lastError` 来自 `outbox.last_error`；超过 50 截断；他链/脏行 skip 不计入 limit
- [ ] spec §11 P7 出口：角色测试绿
- [ ] `pnpm --filter @moment/server typecheck` exit 0
- [ ] 未泄漏 P8–P10：无 `listChainJobs`、无 web「处理中」、无 app、无 `backfill:embed`、无 search 改动、无重试路由
- [ ] CONVENTIONS §3.1：`chain-policy.ts` / `require-chain-role.ts` 零 diff；路由嵌套；controller 无手写角色判断；`CONVENTIONS.md` 文件零 diff
- [ ] `JobsService` 无 SQL `.limit()` / JSON 函数 / `ChainPolicy`；type 白名单（created/extract/recap 反例）

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P7）**：§6.4 嵌套 `GET /api/chains/:chainId/jobs`、`requireChainRole('owner')`、query csv+limit、只投影 compress/embed、应用层 `payload.chainId`、缺 `momentId` skip+warn、无游标、`ORDER BY created_at DESC`、超过 50 截断、`lastError`/`mediaId` 规则、v1 无重试；§6.6 `VALIDATION_ERROR`/`CHAIN_ROLE_INSUFFICIENT`/`CHAIN_NOT_FOUND`（不用 `INVALID_LIMIT`）；§8 jobs 仅 owner；§9 owner/editor/非成员/extract/默认 done；§10 无 jobs 游标/重试；§11 P7 出口角色测试绿。§7.4 处理中 UI / `listChainJobs` 属 P8。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：T1 `ChainJobsQuery` `{ status: Array<'pending'|'failed'|'done'>; limit: number }` 被 T2 `list` 与 T3 `parse(req.query)` 逐字消费；P1 `ChainJobDto` / `ChainJobListResponse` 零改名；`lastError` ↔ `outbox.last_error`；payload 形状与 P1 `MomentCompressPayload` / `MomentEmbedPayload` 一致。
- **CONVENTIONS §3.1**：路由嵌套；`chain-policy.ts` / `require-chain-role.ts` 零 diff；controller 源码锁禁止手写角色码。
