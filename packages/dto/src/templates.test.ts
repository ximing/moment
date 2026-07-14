import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_VIEW_TYPES,
  manifestJsonSchema,
  OFFICIAL_TEMPLATES,
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
