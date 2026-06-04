# Web 重设计（贴纸手账风 · 双主题 · 时光链 + 月份索引/日期锚定）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `2026-08-16-web-redesign-sticker-design.md` 重做 `apps/web` 全部视觉与交互体系（双主题贴纸手账风、时间线「时光链」签名、常驻 composer 入口 + FAB、宽屏右栏时间索引与筛选），并在服务端落地两个小能力：`GET /api/feed/month-index`（查看者时区月份归桶）与 feed/链内列表的 `before` 日期锚定。

**Architecture:** 服务端变更全部挂在既有 `apps/server/src/feed/` 模块与 `apps/server/src/moments/`：month-index 复用 `getMyChains` 的「我参与的链」过滤与 `moment_tags` semi-join，`before` 作为 `queryMomentPage` 的一个新增 AND 条件（与游标共存取更严上界）。dto 变更集中在 `packages/dto/src/feed.ts` 与 `moments.ts`，api-client 同步。Web 端：`tokens.css` 重写为 `:root`(浅) + `:root[data-theme='dark']`(深) 双套 token，`index.html` 内联阻塞 snippet 防 FOUC；得意黑（Smiley Sans）子集化后进 `public/fonts/`；组件逐个换肤，不新增全局 store，Query key 继续集中在 `src/api/keys.ts`。

**Tech Stack:** 继承既有（server: Express + routing-controllers + TypeDI + Drizzle + mysql2 + Jest/supertest；dto/api-client: zod 3 + tsx --test；web: Vite + React + Tailwind + TanStack Query）。Web 不新增运行时依赖；字体子集化用 fonttools（构建期一次性工具，不进 package.json dependencies）。

**Spec:** `docs/superpowers/specs/2026-08-16-web-redesign-sticker-design.md`（本文唯一依据）；功能面沿用 `docs/superpowers/specs/2026-08-16-web-product.md`；数据/权限权威 `docs/superpowers/specs/2026-08-15-moment-design.md`。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- **不改既有 HTTP 契约语义**：`GET /api/feed` 与 `GET /api/chains/:chainId/moments` 的既有参数、响应字段、游标格式（`src/feed/cursor.ts` 的 `{h,i}`/`{c,i}` base64url）一字不动；本计划只做**新增可选参数**（`before`、month-index 新端点）。
- **明确不做**（spec §0 非目标）：双向无限滚动；owner 删除他人时刻的 UI 入口（后端权限允许，UI 仍只给本人时刻 kebab，backlog）；移动端底栏；`chains` 表加 color 字段（链颜色由客户端 hash 推导，spec §1.4）。
- dto 变更走全套（packages/dto CLAUDE.md）：schema + 推导类型 + 同目录 `*.test.ts` + `index.ts` re-export + api-client 同步 + server 使用方。
- server 侧：挂 `src/feed/` 模块；权限走 `ChainPolicy`/`getMyChains`（feed 域惯例：请求入口一次查成员关系，主查询禁止 join `chain_members`）；业务错误 `HttpError` 系 + UPPER_SNAKE 机器码；触库测试 `beforeEach(resetDb)` + `afterAll(closeDb)`，`--runInBand`，严禁生产库。
- 色彩纪律（spec §1.1）：橙 `--action` = 动作、黄 `--select` = 选中/热态、墨 `--ink`/`--line` = 文字与描边，两主题语义对称；组件内禁止写死色值，禁止组件层按主题各自判断颜色；新用途先加 token。
- 得意黑只用于固定文案（字标「时刻」、空态标题、面板/页面固定标题字），动态内容（链名、昵称、正文）一律系统黑体；字体必须子集化 + `font-display: swap`，产物自包含不依赖 CDN（spec §1.3/§8）。
- 分享页 `/share/:token` 恒浅色：无视 localStorage 与系统偏好（spec §1.5），由 index.html 内联 snippet 按路径强制。
- Web 不新增组件测试框架（CONVENTIONS §4）：web 任务验收 = `typecheck` + `build` + `lint` + 该任务手测步骤。
- Tailwind 过渡别名：Task 5 在配置里保留旧类名（`paper/accent/accent-fg`）到新 token 的映射，保证未换肤组件在过渡期间不裸奔；Task 12 grep 确认零残留后删除别名。

## 现状代码依赖契约（本计划消费的既有符号，不得改名）

```ts
// apps/server/src/feed/moment-query.ts
export interface MomentPageQuery { chainIds: string[]; order: MomentOrder; limit: number; cursor?: string; tagId?: string }
export function queryMomentPage(query: MomentPageQuery): Promise<{ rows: Moment[]; nextCursor: string | null }>;
// apps/server/src/feed/membership.ts
export function getMyChains(userId: string): Promise<Map<string, ChainRole>>;
// apps/server/src/feed/cursor.ts — 游标编解码不改
export type MomentOrder = 'happened_at' | 'created_at';
// apps/server/src/feed/feed.controller.ts — @JsonController() + @Get('/feed')，feedQuerySchema.parse(req.query)
// apps/server/src/feed/feed.service.ts — FeedService.feed(userId, FeedQueryParsed)
// apps/server/src/moments/moment.service.ts
//   list(userId, chainId, query: { cursor?: string; limit?: string }): Promise<MomentListResponse>  // limit 超限抛 BadRequestError('INVALID_LIMIT')
// apps/server/src/moments/moment.controller.ts — list 用 listMomentsQuerySchema.parse({ cursor, limit })
// apps/server/tests/helpers/fixtures.ts
export const app; registerUser(); createChain(ownerId, name?); addMember(chainId, userId, role);
insertMoment({ chainId, authorId, happenedAt, createdAt?, content?, isBackfill?, deletedAt? }); attachTag(momentId, tagId);
// packages/dto/src/feed.ts — feedQuerySchema / FeedResponse；packages/dto/src/moments.ts — listMomentsQuerySchema / MomentListResponse（注意键为 items）
// packages/api-client/src/client.ts — FeedQuery{cursor?,chainIds?,tagId?,order?,limit?}；getFeed 序列化为 snake_case；
//   listChainMoments 已做 items→moments 兼容映射；client.test.ts 有 harness() mock-fetch 风格
// apps/web/src/api/keys.ts — qk.feed({chainIds?,tagId?,order})，变更后 invalidate 用 ['feed'] 前缀（month-index key 以 'feed' 开头即可被同一前缀扫到）
// apps/web/src/lib/time.ts — formatHappenedAt(iso, tzOffset)（作者本地墙钟 = UTC − offset）、currentTzOffset()
// apps/web/src/lib/roles.ts — canCompose(chain)（owner/editor）
// apps/web/src/shell/Shell.tsx — showCompose 逻辑（currentChain ? canCompose(currentChain) : chains.some(canCompose)）
// apps/web/src/compose/ComposeContext.tsx — openCompose({ chainId?, edit? })，全站唯一发布 modal（ComposePanel 挂在 Shell）
```

---

### Task 1: dto — monthIndexQuerySchema + before（feed & 链内列表）（TDD）

**Files:**
- Test: `packages/dto/src/feed.test.ts`（追加用例）、`packages/dto/src/moments.test.ts`（若无此文件则新建，专测 listMomentsQuerySchema）
- Modify: `packages/dto/src/feed.ts`
- Modify: `packages/dto/src/moments.ts`

**Interfaces:**
- Consumes: 既有 `feedQuerySchema`/`listMomentsQuerySchema`。
- Produces（Task 2/3/4 依赖，不得改名）:
  - `monthIndexQuerySchema` / `MonthIndexQueryInput`：`{ chain_ids?: string(逗号分隔 uuid); tag_id?: uuid; tz_offset: number(必填, int, -840..840, z.coerce) }`
  - `MonthIndexEntry = { month: string; count: number }`（month 为 `'%Y-%m'`）；`MonthIndexResponse = { months: MonthIndexEntry[] }`
  - `feedQuerySchema` 新增可选 `before`（ISO datetime 字符串），且 `before + order=created_at` 被 superRefine 拒绝
  - `listMomentsQuerySchema` 新增可选 `before`（不加 order 字段，spec §4.2 明确禁止顺手加）

- [ ] **Step 1: 写失败测试**

`packages/dto/src/feed.test.ts` 追加（保留既有 5 个用例不动）：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedQuerySchema, monthIndexQuerySchema } from './feed.js';

test('feedQuerySchema before 接受 ISO datetime，缺省为 undefined', () => {
  assert.equal(feedQuerySchema.parse({}).before, undefined);
  const q = feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' });
  assert.equal(q.before, '2026-08-01T00:00:00.000Z');
});

test('feedQuerySchema before 拒绝非法 datetime', () => {
  assert.throws(() => feedQuerySchema.parse({ before: 'not-a-date' }));
  assert.throws(() => feedQuerySchema.parse({ before: '2026-13-99' }));
});

test('feedQuerySchema 拒绝 before + order=created_at（VALIDATION_ERROR 路径）', () => {
  assert.throws(() =>
    feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z', order: 'created_at' }),
  );
  // before + 默认 order(happened_at) 合法
  assert.equal(
    feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' }).order,
    'happened_at',
  );
});

test('monthIndexQuerySchema tz_offset 必填且为 -840..840 的整数（coerce）', () => {
  assert.throws(() => monthIndexQuerySchema.parse({})); // 缺省 → coerce(undefined)=NaN → 拒绝
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: 'abc' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '841' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '-841' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '-480.5' }));
  assert.equal(monthIndexQuerySchema.parse({ tz_offset: '-480' }).tz_offset, -480);
});

test('monthIndexQuerySchema chain_ids/tag_id 规则与 feedQuerySchema 一致', () => {
  const ok = monthIndexQuerySchema.parse({
    tz_offset: '0',
    chain_ids: '00000000-0000-4000-8000-000000000001',
    tag_id: '00000000-0000-4000-8000-000000000002',
  });
  assert.equal(ok.chain_ids, '00000000-0000-4000-8000-000000000001');
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '0', chain_ids: 'not-uuid' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '0', tag_id: 'nope' }));
});
```

`packages/dto/src/moments-list.test.ts`（新建；若已有专测 listMomentsQuerySchema 的文件则并入该文件）：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listMomentsQuerySchema } from './moments.js';

test('listMomentsQuerySchema before 可选且必须是合法 datetime', () => {
  assert.equal(listMomentsQuerySchema.parse({}).before, undefined);
  assert.equal(
    listMomentsQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' }).before,
    '2026-08-01T00:00:00.000Z',
  );
  assert.throws(() => listMomentsQuerySchema.parse({ before: 'garbage' }));
});

test('listMomentsQuerySchema 既有行为不回退：cursor/limit 原样', () => {
  const q = listMomentsQuerySchema.parse({ cursor: 'abc', limit: '50' });
  assert.equal(q.cursor, 'abc');
  assert.equal(q.limit, '50'); // limit 仍是 string，service 层解析（INVALID_LIMIT 语义不动）
  assert.throws(() => listMomentsQuerySchema.parse({ cursor: '' }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`before`/`monthIndexQuerySchema` 不存在）

- [ ] **Step 3: 实现**

`packages/dto/src/feed.ts` 全文替换为：
```ts
import { z } from 'zod';
import type { MomentResponse } from './moments.js';

