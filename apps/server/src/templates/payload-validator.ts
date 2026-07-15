import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { momentFieldPayloadJsonSchema, type TemplateManifest } from '@moment/dto';
import { BadRequestError } from 'routing-controllers';

const ajv = new Ajv2020({ allErrors: false });
/** payloadSchema 编译缓存：manifest 内容不可变（编辑走 version+1 新对象），字符串化做 key 安全 */
const schemaCache = new Map<string, ValidateFunction>();

function compiled(schema: object): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const fn = ajv.compile(schema);
  schemaCache.set(key, fn);
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
