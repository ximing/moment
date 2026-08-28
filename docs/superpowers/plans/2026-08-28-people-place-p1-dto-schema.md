# 时刻人物与地点 P1：dto persons 域 + server schema 两表五列 + 迁移 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的跨端契约与数据基座：`@moment/dto` 新建 persons 域（personIds/place 请求 schema、PersonBrief、词典响应类型、persons CRUD 请求 schema），moments dto 增量（create/patch 加 personIds/place、MomentResponse 加 persons/place）；server 侧新建 `persons` / `moment_persons` 两表、`moments` 加五列（place_lat/place_lng/place_name/place_source/ai_extract_hash），drizzle-kit 生成迁移并在测试库应用，resetDb()/fixtures 同步扩展，触库冒烟测试钉死。

**Architecture:** dto 包只放 schema 与纯类型推导（`packages/dto/CLAUDE.md` 硬约束），单文件布局（test glob 只匹配 `src/*.test.ts`）。server 数据表定义放 `src/db/schema/`，经 `src/db/schema.ts` barrel 导出；迁移由 `drizzle-kit generate` 从 meta snapshot 差分生成（**禁手写 SQL**），`pnpm --filter @moment/server migrate` 应用。`persons`/`moment_persons` 完整镜像 `tags`/`moment_tags` 范式（链级词典 + 多对多关联 + FK 不写 onDelete）。source 只能 server 赋值，客户端请求契约内**不含** source 字段。

**Tech Stack:** zod ^3.22（勿用 v4 API）/ tsx --test（node:test）/ drizzle-orm 0.45 mysql-core / drizzle-kit 0.31 / jest + 真实 MySQL 测试库。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§2 数据模型、§6 API 设计、§8 隐私红线、§9 测试策略、§11 P1 出口标准）

## Global Constraints

- 执行编排 T1 契约：`docs/superpowers/prompts/2026-08-28-people-place-execution.md`；下列符号名逐字不得改（P2–P7 计划靠此对齐）：`MOMENT_PERSON_SOURCES` / `MomentPersonSource` / `PLACE_SOURCES` / `PlaceSource` / `momentPersonIdsSchema` / `MomentPersonIds` / `placeInputSchema` / `PlaceInput` / `personCreateInputSchema` / `PersonCreateInput` / `personPatchInputSchema` / `PersonPatchInput` / `PersonBrief` / `MomentPlace` / `PersonResponse` / `PersonListResponse` / `persons` / `Person` / `NewPerson` / `momentPersons` / `MomentPerson`。
- 索引严格按 spec §2：只建 `uk_persons_chain_name (chain_id, name)` 与 `idx_moment_persons_person_moment (person_id, moment_id)`；**不加** place 索引、**不另建** `persons(chain_id)` 索引（uk 左前缀已覆盖）。
- PATCH 语义是 schema 层契约：`personIds`/`place` 缺省 undefined = 不变；`place: null` = 显式清除；`personIds: []` = 清空全部人物。zod 代码注释必须逐字体现（客户端 dirty tracking 纪律靠注释传承到 P5/P6）。
- 触库测试打 `.env` 指向的远程共享测试库：`--runInBand`、`afterAll(closeDb)`、禁止两个 jest 会话并行（连接可能瞬时 ECONNRESET，重试即可）；严禁生产库。
- 每 Task 一个 commit（conventional commits）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **`place_lat`/`place_lng` 的 drizzle 列模式定为 `mode: 'number'`**：spec §2 只定 SQL 类型 `decimal(10,7)`；drizzle `decimal` 默认 `mode: 'string'`（读写均为 string）。本计划显式用 `mode: 'number'`——decimal(10,7) 共 10 位有效数字，远在 double 精度（15–16 位）内，读写免转换，P2 序列化直接出 number。这是对 spec 未覆盖实现细节的钉死（呼应 spec §6 响应 `place: {lat, lng, ...}` 为数值语义），非设计发明。
2. **`MomentResponse.persons/place` 在 P1 声明为可选（`persons?: PersonBrief[]`、`place?: MomentPlace | null`），必填化随 P2 的 includePrivate/批取序列化一并收紧（serializer 在 P2 owner 范围内）**：spec §6 要求字段存在，但 server 的 `momentSerializer()`（`apps/server/src/moments/moment-serializer.ts`）在 P1 不产出这两个字段——必填会让 server typecheck（Task 3/5 门禁）与全量 jest（ts-jest 类型诊断）立即红；且 web 端 `apps/web/src/lib/memories.test.ts`、`apps/web/src/pages/timeline-variants.test.tsx` 构造完整 `MomentResponse` 字面量，必填也会破根 `pnpm build`。另有 §8 红线：share-album 输出**不含**这两个字段（机制：`serializeMoments` 的 `includePrivate` 默认 false），而 dto 现状 `share.ts` 复用 `MomentResponse`（`moments: MomentResponse[]`），字段必填会使公开分享类型与运行时输出不符。P1 不改 `share.ts` 与 serializer（均不在 T1 owner 文件清单内），偏差收口给 P2：P2 在实施 includePrivate 时收紧公开侧类型（建议 `PublicShareMoment = Omit<MomentResponse, 'persons' | 'place'>` 或等效）并把 persons/place 必填化，用双路序列化测试钉死（spec §9）。
3. **`PersonResponse` 严格按 spec §6 字面只含 `{id, name, userId}`**：不镜像 `TagResponse` 的 `createdAt`/`momentCount`（spec 未要求，词典行无 source 概念）。
4. **create 同样接受 `place: null`**：spec §6 把 `place?: {...} | null` 同时挂在 `CreateMomentInput` / `PatchMomentInput` 下，清除语义只对 PATCH 有意义；create 上 `null` 等价未传（无既有状态可清除），zod 注释钉死，行为无歧义。
5. **place 的 `name` 不做 trim**：spec §6 字面约束 `string(1..255)`，名归一化条款（trim + 去内部连续空白，spec §2）仅约束**人物词典名**。`personCreateInputSchema`/`personPatchInputSchema` 的 name 做 trim（镜像 `tagCreateInputSchema` 既有范式），去内部空白留 server 应用层（P2）。

