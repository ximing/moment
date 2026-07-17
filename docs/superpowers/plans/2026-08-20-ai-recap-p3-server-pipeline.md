# AI 月度回顾 P3：server recaps 表 + 输入组装 + prompt + generate 管线 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/server` 落地 recap 生成管线：`recaps` 表（spec §2）、`buildRecapInput`（spec §4 输入组装 + 截断护栏 + 幻觉过滤）、prompt 模板（`PROMPT_VERSION`/`buildSystemPrompt`/`buildUserPrompt`）、`generateRecap`（预算降级 + provider 调用 + 解析重试 + upsert），以及迁移 0011、`resetDb` 扩展、`insertRecap` 夹具。

**Architecture:** recaps 是单表（含 `UNIQUE(chain_id, period)`，重生成 = upsert）。`generateRecap` 是 outbox handler（T4）的下游调用方：组装 `RecapInput` → 查当月 token 预算 → 超 budget 或 provider=null 走降级（规则文案 + status=degraded，不调 provider）→ 否则 `provider.chat` → 解析 JSON（失败重试一次）→ 过滤幻觉 id → upsert recaps 行。provider 经依赖注入（`opts.provider` 或 `getLLMProvider()`），测试用 mock provider 不触真实 LLM/网络。

**Tech Stack:** drizzle-orm / zod / jest + supertest（真实测试库，`--runInBand`，触库文件 `afterAll(closeDb)`）；LLM 调用全程 mock 注入（`setLLMProvider(mock)` + `afterEach(setLLMProvider(undefined))` 清理，对齐 p2 三态）。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§2 数据模型、§4 输入组装、§5 成本护栏与降级）

## Global Constraints

- 执行 prompt T3 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`；Produces 符号 `recaps` 表 / `RecapInput` / `SerializedMoment` / `buildRecapInput` / `PROMPT_VERSION` / `buildSystemPrompt` / `buildUserPrompt` / `generateRecap` / `buildDegradedContent` 逐字不得改。
- 上游契约（已定稿）：T1 `RecapDto` / `RecapStatus` / `periodSchema` / `RecapTokenUsage`（`packages/dto/src/recaps.ts`）；T2 `LLMProvider` / `LLMChatRequest` / `LLMChatResponse` / `OpenAICompatProvider` / `getLLMProvider` / `setLLMProvider` / `RetryableLLMError` / `NonRetryableLLMError`（`apps/server/src/llm/*`）。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 数据表约定：主键 `char('id', { length: 36 })` + 应用层 `randomUUID()`；时间列 `timestamp(..., { mode: 'date' })`，`createdAt` 一律 `.notNull().defaultNow()`；FK `ON DELETE CASCADE`（软删链的 recaps 随链硬删级联，spec §2）。
- 新表落地流程：建表 → `drizzle-kit generate` → migrate → **扩展 `resetDb()`（按外键依赖逆序 delete，recaps 在 chains 之前删——FK 逆序）** → 同步 `tests/helpers/fixtures.ts` 夹具。
- 触库测试必须 `afterAll(closeDb)` + `resetDb()`；provider 单测不触库。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **`highlights` 类型 `string[]` 而非 `number[]`**：spec §4 写 `highlight_moment_ids: number[]`，但 `moments.id` 是 `char(36)` UUID（`apps/server/src/db/schema/moments.ts`），故 `highlights` / `highlight_moment_ids` 类型为 `string[]`。这是 spec 笔误的机械修正，非设计发明（与 T1/T2 同款偏差）。
2. **`mediaRefs[].media_id` 类型 `string` 而非 `number`**：spec §3 写 `mediaRefs?: { media_id: number; kind: 'image' }[]`，但 `media.id` 是 `char(36)`，故 `media_id: string`。同款偏差。v1 `mediaRefs` 恒为 `[]`（视觉预留，接口不变）。
3. **token_usage 透传 LLM usage 不重发明字段名（T3 末尾 S5 注）**：T1 `RecapTokenUsage` 与 T2 `LLMChatResponse.usage` shape 相同（`{prompt, completion, total}`），`generateRecap` 直接透传 LLM 响应 `usage` 到 `recaps.token_usage`，字段名一致。
4. **wall_date 列名**：`moments.wallDate`（`date('wall_date', { mode: 'string' })`，值为 `YYYY-MM-DD`）。spec §4「取该链 wall_date 落 period 内」= `moments.wallDate LIKE '${period}-%'`（period = `YYYY-MM`，wall_date = `YYYY-MM-DD`，前缀匹配）。period 归属月按 wall_date 的年月。
5. **截断排序键**：spec §4「有 payload 的结构化记录优先，其次按评论数」——排序权重 = `hasPayload ? 1 : 0` 降序，再 `comments.length` 降序，再按原 happenedAt 正序稳定。总字符超限二次截断时，截尾并标注条数。

---

### Task 1: recaps 表 schema + 迁移 0011 + resetDb 扩展 + insertRecap 夹具

**Files:**
- Create: `apps/server/src/db/schema/recaps.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 加一行）
- Create: `apps/server/drizzle/0011_recaps.sql`
- Modify: `apps/server/drizzle/meta/_journal.json`、`apps/server/drizzle/meta/0011_snapshot.json`（drizzle-kit generate 产出，不手写）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 加 recaps，在 chains 之前删——FK 逆序）
- Modify: `apps/server/tests/helpers/fixtures.ts`（insertRecap）
- Test: `apps/server/tests/recaps/schema-columns.test.ts`

**Interfaces:**
- Consumes: `chains`（`src/db/schema/chains.ts`，FK 目标）；既有 `resetDb` / `closeDb`（`tests/helpers/db.ts`）。
- Produces（后续 Task 引用，名锁定）:
  - `recaps` 表（spec §2 全列）：`id char(36) pk`、`chainId char(36) FK→chains ON DELETE CASCADE`、`period char(7)`、`status enum('generating','ready','failed','degraded')`、`content text`、`highlights json`（`string[]`）、`model varchar(255) null`、`promptVersion int`、`tokenUsage json null`、`error text null`、`generatedAt timestamp null`、`createdAt timestamp notNull defaultNow`、`updatedAt timestamp notNull defaultNow onUpdateNow`；`UNIQUE(chain_id, period)`。
  - `type Recap`（`$inferSelect`）、`type NewRecap`（`$inferInsert`）
  - `insertRecap(opts)` 夹具（直插 recaps 行，测试用）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/recaps/schema-columns.test.ts`（触库，`afterAll(closeDb)`）：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, recaps } from '../../src/db/schema.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertRecap } from '../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('recaps 表（spec §2）', () => {
  it('insertRecap 默认值：status=generating、highlights=[]、model/tokenUsage/generatedAt/error null', async () => {
    const chainId = await createChain(owner.id);
    const id = await insertRecap({ chainId, period: '2026-07' });
    const [row] = await db.select().from(recaps).where(eq(recaps.id, id));
    expect(row.chainId).toBe(chainId);
    expect(row.period).toBe('2026-07');
    expect(row.status).toBe('generating');
    expect(row.highlights).toEqual([]);
    expect(row.content).toBe('');
    expect(row.model).toBeNull();
    expect(row.promptVersion).toBe(1);
    expect(row.tokenUsage).toBeNull();
    expect(row.error).toBeNull();
    expect(row.generatedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('UNIQUE(chain_id, period)：同链同期重插触发冲突；跨链/跨期不冲突', async () => {
    const c1 = await createChain(owner.id);
    const c2 = await createChain(owner.id);
    await insertRecap({ chainId: c1, period: '2026-07' });
    await expect(insertRecap({ chainId: c1, period: '2026-07' })).rejects.toThrow();
    // 跨链同期 / 同链跨期 OK
    await insertRecap({ chainId: c2, period: '2026-07' });
    await insertRecap({ chainId: c1, period: '2026-08' });
  });

  it('FK ON DELETE CASCADE：删链级联删 recaps', async () => {
    const chainId = await createChain(owner.id);
    await insertRecap({ chainId, period: '2026-07' });
    await db.delete(chains).where(eq(chains.id, chainId));
    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/recaps/schema-columns.test.ts`
Expected: FAIL，`recaps` schema 未导出（`Cannot find module` 或 `chains/recaps` 未在 barrel，TS 编译错误），`insertRecap` 不存在。

- [ ] **Step 3: 实现 recaps schema**

Create `apps/server/src/db/schema/recaps.ts`：
```ts
import { char, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';

/**
 * AI 月度回顾（spec §2）。
 * period = char(7) YYYY-MM，按 moment 的 wall_date 归属月份。
 * UNIQUE(chain_id, period)：重生成 = upsert（覆盖 content/highlights/status，保留 created_at）。
 * FK ON DELETE CASCADE：软删链的 recaps 随链硬删级联（链删除是硬删语义，spec §2）。
 */
