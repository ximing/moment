# 链模板系统 P2：server 模板注册表 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/server` 落地模板注册表：`templates` 表 + official seed、manifest 校验器（ajv + 业务规则）、增量编辑检查、模板 CRUD API；并在 `@moment/dto` 补齐字段值派生表 `momentFieldPayloadJsonSchema`。

**Architecture:** manifest 以 dto 的 `manifestJsonSchema` 为 meta-schema，server 用 ajv（Ajv2020）做运行时校验，词表白名单已由 meta-schema 的 enum 承担；业务规则（key 去重、options 约束、嵌套 payloadSchema 合法性、增量编辑）在 ajv 之上的代码层检查。official 模板 seed 以 dto 的 `OFFICIAL_TEMPLATES` 为唯一数据源，经 `migrate.ts` 迁移后幂等 upsert。

**Tech Stack:** drizzle-orm ^0.45 / ajv ^8（Ajv2020，server runtime dependency）/ routing-controllers + TypeDI / jest + supertest（真实测试库，`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§2.1 templates 表、§3.1 CRUD、§3.4 编辑规则、§6 测试要求）

## Global Constraints

- 执行 prompt T2 契约：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`；Produces 符号 `validateManifest` / `assertAdditiveEdit` / 错误码 `TEMPLATE_MANIFEST_INVALID` / `TEMPLATE_NOT_FOUND` / `TEMPLATE_FORBIDDEN` / `TEMPLATE_EDIT_NOT_ADDITIVE` 逐字不得改。
- dto 契约（P1 已评审通过，`docs/superpowers/plans/2026-08-20-templates-p1-dto.md`）：`manifestJsonSchema` / `TemplateManifest` / `OFFICIAL_TEMPLATES` / `createTemplateInputSchema` / `updateTemplateInputSchema` / `TemplateDto` / `templateScopeSchema`。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 表约定（CONVENTIONS §2）：主键 `char(36)` + 应用层 `randomUUID()`；`timestamp({mode:'date'})`；`createdAt`/`updatedAt` `.notNull().defaultNow()`（updatedAt 另加 `.onUpdateNow()`，照 `chains` 表）。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码；模板不是链内资源，**不走** ChainPolicy，路由平铺 `/api/templates`。
- **user 模板 key 用 `u_` 前缀（21 位十六进制随机）而非 `u/<nanoid>`**：`:key` 路由参数不匹配含 `/` 的路径段，斜杠 key 无法被 `GET/PATCH/DELETE /api/templates/:key` 寻址（spec §2.1 已按此回写）。
- 迁移与 seed 分离：drizzle 迁移只建表；official seed 是 TS 代码（数据源在 dto，SQL 里无法 import），挂进 `migrate.ts` 迁移后执行，幂等 upsert（spec §2.3 已按此回写）。
- 新增依赖：`ajv@^8.17.1` 进 server `dependencies`（运行时校验）；server 无 nanoid，key 随机段用 `randomUUID().replaceAll('-', '').slice(0, 21)`。
- 触库测试必须 `afterAll(closeDb)`；新表必须扩展 `tests/helpers/db.ts` 的 `resetDb()`。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**已批准越界（编排者裁决 2026-08-20）**：本计划的 owner 范围超出执行 prompt T2 原始清单，以下扩项已获批准，不算越界：
- Task 1 改动 `packages/dto/src/templates.ts` + `templates.test.ts`（字段值派生表是 server/各端共享单一真相，覆盖 P1 计划 Global Constraints 中「派生表在 P2 server 侧实现」的旧表述）；
- Modify `apps/server/src/db/migrate.ts`（official seed 钩子）；
- Modify `apps/server/src/middlewares/error-handler.ts`（HttpError 分支透传 `details`）；
- Create `apps/server/src/templates/official-templates.seed.ts`（seed 模块）。

---

### Task 1: dto 字段值派生表 `momentFieldPayloadJsonSchema`

**Files:**
- Modify: `packages/dto/src/templates.ts`（追加）
- Test: `packages/dto/src/templates.test.ts`（追加）

**Interfaces:**
- Consumes: P1 的 `TemplateManifest`（`FromSchema` 生成，`momentFields` 项类型从中取）。
- Produces: `type TemplateMomentField`、`momentFieldPayloadJsonSchema(field: TemplateMomentField): Record<string, unknown>`——server P3 的 `validateMomentPayload` 与 web/app 发布器的**共享单一真相**（评审 S4）。

- [ ] **Step 1: 追加失败测试**

Append to `packages/dto/src/templates.test.ts`：
```ts
import { momentFieldPayloadJsonSchema } from './templates.js';

const ajvValue = new Ajv2020({ allErrors: true });

test('派生表：text / date / number-unit 的值 schema', () => {
  const text = ajvValue.compile(momentFieldPayloadJsonSchema({ key: 't', type: 'text', label: 'T' }));
  assert.equal(text('hello'), true);
  assert.equal(text(42), false);

  const date = ajvValue.compile(momentFieldPayloadJsonSchema({ key: 'd', type: 'date', label: 'D' }));
  assert.equal(date('2026-08-20'), true);
  assert.equal(date('2026/08/20'), false);
  assert.equal(date(20260820), false);

  const nu = ajvValue.compile(momentFieldPayloadJsonSchema({ key: 'n', type: 'number-unit', label: 'N' }));
  assert.equal(nu({ value: 62, unit: 'cm' }), true);
  assert.equal(nu({ value: 62 }), false);
  assert.equal(nu({ value: '62', unit: 'cm' }), false);
  assert.equal(nu({ value: 62, unit: 'cm', extra: 1 }), false);
});

test('派生表：geo 经纬度边界与可选 place_name', () => {
  const geo = ajvValue.compile(momentFieldPayloadJsonSchema({ key: 'g', type: 'geo', label: 'G' }));
  assert.equal(geo({ lat: 39.9, lng: 116.4 }), true);
  assert.equal(geo({ lat: 39.9, lng: 116.4, place_name: '北京' }), true);
  assert.equal(geo({ lat: 91, lng: 0 }), false);
  assert.equal(geo({ lat: 0, lng: 181 }), false);
  assert.equal(geo({ lat: 39.9 }), false);
});

test('派生表：enum/emoji-picker 收敛到 options；缺 options 抛错', () => {
  const mood = ajvValue.compile(
    momentFieldPayloadJsonSchema({ key: 'm', type: 'emoji-picker', label: 'M', options: ['😄', '😭'] }),
  );
  assert.equal(mood('😄'), true);
  assert.equal(mood('🤯'), false);
  assert.throws(() => momentFieldPayloadJsonSchema({ key: 'e', type: 'enum', label: 'E' }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`momentFieldPayloadJsonSchema` 未导出。

- [ ] **Step 3: 追加派生表实现**

Append to `packages/dto/src/templates.ts`：
```ts
// ---------- 字段值派生表（spec §1.3：manifest 不携带值 schema，由 type(+options) 派生） ----------