---

### Task 1: dto persons 域文件（词表 + personIds/place schema + CRUD 请求 schema + 响应类型 + barrel）

**Files:**
- Create: `packages/dto/src/persons.ts`
- Test: `packages/dto/src/persons.test.ts`
- Modify: `packages/dto/src/index.ts`（barrel 加一行）

**Interfaces:**
- Consumes: 无（首批 persons 域代码；zod ^3.22）。
- Produces:
  - `MOMENT_PERSON_SOURCES`（`['manual','ai'] as const`）、`type MomentPersonSource`
  - `PLACE_SOURCES`（`['manual','exif','ai'] as const`）、`type PlaceSource`
  - `momentPersonIdsSchema`（`z.array(z.string().uuid()).max(20)`）、`type MomentPersonIds`
  - `placeInputSchema`（strict：拒绝 source 等未知键；refine：lat/lng 同有同无、name 与坐标至少其一，违规 message = `PLACE_COORDS_INVALID`）、`type PlaceInput`
  - `personCreateInputSchema`（`{name: trim 1..50, userId?: uuid}`）、`type PersonCreateInput`
  - `personPatchInputSchema`（`{name: trim 1..50}`）、`type PersonPatchInput`
  - `interface PersonBrief`（`{id: string; name: string; userId: string | null; source: MomentPersonSource}`）
  - `interface MomentPlace`（`{lat: number | null; lng: number | null; name: string | null; source: PlaceSource}`）
  - `interface PersonResponse`（`{id: string; name: string; userId: string | null}`）
  - `interface PersonListResponse`（`{persons: PersonResponse[]}`）

- [ ] **Step 1: 写失败测试**

Create `packages/dto/src/persons.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MOMENT_PERSON_SOURCES,
  PLACE_SOURCES,
  momentPersonIdsSchema,
  personCreateInputSchema,
  personPatchInputSchema,
  placeInputSchema,
  type MomentPlace,
  type PersonBrief,
  type PersonListResponse,
  type PersonResponse,
} from './persons.js';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

test('MOMENT_PERSON_SOURCES / PLACE_SOURCES 词表锁定（spec §2）', () => {
  assert.deepEqual([...MOMENT_PERSON_SOURCES], ['manual', 'ai']);
  assert.deepEqual([...PLACE_SOURCES], ['manual', 'exif', 'ai']);
});

test('momentPersonIdsSchema：合法 uuid 数组通过，上限 20', () => {
  assert.deepEqual(momentPersonIdsSchema.parse([UUID_A, UUID_B]), [UUID_A, UUID_B]);
  assert.equal(momentPersonIdsSchema.parse([]).length, 0);
  assert.equal(momentPersonIdsSchema.parse(Array.from({ length: 20 }, () => UUID_A)).length, 20);
  assert.throws(() => momentPersonIdsSchema.parse(Array.from({ length: 21 }, () => UUID_A)));
});

test('momentPersonIdsSchema：非 uuid 拒绝', () => {
  assert.throws(() => momentPersonIdsSchema.parse(['not-a-uuid']));
  assert.throws(() => momentPersonIdsSchema.parse([123]));
});

test('placeInputSchema：仅名字合法（manual 文本路）', () => {
  assert.deepEqual(placeInputSchema.parse({ name: '外婆家' }), { name: '外婆家' });
});

test('placeInputSchema：仅坐标合法（EXIF 路，spec §3/§6）', () => {
  assert.deepEqual(placeInputSchema.parse({ lat: 39.9042, lng: 116.4074 }), {
    lat: 39.9042,
    lng: 116.4074,
  });
});

test('placeInputSchema：名字 + 坐标合法（地图选点/确认形态）', () => {
  assert.deepEqual(placeInputSchema.parse({ name: '北京', lat: 39.9, lng: 116.4 }), {
    name: '北京',
    lat: 39.9,
    lng: 116.4,
  });
});

test('placeInputSchema：空对象拒绝（name 与坐标至少其一，spec §6）', () => {
  assert.throws(() => placeInputSchema.parse({}));
});

test('placeInputSchema：lat/lng 必须同有同无（spec §6）', () => {
  assert.throws(() => placeInputSchema.parse({ lat: 39.9 }));
  assert.throws(() => placeInputSchema.parse({ lng: 116.4 }));
  assert.throws(() => placeInputSchema.parse({ name: '北京', lat: 39.9 }));
  assert.throws(() => placeInputSchema.parse({ name: '北京', lng: 116.4 }));
});

test('placeInputSchema：坐标范围边界（lat ∈ [-90,90]、lng ∈ [-180,180]）', () => {
  assert.ok(placeInputSchema.safeParse({ lat: 90, lng: 180 }).success);
  assert.ok(placeInputSchema.safeParse({ lat: -90, lng: -180 }).success);
  assert.ok(!placeInputSchema.safeParse({ lat: 90.0000001, lng: 0 }).success);
  assert.ok(!placeInputSchema.safeParse({ lat: -90.0000001, lng: 0 }).success);
  assert.ok(!placeInputSchema.safeParse({ lat: 0, lng: 180.0000001 }).success);
  assert.ok(!placeInputSchema.safeParse({ lat: 0, lng: -180.0000001 }).success);
});

test('placeInputSchema：name 长度 1..255（spec §6）', () => {
  assert.ok(placeInputSchema.safeParse({ name: '北' }).success);
  assert.ok(placeInputSchema.safeParse({ name: 'x'.repeat(255) }).success);
  assert.ok(!placeInputSchema.safeParse({ name: '' }).success);
  assert.ok(!placeInputSchema.safeParse({ name: 'x'.repeat(256) }).success);
});

test('placeInputSchema：strict 拒绝未知键——source 只由 server 赋值，不得混入请求（spec §3/§6）', () => {
  assert.throws(() => placeInputSchema.parse({ name: 'x', source: 'ai' }));
  assert.throws(() => placeInputSchema.parse({ lat: 39.9, lng: 116.4, source: 'exif' }));
});

test('personCreateInputSchema：trim 名称、userId 可选（spec §6 POST）', () => {
  const input = personCreateInputSchema.parse({ name: '  外婆  ' });
  assert.equal(input.name, '外婆');
  assert.equal(input.userId, undefined);
  const linked = personCreateInputSchema.parse({ name: '爸爸', userId: UUID_A });
  assert.equal(linked.userId, UUID_A);
});

test('personCreateInputSchema：空名/超长名/非法 userId 拒绝', () => {
  assert.throws(() => personCreateInputSchema.parse({ name: '   ' }));
  assert.throws(() => personCreateInputSchema.parse({ name: 'x'.repeat(51) }));
  assert.throws(() => personCreateInputSchema.parse({ name: '爸爸', userId: 'not-a-uuid' }));
});

test('personPatchInputSchema：trim 名称（spec §6 PATCH 改名）', () => {
  assert.equal(personPatchInputSchema.parse({ name: ' 姥姥 ' }).name, '姥姥');
  assert.throws(() => personPatchInputSchema.parse({ name: '' }));
  assert.throws(() => personPatchInputSchema.parse({ name: 'x'.repeat(51) }));
});

test('PersonBrief / MomentPlace / PersonResponse / PersonListResponse 类型可赋值', () => {
  const brief: PersonBrief = { id: UUID_A, name: '外婆', userId: null, source: 'ai' };
  assert.equal(brief.source, 'ai');
  const manual: PersonBrief = { id: UUID_B, name: '爸爸', userId: UUID_A, source: 'manual' };
  assert.equal(manual.userId, UUID_A);

  // 三种合法 place 形态（spec §6 赋值表）
  const exifPlace: MomentPlace = { lat: 39.9042, lng: 116.4074, name: null, source: 'exif' };
  const manualPlace: MomentPlace = { lat: null, lng: null, name: '外婆家', source: 'manual' };
  const aiPlace: MomentPlace = { lat: null, lng: null, name: '北京', source: 'ai' };
  assert.equal(exifPlace.name, null);
  assert.equal(manualPlace.lat, null);
  assert.equal(aiPlace.source, 'ai');

  const person: PersonResponse = { id: UUID_A, name: '外婆', userId: null };
  const list: PersonListResponse = { persons: [person] };
  assert.equal(list.persons.length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`Cannot find module './persons.js'`（或等效模块解析错误）。

- [ ] **Step 3: 实现 `persons.ts`**

Create `packages/dto/src/persons.ts`：
```ts
import { z } from 'zod';

