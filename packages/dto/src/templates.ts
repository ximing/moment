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
  /** official：保留 slug（baby/travel/daily）；user：server 分配 `u_` + 21 位十六进制随机 */
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
