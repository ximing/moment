# 融合检索 P6：POST /api/search 意图 + 分层 C + 双游标 + 限流 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的搜索入口：`POST /api/search` 在请求线程跑意图 LLM（`INTENT_TIMEOUT_MS=8000`，畸形/超时降级）、按链词典解析人名（丢链规则）、分层 C（硬过滤 MySQL AND + 可选 Lance 200 近邻）、双游标（时间 `{h,i}` / 距离 `{d,i}`）、空 embedding 的转义 LIKE、以及 60s/20 `RATE_LIMITED`。

**Architecture:** 新域 `apps/server/src/search/`（与 `/api/feed` 同级，非链嵌套）。意图只调既有 `getLLMProvider().chat`（不改签名，包 `Promise.race` 超时，不内部重试）。跨链人物是按链析取 + 链内多 id AND，**不能**压进 P2 `queryMomentPage.personId`。P2 未抽出可复用 SQL helper，本计划在 `search-query.ts` 内联 drizzle 谓词（semi-join / `eq(placeName)` / `gte`+`lte` / `eq(wallDate)`）。向量路追加 P4 repository 的 `.search()` ANN（P4 明确未实现 search）。时间序游标消费既有 `feed/cursor.ts` `{h,i}`；距离游标新文件 `search-cursor.ts` `{d,i}`。scope = `getMyChains ∩ chainIds`（静默丢权）。序列化走 `serializeMoments(..., { includePrivate: true })`。限流仿 inviteAccept：`populateUser` 之后、`useExpressServer` 之前 `app.post('/api/search', searchRateLimiter)`。

**Tech Stack:** routing-controllers `@Authorized` + TypeDI / zod ^3.22（只消费 P1 `searchInputSchema`，本计划 dto 零 diff）/ drizzle-orm 0.45 / `@lancedb/lancedb` `.search().limit().where().toArray()`（真实 `LANCEDB_PATH` + `resetLanceForTests`）/ `nock@^14`（P5 已加）钉意图 HTTP / `setLLMProvider` + `setEmbeddingProvider` / jest `--runInBand` + 真实 MySQL 测试库 / `express-rate-limit` v8。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§0 意图/分层 C/搜索不带 before、§1 请求线程 LLM+query embed、§3 意图与丢链、§3.3 降级、§4.5 查询期向量、§5 融合与分页、§6.2 POST /api/search、§6.6 错误码、§8 越权与限流、§9 search 测试、§11 P6 出口）

**上游契约:**
- P1 `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`：`searchInputSchema` / `SearchInput` / `SearchParsed` / `SearchTime` / `SearchResponse` / `INTENT_MAX_QUERY_CHARS=500` / `SEARCH_DEFAULT_LIMIT=20` / `SEARCH_MAX_LIMIT=50` / `isoDatetime`（从 `@moment/dto` 导出）。**本计划 dto 零 diff，不重定义 schema。**
- P2 `docs/superpowers/plans/2026-08-29-fused-retrieval-p2-scalar-filter.md`：`queryMomentPage` 单 `personId`/`place`/`happenedFrom`/`happenedTo` 仅 GET chip。P6 **不调用**它做搜索析取（偏差 3）。
- P4 `docs/superpowers/plans/2026-08-29-fused-retrieval-p4-lancedb-ba.md`：`ensureLance` / `resetLanceForTests` / `getLanceTable` / `LANCE_NOT_READY` / `LANCE_UUID_RE` / `lanceEqUuid` / `upsertMomentVector` / `createApp()` 不 connect。P4 **不**实现 `.search()`。
- P5 `docs/superpowers/plans/2026-08-29-fused-retrieval-p5-embed.md`：`getEmbeddingProvider` / `setEmbeddingProvider` / `EmbeddingProvider.embed({ text })` / `modelHash()` / `nock@^14`。查询期 `embed({ text })` 属本计划（P5 偏差 10）。

执行时假设 P1+P2+P4+P5 已在本分支落地。

## Global Constraints

- 冻结名逐字不得改：`POST /api/search` / `SearchController` / `SearchService.search` / `parseSearchIntent` / `parseIntentJson` / `INTENT_TIMEOUT_MS=8000` / `VECTOR_CANDIDATE_LIMIT=200` / `HARD_FILTER_PREFILTER_MAX=200` / `encodeDistanceCursor` / `decodeDistanceCursor` / `searchMomentVectors` / `searchRateLimiter` / `searchKeyGenerator` / 错误码 `INVALID_CURSOR` `VALIDATION_ERROR` `RATE_LIMITED`。`INTENT_MAX_QUERY_CHARS` / `SEARCH_DEFAULT_LIMIT` / `SEARCH_MAX_LIMIT` **从 `@moment/dto` import**，server 不抄第二份。
- 意图系统 prompt **逐字**进 `apps/server/src/search/prompt.ts`（spec §3.1 代码块）。意图**不抽 tag**；tag 只来自 body `tagId`。季节范围只写在 prompt 里，server **不**自己把「夏天」编成区间（LLM 返回 `time.kind=range` 后按闭区间 SQL）。
- `q` 与 500 同一上限：超长 400 `VALIDATION_ERROR`（P1 zod），prompt 内不再二次截断。`temperature=0`，`maxTokens=512`。不把链词典塞进 prompt。不内部重试。
- 人名：`normalizePersonName`；跨链同名按链析取；链内多 id AND；**丢链规则**（人名非空 AND 该链 0 命中 AND 无其它约束 → 从本次 scope 去掉）。其它约束 = 解析出的 time、硬 place、非空工作 `text`、或 body `personId`/`tagId`/`place`/`happenedFrom`/`happenedTo`。
- 搜索 body **无** `before` / `order` / `source`。chip AND 仅 `personId`/`tagId`/`place`（外加 body 时间闭区间）。**不**加 `RANGE_REQUIRES_HAPPENED_AT`。
- 向量：每次最多 200 近邻（禁止 `limit*3`）；kind 混合；去重取最小 L2 `_distance`；游标在 200 窗口上前进；承认第 201 近截断。`modelHash` 不匹配丢弃；丢完为空 → 空页 + warn，**不**回退 LIKE。
- CONVENTIONS §3 **只追加**：不改 `ChainPolicy` / `requireChainRole` / `feed/cursor.ts` 编解码语义 / `serializeMoments` / 既有存储方法。search `{d,i}` 与 `comment-cursor.ts` 同属另域；时间序 search 消费既有 `{h,i}`，不新写第二份 moments 分页游标。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已预留 `POST /api/search`）。
- **不**做 jobs HTTP（P7）、api-client/web/app（P8/P9）、e2e/`backfill:embed`（P10）。不改 `packages/dto/**`。不改 `apps/server/.env`。search **零** `getObject`（请求线程零读像素）。
- worker 禁止 import 图进入 `src/lancedb/`（P4 源码图）。本计划 `searchMomentVectors` 只给 HTTP server 的 SearchService 用。
- server 测试：`pnpm --filter @moment/server test -- <file>`（脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)` + `beforeEach(resetDb)`。Lance 测试 `beforeAll(ensureLance)` + `afterAll(closeLanceForTests)`；`resetLanceForTests()` 不进 `resetDb()`。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **不调用 `ChainPolicy.require`。** spec §3.2 / §8：未授权 `chainIds` 静默丢弃（与 feed `chain_ids` 相同），不 403、不泄露存在性。`require()` 对非成员抛 `CHAIN_NOT_FOUND`。scope = `getMyChains ∩ (chainIds ?? 全部)`。`chain-policy.ts` 本计划零 diff。
2. **时间序游标复用 `src/feed/cursor.ts` 的 `encodeCursor`/`decodeCursor`（`order='happened_at'` → `{h,i}`）。** `search-cursor.ts` **只**实现 `{d,i}`。不改 `cursor.ts`。CONVENTIONS §3.4「第二份游标」仅约束 moments 分页。
3. **P2 没有抽出可复用 SQL helper**（只有 `queryMomentPage` 的单 `personId`）。本计划在 `search-query.ts` **内联** `moment_persons` semi-join / `eq(placeName)` / `gte`+`lte(happenedAt)` / `eq(wallDate)`，**不**改 `moment-query.ts`，**不**把跨链人物压进 `MomentPageQuery.personId`。
4. **查询期 `embed` 抛错或 `getLanceTable` 抛 `LANCE_NOT_READY`：空页 + warn，不回退 LIKE、不 500**（与 spec「modelHash 丢完为空不切排序键」同一约束）。`createApp()` 仍不 connect；向量 HTTP 测 `beforeAll(ensureLance)`。
5. **`NonRetryableLLMError` 与 Retryable/超时一样降级为 `text=q`。** spec §3.3 点名 Retryable/超时；4xx 也不 500。
6. **测试环境 limiter `limit=1000` 不打满。** 429 信封用独立小 app 钉死与 `authRateLimiter` 同一 `message` 对象；生产常量 `SEARCH_RATE_LIMIT=20` / `SEARCH_RATE_WINDOW_MS=60_000` 单测断言；`app.ts` 源码锁 `app.post('/api/search', searchRateLimiter)` 在 `populateUser` 之后。
7. **`parseSearchIntent(q, tzOffset, nowMs = Date.now())` 第三参是测试注入点**（查看者墙钟日），生产 controller 不传。禁止为意图测去改全局 `Date.now`。
8. **nock 由 P5 加入 `devDependencies`，本计划不 `pnpm add`。** 一条意图 HTTP 测：`setLLMProvider(new OpenAICompatProvider(...))` + nock 钉 `temperature=0` / `max_tokens=512` / 系统 prompt。其余测 `setLLMProvider` mock。拦不到 fetch：停手报告，禁止改 mock fetch。
9. **未登录 401 与 GET `/api/feed` 同形**（`@Authorized()`，不另抛 `UnauthorizedError('UNAUTHORIZED')`）。断言 `status===401` 即可。
10. **`parsed` 响应保留 LLM 原值（或降级 `{ personNames:[], place:null, time:null, text:q }`）。** 解析 place 零命中并入 `text` 只改召回工作副本，不回写 `parsed.place`/`parsed.text`。
11. **body 未知字段 `before`/`order`/`source` 走 zod 默认 strip，不 400。** dto 无这些键（P1）。
12. **drizzle-orm 0.45 的 `like()` 无 ESCAPE 参数。** LIKE 用 `sql\`${col} LIKE ${pattern} ESCAPE ${sql.raw(`'\\\\'`)}\``（先转义 `\` 再 `%` `_`）。
13. **Lance Node：`table.search(vector).limit(n).where(pred).toArray()`，读 `_distance`。** 若安装版本 `search` 需要第二参列名 `'vector'`，补上并在测试注释钉死。若无 `search`：停手报告实际 API，禁止用 `query()` + JS 全表距离冒充 200 窗口。
14. **P1 mock storage 已有 `getObject`。** HTTP search 测 `installMockStorage()` 后断言 `getObject` 零调用。
15. **意图系统 prompt 放 `apps/server/src/search/prompt.ts`，不放 spec 字面 `apps/server/src/llm/intent/prompt.ts`。** 意图只服务 `POST /api/search`（chip GET 零 LLM）；与 M1 `llm/extract/prompt.ts` 分域，避免 search 反向依赖一条永不复用的 `llm/intent` 路径。逐字内容仍锁 spec §3.1 代码块。

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/src/search/constants.ts` | `INTENT_TIMEOUT_MS` / `VECTOR_CANDIDATE_LIMIT` / `HARD_FILTER_PREFILTER_MAX` |
| `apps/server/src/search/prompt.ts` | 系统 prompt 逐字；user prompt |
| `apps/server/src/search/parse-intent.ts` | `viewerWallDate` / `degradedParsed` / `parseIntentJson` |
| `apps/server/src/search/intent.ts` | `withTimeout` / `parseSearchIntent` |
| `apps/server/src/search/search-cursor.ts` | `{d,i}` |
| `apps/server/src/search/resolve-scope.ts` | membership、人名、丢链、place 零命中 |
| `apps/server/src/search/like.ts` | `escapeLike` / `likeContains` |
| `apps/server/src/search/search-query.ts` | 按链析取 SQL、时间页、id 圈选 |
| `apps/server/src/search/search.service.ts` | 分层 C |
| `apps/server/src/search/search.controller.ts` | `POST /api/search` |
| `apps/server/src/lancedb/ids.ts` | 追加 `lanceInUuids` |
| `apps/server/src/lancedb/repository.ts` | 追加 `searchMomentVectors` |
| `apps/server/src/middlewares/rate-limit.ts` | `searchKeyGenerator` / `searchRateLimiter` |
| `apps/server/src/app.ts` | 挂 limiter + `SearchController` |

**本计划明确不改：** `packages/dto/**`、`chain-policy.ts`、`feed/cursor.ts`、`feed/moment-query.ts`、`moment-serializer.ts`、jobs 路由、api-client、web/app、`scripts/backfill-*.ts`、`tests/helpers/db.ts` 删除顺序、Dockerfile/compose/nginx、`apps/server/.env`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: 意图常量 + 逐字 prompt + `parseIntentJson` + 查看者墙钟日

**Files:**
- Create: `apps/server/src/search/constants.ts`
- Create: `apps/server/src/search/prompt.ts`
- Create: `apps/server/src/search/parse-intent.ts`
- Test: `apps/server/tests/search/constants.test.ts`
- Test: `apps/server/tests/search/prompt.test.ts`
- Test: `apps/server/tests/search/parse-intent.test.ts`

