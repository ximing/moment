# 链模板系统 P1：dto 模板域 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/dto` 落地模板域的全部共享契约：词表、manifest meta-schema（JSON Schema draft 2020-12）与 `FromSchema` 生成的 `TemplateManifest` 类型、baby/travel/daily 三份官方模板常量、模板 CRUD 的 zod 输入 schema 与 `TemplateDto`。

**Architecture:** manifest 是纯数据 DSL（禁止函数/组件引用），dto 包只放 schema 与类型推导（dto CLAUDE.md 硬约束）。TS 类型从 JSON Schema 经 `json-schema-to-ts` 的 `FromSchema` 生成，不手写平行类型；parity 由测试保证（ajv 编译 meta-schema 校验三份官方 manifest）。server 运行时的 ajv 校验器、模板表与 CRUD 属 P2 计划。

**Tech Stack:** zod ^3.22（勿用 v4 API）/ json-schema-to-ts ^3（类型级）/ ajv ^8（仅 devDependency，测试 parity 用）/ tsx --test（node:test）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§1.2–1.4 DSL 与 manifest 结构、§2.1 templates 表、§4 三模板定义）

## Global Constraints

- 执行 prompt T1 契约：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`；下列符号名逐字不得改：`TEMPLATE_FIELD_TYPES` / `TemplateFieldType` / `TEMPLATE_VIEW_TYPES` / `TemplateViewType` / `manifestJsonSchema` / `TemplateManifest` / `OFFICIAL_TEMPLATES` / `createTemplateInputSchema` / `updateTemplateInputSchema` / `TemplateDto`。
- dto 包规则（`packages/dto/CLAUDE.md`）：每个业务域一个文件、只放 schema 与纯类型、不放运行时业务逻辑；测试与源文件同目录，`pnpm --filter @moment/dto test` 的 glob 是 `src/*.test.ts`（只匹配顶层）——故本计划为**单文件** `src/templates.ts` + `src/templates.test.ts`，不用子目录。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 新增依赖：`json-schema-to-ts` 进 `dependencies`（`FromSchema` 类型会出现在产物 `.d.ts` 中，下游消费方需要可解析）；`ajv` 进 `devDependencies`（仅测试 parity）。
- momentField 的**值校验规则不显式携带在 manifest 里**，由 `type`（+`options`）确定派生（派生表在 P2 server 侧实现）；manifest 只声明 `key/type/label/options`。
- 每 Task 一个 commit，conventional commits。

---

### Task 1: 依赖 + 词表 + manifest meta-schema + `TemplateManifest` 类型

**Files:**
- Modify: `packages/dto/package.json`（经 pnpm add 命令变更）
- Create: `packages/dto/src/templates.ts`
- Test: `packages/dto/src/templates.test.ts`

**Interfaces:**
- Consumes: 无（首批代码）。
- Produces: `TEMPLATE_FIELD_TYPES` / `TemplateFieldType` / `TEMPLATE_VIEW_TYPES` / `TemplateViewType` / `TEMPLATE_SCOPES` / `TemplateScope` / `templateScopeSchema` / `TEMPLATE_STATUSES` / `TemplateStatus` / `templateStatusSchema` / `manifestJsonSchema` / `TemplateManifest`。（`TEMPLATE_SCOPES`/`TEMPLATE_STATUSES` 两组是 `TemplateDto` 所需，编排 prompt 未列，属补齐。）

- [ ] **Step 1: 加依赖**

Run:
```bash
pnpm --filter @moment/dto add json-schema-to-ts@^3.1.1
pnpm --filter @moment/dto add -D ajv@^8.17.1
```
Expected: 两命令 exit 0，`packages/dto/package.json` 的 `dependencies` 出现 `json-schema-to-ts`、`devDependencies` 出现 `ajv`。

- [ ] **Step 2: 写失败测试**

Create `packages/dto/src/templates.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_VIEW_TYPES,
  manifestJsonSchema,
} from './templates.js';

const ajv = new Ajv2020({ allErrors: true });
const validateManifest = ajv.compile(manifestJsonSchema);

test('词表：字段与视图类型锁定为 spec 词表', () => {
  assert.deepEqual(TEMPLATE_FIELD_TYPES, ['text', 'number-unit', 'enum', 'date', 'geo', 'emoji-picker']);
  assert.deepEqual(TEMPLATE_VIEW_TYPES, ['timeline', 'curve', 'map', 'moodline', 'milestone-axis']);
});

test('meta-schema：最小 manifest {version:1} 合法', () => {
  assert.equal(validateManifest({ version: 1 }), true, JSON.stringify(validateManifest.errors));
});

test('meta-schema：拒绝词表外字段/视图类型', () => {
  assert.equal(
    validateManifest({ version: 1, momentFields: [{ key: 'mood', type: 'slider', label: '心情' }] }),
    false,
  );
  assert.equal(validateManifest({ version: 1, views: [{ type: 'kanban', label: '看板' }] }), false);
});

test('meta-schema：拒绝非法 key 与多余顶层属性', () => {
  assert.equal(
    validateManifest({
      version: 1,
      kinds: [{ key: 'BadKey', label: 'x', payloadSchema: { type: 'object' } }],
    }),
    false,
  );
  assert.equal(validateManifest({ version: 1, hacker: true }), false);
});

test('meta-schema：version 必填且为 >=1 整数', () => {
  assert.equal(validateManifest({}), false);
  assert.equal(validateManifest({ version: 0 }), false);
  assert.equal(validateManifest({ version: 1.5 }), false);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`Cannot find module './templates.js'`（或等效模块解析错误）。

- [ ] **Step 4: 实现 `templates.ts`（词表 + meta-schema + 类型）**

Create `packages/dto/src/templates.ts`：
```ts
import { z } from 'zod';
import type { FromSchema } from 'json-schema-to-ts';

// ---------- 词表（spec §1.2 硬约束：词表外一律拒收） ----------

export const TEMPLATE_FIELD_TYPES = ['text', 'number-unit', 'enum', 'date', 'geo', 'emoji-picker'] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export const TEMPLATE_VIEW_TYPES = ['timeline', 'curve', 'map', 'moodline', 'milestone-axis'] as const;
export type TemplateViewType = (typeof TEMPLATE_VIEW_TYPES)[number];

export const TEMPLATE_SCOPES = ['official', 'user'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];
export const templateScopeSchema = z.enum(TEMPLATE_SCOPES);

export const TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const templateStatusSchema = z.enum(TEMPLATE_STATUSES);

// ---------- manifest meta-schema（spec §1.3；纯数据 DSL，禁止函数/组件引用） ----------

/** kind/field/catalog 项的 key 规范：小写 slug。 */
const TEMPLATE_KEY_PATTERN = '^[a-z][a-z0-9-]{0,49}$';

