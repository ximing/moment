# AI 月度回顾 P1：dto Recap 域 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/dto` 落地 Recap 域的全部共享契约：`RECAP_STATUSES` 状态词表与 zod schema、`periodSchema`（`YYYY-MM` 校验）、`RecapDto` 接口、`RecapListResponse` 与 `PublicShareRecap`。

**Architecture:** dto 包只放 schema 与纯类型推导（`packages/dto/CLAUDE.md` 硬约束）。recaps 表列结构与 LLM provider 抽象属 server 侧（P2/P3），dto 仅定义跨端请求/响应契约。单文件布局：dto 的 test glob 只匹配 `src/*.test.ts`。

**Tech Stack:** zod ^3.22（勿用 v4 API）/ tsx --test（node:test）。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§2 recaps 表列、§6 API、§8 隐私）

## Global Constraints

- 执行 prompt T1 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`；下列符号名逐字不得改：`RECAP_STATUSES` / `RecapStatus` / `recapStatusSchema` / `periodSchema` / `Period` / `RecapDto` / `RecapListResponse` / `PublicShareRecap`。
- dto 包规则（`packages/dto/CLAUDE.md`）：每个业务域一个文件、只放 schema 与纯类型、不放运行时业务逻辑；测试与源文件同目录，`pnpm --filter @moment/dto test` 的 glob 是 `src/*.test.ts`（只匹配顶层）——故本计划为**单文件** `src/recaps.ts` + `src/recaps.test.ts`。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **highlights 类型 `string[]` 而非 `number[]`**：spec §2 写 `highlights json，引用的 moment id 有序列表`，spec §4 写 `highlight_moment_ids: number[]`。但 `moments.id` 是 `char(36)` UUID（`apps/server/src/db/schema/moments.ts`），故 `highlights` 类型为 `string[]`。这是 spec 笔误的机械修正，非设计发明。
2. **`PublicShareRecap` 复用 `RecapDto`**：spec §6 分享页「附最近一期 ready 回顾」，字段集与 `RecapDto` 一致（content/highlights/model/period 全需要），故 `PublicShareRecap = RecapDto`，不另造精简快照类型。

---

### Task 1: Recap 状态词表 + period 校验 + RecapDto + 响应类型 + barrel 导出

**Files:**
- Create: `packages/dto/src/recaps.ts`
- Test: `packages/dto/src/recaps.test.ts`
- Modify: `packages/dto/src/index.ts`（barrel 加一行）

**Interfaces:**
- Consumes: 无（首批 recap 域代码）。
- Produces:
  - `RECAP_STATUSES`（`['generating','ready','failed','degraded'] as const`）
  - `type RecapStatus`
  - `recapStatusSchema`
  - `periodSchema`（zod：`/^\d{4}-(0[1-9]|1[0-2])$/`，char(7) YYYY-MM）
  - `type Period = string`
  - `interface RecapTokenUsage`（`{ prompt: number; completion: number; total: number }`）
  - `interface RecapDto`
  - `interface RecapListResponse`
  - `interface PublicShareRecap`（= `RecapDto`）

- [ ] **Step 1: 写失败测试**

Create `packages/dto/src/recaps.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECAP_STATUSES,
  periodSchema,
  recapStatusSchema,
  type RecapDto,
  type RecapListResponse,
  type PublicShareRecap,
} from './recaps.js';

test('RECAP_STATUSES：四个状态值锁定', () => {
  assert.deepEqual([...RECAP_STATUSES], ['generating', 'ready', 'failed', 'degraded']);
});

test('recapStatusSchema：合法值通过、词表外拒绝', () => {
  assert.equal(recapStatusSchema.parse('generating'), 'generating');
  assert.equal(recapStatusSchema.parse('ready'), 'ready');
  assert.equal(recapStatusSchema.parse('failed'), 'failed');
  assert.equal(recapStatusSchema.parse('degraded'), 'degraded');
  assert.throws(() => recapStatusSchema.parse('pending'));
  assert.throws(() => recapStatusSchema.parse('success'));
});

test('periodSchema：YYYY-MM 合法、边界月与格式非法拒绝', () => {
  assert.equal(periodSchema.parse('2026-01'), '2026-01');
  assert.equal(periodSchema.parse('2026-12'), '2026-12');
  assert.equal(periodSchema.parse('1999-06'), '1999-06');
  // 边界月：01 与 12 合法
  assert.equal(periodSchema.parse('2026-12'), '2026-12');
  assert.throws(() => periodSchema.parse('2026-13')); // 月 13 非法
  assert.throws(() => periodSchema.parse('2026-00')); // 月 00 非法
  assert.throws(() => periodSchema.parse('2026-1'));  // 补零要求
  assert.throws(() => periodSchema.parse('202601'));  // 缺横线
  assert.throws(() => periodSchema.parse('2026/01')); // 斜杠分隔
  assert.throws(() => periodSchema.parse('abcd-ef')); // 非数字
  assert.throws(() => periodSchema.parse(''));        // 空串
});

test('RecapDto 类型可赋值：含全字段（highlights 为 string[]，非 number[]）', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'ready',
    content: '## 7月回顾\n本月记录了10条时刻…',
    highlights: ['moment-uuid-1', 'moment-uuid-2'],
    model: 'deepseek-chat',
    promptVersion: 1,
    tokenUsage: { prompt: 1200, completion: 800, total: 2000 },
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(dto.status, 'ready');
  assert.equal(dto.highlights.length, 2);
  assert.equal(dto.tokenUsage!.total, 2000);
});

test('RecapDto：failed 状态时 model/tokenUsage/generatedAt 可为 null', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'failed',
    content: '',
    highlights: [],
    model: null,
    promptVersion: 1,
    tokenUsage: null,
    error: 'LLM_TIMEOUT',
    generatedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:10:00.000Z',
  };
  assert.equal(dto.status, 'failed');
  assert.equal(dto.model, null);
  assert.equal(dto.tokenUsage, null);
  assert.equal(dto.generatedAt, null);
});

test('RecapDto：degraded 状态（预算降级）model 为 null、tokenUsage 为 null', () => {
  const dto: RecapDto = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'degraded',
    content: '本月记录 8 条，里程碑：第一次微笑。',
    highlights: ['moment-uuid-1'],
    model: null,
    promptVersion: 1,
    tokenUsage: null,
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(dto.status, 'degraded');
  assert.equal(dto.model, null);
  assert.equal(dto.tokenUsage, null);
});

test('RecapListResponse：recaps 数组可空', () => {
  const res: RecapListResponse = { recaps: [] };
  assert.equal(res.recaps.length, 0);
});

test('PublicShareRecap 可赋值为 RecapDto（字段子集复用）', () => {
  const recap: PublicShareRecap = {
    id: 'recap-uuid',
    chainId: 'chain-uuid',
    period: '2026-07',
    status: 'ready',
    content: 'markdown',
    highlights: [],
    model: 'deepseek-chat',
    promptVersion: 1,
    tokenUsage: null,
    error: null,
    generatedAt: '2026-08-01T00:05:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:05:00.000Z',
  };
  assert.equal(recap.period, '2026-07');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`Cannot find module './recaps.js'`（或等效模块解析错误）。

- [ ] **Step 3: 实现 `recaps.ts`**

Create `packages/dto/src/recaps.ts`：
```ts
import { z } from 'zod';

// ---------- 状态词表（spec §2：status enum） ----------

export const RECAP_STATUSES = ['generating', 'ready', 'failed', 'degraded'] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];
export const recapStatusSchema = z.enum(RECAP_STATUSES);

// ---------- period 校验（spec §2：char(7) YYYY-MM） ----------

/**
 * YYYY-MM 格式校验：月份 01–12，补零必须。
 * spec §2 period = char(7)，按 wall_date 归属月份。
 */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'INVALID_PERIOD');
