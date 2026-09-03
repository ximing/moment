import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_VIEW_TYPES,
  manifestJsonSchema,
  momentFieldPayloadJsonSchema,
  OFFICIAL_TEMPLATES,
  aggregateQuerySchema,
  createTemplateInputSchema,
  updateTemplateInputSchema,
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

test('parity：五份官方 manifest 全部通过 meta-schema 自校验', () => {
  assert.equal(OFFICIAL_TEMPLATES.length, 5);
  for (const t of OFFICIAL_TEMPLATES) {
    assert.equal(validateManifest(t.manifest), true, `${t.key}: ${JSON.stringify(validateManifest.errors)}`);
  }
});

test('官方模板共 5 份且全部过 manifestJsonSchema', () => {
  assert.deepEqual(
    OFFICIAL_TEMPLATES.map((t) => t.key),
    ['baby', 'travel', 'daily', 'reading', 'career'],
  );
  for (const t of OFFICIAL_TEMPLATES) {
    assert.equal(validateManifest(t.manifest), true, `${t.key}: ${JSON.stringify(validateManifest.errors)}`);
  }
});

test('reading rating 字段：icon key 选项经 momentFieldPayloadJsonSchema 派生 enum 校验', () => {
  const reading = OFFICIAL_TEMPLATES.find((t) => t.key === 'reading')!;
  const ratingField = reading.manifest.momentFields!.find((f) => f.key === 'rating')!;
  assert.equal(ratingField.type, 'emoji-picker');
  const validate = ajv.compile(momentFieldPayloadJsonSchema(ratingField));
  assert.equal(validate('rating-love'), true);
  assert.equal(validate('rating-pass'), true);
  assert.equal(validate('❤️'), false);
  assert.equal(validate('rating-nope'), false);
});

test('career-event payloadSchema 与 baby milestone 同构：catalog_key/custom_label 二选一', () => {
  const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!;
  const careerEvent = career.manifest.kinds!.find((k) => k.key === 'career-event')!;
  const validate = ajv.compile(careerEvent.payloadSchema);
  assert.equal(validate({ catalog_key: 'promotion' }), true);
  assert.equal(validate({ catalog_key: 'promotion', note: '带组 8 人' }), true);
  assert.equal(validate({ custom_label: '内部转组' }), true);
  assert.equal(validate({}), false, JSON.stringify(validate.errors));
  assert.equal(validate({ catalog_key: 'PROMOTION' }), false); // pattern 拒大写
  assert.equal(validate({ catalog_key: 'promotion', hacker: 1 }), false); // additionalProperties
});

test('reflection payloadSchema：topic 必填 1-50，decision/next_step 可选 ≤500', () => {
  const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!;
  const reflection = career.manifest.kinds!.find((k) => k.key === 'reflection')!;
  const validate = ajv.compile(reflection.payloadSchema);
  assert.equal(validate({ topic: '要不要接这个新机会' }), true);
  assert.equal(validate({ topic: 't', decision: 'd', next_step: 'n' }), true);
  assert.equal(validate({}), false);
  assert.equal(validate({ topic: '' }), false);
  assert.equal(validate({ topic: 'x'.repeat(51) }), false);
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

test('官方五模板 icon 为 tpl-* key，baby catalog icon 为 milestone-first-* key', () => {
  const byKey = new Map(OFFICIAL_TEMPLATES.map((t) => [t.key, t]));
  assert.equal(byKey.get('baby')!.icon, 'tpl-baby');
  assert.equal(byKey.get('travel')!.icon, 'tpl-travel');
  assert.equal(byKey.get('daily')!.icon, 'tpl-daily');
  assert.equal(byKey.get('reading')!.icon, 'tpl-reading');
  assert.equal(byKey.get('career')!.icon, 'tpl-career');
  const babyCatalog = byKey.get('baby')!.manifest.milestoneCatalog!;
  assert.deepEqual(
    babyCatalog.map((c) => c.icon),
    [
      'milestone-first-smile',
      'milestone-first-roll',
      'milestone-first-sit',
      'milestone-first-crawl',
      'milestone-first-stand',
      'milestone-first-steps',
      'milestone-first-word',
      'milestone-first-tooth',
    ],
  );
});

test('createTemplateInputSchema icon 50 收 51 拒', () => {
  const base = { name: 'x', manifest: { version: 1 } };
  assert.ok(createTemplateInputSchema.safeParse({ ...base, icon: 'a'.repeat(50) }).success);
  assert.ok(!createTemplateInputSchema.safeParse({ ...base, icon: 'a'.repeat(51) }).success);
});

test('updateTemplateInputSchema icon 50 收 51 拒', () => {
  assert.ok(updateTemplateInputSchema.safeParse({ icon: 'a'.repeat(50) }).success);
  assert.ok(!updateTemplateInputSchema.safeParse({ icon: 'a'.repeat(51) }).success);
});

test('manifest milestoneCatalog icon 50 收 51 拒（ajv 直测，同既有 meta-schema 用例写法）', () => {
  const catalog = (icon: string) => [{ key: 'first-smile', label: '第一次微笑', icon }];
  assert.equal(
    validateManifest({ version: 1, milestoneCatalog: catalog('a'.repeat(50)) }),
    true,
    JSON.stringify(validateManifest.errors),
  );
  assert.equal(validateManifest({ version: 1, milestoneCatalog: catalog('a'.repeat(51)) }), false);
});

test('aggregateQuerySchema：view 词表校验，kind/field 可选', () => {
  assert.equal(aggregateQuerySchema.parse({ view: 'curve' }).view, 'curve');
  assert.equal(aggregateQuerySchema.parse({ view: 'map', field: 'geo' }).field, 'geo');
  assert.throws(() => aggregateQuerySchema.parse({ view: 'pie' }));
  assert.throws(() => aggregateQuerySchema.parse({}));
});
