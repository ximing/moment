import { Ajv2020 } from 'ajv/dist/2020.js';
import { manifestJsonSchema, type TemplateManifest } from '@moment/dto';
import { BadRequestError, HttpError } from 'routing-controllers';

/** manifest 校验失败：message 为机器码（error-handler 约定），details 附 ajv 错误路径（spec §3.1）。 */
export class ManifestInvalidError extends HttpError {
  constructor(public details: unknown) {
    super(400, 'TEMPLATE_MANIFEST_INVALID');
    // routing-controllers 的 HttpError 构造函数里 Object.setPrototypeOf(this, HttpError.prototype) 会把子类原型抹平，
    // 导致 instanceof ManifestInvalidError 失败（只识别为 HttpError）。这里把原型恢复回子类，保证 instanceof 链正确。
    Object.setPrototypeOf(this, ManifestInvalidError.prototype);
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
      (compiled.errors ?? []).map((e: { instancePath: string; message?: string }) => ({
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
 * 取舍（已上报）：chainPayloadSchema 与既存 kind 的 payloadSchema 整体冻结（含 publisher 与目录项 label/icon），
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
    if (stableStringify(p.payloadSchema) !== stableStringify(n!.payloadSchema)) notAdditive();
    if (stableStringify(p.publisher ?? null) !== stableStringify(n!.publisher ?? null)) notAdditive();
  }

  const prevFields = new Map((prev.momentFields ?? []).map((f) => [f.key, f]));
  for (const [key, p] of prevFields) {
    const n = (next.momentFields ?? []).find((f) => f.key === key);
    if (!n) notAdditive();
    if (p.type !== n!.type) notAdditive();
    if (stableStringify(p.options ?? null) !== stableStringify(n!.options ?? null)) notAdditive();
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
    if (stableStringify(p) !== stableStringify(n!)) notAdditive();
  }
}