export const manifestJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', minimum: 1 },
    /** 链级 payload 的 JSON Schema（宝宝生日、行程列表等）；省略 = 该模板无链级数据 */
    chainPayloadSchema: { type: 'object' },
    /** 结构化 moment 类别（milestone/metric…）；省略视同空数组 */
    kinds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'payloadSchema'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
          label: { type: 'string', minLength: 1, maxLength: 50 },
          payloadSchema: { type: 'object' },
          publisher: {
            type: 'object',
            required: ['entry', 'label'],
            additionalProperties: false,
            properties: {
              entry: { type: 'string', enum: ['button'] },
              label: { type: 'string', minLength: 1, maxLength: 50 },
            },
          },
        },
      },
    },
    /** 附加在普通 moment 上的扩展字段；值 schema 由 type(+options) 派生（P2 server 实现） */
    momentFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'type', 'label'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
          type: { enum: TEMPLATE_FIELD_TYPES },
          label: { type: 'string', minLength: 1, maxLength: 50 },
          options: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 50 },
            minItems: 1,
          },
        },
      },
    },
    views: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'label'],
        additionalProperties: false,
        properties: {
          type: { enum: TEMPLATE_VIEW_TYPES },
          label: { type: 'string', minLength: 1, maxLength: 50 },
          source: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
              field: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
            },
          },
          /** 分章维度（词表值，当前仅 'trips'、仅 timeline 视图可用）：渲染器按链 payload.trips 分章 */
          groupBy: { type: 'string', enum: ['trips'] },
        },
      },
    },
    /** 里程碑目录：内置选项，用户发 moment 时可自定义追加（custom_label） */
    milestoneCatalog: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
          label: { type: 'string', minLength: 1, maxLength: 50 },
          icon: { type: 'string', minLength: 1, maxLength: 8 },
        },
      },
    },
  },
} as const;