const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime 字符串：先正则限定 ISO 形态（防 `2026/08/01` 这类 Date.parse 宽松解析漏网），再校验可解析 */
const isoDatetime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, 'INVALID_TIMESTAMP')
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'INVALID_TIMESTAMP' });

const chainIdsCsv = z
  .string()
  .refine((v) => typeof v === 'string' && v.split(',').every((id) => uuidLoose.test(id)), {
    message: 'chain_ids 必须是逗号分隔的 uuid',
  })
  .optional();

export const feedQuerySchema = z
  .object({
    /** opaque 游标（base64url(JSON)），首页不传 */
    cursor: z.string().min(1).max(1024).optional(),
    /** 逗号分隔的链 id，仅用于在「我的链」范围内收窄（参数名遵循 spec §4 snake_case） */
    chain_ids: chainIdsCsv,
    tag_id: z.string().regex(uuidLoose).optional(),
    /** happened_at=事件时间（默认）；created_at=添加时间（补发可见，spec §5.6） */
    order: z.enum(['happened_at', 'created_at']).default('happened_at'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** 日期锚定（spec §4.2）：happened_at < before，严格小于；与 cursor 同传取更严上界 */
    before: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.before !== undefined && val.order === 'created_at') {
      // before 仅 happened_at 语义；created_at 下 happened_at 非单调，锚定无意义（spec §4.2）
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BEFORE_REQUIRES_HAPPENED_AT', path: ['before'] });
    }
  });
export type FeedQueryInput = z.infer<typeof feedQuerySchema>;

export interface FeedResponse {
  moments: MomentResponse[];
  /** 还有下一页时为 opaque 游标，否则 null */
  nextCursor: string | null;
}

export const monthIndexQuerySchema = z.object({
  chain_ids: chainIdsCsv,
  tag_id: z.string().regex(uuidLoose).optional(),
  /**
   * 查看者时区偏移（必填；分钟，语义同 JS getTimezoneOffset，东八区 = -480）。
   * 归桶：happened_at − INTERVAL tz_offset MINUTE 后取 '%Y-%m'（spec §4.1）。
   */
  tz_offset: z.coerce.number().int().min(-840).max(840),
});
export type MonthIndexQueryInput = z.infer<typeof monthIndexQuerySchema>;

export interface MonthIndexEntry {
  /** '%Y-%m'，查看者时区归桶 */
  month: string;
  count: number;
}

export interface MonthIndexResponse {
  /** 按月倒序；空范围为空数组 */
  months: MonthIndexEntry[];
}
```

`packages/dto/src/moments.ts` 修改点（一处增量）：`listMomentsQuerySchema` 的对象字面量追加一个字段（复用文件内既有 `isoTimestampSchema`，其余不动）：
```ts
export const listMomentsQuerySchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.string().optional(),
  /** 日期锚定（spec §4.2）：happened_at < before；链内列表恒 happened_at 语义，天然可用 */
  before: isoTimestampSchema.optional(),
});
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 新增 6 个用例 PASS，既有全部 PASS，`dist/feed.d.ts` 含新类型。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): feed before 锚定与 month-index 查询 schema/类型"
```

---

### Task 2: api-client — getMonthIndex + before 透传（TDD）

**Files:**
- Test: `packages/api-client/src/client.test.ts`（追加一个 test）
- Modify: `packages/api-client/src/client.ts`

**Interfaces:**
- Consumes: Task 1 的 `MonthIndexResponse`；既有 `FeedQuery`/`MomentClient`/harness 测试风格。
- Produces（Task 10 依赖，不得改名）:
  - `FeedQuery` 新增 `before?: string`；`getFeed` 序列化多出 `before`
  - `listChainMoments(chainId, query?: { cursor?: string; limit?: number; before?: string })` 透传 `before`
  - `MomentClient.getMonthIndex(query: { chainIds?: string[]; tagId?: string; tzOffset: number }): Promise<MonthIndexResponse>` → `GET /api/feed/month-index?chain_ids=&tag_id=&tz_offset=`

- [ ] **Step 1: 写失败测试**

`packages/api-client/src/client.test.ts` 文件末尾追加：
```ts
test('feed before 与 month-index 路径/查询参数', async () => {
  const { client, calls } = harness();
  await client.getFeed({ before: '2026-09-01T00:00:00.000Z', order: 'happened_at', limit: 50 });
  await client.listChainMoments('c1', { before: '2026-09-01T00:00:00.000Z' });
  await client.getMonthIndex({ chainIds: ['c1', 'c2'], tagId: 't1', tzOffset: -480 });
  await client.getMonthIndex({ tzOffset: 0 });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/feed?order=happened_at&limit=50&before=2026-09-01T00%3A00%3A00.000Z',
      'GET http://x/api/chains/c1/moments?before=2026-09-01T00%3A00%3A00.000Z',
      'GET http://x/api/feed/month-index?chain_ids=c1%2Cc2&tag_id=t1&tz_offset=-480',
      'GET http://x/api/feed/month-index?tz_offset=0',
    ],
  );
});
```
（若 `Http` 的 query 序列化键序与上方不同，以 `http.ts` 的对象键序实际输出为准调整期望串——序列化顺序由实现决定，但四个 URL 的路径、参数名与值必须逐项一致；不允许为此改 `http.ts`。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL（`getMonthIndex` 不是函数；URL 中无 `before`）

- [ ] **Step 3: 实现**

`packages/api-client/src/client.ts` 三处增量：

1. `FeedQuery` 接口追加（保留既有字段）：
```ts
  /** 日期锚定（spec §4.2）：ISO datetime，服务端按 happened_at < before 严格小于过滤 */
  before?: string;
```
2. `MomentClient` 接口追加方法签名 + `listChainMoments` 的 query 类型加 `before?: string`；import 区从 `@moment/dto` 加 `MonthIndexResponse` 类型。
3. 实现对象中：
```ts
    listChainMoments: async (chainId, query) => {
      // query 序列化对象追加 before: query?.before（其余原样）
    },
    getFeed: (query) =>
      http.request('/api/feed', {
        query: {
          cursor: query?.cursor,
          chain_ids: query?.chainIds?.join(','),
          tag_id: query?.tagId,
          order: query?.order,
          limit: query?.limit,
          before: query?.before,
        },
      }),
    getMonthIndex: (query) =>
      http.request('/api/feed/month-index', {
        query: {
          chain_ids: query.chainIds?.join(','),
          tag_id: query.tagId,
          tz_offset: query.tzOffset,
        },
      }),
```
（`undefined` 值的省略行为沿用 `http.ts` 既有实现，不改。）

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build`
Expected: 新用例 PASS（4 个 URL 精确匹配），既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): getMonthIndex 方法与 feed/链内列表 before 透传"
```

---

### Task 3: server — `GET /api/feed/month-index`（TDD）

**Files:**
- Test: `apps/server/tests/feed/month-index.test.ts`
- Create: `apps/server/src/feed/month-index.ts`
- Modify: `apps/server/src/feed/feed.controller.ts`（加路由方法）
- Modify: `apps/server/src/feed/feed.service.ts`（加 `monthIndex` 方法）

**Interfaces:**
- Consumes: `getMyChains`、`moments`/`momentTags` 表、Task 1 的 `monthIndexQuerySchema`/`MonthIndexResponse`。
- Produces: HTTP `GET /api/feed/month-index?chain_ids=&tag_id=&tz_offset=`（登录即可，范围=我的链；非成员链 id 静默忽略；空范围返回 `{months: []}`）。

- [ ] **Step 1: 写失败测试**

`apps/server/tests/feed/month-index.test.ts`：
```ts
import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 东八区（tz_offset=-480）下 2026-08-01 00:30 本地 = UTC 2026-07-31 16:30 */
const AUG_LOCAL = new Date('2026-07-31T16:30:00Z');

describe('GET /api/feed/month-index', () => {
  it('按查看者时区归桶：同一 UTC 时刻，不同 tz_offset 落不同月', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: AUG_LOCAL });

    const east8 = await request(app).get('/api/feed/month-index?tz_offset=-480').set(auth(owner.token));
    expect(east8.status).toBe(200);
    expect(east8.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });

    const utc = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(owner.token));
    expect(utc.status).toBe(200);
    expect(utc.body).toEqual({ months: [{ month: '2026-07', count: 1 }] });
  });

  it('多月倒序聚合；同月计数；软删排除', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-10T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-20T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-15T00:00:00Z'), deletedAt: new Date(),
    });

    const res = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      months: [
        { month: '2026-08', count: 2 },
        { month: '2026-06', count: 1 },
      ],
    });
  });

  it('chain_ids 收窄到我的链子集；非成员链静默忽略；空范围返回 []', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const chainA = await createChain(alice.id, 'A');
    const chainC = await createChain(carol.id, 'C');
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z') });
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-08-02T00:00:00Z') });

    const narrowed = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&chain_ids=${chainA},${chainC}`)
      .set(auth(alice.token));
    expect(narrowed.status).toBe(200);
    expect(narrowed.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });

    const allForeign = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&chain_ids=${chainC}`)
      .set(auth(alice.token));
    expect(allForeign.status).toBe(200);
    expect(allForeign.body).toEqual({ months: [] });

    const loner = await registerUser();
    const empty = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(loner.token));
    expect(empty.body).toEqual({ months: [] });
  });

  it('tag_id 过滤：只统计带该 tag 的 moment', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const tagRes = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagged = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-02T00:00:00Z') });
    await attachTag(tagged, tagRes.body.id);

    const res = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&tag_id=${tagRes.body.id}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });
  });

  it('viewer 成员身份即可读（索引只要求成员资格，与 feed 一致）', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const res = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(1);
  });

  it('缺省/非法 tz_offset → 400 VALIDATION_ERROR；未登录 401', async () => {
    const owner = await registerUser();
    const missing = await request(app).get('/api/feed/month-index').set(auth(owner.token));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const bad = await request(app).get('/api/feed/month-index?tz_offset=abc').set(auth(owner.token));
    expect(bad.status).toBe(400);

    const outOfRange = await request(app).get('/api/feed/month-index?tz_offset=900').set(auth(owner.token));
    expect(outOfRange.status).toBe(400);

    const anon = await request(app).get('/api/feed/month-index?tz_offset=0');
    expect(anon.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- month-index`
Expected: FAIL（404）

- [ ] **Step 3: 实现**

`apps/server/src/feed/month-index.ts`（新建）：
```ts
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { MonthIndexResponse } from '@moment/dto';
import { db } from '../db/index.js';
import { moments, momentTags } from '../db/schema.js';

/**
 * 月份索引（spec §4.1）：按「查看者时区」归桶——
 *   happened_at − INTERVAL tz_offset MINUTE 后取 DATE_FORMAT '%Y-%m' 聚合 count。
 * tz_offset 语义同 JS getTimezoneOffset（东八区 = -480），已由 dto 校验为 -840..840 整数。
 *
 * 刻意保留的不一致（spec §4.1 定稿）：索引归桶用查看者时区，而卡片/日期贴纸展示用
 * 作者本地（happened_tz_offset）。跨时区家庭在月首/月末可能差一两条——索引是导航辅助
 * 不是账本，接受。
 */
export async function queryMonthIndex(query: {
  chainIds: string[];
  tagId?: string;
  tzOffset: number;
}): Promise<MonthIndexResponse> {
  if (query.chainIds.length === 0) return { months: [] };

  const monthExpr = sql<string>`DATE_FORMAT(${moments.happenedAt} - INTERVAL ${query.tzOffset} MINUTE, '%Y-%m')`;
  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];
  if (query.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db.select({ id: momentTags.momentId }).from(momentTags).where(eq(momentTags.tagId, query.tagId)),
      ),
    );
  }

  const rows = await db
    .select({ month: monthExpr, count: sql<number>`COUNT(*)` })
    .from(moments)
    .where(and(...conditions))
    .groupBy(monthExpr)
    .orderBy(desc(monthExpr));

  return { months: rows.map((r) => ({ month: r.month, count: Number(r.count) })) };
}
```

`apps/server/src/feed/feed.service.ts` 修改点：import 区加 `import { queryMonthIndex } from './month-index.js';` 与 `import type { MonthIndexResponse } from '@moment/dto';`，`FeedService` 类内追加：
```ts
  /** 月份索引：与 feed 同一可见范围（我的链；chain_ids 收窄时静默过滤非成员链）。 */
  async monthIndex(
    userId: string,
    query: { chainIds?: string[]; tagId?: string; tzOffset: number },
  ): Promise<MonthIndexResponse> {
    const myChains = await getMyChains(userId);
    let scope = [...myChains.keys()];
    if (query.chainIds) {
      scope = query.chainIds.filter((id) => myChains.has(id));
    }
    return queryMonthIndex({ chainIds: scope, tagId: query.tagId, tzOffset: query.tzOffset });
  }