/** momentFields 数组项类型（从 TemplateManifest 取，不手写平行定义）。 */
export type TemplateMomentField = NonNullable<TemplateManifest['momentFields']>[number];

/** YYYY-MM-DD；不用 JSON Schema 的 format:'date'（ajv 需额外 ajv-formats 依赖，pattern 零依赖等价）。 */
const DATE_VALUE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/**
 * 按 momentField 的 type(+options) 派生「字段值」的 JSON Schema。
 * server payload 校验（P3）与各端发布器共用此函数，禁止各自另写一份。
 * enum/emoji-picker 缺 options 属于 manifest 非法（server validateManifest 也会拦），此处抛错兜底。
 */
export function momentFieldPayloadJsonSchema(field: TemplateMomentField): Record<string, unknown> {
  switch (field.type) {
    case 'text':
      return { type: 'string', maxLength: 500 };
    case 'number-unit':
      return {
        type: 'object',
        required: ['value', 'unit'],
        additionalProperties: false,
        properties: {
          value: { type: 'number' },
          unit: { type: 'string', minLength: 1, maxLength: 16 },
        },
      };
    case 'enum':
    case 'emoji-picker':
      if (!field.options || field.options.length === 0) {
        throw new Error(`momentField '${field.key}' (${field.type}) requires non-empty options`);
      }
      return { type: 'string', enum: [...field.options] };
    case 'date':
      return { type: 'string', pattern: DATE_VALUE_PATTERN };
    case 'geo':
      return {
        type: 'object',
        required: ['lat', 'lng'],
        additionalProperties: false,
        properties: {
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 },
          place_name: { type: 'string', maxLength: 200 },
        },
      };
  }
  throw new Error(`unknown momentField type: ${JSON.stringify(field)}`);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 测试 PASS，累计 14 个测试全过（`pass 14`、`fail 0`）；build exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/templates.ts packages/dto/src/templates.test.ts
git commit -m "feat(dto): add moment field payload schema derivation"
```

---

### Task 2: `templates` 表 + 迁移 + official seed + resetDb

**Files:**
- Create: `apps/server/src/db/schema/templates.ts`、`apps/server/src/templates/official-templates.seed.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 加一行）、`apps/server/src/db/migrate.ts`（迁移后 seed）、`apps/server/tests/helpers/db.ts`（resetDb）
- Test: `apps/server/tests/templates/seed.test.ts`