/** 模板 manifest 类型：从 meta-schema 生成，禁止手写平行类型（spec §1.4）。 */
export type TemplateManifest = FromSchema<typeof manifestJsonSchema>;
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，5 个测试全过（输出含 `pass 5`、`fail 0`）。

- [ ] **Step 6: 构建确认 `FromSchema` 类型可生成**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。若 `FromSchema` 推导报错（如 readonly enum 不被识别），**停手报告实际报错文本**，不得自行改设计绕过。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/package.json packages/dto/src/templates.ts packages/dto/src/templates.test.ts pnpm-lock.yaml
git commit -m "feat(dto): add template vocab and manifest meta-schema"
```

---

### Task 2: 三份官方模板常量 + parity 测试

**Files:**
- Modify: `packages/dto/src/templates.ts`（追加 `OfficialTemplate` / `OFFICIAL_TEMPLATES`）
- Test: `packages/dto/src/templates.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `TemplateManifest`、`manifestJsonSchema`。
- Produces: `interface OfficialTemplate { key: 'baby' | 'travel' | 'daily'; name: string; description: string; icon: string; manifest: TemplateManifest }`、`OFFICIAL_TEMPLATES: readonly OfficialTemplate[]`（server P2 迁移 seed 的唯一数据源）。

- [ ] **Step 1: 追加失败测试**

Append to `packages/dto/src/templates.test.ts`：
```ts
import { OFFICIAL_TEMPLATES } from './templates.js';

test('parity：三份官方 manifest 全部通过 meta-schema 自校验', () => {
  assert.equal(OFFICIAL_TEMPLATES.length, 3);
  for (const t of OFFICIAL_TEMPLATES) {
    assert.equal(validateManifest(t.manifest), true, `${t.key}: ${JSON.stringify(validateManifest.errors)}`);
  }
});

test('baby：里程碑/成长记录 kinds + 目录 + 两视图', () => {
  const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!;
  const kinds = baby.manifest.kinds?.map((k) => k.key) ?? [];
  assert.deepEqual(kinds, ['milestone', 'metric']);
  assert.ok((baby.manifest.milestoneCatalog?.length ?? 0) >= 5);
  assert.deepEqual(baby.manifest.views?.map((v) => v.type), ['milestone-axis', 'curve']);
});

test('travel：geo 字段 + 地图/行程视图；daily：心情字段 + 心情曲线', () => {
  const travel = OFFICIAL_TEMPLATES.find((t) => t.key === 'travel')!;
  assert.deepEqual(travel.manifest.momentFields?.map((f) => f.key), ['geo']);
  assert.deepEqual(travel.manifest.views?.map((v) => v.type), ['map', 'timeline']);
  assert.equal(travel.manifest.views?.[1]?.groupBy, 'trips');
  const daily = OFFICIAL_TEMPLATES.find((t) => t.key === 'daily')!;
  assert.deepEqual(daily.manifest.momentFields?.map((f) => f.key), ['mood']);
  assert.deepEqual(daily.manifest.views?.map((v) => v.type), ['moodline']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`OFFICIAL_TEMPLATES` 未导出（`"OFFICIAL_TEMPLATES" is not exported` 类错误）。

- [ ] **Step 3: 追加官方模板实现**

Append to `packages/dto/src/templates.ts`：
```ts
// ---------- 官方模板（spec §4；server P2 迁移 seed 的唯一数据源） ----------

