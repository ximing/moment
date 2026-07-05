# 链模板系统 P3：server chains/moments 集成 + 聚合端点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把模板系统接入链与时刻：`chains.template/payload`、`moments.kind/payload` 加列迁移、payload 分发校验、链详情内嵌 templateManifest、聚合视图端点、分享页附带模板数据。

**Architecture:** payload 校验在 service 内（controller 边界之后，spec §3.3），规则来自该链模板的 manifest（DB 读取，任何 status 可读——archived 模板的存量链照常工作）；kind 值的 JSON Schema 走 dto 派生表 `momentFieldPayloadJsonSchema`（P2 Task 1）。聚合视图是 moments 表上的查询投影（spec §7：单链结构化 moment < 1 万，JSON 回表可接受），server 只出数据，渲染归各端。

**Tech Stack:** drizzle-orm / ajv（P2 已进 dependencies）/ routing-controllers + TypeDI / jest + supertest（真实测试库，`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§2.2–2.4 数据模型、§3.2 契约变化、§3.3 权限、§8 breaking 清单）

## Global Constraints

- 执行 prompt T3/T4 契约：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`；错误码 `MOMENT_PAYLOAD_INVALID` / `TEMPLATE_IMMUTABLE` / `INVALID_AGGREGATE_VIEW` 逐字不得改。
- 上游契约（已评审通过）：dto 的 `TemplateManifest` / `TemplateMomentField` / `momentFieldPayloadJsonSchema` / `TEMPLATE_VIEW_TYPES`（P1+P2）；server 的 `TemplateService.getActiveByKey(key): Promise<Template>`（active 限定，archived/不存在抛 `NotFoundError('TEMPLATE_NOT_FOUND')`）与 `TemplateService.getByKey(key): Promise<TemplateDto>`（任意 status 可读）（P2 Task 4）。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 链权限一律走 `ChainPolicy.require` / `requireChainRole`，controller 内禁止手写角色判断（CONVENTIONS §3.1）。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码。
- 触库测试必须 `afterAll(closeDb)` + `resetDb()`（P2 已在 resetDb 末尾重 seed official 模板，本计划的测试可直接使用 `baby`/`travel`/`daily` 三模板）。
- 迁移沿用 wall_date 三阶段先例（`drizzle/0008_amused_wendell_rand.sql`）：drizzle-kit 生成框架后**手工编辑 SQL** 为「ADD NULL → UPDATE 回填 → MODIFY NOT NULL」；迁移与新代码同批部署（spec §8.4）。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。
- **timeline 视图不走聚合端点**：前端直接用 moments 列表 + manifest 的 `groupBy: 'trips'` 分章（本计划决策，spec §3.2 聚合端点只服务 curve/map/milestone-axis/moodline）；`view=timeline` 请求 → `INVALID_AGGREGATE_VIEW`。

**已批准越界（编排者裁决口径沿用 P2 格式）**：本计划 owner 范围超出执行 prompt T3/T4 原始清单，以下扩项已获批准：
- Modify `packages/dto/src/templates.ts` / `share.ts` 及对应测试（聚合响应类型与分享响应扩展属 dto 契约，必须与 server 同批）。
- Modify `apps/server/tests/helpers/chains.ts`（API 建链 helper 补 template）与 `apps/server/tests/chains/chains.crud.test.ts`（既有 POST 补 template——dto 必填字段生效的连带修正）。
- Modify `apps/server/src/app.ts`（注册 AggregateController，P2 注册 TemplatesController 同款）。
- Modify `apps/server/src/share/share-link.service.ts`（分享响应组装，T4 只写了「Modify src/share/」，精确到文件）。

**契约变更声明（评审 H2，编排者已裁决并回写 spec/prompt）**：
- 链 payload 非法用 `CHAIN_PAYLOAD_INVALID`，与 `MOMENT_PAYLOAD_INVALID` 并列（链/时刻分开报错码；spec §3.2 与执行 prompt T3 已同步回写）。
- `validateChainPayload` / `validateMomentPayload` 返回 `Record<string, unknown> | null`（替代执行 prompt T3 的 `void` 签名，供 service 校验后直接写库，避免二次断言）。

**中间态声明（评审 H3）**：P3 合入后 web/app 的 typecheck/build 变红属预期中间态（`CreateChainInput.template` 必填化 + 响应 DTO 增字段），由 P4/P5 修复；本计划 DoD 不跑全仓 build。

---

### Task 1: dto 契约扩展（chains/moments/templates/share）+ 调用方测试修正

**Files:**
- Modify: `packages/dto/src/chains.ts`、`packages/dto/src/moments.ts`、`packages/dto/src/templates.ts`、`packages/dto/src/share.ts`
- Test: `packages/dto/src/chains.test.ts`、`packages/dto/src/moments.test.ts`、`packages/dto/src/templates.test.ts`
- Modify（连带修正，dto 必填字段生效后这些调用方才保持绿）: `apps/server/tests/helpers/chains.ts`、`apps/server/tests/chains/chains.crud.test.ts`

**Interfaces:**
- Consumes: P1 的 `TemplateManifest` / `TEMPLATE_VIEW_TYPES`；既有 dto 各域文件。
- Produces（P4/P5 与 api-client 消费，不得改名）:
  - `createChainInputSchema` 增必填 `template: z.string().min(1).max(64)` 与可选 `payload: z.record(z.unknown()).nullish()`；`updateChainInputSchema` 增 `payload: z.record(z.unknown()).nullable().optional()`（**不含 template**——改 template 的拒绝在 server controller 层，见 Task 4）
  - `ChainDto` 增 `template: string`、`payload: Record<string, unknown> | null`；新增 `interface ChainDetailDto extends ChainDto { templateManifest: TemplateManifest }`
  - `createMomentInputSchema` 增 `kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).default('standard')`、`payload: z.record(z.unknown()).nullish()`；`patchMomentInputSchema` 增可选 `kind`（同正则）与 `payload: z.record(z.unknown()).nullable().optional()`
  - `MomentResponse` 增 `kind: string`、`payload: Record<string, unknown> | null`
  - 聚合类型（templates.ts 追加）：
    ```ts
    export interface AggregateCurvePoint { happenedAt: string; metric: string; value: number; unit: string }
    export interface AggregateMapPoint { momentId: string; happenedAt: string; lat: number; lng: number; placeName: string | null }
    export interface AggregateMilestoneItem { momentId: string; happenedAt: string; label: string; icon: string | null; note: string | null }
    export interface AggregateMoodlineDay { date: string; mood: string; count: number }
    export type AggregateResponse =
      | { view: 'curve'; points: AggregateCurvePoint[] }
      | { view: 'map'; points: AggregateMapPoint[] }
      | { view: 'milestone-axis'; items: AggregateMilestoneItem[] }
      | { view: 'moodline'; days: AggregateMoodlineDay[] };
    export const aggregateQuerySchema = z.object({
      view: z.enum(TEMPLATE_VIEW_TYPES),
      kind: z.string().max(64).optional(),
      field: z.string().max(64).optional(),
    });
    export type AggregateQuery = z.infer<typeof aggregateQuerySchema>;
    ```
  - `PublicShareResponse` 增 `template: string`、`templateManifest: TemplateManifest`、`aggregates: AggregateResponse[]`

- [ ] **Step 1: 改失败测试**