// ---------- 来源词表（spec §2：moment_persons.source / moments.place_source） ----------

/** moment_persons.source：manual = 用户手动关联；ai = AI 抽取补缺（spec §2/§5，manual 不降级、ai 仅补缺） */
export const MOMENT_PERSON_SOURCES = ['manual', 'ai'] as const;
export type MomentPersonSource = (typeof MOMENT_PERSON_SOURCES)[number];

/** moments.place_source：优先级 manual > exif > ai（spec §0/§6 赋值表） */
export const PLACE_SOURCES = ['manual', 'exif', 'ai'] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

// ---------- 请求 schema（spec §6） ----------

/**
 * moment 关联人物 id 集（uuid，max 20，spec §6）。
 * PATCH 语义 = 全量替换（与 tagIds 对齐）：提交的集合写 source=manual，集合外原有行删除；
 * 缺省 undefined = 不变。属链校验（400 PERSON_NOT_IN_CHAIN）是 server 职责。
 */
export const momentPersonIdsSchema = z.array(z.string().uuid()).max(20);
export type MomentPersonIds = z.infer<typeof momentPersonIdsSchema>;

/**
 * 地点输入（spec §6）：
 * - name 可选，string(1..255)（spec 字面，不做 trim——名归一化条款仅约束人物词典名）
 * - lat ∈ [-90, 90]、lng ∈ [-180, 180]（WGS-84，客户端坐标是不可信输入，spec §3）
 * - lat/lng 必须同有同无
 * - name 与坐标至少其一
 * 违反任一规则 → 400 PLACE_COORDS_INVALID。
 * strict：未知键（含 source）拒绝而非静默 strip——source 不在请求契约内：由 server 按赋值表判定
 * （坐标+名字→manual / 仅坐标→exif / 仅名字→manual），防止伪造 source 绕过优先级规则（spec §3 信任边界）。
 */
export const placeInputSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasLat = val.lat !== undefined;
    const hasLng = val.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PLACE_COORDS_INVALID',
        path: [hasLat ? 'lng' : 'lat'],
      });
    }
    if (val.name === undefined && !hasLat && !hasLng) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PLACE_COORDS_INVALID' });
    }
  });
export type PlaceInput = z.infer<typeof placeInputSchema>;

/**
 * 新建 person 词典行（POST /api/chains/:chainId/persons，spec §6）。
 * trim 镜像 tagCreateInputSchema；名归一化的「去内部连续空白」在 server 应用层（spec §2），不在 dto。
 * 名归一化撞 uk_persons_chain_name → server 返回已存在行（幂等创建）。
 */
export const personCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  /** 可选链接到链成员用户（"爸爸"就是注册用户，spec §2 user_id），供 M3 查询 */
  userId: z.string().uuid().optional(),
});
export type PersonCreateInput = z.infer<typeof personCreateInputSchema>;

/** 改名（PATCH /api/chains/:chainId/persons/:personId，spec §6）；撞名归一化 → 409 PERSON_NAME_CONFLICT（server 职责） */
export const personPatchInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
export type PersonPatchInput = z.infer<typeof personPatchInputSchema>;