export interface OfficialTemplate {
  key: 'baby' | 'travel' | 'daily';
  name: string;
  description: string;
  icon: string;
  manifest: TemplateManifest;
}

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const OFFICIAL_TEMPLATES: readonly OfficialTemplate[] = [
  {
    key: 'baby',
    name: '宝宝成长',
    description: '里程碑时间轴与身高体重曲线，记录宝宝每一步',
    icon: '👶',
    manifest: {
      version: 1,
      chainPayloadSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          baby_name: { type: 'string', minLength: 1, maxLength: 50 },
          birthdate: { type: 'string', pattern: DATE_PATTERN },
          gender: { type: 'string', enum: ['boy', 'girl', 'unknown'] },
        },
      },
      kinds: [
        {
          key: 'milestone',
          label: '里程碑',
          payloadSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              catalog_key: { type: 'string', pattern: TEMPLATE_KEY_PATTERN },
              custom_label: { type: 'string', minLength: 1, maxLength: 50 },
              note: { type: 'string', maxLength: 500 },
            },
            anyOf: [{ required: ['catalog_key'] }, { required: ['custom_label'] }],
          },
          publisher: { entry: 'button', label: '记一个里程碑' },
        },
        {
          key: 'metric',
          label: '成长记录',
          payloadSchema: {
            type: 'object',
            required: ['metric', 'value', 'unit'],
            additionalProperties: false,
            properties: {
              metric: { type: 'string', enum: ['height', 'weight'] },
              value: { type: 'number', exclusiveMinimum: 0 },
              unit: { type: 'string', enum: ['cm', 'kg'] },
            },
          },
          publisher: { entry: 'button', label: '记身高体重' },
        },
      ],
      views: [
        { type: 'milestone-axis', label: '里程碑', source: { kind: 'milestone' } },
        { type: 'curve', label: '成长曲线', source: { kind: 'metric' } },
      ],
      milestoneCatalog: [
        { key: 'first-smile', label: '第一次微笑', icon: '😊' },
        { key: 'first-roll', label: '第一次翻身', icon: '🔄' },
        { key: 'first-sit', label: '第一次独坐', icon: '🪑' },
        { key: 'first-crawl', label: '第一次爬', icon: '🐾' },
        { key: 'first-stand', label: '第一次站立', icon: '🧍' },
        { key: 'first-steps', label: '第一次走路', icon: '👣' },
        { key: 'first-word', label: '第一次开口', icon: '💬' },
        { key: 'first-tooth', label: '第一颗牙', icon: '🦷' },
      ],
    },
  },
  {
    key: 'travel',
    name: '旅行',
    description: '地图足迹与按行程分章节的旅行相册',
    icon: '✈️',
    manifest: {
      version: 1,
      chainPayloadSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trips: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              required: ['name', 'start', 'end'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 100 },
                start: { type: 'string', pattern: DATE_PATTERN },
                end: { type: 'string', pattern: DATE_PATTERN },
                cover_media_id: { type: 'string', maxLength: 36 },
              },
            },
          },
        },
      },
      momentFields: [{ key: 'geo', type: 'geo', label: '添加位置' }],
      views: [
        { type: 'map', label: '足迹地图', source: { field: 'geo' } },
        { type: 'timeline', label: '行程', source: {}, groupBy: 'trips' },
      ],
    },
  },
  {
    key: 'daily',
    name: '日常生活',
    description: '记录日常，标一抹心情',
    icon: '🏠',
    manifest: {
      version: 1,
      momentFields: [
        { key: 'mood', type: 'emoji-picker', label: '此刻心情', options: ['😄', '🥰', '😭', '😤', '😴'] },
      ],
      views: [{ type: 'moodline', label: '心情曲线', source: { field: 'mood' } }],
    },
  },
];
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test`
Expected: PASS，累计 8 个测试全过（`pass 8`、`fail 0`）。

- [ ] **Step 5: 构建确认官方模板字面量与 `TemplateManifest` 类型相容**

Run: `pnpm --filter @moment/dto build`
Expected: exit 0。若类型不相容（`OfficialTemplate[]` 注解处报错），**停手报告实际报错文本**。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/templates.ts packages/dto/src/templates.test.ts
git commit -m "feat(dto): add official chain templates"
```

---

### Task 3: 模板 CRUD 的 zod 输入 schema + `TemplateDto` + barrel 导出