**Interfaces:**
- Consumes:
  - P1 `isoDatetime` / `SearchTime` / `SearchParsed` from `@moment/dto`
  - `wallDateOf(happenedAt: Date, happenedTzOffset: number): string`（`src/moments/wall-date.ts`，与 spec §3.1 同一算术）
- Produces:
  - `export const INTENT_TIMEOUT_MS = 8000`
  - `export const VECTOR_CANDIDATE_LIMIT = 200`
  - `export const HARD_FILTER_PREFILTER_MAX = 200`
  - `export const INTENT_CHAT_TEMPERATURE = 0`
  - `export const INTENT_CHAT_MAX_TOKENS = 512`
  - `export const INTENT_SYSTEM_PROMPT: string`（spec §3.1 代码块逐字，含「不要抽标签名」与北半球季节闭区间）
  - `export function buildIntentSystemPrompt(): string` — 返回 `INTENT_SYSTEM_PROMPT`
  - `export function buildIntentUserPrompt(q: string, viewerDate: string, tzOffset: number): string`
  - `export function viewerWallDate(tzOffset: number, nowMs: number = Date.now()): string`
  - `export function degradedParsed(q: string): SearchParsed` — `{ personNames: [], place: null, time: null, text: q }`
  - `export function parseIntentJson(raw: string): SearchParsed | null` — 畸形返回 `null`（由 Task 2 降级）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/constants.test.ts`：
```ts
import { INTENT_MAX_QUERY_CHARS, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '@moment/dto';
import {
  HARD_FILTER_PREFILTER_MAX,
  INTENT_CHAT_MAX_TOKENS,
  INTENT_CHAT_TEMPERATURE,
  INTENT_TIMEOUT_MS,
  VECTOR_CANDIDATE_LIMIT,
} from '../../src/search/constants.js';

describe('search 冻结常量（spec §3.1 / §4.5 / §5）', () => {
  it('超时、窗口、dto 上限', () => {
    expect(INTENT_TIMEOUT_MS).toBe(8000);
    expect(VECTOR_CANDIDATE_LIMIT).toBe(200);
    expect(HARD_FILTER_PREFILTER_MAX).toBe(200);
    expect(INTENT_CHAT_TEMPERATURE).toBe(0);
    expect(INTENT_CHAT_MAX_TOKENS).toBe(512);
    expect(INTENT_MAX_QUERY_CHARS).toBe(500);
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(SEARCH_MAX_LIMIT).toBe(50);
  });
});
```

Create `apps/server/tests/search/prompt.test.ts`：
```ts
import { INTENT_SYSTEM_PROMPT, buildIntentSystemPrompt, buildIntentUserPrompt } from '../../src/search/prompt.js';

describe('意图系统 prompt（spec §3.1 逐字）', () => {
  it('buildIntentSystemPrompt 就是 INTENT_SYSTEM_PROMPT', () => {
    expect(buildIntentSystemPrompt()).toBe(INTENT_SYSTEM_PROMPT);
  });

  it('含 JSON 四字段、不抽标签、不抽我你咱们、北半球季节闭区间', () => {
    const p = INTENT_SYSTEM_PROMPT;
    expect(p).toContain('personNames');
    expect(p).toContain('place');
    expect(p).toContain('time');
    expect(p).toContain('text');
    expect(p).toContain('不要抽标签名');
    expect(p).toContain('不抽「我」「你」「咱们」');
    expect(p).toContain('春 03-01～05-31');
    expect(p).toContain('夏 06-01～08-31');
    expect(p).toContain('秋 09-01～11-30');
    expect(p).toContain('冬 12-01～次年 02-28（闰年 02-29）');
    expect(p).toContain('from=该本地日 00:00:00.000、to=该本地日 23:59:59.999');
    expect(p).toContain('「去年夏天」= 查看者今年-1 的夏天');
    expect(p).not.toContain('tagId');
    expect(p).not.toContain('tags');
  });
});

describe('意图 user prompt', () => {
  it('含查询、查看者本地日期、时区偏移分钟', () => {
    const u = buildIntentUserPrompt('去年今天和外婆', '2026-08-29', -480);
    expect(u).toContain('# 查询');
    expect(u).toContain('去年今天和外婆');
    expect(u).toContain('# 查看者本地日期');
    expect(u).toContain('2026-08-29');
    expect(u).toContain('# 时区偏移分钟');
    expect(u).toContain('-480');
  });
});
```

Create `apps/server/tests/search/parse-intent.test.ts`：
```ts
import { isoDatetime } from '@moment/dto';
import {
  degradedParsed,
  parseIntentJson,
  viewerWallDate,
} from '../../src/search/parse-intent.js';

describe('viewerWallDate（spec §3.1，与 wallDateOf 同一算术）', () => {
  it('东八区：UTC 08-28 16:30 → 查看者 08-29', () => {
    expect(viewerWallDate(-480, Date.parse('2026-08-28T16:30:00.000Z'))).toBe('2026-08-29');
  });

  it('tzOffset=0：UTC 历法日', () => {
    expect(viewerWallDate(0, Date.parse('2026-08-29T04:00:00.000Z'))).toBe('2026-08-29');
  });
});

describe('degradedParsed', () => {
  it('整句当 text', () => {
    expect(degradedParsed('外婆')).toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '外婆',
    });
  });
});