export const recaps = mysqlTable(
  'recaps',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => chains.id, { onDelete: 'cascade' }),
    /** YYYY-MM（char(7)，按 wall_date 归属月，spec §2） */
    period: char('period', { length: 7 }).notNull(),
    status: mysqlEnum('status', ['generating', 'ready', 'failed', 'degraded']).notNull().default('generating'),
    /** Markdown 正文（spec §2 content text） */
    content: text('content').notNull(),
    /**
     * 引用的 moment id 有序列表（客户端渲染「高光时刻」跳转，spec §2/§7）。
     * spec §4 写 `highlight_moment_ids: number[]`，但 moments.id 是 char(36) UUID，
     * 故类型为 string[]（spec 笔误的机械修正，非设计发明）。
     */
    highlights: json('highlights').$type<string[]>().notNull().default([]),
    /** 实际使用的模型名（审计）；failed/degraded 时为 null */
    model: varchar('model', { length: 255 }),
    /** prompt 模板版本（重生成对比用） */
    promptVersion: int('prompt_version').notNull().default(1),
    /** token 用量 {prompt, completion, total}（成本核算）；failed/degraded 时为 null。
     *  透传 LLMChatResponse.usage（shape 一致，T3 末尾 S5 注），不重发明字段名。 */
    tokenUsage: json('token_usage').$type<{ prompt: number; completion: number; total: number }>(),
    /** failed 时的摘要；非 failed 为 null */
    error: text('error'),
    /** 生成完成时间；generating/failed 时为 null */
    generatedAt: timestamp('generated_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex('idx_recaps_chain_period').on(t.chainId, t.period)]
);

export type Recap = typeof recaps.$inferSelect;
export type NewRecap = typeof recaps.$inferInsert;
```

- [ ] **Step 4: barrel 导出**

Modify `apps/server/src/db/schema.ts` — 在 `export * from './schema/templates.js';` 之后追加一行：
```ts
export * from './schema/recaps.js';
```

- [ ] **Step 5: 生成迁移**

Run: `pnpm --filter @moment/server migrate:generate`
Expected: `drizzle/` 新增 `0011_*.sql`（0000–0010 已占）。drizzle 生成 `CREATE TABLE recaps` + `UNIQUE INDEX` + `FK ON DELETE CASCADE`。无需手工改三阶段（新表无存量数据回填，spec §2 迁移与回滚：drop table 无损）。

确认生成 SQL 含 `ON DELETE CASCADE`（drizzle 的 `.references(..., { onDelete: 'cascade' })` 会生成）。若未生成 `CASCADE`，手工编辑 `0011_*.sql` 补 `ON DELETE CASCADE`（与 schema 一致）。

Run: `pnpm --filter @moment/server migrate`
Expected: exit 0（globalSetup 也会在测试前自动跑迁移）。

- [ ] **Step 6: 扩展 resetDb（FK 逆序：recaps 在 chains 之前删）**

Modify `apps/server/tests/helpers/db.ts`：
- import 块把 `recaps` 加入 `from '../../src/db/schema.js'` 的导入列表（在 `templates` 之后）。
- `resetDb()` 内 `await db.delete(chains);` 之前插入 `await db.delete(recaps);`（recaps FK→chains，删 chains 前先删 recaps，避免 FK 约束报错）：
```ts
  await db.delete(shareLinks);
  await db.delete(recaps);
  await db.delete(chains);