```

`apps/server/src/feed/feed.controller.ts` 修改点：import 区加 `monthIndexQuerySchema` 与 `MonthIndexResponse` 类型；类内追加（与既有 `feed` 方法并列，`/feed/month-index` 与 `/feed` 无路由冲突）：
```ts
  @Get('/feed/month-index')
  @Authorized()
  monthIndex(@Req() req: Request, @CurrentUser() user: UserProfile): Promise<MonthIndexResponse> {
    const query = monthIndexQuerySchema.parse(req.query);
    return this.feedService.monthIndex(user.id, {
      chainIds: query.chain_ids?.split(','),
      tagId: query.tag_id,
      tzOffset: query.tz_offset,
    });
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: month-index 6 个用例 PASS，既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): feed month-index（查看者时区归桶/tag 过滤/链收窄）"
```

---

### Task 4: server — `before` 日期锚定（feed + 链内列表）（TDD）

**Files:**
- Test: `apps/server/tests/feed/feed-before.test.ts`
- Modify: `apps/server/src/feed/moment-query.ts`（`MomentPageQuery` 加 `before`，查询加 AND 条件）
- Modify: `apps/server/src/feed/feed.service.ts`（`FeedQueryParsed` 加 `before` 并透传）
- Modify: `apps/server/src/feed/feed.controller.ts`（透传 `query.before`）
- Modify: `apps/server/src/moments/moment.controller.ts`（`listMomentsQuerySchema.parse({ cursor, limit, before })`）
- Modify: `apps/server/src/moments/moment.service.ts`（`list` 的 query 类型加 `before?: string` 并透传）

**Interfaces:**
- Consumes: Task 1 的 dto（`feedQuerySchema.before` + superRefine、`listMomentsQuerySchema.before`）、`queryMomentPage`。
- Produces: `MomentPageQuery` 新增 `before?: string`；feed 与链内列表支持 `?before=<ISO>`（`happened_at < before` 严格小于；与 `cursor` 同传 AND 取更严上界）。游标格式与解码逻辑（cursor.ts）不动。

- [ ] **Step 1: 写失败测试**

`apps/server/tests/feed/feed-before.test.ts`：
```ts
import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const jul = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-15T00:00:00Z') });
  const augEdge = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00.000Z') });
  const aug = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-20T00:00:00Z') });
  return { owner, chainId, jul, augEdge, aug };
}