**Interfaces:**
- Consumes: dto 的 `OFFICIAL_TEMPLATES` / `TemplateManifest`；既有 `db`（`src/db/index.ts`）。
- Produces: `templates` 表（drizzle schema，列严格按 spec §2.1）；`Template` / `NewTemplate` 类型；`seedOfficialTemplates(): Promise<void>`（幂等 upsert，`migrate.ts` 与 `resetDb()` 共同调用）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/seed.test.ts`：
```ts
import { OFFICIAL_TEMPLATES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { templates } from '../../src/db/schema.js';
import { seedOfficialTemplates } from '../../src/templates/official-templates.seed.js';
import { closeDb, resetDb } from '../helpers/db.js';

afterAll(closeDb);

describe('official templates seed', () => {
  it('migrate 后三份 official 模板已入库，内容与 dto 常量一致', async () => {
    const rows = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(rows).toHaveLength(3);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const t of OFFICIAL_TEMPLATES) {
      const row = byKey[t.key];
      expect(row).toBeDefined();
      expect(row.name).toBe(t.name);
      expect(row.description).toBe(t.description);
      expect(row.icon).toBe(t.icon);
      expect(row.manifest).toEqual(t.manifest);
      expect(row.status).toBe('active');
      expect(row.ownerId).toBeNull();
    }
  });

  it('幂等：重复 seed 不产生重复行；resetDb 清表后自动重 seed', async () => {
    await seedOfficialTemplates();
    await seedOfficialTemplates();
    const rows = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(rows).toHaveLength(3);

    await resetDb();
    const after = await db.select().from(templates).where(eq(templates.scope, 'official'));
    expect(after).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/seed.test.ts`
Expected: FAIL，`templates` 未从 schema barrel 导出（编译错误）。

- [ ] **Step 3: 建表 schema + barrel**

Create `apps/server/src/db/schema/templates.ts`：
```ts
import type { TemplateManifest } from '@moment/dto';
import { char, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const templates = mysqlTable('templates', {
  id: char('id', { length: 36 }).primaryKey(),
  /**
   * 全局唯一。official：保留 slug（baby/travel/daily）；user：server 分配 `u_<21 位十六进制随机>`。
   * 用 `u_` 不用 `u/`：`:key` 路由参数不匹配含 `/` 的路径段（spec §2.1 同口径）。
   */
  key: varchar('key', { length: 64 }).notNull().unique(),
  scope: mysqlEnum('scope', ['official', 'user']).notNull(),
  /** user 模板创建者；official 为 null */
  ownerId: char('owner_id', { length: 36 }).references(() => users.id),
  name: varchar('name', { length: 50 }).notNull(),
  description: varchar('description', { length: 500 }),
  /** 单个 emoji/短符号（dto 层 1–8 字符，spec §2.1「禁 URL」的最小实现） */
  icon: varchar('icon', { length: 8 }).notNull(),
  /** 纯数据 DSL manifest（spec §1.3），写入前已过 validateManifest（Task 3） */
  manifest: json('manifest').$type<TemplateManifest>().notNull(),
  /** manifest 版本：仅 manifest 变更时 +1（spec §3.4）；name/description/icon 变更不 bump */
  version: int('version').notNull().default(1),
  /** archive 不影响存量链，只阻止新建链选用（spec §3.4）；不物理删除 */
  status: mysqlEnum('status', ['active', 'archived']).notNull().default('active'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
```

Modify `apps/server/src/db/schema.ts` — 末尾追加：
```ts
export * from './schema/templates.js';
```

- [ ] **Step 4: 实现 seed 并挂进 migrate.ts / resetDb**

Create `apps/server/src/templates/official-templates.seed.ts`：
```ts
import { OFFICIAL_TEMPLATES } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { templates } from '../db/schema.js';

/**
 * official 模板 seed：以 dto 的 OFFICIAL_TEMPLATES 为唯一数据源（SQL 迁移无法 import TS 常量）。
 * 幂等 upsert：重复执行不产生重复行；manifest 随代码发布会同步更新 DB 行
 * （official 模板的「增量编辑」由 dto 侧人工保证，同 spec §3.4 规则）。
 * 调用方：migrate.ts（迁移后）、tests/helpers/db.ts 的 resetDb()（清表后重 seed）。
 */
export async function seedOfficialTemplates(): Promise<void> {
  for (const t of OFFICIAL_TEMPLATES) {
    await db
      .insert(templates)
      .values({
        id: randomUUID(),
        key: t.key,
        scope: 'official',
        ownerId: null,
        name: t.name,
        description: t.description,
        icon: t.icon,
        manifest: t.manifest,
        version: 1,
        status: 'active',
      })
      .onDuplicateKeyUpdate({
        set: { name: t.name, description: t.description, icon: t.icon, manifest: t.manifest },
      });
  }
}
```

Modify `apps/server/src/db/migrate.ts` — 全量替换为：
```ts
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './index.js';
import { seedOfficialTemplates } from '../templates/official-templates.seed.js';
import { logger } from '../utils/logger.js';

await migrate(db, { migrationsFolder: './drizzle' });
await seedOfficialTemplates();
logger.info('migrations applied');
await pool.end();
```

Modify `apps/server/tests/helpers/db.ts` — import 块加 `templates` 与 seed 函数；`resetDb()` 在 `await db.delete(chains);` 之后、`await db.delete(refreshTokens);` 之前插入 `await db.delete(templates);`（owner_id FK → 必须先于 users 删除），函数末尾（users 删除之后）追加 `await seedOfficialTemplates();`。改完后 resetDb 全貌：
```ts
export async function resetDb(): Promise<void> {
  await db.delete(pushTokens);
  await db.delete(notifications);
  await db.delete(reactions);
  await db.delete(comments);
  await db.delete(momentTags);
  await db.delete(tags);
  await db.delete(outbox);
  await db.delete(media);
  await db.delete(moments);
  await db.delete(chainInvites);
  await db.delete(chainMembers);
  await db.delete(shareLinks);
  await db.delete(chains);
  await db.delete(templates);
  await db.delete(refreshTokens);
  await db.delete(users);
  // official 模板是全量测试的前置数据：清表后重新 seed（幂等 upsert）
  await seedOfficialTemplates();
}
```

- [ ] **Step 5: 生成迁移并应用**

Run:
```bash
pnpm --filter @moment/server migrate:generate
pnpm --filter @moment/server migrate
```
Expected: `drizzle/` 新增 `0009_*.sql`（CREATE TABLE `templates`，含 `key` 唯一约束与 `owner_id` FK）；migrate 输出 `migrations applied`，exit 0。若 generate 产出与上表结构不符，**停手报告 diff**，不得手改生成物绕过。

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/templates/seed.test.ts`
Expected: PASS，2 个测试全过。

- [ ] **Step 7: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有全部测试 + 新增 2 个全绿（resetDb 改动不得引起任何既有测试回归）。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/db/schema/templates.ts apps/server/src/db/schema.ts apps/server/src/db/migrate.ts apps/server/src/templates/official-templates.seed.ts apps/server/tests/helpers/db.ts apps/server/tests/templates/seed.test.ts apps/server/drizzle/0009_*.sql apps/server/drizzle/meta/
git commit -m "feat(server): add templates table and official template seed"
```

---

### Task 3: manifest 校验器 + 增量编辑检查

**Files:**
- Modify: `apps/server/package.json`（经 pnpm add 加 ajv）
- Create: `apps/server/src/templates/manifest-validator.ts`
- Test: `apps/server/tests/templates/manifest-validator.test.ts`

**Interfaces:**
- Consumes: dto 的 `manifestJsonSchema` / `TemplateManifest` / `TEMPLATE_FIELD_TYPES`。
- Produces:
  - `class ManifestInvalidError extends HttpError`（httpCode 400，message `TEMPLATE_MANIFEST_INVALID`，携带 `details`）
  - `validateManifest(raw: unknown): TemplateManifest`——ajv meta-schema 校验 + 业务规则（key 去重、options 约束、嵌套 schema 合法性）；非法抛 `ManifestInvalidError`
  - `assertAdditiveEdit(prev: TemplateManifest, next: TemplateManifest): void`——违反抛 `BadRequestError('TEMPLATE_EDIT_NOT_ADDITIVE')`
  - `stableStringify(value: unknown): string`（键序无关深比较，**必须用它**：MySQL JSON 会对 key 排序，DB 读出的 prev 与客户端提交的 next 直接 `JSON.stringify` 比较必误判）

- [ ] **Step 1: 加依赖**

Run: `pnpm --filter @moment/server add ajv@^8.17.1`
Expected: exit 0，`apps/server/package.json` `dependencies` 出现 `ajv`。

- [ ] **Step 2: 写失败测试**

Create `apps/server/tests/templates/manifest-validator.test.ts`（纯单测，不触库，无需 resetDb/closeDb）：
```ts
import { OFFICIAL_TEMPLATES } from '@moment/dto';
import {
  ManifestInvalidError,
  assertAdditiveEdit,
  stableStringify,
  validateManifest,
} from '../../src/templates/manifest-validator.js';

const valid = () => ({ version: 1 }) as const;

describe('validateManifest', () => {
  it('最小 manifest 与三份 official manifest 全部通过', () => {
    expect(validateManifest(valid())).toEqual({ version: 1 });
    for (const t of OFFICIAL_TEMPLATES) {
      expect(() => validateManifest(t.manifest)).not.toThrow();
    }
  });

  it('meta-schema 拒绝：词表外类型 / 多余属性 / 非法 key，抛 ManifestInvalidError 且带 details', () => {
    try {
      validateManifest({ version: 1, momentFields: [{ key: 'x', type: 'slider', label: 'X' }] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestInvalidError);
      expect((e as ManifestInvalidError).message).toBe('TEMPLATE_MANIFEST_INVALID');
      expect(Array.isArray((e as ManifestInvalidError).details)).toBe(true);
    }
    expect(() => validateManifest({ version: 1, hacker: true })).toThrow(ManifestInvalidError);
    expect(() =>
      validateManifest({ version: 1, kinds: [{ key: 'Bad', label: 'x', payloadSchema: { type: 'object' } }] }),
    ).toThrow(ManifestInvalidError);
  });

  it('业务规则：kinds / momentFields / milestoneCatalog 的 key 模板内去重（S5）', () => {
    const dup = {
      version: 1,
      kinds: [
        { key: 'm', label: 'a', payloadSchema: { type: 'object' } },
        { key: 'm', label: 'b', payloadSchema: { type: 'object' } },
      ],
    };
    expect(() => validateManifest(dup)).toThrow(ManifestInvalidError);
    const dupField = {
      version: 1,
      momentFields: [
        { key: 'f', type: 'text', label: 'a' },
        { key: 'f', type: 'date', label: 'b' },
      ],
    };
    expect(() => validateManifest(dupField)).toThrow(ManifestInvalidError);
  });

  it('业务规则：enum/emoji-picker 必须带 options，其余类型禁止带 options', () => {
    expect(() =>
      validateManifest({ version: 1, momentFields: [{ key: 'm', type: 'emoji-picker', label: '心情' }] }),
    ).toThrow(ManifestInvalidError);
    expect(() =>
      validateManifest({
        version: 1,
        momentFields: [{ key: 'm', type: 'text', label: 'T', options: ['a'] }],
      }),
    ).toThrow(ManifestInvalidError);
    expect(
      validateManifest({
        version: 1,
        momentFields: [{ key: 'm', type: 'enum', label: 'E', options: ['a', 'b'] }],
      }),
    ).toBeDefined();
  });

  it('业务规则：嵌套 payloadSchema 必须是合法 JSON Schema', () => {
    expect(() =>
      validateManifest({
        version: 1,
        kinds: [{ key: 'm', label: 'x', payloadSchema: { type: 'not-a-type' } }],
      }),
    ).toThrow(ManifestInvalidError);
    expect(() => validateManifest({ version: 1, chainPayloadSchema: { properties: 'oops' } })).toThrow(
      ManifestInvalidError,
    );
  });
});

describe('assertAdditiveEdit', () => {
  const base = {
    version: 1,
    kinds: [{ key: 'metric', label: '记录', payloadSchema: { type: 'object', required: ['v'] } }],
    momentFields: [{ key: 'mood', type: 'emoji-picker', label: '心情', options: ['😄', '😭'] }],
    views: [{ type: 'timeline', label: '时间线' }],
    milestoneCatalog: [{ key: 'first-smile', label: '第一次微笑', icon: '😊' }],
  } as const;

  it('允许：新增 kind/field/view/目录项；改 label', () => {
    const next = JSON.parse(JSON.stringify(base));
    next.version = 2;
    next.kinds.push({ key: 'note', label: '笔记', payloadSchema: { type: 'object' } });
    next.momentFields.push({ key: 'place', type: 'text', label: '地点' });
    next.views.push({ type: 'map', label: '地图', source: { field: 'place' } });
    next.milestoneCatalog.push({ key: 'first-roll', label: '第一次翻身' });
    next.kinds[0].label = '成长记录';
    expect(() => assertAdditiveEdit(base as never, next)).not.toThrow();
  });

  it('拒绝：删 kind / 改 payloadSchema / 缩 options / 删目录项 / 删视图', () => {
    const del = JSON.parse(JSON.stringify(base));
    del.kinds = [];
    expect(() => assertAdditiveEdit(base as never, del)).toThrow('TEMPLATE_EDIT_NOT_ADDITIVE');

    const narrowed = JSON.parse(JSON.stringify(base));
    narrowed.momentFields[0].options = ['😄'];
    expect(() => assertAdditiveEdit(base as never, narrowed)).toThrow('TEMPLATE_EDIT_NOT_ADDITIVE');

    const changedSchema = JSON.parse(JSON.stringify(base));
    changedSchema.kinds[0].payloadSchema = { type: 'object' };
    expect(() => assertAdditiveEdit(base as never, changedSchema)).toThrow('TEMPLATE_EDIT_NOT_ADDITIVE');

    const delCatalog = JSON.parse(JSON.stringify(base));
    delCatalog.milestoneCatalog = [];
    expect(() => assertAdditiveEdit(base as never, delCatalog)).toThrow('TEMPLATE_EDIT_NOT_ADDITIVE');

    const delView = JSON.parse(JSON.stringify(base));
    delView.views = [];
    expect(() => assertAdditiveEdit(base as never, delView)).toThrow('TEMPLATE_EDIT_NOT_ADDITIVE');
  });

  it('键序无关：stableStringify 对键序不同的同值对象产出相同字符串', () => {
    expect(stableStringify({ a: 1, b: { c: [2, 3], d: 4 } })).toBe(
      stableStringify({ b: { d: 4, c: [2, 3] }, a: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/manifest-validator.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现校验器**

Create `apps/server/src/templates/manifest-validator.ts`：
```ts
import Ajv2020 from 'ajv/dist/2020.js';
import { manifestJsonSchema, type TemplateManifest } from '@moment/dto';
import { BadRequestError, HttpError } from 'routing-controllers';

/** manifest 校验失败：message 为机器码（error-handler 约定），details 附 ajv 错误路径（spec §3.1）。 */
export class ManifestInvalidError extends HttpError {
  constructor(public details: unknown) {
    super(400, 'TEMPLATE_MANIFEST_INVALID');
  }
}

const ajv = new Ajv2020({ allErrors: true });
const compiled = ajv.compile(manifestJsonSchema);

/** 键序无关的稳定序列化：MySQL JSON 会对对象 key 排序，DB 读出的 prev 与客户端提交的 next 必须用本函数比较。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function fail(details: unknown): never {
  throw new ManifestInvalidError(details);
}

/** 嵌套 payloadSchema / chainPayloadSchema 必须是合法 JSON Schema（meta-schema 只断言了「是对象」）。 */
function assertNestedSchema(schema: unknown, path: string): void {
  try {
    if (typeof schema !== 'object' || schema === null || !ajv.validateSchema(schema)) {
      fail([{ path, message: 'not a valid JSON Schema' }]);
    }
  } catch (e) {
    if (e instanceof ManifestInvalidError) throw e;
    fail([{ path, message: 'not a valid JSON Schema' }]);
  }
}

/**
 * manifest 运行时校验：ajv meta-schema（含词表 enum 白名单）+ 业务规则。
 * 业务规则（meta-schema 表达不了的部分）：
 * 1. kinds / momentFields / milestoneCatalog 的 key 各自模板内唯一（评审 S5）；
 * 2. enum/emoji-picker 必须带非空 options，其余字段类型禁止带 options；
 * 3. 嵌套 payloadSchema / chainPayloadSchema 本身是合法 JSON Schema。
 */
export function validateManifest(raw: unknown): TemplateManifest {
  if (!compiled(raw)) {
    fail(
      (compiled.errors ?? []).map((e) => ({
        path: e.instancePath || '(root)',
        message: e.message ?? 'invalid',
      })),
    );
  }
  const m = raw as TemplateManifest;

  for (const [label, items] of [
    ['kinds', m.kinds ?? []],
    ['momentFields', m.momentFields ?? []],
    ['milestoneCatalog', m.milestoneCatalog ?? []],
  ] as const) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.key)) fail([{ path: `/${label}`, message: `duplicate key '${item.key}'` }]);
      seen.add(item.key);
    }
  }

  for (const f of m.momentFields ?? []) {
    const needsOptions = f.type === 'enum' || f.type === 'emoji-picker';
    if (needsOptions && (!f.options || f.options.length === 0)) {
      fail([{ path: `/momentFields/${f.key}`, message: `${f.type} requires non-empty options` }]);
    }
    if (!needsOptions && f.options !== undefined) {
      fail([{ path: `/momentFields/${f.key}`, message: `${f.type} must not carry options` }]);
    }
  }

  if (m.chainPayloadSchema !== undefined) assertNestedSchema(m.chainPayloadSchema, '/chainPayloadSchema');
  for (const k of m.kinds ?? []) assertNestedSchema(k.payloadSchema, `/kinds/${k.key}/payloadSchema`);

  return m;
}

/**
 * 增量编辑检查（spec §3.4）：只允许新增 kind/字段/视图/目录项与改 label；
 * 既存项的 payloadSchema/type/options/source/groupBy/目录项内容 一律冻结。
 * 取舍（已上报）：chainPayloadSchema 与既存 kind 的 payloadSchema 整体冻结（比 spec 的「禁止收窄」更保守），
 * 后续确需「schema 加 optional 字段」再单独放宽。
 * 同族保守冻结还包括 publisher 与 milestoneCatalog 项的 label/icon（对既存目录项做稳定相等比较），
 * 比 spec §3.4 允许的「改 label」更严，后续按需放宽。
 */
export function assertAdditiveEdit(prev: TemplateManifest, next: TemplateManifest): void {
  const notAdditive = (): never => {
    throw new BadRequestError('TEMPLATE_EDIT_NOT_ADDITIVE');
  };

  if (stableStringify(prev.chainPayloadSchema ?? null) !== stableStringify(next.chainPayloadSchema ?? null)) {
    notAdditive();
  }

  const prevKinds = new Map((prev.kinds ?? []).map((k) => [k.key, k]));
  for (const [key, p] of prevKinds) {
    const n = (next.kinds ?? []).find((k) => k.key === key);
    if (!n) notAdditive();
    if (stableStringify(p.payloadSchema) !== stableStringify(n.payloadSchema)) notAdditive();
    if (stableStringify(p.publisher ?? null) !== stableStringify(n.publisher ?? null)) notAdditive();
  }

  const prevFields = new Map((prev.momentFields ?? []).map((f) => [f.key, f]));
  for (const [key, p] of prevFields) {
    const n = (next.momentFields ?? []).find((f) => f.key === key);
    if (!n) notAdditive();
    if (p.type !== n.type) notAdditive();
    if (stableStringify(p.options ?? null) !== stableStringify(n.options ?? null)) notAdditive();
  }

  // views 无 key：按下标前缀冻结（只能 append，既存项整体稳定相等）
  const prevViews = prev.views ?? [];
  const nextViews = next.views ?? [];
  if (nextViews.length < prevViews.length) notAdditive();
  prevViews.forEach((v, i) => {
    if (stableStringify(v) !== stableStringify(nextViews[i])) notAdditive();
  });

  const prevCatalog = new Map((prev.milestoneCatalog ?? []).map((c) => [c.key, c]));
  for (const [key, p] of prevCatalog) {
    const n = (next.milestoneCatalog ?? []).find((c) => c.key === key);
    if (!n) notAdditive();
    if (stableStringify(p) !== stableStringify(n)) notAdditive();
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/templates/manifest-validator.test.ts`
Expected: PASS，8 个测试全过（validateManifest 5 + assertAdditiveEdit 3）。

- [ ] **Step 6: 透传 details：扩展统一错误处理器**

Modify `apps/server/src/middlewares/error-handler.ts` — HttpError 分支的 `res.status(...).json(...)` 改为：
```ts
    if (error instanceof HttpError) {
      // 约定：业务代码抛 HttpError 系错误时，message 承载 UPPER_SNAKE 机器码；
      // 框架自带错误（如 AuthorizationRequiredError）message 是自然语言，退回用 name 做 code。
      const isMachineCode = /^[A-Z0-9_]+$/.test(error.message);
      // ManifestInvalidError 等自定义错误可携带 details（spec §3.1：TEMPLATE_MANIFEST_INVALID 附 ajv 错误路径）
      const details = (error as { details?: unknown }).details;
      res.status(error.httpCode).json({
        error: {
          code: isMachineCode ? error.message : error.name,
          message: error.message,
          ...(details !== undefined ? { details } : {}),
        },
      });
      return;
    }
```

- [ ] **Step 7: 全量回归 + typecheck + Commit**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
```
Expected: 测试全绿（error-handler 改动不得引起回归）；typecheck exit 0。

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/templates/manifest-validator.ts apps/server/src/middlewares/error-handler.ts apps/server/tests/templates/manifest-validator.test.ts
git commit -m "feat(server): add template manifest validation"
```

---

### Task 4: TemplateService + CRUD 路由

**Files:**
- Create: `apps/server/src/templates/template.service.ts`、`apps/server/src/templates/template.controller.ts`
- Modify: `apps/server/src/app.ts`（注册 controller）
- Test: `apps/server/tests/templates/templates.crud.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `templates` 表；Task 3 的 `validateManifest` / `assertAdditiveEdit`；dto 的 `createTemplateInputSchema` / `updateTemplateInputSchema` / `templateScopeSchema` / `TemplateDto` / `TemplateScope`。
- Produces（P3 消费）:
  - `TemplateService.getActiveByKey(key: string): Promise<Template>`——取 active 模板行（P3 payload 校验与聚合端点用）；不存在或已归档抛 `NotFoundError('TEMPLATE_NOT_FOUND')`
  - 路由：`GET/POST /api/templates`、`GET/PATCH/DELETE /api/templates/:key`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/templates.crud.test.ts`：
```ts
import type { TemplateDto } from '@moment/dto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});
afterAll(closeDb);

const minimalManifest = { version: 1 };

async function createTemplate(user: TestUser, manifest: object = minimalManifest): Promise<TemplateDto> {
  const res = await request(app)
    .post('/api/templates')
    .set('Authorization', auth(user))
    .send({ name: '喂奶记录', icon: '🍼', manifest });
  expect(res.status).toBe(201);
  return res.body as TemplateDto;
}

describe('POST /api/templates', () => {
  it('201：server 分配 u_ 前缀 key，version=1，scope=user', async () => {
    const t = await createTemplate(alice);
    expect(t.key).toMatch(/^u_[0-9a-f]{21}$/);
    expect(t.scope).toBe('user');
    expect(t.ownerId).toBe(alice.id);
    expect(t.version).toBe(1);
    expect(t.status).toBe('active');
    expect(t.manifest).toEqual(minimalManifest);
  });

  it('非法 manifest → 400 TEMPLATE_MANIFEST_INVALID（details 带 ajv 路径）；未登录 401', async () => {
    const bad = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: 'x', icon: 'x', manifest: { version: 1, hacker: true } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TEMPLATE_MANIFEST_INVALID');
    expect(Array.isArray(bad.body.error.details)).toBe(true);

    expect((await request(app).post('/api/templates').send({ name: 'x', icon: 'x', manifest: minimalManifest })).status).toBe(401);
  });
});

describe('GET /api/templates', () => {
  it('默认返回 official 全部 + 我的 user 模板（不含他人的、不含已归档）', async () => {
    const mine = await createTemplate(alice);
    await createTemplate(bob);
    const res = await request(app).get('/api/templates').set('Authorization', auth(alice));
    expect(res.status).toBe(200);
    const list = res.body as TemplateDto[];
    expect(list.filter((t) => t.scope === 'official')).toHaveLength(3);
    const userOnes = list.filter((t) => t.scope === 'user');
    expect(userOnes).toHaveLength(1);
    expect(userOnes[0].key).toBe(mine.key);
  });

  it('?scope=official 只返回三份官方模板；?scope=user 只返回我的', async () => {
    await createTemplate(alice);
    const official = await request(app)
      .get('/api/templates')
      .query({ scope: 'official' })
      .set('Authorization', auth(alice));
    expect((official.body as TemplateDto[]).map((t) => t.key).sort()).toEqual(['baby', 'daily', 'travel']);
    const mine = await request(app).get('/api/templates').query({ scope: 'user' }).set('Authorization', auth(alice));
    expect((mine.body as TemplateDto[]).every((t) => t.ownerId === alice.id)).toBe(true);
  });
});

describe('GET /api/templates/:key', () => {
  it('official 模板可读（baby 含里程碑目录）；未知 key 404 TEMPLATE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/templates/baby').set('Authorization', auth(alice));
    expect(res.status).toBe(200);
    expect((res.body as TemplateDto).manifest.milestoneCatalog?.length).toBeGreaterThanOrEqual(5);

    const missing = await request(app).get('/api/templates/nope').set('Authorization', auth(alice));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('PATCH /api/templates/:key', () => {
  it('改 name 不 bump version；增量改 manifest version+1 且 manifest.version 同步', async () => {
    const t = await createTemplate(alice);
    const renamed = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ name: '改名了' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.version).toBe(1);

    const grown = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ manifest: { version: 99, momentFields: [{ key: 'note', type: 'text', label: '备注' }] } });
    expect(grown.status).toBe(200);
    expect(grown.body.version).toBe(2);
    // manifest.version 由 server 归一为行版本（客户端填的 99 被覆盖）
    expect(grown.body.manifest.version).toBe(2);
  });

  it('非增量编辑 → 400 TEMPLATE_EDIT_NOT_ADDITIVE', async () => {
    const t = await createTemplate(alice, {
      version: 1,
      momentFields: [{ key: 'mood', type: 'emoji-picker', label: '心情', options: ['😄', '😭'] }],
    });
    const res = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ manifest: { version: 1, momentFields: [{ key: 'mood', type: 'emoji-picker', label: '心情', options: ['😄'] }] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_EDIT_NOT_ADDITIVE');
  });

  it('非 owner 改 / 改 official → 403 TEMPLATE_FORBIDDEN', async () => {
    const t = await createTemplate(alice);
    const byOther = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(bob))
      .send({ name: 'hack' });
    expect(byOther.status).toBe(403);
    expect(byOther.body.error.code).toBe('TEMPLATE_FORBIDDEN');

    const official = await request(app)
      .patch('/api/templates/baby')
      .set('Authorization', auth(alice))
      .send({ name: 'hack' });
    expect(official.status).toBe(403);
    expect(official.body.error.code).toBe('TEMPLATE_FORBIDDEN');
  });
});

describe('DELETE /api/templates/:key', () => {
  it('archive 后列表不可见、详情可读（存量链不受影响，spec §3.4）；非 owner 403', async () => {
    const t = await createTemplate(alice);
    const forbidden = await request(app).delete(`/api/templates/${t.key}`).set('Authorization', auth(bob));
    expect(forbidden.status).toBe(403);

    const res = await request(app).delete(`/api/templates/${t.key}`).set('Authorization', auth(alice));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/templates').set('Authorization', auth(alice));
    expect((list.body as TemplateDto[]).find((x) => x.key === t.key)).toBeUndefined();

    const detail = await request(app).get(`/api/templates/${t.key}`).set('Authorization', auth(alice));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('archived');

    // 行为声明（编排者裁决 S3）：archived 模板仍可 PATCH（archive 只阻止新建链选用，不冻结定义）
    const patchArchived = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ name: '归档后改名' });
    expect(patchArchived.status).toBe(200);
    expect(patchArchived.body.status).toBe('archived');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/templates/templates.crud.test.ts`
Expected: FAIL，404（路由未注册）/ 模块不存在。

- [ ] **Step 3: 实现 service**

Create `apps/server/src/templates/template.service.ts`：
```ts
import {
  type CreateTemplateInput,
  type TemplateDto,
  type TemplateScope,
  type UpdateTemplateInput,
} from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { templates, type Template } from '../db/schema.js';
import { assertAdditiveEdit, validateManifest } from './manifest-validator.js';

function toDto(row: Template): TemplateDto {
  return {
    id: row.id,
    key: row.key,
    scope: row.scope,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    manifest: row.manifest,
    version: row.version,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Service()
export class TemplateService {
  /** 列表：official 全部 + 我的 user 模板；仅 active（archived 不再可选，spec §3.4）。 */
  async list(userId: string, scope?: TemplateScope): Promise<TemplateDto[]> {
    const scopeCond: SQL =
      scope === 'official'
        ? eq(templates.scope, 'official')
        : scope === 'user'
          ? and(eq(templates.scope, 'user'), eq(templates.ownerId, userId))!
          : or(eq(templates.scope, 'official'), and(eq(templates.scope, 'user'), eq(templates.ownerId, userId))!)!;
    const rows = await db
      .select()
      .from(templates)
      .where(and(eq(templates.status, 'active'), scopeCond))
      .orderBy(asc(templates.key));
    return rows.map(toDto);
  }

  /**
   * 详情：任意状态可读（archived 的存量链仍要渲染 manifest）。
   * 对他人的 user 模板同样可读：manifest 是纯结构定义、不含用户数据；
   * 可见性控制由 list 承担（只列 official + 我的），详情接口不额外设防（编排者裁决 S2）。
   */
  async getByKey(key: string): Promise<TemplateDto> {
    return toDto(await this.getRowByKey(key));
  }

  /** active 模板行：P3 的链创建/payload 校验/聚合端点用；archived 视同不存在（阻止新建链选用）。 */
  async getActiveByKey(key: string): Promise<Template> {
    const row = await this.getRowByKey(key);
    if (row.status !== 'active') throw new NotFoundError('TEMPLATE_NOT_FOUND');
    return row;
  }

  async create(userId: string, input: CreateTemplateInput): Promise<TemplateDto> {
    const manifest = validateManifest(input.manifest);
    const id = randomUUID();
    // u_ + 21 位十六进制随机（server 无 nanoid 依赖，randomUUID 去横线截取；`u/` 含路由非法字符，spec §2.1 已定为 u_）
    const key = `u_${randomUUID().replaceAll('-', '').slice(0, 21)}`;
    await db.insert(templates).values({
      id,
      key,
      scope: 'user',
      ownerId: userId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon,
      manifest: { ...manifest, version: 1 },
      version: 1,
      status: 'active',
    });
    return this.getByKey(key);
  }

  async update(userId: string, key: string, input: UpdateTemplateInput): Promise<TemplateDto> {
    const row = await this.getOwnedRow(userId, key);
    let version = row.version;
    let manifest = row.manifest;
    if (input.manifest !== undefined) {
      const next = validateManifest(input.manifest);
      assertAdditiveEdit(row.manifest, next);
      version = row.version + 1;
      // manifest.version 由 server 归一为行版本（客户端填的值不采信）
      manifest = { ...next, version };
    }
    await db
      .update(templates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        manifest,
        version,
      })
      .where(eq(templates.id, row.id));
    return this.getByKey(key);
  }

  /** archive：不物理删除；存量链照常（详情仍可读），仅阻止新建链选用（spec §3.4）。 */
  async archive(userId: string, key: string): Promise<void> {
    const row = await this.getOwnedRow(userId, key);
    if (row.status === 'archived') return; // 幂等
    // 已知行为空隙（编排者裁决 S3，可接受）：archived 模板仍允许 PATCH 编辑 manifest——
    // 归档语义只约束「新建链不可选用」（getActiveByKey 拦截），不冻结定义本身。
    await db.update(templates).set({ status: 'archived' }).where(eq(templates.id, row.id));
  }

  private async getRowByKey(key: string): Promise<Template> {
    const [row] = await db.select().from(templates).where(eq(templates.key, key)).limit(1);
    if (!row) throw new NotFoundError('TEMPLATE_NOT_FOUND');
    return row;
  }

  private async getOwnedRow(userId: string, key: string): Promise<Template> {
    const row = await this.getRowByKey(key);
    if (row.scope === 'official' || row.ownerId !== userId) throw new ForbiddenError('TEMPLATE_FORBIDDEN');
    return row;
  }
}
```

- [ ] **Step 4: 实现 controller 并注册**

Create `apps/server/src/templates/template.controller.ts`：
```ts
import {
  createTemplateInputSchema,
  templateScopeSchema,
  updateTemplateInputSchema,
  type TemplateDto,
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
  Patch,
  Post,
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';
import { TemplateService } from './template.service.js';

const listQuerySchema = z.object({ scope: templateScopeSchema.optional() });

@JsonController('/templates')
@Service()
@Authorized()
export class TemplatesController {
  constructor(private templateService: TemplateService) {}

  @Get('/')
  list(@CurrentUser() user: UserProfile, @QueryParam('scope') scope?: string): Promise<TemplateDto[]> {
    return this.templateService.list(user.id, listQuerySchema.parse({ scope }).scope);
  }

  @Post('/')
  @HttpCode(201)
  create(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<TemplateDto> {
    return this.templateService.create(user.id, createTemplateInputSchema.parse(body));
  }

  @Get('/:key')
  getOne(@Param('key') key: string): Promise<TemplateDto> {
    return this.templateService.getByKey(key);
  }

  @Patch('/:key')
  update(
    @CurrentUser() user: UserProfile,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<TemplateDto> {
    return this.templateService.update(user.id, key, updateTemplateInputSchema.parse(body));
  }

  @Delete('/:key')
  @HttpCode(204)
  @OnUndefined(204)
  archive(@CurrentUser() user: UserProfile, @Param('key') key: string): Promise<void> {
    return this.templateService.archive(user.id, key);
  }
}
```

Modify `apps/server/src/app.ts`：
- import 区追加 `import { TemplatesController } from './templates/template.controller.js';`
- `controllers: [...]` 数组中 `PublicShareController` 之后追加 `TemplatesController`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/templates/`
Expected: PASS，templates 目录全部测试（seed 2 + validator 8 + crud 9）全过。

- [ ] **Step 6: 全量回归 + typecheck + lint**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
pnpm --filter @moment/server lint
```
Expected: 全部 exit 0；测试总数 = 既有 + 19。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/templates/ apps/server/src/app.ts apps/server/tests/templates/templates.crud.test.ts
git commit -m "feat(server): add template CRUD API"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（14 个测试）
- [ ] `pnpm --filter @moment/server test` 全绿（既有 + 19 个新增），`typecheck` / `lint` exit 0
- [ ] `pnpm --filter @moment/server migrate` 幂等（重复执行 exit 0，official 仍 3 行）
- [ ] spec §2.1 的列与 `templates` 表逐一对应；§3.1 的五个路由全部可用；§3.4 编辑规则由 `assertAdditiveEdit` 落实
- [ ] 执行 prompt T2 Produces 逐个可解析：`validateManifest` / `assertAdditiveEdit` / 四个错误码 / `GET/POST /api/templates` / `GET/PATCH/DELETE /api/templates/:key`
- [ ] 评审带入项：S4 派生表（Task 1）、S5 key 去重（Task 3）均已落地