```

- [ ] **Step 7: insertRecap 夹具**

Modify `apps/server/tests/helpers/fixtures.ts`：
- import 块加 `import { ..., recaps, ... }`（在 `moments` 之后加入 `from '../../src/db/schema.js'` 导入列表）。
- 文件末尾追加：
```ts
/** 直插 recap 行（测试用，绕过 generate 管线）。默认 status=generating，可覆盖全字段。 */
export async function insertRecap(opts: {
  chainId: string;
  period: string;
  status?: 'generating' | 'ready' | 'failed' | 'degraded';
  content?: string;
  highlights?: string[];
  model?: string | null;
  promptVersion?: number;
  tokenUsage?: { prompt: number; completion: number; total: number } | null;
  error?: string | null;
  generatedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(recaps).values({
    id,
    chainId: opts.chainId,
    period: opts.period,
    status: opts.status ?? 'generating',
    content: opts.content ?? '',
    highlights: opts.highlights ?? [],
    model: opts.model ?? null,
    promptVersion: opts.promptVersion ?? 1,
    tokenUsage: opts.tokenUsage ?? null,
    error: opts.error ?? null,
    generatedAt: opts.generatedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
```

- [ ] **Step 8: 运行确认通过 + 全量回归**

Run:
```bash
pnpm --filter @moment/server test -- tests/recaps/schema-columns.test.ts
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
```
Expected: schema-columns 3 个测试全过；全量回归全绿（resetDb 扩展后既有测试不回归）；typecheck exit 0。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/db/schema/recaps.ts apps/server/src/db/schema.ts apps/server/drizzle/0011_*.sql apps/server/drizzle/meta/ apps/server/tests/helpers/db.ts apps/server/tests/helpers/fixtures.ts apps/server/tests/recaps/schema-columns.test.ts
git commit -m "feat(server): add recaps table schema and migration"
```

---

### Task 2: RecapInput 类型 + SerializedMoment + buildRecapInput（输入组装）

**Files:**
- Create: `apps/server/src/llm/recap/input.ts`
- Test: `apps/server/tests/llm/recap/input.test.ts`

**Interfaces:**
- Consumes: `chains` / `moments` / `comments` / `chainMembers` / `users`（schema）；`TemplateService.getByKey`（取 manifest 的 `milestoneCatalog`/`chainPayloadSchema`）；`config.LLM_RECAP_MAX_MOMENTS` / `LLM_RECAP_MAX_CHARS`（T2 config）；T1 `Period`。
- Produces（后续 Task 引用，名锁定）:
  - `interface SerializedMoment`：`{ line: string; momentId: string; comments: string[] }`
    - `line` = `[MM-DD HH:mm] {作者昵称}` + 正文 + kind 标记 + payload 摘要（单行）
    - `comments`：每条 ≤100 字、每 moment ≤2 条（按 createdAt 升序取前 2，未软删）
  - `interface RecapInput`：`{ moments: SerializedMoment[]; period: Period; chainName: string; babyAge?: string; mediaRefs: { media_id: string; kind: 'image' }[]; truncated: { moments: boolean; chars: boolean; count: number } }`
    - `mediaRefs` v1 恒为 `[]`（视觉预留，接口不变）
    - `truncated.count` = 截断后保留条数
  - `buildRecapInput(chainId: string, period: Period): Promise<RecapInput>`（spec §4）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/recap/input.test.ts`（触库，`afterAll(closeDb)`，`beforeEach(resetDb)`）：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { comments } from '../../../src/db/schema.js';
import { createUser, type TestUser } from '../../helpers/auth.js';
import { closeDb, resetDb } from '../../helpers/db.js';
import { app, createChain, insertMoment } from '../../helpers/fixtures.js';
import { buildRecapInput } from '../../../src/llm/recap/input.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

async function insertComment(momentId: string, authorId: string, content: string, createdAt: Date) {
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  await db.insert(comments).values({ id, momentId, authorId, content, createdAt });
  return id;
}

describe('buildRecapInput（spec §4）', () => {
  it('取 wall_date 落 period 内的未软删 moments，按 happenedAt 正序', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    // 2026-07 内（UTC，tz=0 → wallDate = 2026-07-01）
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-15T03:00:00Z') });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    // 2026-06（不应入选）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-30T23:00:00Z') });
    // 软删（不应入选）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-20T00:00:00Z'), deletedAt: new Date() });

    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toHaveLength(2);
    expect(input.moments[0].momentId).toBe(m2); // happenedAt 正序
    expect(input.moments[1].momentId).toBe(m1);
    expect(input.period).toBe('2026-07');
    expect(input.chainName).toBe('宝宝成长');
  });

  it('序列化 line：[MM-DD HH:mm] 昵称 + 正文 + payload 摘要（milestone/metric/mood/geo/standard）', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const mMs = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T08:30:00Z'),
      content: '今天会笑了', kind: 'milestone', payload: { catalog_key: 'first-smile', note: '好开心' },
    });
    const mMt = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T08:30:00Z'),
      content: '体检', kind: 'metric', payload: { metric: 'height', value: 62, unit: 'cm' },
    });
    // custom_label 里程碑
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-03T08:30:00Z'),
      content: '叫妈妈了', kind: 'milestone', payload: { custom_label: '第一次叫妈妈' },
    });

    const input = await buildRecapInput(chainId, '2026-07');
    const msLine = input.moments.find((m) => m.momentId === mMs)!.line;
    expect(msLine).toContain('[07-01 08:30]');
    expect(msLine).toContain('【里程碑】第一次微笑');
    const mtLine = input.moments.find((m) => m.momentId === mMt)!.line;
    expect(mtLine).toContain('【记录】height 62cm');
    const customLine = input.moments.find((m) => m.momentId !== mMs && m.momentId !== mMt)!.line;
    expect(customLine).toContain('【里程碑】第一次叫妈妈');
  });

  it('daily 链 mood 摘要 + travel 链 geo 摘要 + standard 无标记', async () => {
    const daily = await createChain(owner.id, '日常', 'daily');
    const mMd = await insertMoment({
      chainId: daily, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '心情不错', payload: { mood: '😄' },
    });
    const travel = await createChain(owner.id, '旅行', 'travel');
    const mG = await insertMoment({
      chainId: travel, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '到北京了', payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } },
    });

    const dailyInput = await buildRecapInput(daily, '2026-07');
    expect(dailyInput.moments[0].line).toContain('【心情】😄');
    const travelInput = await buildRecapInput(travel, '2026-07');
    expect(travelInput.moments.find((m) => m.momentId === mG)!.line).toContain('【位置】北京');
  });

  it('standard moment 无 kind 标记（仅正文）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '普通记录',
    });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments[0].line).not.toContain('【');
    expect(input.moments[0].line).toContain('普通记录');
  });

  it('非零 tzOffset：[MM-DD HH:mm] 显示本地时间（与 wall_date 同一墙钟系，非 UTC）', async () => {
    // 东八区 -480：happenedAt=2026-06-30T23:00:00Z → wall_date=2026-07-01（被选入 7 月），
    // 本地时间 = 2026-07-01 07:00（UTC+8）。formatLine 必须显示 [07-01 07:00] 而非 UTC [06-30 23:00]。
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({
      chainId, authorId: owner.id,
      happenedAt: new Date('2026-06-30T23:00:00Z'), happenedTzOffset: -480, content: '跨月边界',
    });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toHaveLength(1);
    expect(input.moments[0].line).toContain('[07-01 07:00]');
    expect(input.moments[0].line).not.toContain('[06-30'); // 不显示 UTC 日期
  });

  it('精选评论：每 moment ≤2 条、按 createdAt 升序、≤100 字、排除软删', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    await insertComment(m, owner.id, '第一条评论', new Date('2026-07-01T02:00:00Z'));
    await insertComment(m, owner.id, '第二条评论', new Date('2026-07-01T03:00:00Z'));
    await insertComment(m, owner.id, '第三条评论', new Date('2026-07-01T04:00:00Z')); // 超过 2 条，应被截断
    // 软删评论（直接 update deletedAt）
    const fourth = await insertComment(m, owner.id, '已删评论', new Date('2026-07-01T05:00:00Z'));
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, fourth));

    const input = await buildRecapInput(chainId, '2026-07');
    const cm = input.moments.find((x) => x.momentId === m)!;
    expect(cm.comments).toEqual(['第一条评论', '第二条评论']); // 前 2 条 + 升序 + 排除第三与软删
  });

  it('截断护栏：超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    // 造 3 条：1 条有 payload、2 条无 payload（其中 1 条带评论）
    const mPayload = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '有心情', payload: { mood: '😄' },
    });
    const mWithComment = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: '带评论' });
    await insertComment(mWithComment, owner.id, '评论', new Date('2026-07-02T02:00:00Z'));
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-03T01:00:00Z'), content: '无评论' });

    // 临时把 MAX_MOMENTS 设为 2（通过 process.env 覆盖不可行——config 在 import 时已 parse，
    // 故用模块级注入：buildRecapInput 读 config.LLM_RECAP_MAX_MOMENTS，测试改 process.env 后重 import 不现实。
    // 改用：造足够多条让默认 100 不触发，改为直接断言排序顺序——
    // 为稳定测试截断，buildRecapInput 接受可选 opts.maxMoments/maxChars，测试注入小值）
    const input = await buildRecapInput(chainId, '2026-07', { maxMoments: 2 });
    expect(input.truncated.moments).toBe(true);
    expect(input.truncated.count).toBe(2);
    // 有 payload 优先、其次评论数：mPayload 第一，mWithComment 第二
    expect(input.moments[0].momentId).toBe(mPayload);
    expect(input.moments[1].momentId).toBe(mWithComment);
  });

  it('字符截断：总字符超 MAX_CHARS 二次截断，truncated.chars=true', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: 'A'.repeat(1000) });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: 'B'.repeat(1000) });

    const input = await buildRecapInput(chainId, '2026-07', { maxChars: 500 });
    expect(input.truncated.chars).toBe(true);
    expect(input.truncated.count).toBeLessThanOrEqual(2);
    // 总字符应被截断到 maxChars 范围内
    const totalChars = input.moments.reduce((sum, m) => sum + m.line.length + m.comments.join('').length, 0);
    expect(totalChars).toBeLessThanOrEqual(500 + 200); // 允许少量超出的最后一条
  });

  it('baby 链注入 babyAge：按 birthdate 换算 period 末月龄', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    // 直接更新 chains.payload 注入 birthdate（createChain 不带 payload）
    const { chains } = await import('../../../src/db/schema.js');
    await db.update(chains).set({ payload: { birthdate: '2025-05-01', gender: 'girl' } }).where(eq(chains.id, chainId));
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });

    const input = await buildRecapInput(chainId, '2026-07');
    // period 末 = 2026-08-01（下月 1 号）；birthdate 2025-05-01 → 1 岁 3 个月
    expect(input.babyAge).toContain('1 岁');
    expect(input.babyAge).toMatch(/3 个?月/);
  });

  it('mediaRefs v1 恒为空数组', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.mediaRefs).toEqual([]);
  });

  it('无活动的链：moments 为空、truncated.count=0', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toEqual([]);
    expect(input.truncated.count).toBe(0);
    expect(input.truncated.moments).toBe(false);
    expect(input.truncated.chars).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/recap/input.test.ts`
Expected: FAIL，`Cannot find module '../../../src/llm/recap/input.js'`。

- [ ] **Step 3: 实现 input.ts**

Create `apps/server/src/llm/recap/input.ts`：
```ts
import { and, asc, eq, inArray, isNull, like, type SQL } from 'drizzle-orm';
import { Container } from 'typedi';
import type { Period } from '@moment/dto';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { chainMembers, chains, comments, moments, users } from '../../db/schema.js';
import { TemplateService } from '../../templates/template.service.js';

/**
 * 单条 moment 序列化结果（spec §4.2）。
 * line = `[MM-DD HH:mm] {作者昵称}` + 正文 + kind 标记 + payload 摘要（单行）。
 */
export interface SerializedMoment {
  line: string;
  momentId: string;
  /** 精选评论：每条 ≤100 字、≤2 条（按 createdAt 升序，未软删） */
  comments: string[];
}

/**
 * LLM 输入（spec §4）。
 * mediaRefs v1 恒为 []（视觉预留，接口不变——spec §3 写 media_id: number，但 media.id 是 char36，故 string，同 highlights 偏差）。
 */
export interface RecapInput {
  moments: SerializedMoment[];
  period: Period;
  chainName: string;
  /** baby 模板注入：宝宝 birthdate 换算的 period 末月龄（如「本期末 1 岁 3 个月」） */
  babyAge?: string;
  mediaRefs: { media_id: string; kind: 'image' }[];
  truncated: { moments: boolean; chars: boolean; count: number };
}

/** 载入链信息 + 模板 manifest（milestoneCatalog 用于 milestone 摘要 label 解析） */
async function loadChainMeta(chainId: string): Promise<{
  chainName: string;
  chainPayload: Record<string, unknown> | null;
  templateKey: string;
  milestoneCatalog: Map<string, { label: string; icon: string | null }>;
}> {
  const [chain] = await db
    .select({ name: chains.name, payload: chains.payload, template: chains.template })
    .from(chains)
    .where(eq(chains.id, chainId))
    .limit(1);
  if (!chain) throw new Error(`chain not found: ${chainId}`);
  const manifest = (await Container.get(TemplateService).getByKey(chain.template)).manifest;
  const catalog = new Map(
    (manifest.milestoneCatalog ?? []).map((c) => [c.key, { label: c.label, icon: c.icon ?? null }]),
  );
  return {
    chainName: chain.name,
    chainPayload: chain.payload ?? null,
    templateKey: chain.template,
    milestoneCatalog: catalog,
  };
}

/** 取该链 wall_date 落 period 内的未软删 moments（按 happened_at 正序，spec §4.1）。 */
async function loadMomentsInPeriod(chainId: string, period: string) {
  // wall_date = 'YYYY-MM-DD'，period = 'YYYY-MM'，前缀匹配
  return db
    .select({
      id: moments.id,
      authorId: moments.authorId,
      content: moments.content,
      happenedAt: moments.happenedAt,
      /** 提交时时区偏移（分钟），如东八区 = -480（moments.happenedTzOffset，schema moments.ts L26）。
       *  formatLine 用它与 wall_date 同一墙钟系（wall_date = DATE(happened_at − INTERVAL happened_tz_offset MINUTE)，见 moments/wall-date.ts） */
      happenedTzOffset: moments.happenedTzOffset,
      kind: moments.kind,
      payload: moments.payload,
    })
    .from(moments)
    .where(
      and(
        eq(moments.chainId, chainId),
        isNull(moments.deletedAt),
        like(moments.wallDate, `${period}-%`) as SQL,
      ),
    )
    .orderBy(asc(moments.happenedAt), asc(moments.id));
}

/** 取这些 moments 的精选评论（每 moment ≤2 条、≤100 字、未软删、createdAt 升序）。 */
async function loadTopComments(momentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (momentIds.length === 0) return map;
  const rows = await db
    .select({ momentId: comments.momentId, content: comments.content })
    .from(comments)
    .where(and(inArray(comments.momentId, momentIds), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  for (const r of rows) {
    const arr = map.get(r.momentId) ?? [];
    if (arr.length < 2) {
      arr.push(r.content.length > 100 ? `${r.content.slice(0, 100)}…` : r.content);
    }
    map.set(r.momentId, arr);
  }
  return map;
}

/** payload 摘要（spec §4.2，对齐 aggregate.service 的字段读取）。 */
function summarizePayload(
  kind: string,
  payload: Record<string, unknown> | null,
  milestoneCatalog: Map<string, { label: string; icon: string | null }>,
): string {
  if (!payload) return '';
  switch (kind) {
    case 'milestone': {
      const catalogKey = payload.catalog_key as string | undefined;
      const hit = catalogKey ? milestoneCatalog.get(catalogKey) : undefined;
      const label = hit?.label ?? (payload.custom_label as string | undefined) ?? catalogKey ?? '';
      return `【里程碑】${label}`;
    }
    case 'metric': {
      const metric = String(payload.metric ?? '');
      const value = payload.value;
      const unit = String(payload.unit ?? '');
      return `【记录】${metric} ${value}${unit}`;
    }
    case 'standard': {
      // daily 的 mood、travel 的 geo 在 standard payload 内
      const mood = payload.mood;
      if (typeof mood === 'string') return `【心情】${mood}`;
      const geo = payload.geo as { place_name?: string; lat?: number; lng?: number } | undefined;
      if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
        return `【位置】${geo.place_name ?? ''}`;
      }
      return '';
    }
    default:
      return '';
  }
}

/** 作者昵称查询（一次 IN 查询，复用 handler loadSnapshot 思路）。 */
async function loadNicknames(authorIds: string[]): Promise<Map<string, string>> {
  if (authorIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(inArray(users.id, authorIds));
  return new Map(rows.map((r) => [r.id, r.nickname]));
}

/**
 * 序列化单行（spec §4.2）：`[MM-DD HH:mm] {昵称}` + 正文 + payload 摘要。
 *
 * 时间显示按**本地时区**（与 wall_date 同一墙钟系），非 UTC——否则非零 tzOffset 的家庭
 * （如东八区 -480）会看到 wall_date 落 7 月但 `[06-30 ...]` 的 UTC 时间，日期与归属月不一致。
 *
 * 墙钟偏移与 wall_date 同公式（moments/wall-date.ts）：
 *   wall_date = DATE(happened_at − INTERVAL happened_tz_offset MINUTE)
 *   localMs   = happenedAt.getTime() − happenedTzOffset * 60_000
 * （happenedTzOffset 语义同 JS getTimezoneOffset：东八区 = -480，减去 -480 = +480min 即东移到本地）
 * 偏移后用 UTC 历法读法取 MM/DD/HH/mm，得到的就是本地墙钟时间，日期与 wall_date 一致。
 */
function formatLine(
  happenedAt: Date,
  happenedTzOffset: number,
  nickname: string,
  content: string,
  payloadSummary: string,
): string {
  const localMs = happenedAt.getTime() - happenedTzOffset * 60_000;
  const local = new Date(localMs);
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const min = String(local.getUTCMinutes()).padStart(2, '0');
  const summary = payloadSummary ? ` ${payloadSummary}` : '';
  return `[${mm}-${dd} ${hh}:${min}] ${nickname}${summary} ${content}`.trim();
}

/** baby 模板：birthdate 换算 period 末月龄（spec §4 末）。 */
function computeBabyAge(birthdate: string, period: string): string {
  // period = 'YYYY-MM'，period 末 = 下月 1 号
  const [y, m] = period.split('-').map(Number);
  const periodEnd = new Date(Date.UTC(y, m, 1)); // 下月 1 号（m 已是 1-12，Date.UTC month 0-based 故直接用）
  const birth = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return '';
  let years = periodEnd.getUTCFullYear() - birth.getUTCFullYear();
  let months = periodEnd.getUTCMonth() - birth.getUTCMonth();
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years <= 0 && months <= 0) return '';
  const yPart = years > 0 ? `${years} 岁 ` : '';
  return `${yPart}${months} 个月`;
}

/**
 * 组装 recap 输入（spec §4）。
 * @param opts.maxMoments / maxChars 测试注入点（默认读 config）；生产路径由 generateRecap 调用不传。
 */
export async function buildRecapInput(
  chainId: string,
  period: Period,
  opts: { maxMoments?: number; maxChars?: number } = {},
): Promise<RecapInput> {
  const maxMoments = opts.maxMoments ?? config.LLM_RECAP_MAX_MOMENTS;
  const maxChars = opts.maxChars ?? config.LLM_RECAP_MAX_CHARS;

  const meta = await loadChainMeta(chainId);
  const rows = await loadMomentsInPeriod(chainId, period);
  const momentIds = rows.map((r) => r.id);
  const commentMap = await loadTopComments(momentIds);
  const nicknameMap = await loadNicknames(rows.map((r) => r.authorId));

  // 序列化每条 moment（含 payload 摘要 + 评论）
  const serialized: Array<SerializedMoment & { hasPayload: boolean; commentCount: number; happenedAt: Date }> =
    rows.map((r) => {
      const payloadSummary = summarizePayload(r.kind, r.payload, meta.milestoneCatalog);
      const nickname = nicknameMap.get(r.authorId) ?? '';
      const cms = commentMap.get(r.id) ?? [];
      return {
        line: formatLine(r.happenedAt, r.happenedTzOffset, nickname, r.content, payloadSummary),
        momentId: r.id,
        comments: cms,
        hasPayload: payloadSummary !== '',
        commentCount: cms.length,
        happenedAt: r.happenedAt,
      };
    });

  // 截断护栏 1：超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取（spec §4.4）
  let truncatedMoments = false;
  let kept = serialized;
  if (serialized.length > maxMoments) {
    truncatedMoments = true;
    kept = [...serialized]
      .sort((a, b) => {
        // hasPayload 降序、commentCount 降序、happenedAt 正序（稳定）
        if (a.hasPayload !== b.hasPayload) return a.hasPayload ? -1 : 1;
        if (a.commentCount !== b.commentCount) return b.commentCount - a.commentCount;
        return a.happenedAt.getTime() - b.happenedAt.getTime();
      })
      .slice(0, maxMoments);
  }

  // 截断护栏 2：总字符超 MAX_CHARS 二次截断（spec §4.4）
  let truncatedChars = false;
  const totalChars = kept.reduce((sum, m) => sum + m.line.length + m.comments.join('').length, 0);
  if (totalChars > maxChars) {
    truncatedChars = true;
    let acc = 0;
    const trimmed: typeof kept = [];
    for (const m of kept) {
      const size = m.line.length + m.comments.join('').length;
      if (acc + size > maxChars && trimmed.length > 0) break;
      trimmed.push(m);
      acc += size;
    }
    kept = trimmed;
  }

  // baby 模板注入月龄
  let babyAge: string | undefined;
  if (meta.templateKey === 'baby' && meta.chainPayload) {
    const birthdate = meta.chainPayload.birthdate as string | undefined;
    if (birthdate) babyAge = computeBabyAge(birthdate, period);
  }

  return {
    moments: kept.map(({ line, momentId, comments }) => ({ line, momentId, comments })),
    period,
    chainName: meta.chainName,
    babyAge,
    mediaRefs: [], // v1 恒为空（视觉预留，spec §3）
    truncated: { moments: truncatedMoments, chars: truncatedChars, count: kept.length },
  };
}
```

> 注：`opts.maxMoments` / `opts.maxChars` 是测试注入点（让截断护栏可稳定测试），生产路径 `generateRecap`（Task 3）调用时不传，回落 config。这是对 spec §4 截断护栏的可测试性扩展，不改变 spec 语义。

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/llm/recap/input.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，10 个测试全过；typecheck exit 0。

- [ ] **Step 5: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有 + 新增 10 个测试全绿。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/recap/input.ts apps/server/tests/llm/recap/input.test.ts
git commit -m "feat(server): add recap input assembly with truncation guard"
```

---

### Task 3: PROMPT_VERSION + buildSystemPrompt + buildUserPrompt

**Files:**
- Create: `apps/server/src/llm/recap/prompt.ts`
- Test: `apps/server/tests/llm/recap/prompt.test.ts`

**Interfaces:**
- Consumes: `RecapInput` / `SerializedMoment`（Task 2）。
- Produces（后续 Task 引用，名锁定）:
  - `export const PROMPT_VERSION = 1`
  - `buildSystemPrompt(): string`（要求返回 JSON `{content: markdown, highlight_moment_ids: string[]}`，spec §4.5）
  - `buildUserPrompt(input: RecapInput): string`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/recap/prompt.test.ts`（纯单测，不触库）：
```ts
import {
  PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from '../../../src/llm/recap/prompt.js';
import type { RecapInput } from '../../../src/llm/recap/input.js';

describe('PROMPT_VERSION', () => {
  it('锁定为 1', () => {
    expect(PROMPT_VERSION).toBe(1);
  });
});

describe('buildSystemPrompt（spec §4.5）', () => {
  it('要求返回 JSON {content: markdown, highlight_moment_ids: string[]}', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('JSON');
    expect(sys).toContain('content');
    expect(sys).toContain('highlight_moment_ids');
    expect(sys).toContain('string[]'); // 强调 id 是字符串（UUID）
  });
});

describe('buildUserPrompt', () => {
  it('含链名、period、月龄、moments 序列化行、评论、截断声明', () => {
    const input: RecapInput = {
      moments: [
        {
          line: '[07-01 08:30] 妈妈 【里程碑】第一次微笑 宝宝今天会笑了',
          momentId: 'm-uuid-1',
          comments: ['好可爱', '记录下来'],
        },
      ],
      period: '2026-07',
      chainName: '宝宝成长',
      babyAge: '1 岁 3 个月',
      mediaRefs: [],
      truncated: { moments: false, chars: false, count: 1 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('宝宝成长');
    expect(user).toContain('2026-07');
    expect(user).toContain('1 岁 3 个月');
    expect(user).toContain('[07-01 08:30] 妈妈 【里程碑】第一次微笑 宝宝今天会笑了');
    expect(user).toContain('好可爱');
    expect(user).toContain('m-uuid-1'); // momentId 进 prompt（供 highlight_moment_ids 引用）
  });

  it('截断发生时声明条数', () => {
    const input: RecapInput = {
      moments: [],
      period: '2026-07',
      chainName: '链',
      mediaRefs: [],
      truncated: { moments: true, chars: false, count: 5 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('5');
    expect(user.toLowerCase()).toMatch(/truncat|截断|条/);
  });

  it('无活动链：声明 0 条', () => {
    const input: RecapInput = {
      moments: [],
      period: '2026-07',
      chainName: '空链',
      mediaRefs: [],
      truncated: { moments: false, chars: false, count: 0 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('0');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/recap/prompt.test.ts`
Expected: FAIL，`Cannot find module '../../../src/llm/recap/prompt.js'`。

- [ ] **Step 3: 实现 prompt.ts**

Create `apps/server/src/llm/recap/prompt.ts`：
```ts
import type { RecapInput } from './input.js';

/** prompt 模板版本（重生成对比用，spec §2 prompt_version）。 */
export const PROMPT_VERSION = 1;

/**
 * System prompt（spec §4.5）：要求 LLM 返回严格 JSON。
 * ```json
 * { "content": "<markdown 正文>", "highlight_moment_ids": ["<moment uuid>", ...] }
 * ```
 * highlight_moment_ids 类型为 string[]（moments.id 是 char36 UUID，非 number[]——spec §4 笔误修正）。
 */
export function buildSystemPrompt(): string {
  return `你是一个家庭时光链的月度回顾撰写助手。根据提供的时刻记录与评论，撰写一份温暖、有情感的 Markdown 月度回顾。

输出要求：
1. 仅返回一个 JSON 对象，不要包含任何解释文字、markdown 代码块包裹或注释。
2. JSON 结构：
   {
     "content": "<string: Markdown 正文，含标题与小节>",
     "highlight_moment_ids": ["<string: 引用的高光 moment 的 id>", ...]
   }
3. content 用 Markdown 写作，结构清晰（标题、段落、列表），体现本月的情感脉络与成长。
4. highlight_moment_ids 必须从输入的 moment 列表中选择（每个 id 是 char(36) UUID 字符串，不是数字），选出最值得作为「高光时刻」的 1-5 条。
5. 不要编造输入中不存在的 moment id。
6. 不要在 content 中泄露任何 PII（邮箱等），只使用提供的昵称。
7. 回顾语气贴近中国家庭，温暖、具体、不空洞。`;
}

/**
 * User prompt（spec §4）：把 RecapInput 序列化为 LLM 可读文本。
 * 每条 moment 含 line（[MM-DD HH:mm] 昵称 + 正文 + payload 摘要）+ 评论 + momentId。
 */
export function buildUserPrompt(input: RecapInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.chainName} 的 ${input.period} 月度回顾`);
  if (input.babyAge) {
    lines.push(`宝宝月龄：本期末 ${input.babyAge}`);
  }
  lines.push('');
  lines.push(`本月共记录 ${input.truncated.count} 条时刻${input.truncated.moments || input.truncated.chars ? '（已截断，仅展示部分）' : ''}。`);
  lines.push('');

  if (input.moments.length === 0) {
    lines.push('本月无记录。请基于此生成一段简短回顾，说明本月暂无记录。');
    return lines.join('\n');
  }

  lines.push('## 时刻列表');
  for (const m of input.moments) {
    lines.push(`- [momentId: ${m.momentId}] ${m.line}`);
    if (m.comments.length > 0) {
      for (const c of m.comments) {
        lines.push(`  - 评论：${c}`);
      }
    }
  }
  lines.push('');
  lines.push('请基于以上时刻撰写月度回顾，并选出 1-5 条高光 moment 的 id 填入 highlight_moment_ids。');
  return lines.join('\n');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/llm/recap/prompt.test.ts`
Expected: PASS，5 个测试全过。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/recap/prompt.ts apps/server/tests/llm/recap/prompt.test.ts
git commit -m "feat(server): add recap prompt templates"
```

---

### Task 4: generateRecap + buildDegradedContent + 预算降级 + 解析重试 + 幻觉过滤 + upsert

**Files:**
- Create: `apps/server/src/llm/recap/generate.ts`
- Test: `apps/server/tests/llm/recap/generate.test.ts`

**Interfaces:**
- Consumes: T2 `LLMProvider` / `getLLMProvider` / `setLLMProvider` / `LLMChatResponse` / `RetryableLLMError` / `NonRetryableLLMError`；T1 `Period` / `RecapTokenUsage`；Task 2 `buildRecapInput` / `RecapInput`；Task 3 `PROMPT_VERSION` / `buildSystemPrompt` / `buildUserPrompt`；`recaps` schema（Task 1）；`config.LLM_MONTHLY_TOKEN_BUDGET`（T2）。
- Produces（后续 Task 引用，名锁定）:
  - `generateRecap(chainId: string, period: Period, opts?: { provider?: LLMProvider | null; budgetOverride?: number }): Promise<void>`（spec §5）
    - 查**当前运行月**全局 token 消耗超 `LLM_MONTHLY_TOKEN_BUDGET`（>0 时）→ 降级路径（spec §5「当月」= 当前运行月，非 period 月：sweep 在 8 月生成 7 月回顾时查 8 月已消耗的 token）
    - provider 为 null → 降级路径
    - 否则 build input → provider.chat（`NonRetryableLLMError` 在此落 failed 行后正常返回；`RetryableLLMError` 传播给 handler 走 processor 退避）→ 解析 JSON（失败重试一次）→ 过滤幻觉 id → upsert recaps 行
    - `opts.budgetOverride` 是测试注入点（config 在 import 时 parse，无法 env 覆盖；与 `opts.provider` 同范式），生产路径不传回落 `config.LLM_MONTHLY_TOKEN_BUDGET`
  - `buildDegradedContent(input: RecapInput): { content: string; highlights: string[] }`（预算降级规则文案，spec §5）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/recap/generate.test.ts`（触库，`afterAll(closeDb)`，mock provider 注入 `setLLMProvider` + `afterEach(setLLMProvider(undefined))` 清理）：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { recaps } from '../../../src/db/schema.js';
import { setLLMProvider } from '../../../src/llm/factory.js';
import { NonRetryableLLMError } from '../../../src/llm/base.provider.js';
import type { LLMProvider } from '../../../src/llm/base.provider.js';
import { generateRecap } from '../../../src/llm/recap/generate.js';
import { createUser, type TestUser } from '../../helpers/auth.js';
import { closeDb, resetDb } from '../../helpers/db.js';
import { app, createChain, insertMoment } from '../../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterEach(() => setLLMProvider(undefined)); // 重置回真实 config（p2 三态）
afterAll(closeDb);

/** mock provider 工厂：chat 返回指定 content + highlight_moment_ids + usage */
function mockProvider(content: string, highlightIds: string[], usage = { prompt: 100, completion: 50, total: 150 }): LLMProvider & { calls: number } {
  let calls = 0;
  return {
    calls: 0,
    async chat() {
      calls++;
      (this as any).calls = calls;
      return {
        content: JSON.stringify({ content, highlight_moment_ids: highlightIds }),
        model: 'mock-model',
        usage,
      };
    },
  } as any;
}

describe('generateRecap 成功路径（spec §5）', () => {
  it('provider 返回合法 JSON → upsert recaps 行 status=ready + 透传 usage', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: '记录二' });
    const provider = mockProvider('## 7月回顾\n本月记录了...', [m1, m2]);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('ready');
    expect(row.content).toBe('## 7月回顾\n本月记录了...');
    expect(row.highlights).toEqual([m1, m2]);
    expect(row.model).toBe('mock-model');
    expect(row.promptVersion).toBe(1);
    expect(row.tokenUsage).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(row.error).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });

  it('幻觉 id 过滤：highlight_moment_ids 含不属于该链该月的 id → 过滤掉', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const fakeId = 'nonexistent-uuid-0000';
    const provider = mockProvider('回顾', [m1, fakeId, 'another-fake-uuid']);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.highlights).toEqual([m1]); // 只保留真实存在的 m1
  });

  it('解析失败重试一次：第一次返回非法 JSON、第二次合法 → status=ready', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    let call = 0;
    const provider: LLMProvider = {
      async chat() {
        call++;
        if (call === 1) return { content: 'not json {', model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
        return { content: JSON.stringify({ content: '重试成功', highlight_moment_ids: [m1] }), model: 'm', usage: { prompt: 2, completion: 2, total: 4 } };
      },
    };
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('ready');
    expect(row.content).toBe('重试成功');
    expect(call).toBe(2);
  });

  it('解析两次都失败 → status=failed + error 摘要', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const provider: LLMProvider = {
      async chat() {
        return { content: 'still not json', model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
      },
    };
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('failed');
    expect(row.error).toContain('parse');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });
});

describe('generateRecap 预算降级（spec §5）', () => {
  it('provider=null → 降级路径：status=degraded、不调 provider、tokenUsage=null、model=null', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    setLLMProvider(null);

    await generateRecap(chainId, '2026-07');

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.content).toContain('本月记录');
    expect(row.content).toContain('非 AI 生成');
    expect(row.generatedAt).toBeInstanceOf(Date);
  });

  it('buildDegradedContent：规则文案「本月记录 N 条」+ 里程碑列表 + 标注非 AI 生成', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const m1 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '会笑了', kind: 'milestone', payload: { catalog_key: 'first-smile' },
    });
    setLLMProvider(null);

    await generateRecap(chainId, '2026-07');

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect(row.content).toContain('本月记录 1 条');
    expect(row.content).toContain('第一次微笑'); // 里程碑 label
    expect(row.content).toContain('非 AI 生成');
    expect(row.highlights).toEqual([m1]); // 降级也填 highlights（结构化记录的 id）
  });

  it('超月度预算 → 降级路径（budgetOverride 注入 + 当月已耗超 budget）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    // 先插一条已 ready 的 recap 模拟当前月已消耗超 budget。
    // monthlyTokenUsage 按「当前运行月」开窗（spec §5「当月」= 当前运行月，非 period 月），
    // 故 generatedAt 用 new Date()（当前月），使其落在 monthlyTokenUsage 的当月窗口内。
    const otherChain = await createChain(owner.id, '其他链', 'daily');
    const now = new Date();
    const { randomUUID } = await import('node:crypto');
    await db.insert(recaps).values({
      id: randomUUID(), chainId: otherChain, period: '2026-07', status: 'ready',
      content: 'x', highlights: [], model: 'm', promptVersion: 1,
      tokenUsage: { prompt: 999999, completion: 999999, total: 999999 }, // 远超 budget
      generatedAt: now, createdAt: now, updatedAt: now,
    });
    const provider = mockProvider('不应被调用', []);
    setLLMProvider(provider);
    // budgetOverride=1：config.LLM_MONTHLY_TOKEN_BUDGET 默认 0=不限（import 时 parse 无法 env 覆盖），
    // 故用 opts.budgetOverride 测试注入点强制 budget=1，使预插 recap 的 999999 token 超限走降级。
    await generateRecap(chainId, '2026-07', { provider, budgetOverride: 1 });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect((provider as any).calls).toBe(0); // 未调 provider
  });

  it('NonRetryableLLMError → generateRecap 自己落 failed 行 + 不 rethrow（不扇出，p3 只查 recaps 行）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const provider: LLMProvider = {
      async chat() {
        throw new NonRetryableLLMError('LLM 400: bad request', 400);
      },
    };
    setLLMProvider(provider);

    // generateRecap 内部 catch NonRetryableLLMError → 落 failed 行 + 正常返回（不 rethrow）
    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('failed');
    expect(row.error).toContain('400');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });
});

describe('generateRecap 重生成 upsert（spec §2）', () => {
  it('已存在 recap 行 → 覆盖 content/highlights/status/model/tokenUsage，保留 created_at', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    // 先插一条 generating 行
    const oldCreated = new Date(Date.now() - 60_000);
    const { randomUUID } = await import('node:crypto');
    await db.insert(recaps).values({
      id: randomUUID(), chainId, period: '2026-07', status: 'generating',
      content: '', highlights: [], promptVersion: 1, createdAt: oldCreated, updatedAt: oldCreated,
    });
    const provider = mockProvider('重新生成的内容', [m1]);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(1); // upsert 不新增
    expect(rows[0].status).toBe('ready');
    expect(rows[0].content).toBe('重新生成的内容');
    expect(rows[0].createdAt.getTime()).toBe(oldCreated.getTime()); // 保留 created_at
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/recap/generate.test.ts`
Expected: FAIL，`Cannot find module '../../../src/llm/recap/generate.js'`。

- [ ] **Step 3: 实现 generate.ts**

Create `apps/server/src/llm/recap/generate.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Period } from '@moment/dto';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { recaps } from '../../db/schema.js';
import { getLLMProvider } from '../factory.js';
import { NonRetryableLLMError, type LLMProvider } from '../base.provider.js';
import { buildRecapInput, type RecapInput } from './input.js';
import { PROMPT_VERSION, buildSystemPrompt, buildUserPrompt } from './prompt.js';

/** 解析 LLM 返回的 JSON（容错：去除可能的 markdown 代码块包裹）。 */
interface ParsedRecap {
  content: string;
  highlight_moment_ids: string[];
}

function parseRecapJson(raw: string): ParsedRecap | null {
  let text = raw.trim();
  // 容错：去除 ```json ... ``` 包裹
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.content !== 'string') return null;
    const ids = o.highlight_moment_ids;
    if (!Array.isArray(ids)) return null;
    // 全部成员必须是 string（防 number 混入）
    const strIds = ids.filter((x): x is string => typeof x === 'string');
    return { content: o.content, highlight_moment_ids: strIds };
  } catch {
    return null;
  }
}

/**
 * 预算降级规则文案（spec §5）。
 * 用结构化数据直出：「本月记录 N 条，里程碑：……」+ 标注非 AI 生成。
 * highlights 填结构化记录（milestone/metric）的 moment id，供客户端渲染高光跳转。
 */
export function buildDegradedContent(input: RecapInput): { content: string; highlights: string[] } {
  const lines: string[] = [];
  lines.push(`# ${input.chainName} ${input.period} 月度回顾`);
  lines.push('');
  lines.push(`本月记录 ${input.truncated.count} 条时刻。`);
  if (input.babyAge) {
    lines.push(`宝宝月龄：本期末 ${input.babyAge}。`);
  }
  lines.push('');

  // 提取里程碑（line 含【里程碑】）
  const milestones = input.moments.filter((m) => m.line.includes('【里程碑】'));
  if (milestones.length > 0) {
    lines.push('## 里程碑');
    for (const m of milestones) {
      // line 格式 [MM-DD HH:mm] 昵称 【里程碑】{label} 正文
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  // 提取记录（metric）
  const metrics = input.moments.filter((m) => m.line.includes('【记录】'));
  if (metrics.length > 0) {
    lines.push('## 成长记录');
    for (const m of metrics) {
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  // 普通时刻摘要
  const standards = input.moments.filter((m) => !m.line.includes('【'));
  if (standards.length > 0) {
    lines.push('## 时刻');
    for (const m of standards) {
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  lines.push('> 本文为规则模板生成，非 AI 生成（预算降级）。');

  // highlights = 里程碑 + metric 的 moment id（结构化记录优先）
  const highlights = input.moments
    .filter((m) => m.line.includes('【里程碑】') || m.line.includes('【记录】'))
    .map((m) => m.momentId);

  return { content: lines.join('\n'), highlights };
}

/**
 * 查**当前运行月**全局 token 消耗（SUM token_usage.total 按 generated_at 当月聚合，spec §5「当月」）。
 *
 * spec §5「当月全局 token 消耗…按 generated_at 月聚合」= 当前运行月，**非 period 月**：
 * sweep 在 8 月生成 7 月回顾时，应查 8 月（当前月）已消耗的 token，不是 7 月（period 月）。
 * 用 new Date() 取当前月开窗（UTC 月边界），不取 period。
 *
 * drizzle 对 json 列无原生 JSON_EXTRACT，取出应用层求和（recaps 行数有限，可接受）。
 */
async function monthlyTokenUsage(): Promise<number> {
  // 当前运行月开窗（spec §5「当月」）
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await db
    .select({ tokenUsage: recaps.tokenUsage })
    .from(recaps)
    .where(
      and(
        eq(recaps.status, 'ready'),
        isNotNull(recaps.generatedAt),
        sql`${recaps.generatedAt} >= ${start}`,
        sql`${recaps.generatedAt} < ${end}`,
      ),
    );
  return rows.reduce((sum, r) => sum + (r.tokenUsage?.total ?? 0), 0);
}

/** upsert recaps 行（ON DUPLICATE KEY UPDATE，spec §2）。保留 created_at。 */
async function upsertRecap(row: {
  chainId: string;
  period: string;
  status: 'ready' | 'failed' | 'degraded';
  content: string;
  highlights: string[];
  model: string | null;
  promptVersion: number;
  tokenUsage: { prompt: number; completion: number; total: number } | null;
  error: string | null;
  generatedAt: Date;
}): Promise<void> {
  const now = new Date();
  // 先查是否存在（保留 created_at）
  const [existing] = await db
    .select({ id: recaps.id, createdAt: recaps.createdAt })
    .from(recaps)
    .where(and(eq(recaps.chainId, row.chainId), eq(recaps.period, row.period)))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.createdAt ?? now;

  await db
    .insert(recaps)
    .values({
      id,
      chainId: row.chainId,
      period: row.period,
      status: row.status,
      content: row.content,
      highlights: row.highlights,
      model: row.model,
      promptVersion: row.promptVersion,
      tokenUsage: row.tokenUsage,
      error: row.error,
      generatedAt: row.generatedAt,
      createdAt,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: row.status,
        content: row.content,
        highlights: row.highlights,
        model: row.model,
        promptVersion: row.promptVersion,
        tokenUsage: row.tokenUsage,
        error: row.error,
        generatedAt: row.generatedAt,
        updatedAt: now,
      },
    });
}

/**
 * 生成 recap（spec §5）。
 *
 * 流程：
 * 1. provider 为 null（空 key 停用）→ 降级路径（status=degraded，不调 provider，token_usage=null，model=null）。
 * 2. 查当前运行月全局 token 消耗超 budget（>0 时）→ 降级路径（spec §5「当月」= 当前运行月，非 period 月）。
 * 3. 否则 build input → provider.chat → 解析 JSON（失败重试一次，再失败 status=failed 落 error 摘要）。
 * 4. provider.chat 抛 NonRetryableLLMError → 落 failed 行后正常返回（不 rethrow；与 parse 失败同范式，
 *    generateRecap 拥有所有 recaps 行写入）。RetryableLLMError 传播给 handler 走 processor 退避。
 * 5. highlight_moment_ids 过滤掉不属于该链该月的 id（幻觉防线，spec §4.5）。
 * 6. upsert recaps 行（status=ready，落 content/highlights/model/promptVersion/tokenUsage/generatedAt）。
 *
 * @param opts.provider 测试注入点（默认 getLLMProvider()）。传 null 强制降级路径。
 * @param opts.budgetOverride 测试注入点（默认 config.LLM_MONTHLY_TOKEN_BUDGET）。config 在 import 时 parse 无法 env 覆盖，故提供注入点。
 */
export async function generateRecap(
  chainId: string,
  period: Period,
  opts: { provider?: LLMProvider | null; budgetOverride?: number } = {},
): Promise<void> {
  const input = await buildRecapInput(chainId, period);
  const provider = opts.provider !== undefined ? opts.provider : getLLMProvider();

  // 降级路径 1：provider 为 null（空 key 停用，spec §3/§8）
  if (provider === null) {
    const { content, highlights } = buildDegradedContent(input);
    await upsertRecap({
      chainId, period, status: 'degraded', content, highlights,
      model: null, promptVersion: PROMPT_VERSION, tokenUsage: null, error: null,
      generatedAt: new Date(),
    });
    return;
  }

  // 降级路径 2：超月度预算（spec §5）。budgetOverride 是测试注入点（config 在 import 时 parse
  // 无法 env 覆盖，与 opts.provider 同范式），生产路径不传回落 config.LLM_MONTHLY_TOKEN_BUDGET。
  const budget = opts.budgetOverride ?? config.LLM_MONTHLY_TOKEN_BUDGET;
  if (budget > 0) {
    // monthlyTokenUsage 按「当前运行月」开窗（spec §5「当月」= 当前运行月，非 period 月）
    const used = await monthlyTokenUsage();
    if (used >= budget) {
      const { content, highlights } = buildDegradedContent(input);
      await upsertRecap({
        chainId, period, status: 'degraded', content, highlights,
        model: null, promptVersion: PROMPT_VERSION, tokenUsage: null, error: null,
        generatedAt: new Date(),
      });
      return;
    }
  }

  // 正常路径：调 provider（解析失败重试一次，spec §4.5）
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const validMomentIds = new Set(input.moments.map((m) => m.momentId));

  let parsed: ParsedRecap | null = null;
  let usage: { prompt: number; completion: number; total: number } | null = null;
  let model: string | null = null;
  let lastError = '';
  try {
    // generateRecap 拥有所有 recaps 行写入（与 parse 失败同范式）：
    // NonRetryableLLMError（4xx 其他）在此落 failed 行后正常返回，不 rethrow（让 handler 视为
    // 正常完成，避免占 processor 5 次退避额度——见 p4 handler）。
    // RetryableLLMError 不在此 catch——让它传播给 handler → processor 退避。
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      const resp = await provider.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      const p = parseRecapJson(resp.content);
      if (p !== null) {
        parsed = p;
        usage = resp.usage; // 透传 LLM usage（T3 末尾 S5 注：shape 与 RecapTokenUsage 一致，不重发明字段名）
        model = resp.model;
      } else {
        lastError = `LLM response parse failed (attempt ${attempt + 1})`;
      }
    }
  } catch (err) {
    if (err instanceof NonRetryableLLMError) {
      // 不可重试：落 failed 行 + 正常返回（不 rethrow），与 parse 失败同范式
      await upsertRecap({
        chainId, period, status: 'failed', content: '',
        highlights: [], model: null, promptVersion: PROMPT_VERSION,
        tokenUsage: null, error: `LLM ${err.statusCode}: ${err.message}`, generatedAt: new Date(),
      });
      return;
    }
    // RetryableLLMError 或其他可重试错误：传播给 handler → processor 退避
    throw err;
  }

  if (parsed === null) {
    await upsertRecap({
      chainId, period, status: 'failed', content: '',
      highlights: [], model: null, promptVersion: PROMPT_VERSION,
      tokenUsage: null, error: lastError, generatedAt: new Date(),
    });
    return;
  }

  // 幻觉防线：过滤掉不属于该链该月的 id（spec §4.5）
  const highlights = parsed.highlight_moment_ids.filter((id) => validMomentIds.has(id));
  await upsertRecap({
    chainId, period, status: 'ready', content: parsed.content,
    highlights, model, promptVersion: PROMPT_VERSION,
    tokenUsage: usage, error: null, generatedAt: new Date(),
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/llm/recap/generate.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，9 个测试全过（成功路径 4 + 降级/NonRetryable 4 + upsert 1，幻觉过滤在成功路径内）；typecheck exit 0。

- [ ] **Step 5: 全量回归 + lint**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server lint
```
Expected: 全绿——既有 + 本计划新增（Task 1 的 3 + Task 2 的 10 + Task 3 的 5 + Task 4 的 9 = 27）；lint exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/recap/generate.ts apps/server/tests/llm/recap/generate.test.ts
git commit -m "feat(server): add recap generation pipeline with budget guard"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿（既有 + 本计划新增 27 个：Task 1 三、Task 2 十、Task 3 五、Task 4 九——新增数以各 Task Step 内 it/test 块为准，若有出入以实际为准并在完工报告说明）
- [ ] `pnpm --filter @moment/server typecheck` exit 0
- [ ] `pnpm --filter @moment/server lint` exit 0
- [ ] `drizzle/0011_*.sql` 为 `CREATE TABLE recaps` + `UNIQUE(chain_id, period)` + `FK ON DELETE CASCADE`，`pnpm --filter @moment/server migrate` exit 0
- [ ] `resetDb()` 扩展 recaps（在 chains 之前删——FK 逆序）后既有测试不回归
- [ ] spec §2（recaps 表全列 + UNIQUE + CASCADE）、§4（输入组装：wall_date 归属月 / payload 摘要各 kind / 精选评论 / 截断护栏 / baby 月龄）、§5（预算降级 / 解析重试 / 幻觉过滤 / upsert）逐一落实
- [ ] 执行 prompt T3 的 Produces 符号逐个可解析：`recaps` 表 / `RecapInput` / `SerializedMoment` / `buildRecapInput` / `PROMPT_VERSION` / `buildSystemPrompt` / `buildUserPrompt` / `generateRecap` / `buildDegradedContent`
- [ ] S5 注落实：`generateRecap` 透传 `LLMChatResponse.usage` 到 `recaps.token_usage`，字段名 `{prompt, completion, total}` 一致，不重发明
- [ ] spec 偏差已注明：`highlights`/`highlight_moment_ids` 为 `string[]`（moments.id char36）；`mediaRefs[].media_id` 为 `string`；`mediaRefs` v1 恒为 `[]`