describe('GET /api/feed?before=', () => {
  it('单独锚定：只返回 happened_at 严格小于 before 的（等于 before 的那条不出现）', async () => {
    const { owner, jul, augEdge, aug } = await setup();
    const res = await request(app)
      .get(`/api/feed?before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const ids = res.body.moments.map((m: { id: string }) => m.id);
    expect(ids).toEqual([jul]); // augEdge 恰好等于 before：严格小于 → 排除；aug 更晚 → 排除
    void augEdge;
    void aug;
  });

  it('before 与 cursor 同传：AND 取更严上界，翻页不越界', async () => {
    const { owner, chainId } = await setup();
    // 7 月再补 3 条，limit=2 翻页验证不会翻到 8 月
    for (let i = 1; i <= 3; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(`2026-07-0${i}T00:00:00Z`) });
    }
    const before = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const p1 = await request(app).get(`/api/feed?before=${before}&limit=2`).set(auth(owner.token));
    expect(p1.status).toBe(200);
    expect(p1.body.moments).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/api/feed?before=${before}&limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set(auth(owner.token));
    expect(p2.status).toBe(200);
    const ids = [...p1.body.moments, ...p2.body.moments].map((m: { happenedAt: string }) => m.happenedAt);
    expect(ids.every((h: string) => Date.parse(h) < Date.parse('2026-08-01T00:00:00.000Z'))).toBe(true);
    expect(p2.body.moments).toHaveLength(2);
  });

  it('before + order=created_at → 400 VALIDATION_ERROR（dto superRefine）', async () => {
    const { owner } = await setup();
    const res = await request(app)
      .get(`/api/feed?order=created_at&before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('before 非法值 → 400 VALIDATION_ERROR', async () => {
    const { owner } = await setup();
    const res = await request(app).get('/api/feed?before=not-a-date').set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/chains/:chainId/moments?before=', () => {
  it('链内列表同样支持 before（恒 happened_at 语义），含严格小于边界', async () => {
    const { owner, chainId, jul } = await setup();
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((m: { id: string }) => m.id);
    expect(ids).toEqual([jul]);

    const bad = await request(app)
      .get(`/api/chains/${chainId}/moments?before=garbage`)
      .set(auth(owner.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- feed-before`
Expected: FAIL（`before` 被 schema 拒绝或被忽略导致断言不符）

- [ ] **Step 3: 实现**

`apps/server/src/feed/moment-query.ts` 修改点：
1. `MomentPageQuery` 接口追加：
```ts
  /** 日期锚定：happened_at < before（严格小于）。仅 happened_at 语义下由调用方传入。 */
  before?: string;
```
2. `queryMomentPage` 函数体内、`if (cursor)` 块之后追加（注释为规范说明，代码为完整增量）：
```ts
  // before 与 cursor 共存：两个条件都进 conditions，AND 取更严上界（spec §4.2）。
  // order=created_at + before 已在 feedQuerySchema 层拒绝；链内列表恒 happened_at。
  // 防御：万一未来出现 created_at + before 的调用方，宁可忽略 before 也不对错列做锚定。
  if (query.before && query.order === 'happened_at') {
    conditions.push(lt(moments.happenedAt, new Date(query.before)));
  }
```

`apps/server/src/feed/feed.service.ts` 修改点：`FeedQueryParsed` 加 `before?: string`；`feed` 方法中 `queryMomentPage({...})` 调用加 `before: query.before`。

`apps/server/src/feed/feed.controller.ts` 修改点：`feed` 方法的 service 调用对象加 `before: query.before`。

`apps/server/src/moments/moment.controller.ts` 修改点：`list` 方法加 `@QueryParam('before', { required: false, type: String }) before: string | undefined` 参数，`listMomentsQuerySchema.parse({ cursor, limit, before })`。

`apps/server/src/moments/moment.service.ts` 修改点：`list` 的 query 形参类型改为 `{ cursor?: string; limit?: string; before?: string }`，`queryMomentPage({...})` 调用加 `before: query.before`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: feed-before 5 个用例 PASS；既有 feed/moments 测试全部 PASS（回归）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): feed 与链内 moments 支持 before 日期锚定"
```

---

### Task 5: web tokens 双主题 + 防 FOUC + Tailwind 映射 + 得意黑字体子集

**Files:**
- Modify: `apps/web/src/styles/tokens.css`（整体重写）
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/index.html`（删 Google Fonts 外链，加内联防 FOUC snippet + 字体 preload）
- Create: `apps/web/public/fonts/smiley-sans-subset.woff2`（子集化产物，二进制）
- Create: `apps/web/public/fonts/OFL.txt`（得意黑 SIL OFL 许可证，随字体分发）
- Create: `apps/web/scripts/font-glyphs.txt`（子集字形清单，纯文本）

**Interfaces:**
- Consumes: 无（纯样式层）。
- Produces（Task 6–12 依赖）:
  - CSS 变量：`--bg --surface --ink --muted --line --shadow --action --action-fg --select --danger --content --ease` + `--sticker-{pink,blue,mint,purple}` + `--sticker-{pink,blue,mint,purple}-line`
  - Tailwind 色名：`bg surface ink muted line action action-fg select danger sticker-{pink,blue,mint,purple} sticker-{pink,blue,mint,purple}-line`；shadow `card`/`sticker`；radius `card`/`sticker`；`max-w-content`（680px）
  - 过渡别名（Task 12 删除）：色 `paper accent accent-fg`、shadow `paper`、radius `paper`
  - `.font-display` 指向得意黑子集 + 系统黑体回退
  - `<html data-theme="light|dark">` 在首绘前已就位（无 FOUC）

- [ ] **Step 1: 重写 tokens.css**

`apps/web/src/styles/tokens.css` 全文替换为（色值逐行照抄 spec §1.1，禁止自创）：
```css
:root {
  --bg: #fdf0d9;
  --surface: #fffdf8;
  --ink: #241a0b;
  --muted: #a68d5f;
  --line: #241a0b;
  --shadow: rgba(36, 26, 11, 0.1);
  --action: #f4552f;
  --action-fg: #ffffff;
  --select: #ffc94d;
  --danger: #c93a2e;
  /* 贴纸四色：仅装饰，由 chainColor(chainId) 轮换，永不表意（spec §1.1/§1.4） */
  --sticker-pink: #ffd9e6;
  --sticker-blue: #cfe8ff;
  --sticker-mint: #bfe8d0;
  --sticker-purple: #e6dbff;
  /* 浅色下贴纸描边同 --line（深墨） */
  --sticker-pink-line: var(--line);
  --sticker-blue-line: var(--line);
  --sticker-mint-line: var(--line);
  --sticker-purple-line: var(--line);
  --content: 680px; /* spec §2：由 720 微调，配合链条缩进 */
  --ease: 180ms ease;
  color-scheme: light;
}

:root[data-theme='dark'] {
  --bg: #171208;
  --surface: #221b10;
  --ink: #f2e8d5;
  --muted: #99855f;
  --line: #4d4231; /* 深色结构线主动后退、低对比 */
  --shadow: rgba(0, 0, 0, 0.45);
  --danger: #ff8a66;
  /* --action/--action-fg/--select 两主题同值，不重定义 */
  --sticker-pink: #3a2831;
  --sticker-blue: #233244;
  --sticker-mint: #22392f;
  --sticker-purple: #2e2842;
  --sticker-pink-line: #8a5a70;
  --sticker-blue-line: #56759c;
  --sticker-mint-line: #4d7a67;
  --sticker-purple-line: #6a5f94;
  color-scheme: dark;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --ease: 1ms linear;
  }
}
```

- [ ] **Step 2: Tailwind 映射**

`apps/web/tailwind.config.js` 全文替换为：
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        action: 'var(--action)',
        'action-fg': 'var(--action-fg)',
        select: 'var(--select)',
        danger: 'var(--danger)',
        'sticker-pink': 'var(--sticker-pink)',
        'sticker-blue': 'var(--sticker-blue)',
        'sticker-mint': 'var(--sticker-mint)',
        'sticker-purple': 'var(--sticker-purple)',
        'sticker-pink-line': 'var(--sticker-pink-line)',
        'sticker-blue-line': 'var(--sticker-blue-line)',
        'sticker-mint-line': 'var(--sticker-mint-line)',
        'sticker-purple-line': 'var(--sticker-purple-line)',
        // —— 过渡别名（换肤任务逐个迁走，Task 12 删除）——
        paper: 'var(--bg)',
        accent: 'var(--action)',
        'accent-fg': 'var(--action-fg)',
      },
      boxShadow: {
        card: '4px 4px 0 var(--shadow)',
        sticker: '2px 2px 0 var(--shadow)',
        paper: '4px 4px 0 var(--shadow)', // 过渡别名
      },
      borderRadius: {
        card: '16px',
        sticker: '99px',
        paper: '16px', // 过渡别名
      },
      maxWidth: {
        content: 'var(--content)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: index.css（字体栈 + @font-face + 焦点色）**

`apps/web/src/index.css` 修改点：
1. `:root` 块：`background-color: var(--paper)` → `var(--bg)`（两处，含 `body`），删除独立 `color-scheme: light;` 行（已挪进 tokens.css 分主题声明）。
2. `.font-display` 替换为：
```css
.font-display {
  /* 得意黑子集只含固定文案字形（scripts/font-glyphs.txt）；动态内容禁用此类，走系统黑体 */
  font-family: 'Smiley Sans', system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
```
3. 文件顶部 `@import './styles/tokens.css';` 之后追加：
```css
@font-face {
  font-family: 'Smiley Sans';
  src: url('/fonts/smiley-sans-subset.woff2') format('woff2');
  font-display: swap;
}
```
4. 焦点色 `outline: 2px solid var(--accent)` → `var(--action)`。

- [ ] **Step 4: index.html 防 FOUC + 去 CDN 字体**

`apps/web/index.html` 修改点：
1. 删除两行 preconnect 与 `Noto+Serif+SC` stylesheet 共三个 `<link>`（旧衬线栈整体移除，字体自包含）。
2. `<head>` 内 `<title>` 之后追加（必须内联且在样式表生效前执行，这是防 FOUC 的唯一屏障）：
```html
    <script>
      // 防 FOUC：首绘前定下 data-theme。分享页恒浅（spec §1.5：无视 localStorage 与系统偏好）。
      (function () {
        var t = 'system';
        try {
          t = localStorage.getItem('moment:theme') || 'system';
        } catch (e) {}
        if (location.pathname.indexOf('/share/') === 0) t = 'light';
        if (t !== 'light' && t !== 'dark') {
          t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.dataset.theme = t;
      })();
    </script>
    <link rel="preload" href="/fonts/smiley-sans-subset.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 5: 得意黑子集化**

得意黑（Smiley Sans，SIL OFL）从官方 release 获取（atelier-anchor/smiley-sans）。字形清单只覆盖**固定文案**（spec §1.3：动态内容一律系统黑体）。执行：

1. 创建 `apps/web/scripts/font-glyphs.txt`，内容为以下固定文案的并集（每行一句，子集工具自动去重；后续新增固定标题文案时必须同步追加此文件并重跑子集命令）：
```
时刻
我的时间线
记下此刻
改这条时刻
设置
通知
还没有记下任何一刻
建第一条时光链，比如「宝宝成长」
没有符合条件的时刻
这本相册的分享已关闭
加载失败，请稍后重试
还没有内容
```
2. 下载字体并子集化（一次性本机命令，产物入库；无网络时由人工放置等价文件）：
```bash
cd apps/web
curl -L -o /tmp/SmileySans.zip https://github.com/atelier-anchor/smiley-sans/releases/latest/download/smiley-sans.zip
unzip -o /tmp/SmileySans.zip -d /tmp/smiley-sans
pip install fonttools brotli  # 或：uv tool run --with brotli fonttools pyftsubset ...
pyftsubset /tmp/smiley-sans/SmileySans-Oblique.ttf.woff2 \
  --output-file=public/fonts/smiley-sans-subset.woff2 \
  --flavor=woff2 --text-file=scripts/font-glyphs.txt \
  --layout-features='*' --no-hinting --desubroutinize
cp /tmp/smiley-sans/OFL.txt public/fonts/OFL.txt
```
（zip 内确切文件名以 release 内容为准；只取 woff2 一个源文件。）
3. 校验产物：Run: `ls -la apps/web/public/fonts/`
Expected: `smiley-sans-subset.woff2` 存在且体积 < 200KB（全量 MB 级，子集后必须骤降）；`OFL.txt` 存在。

- [ ] **Step 6: 构建 + 手测双主题**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿（Tailwind 对未知旧类名不报错，视觉由下一步手测确认）。

手测（`pnpm --filter @moment/web dev`）：
1. 开任意页面 → DevTools 查 `<html data-theme>` 存在；默认跟随系统。
2. 控制台执行 `localStorage.setItem('moment:theme','dark')` 后刷新 → 首屏即深色、无浅→深闪烁（慢网 3G 节流下复验一次）。
3. 再设 `'light'` 刷新为浅色；`/share/<任意token>` 页面在 dark 设置下仍恒浅（`data-theme="light"`）。
4. 标题（「我的时间线」等 `.font-display` 处）以得意黑渲染、无回退方块；若子集漏字形此处会立刻暴露 → 补 `font-glyphs.txt` 重跑 Step 5。

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): 双主题 tokens、防 FOUC、Tailwind 映射与得意黑子集字体"
```

---

### Task 6: web ui 基础组件 + MediaBlock + Lightbox 换肤

**Files:**
- Modify: `apps/web/src/ui/Button.tsx`、`Field.tsx`、`Banner.tsx`、`Confirm.tsx`、`Avatar.tsx`
- Modify: `apps/web/src/media/MediaBlock.tsx`
- Modify: `apps/web/src/timeline/Lightbox.tsx`
- Create: `apps/web/src/ui/Menu.tsx`（通用 kebab/弹出菜单，Task 8 表情浮层与 kebab 复用）

**Interfaces:**
- Consumes: Task 5 的 token/Tailwind 名。
- Produces（Task 7–11 依赖）:
  - `Button` variant 语义不变（`primary` 默认 / `ghost` / 危险由调用方传 class），视觉：主按钮 `bg-action text-action-fg rounded-sticker border-2 border-line`（深色下描边 var(--line) 已自动后退）；次按钮 `bg-surface border-2 border-line`；全部 `shadow-sticker`、过渡 `transition duration-[var(--ease)]`
  - `Menu`：`export function Menu({ trigger, children }: { trigger: ReactNode; children: (close: () => void) => ReactNode })` — 按钮触发、透明全屏层点击关闭、面板 `bg-surface border-2 border-line rounded-card shadow-card` 绝对定位；无业务逻辑
  - 媒体宫格：2px `border-line` 描边 + `rounded-[12px]`，格间距 `gap-1.5`（spec §1.2）
  - Lightbox：深墨底（`bg-black/85`，深色浮层两主题一致——灯箱是内容层不是皮肤层）、贴纸式关闭/左右钮（`rounded-sticker bg-surface text-ink border-2 border-line shadow-sticker`）

- [ ] **Step 1: 五个基础组件换肤**

逐文件把旧类名替换为新 token 类（行为/属性签名一律不动）：
- `Button.tsx`：主按钮底色 `bg-accent text-accent-fg` → `bg-action text-action-fg`，加 `rounded-sticker border-2 border-line shadow-sticker`；ghost → `bg-surface text-ink border-2 border-line`；danger 用法统一 `text-danger`/`border-danger`。
- `Field.tsx`：输入框 `bg-white/70` → `bg-surface`，`border-line` 保留，圆角 `rounded-paper` → `rounded-card`。
- `Banner.tsx`：`rounded-paper` → `rounded-card`、`bg-white/…` → `bg-surface`、加 `border-2 border-line shadow-card`。
- `Confirm.tsx`：面板 `rounded-paper bg-paper` → `rounded-card bg-surface border-2 border-line shadow-card`；遮罩保留半透明墨底。
- `Avatar.tsx`：底色/文字色改 `bg-select text-ink`（贴纸态圆片），尺寸 props 不动。

- [ ] **Step 2: Menu 组件**

`apps/web/src/ui/Menu.tsx`（新建，完整实现）：
```tsx
import { useState, type ReactNode } from 'react';

/** 通用弹出小菜单：trigger 始终渲染；children 拿 close() 渲染菜单项。纯 UI，无业务。 */
export function Menu({
  trigger,
  children,
  align = 'right',
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <span className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-30 cursor-default" onClick={close} />
          <span
            className={`absolute z-40 mt-1 min-w-32 rounded-card border-2 border-line bg-surface p-1 shadow-card ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {children(close)}
          </span>
        </>
      )}
    </span>
  );
}
```

- [ ] **Step 3: MediaBlock / Lightbox 换肤**

- `MediaBlock.tsx`：图片按钮容器 `rounded-paper` → `rounded-[12px] border-2 border-line`；占位骨架 `bg-line` 保留（两主题可用）+ `rounded-[12px]`；宫格 `gap-1` → `gap-1.5`；视频占位 `bg-ink text-paper` → `bg-ink text-bg`。
- `Lightbox.tsx`：底层保留深色遮罩并统一 `bg-black/85`；关闭与左右切换钮改贴纸式：`rounded-sticker border-2 border-line bg-surface text-ink shadow-sticker`；其余行为（Esc、左右键、`?st=` 透传）不动。

- [ ] **Step 4: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测：时间线卡片媒体带墨描边圆角；灯箱开关/切换钮为贴纸样式；深浅主题下各看一遍（spec §9 手测 11 的组件层部分）。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): ui 基础组件与媒体/灯箱贴纸化换肤"
```

---

### Task 7: web Shell 换肤 + 主题机制（lib/theme.ts + ThemeToggle + 链颜色点）

**Files:**
- Create: `apps/web/src/lib/theme.ts`
- Create: `apps/web/src/lib/chain-color.ts`
- Create: `apps/web/src/ui/ThemeToggle.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/pages/MePage.tsx`（仅挂载 ThemeToggle，整页换肤在 Task 11）

**Interfaces:**
- Consumes: Task 5 的 `data-theme` 机制与 token；Shell 既有 `showCompose` 逻辑（保留原样，Task 9 复用）。
- Produces（Task 8–11 依赖）:
  - `lib/theme.ts`：`export type ThemeChoice = 'system' | 'light' | 'dark'`；`getThemeChoice(): ThemeChoice`；`setThemeChoice(t: ThemeChoice): void`（写 `localStorage["moment:theme"]` 并立刻应用）；`applyTheme(): void`（与 index.html snippet 同规则，含 `/share/` 恒浅与 system 媒体查询）；`subscribeSystemTheme(): () => void`（`prefers-color-scheme` change → applyTheme，返回解绑）
  - `chain-color.ts`：`export type StickerColor = 'pink' | 'blue' | 'mint' | 'purple'`；`chainColor(chainId: string): StickerColor`（FNV-1a `% 4`）；`stickerClasses: Record<StickerColor, string>`（底+描边工具类全字面量，供 Tailwind 扫描）
  - `ThemeToggle`：三态分段控件（跟随系统/浅/深），受控于 `getThemeChoice()`
  - Shell：左栏 232px、得意黑字标（「刻」`text-action`）、当前项 `--select` 黄底贴纸、链列表颜色点、通知橙底白字角标

- [ ] **Step 1: lib/theme.ts**

`apps/web/src/lib/theme.ts`（新建，完整实现）：
```ts
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'moment:theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* localStorage 不可用按 system */
  }
  return 'system';
}

/** 与 index.html 内联 snippet 同规则（防 FOUC 屏障在 snippet；本函数负责运行时切换）。 */
export function applyTheme(): void {
  let t: ThemeChoice | 'light' = getThemeChoice();
  // 分享页恒浅：无视 localStorage 与系统偏好（spec §1.5）
  if (window.location.pathname.startsWith('/share/')) t = 'light';
  const resolved =
    t === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : t;
  document.documentElement.dataset.theme = resolved;
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* 忽略写失败，本次会话内仍生效 */
  }
  applyTheme();
}

/** system 主题跟随：返回解绑函数。 */
export function subscribeSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
```

- [ ] **Step 2: lib/chain-color.ts**

`apps/web/src/lib/chain-color.ts`（新建，完整实现）：
```ts
export type StickerColor = 'pink' | 'blue' | 'mint' | 'purple';

const COLORS: readonly StickerColor[] = ['pink', 'blue', 'mint', 'purple'];

/**
 * 链颜色点（spec §1.4）：chains 表无 color 字段且禁止改 schema，
 * 客户端确定性推导 hash(chainId) % 4，同一链在所有页面颜色恒定。
 * FNV-1a 32bit：简单稳定，跨端/跨会话一致。
 */
export function chainColor(chainId: string): StickerColor {
  let h = 0x811c9dc5;
  for (let i = 0; i < chainId.length; i++) {
    h ^= chainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return COLORS[(h >>> 0) % 4]!;
}

/** 颜色点/贴纸底的工具类（全字面量，保证 Tailwind 扫描得到；深色描边随 token 自动切换）。 */
export const stickerClasses: Record<StickerColor, string> = {
  pink: 'bg-sticker-pink border-sticker-pink-line',
  blue: 'bg-sticker-blue border-sticker-blue-line',
  mint: 'bg-sticker-mint border-sticker-mint-line',
  purple: 'bg-sticker-purple border-sticker-purple-line',
};
```

- [ ] **Step 3: ThemeToggle**

`apps/web/src/ui/ThemeToggle.tsx`（新建）：三枚分段按钮（跟随系统 / 浅 / 深），当前项 `bg-select text-ink rounded-sticker border-2 border-line`，其余 `text-muted`；点击调 `setThemeChoice`。挂载进 `MePage.tsx`（在既有只读资料块下方加一个「主题」小节；MePage 其余结构不动，Task 11 统一换肤）。
同时在 `MePage`（或 `App.tsx`，二选一，写进代码注释说明）挂载一次 `useEffect(() => subscribeSystemTheme(), [])`，保证运行期系统主题切换可跟随——effect 内只做订阅/解绑，不做 setState 链，符合 apps/web「显式动作」偏好。

- [ ] **Step 4: Shell 换肤**

`apps/web/src/shell/Shell.tsx` 修改点（结构/逻辑不动，只改样式与侧栏内容）：
1. aside：`w-60` → `w-[232px]`；`bg-paper/80 border-r border-line` → `bg-bg border-r-2 border-line`。
2. 字标：`<NavLink to="/">` 内容改为 `时<span className="text-action">刻</span>`，类 `font-display px-2 text-2xl text-ink`。
3. `sideLink`：当前项 `bg-accent text-accent-fg` → `bg-select text-ink rounded-sticker border-2 border-line shadow-sticker`；非当前 `text-ink hover:bg-surface`。
4. 链列表项：名称前加颜色点 `<span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full border ${stickerClasses[chainColor(c.id)]}`} />`。
5. 通知角标：`text-accent` 计数 → 橙底白字圆贴 `<span className="ml-auto rounded-sticker bg-action px-1.5 text-xs text-action-fg">`。
6. header（顶栏）：`bg-paper/90` → `bg-bg/90`；「记下此刻」按钮保留（Task 9 会再处理入口体系，本任务不动逻辑）。
7. main：`max-w-content`（token 已 680px，无需改类名）。

- [ ] **Step 5: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测（spec §9 手测 11 的 Shell 部分）：
1. 「我的」页三态开关切换立即生效、刷新后保持；system 档下切换 OS 深浅色页面跟随（不刷新）。
2. 同一链在侧栏颜色点多次进入/换页颜色不变；两条链颜色点随 hash 分布。
3. 通知有未读时角标橙底白字；当前导航黄底贴纸。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Shell 贴纸换肤、主题三态开关与链颜色点"
```

---

### Task 8: web Timeline 时光链签名 + 日期分组 + MomentSheet 贴纸化（表情条「＋」+ kebab）

**Files:**
- Create: `apps/web/src/timeline/group-by-date.ts`
- Create: `apps/web/src/timeline/ReactionBar.tsx`
- Modify: `apps/web/src/lib/time.ts`（加 `localDateKey`）
- Modify: `apps/web/src/styles/tokens.css`（加日期贴纸两枚 token）
- Modify: `apps/web/src/timeline/Timeline.tsx`
- Modify: `apps/web/src/timeline/MomentSheet.tsx`
- Modify: `apps/web/src/pages/FeedHome.tsx`、`apps/web/src/pages/ChainHome.tsx`（传 `hideSignature`；ChainHome 行内 tag/order 条本任务暂保留，Task 10 迁入右栏）

**Interfaces:**
- Consumes: Task 6 的 `Menu`；`formatHappenedAt`；`REACTION_EMOJIS`；既有 `moment.reactions`/`myReaction`/`commentCount` 数据形状。
- Produces:
  - `localDateKey(iso: string, tzOffsetMinutes: number): string`（`YYYY-MM-DD`，作者本地墙钟，与 `formatHappenedAt` 同一换算）
  - `groupMomentsByDate(moments: MomentResponse[]): { date: string; moments: MomentResponse[] }[]`（Map 保序，保证同一天全列表只出一组，跨页边界安全）
  - `Timeline` 新 prop `hideSignature?: boolean`（`order=created_at` 时调用方传 true：链条与日期贴纸整体隐藏，退化为纯卡片列表——spec §3.2 约定降级，不是 bug）
  - `ReactionBar`：`{ moment, onReact(emoji) }` 内部自管浮层
  - MomentSheet：本人时刻操作收进 `Menu` kebab（编辑/删除）；他人时刻（含 owner 视角）**无 kebab 无操作入口**（spec §0/§6 非目标）

- [ ] **Step 1: 时间与分组工具**

`apps/web/src/lib/time.ts` 追加：
```ts
/** 日期分组 key：作者本地墙钟日期（与 formatHappenedAt 同一换算，spec §3.2）。 */
export function localDateKey(iso: string, tzOffsetMinutes: number): string {
  const d = new Date(Date.parse(iso) - tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
```

`apps/web/src/timeline/group-by-date.ts`（新建，完整实现）：
```ts
import type { MomentResponse } from '@moment/dto';
import { localDateKey } from '@/lib/time';

export interface DateGroup {
  /** YYYY-MM-DD（作者本地墙钟） */
  date: string;
  moments: MomentResponse[];
}

/**
 * 日期分组必须基于 pages.flatMap 后的全量已加载列表计算（spec §3.2）：
 * 用 Map 按 key 归并而非相邻分段——跨页边界的同一天只渲染一枚日期贴纸，
 * key 为日期字符串，新页插入时分组稳定。
 */
export function groupMomentsByDate(moments: MomentResponse[]): DateGroup[] {
  const byDate = new Map<string, MomentResponse[]>();
  for (const m of moments) {
    const key = localDateKey(m.happenedAt, m.happenedTzOffset);
    const list = byDate.get(key);
    if (list) list.push(m);
    else byDate.set(key, [m]);
  }
  return [...byDate.entries()].map(([date, list]) => ({ date, moments: list }));
}
```

- [ ] **Step 2: Timeline 链条签名**

先给 tokens.css 加日期贴纸 token（色彩纪律：组件层禁止按主题各自判断颜色，深浅差异只能落在 token）：
- `:root` 追加：`--date-sticker-bg: var(--sticker-purple); --date-sticker-line: var(--sticker-purple-line);`（浅：紫底墨字）
- `:root[data-theme='dark']` 追加：`--date-sticker-bg: transparent; --date-sticker-line: var(--select);`（深：黄字琥珀边——文字色两主题都用 `text-ink`，深色下 `--ink` 已是浅米；「黄字」由深色 `--date-sticker-bg: transparent` + 额外定义 `--date-sticker-fg` 表达更精确：`--date-sticker-fg: var(--ink)`（浅）/ `--date-sticker-fg: var(--select)`（深），三色 token 一并加）

`apps/web/src/timeline/Timeline.tsx` 改造（props 增加 `hideSignature?: boolean`，其余签名不动）：
1. 正常态渲染结构替换为：
```tsx
if (hideSignature) {
  // order=created_at：happened_at 非单调，签名降级隐藏（spec §3.2）
  return (
    <div className="space-y-5">
      {moments.map((m) => <MomentSheet key={m.id} /* 既有 props 原样 */ />)}
      {/* 既有哨兵与「加载更多…」原样 */}
    </div>
  );
}
const groups = groupMomentsByDate(moments);
return (
  <div className="relative pl-[26px]">
    {/* 贯穿虚线链：26px 缩进区，2.5px dashed，~0.4 透明度（spec §3.1） */}
    <div aria-hidden className="absolute bottom-2 left-[9px] top-2 border-l-[2.5px] border-dashed border-muted/40" />
    {groups.map((g) => (
      <section key={g.date} className="mb-6">
        {/* 日期分组头 = 链上贴纸节点：左侧圆点(--select) + 日期贴纸（颜色全走 token） */}
        <header className="relative mb-3 flex items-center">
          <span aria-hidden className="absolute -left-[26px] h-3 w-3 rounded-full border-2 border-line bg-select" />
          <span className="rounded-sticker border-2 border-[color:var(--date-sticker-line)] bg-[var(--date-sticker-bg)] px-3 py-0.5 text-sm text-[var(--date-sticker-fg)] shadow-sticker">
            {g.date}
          </span>
        </header>
        <div className="space-y-5">
          {g.moments.map((m) => (
            <MomentSheet key={m.id} /* 既有 props 原样 */ />
          ))}
        </div>
      </section>
    ))}
    {/* 既有哨兵与「加载更多…」原样 */}
  </div>
);
```
2. 骨架（isPending 分支）：三张骨架卡同样放进带虚线链的缩进容器（骨架卡也挂链条，spec §3.3）。
3. `FeedHome.tsx`：`hideSignature` 恒 false（`/ 只按 happened_at`——现状 `filter.order` 固定 `happened_at`，直接不传）。`ChainHome.tsx`：传 `hideSignature={order === 'created_at'}`。

- [ ] **Step 3: ReactionBar**

`apps/web/src/timeline/ReactionBar.tsx`（新建，完整实现）：
```tsx
import { REACTION_EMOJIS, type MomentResponse } from '@moment/dto';
import { Menu } from '@/ui/Menu';

/**
 * 表情条（spec §6）：未点过的表情不再一排平铺，收成一枚「＋」贴纸浮层再选；
 * 已有计数的表情照常显示；我点过的 --select 黄底热态。点选/取消的 API 行为不变。
 */
export function ReactionBar({
  moment,
  onReact,
}: {
  moment: MomentResponse;
  onReact: (emoji: string) => void;
}) {
  const counted = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: moment.reactions.find((r) => r.emoji === emoji)?.count ?? 0,
  })).filter((r) => r.count > 0 || moment.myReaction === r.emoji);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {counted.map(({ emoji, count }) => {
        const mine = moment.myReaction === emoji;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className={`rounded-sticker border-2 px-2 py-0.5 text-sm shadow-sticker ${
              mine ? 'border-line bg-select text-ink' : 'border-line bg-surface text-ink'
            }`}
          >
            {emoji}
            {count > 0 ? ` ${count}` : ''}
          </button>
        );
      })}
      <Menu
        trigger={
          <button
            type="button"
            aria-label="加个表情"
            className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-sm text-muted shadow-sticker hover:text-ink"
          >
            ＋
          </button>
        }
      >
        {(close) => (
          <span className="flex gap-1 p-1">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-sticker px-1.5 py-0.5 text-lg hover:bg-select"
                onClick={() => {
                  onReact(emoji);
                  close();
                }}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
      </Menu>
    </span>
  );
}
```

- [ ] **Step 4: MomentSheet 贴纸化 + kebab**

`apps/web/src/timeline/MomentSheet.tsx` 修改点：
1. 卡片容器：`rounded-paper bg-white/70 p-5 shadow-paper` → `relative rounded-card border-2 border-line bg-surface p-5 shadow-card`；并在容器内最前加链节圆环（卡片左上角外侧，spec §3.1）：
```tsx
<span aria-hidden className="absolute -left-[33px] top-6 h-4 w-4 rounded-full border-2 border-line bg-surface" />
```
（`-left-[33px]` = 26px 缩进区 + 环半径对齐虚线；若视觉偏差微调此值，注释说明对齐意图。）
2. 头部右侧操作区：现状 `!readOnly && mine` 的两个小字按钮（编辑/删除）整体替换为 `Menu` kebab：
```tsx
{!readOnly && mine && (
  <Menu
    trigger={
      <button type="button" aria-label="更多操作" className="rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-muted shadow-sticker">
        ···
      </button>
    }
  >
    {(close) => (
      <span className="flex flex-col">
        <button type="button" className="rounded px-3 py-1.5 text-left text-sm hover:bg-select" onClick={() => { close(); openCompose({ chainId: moment.chainId, edit: moment }); }}>
          编辑
        </button>
        <button type="button" className="rounded px-3 py-1.5 text-left text-sm text-danger hover:bg-select" onClick={() => { close(); setConfirmDel(true); }}>
          删除
        </button>
      </span>
    )}
  </Menu>
)}
```
`mine === false` 时什么都不渲染——owner 看他人时刻同样无入口（spec §0 非目标，代码注释标明 backlog）。
3. 表情条：`REACTION_EMOJIS.map(...)` 整段替换为 `<ReactionBar moment={moment} onReact={(emoji) => react.mutate(emoji)} />`；评论数按钮保留，样式 `text-muted hover:text-ink`。
4. 标签 `#name` 小字 → 贴纸 chip：`rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-xs text-muted shadow-sticker`。
5. readOnly（分享）计数行贴纸化：`{moment.reactions.map(...)}` 那行改为每枚 `rounded-sticker border-2 border-line bg-surface px-2 py-0.5 text-xs`。
6. 评论预览区 `border-t border-line` 保留；链接 `text-accent` → `text-action`（全文件 `text-accent`/`bg-accent` 等旧类名一并替换，grep 确认）。

- [ ] **Step 5: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测（spec §9 分配到本任务）：
- 手测 13：链页切「按添加时间」→ 链条/日期贴纸整体消失、纯卡片列表；切回「按事件时间」恢复。
- 手测 15：制造 50+ 条同日数据（或把 `limit` 临时调小翻页）→ 跨页边界的同一天只有一枚日期贴纸。
- 手测 14（kebab 部分）：owner 账号看他人时刻无「···」；本人时刻有 kebab，编辑/删除走通。
- 表情：未点过的不平铺，「＋」浮层可选；我点过的黄底；已有计数照常显示；分享页（readOnly）无「＋」无按钮只有计数贴纸。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): 时间线时光链签名、日期分组与 MomentSheet 贴纸化"
```

---

### Task 9: web composer 入口占位卡 + FAB + ComposePanel 换肤

**Files:**
- Create: `apps/web/src/compose/ComposerEntry.tsx`
- Create: `apps/web/src/compose/ComposeFab.tsx`
- Modify: `apps/web/src/compose/ComposePanel.tsx`（换肤 + 选链卡颜色点 + 发布成功记录 lastCreatedId）
- Modify: `apps/web/src/compose/ComposeContext.tsx`（加 `lastCreatedId` 透出，供 Task 9 的「长出来」微动效）
- Modify: `apps/web/src/shell/Shell.tsx`（挂载 FAB，复用既有 `showCompose` 计算）
- Modify: `apps/web/src/pages/FeedHome.tsx`、`apps/web/src/pages/ChainHome.tsx`（时间线顶部挂 ComposerEntry；隐藏规则用 `canCompose`）
- Modify: `apps/web/src/timeline/Timeline.tsx`（给 `lastCreatedId` 命中的首张卡加生长动画类）

**Interfaces:**
- Consumes: `useCompose().openCompose`（全站唯一发布 modal，spec §5：不做就地展开的内联编辑器）；Shell `showCompose` 逻辑；`canCompose`；`chainColor`/`stickerClasses`。
- Produces:
  - `ComposerEntry({ chainId?: string })`：占位卡「这一刻,记点什么…」+ 媒体/标签/时间图标（纯视觉占位，无输入态），点击 `openCompose({ chainId })`
  - `ComposeFab()`：右下橙色圆钮，滚动超过一屏后出现，点击 `openCompose({ chainId })`（chainId 由 Shell 的 useParams 提供，同顶栏按钮）
  - `ComposeContext` 新增 `lastCreatedId: string | null`（真实 state，透出给 Timeline）+ `markCreated(id: string)`；`openCompose` 内自清（下一次打开发布面板时重置）

- [ ] **Step 1: ComposeContext 扩展**

`apps/web/src/compose/ComposeContext.tsx` 修改点（最小增量，既有 API 不动）：
```ts
interface ComposeContextValue {
  request: ComposeRequest | null;
  openCompose: (req?: ComposeRequest) => void;
  closeCompose: () => void;
  /** 发布成功的 moment id：时间线「从链节长出来」微动效用（spec §1.6）。真实 state——Timeline 已挂载，
      发布发生在其生命周期内，必须是响应式值渲染期直读，不能用 ref/首渲染消费（对抗审查修正） */
  lastCreatedId: string | null;
  markCreated: (id: string) => void;
}
```
实现：`const [lastCreatedId, setLastCreatedId] = useState<string | null>(null)`；`markCreated = useCallback((id) => setLastCreatedId(id), [])`（在 ComposePanel 提交处理器里显式调用，符合「显式动作」规则）；`openCompose` 内追加 `setLastCreatedId(null)` 自清（下一次打开发布面板即重置，不需要 setTimeout/effect）。

- [ ] **Step 2: ComposerEntry**

`apps/web/src/compose/ComposerEntry.tsx`（新建，完整实现）：
```tsx
import { useCompose } from './ComposeContext';

/** 常驻 composer 入口（spec §5）：只是入口，点击显式打开 ComposePanel modal，不做内联展开。 */
export function ComposerEntry({ chainId }: { chainId?: string }) {
  const { openCompose } = useCompose();
  return (
    <button
      type="button"
      onClick={() => openCompose({ chainId })}
      className="relative mb-6 flex w-full items-center gap-3 rounded-card border-2 border-dashed border-line bg-surface/60 px-5 py-4 text-left text-muted shadow-card hover:text-ink"
    >
      {/* 挂链首：与卡片链节同视觉（时间线缩进容器内对齐虚线） */}
      <span aria-hidden className="absolute -left-[33px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-line bg-surface" />
      <span className="text-[17px]">这一刻,记点什么…</span>
      <span className="ml-auto flex gap-2 text-lg" aria-hidden>
        🖼️ 🏷️ 🕐
      </span>
    </button>
  );
}
```

- [ ] **Step 3: ComposeFab**

`apps/web/src/compose/ComposeFab.tsx`（新建，完整实现）：
```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useCompose } from './ComposeContext';

/** 向下滚动后接力 composer 入口的橙色 FAB（spec §5）。滚动监听是事件源，非 effect 链式 setState。 */
export function ComposeFab() {
  const { openCompose } = useCompose();
  const { chainId } = useParams<{ chainId: string }>();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 240);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;
  return (
    <button
      type="button"
      aria-label="记下此刻"
      onClick={() => openCompose({ chainId })}
      className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border-2 border-line bg-action text-2xl text-action-fg shadow-card"
    >
      ＋
    </button>
  );
}
```

- [ ] **Step 4: 挂载与抑制规则**

- `Shell.tsx`：`showCompose` 计算保留；header 顶栏「记下此刻」按钮**移除**（入口移交占位卡 + FAB，spec §5）；`{showCompose && <ComposeFab />}` 挂在 `<ComposePanel />` 旁。viewer（`showCompose === false`）不渲染 FAB，逻辑零新增。
- `FeedHome.tsx`：`<Timeline>` 之前渲染 `{(chains ?? []).some(canCompose) && <ComposerEntry />}`（import `canCompose`）；占位卡要与链条对齐——把它放进 Timeline 的缩进容器内更整齐：执行时在 `Timeline` 加可选 prop `entry?: ReactNode`，渲染在签名容器最顶部（骨架/空态时不渲染 entry）。`ChainHome.tsx`：`canCompose(chain) && <ComposerEntry chainId={chain.id} />` 同样经 `entry` prop 传入。
- 分享相册/只读：不经过 Shell 且无 ComposerEntry 渲染点，天然不渲染（spec §5）。

- [ ] **Step 5: ComposePanel 换肤 + markCreated + 生长动画**

`apps/web/src/compose/ComposePanel.tsx` 修改点：
1. 遮罩 `bg-ink/30` 保留；面板 `rounded-paper bg-paper shadow-paper` → `rounded-card border-2 border-line bg-surface shadow-card`；标题 `font-display` 保留（固定文案，子集已含）。
2. 选链大卡：`border-accent bg-accent/10` 选中态 → `border-line bg-select shadow-sticker`；每卡名称前加 `chainColor` 颜色点（同 Shell 侧栏圆点写法）。
3. textarea / datetime input / 新标签 input：`bg-white/70` → `bg-bg` 或 `bg-surface`，圆角 `rounded-card`；标签 chip 选中态 `bg-accent text-accent-fg` → `bg-select text-ink`，未选 `bg-line text-ink` → `bg-surface border-2 border-line`。
4. 媒体宫格预览图加 `rounded-[12px] border-2 border-line`；删除小钮 `bg-ink/60 text-paper` → `bg-action text-action-fg`。
5. 创建成功分支（`await client.createMoment(...)` 之后、`onClose()` 之前）加 `markCreated(res.id)`——`createMoment` 返回值先接 `const res = await ...`。
6. `Timeline.tsx`：`const { lastCreatedId } = useCompose()` 渲染期直读，渲染每张 `MomentSheet` 外包一层 `<div className={m.id === lastCreatedId ? 'animate-[grow-in_200ms_ease-out]' : undefined}>`——invalidate 重取后新卡挂载时动画播放一次；`lastCreatedId` 由下一次 `openCompose` 自清（见 Step 1）；`index.css` 追加：
```css
@keyframes grow-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```
（`prefers-reduced-motion` 下 `--ease` 已 1ms；此处 keyframes 时长固定 200ms 可接受，若需严格降级再加 media 查询包一层。）

- [ ] **Step 6: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测（spec §9 分配到本任务）：
- 时间线顶部占位卡点击开 modal（带当前 chainId）；下滚后 FAB 出现、点击开同一个 modal；`?compose=1` 深链与旧 `/chains/:id/compose` 302 仍开同一 modal。
- 手测 14（viewer 部分）：viewer 账号全程不见占位卡与 FAB。
- 发布成功：新卡片带生长动画出现在链条上；编辑中部时刻仍开编辑态 modal。

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): composer 入口占位卡、滚动 FAB 与发布面板贴纸换肤"
```

---

### Task 10: web 右栏时间索引 + 筛选（≥1400px 栏 / <1400px 抽屉 / 跳转与回到最新）

**Files:**
- Modify: `apps/web/src/api/keys.ts`（`qk.feed` 加 `before`；新增 `qk.monthIndex`）
- Modify: `apps/web/src/lib/time.ts`（加 `monthBeforeParam`/`monthFromBefore`）
- Create: `apps/web/src/timeline/TimelineRail.tsx`（索引 + 筛选 + 抽屉一体的右栏组件）
- Modify: `apps/web/src/pages/FeedHome.tsx`（链多选/标签/排序/锚定状态 + rail 挂载）
- Modify: `apps/web/src/pages/ChainHome.tsx`（行内 tag/order 条拆除，迁入 rail；锚定状态）

**Interfaces:**
- Consumes: Task 2 的 `client.getMonthIndex` 与 `getFeed({before})`；Task 8 的 Timeline；`qk.chains`/`qk.tags`。
- Produces:
  - `monthBeforeParam(month: string): string`：月份 `YYYY-MM` 的**下一月**月初 00:00（查看者本地）换算 UTC ISO（spec §4.3：`before` = M 的下一月月初）
  - `monthFromBefore(before: string): string`：从 `before` 反推锚定月（索引栏高亮用）
  - `TimelineRail({ chains: ChainDto[], fixedChainId?: string, value: RailFilter, onChange })`：`RailFilter = { chainIds?: string[]; tagId?: string; order: 'happened_at' | 'created_at'; before?: string }`
  - 标签单选 chips **仅在范围恰好一条链时出现**（`/ 全部链` 与多选时不显示——web-product「/ 无标签条」与此一致；spec 未定义多链下标签来源，本计划定稿此规则并写入代码注释）

- [ ] **Step 1: keys 与时间工具**

`apps/web/src/api/keys.ts` 修改点：
```ts
  feed: (f: { chainIds?: string[]; tagId?: string; order: 'happened_at' | 'created_at'; before?: string }) =>
    ['feed', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.order, f.before ?? ''] as const,
  /** month-index：tz_offset 参与 key（spec §8）；'feed' 前缀保证发布后的 ['feed'] 前缀 invalidate 一并刷新索引 */
  monthIndex: (f: { chainIds?: string[]; tagId?: string; tzOffset: number }) =>
    ['feed', 'month-index', f.chainIds?.join(',') ?? 'all', f.tagId ?? '', f.tzOffset] as const,
```

`apps/web/src/lib/time.ts` 追加：
```ts
/** 跳到月份 M 的 before 参数（spec §4.3）：M 的下一月月初 00:00（查看者本地）换算 UTC ISO。 */
export function monthBeforeParam(month: string): string {
  const [y, m] = month.split('-').map((s) => Number(s));
  return new Date(y!, m!, 1).toISOString(); // m 为 1-based 月 → Date 的 0-based 恰好是「下一月」
}

/** 从 before 反推锚定月 YYYY-MM（before 恒为某月 1 日本地 00:00 的 ISO）。 */
export function monthFromBefore(before: string): string {
  const d = new Date(before);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth())}`; // 0-based getMonth() 恰好是 1-based 的上一月
}
```

- [ ] **Step 2: TimelineRail**

`apps/web/src/timeline/TimelineRail.tsx`（新建）：一个组件三种呈现——
1. ≥1400px：页面 flex 行内右侧 `hidden w-72 shrink-0 min-[1400px]:block` 的 aside，上「时间索引」下「筛选」。
2. <1400px：主列顶部一枚「筛选/索引」贴纸按钮（`min-[1400px]:hidden`），点开右侧抽屉（固定定位面板 + 半透明遮罩，内容同 aside）。
3. 内容两块：
   - **时间索引**：`useQuery({ queryKey: qk.monthIndex({ chainIds: value.chainIds ?? (fixedChainId ? [fixedChainId] : undefined), tagId: value.tagId, tzOffset: currentTzOffset() }), queryFn: ... client.getMonthIndex })`；每行一枚贴纸按钮 `月份 + count`，点击 `onChange({ ...value, before: monthBeforeParam(m.month) })`；锚定态（`value.before`）下 `monthFromBefore(value.before)` 命中的月份 `bg-select` 高亮；`order === 'created_at'` 时整块索引替换为一行说明「按添加时间看的时候没有月份索引」（created_at 下 before 无意义，与 dto 约束一致）。
   - **筛选**：链多选 chips（`fixedChainId` 时隐藏整块）；标签单选 chips（范围恰好一条链时显示，`qk.tags(chainId)`）；「按添加时间看补发」开关（`order` 切换，`rounded-sticker` 贴纸开关）。
4. 顶部锚定态固定一枚「← 回到最新」贴纸按钮：`value.before` 存在时显示，点击 `onChange({ ...value, before: undefined })`（按钮放主列时间线上方，不放右栏——spec §4.3「时间线顶部固定一枚」；由页面组件渲染）。

- [ ] **Step 3: FeedHome 接入**

`FeedHome.tsx` 改造：
1. 状态：`const [filter, setFilter] = useState<RailFilter>({ order: 'happened_at' })`（替换现状固定 `filter`）。
2. `useInfiniteQuery`：`queryKey: qk.feed(filter)`，`queryFn: ({ pageParam }) => client.getFeed({ ...filter, cursor: pageParam, limit: 50 })`——`before` 变化 = key 变化 = 重查第一页（spec §4.3：替换查询参数重查，不是分页态延续）。
3. 布局：外层 `flex`：主列 `<div className="min-w-0 flex-1">`（标题、「回到最新」、`Timeline hideSignature={filter.order === 'created_at'}`）+ `<TimelineRail chains={chains ?? []} value={filter} onChange={setFilter} />`。
4. 「回到最新」按钮：`filter.before && <button className="sticky top-2 ...">← 回到最新</button>` 点击 `setFilter((f) => ({ ...f, before: undefined }))`。
5. 空态逻辑不变（筛选空态文案沿用）。

- [ ] **Step 4: ChainHome 接入**

`ChainHome.tsx` 改造：
1. 删除行内标签 chips 条与「按事件时间/按添加时间」小字按钮（迁入 rail）。
2. 状态合并为 `RailFilter`（`tagId/order/before`），feed 查询固定 `chainIds: [chainId]` + filter。
3. 挂载 `<TimelineRail chains={chains ?? []} fixedChainId={chainId} value={filter} onChange={setFilter} />`（chains 来自 `qk.chains` 查询，本文件新增该 query 仅用于 rail 的链 chips——`fixedChainId` 下 rail 隐藏链 chips，也可传 `[]`；执行时选「传 `[]` + fixedChainId」以避免多余查询，注释说明）。
4. 「回到最新」与 FeedHome 同款。
5. month-index 对链页：`fixedChainId` 使 rail 的索引查询 `chainIds=[chainId]`——即 spec §4.2「month-index 传单个 chain_ids 即得该链索引」。

- [ ] **Step 5: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测（spec §9 手测 12 全条 + 13 联动）：
1. 窗口拉到 ≥1400px：右栏出现（上索引下筛选）；900–1400px：右栏消失、主列顶部贴纸按钮点开抽屉；抽屉与右下 FAB 互不遮挡。
2. 点历史月 → 第一屏即该月下旬内容（before = 下一月月初）；索引栏该月高亮；继续下滚自然进入更早月份（before + cursor 同传不越界——Task 4 服务端已测）。
3. 「← 回到最新」→ 清 before 回第一页。
4. 切「按添加时间看补发」→ 索引块消失且链条/日期贴纸降级隐藏（手测 13 联动）；切回恢复。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): 宽屏右栏时间索引与筛选（锚定跳转/回到最新/抽屉态）"
```

---

### Task 11: web 其余页面换肤（链设置 / 分享相册 / 登录注册邀请 / 通知 / 我的 / 时刻详情）

**Files:**
- Modify: `apps/web/src/chain/ChainSettings.tsx`（贴纸 tab + 分享链接贴纸卡 + 状态色）
- Modify: `apps/web/src/pages/ShareAlbumPage.tsx`（恒浅更安静 + 贴纸化）
- Modify: `apps/web/src/pages/AuthPages.tsx`（居中贴纸卡 + 得意黑大字标）
- Modify: `apps/web/src/pages/InvitePage.tsx`
- Modify: `apps/web/src/pages/NotificationsHome.tsx`（列表行贴纸化 + 未读橙点）
- Modify: `apps/web/src/pages/MePage.tsx`（只读资料 + 主题开关区块换肤）
- Modify: `apps/web/src/pages/MomentPage.tsx`（评论区换肤）
- Modify: `apps/web/src/pages/ChainSettingsPage.tsx`（标题/骨架类名同步）

**Interfaces:**
- Consumes: Task 5–9 全部产物（token、`Menu`、Button 等）。
- Produces: 无新符号；spec §7 逐页视觉落地。

- [ ] **Step 1: 链设置**

`ChainSettings.tsx`：
1. 左目录项 → 贴纸 tab：当前项 `bg-select text-ink rounded-sticker border-2 border-line shadow-sticker`，其余 `text-muted hover:text-ink`；权限隐藏规则逐项保留（viewer 只见成员只读；editor 无分享生成——逻辑不动）。
2. 分享链接每行一张贴纸卡：`rounded-card border-2 border-line bg-surface p-3 shadow-sticker`；状态色：有效 `bg-sticker-mint border-sticker-mint-line`、已过期 `bg-select border-line`、已吊销 `bg-line/40 text-muted`（灰系——spec 无灰 token，用 `--line` 低饱和表达，注释标明）。
3. 吊销二次确认文案不动；复制「已复制」提示沿用。
4. 成员/资料/危险区交互不动，仅把 `bg-white/70`/`rounded-paper`/`text-accent` 等旧类逐个替换为新 token 类。

- [ ] **Step 2: 分享相册（恒浅更安静）**

`ShareAlbumPage.tsx`：
1. 全部 `bg-paper` → `bg-bg`、`max-w-content` 保留；链名 `font-display` 保留；页脚「由家庭用『时刻』记录」保留。
2. 确认无 FAB/无 composer/无表情钮：本页不经过 Shell，`Timeline` 走 `readOnly`（Task 8 已贴纸化只读计数），无新增抑制代码——手测确认即可。
3. 恒浅由 Task 5 snippet + Task 7 `applyTheme` 的 `/share/` 分支双重保证，本文件不加主题代码。
4. 「这本相册的分享已关闭」整页文案保留，`font-display` 大字 + 居中贴纸卡容器（`rounded-card border-2 border-line bg-surface shadow-card`）。

- [ ] **Step 3: 登录/注册/邀请/通知/我的/详情**

- `AuthPages.tsx`：外层 `bg-bg min-h-screen flex items-center justify-center`；表单卡 `rounded-card border-2 border-line bg-surface p-8 shadow-card`；字标「时<span className="text-action">刻</span>」`font-display text-3xl`；错误人话映射（web-product §9）逻辑不动。
- `InvitePage.tsx`：同款贴纸卡容器；成功/失败文案不动。
- `NotificationsHome.tsx`：列表行 `rounded-card border-2 border-line bg-surface p-3 shadow-sticker`；未读行左侧橙点 `h-2 w-2 rounded-full bg-action`；「全部已读」按钮走 `Button`。
- `MePage.tsx`：资料卡贴纸化；「主题」小节标题 + `ThemeToggle` 容器 `rounded-card border-2 border-line bg-surface p-4 shadow-card`。
- `MomentPage.tsx`：评论区输入框/按钮走换肤后 `Field`/`Button`；评论行贴纸化（同通知行）；删除自己评论的小钮 `text-danger`。
- `ChainSettingsPage.tsx`：骨架 `bg-white/50` → `bg-surface/60`；标题保留 `font-display`。

- [ ] **Step 4: 验证**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web build && pnpm --filter @moment/web lint`
Expected: 全绿。
手测（spec §9 手测 11 的逐页部分 + 14 收尾）：
1. 深浅主题逐页切换检查：链设置（含分享卡三态色）、分享相册（任何主题设置下恒浅）、登录/注册/邀请、通知、我的、时刻详情。
2. viewer 账号：设置页无分享生成块、全程无 composer/FAB（手测 14 完整过一遍）。
3. editor：无分享生成；owner：吊销二次确认文案原样。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 链设置/分享相册/认证/通知/我的/详情页贴纸换肤"
```

---

### Task 12: 全量验证 + 手测清单收口 + 过渡别名清除

**Files:**
- Modify: `apps/web/tailwind.config.js`（删过渡别名 `paper/accent/accent-fg`、shadow `paper`、radius `paper`——仅当 grep 零残留后）
- 无其他新增文件；验证-only。

**Interfaces:**
- Consumes: Task 1–11 全部产物。
- Produces: 本计划 DoD 达成确认。

- [ ] **Step 1: 旧类名零残留 + 别名清除**

Run: `grep -rn 'paper\|accent\|ink-muted' apps/web/src apps/web/tailwind.config.js apps/web/index.html || true`
Expected: 仅 `tailwind.config.js` 中的过渡别名定义行（colors/shadow/radius 的 `paper`/`accent`/`accent-fg`）。人工甄别确认其余零残留后删除这些别名，重跑本命令至完全无输出，再跑 build + 手测一遍首屏。

- [ ] **Step 2: 全量构建与测试**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: 全绿（dto：feed/moments-list 新用例；api-client：before/month-index URL 用例；server：month-index 6 + feed-before 5 + 既有全部）。

- [ ] **Step 3: 手测清单收口（逐项勾）**

起本地全栈（`pnpm dev`，web 同源反代 `/api`），按序执行 web-product §10 既有 10 条 + 本 spec §9 新增 11–15（11–15 已在 Task 5/7/8/9/10/11 分步验过，本步是端到端完整过一遍）：

1. 注册 → 创建「宝宝成长」→ 占位卡记下纯文字「此刻」（新卡生长动画）。
2. 同链记 1 张图、1 段视频；灯箱可开可关、贴纸式按钮。
3. 第二账号 editor 加入 → 卡片「＋」点表情、发评论。
4. owner 生成永不过期分享 → 复制 → 无痕窗口打开相册（恒浅、无 FAB/表情钮）。
5. 吊销 → 无痕刷新「这本相册的分享已关闭」；`?st=` 旧 token 不可见。
6. 再开 7 天链接，列表状态色（有效=薄荷）。
7. viewer 全程不见占位卡/FAB/分享生成；owner 看不到他人时刻 kebab。
8. 1280px 与 900px 主路径不撑破；900–1400px 抽屉与 FAB 不互挡；≥1400px 右栏出现。
9. 断网点发布：面板稿还在，人话错误。
10. 邀请链接：未登录注册后落入该链。
11. 深浅主题逐页切换；system 档跟随 OS；刷新无 FOUC；分享页恒浅。
12. 点索引历史月跳转成功（第一屏=该月下旬）；「回到最新」返回；锚定月高亮。
13. `order=created_at` 下链条/日期贴纸隐藏、索引块消失；切回恢复。
14. 同 7。
15. 跨页边界同一天只一枚日期贴纸（50+ 条同日或调小 limit）。

- [ ] **Step 4: Commit（如有改动）**

```bash
git add -A && git commit -m "chore(web): 重设计收口（过渡别名清除与手测修正）"
```
（无改动则跳过。）

---

## 完成标准（DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿。
- 服务端：`GET /api/feed/month-index` 按查看者时区归桶（跨 tz_offset 落不同月）、chain_ids 收窄静默过滤、tag_id 过滤、软删排除、空范围 `[]`、倒序、缺省/非法 tz_offset 400；feed 与链内列表支持 `before`（严格小于、与 cursor AND、feed 上 `before + order=created_at` 400、非法 400）；既有 feed/moments 测试保持绿；游标格式未动。
- dto/api-client：`monthIndexQuerySchema`/`MonthIndexResponse`/`before` 全套落地，`getMonthIndex` URL 精确匹配测试通过。
- Web：双主题三态切换无 FOUC、分享页恒浅；得意黑子集 < 200KB 自包含；时间线时光链签名（虚线链 + 日期贴纸 + 卡片链节）在 `happened_at` 下可见、`created_at` 下按约定降级；日期分组跨页唯一；表情条「＋」收成浮层；本人时刻 kebab、owner 对他人时刻无入口；占位卡 + 滚动 FAB 都开同一个 ComposePanel；≥1400px 右栏索引可跳转且有「回到最新」。
- 明确未做（符合 spec §0）：双向无限滚动、owner 删他人时刻 UI、移动端底栏、chains 表 color 字段。
- 未引入新环境变量（`apps/server/src/config.ts` 与 `.env.example` 无需改动）；未新增环境依赖与全局 store。