Modify `packages/dto/src/chains.test.ts`——`createChainInputSchema.parse(...)` 的全部 6 处既有调用补 `template: 'daily'`（L14 `parse({ name: '  宝宝成长  ' })` 正例；L21–22 空 name / 非法 visibility 两个拒绝用例；L32 `parse({ name: '宝宝', color: 'mint', icon: '👶' })` 正例；L35–36 非法 color / 非法 icon 两个拒绝用例），保证拒绝原因仍锁定在原断言目标（name/visibility/color/icon）而非缺 template，并追加：
```ts
test('createChainInputSchema：template 必填；payload 仅接受对象或 null', () => {
  assert.throws(() => createChainInputSchema.parse({ name: 'x' })); // 缺 template
  const ok = createChainInputSchema.parse({ name: 'x', template: 'baby', payload: { birthdate: '2025-01-01' } });
  assert.equal(ok.template, 'baby');
  assert.deepEqual(ok.payload, { birthdate: '2025-01-01' });
  assert.throws(() => createChainInputSchema.parse({ name: 'x', template: 'baby', payload: 'nope' }));
});

test('updateChainInputSchema：payload 可改、可显式置 null；schema 不含 template 键', () => {
  const ok = updateChainInputSchema.parse({ payload: { birthdate: '2025-01-01' } });
  assert.deepEqual(ok.payload, { birthdate: '2025-01-01' });
  const cleared = updateChainInputSchema.parse({ payload: null });
  assert.equal(cleared.payload, null);
  // template 不在 schema 内（zod 默认剥离未知键）；改 template 的 TEMPLATE_IMMUTABLE 由 server controller 检测原始 body（Task 4）。
  // 注意：updateChainInputSchema 带 .refine()，类型是 ZodEffects 没有 .shape——用 parse 行为断言（传入 template 被剥离）
  const stripped = updateChainInputSchema.parse({ name: '改名', template: 'baby' });
  assert.equal('template' in stripped, false);
});
```

Modify `packages/dto/src/moments.test.ts`——import 块确认已含 `createMomentInputSchema` 与 `patchMomentInputSchema`（缺则补），追加：
```ts
test('createMomentInputSchema：kind 默认 standard、非法 kind 拒绝、payload 仅对象', () => {
  const base = { type: 'text' as const, content: 'x', happenedAt: new Date().toISOString(), happenedTzOffset: -480 };
  const def = createMomentInputSchema.parse(base);
  assert.equal(def.kind, 'standard');
  assert.equal(def.payload, undefined);
  assert.equal(createMomentInputSchema.parse({ ...base, kind: 'milestone', payload: { catalog_key: 'first-smile' } }).kind, 'milestone');
  assert.throws(() => createMomentInputSchema.parse({ ...base, kind: 'Milestone' }));
  assert.throws(() => createMomentInputSchema.parse({ ...base, payload: 'nope' }));
});

test('patchMomentInputSchema：kind/payload 可选，strict 仍拒未知键', () => {
  const ok = patchMomentInputSchema.parse({ payload: { mood: '😄' } });
  assert.deepEqual(ok.payload, { mood: '😄' });
  assert.throws(() => patchMomentInputSchema.parse({ kind: 'milestone', hacker: 1 }));
});
```

Modify `packages/dto/src/templates.test.ts`——import 块把 `aggregateQuerySchema` 加入 `./templates.js` 的导入列表，追加：
```ts
test('aggregateQuerySchema：view 词表校验，kind/field 可选', () => {
  assert.equal(aggregateQuerySchema.parse({ view: 'curve' }).view, 'curve');
  assert.equal(aggregateQuerySchema.parse({ view: 'map', field: 'geo' }).field, 'geo');
  assert.throws(() => aggregateQuerySchema.parse({ view: 'pie' }));
  assert.throws(() => aggregateQuerySchema.parse({}));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`createChainInputSchema` 尚无 `template`、`aggregateQuerySchema` 未导出等。

- [ ] **Step 3: 实现 dto 扩展**

Modify `packages/dto/src/chains.ts`：
- import 块顶部加 `import type { TemplateManifest } from './templates.js';`
- `createChainInputSchema` 在 `icon` 行后加两个字段：
  ```ts
    /** 链模板 key（spec §3.2：创建必传、不可改）；official 为 baby/travel/daily，user 模板为 u_<21位> */
    template: z.string().min(1).max(64),
    /** 链级模板数据（宝宝生日、行程列表等），按模板 manifest 的 chainPayloadSchema 在 server 校验 */
    payload: z.record(z.unknown()).nullish(),
  ```
- `updateChainInputSchema` 的 object 内 `icon` 行后加：
  ```ts
    // template 刻意不在此 schema：改 template 由 server controller 检测原始 body 抛 TEMPLATE_IMMUTABLE（spec §3.2）
    payload: z.record(z.unknown()).nullable().optional(),
  ```
- `ChainDto` 在 `visibility` 行后加：
  ```ts
  /** 链模板 key（创建时选定，不可改，spec §0） */
  template: string;
  /** 链级模板数据；未填为 null */
  payload: Record<string, unknown> | null;
  ```
- 文件末尾追加：
  ```ts
  /** 链详情 = ChainDto + 内嵌模板 manifest（spec §3.2：客户端不必二次请求模板） */
  export interface ChainDetailDto extends ChainDto {
    templateManifest: TemplateManifest;
  }
  ```

Modify `packages/dto/src/moments.ts`：
- `createMomentInputSchema` 的 object 内 `tagIds` 行后加：
  ```ts
    /** 语义类别（spec §1.1）；standard = 普通 moment，其余由链模板 kinds 声明 */
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).default('standard'),
    /** 结构化数据；standard moment 只允许模板 momentFields 声明的 key，kind moment 按 kind 的 payloadSchema（server 校验） */
    payload: z.record(z.unknown()).nullish(),
  ```
- `patchMomentInputSchema` 的 object 内 `tagIds` 行后加：
  ```ts
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).optional(),
    payload: z.record(z.unknown()).nullable().optional(),
  ```
- `MomentResponse` 在 `type` 行后加：
  ```ts
  /** 语义类别（默认 standard） */
  kind: string;
  /** 结构化数据（milestone/metric 的 payload，或 standard 的 mood/geo 等扩展字段）；无为 null */
  payload: Record<string, unknown> | null;
  ```

Modify `packages/dto/src/templates.ts`——末尾追加：
```ts
// ---------- 聚合视图投影（spec §3.2：server 只出数据，渲染归各端词表渲染器） ----------

/** curve 投影点；metric 随点返回（baby 的 height/weight 两条线由前端按 metric 拆分） */
export interface AggregateCurvePoint {
  /** ISO 8601 */
  happenedAt: string;
  metric: string;
  value: number;
  unit: string;
}

export interface AggregateMapPoint {
  momentId: string;
  /** ISO 8601 */
  happenedAt: string;
  lat: number;
  lng: number;
  placeName: string | null;
}

export interface AggregateMilestoneItem {
  momentId: string;
  /** ISO 8601 */
  happenedAt: string;
  /** catalog_key 解析自 milestoneCatalog，或 custom_label 原文 */
  label: string;
  icon: string | null;
  note: string | null;
}

/** 按墙钟日（wall_date）聚合的心情分布 */
export interface AggregateMoodlineDay {
  /** YYYY-MM-DD */
  date: string;
  mood: string;
  count: number;
}

export type AggregateResponse =
  | { view: 'curve'; points: AggregateCurvePoint[] }
  | { view: 'map'; points: AggregateMapPoint[] }
  | { view: 'milestone-axis'; items: AggregateMilestoneItem[] }
  | { view: 'moodline'; days: AggregateMoodlineDay[] };