// ---------- 响应类型（spec §6） ----------

/** moment 上下文中的 person 视图；source 取自 moment_persons 关联行（词典行本身无 source 概念） */
export interface PersonBrief {
  id: string;
  name: string;
  /** 链接的链成员用户；未链接为 null */
  userId: string | null;
  source: MomentPersonSource;
}

/**
 * moment 响应中的地点（spec §6）。三个值列可空（仅名字 / 仅坐标均为合法形态，§6 赋值表），
 * source 非空；place 整体为 null 表示无地点（三列 + source 同生同灭）。
 */
export interface MomentPlace {
  /** WGS-84 原值（spec §4：DB 落原值，GCJ-02 换算只在调高德时发生） */
  lat: number | null;
  lng: number | null;
  /** 展示名（逆地理回填或手动/AI 文本）；exif 坐标待回填时为 null */
  name: string | null;
  source: PlaceSource;
}

/** 链 person 词典条目（GET /api/chains/:chainId/persons，spec §6 字面：{id, name, userId}） */
export interface PersonResponse {
  id: string;
  name: string;
  userId: string | null;
}

export interface PersonListResponse {
  persons: PersonResponse[];
}
```

- [ ] **Step 4: 接 barrel 导出**

Modify `packages/dto/src/index.ts` — 在 `export * from './recaps.js';` 之后追加一行：
```ts
export * from './persons.js';
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，persons.test.ts 15 个测试全过（moments.test.ts 等既有测试无回归）。

- [ ] **Step 6: 构建确认类型可生成**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/persons.ts packages/dto/src/persons.test.ts packages/dto/src/index.ts
git commit -m "feat(dto): add persons domain schemas and place input contract"
```

---

### Task 2: dto moments 增量（create/patch 加 personIds/place + MomentResponse 加 persons/place）

**Files:**
- Modify: `packages/dto/src/moments.ts`
- Test: `packages/dto/src/moments.test.ts`

**Interfaces:**
- Consumes:
  - `momentPersonIdsSchema` / `placeInputSchema` / `type PlaceInput` / `type PersonBrief` / `type MomentPlace`（Task 1，`./persons.js`）
  - 既有 `createMomentInputSchema` / `patchMomentInputSchema` / `MomentResponse`（`./moments.js`，原地扩展不改名）
- Produces:
  - `CreateMomentInput` 增加 `personIds?: string[]`、`place?: PlaceInput | null`
  - `PatchMomentInput` 增加 `personIds?: string[]`、`place?: PlaceInput | null`
  - `MomentResponse` 增加 `persons?: PersonBrief[]`、`place?: MomentPlace | null`（P1 可选，见偏差 2）

- [ ] **Step 1: 写失败测试（追加到既有 moments.test.ts）**

Modify `packages/dto/src/moments.test.ts` — 文件头 import 行替换为：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMomentInputSchema,
  listMomentsQuerySchema,
  patchMomentInputSchema,
  type MomentResponse,
} from './moments.js';
```
（`listMomentsQuerySchema` 既有引用保留；新增 `type MomentResponse`。）

文件末尾追加：
```ts
const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

test('createMomentInputSchema：接受 personIds 与 place（spec §6）', () => {
  const r = createMomentInputSchema.safeParse({
    ...base,
    personIds: [UUID_A, UUID_B],
    place: { name: '北京', lat: 39.9, lng: 116.4 },
  });
  assert.ok(r.success);
});

test('createMomentInputSchema：place 仅坐标合法（EXIF 路）；place:null 在 create 等价未传（spec §6）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, place: { lat: 39.9, lng: 116.4 } }).success);
  assert.ok(createMomentInputSchema.safeParse({ ...base, place: null }).success);
});

test('createMomentInputSchema：personIds 超 20 / 非 uuid 拒绝', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, personIds: Array.from({ length: 21 }, () => UUID_A) }).success
  );
  assert.ok(!createMomentInputSchema.safeParse({ ...base, personIds: ['not-a-uuid'] }).success);
});

test('createMomentInputSchema：place 缺一半坐标 / 空对象拒绝（PLACE_COORDS_INVALID）', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, place: { lat: 39.9 } }).success);
  assert.ok(!createMomentInputSchema.safeParse({ ...base, place: {} }).success);
});

test('patchMomentInputSchema：place:null 显式清除是合法非空 patch（spec §6）', () => {
  assert.ok(patchMomentInputSchema.safeParse({ place: null }).success);
});

test('patchMomentInputSchema：personIds 空数组 = 清空全部人物，合法非空 patch', () => {
  assert.ok(patchMomentInputSchema.safeParse({ personIds: [] }).success);
});

test('patchMomentInputSchema：personIds/place 全 undefined 仍 EMPTY_PATCH（缺省 = 不变，不是有效 patch）', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ personIds: undefined, place: undefined }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success);
});

test('patchMomentInputSchema：place 对象 refine 违规拒绝；未知键仍 strict 拒绝', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ place: { lng: 116.4 } }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ placeSource: 'manual' }).success); // source 只由 server 赋值
});

test('MomentResponse：含 persons/place 字段可赋值；P1 可省略（spec §6，见偏差 2）', () => {
  const res: MomentResponse = {
    id: UUID_A,
    chainId: UUID_B,
    author: { id: UUID_A, nickname: '爸爸', avatarUrl: null },
    type: 'media',
    content: '外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-28T12:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-28T12:00:00.000Z',
    media: [],
    tags: [],
    persons: [
      { id: UUID_A, name: '外婆', userId: null, source: 'ai' },
      { id: UUID_B, name: '爸爸', userId: UUID_A, source: 'manual' },
    ],
    place: { lat: 39.9042, lng: 116.4074, name: '北京市东城区', source: 'exif' },
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
  assert.equal(res.persons.length, 2);
  assert.equal(res.persons[0].source, 'ai');
  assert.equal(res.place!.source, 'exif');

  const noPlace: MomentResponse = { ...res, persons: [], place: null };
  assert.equal(noPlace.place, null);

  // P1 可选（偏差 2）：momentSerializer() 在 P1 不产出 persons/place，
  // 显式置 undefined 的字面量也必须通过类型检查（必填会破 server typecheck 与 web 测试）
  const legacy: MomentResponse = { ...res, persons: undefined, place: undefined };
  assert.equal(legacy.persons, undefined);
  assert.equal(legacy.place, undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，moments.test.ts 类型/断言错误（`MomentResponse` 缺 persons/place 时类型不符；`placeSource` strict 用例之外的 place 用例也可能因 schema 未接字段而失败——zod 默认 strip 未知键，故 personIds/place 用例在实现前静默剥离仍可能过，**类型用例是主要红灯**；确认 tsx 报类型错误或断言失败即可）。

注意：若 tsx --test 不做类型检查导致类型用例不红，红灯以前面 schema 用例中 `place: null` create 用例失败为准（现 schema 无 place 键，`place: null` 被 strip 后仍 success——此情况下允许以 `pnpm --filter @moment/dto build` 的 TS 报错作为红灯证据）。两路至少一路必须红，红后才进 Step 3。

- [ ] **Step 3: 实现 moments.ts 增量**

Modify `packages/dto/src/moments.ts`：

文件头 import 区，在 `import type { TagBrief } from './tags.js';` 之后追加一行：
```ts
import { momentPersonIdsSchema, placeInputSchema, type MomentPlace, type PersonBrief } from './persons.js';
```

`createMomentInputSchema` 的 object 内，在 `tagIds: momentTagIdsSchema.optional(),` 之后追加两行：
```ts
    /** 关联人物（spec §6）：提交即 manual 意图，server 做属链校验；create 缺省 = 无关联 */
    personIds: momentPersonIdsSchema.optional(),
    /** 地点（spec §6）：source 由 server 按赋值表判定（客户端不传 source）；create 上 null 等价未传（无既有状态可清除） */
    place: placeInputSchema.nullable().optional(),