**Files:**
- Modify: `packages/dto/src/templates.ts`（追加）、`packages/dto/src/index.ts`（barrel 加一行）
- Test: `packages/dto/src/templates.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1/2 全部符号。
- Produces: `createTemplateInputSchema` / `CreateTemplateInput` / `updateTemplateInputSchema` / `UpdateTemplateInput` / `TemplateDto`；`@moment/dto` barrel 导出全部模板域符号（server P2、api-client、web/app 消费）。

- [ ] **Step 1: 追加失败测试**

Append to `packages/dto/src/templates.test.ts`：
```ts
import {
  createTemplateInputSchema,
  updateTemplateInputSchema,
} from './templates.js';

test('createTemplateInputSchema：合法输入通过，name trim', () => {
  const input = createTemplateInputSchema.parse({
    name: '  喂奶记录  ',
    icon: '🍼',
    manifest: { version: 1 },
  });
  assert.equal(input.name, '喂奶记录');
  assert.equal(input.description, undefined);
});

test('createTemplateInputSchema：缺 manifest/icon 或 name 超长被拒', () => {
  assert.throws(() => createTemplateInputSchema.parse({ name: 'x', icon: '🍼' }));
  assert.throws(() => createTemplateInputSchema.parse({ name: 'x', manifest: { version: 1 } }));
  assert.throws(() =>
    createTemplateInputSchema.parse({ name: 'x'.repeat(51), icon: '🍼', manifest: { version: 1 } }),
  );
});

test('updateTemplateInputSchema：拒绝空 patch；description 可显式置 null', () => {
  assert.throws(() => updateTemplateInputSchema.parse({}));
  const ok = updateTemplateInputSchema.parse({ description: null });
  assert.equal(ok.description, null);
  const withManifest = updateTemplateInputSchema.parse({ manifest: { version: 2 } });
  assert.deepEqual(withManifest.manifest, { version: 2 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`createTemplateInputSchema` 未导出。

- [ ] **Step 3: 追加 zod schema 与 DTO，并接 barrel**

Append to `packages/dto/src/templates.ts`：
```ts
// ---------- 模板 CRUD 契约（spec §3.1） ----------

/**
 * manifest 在 dto 层只做「存在性」校验；结构化校验（meta-schema + 词表白名单
 * + 嵌套 payloadSchema 合法性 + 增量编辑检查）由 server 经 ajv 完成（P2），
 * 避免 dto 引入 ajv 运行时依赖。
 */
export const createTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500).nullish(),
  /** 单个 emoji（或短符号），禁止 URL；spec §2.1「icon 从词表选」的最小实现 */
  icon: z.string().min(1).max(8),
  /** 必填的对象（z.record 要求 object 且缺 key 会抛错）；结构化校验在 server 侧 */
  manifest: z.record(z.unknown()),
});
export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().min(1).max(8).optional(),
    manifest: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field required',
  });
export type UpdateTemplateInput = z.infer<typeof updateTemplateInputSchema>;

export interface TemplateDto {
  id: string;
  /** official：保留 slug（baby/travel/daily）；user：server 分配 `u/<nanoid>` */
  key: string;
  scope: TemplateScope;
  /** user 模板创建者；official 为 null */
  ownerId: string | null;
  name: string;
  description: string | null;
  icon: string;
  manifest: TemplateManifest;
  version: number;
  status: TemplateStatus;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}
```

Modify `packages/dto/src/index.ts` — 在 `export * from './memories.js';` 之后追加一行：
```ts
export * from './templates.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 测试累计 11 个全过（`pass 11`、`fail 0`）；build exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/templates.ts packages/dto/src/templates.test.ts packages/dto/src/index.ts
git commit -m "feat(dto): add template input schemas and TemplateDto"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/dto test` 全绿（11 个测试）
- [ ] `pnpm --filter @moment/dto build` exit 0（`FromSchema` 类型链路成立）
- [ ] `pnpm --filter @moment/dto lint` exit 0
- [ ] spec §1.3 manifest 结构六字段（version/chainPayloadSchema/kinds/momentFields/views/milestoneCatalog）全部在 meta-schema 中有定义；spec §4 三模板内容与 `OFFICIAL_TEMPLATES` 逐项一致
- [ ] 执行 prompt T1 的 Produces 符号逐个可在 `@moment/dto` 解析到