describe('parseIntentJson（对齐 parseExtractJson 防御，spec §3.1）', () => {
  const ok = {
    personNames: ['外婆'],
    place: '朝阳公园',
    time: { kind: 'wall_date' as const, year: 2025, month: 8, day: 29 },
    text: '野餐',
  };

  it('合法 JSON', () => {
    expect(parseIntentJson(JSON.stringify(ok))).toEqual(ok);
  });

  it('剥 ```json 围栏', () => {
    expect(parseIntentJson('```json\n' + JSON.stringify(ok) + '\n```')).toEqual(ok);
  });

  it('personNames 非字符串元素丢弃；缺字段或非数组 = 畸形 null', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: ['外婆', 1, null, '朵朵'] }))).toEqual({
      ...ok,
      personNames: ['外婆', '朵朵'],
    });
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: '外婆' }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, personNames: undefined }))).toBeNull();
    const { personNames: _drop, ...rest } = ok;
    expect(parseIntentJson(JSON.stringify(rest))).toBeNull();
    void _drop;
  });

  it('place 必须 string 或 null；text 缺省 ""；text 非 string = 畸形', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, place: null, text: undefined }))).toEqual({
      ...ok,
      place: null,
      text: '',
    });
    expect(parseIntentJson(JSON.stringify({ ...ok, place: 1 }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, text: 1 }))).toBeNull();
  });

  it('time.kind=range：复用 isoDatetime，且 Date.parse(from)<=Date.parse(to)；否则畸形', () => {
    const range = {
      ...ok,
      time: { kind: 'range' as const, from: '2025-06-01T00:00:00.000Z', to: '2025-08-31T23:59:59.999Z' },
    };
    expect(parseIntentJson(JSON.stringify(range))).toEqual(range);
    expect(isoDatetime.safeParse(range.time.from).success).toBe(true);

    const offsetOk = {
      ...ok,
      time: {
        kind: 'range' as const,
        from: '2026-08-01T00:00:00+08:00',
        to: '2026-07-31T23:00:00Z',
      },
    };
    expect(parseIntentJson(JSON.stringify(offsetOk))).toEqual(offsetOk);

    expect(
      parseIntentJson(
        JSON.stringify({
          ...ok,
          time: { kind: 'range', from: '2026/06/01', to: '2026-08-31T00:00:00Z' },
        }),
      ),
    ).toBeNull();
    expect(
      parseIntentJson(
        JSON.stringify({
          ...ok,
          time: { kind: 'range', from: '2026-08-02T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
        }),
      ),
    ).toBeNull();
  });

  it('wall_date：year≥1 整数、month 1..12、day 1..31；否则畸形。2-30 仍过解析（SQL 零命中）', () => {
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2024, month: 2, day: 29 } })),
    ).toEqual({ ...ok, time: { kind: 'wall_date', year: 2024, month: 2, day: 29 } });
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 2, day: 30 } })),
    ).toEqual({ ...ok, time: { kind: 'wall_date', year: 2025, month: 2, day: 30 } });
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 0, month: 8, day: 29 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 13, day: 1 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025.5, month: 8, day: 29 } })),
    ).toBeNull();
    expect(
      parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'wall_date', year: 2025, month: 8, day: 0 } })),
    ).toBeNull();
  });

  it('time 非法 kind / 非对象非 null = 畸形；time=null 合法', () => {
    expect(parseIntentJson(JSON.stringify({ ...ok, time: null }))).toEqual({ ...ok, time: null });
    expect(parseIntentJson(JSON.stringify({ ...ok, time: { kind: 'today' } }))).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, time: '2025-08-29' }))).toBeNull();
  });

  it('非 JSON / 空串 / 数组根 = null；多余 tag 字段忽略（意图不抽 tag）', () => {
    expect(parseIntentJson('not json')).toBeNull();
    expect(parseIntentJson('')).toBeNull();
    expect(parseIntentJson('[]')).toBeNull();
    expect(parseIntentJson(JSON.stringify({ ...ok, tag: '野餐', tags: ['野餐'] }))).toEqual(ok);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/constants.test.ts tests/search/prompt.test.ts tests/search/parse-intent.test.ts`

Expected: FAIL，`search/constants.js` / `prompt.js` / `parse-intent.js` 不是一个模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/constants.ts`：
```ts
export const INTENT_TIMEOUT_MS = 8000;
export const VECTOR_CANDIDATE_LIMIT = 200;
export const HARD_FILTER_PREFILTER_MAX = 200;
export const INTENT_CHAT_TEMPERATURE = 0;
export const INTENT_CHAT_MAX_TOKENS = 512;
```

Create `apps/server/src/search/prompt.ts`：
```ts
/** spec §3.1 系统 prompt 逐字。 */
export const INTENT_SYSTEM_PROMPT = `你是家庭时光链的搜索意图解析器。把用户的一句话解析成过滤条件。
只返回一个 JSON 对象，不要 markdown、不要解释。
JSON：
{
  "personNames": ["<人名或亲属称谓>"],
  "place": "<地名或场所短语或 null>",
  "time": { "kind": "range", "from": "<ISO>", "to": "<ISO>" } | { "kind": "wall_date", "year": <number>, "month": <1-12>, "day": <1-31> } | null,
  "text": "<扣掉已识别实体后用于语义搜索的剩余文本>"
}
规则：
1. personNames：只抽人名与亲属称谓，原样保留；不抽「我」「你」「咱们」。没有则为 []。不要抽标签名。
2. place：文本中的地名/场所；没有则为 null。不要编造。
3. time：「去年今天」「N 年前的今天」用 wall_date（年份=查看者今年-N，月日=查看者今天）；「去年夏天」等用 range。没有时间则为 null。
4. 季节按北半球气象季节、查看者本地年锚定：春 03-01～05-31，夏 06-01～08-31，秋 09-01～11-30，冬 12-01～次年 02-28（闰年 02-29）。from=该本地日 00:00:00.000、to=该本地日 23:59:59.999，输出带时区的 ISO（可用 Z）。「去年夏天」= 查看者今年-1 的夏天。
5. text：去掉已抽的人名、地名、时间短语后的剩余；若整句都是实体则为 ""。
6. 只根据给定查询，不要编造未出现的实体。`;

export function buildIntentSystemPrompt(): string {
  return INTENT_SYSTEM_PROMPT;
}

export function buildIntentUserPrompt(q: string, viewerDate: string, tzOffset: number): string {
  return ['# 查询', q, '', '# 查看者本地日期', viewerDate, '', '# 时区偏移分钟', String(tzOffset)].join('\n');
}
```

Create `apps/server/src/search/parse-intent.ts`：
```ts
import { isoDatetime, type SearchParsed, type SearchTime } from '@moment/dto';
import { wallDateOf } from '../moments/wall-date.js';

export function viewerWallDate(tzOffset: number, nowMs: number = Date.now()): string {
  return wallDateOf(new Date(nowMs), tzOffset);
}

export function degradedParsed(q: string): SearchParsed {
  return { personNames: [], place: null, time: null, text: q };
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function parseTime(value: unknown): SearchTime | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const t = value as Record<string, unknown>;
  if (t.kind === 'range') {
    if (typeof t.from !== 'string' || typeof t.to !== 'string') return undefined;
    if (!isoDatetime.safeParse(t.from).success || !isoDatetime.safeParse(t.to).success) return undefined;
    if (Date.parse(t.from) > Date.parse(t.to)) return undefined;
    return { kind: 'range', from: t.from, to: t.to };
  }
  if (t.kind === 'wall_date') {
    if (!isInt(t.year) || !isInt(t.month) || !isInt(t.day)) return undefined;
    if (t.year < 1 || t.month < 1 || t.month > 12 || t.day < 1 || t.day > 31) return undefined;
    return { kind: 'wall_date', year: t.year, month: t.month, day: t.day };
  }
  return undefined;
}

export function parseIntentJson(raw: string): SearchParsed | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.personNames)) return null;
    const personNames = o.personNames.filter((x): x is string => typeof x === 'string');
    if (o.place !== null && typeof o.place !== 'string' && o.place !== undefined) return null;
    const place = typeof o.place === 'string' ? o.place : null;
    if (o.text !== undefined && typeof o.text !== 'string') return null;
    const parsedText = typeof o.text === 'string' ? o.text : '';
    const time = o.time === undefined ? null : parseTime(o.time);
    if (time === undefined) return null;
    return { personNames, place, time, text: parsedText };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/constants.test.ts tests/search/prompt.test.ts tests/search/parse-intent.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/constants.ts apps/server/src/search/prompt.ts apps/server/src/search/parse-intent.ts \
  apps/server/tests/search/constants.test.ts apps/server/tests/search/prompt.test.ts apps/server/tests/search/parse-intent.test.ts
git commit -m "feat(server): add search intent prompt and JSON parser"
```

---

### Task 2: `parseSearchIntent`（8s 超时、降级、nock 钉 chat body）

**Files:**
- Create: `apps/server/src/search/intent.ts`
- Test: `apps/server/tests/search/intent.test.ts`

**Interfaces:**
- Consumes:
  - `getLLMProvider(): LLMProvider | null`（`src/llm/factory.ts`）
  - `LLMProvider.chat` / `RetryableLLMError` / `NonRetryableLLMError`（不改 `chat` 签名）
  - Task 1 prompt + `parseIntentJson` + `degradedParsed` + `viewerWallDate` + `INTENT_TIMEOUT_MS` / `INTENT_CHAT_*`
  - P5 已装 `nock@^14`
- Produces:
  - `export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>` — 超时 throw `RetryableLLMError('INTENT_TIMEOUT')`；`finally` `clearTimeout`（防 jest 挂起）
  - `export async function parseSearchIntent(q: string, tzOffset: number, nowMs?: number): Promise<SearchParsed>`
    - `getLLMProvider()===null` → `degradedParsed(q)`，不调 chat
    - 否则 `chat({ messages:[system,user], temperature:0, maxTokens:512 })` 包 `withTimeout(..., INTENT_TIMEOUT_MS)`
    - JSON 畸形 / 超时 / `RetryableLLMError` / `NonRetryableLLMError` / 其它 throw → `degradedParsed(q)` + `logger.warn`，不 500
    - **不**内部重试（chat 次数畸形时 = 1）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/intent.test.ts`：
```ts
import { jest } from '@jest/globals';
import nock from 'nock';
import { setLLMProvider } from '../../src/llm/factory.js';
import { OpenAICompatProvider } from '../../src/llm/openai-compat.provider.js';
import { RetryableLLMError, NonRetryableLLMError, type LLMProvider } from '../../src/llm/base.provider.js';
import { INTENT_CHAT_MAX_TOKENS, INTENT_CHAT_TEMPERATURE, INTENT_TIMEOUT_MS } from '../../src/search/constants.js';
import { INTENT_SYSTEM_PROMPT } from '../../src/search/prompt.js';
import { parseSearchIntent, withTimeout } from '../../src/search/intent.js';

afterEach(() => {
  setLLMProvider(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});

function chatReturning(content: string, counter?: { calls: number }, captured?: Parameters<LLMProvider['chat']>[0][]): LLMProvider {
  return {
    async chat(req) {
      if (counter) counter.calls += 1;
      captured?.push(req);
      return { content, model: 'mock', usage: { prompt: 1, completion: 1, total: 2 } };
    },
  };
}

describe('withTimeout', () => {
  it('到期 throw INTENT_TIMEOUT，且不留下悬挂 timer', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toMatchObject({
      name: 'RetryableLLMError',
      message: 'INTENT_TIMEOUT',
    });
  });

  it('先完成则返回值', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
});

describe('parseSearchIntent（spec §3.1 / §3.3）', () => {
  const now = Date.parse('2026-08-29T04:00:00.000Z');

  it('空 provider：整句当 text，不调 chat', async () => {
    const spy = jest.fn<LLMProvider['chat']>();
    setLLMProvider({ chat: spy });
    setLLMProvider(null);
    const parsed = await parseSearchIntent('去年今天和外婆', -480, now);
    expect(parsed).toEqual({ personNames: [], place: null, time: null, text: '去年今天和外婆' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('合法 JSON：temperature=0 maxTokens=512；user prompt 含查看者日期与 tzOffset', async () => {
    const captured: Parameters<LLMProvider['chat']>[0][] = [];
    const body = {
      personNames: ['外婆'],
      place: null,
      time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      text: '',
    };
    setLLMProvider(chatReturning(JSON.stringify(body), undefined, captured));
    const parsed = await parseSearchIntent('去年今天和外婆', -480, now);
    expect(parsed).toEqual(body);
    expect(captured[0].temperature).toBe(INTENT_CHAT_TEMPERATURE);
    expect(captured[0].maxTokens).toBe(INTENT_CHAT_MAX_TOKENS);
    expect(captured[0].messages[0].content).toBe(INTENT_SYSTEM_PROMPT);
    expect(captured[0].messages[1].content).toContain('去年今天和外婆');
    expect(captured[0].messages[1].content).toContain('2026-08-29');
    expect(captured[0].messages[1].content).toContain('-480');
  });

  it('畸形 JSON 降级且只调一次（不内部重试）', async () => {
    const counter = { calls: 0 };
    setLLMProvider(chatReturning('not-json', counter));
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '外婆',
    });
    expect(counter.calls).toBe(1);
  });

  it('RetryableLLMError / NonRetryableLLMError 降级', async () => {
    setLLMProvider({
      chat: async () => {
        throw new RetryableLLMError('429');
      },
    });
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toMatchObject({ text: '外婆', personNames: [] });

    setLLMProvider({
      chat: async () => {
        throw new NonRetryableLLMError('400', 400);
      },
    });
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toMatchObject({ text: '外婆' });
  });

  it(`超时 ${INTENT_TIMEOUT_MS}ms 降级（fake timers）`, async () => {
    jest.useFakeTimers();
    try {
      setLLMProvider({ chat: () => new Promise(() => undefined) });
      const p = parseSearchIntent('外婆', 0, now);
      await jest.advanceTimersByTimeAsync(INTENT_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ personNames: [], place: null, time: null, text: '外婆' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('parseSearchIntent nock 钉 chat HTTP（spec §9）', () => {
  it('OpenAI 兼容 body 含 temperature 0 与系统 prompt', async () => {
    nock.disableNetConnect();
    const host = 'https://llm.test';
    const payload = {
      personNames: [],
      place: null,
      time: null,
      text: '野餐',
    };
    const scope = nock(host)
      .post('/v1/chat/completions', (body: { temperature?: number; max_tokens?: number; messages?: { content: string }[] }) => {
        expect(body.temperature).toBe(0);
        expect(body.max_tokens).toBe(512);
        expect(body.messages?.[0]?.content).toBe(INTENT_SYSTEM_PROMPT);
        expect(body.messages?.[1]?.content).toContain('野餐');
        return true;
      })
      .reply(200, { choices: [{ message: { content: JSON.stringify(payload) } }], model: 'm' });

    setLLMProvider(
      new OpenAICompatProvider({ baseUrl: `${host}/v1`, apiKey: 'sk-test', model: 'm', timeoutMs: 500 }),
    );
    await expect(parseSearchIntent('野餐', -480, Date.parse('2026-08-29T00:00:00Z'))).resolves.toEqual(payload);
    expect(scope.isDone()).toBe(true);
  });
});
```

若 nock 14 默认导出不是 `nock`：`import nock from 'nock'` 改成实际导出并在测试注释钉死。拦不到 fetch：停手报告，禁止改 `globalThis.fetch`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/intent.test.ts`

Expected: FAIL，`intent.js` 不是一个模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/intent.ts`：
```ts
import type { SearchParsed } from '@moment/dto';
import { RetryableLLMError } from '../llm/base.provider.js';
import { getLLMProvider } from '../llm/factory.js';
import { logger } from '../utils/logger.js';
import {
  INTENT_CHAT_MAX_TOKENS,
  INTENT_CHAT_TEMPERATURE,
  INTENT_TIMEOUT_MS,
} from './constants.js';
import { degradedParsed, parseIntentJson, viewerWallDate } from './parse-intent.js';
import { buildIntentSystemPrompt, buildIntentUserPrompt } from './prompt.js';

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RetryableLLMError('INTENT_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function parseSearchIntent(
  q: string,
  tzOffset: number,
  nowMs: number = Date.now(),
): Promise<SearchParsed> {
  const provider = getLLMProvider();
  if (provider === null) return degradedParsed(q);

  const viewerDate = viewerWallDate(tzOffset, nowMs);
  try {
    const resp = await withTimeout(
      provider.chat({
        messages: [
          { role: 'system', content: buildIntentSystemPrompt() },
          { role: 'user', content: buildIntentUserPrompt(q, viewerDate, tzOffset) },
        ],
        temperature: INTENT_CHAT_TEMPERATURE,
        maxTokens: INTENT_CHAT_MAX_TOKENS,
      }),
      INTENT_TIMEOUT_MS,
    );
    const parsed = parseIntentJson(resp.content);
    if (parsed === null) {
      logger.warn('search intent json malformed');
      return degradedParsed(q);
    }
    return parsed;
  } catch (err) {
    logger.warn('search intent degraded', err);
    return degradedParsed(q);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/intent.test.ts tests/search/parse-intent.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/intent.ts apps/server/tests/search/intent.test.ts
git commit -m "feat(server): parse search intent with timeout and degrade"
```

---

### Task 3: 距离游标 `{d,i}`

**Files:**
- Create: `apps/server/src/search/search-cursor.ts`
- Test: `apps/server/tests/search/search-cursor.test.ts`

**Interfaces:**
- Consumes:
  - `BadRequestError` from `routing-controllers`（`message='INVALID_CURSOR'`，与 `feed/cursor.ts` / `comment-cursor.ts` 同形）
  - **不**改 `src/feed/cursor.ts`。时间序 search 在后续 Task 直接 `decodeCursor('happened_at', raw)`。
- Produces:
  - `export interface DistanceCursor { d: number; i: string }`
  - `export function encodeDistanceCursor(d: number, i: string): string` — `base64url(JSON.stringify({ d, i }))`，`d` 原样（不四舍五入）
  - `export function decodeDistanceCursor(raw: string): DistanceCursor` — 坏串 / `d` 非有限 number（`NaN`/`Infinity`）/ `i` 非非空 string → `BadRequestError('INVALID_CURSOR')`。`d` **不要** `Number.isInteger`（L2 距离是浮点）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/search-cursor.test.ts`：
```ts
import { BadRequestError } from 'routing-controllers';
import { decodeCursor, encodeCursor } from '../../src/feed/cursor.js';
import { decodeDistanceCursor, encodeDistanceCursor } from '../../src/search/search-cursor.js';

describe('search-cursor {d,i}（spec §5）', () => {
  it('往返；d 保持浮点原样', () => {
    const raw = encodeDistanceCursor(0.125, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(decodeDistanceCursor(raw)).toEqual({ d: 0.125, i: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d: unknown; i: unknown; h?: unknown };
    expect(payload).toEqual({ d: 0.125, i: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(payload.h).toBeUndefined();
  });

  it('坏串 / 非有限 d / 空 i → INVALID_CURSOR', () => {
    const bad = (raw: string) => {
      try {
        decodeDistanceCursor(raw);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).message).toBe('INVALID_CURSOR');
      }
    };
    bad('!!!not-base64!!!');
    bad(Buffer.from(JSON.stringify({ d: Number.NaN, i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: Number.POSITIVE_INFINITY, i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: 1, i: '' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: '1', i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ h: 1, i: 'x' }), 'utf8').toString('base64url'));
  });

  it('不冒充 feed {h,i}：距离游标 decodeCursor 失败；时间游标 decodeDistanceCursor 失败', () => {
    const hi = encodeCursor('happened_at', Date.parse('2026-08-10T00:00:00Z'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(decodeCursor('happened_at', hi)).toMatchObject({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(() => decodeDistanceCursor(hi)).toThrow(BadRequestError);

    const di = encodeDistanceCursor(0.5, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(() => decodeCursor('happened_at', di)).toThrow(BadRequestError);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/search-cursor.test.ts`

Expected: FAIL，`search-cursor.js` 不是一个模块。`encodeCursor` 既有行为必须继续绿（该文件已存在）。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/search-cursor.ts`：
```ts
import { BadRequestError } from 'routing-controllers';

export interface DistanceCursor {
  d: number;
  i: string;
}

export function encodeDistanceCursor(d: number, i: string): string {
  return Buffer.from(JSON.stringify({ d, i }), 'utf8').toString('base64url');
}

export function decodeDistanceCursor(raw: string): DistanceCursor {
  let parsed: { d?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  if (
    typeof parsed.d !== 'number' ||
    !Number.isFinite(parsed.d) ||
    typeof parsed.i !== 'string' ||
    parsed.i.length === 0
  ) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { d: parsed.d, i: parsed.i };
}
```

不要改 `feed/cursor.ts`。不要在本文件实现 `{h,i}`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/search-cursor.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/search-cursor.ts apps/server/tests/search/search-cursor.test.ts
git commit -m "feat(server): add search distance cursor"
```

---

### Task 4: `resolveSearchScope`（求交、人名析取、丢链、place 零命中）

**Files:**
- Create: `apps/server/src/search/resolve-scope.ts`
- Create: `apps/server/tests/search/helpers.ts`
- Test: `apps/server/tests/search/resolve-scope.test.ts`

**Interfaces:**
- Consumes:
  - `getMyChains(userId: string): Promise<Map<string, ChainRole>>`
  - `normalizePersonName(name: string): string`
  - `SearchInput` / `SearchParsed` / `SearchTime` from `@moment/dto`
  - drizzle `eq` / `and` / `inArray` / `isNull`；表 `persons` / `moments`
- Produces:
  - `export interface ResolvedSearch { parsed: SearchParsed; chainIds: string[]; personIdsByChain: Map<string, string[]>; place: string | null; text: string; happenedFrom?: string; happenedTo?: string; wallDate?: string; personId?: string; tagId?: string; }`
    - `parsed` = 入参 LLM 原值，不因 place 并入 text 而改
    - `place` = 硬等值（body.place 始终硬；解析 place 仅当 scope 内有未软删命中）
    - `text` = 工作副本：解析 place 零命中则 `parsed.text` 空则用 place 串，否则 `parsed.text + ' ' + place`（trim）；body.place 不并入 text
    - `personIdsByChain`：链内命中 id 数组（去重）；空数组 = 该链无人名过滤但仍留在 `chainIds`
    - `wallDate`：`time.kind=wall_date` 时 `'YYYY-MM-DD'`（月日零垫）
    - `happenedFrom`/`happenedTo`：body 与 `time.kind=range` 取交（更严 from=较晚，to=较早）。交完后 from>to 仍返回该区间（SQL 零命中，不 400）
  - `export async function resolveSearchScope(userId: string, input: SearchInput, parsed: SearchParsed): Promise<ResolvedSearch>`
  - 未授权 `chainIds` 静默丢弃。空 membership → `chainIds=[]`（坏游标仍由后续 Task 先校验）
  - **丢链**：归一化后 `personNames` 非空，且该链 0 个名字命中，且无其它约束 → 不进入 `chainIds`。某名字无词典行 → 该名字在该链不加过滤（其它名字仍 AND）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/helpers.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function idsOf(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

export async function setPlace(momentId: string, name: string): Promise<void> {
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

export async function setTranscript(momentId: string, transcript: string): Promise<void> {
  await db.update(moments).set({ transcript }).where(eq(moments.id, momentId));
}
```

Create `apps/server/tests/search/resolve-scope.test.ts`：
```ts
import type { SearchInput, SearchParsed } from '@moment/dto';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { setPlace } from './helpers.js';
import { resolveSearchScope } from '../../src/search/resolve-scope.js';

beforeEach(resetDb);
afterAll(closeDb);

function parsed(over: Partial<SearchParsed> = {}): SearchParsed {
  return { personNames: [], place: null, time: null, text: '', ...over };
}

function input(userOver: Partial<SearchInput> = {}): SearchInput {
  return { q: '外婆', tzOffset: -480, ...userOver };
}

describe('resolveSearchScope（spec §3.2）', () => {
  it('chainIds 与 getMyChains 求交；他链静默丢弃', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const a = await createChain(alice.id, 'A');
    const c = await createChain(carol.id, 'C');
    const r = await resolveSearchScope(alice.id, input({ chainIds: [a, c] }), parsed({ text: '野餐' }));
    expect(r.chainIds).toEqual([a]);
    expect(r.text).toBe('野餐');
    expect(r.parsed.text).toBe('野餐');
  });

  it('跨链同名：每链各自 id；链内两名 AND；缺名不加该名过滤', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    const gA = await insertPerson({ chainId: a, name: '外婆' });
    const dA = await insertPerson({ chainId: a, name: '朵朵' });
    const gB = await insertPerson({ chainId: b, name: '外婆' });
    const r = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['  外婆  ', '朵朵'] }),
    );
    expect(new Set(r.chainIds)).toEqual(new Set([a, b]));
    expect(r.personIdsByChain.get(a)?.sort()).toEqual([gA, dA].sort());
    expect(r.personIdsByChain.get(b)).toEqual([gB]); // 朵朵不在 B → 不加
  });

  it('丢链：人名非空且 0 命中且无其它约束 → 去掉该链；全丢则 chainIds=[]', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    await addMember(b, bob.id, 'viewer');
    await insertPerson({ chainId: a, name: '外婆' });
    await insertMoment({ chainId: b, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const dropped = await resolveSearchScope(alice.id, input(), parsed({ personNames: ['外婆'] }));
    expect(dropped.chainIds).toEqual([a]);

    const none = await resolveSearchScope(alice.id, input({ chainIds: [b] }), parsed({ personNames: ['外婆'] }));
    expect(none.chainIds).toEqual([]);
  });

  it('有 time/硬 place/非空 text/body chip 则 0 命中人名的链仍保留（空 personIds）', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    await insertPerson({ chainId: a, name: '外婆' });
    const park = await insertMoment({
      chainId: b,
      authorId: alice.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await setPlace(park, '朝阳公园');

    const withText = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['外婆'], text: '野餐' }),
    );
    expect(new Set(withText.chainIds)).toEqual(new Set([a, b]));
    expect(withText.personIdsByChain.get(b)).toEqual([]);

    const withBodyPlace = await resolveSearchScope(
      alice.id,
      input({ place: '朝阳公园' }),
      parsed({ personNames: ['外婆'] }),
    );
    expect(new Set(withBodyPlace.chainIds)).toEqual(new Set([a, b]));

    const withTime = await resolveSearchScope(
      alice.id,
      input(),
      parsed({
        personNames: ['外婆'],
        time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      }),
    );
    expect(new Set(withTime.chainIds)).toEqual(new Set([a, b]));
    expect(withTime.wallDate).toBe('2025-08-29');
  });

  it('解析 place：scope 内零命中并入 text，不硬过滤；有命中则硬等值；body.place 不做零命中降级', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const m = await insertMoment({
      chainId: a,
      authorId: alice.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await setPlace(m, '朝阳公园');

    const miss = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ place: '不存在的地方', text: '' }),
    );
    expect(miss.place).toBeNull();
    expect(miss.text).toBe('不存在的地方');
    expect(miss.parsed.place).toBe('不存在的地方');
    expect(miss.parsed.text).toBe('');

    const hit = await resolveSearchScope(alice.id, input(), parsed({ place: '朝阳公园', text: '野餐' }));
    expect(hit.place).toBe('朝阳公园');
    expect(hit.text).toBe('野餐');

    const bodyMiss = await resolveSearchScope(
      alice.id,
      input({ place: '不存在的地方' }),
      parsed({ text: 'x' }),
    );
    expect(bodyMiss.place).toBe('不存在的地方');
    expect(bodyMiss.text).toBe('x');
  });

  it('解析 place trim 后截断 255；空白人名丢弃；normalize 折叠空白', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const id = await insertPerson({ chainId: a, name: '王 叔叔' });
    const r = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['  ', '王   叔叔'] }),
    );
    expect(r.personIdsByChain.get(a)).toEqual([id]);

    const long = 'p'.repeat(300);
    const place = await resolveSearchScope(alice.id, input(), parsed({ place: `  ${long}  `, text: '' }));
    expect(place.text.length).toBe(255);
  });

  it('body 区间与解析 range 取交', async () => {
    const alice = await registerUser();
    await createChain(alice.id, 'A');
    const r = await resolveSearchScope(
      alice.id,
      input({
        happenedFrom: '2026-06-01T00:00:00.000Z',
        happenedTo: '2026-08-31T23:59:59.999Z',
      }),
      parsed({
        time: { kind: 'range', from: '2026-07-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' },
        text: 'x',
      }),
    );
    expect(r.happenedFrom).toBe('2026-07-01T00:00:00.000Z');
    expect(r.happenedTo).toBe('2026-08-31T23:59:59.999Z');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/resolve-scope.test.ts`

Expected: FAIL，`resolve-scope.js` 不是一个模块。ts-jest isolatedModules 下过量属性不会编译失败——红灯是模块缺失。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/resolve-scope.ts`：
```ts
import type { SearchInput, SearchParsed, SearchTime } from '@moment/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, persons } from '../db/schema.js';
import { getMyChains } from '../feed/membership.js';
import { normalizePersonName } from '../persons/person.service.js';

export interface ResolvedSearch {
  parsed: SearchParsed;
  chainIds: string[];
  personIdsByChain: Map<string, string[]>;
  place: string | null;
  text: string;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
  personId?: string;
  tagId?: string;
}

function padWall(t: Extract<SearchTime, { kind: 'wall_date' }>): string {
  const m = String(t.month).padStart(2, '0');
  const d = String(t.day).padStart(2, '0');
  return `${t.year}-${m}-${d}`;
}

function laterIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earlierIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

async function placeExistsInScope(scope: string[], place: string): Promise<boolean> {
  if (scope.length === 0) return false;
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(and(inArray(moments.chainId, scope), isNull(moments.deletedAt), eq(moments.placeName, place)))
    .limit(1);
  return rows.length > 0;
}

export async function resolveSearchScope(
  userId: string,
  input: SearchInput,
  parsed: SearchParsed,
): Promise<ResolvedSearch> {
  const mine = await getMyChains(userId);
  let scope = [...mine.keys()];
  if (input.chainIds) scope = input.chainIds.filter((id) => mine.has(id));

  const names = parsed.personNames.map(normalizePersonName).filter((n) => n.length > 0);

  let workText = parsed.text;
  let hardPlace: string | null = input.place ?? null;
  if (parsed.place) {
    const trimmed = parsed.place.trim().slice(0, 255);
    if (trimmed.length > 0) {
      const hit = await placeExistsInScope(scope, trimmed);
      if (hit) {
        hardPlace = input.place ?? trimmed;
      } else if (!input.place) {
        workText = workText.trim().length === 0 ? trimmed : `${workText} ${trimmed}`;
      }
    }
  }

  let happenedFrom = input.happenedFrom;
  let happenedTo = input.happenedTo;
  let wallDate: string | undefined;
  if (parsed.time?.kind === 'range') {
    happenedFrom = laterIso(happenedFrom, parsed.time.from);
    happenedTo = earlierIso(happenedTo, parsed.time.to);
  } else if (parsed.time?.kind === 'wall_date') {
    wallDate = padWall(parsed.time);
  }

  const hasOther =
    parsed.time !== null ||
    hardPlace !== null ||
    workText.trim().length > 0 ||
    Boolean(input.personId || input.tagId || input.place || input.happenedFrom || input.happenedTo);

  const personIdsByChain = new Map<string, string[]>();
  const kept: string[] = [];

  if (names.length === 0) {
    for (const id of scope) {
      kept.push(id);
      personIdsByChain.set(id, []);
    }
  } else {
    for (const chainId of scope) {
      const ids: string[] = [];
      for (const name of names) {
        const rows = await db
          .select({ id: persons.id })
          .from(persons)
          .where(and(eq(persons.chainId, chainId), eq(persons.name, name)));
        for (const row of rows) {
          if (!ids.includes(row.id)) ids.push(row.id);
        }
      }
      if (ids.length === 0 && !hasOther) continue;
      kept.push(chainId);
      personIdsByChain.set(chainId, ids);
    }
  }

  return {
    parsed,
    chainIds: kept,
    personIdsByChain,
    place: hardPlace,
    text: workText,
    happenedFrom,
    happenedTo,
    wallDate,
    personId: input.personId,
    tagId: input.tagId,
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/resolve-scope.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/resolve-scope.ts apps/server/tests/search/helpers.ts apps/server/tests/search/resolve-scope.test.ts
git commit -m "feat(server): resolve search scope with drop-chain rule"
```

---

### Task 5: search SQL（按链析取、wall_date、LIKE 转义、`{h,i}` 时间页）

**Files:**
- Create: `apps/server/src/search/like.ts`
- Create: `apps/server/src/search/search-query.ts`
- Test: `apps/server/tests/search/like.test.ts`
- Test: `apps/server/tests/search/search-query.test.ts`

**Interfaces:**
- Consumes:
  - drizzle `and` `or` `eq` `gte` `lte` `lt` `inArray` `isNull` `desc` `sql`；表 `moments` `momentPersons` `momentTags` `persons`
  - `encodeCursor` / `decodeCursor` from `../feed/cursor.js`（仅 `happened_at`）
  - Task 4 `ResolvedSearch`（本文件用更窄的 `SearchSqlFilter`，由 service 映射）
- Produces:
  - `export function escapeLike(raw: string): string` — 先 `\` 再 `%` `_`
  - `export function likeContains(column: Parameters<typeof sql>[0] 实际用 Column, raw: string): SQL`
  - `export interface SearchSqlFilter { chainIds: string[]; personIdsByChain: Map<string, string[]>; personId?: string; tagId?: string; place?: string | null; happenedFrom?: string; happenedTo?: string; wallDate?: string; likeText?: string; momentIds?: string[]; }`
  - `export function hasHardFilter(resolved: { personIdsByChain: Map<string, string[]>; place: string | null; personId?: string; tagId?: string; happenedFrom?: string; happenedTo?: string; wallDate?: string }): boolean` — 任一人名 id 列表非空，或 place/personId/tagId/区间/wallDate
  - `export async function listSearchIds(filter: SearchSqlFilter, cap: number): Promise<string[]>` — `deleted_at IS NULL` + 析取；`LIMIT cap`；`chainIds=[]` 或 `momentIds=[]` → `[]`（禁止 `IN ()`）
  - `export async function loadSearchMoments(filter: SearchSqlFilter): Promise<Moment[]>`
  - `export async function querySearchTimePage(filter: SearchSqlFilter & { cursor?: string; limit: number }): Promise<{ rows: Moment[]; nextCursor: string | null }>` — `ORDER BY happened_at DESC, id DESC`，游标 `{h,i}`；**无** `before`；空 `chainIds` 仍先 `decodeCursor` 再空页
  - SQL 形状：`(chain_id=c1 AND id IN p11 AND id IN p12) OR (chain_id=c2 AND id IN p2) OR (chain_id=c3)` 再 AND 全局 place/tag/body person/区间/wall_date/LIKE/momentIds

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/like.test.ts`：
```ts
import { escapeLike } from '../../src/search/like.js';

describe('escapeLike（spec §3.3）', () => {
  it('先反斜杠再 % _', () => {
    expect(escapeLike('a')).toBe('a');
    expect(escapeLike('100%_off')).toBe('100\\%\\_off');
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});
```

Create `apps/server/tests/search/search-query.test.ts`：
```ts
import { decodeCursor } from '../../src/feed/cursor.js';
import {
  hasHardFilter,
  listSearchIds,
  querySearchTimePage,
  type SearchSqlFilter,
} from '../../src/search/search-query.js';
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
import { auth, idsOf, setPlace, setTranscript } from './helpers.js';
import request from 'supertest';

beforeEach(resetDb);
afterAll(closeDb);

function base(chainIds: string[], over: Partial<SearchSqlFilter> = {}): SearchSqlFilter {
  return { chainIds, personIdsByChain: new Map(chainIds.map((id) => [id, []])), ...over };
}

describe('hasHardFilter', () => {
  it('仅空 person 列表不算硬过滤；有 id / place / 时间才算', () => {
    expect(hasHardFilter({ personIdsByChain: new Map([['c', []]]), place: null })).toBe(false);
    expect(hasHardFilter({ personIdsByChain: new Map([['c', ['p']]]), place: null })).toBe(true);
    expect(hasHardFilter({ personIdsByChain: new Map(), place: '朝阳公园' })).toBe(true);
    expect(hasHardFilter({ personIdsByChain: new Map(), place: null, wallDate: '2025-08-29' })).toBe(true);
  });
});

describe('querySearchTimePage 析取 / wall_date / LIKE / 游标', () => {
  it('链内两 person AND；跨链同名析取；0 人名链不过滤人物', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const b = await createChain(owner.id, 'B');
    const c = await createChain(owner.id, 'C');
    const gA = await insertPerson({ chainId: a, name: '外婆' });
    const dA = await insertPerson({ chainId: a, name: '朵朵' });
    const gB = await insertPerson({ chainId: b, name: '外婆' });
    const both = await insertMoment({ chainId: a, authorId: owner.id, happenedAt: new Date('2026-08-10T00:00:00Z') });
    const onlyG = await insertMoment({ chainId: a, authorId: owner.id, happenedAt: new Date('2026-08-09T00:00:00Z') });
    const onB = await insertMoment({ chainId: b, authorId: owner.id, happenedAt: new Date('2026-08-08T00:00:00Z') });
    const onC = await insertMoment({ chainId: c, authorId: owner.id, happenedAt: new Date('2026-08-07T00:00:00Z') });
    await attachPerson(both, gA);
    await attachPerson(both, dA);
    await attachPerson(onlyG, gA);
    await attachPerson(onB, gB);

    const page = await querySearchTimePage({
      ...base([a, b, c], {
        personIdsByChain: new Map([
          [a, [gA, dA]],
          [b, [gB]],
          [c, []],
        ]),
      }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([both, onB, onC]);
    void onlyG;
  });

  it('wall_date 等值（不是 happened_at 分桶）；软删除外', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T16:00:00Z'),
      happenedTzOffset: -480, // wall 2025-08-30
    });
    const sameUtc = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T16:00:00Z'),
      happenedTzOffset: 0, // wall 2025-08-29
    });
    const gone = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T00:00:00Z'),
      happenedTzOffset: 0,
      deletedAt: new Date(),
    });
    const page = await querySearchTimePage({ ...base([chainId], { wallDate: '2025-08-29' }), limit: 20 });
    expect(idsOf(page.rows)).toEqual([sameUtc]);
    void hit;
    void gone;
  });

  it('季节 range 闭区间 happened_at', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const before = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-05-31T23:59:59.000Z'),
    });
    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-06-01T00:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-31T23:59:59.999Z'),
    });
    const after = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-09-01T00:00:00.000Z'),
    });
    const page = await querySearchTimePage({
      ...base([chainId], {
        happenedFrom: '2025-06-01T00:00:00.000Z',
        happenedTo: '2025-08-31T23:59:59.999Z',
      }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([toEdge, fromEdge]);
    void before;
    void after;
  });

  it('LIKE：content/transcript/place_name/persons.name OR；转义 % _ \\', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const pct = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: 'hello%world',
    });
    const wild = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: 'helloXworld',
    });
    const under = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-08T00:00:00Z'),
      content: 'a_b',
    });
    const axb = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-07T00:00:00Z'),
      content: 'axb',
    });
    const byPlace = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-06T00:00:00Z'),
      content: '无',
    });
    await setPlace(byPlace, '朝阳公园');
    const byTr = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T00:00:00Z'),
      content: '无',
    });
    await setTranscript(byTr, '朵朵说话');
    const personMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-04T00:00:00Z'),
      content: '无',
    });
    const pid = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(personMoment, pid);

    const pctPage = await querySearchTimePage({
      ...base([chainId], { likeText: 'hello%world' }),
      limit: 20,
    });
    expect(idsOf(pctPage.rows)).toEqual([pct]);
    void wild;

    const underPage = await querySearchTimePage({
      ...base([chainId], { likeText: 'a_b' }),
      limit: 20,
    });
    expect(idsOf(underPage.rows)).toEqual([under]);
    void axb;

    const placePage = await querySearchTimePage({
      ...base([chainId], { likeText: '朝阳公园' }),
      limit: 20,
    });
    expect(idsOf(placePage.rows)).toContain(byPlace);

    const trPage = await querySearchTimePage({
      ...base([chainId], { likeText: '朵朵说话' }),
      limit: 20,
    });
    expect(idsOf(trPage.rows)).toContain(byTr);

    const namePage = await querySearchTimePage({
      ...base([chainId], { likeText: '外婆' }),
      limit: 20,
    });
    expect(idsOf(namePage.rows)).toContain(personMoment);
  });

  it('{h,i} 翻页；坏游标先于空 scope；listSearchIds cap', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });

    const p1 = await querySearchTimePage({ ...base([chainId]), limit: 1 });
    expect(p1.rows).toHaveLength(1);
    const decoded = decodeCursor('happened_at', p1.nextCursor!);
    expect(decoded.id).toBe(p1.rows[0].id);
    const raw = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as { d?: unknown };
    expect(raw.d).toBeUndefined();

    const p2 = await querySearchTimePage({ ...base([chainId]), cursor: p1.nextCursor!, limit: 1 });
    expect(new Set([p1.rows[0].id, p2.rows[0].id])).toEqual(new Set([a, b]));

    await expect(querySearchTimePage({ ...base([]), cursor: '!!!', limit: 20 })).rejects.toMatchObject({
      message: 'INVALID_CURSOR',
    });

    const ids = await listSearchIds(base([chainId]), 1);
    expect(ids).toHaveLength(1);
  });

  it('body tagId + personId AND；空 chainIds 合法游标 → 空页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const tagRes = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '野餐' });
    const tagId = tagRes.body.id as string;
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
    });
    await attachPerson(hit, personId);
    await attachTag(hit, tagId);
    await attachPerson(miss, personId);

    const page = await querySearchTimePage({
      ...base([chainId], { personId, tagId }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([hit]);

    const empty = await querySearchTimePage({ ...base([]), limit: 20 });
    expect(empty.rows).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    void miss;
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/like.test.ts tests/search/search-query.test.ts`

Expected: FAIL，`like.js` / `search-query.js` 不是模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/like.ts`：
```ts
import { sql, type SQL } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';

export function escapeLike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function likeContains(column: Column, raw: string): SQL {
  const pattern = `%${escapeLike(raw)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE ${sql.raw(`'\\\\'`)}`;
}
```

Create `apps/server/src/search/search-query.ts`：
```ts
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { momentPersons, moments, momentTags, persons, type Moment } from '../db/schema.js';
import { decodeCursor, encodeCursor } from '../feed/cursor.js';
import { likeContains } from './like.js';

export interface SearchSqlFilter {
  chainIds: string[];
  personIdsByChain: Map<string, string[]>;
  personId?: string;
  tagId?: string;
  place?: string | null;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
  likeText?: string;
  momentIds?: string[];
}

export function hasHardFilter(resolved: {
  personIdsByChain: Map<string, string[]>;
  place: string | null;
  personId?: string;
  tagId?: string;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
}): boolean {
  for (const ids of resolved.personIdsByChain.values()) {
    if (ids.length > 0) return true;
  }
  return Boolean(
    resolved.place ||
      resolved.personId ||
      resolved.tagId ||
      resolved.happenedFrom ||
      resolved.happenedTo ||
      resolved.wallDate,
  );
}

function personSemiJoin(personId: string): SQL {
  return inArray(
    moments.id,
    db.select({ id: momentPersons.momentId }).from(momentPersons).where(eq(momentPersons.personId, personId)),
  ) as SQL;
}

function buildConditions(filter: SearchSqlFilter): SQL[] {
  const conditions: SQL[] = [isNull(moments.deletedAt)];
  const chainParts: SQL[] = [];
  for (const chainId of filter.chainIds) {
    const pids = filter.personIdsByChain.get(chainId) ?? [];
    const parts: SQL[] = [eq(moments.chainId, chainId)];
    for (const pid of pids) parts.push(personSemiJoin(pid));
    chainParts.push(and(...parts) as SQL);
  }
  if (chainParts.length === 1) conditions.push(chainParts[0]);
  else if (chainParts.length > 1) conditions.push(or(...chainParts) as SQL);

  if (filter.place) conditions.push(eq(moments.placeName, filter.place));
  if (filter.happenedFrom) conditions.push(gte(moments.happenedAt, new Date(filter.happenedFrom)));
  if (filter.happenedTo) conditions.push(lte(moments.happenedAt, new Date(filter.happenedTo)));
  if (filter.wallDate) conditions.push(eq(moments.wallDate, filter.wallDate));
  if (filter.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db.select({ id: momentTags.momentId }).from(momentTags).where(eq(momentTags.tagId, filter.tagId)),
      ) as SQL,
    );
  }
  if (filter.personId) conditions.push(personSemiJoin(filter.personId));
  if (filter.momentIds) conditions.push(inArray(moments.id, filter.momentIds));
  if (filter.likeText) {
    conditions.push(
      or(
        likeContains(moments.content, filter.likeText),
        likeContains(moments.transcript, filter.likeText),
        likeContains(moments.placeName, filter.likeText),
        inArray(
          moments.id,
          db
            .select({ id: momentPersons.momentId })
            .from(momentPersons)
            .innerJoin(persons, eq(persons.id, momentPersons.personId))
            .where(likeContains(persons.name, filter.likeText)),
        ),
      ) as SQL,
    );
  }
  return conditions;
}

export async function listSearchIds(filter: SearchSqlFilter, cap: number): Promise<string[]> {
  if (filter.chainIds.length === 0) return [];
  if (filter.momentIds && filter.momentIds.length === 0) return [];
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(and(...buildConditions(filter)))
    .limit(cap);
  return rows.map((r) => r.id);
}

export async function loadSearchMoments(filter: SearchSqlFilter): Promise<Moment[]> {
  if (filter.chainIds.length === 0) return [];
  if (filter.momentIds && filter.momentIds.length === 0) return [];
  return db
    .select()
    .from(moments)
    .where(and(...buildConditions(filter)));
}

export async function querySearchTimePage(
  filter: SearchSqlFilter & { cursor?: string; limit: number },
): Promise<{ rows: Moment[]; nextCursor: string | null }> {
  const cursor = filter.cursor ? decodeCursor('happened_at', filter.cursor) : undefined;
  if (filter.chainIds.length === 0) return { rows: [], nextCursor: null };

  const conditions = buildConditions(filter);
  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      or(lt(moments.happenedAt, cursorTime), and(eq(moments.happenedAt, cursorTime), lt(moments.id, cursor.id))) as SQL,
    );
  }

  const rows = await db
    .select()
    .from(moments)
    .where(and(...conditions))
    .orderBy(desc(moments.happenedAt), desc(moments.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor('happened_at', last.happenedAt.getTime(), last.id) : null;
  return { rows: page, nextCursor };
}
```

`like.ts` 若 `Column` 类型 import 在本仓库 drizzle 版本不存在：改成 `import type { AnyColumn } from 'drizzle-orm'`，或把参数改成 `typeof moments.content`。停手条件只有测试红且类型错误无法用这些替换解决时才报告。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/like.test.ts tests/search/search-query.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/like.ts apps/server/src/search/search-query.ts \
  apps/server/tests/search/like.test.ts apps/server/tests/search/search-query.test.ts
git commit -m "feat(server): add search SQL disjunction and escaped LIKE"
```

---

### Task 6: `lanceInUuids` + `searchMomentVectors`（真实 Lance ANN，limit=200）

**Files:**
- Modify: `apps/server/src/lancedb/ids.ts`（追加 `lanceInUuids`）
- Modify: `apps/server/src/lancedb/repository.ts`（追加 `searchMomentVectors`）
- Test: `apps/server/tests/lancedb/ids-in.test.ts`
- Test: `apps/server/tests/lancedb/search-vectors.test.ts`

**Interfaces:**
- Consumes:
  - P4 `LANCE_UUID_RE` / `lanceEqUuid` / `getLanceTable` / `upsertMomentVector` / `ensureLance` / `resetLanceForTests` / `closeLanceForTests`
  - P4 测试 helper `denseVector` / `HEX64_A` from `tests/helpers/lance.ts`
  - `VECTOR_CANDIDATE_LIMIT`（调用方传入 `limit`，本函数不读常量也可以；测试钉 `limit=200` 截断）
- Produces:
  - `export function lanceInUuids(column: string, ids: string[]): string | null` — 非 uuid **静默丢弃**（与 `lanceEqUuid` 同形，本函数不打日志）；清洗后空 → `null`；成功 `` `${column} IN ('id1', 'id2')` ``（id 已过正则，禁止拼接未校验串）。丢弃时由 `searchMomentVectors` `logger.warn`
  - `export interface VectorNeighbor { momentId: string; chainId: string; kind: MomentVectorKind; mediaId: string; modelHash: string; distance: number }`
  - `export async function searchMomentVectors(opts: { vector: number[]; chainIds: string[]; momentIds?: string[]; limit: number }): Promise<VectorNeighbor[]>`
    - `chainIds.length===0` → `[]`，不调 Lance
    - `lanceInUuids('chainId', chainIds)` 为 null → `[]`
    - 若传入 `momentIds`：清洗后空 → `[]`；否则 AND `momentId IN (...)`
    - `getLanceTable().search(opts.vector).limit(opts.limit).where(pred).toArray()`
    - 读行上 `_distance`（必须是有限 number，否则 skip + warn）
    - **不**在 SQL where 拼 `modelHash`（非 uuid）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/lancedb/ids-in.test.ts`：
```ts
import { LANCE_UUID_RE, lanceEqUuid, lanceInUuids } from '../../src/lancedb/ids.js';

const A = '123e4567-e89b-12d3-a456-426614174000';
const B = '123e4567-e89b-12d3-a456-426614174001';

describe('lanceInUuids（spec §2.5 防拼接）', () => {
  it('只保留 uuid；空则 null', () => {
    expect(LANCE_UUID_RE.test(A)).toBe(true);
    expect(lanceInUuids('chainId', [A, B])).toBe(`chainId IN ('${A}', '${B}')`);
    expect(lanceInUuids('momentId', [`${A}' OR 1=1`, 'not-a-uuid'])).toBeNull();
    expect(lanceInUuids('chainId', [])).toBeNull();
    expect(lanceEqUuid('chainId', A)).toBe(`chainId = '${A}'`);
  });
});
```

Create `apps/server/tests/lancedb/search-vectors.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { searchMomentVectors, upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';

const CHAIN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHAIN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

describe('searchMomentVectors（spec §4.5）', () => {
  it('L2 近邻；where chainId；momentId 预过滤；非 uuid 丢弃', async () => {
    const near = randomUUID();
    const far = randomUUID();
    const otherChain = randomUUID();
    await upsertMomentVector({
      momentId: near,
      chainId: CHAIN_A,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: far,
      chainId: CHAIN_A,
      kind: 'moment',
      vector: denseVector(0.9),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: otherChain,
      chainId: CHAIN_B,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });

    const all = await searchMomentVectors({
      vector: denseVector(0.01),
      chainIds: [CHAIN_A],
      limit: 200,
    });
    expect(new Set(all.map((r) => r.momentId))).toEqual(new Set([near, far]));
    const dNear = all.find((r) => r.momentId === near)!.distance;
    const dFar = all.find((r) => r.momentId === far)!.distance;
    expect(dNear).toBeLessThan(dFar);
    expect(all.every((r) => Number.isFinite(r.distance))).toBe(true);

    const pre = await searchMomentVectors({
      vector: denseVector(0.01),
      chainIds: [CHAIN_A],
      momentIds: [far],
      limit: 200,
    });
    expect(pre.map((r) => r.momentId)).toEqual([far]);

    expect(await searchMomentVectors({ vector: denseVector(0.01), chainIds: [], limit: 200 })).toEqual([]);
    expect(
      await searchMomentVectors({
        vector: denseVector(0.01),
        chainIds: [CHAIN_A],
        momentIds: ["x' OR 1=1"],
        limit: 200,
      }),
    ).toEqual([]);
  });

  it('limit 截断为传入值（窗口=200 由调用方传 VECTOR_CANDIDATE_LIMIT，禁止内部改成 limit*3）', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertMomentVector({
        momentId: randomUUID(),
        chainId: CHAIN_A,
        kind: 'moment',
        vector: denseVector(0.01 * (i + 1)),
        modelHash: HEX64_A,
      });
    }
    const rows = await searchMomentVectors({ vector: denseVector(0.01), chainIds: [CHAIN_A], limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/ids-in.test.ts tests/lancedb/search-vectors.test.ts`

Expected: FAIL，`lanceInUuids` / `searchMomentVectors` 不是导出。`ensureLance` 既有。

- [ ] **Step 3: 最小实现**

Modify `apps/server/src/lancedb/ids.ts` — 在 `lanceEqUuid` 之后追加（不要改 `LANCE_UUID_RE` / `vectorRowId`；**不要**给本文件加 `logger`）：
```ts
export function lanceInUuids(column: string, ids: string[]): string | null {
  const clean = ids.filter((id) => LANCE_UUID_RE.test(id));
  if (clean.length === 0) return null;
  return `${column} IN (${clean.map((id) => `'${id}'`).join(', ')})`;
}
```

Modify `apps/server/src/lancedb/repository.ts` — 既有 `from './ids.js'` import 追加 `lanceInUuids`、`LANCE_UUID_RE`（不要重复 import 块、不要删 upsert/delete/list）。文件末尾追加：

```ts
export interface VectorNeighbor {
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId: string;
  modelHash: string;
  distance: number;
}

export async function searchMomentVectors(opts: {
  vector: number[];
  chainIds: string[];
  momentIds?: string[];
  limit: number;
}): Promise<VectorNeighbor[]> {
  if (opts.chainIds.length === 0) return [];
  const chainPred = lanceInUuids('chainId', opts.chainIds);
  if (!chainPred) {
    if (opts.chainIds.length > 0) logger.warn('lancedb search dropped non-uuid chainIds');
    return [];
  }
  if (opts.chainIds.some((id) => !LANCE_UUID_RE.test(id))) {
    logger.warn('lancedb search dropped non-uuid chainIds');
  }
  let pred = chainPred;
  if (opts.momentIds) {
    if (opts.momentIds.some((id) => !LANCE_UUID_RE.test(id))) {
      logger.warn('lancedb search dropped non-uuid momentIds');
    }
    const momentPred = lanceInUuids('momentId', opts.momentIds);
    if (!momentPred) return [];
    pred = `${chainPred} AND ${momentPred}`;
  }

  let raw: Record<string, unknown>[] = [];
  try {
    const table = getLanceTable() as unknown as {
      search: (vector: number[]) => {
        limit: (n: number) => { where: (p: string) => { toArray: () => Promise<Record<string, unknown>[]> } };
      };
    };
    raw = await table.search(opts.vector).limit(opts.limit).where(pred).toArray();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/search is not a function|is not a function/.test(msg)) {
      throw new Error(
        `LANCE_SEARCH_API: getLanceTable().search(vector).limit().where().toArray() failed: ${msg}`,
      );
    }
    throw err;
  }

  const out: VectorNeighbor[] = [];
  for (const row of raw) {
    const distance = row._distance;
    if (typeof distance !== 'number' || !Number.isFinite(distance)) {
      logger.warn('search vector row missing finite _distance');
      continue;
    }
    if (typeof row.momentId !== 'string' || typeof row.chainId !== 'string') continue;
    out.push({
      momentId: row.momentId,
      chainId: row.chainId,
      kind: row.kind === 'image' ? 'image' : 'moment',
      mediaId: typeof row.mediaId === 'string' ? row.mediaId : '',
      modelHash: typeof row.modelHash === 'string' ? row.modelHash : '',
      distance,
    });
  }
  return out;
}
```

若运行时必须 `search(vector, 'vector')`：改调用并在 `search-vectors.test.ts` 顶部注释一行实际签名。不要改成 `query()` 暴力扫。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/ids-in.test.ts tests/lancedb/search-vectors.test.ts tests/lancedb/worker-isolation.test.ts`

Expected: PASS。worker-isolation 仍绿（`search.service` 尚未存在；repository 增加 search 不进 worker 图）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lancedb/ids.ts apps/server/src/lancedb/repository.ts \
  apps/server/tests/lancedb/ids-in.test.ts apps/server/tests/lancedb/search-vectors.test.ts
git commit -m "feat(server): add Lance ANN search with uuid-safe IN"
```

---

### Task 7: `SearchService` 分层 C（双游标、去重最小距离、不回退 LIKE）

**Files:**
- Create: `apps/server/src/search/search.service.ts`
- Test: `apps/server/tests/search/search.service.test.ts`

**Interfaces:**
- Consumes:
  - Task 2 `parseSearchIntent`
  - Task 4 `resolveSearchScope` / `ResolvedSearch`
  - Task 5 `hasHardFilter` / `listSearchIds` / `loadSearchMoments` / `querySearchTimePage`
  - Task 3 `decodeDistanceCursor` / `encodeDistanceCursor`
  - `decodeCursor('happened_at')`（空 scope 也先校验）
  - P5 `getEmbeddingProvider` / `setEmbeddingProvider`
  - Task 6 `searchMomentVectors`
  - P1 `SEARCH_DEFAULT_LIMIT` / `SearchInput` / `SearchResponse`
  - `serializeMoments(rows, userId, { includePrivate: true })`
  - `HARD_FILTER_PREFILTER_MAX` / `VECTOR_CANDIDATE_LIMIT`
- Produces:
  - `@Service() export class SearchService { search(userId: string, input: SearchInput): Promise<SearchResponse> }`
  - 模式：`text===''` → 时间序 MySQL `{h,i}`，**不**调 `embed` / Lance；`text!==''` 且 provider 非 null → 向量 `{d,i}`；`text!==''` 且 provider null → LIKE `{h,i}`
  - 向量：硬过滤命中 `listSearchIds(..., HARD_FILTER_PREFILTER_MAX)`；`length===0` 空页不调 Lance；`length < 200` 则 `momentIds` 预过滤；否则或无硬过滤 → Lance 先 200 再 MySQL AND
  - 内存：`modelHash===provider.modelHash()`；按 `momentId` 去重 **最小** `_distance`；排序 `_distance ASC, momentId DESC`；游标 `distance > d OR (distance===d AND id < i)`；再截 `limit`；不足一页 `nextCursor=null`
  - `embed({ text })` 纯 text，不传 image。抛错 / `LANCE_NOT_READY` → 空页 + warn，不 LIKE
  - `limit` 缺省 `SEARCH_DEFAULT_LIMIT`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/search.service.test.ts`：
```ts
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { SearchParsed } from '@moment/dto';
import { SEARCH_DEFAULT_LIMIT } from '@moment/dto';
import { Container } from 'typedi';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { SearchService } from '../../src/search/search.service.js';
import { encodeDistanceCursor } from '../../src/search/search-cursor.js';
import { HARD_FILTER_PREFILTER_MAX, VECTOR_CANDIDATE_LIMIT } from '../../src/search/constants.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A, HEX64_B } from '../helpers/lance.js';
import { setPlace } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

afterEach(() => {
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});

function llm(parsed: SearchParsed): LLMProvider {
  return {
    async chat() {
      return { content: JSON.stringify(parsed), model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
    },
  };
}

function embedding(vec: number[], hash = HEX64_A, embedFn?: EmbeddingProvider['embed']): EmbeddingProvider {
  return {
    embed: embedFn ?? (async () => vec),
    modelHash: () => hash,
    dimensions: () => vec.length,
  };
}

function svc() {
  return Container.get(SearchService);
}

describe('SearchService 分层 C（spec §4.5 / §5 / §3.3）', () => {
  it('text==="" 仅硬过滤：happened_at 序、{h,i}、不调 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);

    const embedFn = jest.fn<EmbeddingProvider['embed']>();
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A, embedFn));

    const res = await svc().search(owner.id, { q: '外婆', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.parsed).toEqual({ personNames: ['外婆'], place: null, time: null, text: '' });
    expect(embedFn).not.toHaveBeenCalled();
    expect(res.moments[0].persons.some((p) => p.id === grandma)).toBe(true);
    if (res.nextCursor) {
      const raw = JSON.parse(Buffer.from(res.nextCursor, 'base64url').toString('utf8')) as { d?: unknown };
      expect(raw.d).toBeUndefined();
    }
  });

  it('空 embedding + 非空 text → LIKE（% 转义）；limit 缺省 20', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '100%_off',
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: '100X_off',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await svc().search(owner.id, { q: '100%_off', tzOffset: 0 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.parsed.text).toBe('100%_off');
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(HARD_FILTER_PREFILTER_MAX).toBe(200);
    expect(VECTOR_CANDIDATE_LIMIT).toBe(200);
  });

  it('向量：去重最小 L2；平局 momentId DESC；{d,i} 翻页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const near = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
      content: '近',
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-02-01T00:00:00Z'),
      content: '中',
    });
    const tieA = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-03-01T00:00:00Z'),
      content: '平',
    });
    const tieB = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-04-01T00:00:00Z'),
      content: '平2',
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'image',
      mediaId: randomUUID(),
      vector: denseVector(0.0),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: mid,
      chainId,
      kind: 'moment',
      vector: denseVector(0.2),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: tieA,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: tieB,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });

    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '近景' }));
    setEmbeddingProvider(embedding(denseVector(0.0)));

    const p1 = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 2 });
    expect(p1.moments).toHaveLength(2);
    expect(p1.moments[0].id).toBe(near);
    const raw1 = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as { d: number; i: string };
    expect(typeof raw1.d).toBe('number');
    expect(Number.isFinite(raw1.d)).toBe(true);

    const p2 = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 2, cursor: p1.nextCursor! });
    expect(p2.moments[0].id).not.toBe(near);
    const seen = [...p1.moments, ...p2.moments].map((m) => m.id);
    expect(seen).toContain(mid);
    const tiePos = seen.filter((id) => id === tieA || id === tieB);
    if (tiePos.length === 2) {
      expect(tiePos[0] > tiePos[1]).toBe(true);
    }

    const sameD = encodeDistanceCursor(raw1.d, raw1.i);
    const next = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 10, cursor: sameD });
    expect(next.moments.every((m) => m.id !== raw1.i)).toBe(true);
  });

  it('硬过滤 + 向量：结果都含人物', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: '野餐',
    });
    await attachPerson(hit, grandma);
    await upsertMomentVector({
      momentId: hit,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: miss,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '野餐' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    const res = await svc().search(owner.id, { q: '外婆野餐', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.moments[0].persons.some((p) => p.id === grandma)).toBe(true);
  });

  it('modelHash 全不匹配 → 空页，不回退 LIKE（content 能被 LIKE 命中也忽略）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const m = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '独一无二的正文XYZ',
    });
    await upsertMomentVector({
      momentId: m,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_B,
    });
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '独一无二的正文XYZ' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A));
    const res = await svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 });
    expect(res.moments).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it('空 scope 坏距离游标仍 INVALID_CURSOR', async () => {
    const loner = await registerUser();
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: 'x' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    await expect(svc().search(loner.id, { q: 'x', tzOffset: 0, cursor: '!!!' })).rejects.toMatchObject({
      message: 'INVALID_CURSOR',
    });
  });

  it('丢链：无外婆且无其它约束的链不倾倒时间线', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const b = await createChain(owner.id, 'B');
    const grandma = await insertPerson({ chainId: a, name: '外婆' });
    const hit = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const dump = await insertMoment({
      chainId: b,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    const res = await svc().search(owner.id, { q: '外婆', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.moments.map((m) => m.id)).not.toContain(dump);
  });

  it('硬过滤 0 命中：空页且不调 embed（HARD_FILTER_PREFILTER_MAX）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertPerson({ chainId, name: '外婆' });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    const embedFn = jest.fn(async () => denseVector(0.01));
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '野餐' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A, embedFn));
    const res = await svc().search(owner.id, { q: '外婆野餐', tzOffset: -480 });
    expect(res.moments).toEqual([]);
    expect(res.nextCursor).toBeNull();
    expect(embedFn).not.toHaveBeenCalled();
  });

  it('向量翻页窗口是 200 不是 limit*3（第 4 页仍命中）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
        content: `v${i}`,
      });
      ids.push(id);
      await upsertMomentVector({
        momentId: id,
        chainId,
        kind: 'moment',
        vector: denseVector(0.01 * (i + 1)),
        modelHash: HEX64_A,
      });
    }
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '近景' }));
    setEmbeddingProvider(embedding(denseVector(0)));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const res = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 1, cursor });
      expect(res.moments).toHaveLength(1);
      seen.push(res.moments[0].id);
      cursor = res.nextCursor ?? undefined;
    }
    expect(new Set(seen).size).toBe(4);
    expect(seen[0]).toBe(ids[0]);
  });

  it('embed 抛错 / LANCE_NOT_READY → 空页，不回退 LIKE', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '独一无二的正文XYZ',
    });
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '独一无二的正文XYZ' }));
    setEmbeddingProvider({
      embed: async () => {
        throw new Error('dashscope down');
      },
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });
    await expect(svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 })).resolves.toMatchObject({
      moments: [],
      nextCursor: null,
    });

    setEmbeddingProvider(embedding(denseVector(0.01)));
    await closeLanceForTests();
    try {
      const res = await svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 });
      expect(res.moments).toEqual([]);
      expect(res.nextCursor).toBeNull();
    } finally {
      await ensureLance();
    }
  });
});
```

`jest.fn<EmbeddingProvider['embed']>()` 若在本仓库 jest 泛型下报错：改 `jest.fn(async () => denseVector(0.01))` 再 `expect(embedFn).not.toHaveBeenCalled()`。

TypeDI：`SearchService` 必须 `@Service()`。本测试文件第一行 `import 'reflect-metadata'`（与 `chain-policy.test.ts` / `token.service.test.ts` 同形）。`Container.get(SearchService)` 依赖 `createApp()`/`fixtures` 已 `useContainer(Container)`。若 get 失败：测试里 `new SearchService()`（无构造依赖时允许），并在实现注释钉死无注入构造器。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/search.service.test.ts`

Expected: FAIL，`search.service.js` 不是模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/search/search.service.ts`（相对 import 一律 `.js`）：

```ts
import { SEARCH_DEFAULT_LIMIT, type SearchInput, type SearchResponse } from '@moment/dto';
import { Service } from 'typedi';
import { getEmbeddingProvider } from '../embedding/factory.js';
import { decodeCursor } from '../feed/cursor.js';
import { searchMomentVectors, type VectorNeighbor } from '../lancedb/repository.js';
import { serializeMoments } from '../moments/moment-serializer.js';
import { logger } from '../utils/logger.js';
import { HARD_FILTER_PREFILTER_MAX, VECTOR_CANDIDATE_LIMIT } from './constants.js';
import { parseSearchIntent } from './intent.js';
import { resolveSearchScope, type ResolvedSearch } from './resolve-scope.js';
import { decodeDistanceCursor, encodeDistanceCursor } from './search-cursor.js';
import { hasHardFilter, listSearchIds, loadSearchMoments, querySearchTimePage, type SearchSqlFilter } from './search-query.js';

function toFilter(r: ResolvedSearch, extra: Partial<SearchSqlFilter> = {}): SearchSqlFilter {
  return {
    chainIds: r.chainIds,
    personIdsByChain: r.personIdsByChain,
    personId: r.personId,
    tagId: r.tagId,
    place: r.place,
    happenedFrom: r.happenedFrom,
    happenedTo: r.happenedTo,
    wallDate: r.wallDate,
    ...extra,
  };
}

function retrievalMode(text: string): 'time' | 'like' | 'vector' {
  if (text === '') return 'time';
  return getEmbeddingProvider() ? 'vector' : 'like';
}

@Service()
export class SearchService {
  async search(userId: string, input: SearchInput): Promise<SearchResponse> {
    const parsed = await parseSearchIntent(input.q, input.tzOffset);
    const resolved = await resolveSearchScope(userId, input, parsed);
    const limit = input.limit ?? SEARCH_DEFAULT_LIMIT;
    const mode = retrievalMode(resolved.text);

    if (input.cursor) {
      if (mode === 'vector') decodeDistanceCursor(input.cursor);
      else decodeCursor('happened_at', input.cursor);
    }

    if (resolved.chainIds.length === 0) {
      return { moments: [], nextCursor: null, parsed };
    }

    if (mode === 'vector') return this.vectorSearch(userId, input, resolved, limit);
    const page = await querySearchTimePage({
      ...toFilter(resolved, { likeText: mode === 'like' ? resolved.text : undefined }),
      cursor: input.cursor,
      limit,
    });
    return {
      moments: await serializeMoments(page.rows, userId, { includePrivate: true }),
      nextCursor: page.nextCursor,
      parsed,
    };
  }

  private async vectorSearch(
    userId: string,
    input: SearchInput,
    resolved: ResolvedSearch,
    limit: number,
  ): Promise<SearchResponse> {
    const parsed = resolved.parsed;
    const empty = { moments: [] as SearchResponse['moments'], nextCursor: null as string | null, parsed };
    const provider = getEmbeddingProvider();
    if (!provider) return empty;

    const filter = toFilter(resolved);
    let prefilterIds: string[] | undefined;
    if (hasHardFilter(resolved)) {
      const ids = await listSearchIds(filter, HARD_FILTER_PREFILTER_MAX);
      if (ids.length === 0) return empty;
      if (ids.length < HARD_FILTER_PREFILTER_MAX) prefilterIds = ids;
    }

    let vector: number[];
    try {
      vector = await provider.embed({ text: resolved.text });
    } catch (err) {
      logger.warn('search query embed failed', err);
      return empty;
    }

    let neighbors: VectorNeighbor[] = [];
    try {
      neighbors = await searchMomentVectors({
        vector,
        chainIds: resolved.chainIds,
        momentIds: prefilterIds,
        limit: VECTOR_CANDIDATE_LIMIT,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'LANCE_NOT_READY') {
        logger.warn('search lance not ready');
        return empty;
      }
      throw err;
    }

    const expected = provider.modelHash();
    const matched = neighbors.filter((n) => n.modelHash === expected);
    if (matched.length !== neighbors.length) logger.warn('search dropped modelHash mismatch');
    if (matched.length === 0) {
      logger.warn('search vector candidates empty after modelHash');
      return empty;
    }

    const best = new Map<string, VectorNeighbor>();
    for (const n of matched) {
      const prev = best.get(n.momentId);
      if (!prev || n.distance < prev.distance) best.set(n.momentId, n);
    }
    let items = [...best.values()];

    if (prefilterIds === undefined) {
      const rows = await loadSearchMoments({ ...filter, momentIds: items.map((i) => i.momentId) });
      const allowed = new Set(rows.map((r) => r.id));
      items = items.filter((i) => allowed.has(i.momentId));
    }

    items.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.momentId === b.momentId) return 0;
      return a.momentId < b.momentId ? 1 : -1;
    });

    if (input.cursor) {
      const c = decodeDistanceCursor(input.cursor);
      items = items.filter((i) => i.distance > c.d || (i.distance === c.d && i.momentId < c.i));
    }

    const pageItems = items.slice(0, limit);
    const nextCursor =
      items.length > limit && pageItems[pageItems.length - 1]
        ? encodeDistanceCursor(pageItems[pageItems.length - 1].distance, pageItems[pageItems.length - 1].momentId)
        : null;

    const rows = await loadSearchMoments({ ...filter, momentIds: pageItems.map((p) => p.momentId) });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = pageItems.map((p) => byId.get(p.momentId)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    return {
      moments: await serializeMoments(ordered, userId, { includePrivate: true }),
      nextCursor,
      parsed,
    };
  }
}
```

**禁止** `import` 任何 `../storage/`。**禁止** `getObject`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/search.service.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/search.service.ts apps/server/tests/search/search.service.test.ts
git commit -m "feat(server): fuse search retrieval with dual cursors"
```

---

### Task 8: `POST /api/search` HTTP + 60s/20 限流 + app 接线

**Files:**
- Create: `apps/server/src/search/search.controller.ts`
- Modify: `apps/server/src/middlewares/rate-limit.ts`（追加 `searchKeyGenerator` / `searchRateLimiter` / 导出 `SEARCH_RATE_LIMIT` `SEARCH_RATE_WINDOW_MS`；**不改**既有 login/invite/public limiter 的 limit 数字）
- Modify: `apps/server/src/app.ts`（`populateUser` 之后 `app.post('/api/search', searchRateLimiter)`；`controllers` 数组末尾追加 `SearchController`。P4 的 `InternalEmbeddingsController` 若已在数组中，一字不删）
- Test: `apps/server/tests/search/search-rate-limit.test.ts`
- Test: `apps/server/tests/search/search-http.test.ts`
- Test: `apps/server/tests/search/search-http-vector.test.ts`

**Interfaces:**
- Consumes:
  - P1 `searchInputSchema.parse(body)` / `SearchResponse`
  - Task 7 `SearchService`
  - 既有 `ipKey` / `populateUser` / `@Authorized` / `@CurrentUser() UserProfile`
  - 既有 limiter `message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } }`（**同一对象**，不要另写文案）
- Produces:
  - `export const SEARCH_RATE_WINDOW_MS = 60_000`
  - `export const SEARCH_RATE_LIMIT = 20`（生产）；`searchRateLimiter` 的 `limit` = `config.NODE_ENV==='test' ? 1000 : SEARCH_RATE_LIMIT`
  - `export function searchKeyGenerator(req: Request): string` — `` `${ipKey(req)}:${userId}` ``，`userId = req.user?.id ?? 'anonymous'`
  - `export const searchRateLimiter` — `windowMs: SEARCH_RATE_WINDOW_MS`，`keyGenerator: searchKeyGenerator`，`standardHeaders: true`，`legacyHeaders: false`，`message` 与 auth 同对象
  - `SearchController`：`@JsonController()` `@Post('/search')` `@Authorized()`；`searchInputSchema.parse(body)`；`limit` 缺省由 service 补 20
  - HTTP：200 `SearchResponse`；zod 失败 400 `VALIDATION_ERROR`；坏游标 400 `INVALID_CURSOR`；未登录 401；超限 429 `RATE_LIMITED`。**不**出现 `RANGE_REQUIRES_HAPPENED_AT`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/search-rate-limit.test.ts`：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import request from 'supertest';
import {
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  searchKeyGenerator,
} from '../../src/middlewares/rate-limit.js';
import { listenLocalReady } from '../helpers/http-server.js';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

describe('searchRateLimiter 契约（spec §6.2）', () => {
  it('生产常量 60s / 20', () => {
    expect(SEARCH_RATE_WINDOW_MS).toBe(60_000);
    expect(SEARCH_RATE_LIMIT).toBe(20);
  });

  it('searchKeyGenerator：同 /56 IPv6 + 同 userId → 同 key', () => {
    const ipA = '0123:4567:89ab:cd11:1111:1111:1111:1111';
    const ipB = '0123:4567:89ab:cd22:2222:2222:2222:2222';
    expect(ipKeyGenerator(ipA, 56)).toBe(ipKeyGenerator(ipB, 56));
    const k1 = searchKeyGenerator({ ip: ipA, user: { id: 'u-1' } } as never);
    const k2 = searchKeyGenerator({ ip: ipB, user: { id: 'u-1' } } as never);
    expect(k1).toBe(k2);
    expect(searchKeyGenerator({ ip: ipA, user: { id: 'u-2' } } as never)).not.toBe(k1);
  });

  it('同一 message 信封 429 RATE_LIMITED（独立小 app，不打满测试环境 1000）', async () => {
    const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };
    const app = express();
    app.use(express.json());
    app.post(
      '/api/search',
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: searchKeyGenerator,
        message,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const server = await listenLocalReady(app);
    expect((await request(server).post('/api/search').send({})).status).toBe(200);
    expect((await request(server).post('/api/search').send({})).status).toBe(200);
    const limited = await request(server).post('/api/search').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('app.ts 在 populateUser 之后挂 POST /api/search limiter，并注册 SearchController', () => {
    const src = readFileSync(path.join(SERVER_SRC, 'app.ts'), 'utf8');
    const pop = src.indexOf('app.use(populateUser)');
    const lim = src.indexOf("app.post('/api/search', searchRateLimiter)");
    const useExpress = src.indexOf('useExpressServer');
    expect(pop).toBeGreaterThan(-1);
    expect(lim).toBeGreaterThan(pop);
    expect(useExpress).toBeGreaterThan(lim);
    expect(src).toContain('SearchController');
    expect(src).toContain('InternalEmbeddingsController');
  });
});
```

Create `apps/server/tests/search/search-http.test.ts`：
```ts
import request from 'supertest';
import { SEARCH_DEFAULT_LIMIT } from '@moment/dto';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import type { SearchParsed } from '@moment/dto';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { auth, setPlace } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

let storage: ReturnType<typeof installMockStorage>;
beforeEach(() => {
  storage = installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});

function llm(parsed: SearchParsed): LLMProvider {
  return {
    async chat() {
      return { content: JSON.stringify(parsed), model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
    },
  };
}

describe('POST /api/search HTTP（spec §6.2 / §9）', () => {
  it('未登录 401；缺 tzOffset / q 超 500 / from>to → 400 VALIDATION_ERROR', async () => {
    expect((await request(app).post('/api/search').send({ q: '外婆', tzOffset: -480 })).status).toBe(401);

    const user = await registerUser();
    const missingTz = await request(app).post('/api/search').set(auth(user.token)).send({ q: '外婆' });
    expect(missingTz.status).toBe(400);
    expect(missingTz.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await request(app)
      .post('/api/search')
      .set(auth(user.token))
      .send({ q: 'x'.repeat(501), tzOffset: 0 });
    expect(tooLong.status).toBe(400);

    const range = await request(app)
      .post('/api/search')
      .set(auth(user.token))
      .send({
        q: '外婆',
        tzOffset: 0,
        happenedFrom: '2026-08-02T00:00:00.000Z',
        happenedTo: '2026-08-01T00:00:00.000Z',
      });
    expect(range.status).toBe(400);
    expect(JSON.stringify(range.body)).not.toContain('RANGE_REQUIRES_HAPPENED_AT');
  });

  it('空 LLM：parsed.text===q；body before 被 strip；不调用 getObject；默认 limit 语义 20', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const m = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '野餐', tzOffset: -480, before: '2026-08-01T00:00:00Z', order: 'created_at' });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({ personNames: [], place: null, time: null, text: '野餐' });
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([m]);
    expect(res.body.moments[0].persons).toBeDefined();
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
  });

  it('他链 chainIds 静默丢弃；空页；坏游标 400 INVALID_CURSOR', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const a = await createChain(alice.id, 'A');
    const c = await createChain(carol.id, 'C');
    await insertMoment({
      chainId: a,
      authorId: alice.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    await insertMoment({
      chainId: c,
      authorId: carol.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
      content: '野餐',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(alice.token))
      .send({ q: '野餐', tzOffset: 0, chainIds: [c] });
    expect(res.status).toBe(200);
    expect(res.body.moments).toEqual([]);

    const bad = await request(app)
      .post('/api/search')
      .set(auth(alice.token))
      .send({ q: '野餐', tzOffset: 0, cursor: '!!!not-base64!!!' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('丢链：无外婆且无其它约束的链不倾倒时间线', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const b = await createChain(owner.id, 'B');
    const grandma = await insertPerson({ chainId: a, name: '外婆' });
    const hit = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const dump = await insertMoment({
      chainId: b,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '' }));
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '外婆', tzOffset: -480 });
    expect(res.status).toBe(200);
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([hit]);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(dump);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('季节 range 闭区间 + chip AND place（不带 before）', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const grandma = await insertPerson({ chainId: a, name: '外婆' });
    const inSummer = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-07-15T00:00:00Z'),
    });
    const outSummer = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-09-01T00:00:00Z'),
    });
    const noPerson = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-07-15T00:00:00Z'),
    });
    await attachPerson(inSummer, grandma);
    await attachPerson(outSummer, grandma);
    await setPlace(inSummer, '朝阳公园');
    await setPlace(outSummer, '朝阳公园');
    await setPlace(noPerson, '朝阳公园');

    setLLMProvider(
      llm({
        personNames: ['外婆'],
        place: null,
        time: { kind: 'range', from: '2025-06-01T00:00:00.000Z', to: '2025-08-31T23:59:59.999Z' },
        text: '',
      }),
    );
    setEmbeddingProvider(null);

    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '去年夏天和外婆', tzOffset: -480, place: '朝阳公园' });
    expect(res.status).toBe(200);
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([inSummer]);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(outSummer);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(noPerson);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
```

Create `apps/server/tests/search/search-http-vector.test.ts`：
```ts
import { jest } from '@jest/globals';
import request from 'supertest';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { auth } from './helpers.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

beforeEach(resetDb);
afterAll(closeDb);
beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

let storage: ReturnType<typeof installMockStorage>;
beforeEach(() => {
  storage = installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});

function llmText(text: string): LLMProvider {
  return {
    async chat() {
      return {
        content: JSON.stringify({ personNames: [], place: null, time: null, text }),
        model: 'm',
        usage: { prompt: 1, completion: 1, total: 2 },
      };
    },
  };
}

describe('POST /api/search 向量 HTTP', () => {
  it('仅 text 走距离序 {d,i}；embed 只收 text', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const near = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
      content: '近',
    });
    const far = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-12-01T00:00:00Z'),
      content: '远',
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: far,
      chainId,
      kind: 'moment',
      vector: denseVector(0.8),
      modelHash: HEX64_A,
    });

    const embed = jest.fn(async (req: { text?: string; imageDataUri?: string }) => {
      expect(req.imageDataUri).toBeUndefined();
      expect(req.text).toBe('近景');
      return denseVector(0.01);
    });
    setLLMProvider(llmText('近景'));
    setEmbeddingProvider({
      embed,
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });

    const res = await request(app).post('/api/search').set(auth(owner.token)).send({ q: '近景', tzOffset: 0, limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.moments[0].id).toBe(near);
    const raw = JSON.parse(Buffer.from(res.body.nextCursor, 'base64url').toString('utf8')) as {
      d: number;
      i: string;
      h?: unknown;
    };
    expect(raw.i).toBe(near);
    expect(raw.h).toBeUndefined();
    expect(Number.isFinite(raw.d)).toBe(true);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(storage.getObject).not.toHaveBeenCalled();

    const page2 = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '近景', tzOffset: 0, limit: 1, cursor: res.body.nextCursor });
    expect(page2.status).toBe(200);
    expect(page2.body.moments[0].id).toBe(far);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/search/search-rate-limit.test.ts tests/search/search-http.test.ts tests/search/search-http-vector.test.ts`

Expected: FAIL。红灯：`search.controller.js` 缺失、`app.ts` 无 `SearchController` / 无 `app.post('/api/search'`、`searchKeyGenerator` 未导出。`installMockStorage().getObject` 在 P1 已存在——若缺失说明上游未落地，停手。不要为了红灯去改 dto。

- [ ] **Step 3: 最小实现**

Modify `apps/server/src/middlewares/rate-limit.ts` — 在 `inviteAcceptRateLimiter` 之后、`publicShareRateLimiter` 之前（或文件末尾，不要改其它 limiter 的 `limit:` 数字）追加：
```ts
export const SEARCH_RATE_WINDOW_MS = 60_000;
export const SEARCH_RATE_LIMIT = 20;

export function searchKeyGenerator(req: Request): string {
  const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
  return `${ipKey(req)}:${userId}`;
}

export const searchRateLimiter = rateLimit({
  windowMs: SEARCH_RATE_WINDOW_MS,
  limit: isTest ? 1000 : SEARCH_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: searchKeyGenerator,
  message,
});
```

`message` 必须复用文件顶部已有的那一个对象（`code: 'RATE_LIMITED'`）。

Create `apps/server/src/search/search.controller.ts`：
```ts
import { searchInputSchema, type SearchResponse, type UserProfile } from '@moment/dto';
import { Authorized, Body, CurrentUser, JsonController, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { SearchService } from './search.service.js';

@JsonController()
@Service()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('/search')
  @Authorized()
  search(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<SearchResponse> {
    const input = searchInputSchema.parse(body);
    return this.searchService.search(user.id, input);
  }
}
```

Modify `apps/server/src/app.ts`：
1. import 增加 `SearchController` from `./search/search.controller.js`
2. rate-limit import 增加 `searchRateLimiter`
3. 在 `app.use(populateUser);` 之后、`useExpressServer` 之前追加：
   `app.post('/api/search', searchRateLimiter);`
4. `controllers` 数组末尾追加 `SearchController`（P4 `InternalEmbeddingsController` 一字不删）

不要调用 `ensureLance()`。不要把 limiter 挂到 `useExpressServer` 之后。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/search/search-rate-limit.test.ts tests/search/search-http.test.ts tests/search/search-http-vector.test.ts tests/search/search.service.test.ts tests/search/intent.test.ts tests/lancedb/worker-isolation.test.ts tests/health.test.ts`

Expected: PASS。`createApp()` 仍不 connect Lance（health 不依赖 Lance）。worker-isolation 仍绿。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/search/search.controller.ts apps/server/src/middlewares/rate-limit.ts apps/server/src/app.ts \
  apps/server/tests/search/search-rate-limit.test.ts apps/server/tests/search/search-http.test.ts \
  apps/server/tests/search/search-http-vector.test.ts
git commit -m "feat(server): add POST /api/search with rate limit"
```

---

## Definition of Done

- `POST /api/search`：JWT 必填；`searchInputSchema`；`tzOffset` 必填；`limit` 缺省 20 最大 50；body 无 `before`/`order`/`source`。
- 意图：逐字 prompt、8s 超时、畸形/空 key/Retryable 降级 `text=q`；不抽 tag；nock 钉 `temperature=0`。
- 丢链规则（HTTP：无其它约束才丢链，不把 time/place 误当成丢链）+ 跨链同名析取 + 链内多 id AND + 解析 place 零命中并入工作 text。
- 分层 C：仅硬过滤不调 Lance/embed；仅 text 调；混合结果含硬实体。硬过滤 0 命中空页且不调 embed。`VECTOR_CANDIDATE_LIMIT=200`（禁止 `limit*3`；limit=1 翻到第 4 页仍命中），去重最小 L2。
- 双游标：`{h,i}` 复用 feed cursor；`{d,i}` 新文件；坏串 / 非有限 `d` → `INVALID_CURSOR`。
- 空 embedding LIKE 转义 `%` `_` `\`。query embed 抛错 / `LANCE_NOT_READY` → 空页不 LIKE。
- 限流 60s/20，测试环境 1000，命中 `RATE_LIMITED`。
- 零 `getObject`。不改 dto。无 jobs/web/app/backfill。`InternalEmbeddingsController` 仍在 `app.ts`。
- 测试：`pnpm --filter @moment/server test -- tests/search tests/lancedb/search-vectors.test.ts tests/lancedb/ids-in.test.ts` 全绿。

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P6）**：§3 意图（逐字 prompt / 不抽 tag / 8s / 降级）+ §3.2 丢链与按链析取 + §3.3 LIKE 转义 + §4.5 `VECTOR_CANDIDATE_LIMIT=200` / `HARD_FILTER_PREFILTER_MAX=200` + §5 双游标最小 L2 + §6.2 POST `/api/search` 无 `before` + 60s/20 `RATE_LIMITED` + §8 零 `getObject` / `createApp` 不 connect。GET chip / jobs / api-client / web / app / backfill 不在本计划。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：P1 `searchInputSchema` / `SearchParsed` / `SEARCH_DEFAULT_LIMIT` 不重定义；P2 `queryMomentPage.personId` 不调用；P4 `ensureLance` / `searchMomentVectors` 追加；P5 `embed({ text })` 查询期。`INTENT_MAX_QUERY_CHARS`（dto）≠ `INTENT_TIMEOUT_MS`（server）。