/** 聚合端点 query；timeline 可被 parse 但 server 拒绝（INVALID_AGGREGATE_VIEW，见 P3 Global Constraints） */
export const aggregateQuerySchema = z.object({
  view: z.enum(TEMPLATE_VIEW_TYPES),
  kind: z.string().max(64).optional(),
  field: z.string().max(64).optional(),
});
export type AggregateQuery = z.infer<typeof aggregateQuerySchema>;
```
（若文件顶部缺 `z` 的 import 则补 `import { z } from 'zod';`。）

Modify `packages/dto/src/share.ts`——`PublicShareResponse` 改为：
```ts
/** 匿名只读视图：计数只读展示（commentCount/reactions），myReaction 恒 null */
export interface PublicShareResponse {
  chain: PublicShareChainInfo;
  /** 链模板 key 与内嵌 manifest（spec §3.2：长辈可见里程碑轴/地图，渲染需要 manifest） */
  template: string;
  templateManifest: TemplateManifest;
  /** 该链模板声明的全部聚合投影（timeline 除外，由 moments 列表分章） */
  aggregates: AggregateResponse[];
  moments: MomentResponse[];
  nextCursor: string | null;
}
```
并在文件顶部 import 块加 `import type { AggregateResponse, TemplateManifest } from './templates.js';`。

Modify `apps/server/tests/helpers/chains.ts`——`createChain` 改为：
```ts
/** 走真实 API 建链，返回 ChainDto。template 默认 daily（spec §2.3：存量与测试默认模板）。 */
export async function createChain(app: Express, owner: TestUser, name = '测试链', template = 'daily'): Promise<ChainDto> {
  const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name, template });
  if (res.status !== 201) {
    throw new Error(`createChain failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as ChainDto;
}
```

Modify `apps/server/tests/chains/chains.crud.test.ts`——全部 5 处 `post('/api/chains')` 的 send body 补 `template: 'daily'`（含「可带预设色与图标」的 `{ name: '旅行', color: 'sky', icon: '✈️' }` → `{ name: '旅行', color: 'sky', icon: '✈️', template: 'daily' }`；L58 空 name 400 用例的 `{ name: '' }` → `{ name: '', template: 'daily' }`，把拒绝原因锁定在 name 而非缺 template；未登录 401 用例的 `{ name: 'x' }` 保持不变——401 发生在鉴权层，与 body 无关）。注意：ChainService 在 Task 3 才把 template 写入 DB，本步骤仅让请求过 dto 边界。

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build
pnpm --filter @moment/server test
```
Expected: dto 测试全绿（fail 0；不写死总数，防随上游 P1/P2 计数漂移），build exit 0；server 全量测试全绿（chains.crud 修正后无回归）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/chains.ts packages/dto/src/moments.ts packages/dto/src/templates.ts packages/dto/src/share.ts packages/dto/src/chains.test.ts packages/dto/src/moments.test.ts packages/dto/src/templates.test.ts apps/server/tests/helpers/chains.ts apps/server/tests/chains/chains.crud.test.ts
git commit -m "feat(dto): extend chain/moment contracts with template kind and payload"
```

---

### Task 2: payload 分发校验器

**Files:**
- Create: `apps/server/src/templates/payload-validator.ts`
- Test: `apps/server/tests/templates/payload-validator.test.ts`

**Interfaces:**
- Consumes: dto 的 `TemplateManifest` / `momentFieldPayloadJsonSchema`（P2 Task 1）；ajv（P2 Task 3 已加 dependencies）。
- Produces（Task 3/4 消费）:
  - `validateChainPayload(manifest: TemplateManifest, payload: unknown): Record<string, unknown> | null`——null/undefined → null（不校验）；模板无 chainPayloadSchema 而 payload 非空 → `BadRequestError('CHAIN_PAYLOAD_INVALID')`；有 schema 则 ajv 校验，失败同码
  - `validateMomentPayload(manifest: TemplateManifest, kind: string, payload: unknown): Record<string, unknown> | null`——kind 未在 manifest.kinds 声明（且非 standard）→ `BadRequestError('MOMENT_PAYLOAD_INVALID')`；kind moment 按 kind.payloadSchema 校验（payload 必填）；standard moment 的 payload key 必须 ⊆ momentFields，值过 `momentFieldPayloadJsonSchema`，失败同码

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/payload-validator.test.ts`（纯单测，不触库）：
```ts
import { OFFICIAL_TEMPLATES, type TemplateManifest } from '@moment/dto';
import { validateChainPayload, validateMomentPayload } from '../../src/templates/payload-validator.js';

const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!.manifest;
const travel = OFFICIAL_TEMPLATES.find((t) => t.key === 'travel')!.manifest;
const daily = OFFICIAL_TEMPLATES.find((t) => t.key === 'daily')!.manifest;
const blank: TemplateManifest = { version: 1 };

describe('validateChainPayload', () => {
  it('baby：合法 payload 通过；birthdate 非法格式 / 未知键拒绝 CHAIN_PAYLOAD_INVALID', () => {
    expect(validateChainPayload(baby, { birthdate: '2025-01-01', gender: 'girl' })).toEqual({
      birthdate: '2025-01-01',
      gender: 'girl',
    });
    expect(() => validateChainPayload(baby, { birthdate: '2025/01/01' })).toThrow('CHAIN_PAYLOAD_INVALID');
    expect(() => validateChainPayload(baby, { birthdate: '2025-01-01', hacker: 1 })).toThrow('CHAIN_PAYLOAD_INVALID');
  });

  it('null/undefined 不校验直接放行；无 chainPayloadSchema 的模板拒绝非空 payload', () => {
    expect(validateChainPayload(baby, null)).toBeNull();
    expect(validateChainPayload(baby, undefined)).toBeNull();
    expect(() => validateChainPayload(daily, { mood: '😄' })).toThrow('CHAIN_PAYLOAD_INVALID');
  });
});

describe('validateMomentPayload', () => {
  it('baby milestone：catalog_key 或 custom_label 满足 anyOf；缺两者 / 未知键拒绝', () => {
    expect(validateMomentPayload(baby, 'milestone', { catalog_key: 'first-smile', note: '今天笑了' })).toEqual({
      catalog_key: 'first-smile',
      note: '今天笑了',
    });
    expect(validateMomentPayload(baby, 'milestone', { custom_label: '第一次叫妈妈' })).toBeTruthy();
    expect(() => validateMomentPayload(baby, 'milestone', { note: '没有标识' })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(baby, 'milestone', null)).toThrow('MOMENT_PAYLOAD_INVALID');
  });

  it('baby metric：height/weight + 正数 value + cm/kg；负值与非法单位拒绝', () => {
    expect(validateMomentPayload(baby, 'metric', { metric: 'height', value: 62, unit: 'cm' })).toBeTruthy();
    expect(() => validateMomentPayload(baby, 'metric', { metric: 'height', value: -1, unit: 'cm' })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(baby, 'metric', { metric: 'height', value: 62, unit: 'm' })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(baby, 'metric', { metric: 'bmi', value: 18, unit: 'kg' })).toThrow('MOMENT_PAYLOAD_INVALID');
  });

  it('daily standard：mood 在 options 内通过；不在 options / 未声明 key 拒绝；无 payload 放行', () => {
    expect(validateMomentPayload(daily, 'standard', { mood: '😄' })).toEqual({ mood: '😄' });
    expect(() => validateMomentPayload(daily, 'standard', { mood: '🤯' })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(daily, 'standard', { geo: { lat: 1, lng: 2 } })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(validateMomentPayload(daily, 'standard', null)).toBeNull();
    expect(validateMomentPayload(daily, 'standard', undefined)).toBeNull();
  });

  it('travel standard：geo 合法通过、经纬度越界拒绝；travel 不接受 mood', () => {
    expect(validateMomentPayload(travel, 'standard', { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } })).toBeTruthy();
    expect(() => validateMomentPayload(travel, 'standard', { geo: { lat: 91, lng: 0 } })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(travel, 'standard', { mood: '😄' })).toThrow('MOMENT_PAYLOAD_INVALID');
  });

  it('未声明的 kind 一律拒绝；baby 的 standard moment 不接受任何字段（baby 无 momentFields）', () => {
    expect(() => validateMomentPayload(daily, 'milestone', {})).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(blank, 'note', {})).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(() => validateMomentPayload(baby, 'standard', { mood: '😄' })).toThrow('MOMENT_PAYLOAD_INVALID');
    expect(validateMomentPayload(baby, 'standard', null)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/payload-validator.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现校验器**

Create `apps/server/src/templates/payload-validator.ts`：
```ts
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { momentFieldPayloadJsonSchema, type TemplateManifest } from '@moment/dto';
import { BadRequestError } from 'routing-controllers';

const ajv = new Ajv2020({ allErrors: false });
/** payloadSchema 编译缓存：manifest 内容不可变（编辑走 version+1 新对象），字符串化做 key 安全 */
const schemaCache = new Map<string, ValidateFunction>();

function compiled(schema: object): ValidateFunction {
  const key = JSON.stringify(schema);
  let fn = schemaCache.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    schemaCache.set(key, fn);
  }
  return fn;
}

function toRecord(payload: unknown): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  return payload as Record<string, unknown>;
}

/**
 * 链级 payload 校验（spec §3.2）：null 放行（链可先建后补录）；
 * 模板未声明 chainPayloadSchema 时拒绝任何非空 payload。
 */
export function validateChainPayload(manifest: TemplateManifest, payload: unknown): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  if (!manifest.chainPayloadSchema) throw new BadRequestError('CHAIN_PAYLOAD_INVALID');
  if (!compiled(manifest.chainPayloadSchema)(payload)) throw new BadRequestError('CHAIN_PAYLOAD_INVALID');
  return toRecord(payload);
}

/**
 * moment payload 分发校验（spec §3.2）：
 * - kind 必须是 'standard' 或模板 kinds 声明的 key；
 * - kind moment：payload 必填且过该 kind 的 payloadSchema；
 * - standard moment：payload 为 null 放行；非 null 时 key 必须 ⊆ momentFields，
 *   每个值过 dto 派生表 momentFieldPayloadJsonSchema（与 P2 约定：kind moment 的 payload 不混入 momentFields）。
 */
export function validateMomentPayload(
  manifest: TemplateManifest,
  kind: string,
  payload: unknown,
): Record<string, unknown> | null {
  if (kind !== 'standard') {
    const kindDef = (manifest.kinds ?? []).find((k) => k.key === kind);
    if (!kindDef) throw new BadRequestError('MOMENT_PAYLOAD_INVALID');
    if (!compiled(kindDef.payloadSchema)(payload)) throw new BadRequestError('MOMENT_PAYLOAD_INVALID');
    return toRecord(payload);
  }
  if (payload === null || payload === undefined) return null;
  const fields = manifest.momentFields ?? [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const field = byKey.get(key);
    if (!field) throw new BadRequestError('MOMENT_PAYLOAD_INVALID');
    if (!compiled(momentFieldPayloadJsonSchema(field))(value)) {
      throw new BadRequestError('MOMENT_PAYLOAD_INVALID');
    }
  }
  return record;
}
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run:
```bash
pnpm --filter @moment/server test -- tests/templates/payload-validator.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，7 个测试全过（validateChainPayload 2 + validateMomentPayload 5）；typecheck exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/templates/payload-validator.ts apps/server/tests/templates/payload-validator.test.ts
git commit -m "feat(server): add template payload validators"
```

---

### Task 3: 加列迁移 + fixtures + 链创建接入

**Files:**
- Modify: `apps/server/src/db/schema/chains.ts`、`apps/server/src/db/schema/moments.ts`
- Modify: `apps/server/tests/helpers/fixtures.ts`（insertChain/insertMoment 补字段，spec §2.4）
- Modify（直插 chains 的调用点，template NOT NULL 后必须显式给值）: `apps/server/tests/helpers/chain.ts`、`apps/server/tests/chains/schema.test.ts`、`apps/server/tests/worker/sweeper.test.ts`、`apps/server/tests/chains/require-chain-role.test.ts`、`apps/server/tests/chains/chain-policy.test.ts`、`apps/server/src/e2e/fixture-rows.ts`
- Modify: `apps/server/src/chains/chain.service.ts`（create 写入 template/payload + 校验；toChainDto 增字段）
- Test: `apps/server/tests/templates/schema-columns.test.ts`、`apps/server/tests/chains/chains.template.test.ts`

**Interfaces:**
- Consumes: Task 1 的 dto 契约；Task 2 的 `validateChainPayload`；P2 的 `TemplateService.getActiveByKey`。
- Produces:
  - `chains.template varchar(64) NOT NULL`、`chains.payload json NULL`；`moments.kind varchar(64) NOT NULL DEFAULT 'standard'`、`moments.payload json NULL`
  - `ChainService.create` 写入 template/payload（template 必须 active，否则 `TEMPLATE_NOT_FOUND` 404）
  - fixtures：`insertChain(ownerId, name?, template?)`、`insertMoment({... kind?, payload? })`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/schema-columns.test.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, moments } from '../../src/db/schema.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';

let user: TestUser;

beforeEach(async () => {
  await resetDb();
  user = await createUser(app, 'cols');
});
afterAll(closeDb);

describe('模板加列（spec §2.2）', () => {
  it('fixtures 默认：链 template=daily、moment kind=standard/payload=null', async () => {
    const chainId = await createChain(user.id);
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId));
    expect(chain.template).toBe('daily');
    expect(chain.payload).toBeNull();

    const momentId = await insertMoment({ chainId, authorId: user.id, happenedAt: new Date() });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.kind).toBe('standard');
    expect(m.payload).toBeNull();
  });

  it('fixtures 支持结构化：kind=milestone + payload 落库可回读', async () => {
    const chainId = await createChain(user.id, '宝宝', 'baby');
    const momentId = await insertMoment({
      chainId,
      authorId: user.id,
      happenedAt: new Date(),
      kind: 'milestone',
      payload: { catalog_key: 'first-smile' },
    });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.kind).toBe('milestone');
    expect(m.payload).toEqual({ catalog_key: 'first-smile' });
  });
});
```

Create `apps/server/tests/chains/chains.template.test.ts`：
```ts
import type { ChainDto } from '@moment/dto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('POST /api/chains + template（spec §3.2）', () => {
  it('缺 template → 400 VALIDATION_ERROR（dto 必填）', async () => {
    const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('未知 template / 已归档 template → 404 TEMPLATE_NOT_FOUND', async () => {
    const unknown = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: 'x', template: 'nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('TEMPLATE_NOT_FOUND');

    // archived 模板不可选用（spec §3.4）：先建再归档
    const created = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(owner))
      .send({ name: '临时', icon: 'T', manifest: { version: 1 } });
    const key = created.body.key as string;
    await request(app).delete(`/api/templates/${key}`).set('Authorization', auth(owner));
    const archived = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: 'x', template: key });
    expect(archived.status).toBe(404);
    expect(archived.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('baby 链带合法 payload → 201，响应含 template/payload', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby', payload: { birthdate: '2025-01-01', gender: 'girl' } });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.template).toBe('baby');
    expect(chain.payload).toEqual({ birthdate: '2025-01-01', gender: 'girl' });
  });

  it('baby 链非法 payload → 400 CHAIN_PAYLOAD_INVALID；daily 链带 payload → 400', async () => {
    const bad = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby', payload: { birthdate: '2025/01/01' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');

    const noSchema = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '日常', template: 'daily', payload: { mood: '😄' } });
    expect(noSchema.status).toBe(400);
    expect(noSchema.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/schema-columns.test.ts tests/chains/chains.template.test.ts`
Expected: FAIL，`template`/`payload` 列不存在（编译或运行时错误）。

- [ ] **Step 3: schema 加列**

Modify `apps/server/src/db/schema/chains.ts`——`visibility` 行后加：
```ts
  /** 链模板 key → templates.key（应用层校验不加 FK，spec §2.2）；创建时选定不可改 */
  template: varchar('template', { length: 64 }).notNull(),
  /** 链级模板数据（宝宝生日、行程列表等），按 manifest.chainPayloadSchema 校验 */
  payload: json('payload').$type<Record<string, unknown>>(),
```
import 行把 `json` 加入 `drizzle-orm/mysql-core` 的导入列表。

Modify `apps/server/src/db/schema/moments.ts`——`type` 行后加：
```ts
    /** 语义类别（spec §1.1）：standard 或链模板 kinds 声明的 key；不进核心索引（spec §2.2） */
    kind: varchar('kind', { length: 64 }).notNull().default('standard'),
    /** 结构化数据（kind 的 payload 或 standard 的扩展字段 mood/geo 等） */
    payload: json('payload').$type<Record<string, unknown>>(),
```
import 行把 `json` 加入导入列表。

- [ ] **Step 4: 生成迁移并手工改三阶段**

Run: `pnpm --filter @moment/server migrate:generate`
Expected: `drizzle/` 新增 `0010_*.sql`（P2 已占 0009）。drizzle 对 `template NOT NULL`（无默认值）会直接生成 `ADD ... NOT NULL`，strict mode 下对存量表报错——**手工编辑该 SQL**（wall_date 0008 先例），把 chains 部分改为：
```sql
ALTER TABLE `chains` ADD `template` varchar(64) NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `payload` json;--> statement-breakpoint
UPDATE `chains` SET `template` = 'daily';--> statement-breakpoint
ALTER TABLE `chains` MODIFY `template` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `moments` ADD `kind` varchar(64) NOT NULL DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `moments` ADD `payload` json;
```
（moments.kind 有默认值可单步；chains.template 必须三阶段。meta snapshot 对应最终 schema，只改 statements。）

Run: `pnpm --filter @moment/server migrate`
Expected: exit 0（globalSetup 也会在测试前自动跑迁移）。

- [ ] **Step 5: fixtures 补字段**

Modify `apps/server/tests/helpers/fixtures.ts`：
- `createChain` 签名与 insert 改为：
  ```ts
  /** 直插链 + owner 成员行（绕过邀请流程，测试只关心权限判定本身）。template 默认 daily（spec §2.3）。 */
  export async function createChain(ownerId: string, name = '测试链', template = 'daily'): Promise<string> {
    const id = randomUUID();
    await db.insert(chains).values({ id, name, ownerId, visibility: 'private', template });
    await db.insert(chainMembers).values({ chainId: id, userId: ownerId, role: 'owner', joinedAt: new Date() });
    return id;
  }
  ```
- `insertMoment` 的 opts 类型加 `kind?: string; payload?: Record<string, unknown> | null;`，values 加：
  ```ts
    kind: opts.kind ?? 'standard',
    payload: opts.payload ?? null,
  ```

- [ ] **Step 6: 直插 chains 调用点补 template（全仓穷尽，见 Step 2 前的 grep 基线）**

`template` 列 NOT NULL 无默认值，所有绕过 API 直插 chains 的调用点必须显式给值。逐点改动（行号为改前基线，均以本计划起草时的 `grep -rn "insert(chains)"` 穷尽清单为准）：

1. `apps/server/tests/helpers/chain.ts` L13 `createChainWithMembers` 的 `values({...})`：`visibility: 'private',` 行后加 `template: 'daily',`
2. `apps/server/tests/chains/schema.test.ts` L11：`values({ id: 'c1', name: '链', ownerId: 'u1' })` → `values({ id: 'c1', name: '链', ownerId: 'u1', template: 'daily' })`
3. `apps/server/tests/worker/sweeper.test.ts` L32：`values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private' })` → 末尾加 `, template: 'daily'`
4. `apps/server/tests/chains/require-chain-role.test.ts` L37：`values({ id: 'chain-1', name: 'c', ownerId: 'u-owner' })` → `values({ id: 'chain-1', name: 'c', ownerId: 'u-owner', template: 'daily' })`
5. `apps/server/tests/chains/chain-policy.test.ts` L18：`values({ id: 'chain-1', name: 'c', ownerId: 'user-owner' })` → `values({ id: 'chain-1', name: 'c', ownerId: 'user-owner', template: 'daily' })`
6. `apps/server/src/e2e/fixture-rows.ts`（**src 文件，typecheck 必过**）：`chains: [...]` 数组内的 `NewChain` 字面量（约 L104–116），`visibility: 'private',` 行后加 `template: 'daily',`

> 复核基线（起草时执行）：`grep -rn "insert(chains)" apps/server/src apps/server/tests` 命中 8 处——`chain.service.ts`（Step 7 处理）、`fixture-seeder.ts`（透传 rows.chains，无需改）、`fixtures.ts`（Step 5 处理）、上述 6 处。实现 SubAgent 动手前必须重跑此 grep，有新命中点同样补 `template: 'daily'` 并在完工报告列出。

- [ ] **Step 7: ChainService.create 接入**

Modify `apps/server/src/chains/chain.service.ts`：
- import 块加：
  ```ts
  import { TemplateService } from '../templates/template.service.js';
  import { validateChainPayload } from '../templates/payload-validator.js';
  ```
- 构造函数改为 `constructor(private policy: ChainPolicy, private templates: TemplateService) {}`
- `create` 方法开头（`const id = randomUUID();` 之前）加：
  ```ts
    // 模板必须存在且 active（archived 阻止新建链选用，spec §3.4）；payload 按 chainPayloadSchema 校验
    const template = await this.templates.getActiveByKey(input.template);
    const payload = validateChainPayload(template.manifest, input.payload ?? null);
  ```
- `tx.insert(chains).values({...})` 内 `ownerId: userId,` 后加 `template: input.template, payload,`
- `toChainDto` 返回对象 `visibility: chain.visibility,` 后加：
  ```ts
      template: chain.template,
      payload: chain.payload,
  ```

- [ ] **Step 8: 运行确认通过 + 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 全绿——新增 6 个（schema-columns 2 + chains.template 4），既有测试（fixtures/createChain 改动 + 6 个直插点补 template）无回归。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/db/schema/chains.ts apps/server/src/db/schema/moments.ts apps/server/drizzle/0010_*.sql apps/server/drizzle/meta/ apps/server/tests/helpers/fixtures.ts apps/server/tests/helpers/chain.ts apps/server/tests/chains/schema.test.ts apps/server/tests/worker/sweeper.test.ts apps/server/tests/chains/require-chain-role.test.ts apps/server/tests/chains/chain-policy.test.ts apps/server/src/e2e/fixture-rows.ts apps/server/src/chains/chain.service.ts apps/server/tests/templates/schema-columns.test.ts apps/server/tests/chains/chains.template.test.ts
git commit -m "feat(server): add template and payload columns to chains and moments"
```

---

### Task 4: 链更新/详情 + moments 接入 + serializer

**Files:**
- Modify: `apps/server/src/chains/chain.service.ts`（update/getById）、`apps/server/src/chains/chains.controller.ts`（TEMPLATE_IMMUTABLE 检测）
- Modify: `apps/server/src/moments/moment.service.ts`、`apps/server/src/moments/moment-serializer.ts`
- Modify: `apps/server/tests/moments/moment-serializer.test.ts`（MomentLike 字面量补 kind/payload）
- Test: `apps/server/tests/chains/chains.template.test.ts`（追加）、`apps/server/tests/moments/moment-payload.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `validateChainPayload` / `validateMomentPayload`；P2 的 `TemplateService.getByKey`（任意 status——archived 模板的存量链照常校验与展示，spec §3.4）。
- Produces:
  - `PATCH /api/chains/:id` 带 template 键 → `BadRequestError('TEMPLATE_IMMUTABLE')`；改 payload 过 `validateChainPayload`
  - `GET /api/chains/:id` 返回 `ChainDetailDto`（内嵌 `templateManifest`）
  - moments create/update 接受并校验 kind/payload；`MomentResponse` 经 serializer 唯一出口带 kind/payload（CONVENTIONS §3.4）
  - **api-client 不在本计划改动**（web/app 侧类型接入属 P4/P5；`ChainDetailDto ⊃ ChainDto`、`MomentResponse` 纯增字段，不破坏既有 client）

- [ ] **Step 1: 追加失败测试（chains）**

Append to `apps/server/tests/chains/chains.template.test.ts`：
```ts
describe('PATCH /api/chains/:id（spec §3.2、§8.3）', () => {
  it('body 带 template 键 → 400 TEMPLATE_IMMUTABLE（即使值相同）', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '日常', template: 'daily' });
    const chainId = create.body.id as string;
    const res = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ template: 'baby' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_IMMUTABLE');
  });

  it('改 payload：合法 200 生效；非法 400 CHAIN_PAYLOAD_INVALID；显式 null 清空', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby' });
    const chainId = create.body.id as string;

    const ok = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { birthdate: '2025-06-01' } });
    expect(ok.status).toBe(200);
    expect(ok.body.payload).toEqual({ birthdate: '2025-06-01' });

    const bad = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { birthdate: '06/01' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');

    const cleared = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.payload).toBeNull();
  });
});

describe('GET /api/chains/:id 内嵌 templateManifest（spec §3.2）', () => {
  it('详情含 templateManifest（baby 有 kinds 与 milestoneCatalog）；列表不含', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby' });
    const chainId = create.body.id as string;

    const detail = await request(app).get(`/api/chains/${chainId}`).set('Authorization', auth(owner));
    expect(detail.status).toBe(200);
    expect(detail.body.template).toBe('baby');
    expect(detail.body.templateManifest.kinds.map((k: { key: string }) => k.key)).toEqual(['milestone', 'metric']);
    expect(detail.body.templateManifest.milestoneCatalog.length).toBeGreaterThanOrEqual(5);

    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    const item = (list.body as { id: string; template: string }[]).find((c) => c.id === chainId)!;
    expect(item.template).toBe('baby');
    expect('templateManifest' in item).toBe(false);
  });
});
```

- [ ] **Step 2: 写失败测试（moments）**

Create `apps/server/tests/moments/moment-payload.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

const base = () => ({
  type: 'text' as const,
  content: '记录',
  happenedAt: new Date().toISOString(),
  happenedTzOffset: -480,
});

describe('moments kind/payload（spec §3.2）', () => {
  it('baby 链发 milestone → 201，响应带 kind/payload（serializer 唯一出口）', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { catalog_key: 'first-smile', note: '今天笑了' } });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('milestone');
    expect(res.body.payload).toEqual({ catalog_key: 'first-smile', note: '今天笑了' });
  });

  it('模板未声明的 kind → 400 MOMENT_PAYLOAD_INVALID', async () => {
    const chain = await createChain(app, owner, '日常');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { custom_label: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('daily 链 standard + mood：options 内 201；options 外 400', async () => {
    const chain = await createChain(app, owner, '日常');
    const ok = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '😄' } });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('standard');
    expect(ok.body.payload).toEqual({ mood: '😄' });

    const bad = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '🤯' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('travel 链 geo 通过；baby 链（无 momentFields）带 mood → 400', async () => {
    const travel = await createChain(app, owner, '旅行', 'travel');
    const ok = await request(app)
      .post(`/api/chains/${travel.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } } });
    expect(ok.status).toBe(201);

    const baby = await createChain(app, owner, '宝宝', 'baby');
    const bad = await request(app)
      .post(`/api/chains/${baby.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '😄' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('PATCH 合并校验：改 payload 非法 → 400；合法 → 200；改 kind 后按新 kind 校验', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    const create = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { catalog_key: 'first-smile' } });
    const momentId = create.body.id as string;

    const bad = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { note: '丢了标识' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');

    const ok = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { catalog_key: 'first-roll', note: '会翻身了' } });
    expect(ok.status).toBe(200);
    expect(ok.body.payload).toEqual({ catalog_key: 'first-roll', note: '会翻身了' });
  });

  it('既有行为不变：不带 kind/payload 的文本 moment → 201，kind=standard、payload=null', async () => {
    const chain = await createChain(app, owner, '日常');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send(base());
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('standard');
    expect(res.body.payload).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/chains/chains.template.test.ts tests/moments/moment-payload.test.ts`
Expected: FAIL（TEMPLATE_IMMUTABLE 未实现、templateManifest 未内嵌、MOMENT_PAYLOAD_INVALID 未接入等）。

- [ ] **Step 4: chains 更新与详情**

Modify `apps/server/src/chains/chains.controller.ts`——`update` 方法改为（controller 不判断角色，此处是契约键检测，非权限逻辑）：
```ts
  @Patch('/:chainId')
  @UseBefore(requireChainRole('owner'))
  update(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<ChainDto> {
    // template 创建后不可改（spec §3.2/§8.3）：updateChainInputSchema 不含 template 键会被 zod 静默剥离，
    // 必须在 parse 前检测原始 body
    if (body !== null && typeof body === 'object' && 'template' in body) {
      throw new BadRequestError('TEMPLATE_IMMUTABLE');
    }
    return this.chainService.update(user.id, chainId, updateChainInputSchema.parse(body));
  }
```
import 块从 `routing-controllers` 增加 `BadRequestError`。

Modify `apps/server/src/chains/chain.service.ts`：
- `update` 方法在 `await this.policy.require(userId, chainId, 'owner');` 后加：
  ```ts
    const [current] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!current) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    // payload 显式出现在输入里才校验/写入（undefined = 不动；null = 清空，validateChainPayload 放行 null）
    let payloadSet: { payload?: Record<string, unknown> | null } = {};
    if (input.payload !== undefined) {
      const template = await this.templates.getByKey(current.template);
      payloadSet = { payload: validateChainPayload(template.manifest, input.payload) };
    }
  ```
  `.set({...})` 内 `...(input.icon !== undefined ? { icon: input.icon } : {}),` 后加 `...payloadSet,`。
- `getById` 改为返回 `ChainDetailDto`：方法签名改 `Promise<ChainDetailDto>`，`return dto;` 前改为：

  > 行为声明（评审 S3）：`create` / `update` / `transfer` 的响应都经 `getById` 组装，因此同样内嵌 `templateManifest`——与 spec §3.2「链详情里内嵌」的措辞有出入（spec 只点名详情接口），但属无害超集（`ChainDetailDto ⊃ ChainDto`，客户端按 ChainDto 消费不受影响），在此声明不回改。
  ```ts
    // 详情内嵌模板 manifest（spec §3.2）；getByKey 任意 status 可读——archived 模板的存量链照常展示
    const template = await this.templates.getByKey(chain.template);
    return { ...dto, templateManifest: template.manifest };
  ```
  import 块从 `@moment/dto` 的类型列表加 `ChainDetailDto`。

- [ ] **Step 5: moments 接入 + serializer**

Modify `apps/server/src/moments/moment-serializer.ts`：
- `MomentLike` 接口 `type` 行后加：
  ```ts
  kind: string;
  payload: Record<string, unknown> | null;
  ```
- `momentSerializer` 返回对象 `type: m.type,` 后加：
  ```ts
    kind: m.kind,
    payload: m.payload,
  ```

Modify `apps/server/tests/moments/moment-serializer.test.ts`——该文件 L3–13 只有一个基础 `moment` 字面量（其余两处调用均为 `{ ...moment, ... }` spread，自动继承新字段），在其 `type: 'media' as const,` 行后加：
```ts
  kind: 'standard',
  payload: null,
```
（spread 用法 `{ ...moment, type: 'text', content: 'hi' }` 无需改动。）

Modify `apps/server/src/moments/moment.service.ts`：
- import 块加：
  ```ts
  import { chains } from '../db/schema.js'; // 合并进既有 schema import
  import { TemplateService } from '../templates/template.service.js';
  import { validateMomentPayload } from '../templates/payload-validator.js';
  ```
  （`chains` 并入既有 `from '../db/schema.js'` 的导入列表，不另起一行 import 路径。）
- 构造函数改为 `constructor(private readonly policy: ChainPolicy, private readonly templates: TemplateService) {}`
- 加私有方法：
  ```ts
  /** 取链模板 manifest（任意 status：archived 模板的存量链照常发布/编辑，spec §3.4）。 */
  private async manifestOf(chainId: string) {
    const [chain] = await db.select({ template: chains.template }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    return (await this.templates.getByKey(chain.template)).manifest;
  }
  ```
- `create`：在 `await this.policy.require(userId, chainId, 'editor');` 后加：
  ```ts
    const manifest = await this.manifestOf(chainId);
    const payload = validateMomentPayload(manifest, input.kind, input.payload ?? null);
  ```
  `tx.insert(moments).values({...})` 内 `type: input.type,` 后加 `kind: input.kind, payload,`。
- `update`：在 `if (m.authorId !== userId) throw new ForbiddenError('NOT_MOMENT_AUTHOR');` 后加：
  ```ts
    // kind/payload 合并校验（spec §3.2）：任一变更即按「合并后的有效值」整体校验——
    // 只改 payload 用既存 kind 校验，只改 kind 用既存 payload 校验。
    // 推论（评审 S4，P4/P5 继承此约束）：只改 kind 不改 payload 的 PATCH 会被拒——
    // 旧 payload 按新 kind 的 schema 校验不过；前端切 kind 时必须同时显式传 payload（新值或 null）。
    let kindPayloadSet: { kind?: string; payload?: Record<string, unknown> | null } = {};
    if (input.kind !== undefined || input.payload !== undefined) {
      const manifest = await this.manifestOf(m.chainId);
      const effectiveKind = input.kind ?? m.kind;
      const effectivePayload = input.payload !== undefined ? input.payload : m.payload;
      const payload = validateMomentPayload(manifest, effectiveKind, effectivePayload);
      kindPayloadSet = {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        payload,
      };
    }
  ```
  `.set({...})` 内 `...(input.isBackfill !== undefined ? { isBackfill: input.isBackfill } : {}),` 后加 `...kindPayloadSet,`。

- [ ] **Step 6: 运行确认通过 + 全量回归**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
```
Expected: 全绿——本 Task 新增 9 个（chains.template 追加 3 + moment-payload 6）；typecheck exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/chains/chain.service.ts apps/server/src/chains/chains.controller.ts apps/server/src/moments/moment.service.ts apps/server/src/moments/moment-serializer.ts apps/server/tests/moments/moment-serializer.test.ts apps/server/tests/chains/chains.template.test.ts apps/server/tests/moments/moment-payload.test.ts
git commit -m "feat(server): validate and persist template payloads on chains and moments"
```

---

### Task 5: 聚合视图端点 + 分享页数据

**Files:**
- Create: `apps/server/src/templates/aggregate.service.ts`、`apps/server/src/templates/aggregate.controller.ts`
- Modify: `apps/server/src/app.ts`（注册 controller）、`apps/server/src/share/share-link.service.ts`（分享响应附模板数据）
- Test: `apps/server/tests/templates/aggregate.test.ts`、`apps/server/tests/share/public-share-template.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AggregateResponse` / `aggregateQuerySchema` / 更新后的 `PublicShareResponse`；Task 3/4 落库的 kind/payload 数据；`requireChainRole`（CONVENTIONS §3.1）。
- Produces:
  - `GET /api/chains/:chainId/aggregate?view=&kind=&field=`（viewer 中间件）→ `AggregateResponse`
  - `AggregateService.project(chainId: string, manifest: TemplateManifest, query: AggregateQuery): Promise<AggregateResponse>`；`AggregateService.projectAll(chainId: string, manifest: TemplateManifest): Promise<AggregateResponse[]>`（分享页复用）
  - `GET /api/public/share/:token` 响应含 `template` / `templateManifest` / `aggregates`

- [ ] **Step 1: 写失败测试（聚合端点）**

Create `apps/server/tests/templates/aggregate.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';

const app = createApp();

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  viewer = await createUser(app, 'viewer@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

describe('GET /api/chains/:chainId/aggregate（spec §3.2）', () => {
  it('curve：metric 投影按 happenedAt 升序，软删剔除', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-03-01T08:00:00Z'), kind: 'metric', payload: { metric: 'height', value: 62, unit: 'cm' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-01-01T08:00:00Z'), kind: 'metric', payload: { metric: 'height', value: 55, unit: 'cm' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-02-01T08:00:00Z'), kind: 'metric', payload: { metric: 'weight', value: 7, unit: 'kg' }, deletedAt: new Date() });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'curve', kind: 'metric' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('curve');
    expect(res.body.points).toHaveLength(2); // 软删的 weight 被剔除
    expect(res.body.points[0]).toMatchObject({ metric: 'height', value: 55, unit: 'cm' });
    expect(res.body.points[1]).toMatchObject({ metric: 'height', value: 62 });
  });

  it('map：仅含 geo 的 standard moment 入投影', async () => {
    const chain = await createChain(app, owner, '旅行', 'travel');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-05-01T08:00:00Z'), payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-05-02T08:00:00Z') }); // 无 geo

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'map', field: 'geo' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    expect(res.body.points[0]).toMatchObject({ lat: 39.9, lng: 116.4, placeName: '北京' });
  });

  it('milestone-axis：catalog_key 解析 label/icon，custom_label 回退', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-04-01T08:00:00Z'), kind: 'milestone', payload: { catalog_key: 'first-smile', note: '笑了' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-04-02T08:00:00Z'), kind: 'milestone', payload: { custom_label: '第一次叫妈妈' } });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ label: '第一次微笑', icon: '😊', note: '笑了' });
    expect(res.body.items[1]).toMatchObject({ label: '第一次叫妈妈', icon: null, note: null });
  });

  it('moodline：按 wall_date 分组计数', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T09:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-02T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😭' } });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([
      { date: '2026-06-01', mood: '😄', count: 2 },
      { date: '2026-06-02', mood: '😭', count: 1 },
    ]);
  });

  it('未声明的视图 → 400 INVALID_AGGREGATE_VIEW；timeline 不走聚合端点', async () => {
    const chain = await createChain(app, owner, '日常'); // daily 只声明 moodline
    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'curve' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AGGREGATE_VIEW');

    const travel = await createChain(app, owner, '旅行', 'travel');
    const tl = await request(app)
      .get(`/api/chains/${travel.id}/aggregate`)
      .query({ view: 'timeline' })
      .set('Authorization', auth(owner));
    expect(tl.status).toBe(400);
    expect(tl.body.error.code).toBe('INVALID_AGGREGATE_VIEW');
  });

  it('viewer 可读 200；非成员 404 CHAIN_NOT_FOUND', async () => {
    const chain = await createChain(app, owner, '日常');
    await addMember(chain.id, viewer.id, 'viewer');
    const ok = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(viewer));
    expect(ok.status).toBe(200);

    const denied = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(outsider));
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('CHAIN_NOT_FOUND');

    // 未登录 401（@Authorized 与全仓链内 controller 一致）
    const anonymous = await request(app).get(`/api/chains/${chain.id}/aggregate`).query({ view: 'moodline' });
    expect(anonymous.status).toBe(401);
  });
});
```

- [ ] **Step 2: 写失败测试（分享页）**

Create `apps/server/tests/share/public-share-template.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

async function shareToken(chainId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', auth(owner))
    .send({});
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('GET /api/public/share/:token 模板数据（spec §3.2）', () => {
  it('baby 链：响应含 template/templateManifest/aggregates（milestone-axis + curve，无 timeline）', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date(), kind: 'milestone', payload: { catalog_key: 'first-steps' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date(), kind: 'metric', payload: { metric: 'height', value: 70, unit: 'cm' }, deletedAt: new Date() }); // 软删不进投影
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toBe('baby');
    expect(res.body.templateManifest.kinds).toHaveLength(2);
    const views = (res.body.aggregates as { view: string }[]).map((a) => a.view).sort();
    expect(views).toEqual(['curve', 'milestone-axis']);
    const axis = res.body.aggregates.find((a: { view: string }) => a.view === 'milestone-axis');
    expect(axis.items).toHaveLength(1);
    expect(axis.items[0].label).toBe('第一次走路');
    const curve = res.body.aggregates.find((a: { view: string }) => a.view === 'curve');
    expect(curve.points).toHaveLength(0); // 唯一 metric 已软删
  });

  it('daily 链：aggregates 仅 moodline；manifest 随模板给出', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toBe('daily');
    expect((res.body.aggregates as { view: string }[]).map((a) => a.view)).toEqual(['moodline']);
    expect(res.body.aggregates[0].days).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/aggregate.test.ts tests/share/public-share-template.test.ts`
Expected: FAIL，路由 404 / 响应缺字段。

- [ ] **Step 4: 实现 AggregateService**

Create `apps/server/src/templates/aggregate.service.ts`：
```ts
import type {
  AggregateMapPoint,
  AggregateMilestoneItem,
  AggregateMoodlineDay,
  AggregateQuery,
  AggregateResponse,
  TemplateManifest,
  TemplateViewType,
} from '@moment/dto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { BadRequestError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { moments } from '../db/schema.js';

/** 聚合投影用的 moment 行（只取需要列；payload JSON 回表后 JS 投影，spec §7 容量假设内可接受） */
interface ProjRow {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  happenedAt: Date;
  wallDate: string;
}

@Service()
export class AggregateService {
  /** 单视图投影（聚合端点用）。视图必须在 manifest.views 声明；timeline 不走端点（Global Constraints）。 */
  async project(chainId: string, manifest: TemplateManifest, query: AggregateQuery): Promise<AggregateResponse> {
    const view = (manifest.views ?? []).find(
      (v) =>
        v.type === query.view &&
        (query.kind === undefined || v.source?.kind === query.kind) &&
        (query.field === undefined || v.source?.field === query.field),
    );
    if (!view || view.type === 'timeline') throw new BadRequestError('INVALID_AGGREGATE_VIEW');
    return this.projectView(chainId, manifest, view.type, view.source ?? {});
  }

  /** 该模板声明的全部聚合投影（分享页用）；timeline 除外（前端用 moments 列表 + groupBy 分章）。 */
  async projectAll(chainId: string, manifest: TemplateManifest): Promise<AggregateResponse[]> {
    const out: AggregateResponse[] = [];
    for (const v of manifest.views ?? []) {
      if (v.type === 'timeline') continue;
      out.push(await this.projectView(chainId, manifest, v.type, v.source ?? {}));
    }
    return out;
  }

  private async rowsOf(chainId: string, kind?: string): Promise<ProjRow[]> {
    return db
      .select({
        id: moments.id,
        kind: moments.kind,
        payload: moments.payload,
        happenedAt: moments.happenedAt,
        wallDate: moments.wallDate,
      })
      .from(moments)
      .where(
        and(
          eq(moments.chainId, chainId),
          isNull(moments.deletedAt),
          kind !== undefined ? eq(moments.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(moments.happenedAt), asc(moments.id));
  }

  private async projectView(
    chainId: string,
    manifest: TemplateManifest,
    type: TemplateViewType,
    source: { kind?: string; field?: string },
  ): Promise<AggregateResponse> {
    switch (type) {
      case 'curve': {
        const rows = await this.rowsOf(chainId, source.kind);
        // 脏行防御（评审 S5）：payload 缺 metric 的跳过——写入侧已校验，此处只防历史/手工脏数据
        const points = rows
          .filter((r) => r.payload?.metric !== undefined)
          .map((r) => ({
            happenedAt: r.happenedAt.toISOString(),
            metric: String(r.payload!.metric),
            value: Number(r.payload!.value),
            unit: String(r.payload!.unit),
          }));
        return { view: 'curve', points };
      }
      case 'map': {
        const field = source.field ?? 'geo';
        const rows = await this.rowsOf(chainId, 'standard');
        const points: AggregateMapPoint[] = [];
        for (const r of rows) {
          const geo = r.payload?.[field] as { lat?: number; lng?: number; place_name?: string } | undefined;
          if (!geo || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') continue;
          points.push({
            momentId: r.id,
            happenedAt: r.happenedAt.toISOString(),
            lat: geo.lat,
            lng: geo.lng,
            placeName: geo.place_name ?? null,
          });
        }
        return { view: 'map', points };
      }
      case 'milestone-axis': {
        const rows = await this.rowsOf(chainId, source.kind);
        const catalog = new Map((manifest.milestoneCatalog ?? []).map((c) => [c.key, c]));
        const items: AggregateMilestoneItem[] = rows.map((r) => {
          const catalogKey = r.payload?.catalog_key as string | undefined;
          const hit = catalogKey ? catalog.get(catalogKey) : undefined;
          return {
            momentId: r.id,
            happenedAt: r.happenedAt.toISOString(),
            label: hit?.label ?? (r.payload?.custom_label as string | undefined) ?? catalogKey ?? '',
            icon: hit?.icon ?? null,
            note: (r.payload?.note as string | undefined) ?? null,
          };
        });
        return { view: 'milestone-axis', items };
      }
      case 'moodline': {
        const field = source.field ?? 'mood';
        const rows = await this.rowsOf(chainId, 'standard');
        const counts = new Map<string, number>(); // `${date}${mood}` → count
        for (const r of rows) {
          const mood = r.payload?.[field];
          if (typeof mood !== 'string') continue;
          const key = `${r.wallDate}${mood}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const days: AggregateMoodlineDay[] = [...counts.entries()].map(([key, count]) => {
          const [date, mood] = key.split('');
          return { date, mood, count };
        });
        return { view: 'moodline', days };
      }
      default:
        throw new BadRequestError('INVALID_AGGREGATE_VIEW');
    }
  }
}
```

- [ ] **Step 5: 实现 controller 并注册**

Create `apps/server/src/templates/aggregate.controller.ts`：
```ts
import { aggregateQuerySchema, type AggregateResponse } from '@moment/dto';
import { Authorized, Get, JsonController, NotFoundError, Param, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { eq } from 'drizzle-orm';
import { requireChainRole } from '../chains/require-chain-role.js';
import { db } from '../db/index.js';
import { chains } from '../db/schema.js';
import { AggregateService } from './aggregate.service.js';
import { TemplateService } from './template.service.js';

@JsonController('/chains')
@Service()
@Authorized()
export class AggregateController {
  constructor(
    private readonly aggregates: AggregateService,
    private readonly templates: TemplateService,
  ) {}

  /** 聚合视图投影（spec §3.2）：viewer 可读（成员资格由中间件保证，无需 CurrentUser）；archived 模板的存量链照常（getByKey 任意 status）。 */
  @Get('/:chainId/aggregate')
  @UseBefore(requireChainRole('viewer'))
  async aggregate(
    @Param('chainId') chainId: string,
    @QueryParams() query: unknown,
  ): Promise<AggregateResponse> {
    const q = aggregateQuerySchema.parse(query);
    const [chain] = await db.select({ template: chains.template }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // 中间件已保证成员资格，防御性兜底
    const manifest = (await this.templates.getByKey(chain.template)).manifest;
    return this.aggregates.project(chainId, manifest, q);
  }
}
```

Modify `apps/server/src/app.ts`：
- import 区追加 `import { AggregateController } from './templates/aggregate.controller.js';`
- `controllers: [...]` 数组末尾（`PublicShareController` 之后）追加 `AggregateController`。

- [ ] **Step 6: 分享页附模板数据**

Modify `apps/server/src/share/share-link.service.ts`：
- import 块加：
  ```ts
  import { AggregateService } from '../templates/aggregate.service.js';
  import { TemplateService } from '../templates/template.service.js';
  ```
- 构造函数改为：
  ```ts
  constructor(
    private readonly policy: ChainPolicy,
    private readonly templates: TemplateService,
    private readonly aggregates: AggregateService,
  ) {}
  ```
- `getSharedChain` 中 chain 查询改为取模板列：
  ```ts
    const [chain] = await db
      .select({ name: chains.name, description: chains.description, template: chains.template })
      .from(chains)
      .where(eq(chains.id, link.chainId))
      .limit(1);
  ```
- return 改为：
  ```ts
    const manifest = (await this.templates.getByKey(chain.template)).manifest;
    return {
      chain: { name: chain.name, description: chain.description },
      template: chain.template,
      templateManifest: manifest,
      aggregates: await this.aggregates.projectAll(link.chainId, manifest),
      moments: await serializeMoments(page.rows),
      nextCursor: page.nextCursor,
    };
  ```

- [ ] **Step 7: 运行确认通过 + 全量回归**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
pnpm --filter @moment/server lint
```
Expected: 全绿——本 Task 新增 8 个（aggregate 6 + public-share-template 2）；typecheck/lint exit 0。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/templates/aggregate.service.ts apps/server/src/templates/aggregate.controller.ts apps/server/src/app.ts apps/server/src/share/share-link.service.ts apps/server/tests/templates/aggregate.test.ts apps/server/tests/share/public-share-template.test.ts
git commit -m "feat(server): add aggregate views and share-page template data"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（fail 0；不写死总数，防随上游与既有用例漂移），`pnpm --filter @moment/dto build` exit 0
- [ ] `pnpm --filter @moment/server test` 全绿（既有 + 本计划新增 30 个：Task 2 七、Task 3 六、Task 4 九、Task 5 八——新增数以各 Task Step 内 it/test 块为准，若有出入以实际为准并在完工报告说明），`typecheck` / `lint` exit 0
- [ ] `drizzle/0010_*.sql` 为三阶段迁移（chains.template NULL→回填 daily→NOT NULL），`pnpm --filter @moment/server migrate` exit 0
- [ ] spec §8 breaking 清单逐项落实：POST /chains 必传 template（旧调用 400）；Chain/Moment DTO 增字段；PATCH 改 template → TEMPLATE_IMMUTABLE
- [ ] 执行 prompt T3 Produces 逐个可解析：`validateChainPayload` / `validateMomentPayload` / `MOMENT_PAYLOAD_INVALID` / `TEMPLATE_IMMUTABLE` / 链详情内嵌 `templateManifest` / serializer 带 kind+payload
- [ ] 执行 prompt T4 Produces 逐个可解析：`GET /api/chains/:chainId/aggregate` 四种投影 + `INVALID_AGGREGATE_VIEW`；`GET /api/public/share/:token` 附 templateManifest + aggregates
- [ ] spec §6 属 P3 的测试项：分发校验矩阵（Task 2/4）、迁移回填（Task 3）、聚合投影含软删剔除与 viewer/非成员（Task 5）