```

`patchMomentInputSchema` 的 object 内，在 `tagIds: momentTagIdsSchema.optional(),` 之后追加：
```ts
    /**
     * PATCH 全量替换（与 tagIds 对齐，spec §6）：提交的集合写 source=manual，
     * 集合外原有行（manual 与 ai 一并）删除；空数组 [] = 清空全部人物。缺省 undefined = 不变——
     * 客户端 dirty tracking：仅用户实际增删过人物才提交本字段（否则整包回传会把 ai 行静默升级 manual）。
     */
    personIds: momentPersonIdsSchema.optional(),
    /**
     * PATCH 语义（spec §6）：undefined = 不变（dirty tracking：仅用户实际改过地点才提交）；
     * null = 显式清除 place 三列 + place_source；
     * 对象 = server 按赋值表定 source（坐标+名字→manual / 仅坐标→exif / 仅名字→manual）。
     */
    place: placeInputSchema.nullable().optional(),
```

`MomentResponse` 接口内，在 `tags: TagBrief[];` 之后追加：
```ts
  /**
   * moment 上的人物（含 AI 抽取行；source 取自 moment_persons 关联行）。
   * P1 声明为可选：momentSerializer() 在 P1 不产出本字段（见计划偏差 2），
   * 必填化随 P2 的 includePrivate/批取序列化一并收紧（serializer 在 P2 owner 范围内）。
   */
  persons?: PersonBrief[];
  /** 地点；无地点为 null。P1 同 persons 声明为可选（偏差 2），P2 一并必填化 */
  place?: MomentPlace | null;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，moments.test.ts 新增 9 个测试全过，既有 22 个无回归。

- [ ] **Step 5: 构建 + lint 确认**

Run: `pnpm --filter @moment/dto build && pnpm --filter @moment/dto lint`
Expected: exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/moments.ts packages/dto/src/moments.test.ts
git commit -m "feat(dto): extend moment create/patch/response with persons and place"
```

---

### Task 3: server schema 两表五列（persons + moment_persons + moments 五列 + barrel）

**Files:**
- Create: `apps/server/src/db/schema/persons.ts`
- Create: `apps/server/src/db/schema/moment-persons.ts`
- Modify: `apps/server/src/db/schema/moments.ts`（五列）
- Modify: `apps/server/src/db/schema.ts`（barrel 两行）

**Interfaces:**
- Consumes:
  - `chains`（`./chains.js`，`export const chains`）、`users`（`./users.js`，`export const users`）、`moments`（`./moments.js`）
  - drizzle-orm mysql-core：`char / varchar / timestamp / uniqueIndex / index / primaryKey / mysqlEnum / decimal`（既有依赖，版本 0.45.1）
- Produces:
  - `persons`（drizzle table）、`type Person = typeof persons.$inferSelect`、`type NewPerson = typeof persons.$inferInsert`
  - `momentPersons`（drizzle table）、`type MomentPerson = typeof momentPersons.$inferSelect`
  - `Moment` / `NewMoment` 增加：`placeLat: number | null`、`placeLng: number | null`、`placeName: string | null`、`placeSource: 'manual' | 'exif' | 'ai' | null`、`aiExtractHash: string | null`

- [ ] **Step 1: 写失败测试**

本 Task 的触库行为测试集中在 Task 5（冒烟测试一次钉死两表五列 + resetDb）。本 Task 的红灯 = **typecheck 红灯**：先执行 Step 2 确认当前基线绿，再写代码——表定义本身无独立单测载体（镜像 tags 范式：tags.ts 亦无 schema 单测，行为由触库测试覆盖）。

- [ ] **Step 2: 基线确认**

Run: `pnpm --filter @moment/server typecheck`
Expected: exit 0（改动前基线绿）。

- [ ] **Step 3: 实现 `schema/persons.ts`**

Create `apps/server/src/db/schema/persons.ts`：
```ts
import { char, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

/**
 * 人物词典（spec people-place §2，镜像 tags）：链级作用域。
 * 名归一化（trim + 去内部连续空白）在应用层，不写 DB 函数。
 * FK 不写 onDelete：链删除在 chain.service 删除 tx 内逐表 delete（镜像 tags 范式）。
 */
export const persons = mysqlTable(
  'persons',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    name: varchar('name', { length: 50 }).notNull(),
    /** 可选链接到链成员用户（"爸爸"就是注册用户），供 M3「爸爸发了哪些」类查询 */
    userId: char('user_id', { length: 36 }).references(() => users.id),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  // uk 左前缀已覆盖按 chain_id 过滤，不另建 (chain_id) 索引（与 tags 一致，spec §2）
  (t) => [uniqueIndex('uk_persons_chain_name').on(t.chainId, t.name)],
);

export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;
```

- [ ] **Step 4: 实现 `schema/moment-persons.ts`**

Create `apps/server/src/db/schema/moment-persons.ts`：
```ts
import { char, index, mysqlEnum, mysqlTable, primaryKey } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { persons } from './persons.js';

/**
 * moment ↔ person 关联（spec people-place §2，镜像 moment_tags）。
 * source=ai 的行被用户手动确认/重选后升级 manual（§5 冲突规则）；同行不允许两 source（PK 保证）。
 * FK 不写 onDelete：链删除 tx 需同步补本表 delete（镜像 tags 范式，P2 落实）。
 */
export const momentPersons = mysqlTable(
  'moment_persons',
  {
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    personId: char('person_id', { length: 36 })
      .notNull()
      .references(() => persons.id),
    source: mysqlEnum('source', ['manual', 'ai']).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.momentId, t.personId] }),
    // M2 按人物圈结果集的驱动索引（spec §2，语义同 idx_moment_tags_tag_moment）
    index('idx_moment_persons_person_moment').on(t.personId, t.momentId),
  ],
);