export type Period = string;

// ---------- token 用量（spec §2 token_usage json） ----------

export interface RecapTokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ---------- RecapDto（spec §2 全列 + §6 API 响应） ----------

export interface RecapDto {
  id: string;
  chainId: string;
  period: Period;
  status: RecapStatus;
  /** Markdown 正文（spec §2 content text） */
  content: string;
  /**
   * 引用的 moment id 有序列表（客户端渲染「高光时刻」跳转，spec §2/§7）。
   * spec §4 写 `highlight_moment_ids: number[]`，但 moments.id 是 char(36) UUID，
   * 故类型为 string[]（spec 笔误的机械修正，非设计发明）。
   */
  highlights: string[];
  /** 实际使用的模型名（审计）；failed/degraded 时为 null */
  model: string | null;
  /** prompt 模板版本（重生成对比用） */
  promptVersion: number;
  /** token 用量（成本核算）；failed/degraded 时为 null */
  tokenUsage: RecapTokenUsage | null;
  /** failed 时的摘要；非 failed 为 null */
  error: string | null;
  /** 生成完成时间；generating/failed 时为 null */
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- API 响应（spec §6） ----------

/** 回顾列表（period 倒序，无分页——每链每月至多一条，spec §6） */
export interface RecapListResponse {
  recaps: RecapDto[];
}

/**
 * 分享页外发的精简快照（spec §6：分享页附最近一期 ready/degraded 回顾）。
 * 字段集与 RecapDto 一致（content/highlights/model/period 全需要），直接复用。
 */
export type PublicShareRecap = RecapDto;
```

- [ ] **Step 4: 接 barrel 导出**

Modify `packages/dto/src/index.ts` — 在 `export * from './templates.js';` 之后追加一行：
```ts
export * from './recaps.js';
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，8 个测试全过（`pass 8`、`fail 0`）。

- [ ] **Step 6: 构建确认类型可生成**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/recaps.ts packages/dto/src/recaps.test.ts packages/dto/src/index.ts
git commit -m "feat(dto): add recap domain types and period validation"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（8 个测试）
- [ ] `pnpm --filter @moment/dto build` exit 0
- [ ] `pnpm --filter @moment/dto lint` exit 0
- [ ] spec §2 的列（status enum 四值 / period char(7) / highlights json / model null / token_usage json null / error null / generated_at null）在 `RecapDto` 逐一对应
- [ ] 执行 prompt T1 的 Produces 符号逐个可在 `@moment/dto` 解析到