export type MomentPerson = typeof momentPersons.$inferSelect;
```

- [ ] **Step 5: moments 加五列**

Modify `apps/server/src/db/schema/moments.ts`：

import 行替换为（加 `decimal`）：
```ts
import { boolean, char, date, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
```

列定义内，在 `isBackfill: boolean('is_backfill').notNull().default(false),` 之后、`createdAt` 之前追加：
```ts
    /** 地点（spec people-place §2）：WGS-84 原值（EXIF/手动均为 WGS-84 或已换算，§4）。
        place 三列 + place_source 同生同灭（§6 清除语义）。v1 不加 place 索引（§2/§10）。
        mode:'number'：decimal(10,7) 共 10 位有效数字，远在 double 精度内，读写免转换 */
    placeLat: decimal('place_lat', { precision: 10, scale: 7, mode: 'number' }),
    placeLng: decimal('place_lng', { precision: 10, scale: 7, mode: 'number' }),
    /** 展示名（逆地理编码回填或手动/AI 文本） */
    placeName: varchar('place_name', { length: 255 }),
    placeSource: mysqlEnum('place_source', ['manual', 'exif', 'ai']),
    /** 上次 AI 抽取时 sha256(content + '\0' + transcript)（spec §5 幂等判据）；NULL = 从未抽取 */
    aiExtractHash: char('ai_extract_hash', { length: 64 }),
```

- [ ] **Step 6: 接 barrel**

Modify `apps/server/src/db/schema.ts` — 在 `export * from './schema/recaps.js';` 之后追加两行：
```ts
export * from './schema/persons.js';
export * from './schema/moment-persons.js';
```

- [ ] **Step 7: typecheck 确认通过**

Run: `pnpm --filter @moment/server typecheck`
Expected: exit 0。`Moment` 类型含五列（`placeLat: number | null` 等）——可在 Step 8 的 smoke 写法验证前用 `pnpm --filter @moment/server exec tsc --noEmit` 等效确认（同一命令，任选其一）。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/db/schema/persons.ts apps/server/src/db/schema/moment-persons.ts apps/server/src/db/schema/moments.ts apps/server/src/db/schema.ts
git commit -m "feat(server): add persons/moment_persons tables and moments place columns"
```

---

### Task 4: drizzle-kit generate 迁移 + 测试库应用

**Files:**
- Create: `apps/server/drizzle/0016_<随机名>.sql` + `apps/server/drizzle/meta/0016_snapshot.json`（均由 `drizzle-kit generate` 生成，文件名后缀随机，以实际生成为准）
- Modify: `apps/server/drizzle/meta/_journal.json`（generate 自动追加条目）

**Interfaces:**
- Consumes: Task 3 的 schema 定义（`apps/server/src/db/schema.ts` barrel）；`drizzle.config.ts`（schema 入口 `./src/db/schema.ts`、out `./drizzle`）。
- Produces: 迁移 `0016_*`（两表 + 五列 + 两索引 + 四条 FK）；测试库已应用（jest globalSetup 后续自动 no-op）。

- [ ] **Step 1: 生成迁移**

Run: `pnpm --filter @moment/server migrate:generate`
Expected: 输出 `New migration created` 类信息，生成 `apps/server/drizzle/0016_<随机名>.sql`、`meta/0016_snapshot.json`，`_journal.json` 追加 idx=16 条目。**禁手写 SQL**；如 generate 报冲突或要求 rename 提示，停手报告编排主 Agent，不交互式抉择。

- [ ] **Step 2: 人工核对生成的 SQL（逐条 checkpoint，全部满足才进 Step 3）**

打开生成的 `0016_*.sql`，核对：

1. 有且仅有以下变更（**无任何 DROP、无对既有表的 MODIFY、无 chk_chains_\* 等既有约束的重建**）：
   - `CREATE TABLE persons`：`id char(36) PK`、`chain_id char(36) NOT NULL`、`name varchar(50) NOT NULL`、`user_id char(36) NULL`、`created_at timestamp NOT NULL DEFAULT now()`、UNIQUE `uk_persons_chain_name (chain_id, name)`。
   - `CREATE TABLE moment_persons`：`moment_id char(36) NOT NULL`、`person_id char(36) NOT NULL`、`source enum('manual','ai') NOT NULL`、PRIMARY KEY `(moment_id, person_id)`、INDEX `idx_moment_persons_person_moment (person_id, moment_id)`。
   - `ALTER TABLE moments ADD` 五列，**全部可空无默认值**：`place_lat decimal(10,7)`、`place_lng decimal(10,7)`、`place_name varchar(255)`、`place_source enum('manual','exif','ai')`、`ai_extract_hash char(64)`。
   - 四条 FK：`persons.chain_id → chains.id`、`persons.user_id → users.id`、`moment_persons.moment_id → moments.id`、`moment_persons.person_id → persons.id`，**均不带 `ON DELETE` 动作**（镜像 tags 范式；drizzle 默认 `ON DELETE no action` 可接受）。
2. 无存量数据 UPDATE（本迁移零回填，spec §2「无存量数据回填」）。

任一条不满足：停手，核对 Task 3 schema 代码是否偏离本计划，修正后删掉本次生成的 0016 文件与 journal 条目重新 generate；**不手工编辑 SQL 补救**。

- [ ] **Step 3: 测试库应用迁移**

Run: `pnpm --filter @moment/server migrate`
Expected: 输出应用 0016 成功（打 `.env` 指向的测试库；严禁生产库）。瞬时 ECONNRESET 直接重跑同一命令（migrate 幂等，已应用的迁移不会重放）。

- [ ] **Step 4: 验证迁移落库形态**

Run:
```bash
pnpm --filter @moment/server exec tsx -e "
import { pool } from './src/db/index.js';
const [rows] = await pool.query(\"SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moments' AND COLUMN_NAME IN ('place_lat','place_lng','place_name','place_source','ai_extract_hash') ORDER BY COLUMN_NAME\");
console.log(JSON.stringify(rows, null, 2));
const [tables] = await pool.query(\"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('persons','moment_persons') ORDER BY TABLE_NAME\");
console.log(JSON.stringify(tables));
const [indexes] = await pool.query(\"SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('persons','moment_persons') GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME\");
console.log(JSON.stringify(indexes, null, 2));
await pool.end();
"
```
Expected:
- moments 五行：`ai_extract_hash char(64) YES`、`place_lat decimal(10,7) YES`、`place_lng decimal(10,7) YES`、`place_name varchar(255) YES`、`place_source enum('manual','exif','ai') YES`（COLUMNS 的 enum 显示为 `enum('manual','exif','ai')`）。
- 两表存在：`persons`、`moment_persons`。
- 索引恰好五行：`moment_persons/PRIMARY (moment_id,person_id)`、`moment_persons/idx_moment_persons_person_moment (person_id,moment_id)`、`persons/PRIMARY (id)`、`persons/uk_persons_chain_name (chain_id,name)`、`persons/persons_user_id_users_id_fk (user_id)`（`persons_user_id_users_id_fk` 是 MySQL 为带名 FK 约束 `persons.user_id → users.id` 自动建的支撑索引，以约束名命名——drizzle 生成的带名 FK 同 `drizzle/0002_wooden_cassandra_nova.sql` 的既有形式；`person_id`/`moment_id`/`chain_id` 三条 FK 已被 PK/uk/驱动索引左前缀覆盖不会自动建，只有 `user_id` 会）。即除 PRIMARY 与该 FK 自动索引外，**只有** `uk_persons_chain_name` 与 `idx_moment_persons_person_moment` 两个显式索引。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/drizzle/0016_*.sql apps/server/drizzle/meta/0016_snapshot.json apps/server/drizzle/meta/_journal.json
git commit -m "feat(server): add migration for persons tables and moments place columns"
```

---

### Task 5: resetDb 逆序扩展 + fixtures 夹具 + 触库冒烟测试

**Files:**
- Create: `apps/server/tests/db/people-place-schema.test.ts`
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 加两行）
- Modify: `apps/server/tests/helpers/fixtures.ts`（加 `insertPerson` / `attachPerson`）

**Interfaces:**
- Consumes:
  - `persons` / `momentPersons` / `moments`（`../../src/db/schema.js`，Task 3 barrel）
  - `resetDb()` / `closeDb()`（`../helpers/db.js`）、`registerUser` / `createChain` / `insertMoment`（`../helpers/fixtures.js`）
  - 迁移 0016 已应用（Task 4；jest globalSetup 自动跑 migrate，no-op 兜底）
- Produces:
  - `resetDb()` 覆盖 `moment_persons`、`persons` 两表
  - `insertPerson(opts: { chainId: string; name: string; userId?: string | null }): Promise<string>`（返回 person id）
  - `attachPerson(momentId: string, personId: string, source?: 'manual' | 'ai'): Promise<void>`（source 默认 `'manual'`）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/db/people-place-schema.test.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, persons } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('people/place schema 冒烟（P1：两表五列，spec §2）', () => {
  it('persons / moment_persons 可 insert/select，moments 五列可写可读回', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });

    const personId = await insertPerson({ chainId, name: '外婆', userId: owner.id });
    await attachPerson(momentId, personId, 'ai');

    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(person.chainId).toBe(chainId);
    expect(person.name).toBe('外婆');
    expect(person.userId).toBe(owner.id);
    expect(person.createdAt).toBeInstanceOf(Date);

    const links = await db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ momentId, personId, source: 'ai' });

    const hash = 'a'.repeat(64);
    await db
      .update(moments)
      .set({
        placeLat: 39.9042,
        placeLng: 116.4074,
        placeName: '北京市东城区',
        placeSource: 'exif',
        aiExtractHash: hash,
      })
      .where(eq(moments.id, momentId));

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeLat).toBeCloseTo(39.9042, 4);
    expect(m.placeLng).toBeCloseTo(116.4074, 4);
    expect(m.placeName).toBe('北京市东城区');
    expect(m.placeSource).toBe('exif');
    expect(m.aiExtractHash).toBe(hash);
  });

  it('moments 五列默认全 NULL（增量列零回填，spec §2）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.placeName).toBeNull();
    expect(m.placeSource).toBeNull();
    expect(m.aiExtractHash).toBeNull();
  });

  it('uk_persons_chain_name：同链同名撞唯一约束，异链同名放行', async () => {
    const owner = await registerUser();
    const c1 = await createChain(owner.id, '链一');
    const c2 = await createChain(owner.id, '链二');
    await insertPerson({ chainId: c1, name: '朵朵' });
    await expect(insertPerson({ chainId: c1, name: '朵朵' })).rejects.toThrow();
    await expect(insertPerson({ chainId: c2, name: '朵朵' })).resolves.toEqual(expect.any(String));
  });

  it('moment_persons 主键 (moment_id, person_id)：同行两 source 不允许（spec §2）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId, 'ai');
    await expect(attachPerson(momentId, personId, 'manual')).rejects.toThrow();
  });

  it('resetDb 覆盖新表：persons / moment_persons 被清空', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId);

    await resetDb();

    expect(await db.select().from(momentPersons)).toHaveLength(0);
    expect(await db.select().from(persons)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- people-place-schema`
Expected: FAIL，`attachPerson` / `insertPerson` 不存在于 fixtures（TS 编译错误或运行时报错）。

- [ ] **Step 3: 扩展 resetDb（外键逆序）**

Modify `apps/server/tests/helpers/db.ts`：

schema import 块中，在 `moments,` 行之后加 `momentPersons,`（保持字母序：现有顺序为 `chainInvites, chainMembers, chains, comments, media, momentTags, moments, ...`，将 `momentPersons` 插在 `momentTags,` 之后、`moments,` 之前；`persons` 插在 `outbox,` 之后、`pushTokens,` 之前）：
```ts
import {
  chainInvites,
  chainMembers,
  chains,
  comments,
  media,
  momentPersons,
  momentTags,
  moments,
  notifications,
  outbox,
  persons,
  pushTokens,
  reactions,
  recaps,
  refreshTokens,
  shareLinks,
  tags,
  templates,
  users,
} from '../../src/db/schema.js';
```

`resetDb()` 的 delete 序列中，在 `await db.delete(momentTags);` 之后、`await db.delete(tags);` 之后各插一行（`moment_persons` 依赖 moments 与 persons、`persons` 依赖 chains 与 users，故二者都必须早于 `moments`/`chains` 的 delete；插在 tags 兄弟位即满足逆序）：
```ts
    await db.delete(momentTags);
    await db.delete(momentPersons);
    await db.delete(tags);
    await db.delete(persons);
```

- [ ] **Step 4: 扩展 fixtures**

Modify `apps/server/tests/helpers/fixtures.ts`：

schema import 行替换为（加 `momentPersons, persons`）：
```ts
import { chainMembers, chains, momentPersons, momentTags, moments, persons, recaps } from '../../src/db/schema.js';
```

在 `attachTag` 函数之后追加：
```ts
/** 直插 person 词典行（spec people-place §2；名归一化是 service 职责，夹具原样落库）。 */
export async function insertPerson(opts: {
  chainId: string;
  name: string;
  userId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(persons).values({ id, chainId: opts.chainId, name: opts.name, userId: opts.userId ?? null });
  return id;
}

/** 直插 moment-person 关联（默认 source=manual；AI 抽取行传 'ai'）。 */
export async function attachPerson(
  momentId: string,
  personId: string,
  source: 'manual' | 'ai' = 'manual',
): Promise<void> {
  await db.insert(momentPersons).values({ momentId, personId, source });
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- people-place-schema`
Expected: PASS，5 个用例全过。瞬时 ECONNRESET 重跑同一命令（resetDb 自带连接重试）。

- [ ] **Step 6: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 全套件 PASS 无回归（resetDb 扩展不影响既有用例；jest globalSetup 的 migrate 为 no-op）。

- [ ] **Step 7: lint + typecheck**

Run: `pnpm --filter @moment/server lint && pnpm --filter @moment/server typecheck`
Expected: exit 0。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/tests/db/people-place-schema.test.ts apps/server/tests/helpers/db.ts apps/server/tests/helpers/fixtures.ts
git commit -m "test(server): cover persons tables in resetDb and add people/place schema smoke test"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（persons 15 个 + moments 新增 9 个 + 既有无回归）
- [ ] `pnpm --filter @moment/dto build` / `lint` exit 0
- [ ] `pnpm --filter @moment/server migrate` 在测试库应用 0016 成功；Task 4 Step 4 的信息_schema 核对全过
- [ ] `pnpm --filter @moment/server test` 全套件绿（含新增 5 个冒烟用例）
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] spec §2 数据模型逐列覆盖：`persons`（id/chain_id/name/user_id/created_at + uk_persons_chain_name）、`moment_persons`（moment_id/person_id/source + PK + idx_moment_persons_person_moment）、`moments` 五列（place_lat/place_lng decimal(10,7)、place_name varchar(255)、place_source enum、ai_extract_hash char(64)，全可空）——在 schema 代码与迁移 SQL 中逐一对应
- [ ] spec §6 请求 schema 逐规则覆盖：personIds uuid max 20；place name 1..255、lat ∈ [-90,90]、lng ∈ [-180,180]、lat/lng 同有同无、name 与坐标至少其一（refine message PLACE_COORDS_INVALID）；PATCH `place: null` 清除语义 / undefined 不变语义在 zod 注释与测试双钉死
- [ ] 编排 T1 的 Produces 符号逐个可在 `@moment/dto` 与 `@moment/server` 解析到；索引未多出 spec §2 之外任何显式索引
