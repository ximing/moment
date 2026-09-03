import { OFFICIAL_TEMPLATES } from '@moment/dto';
import {
  ManifestInvalidError,
  assertAdditiveEdit,
  stableStringify,
  validateManifest,
} from '../../src/templates/manifest-validator.js';

const valid = () => ({ version: 1 }) as const;

describe('validateManifest', () => {
  it('最小 manifest 与五份 official manifest 全部通过', () => {
    expect(validateManifest(valid())).toEqual({ version: 1 });
    for (const t of OFFICIAL_TEMPLATES) {
      expect(() => validateManifest(t.manifest)).not.toThrow();
    }
  });

  it('meta-schema 拒绝：词表外类型 / 多余属性 / 非法 key，抛 ManifestInvalidError 且带 details', () => {
    let threw = false;
    try {
      validateManifest({ version: 1, momentFields: [{ key: 'x', type: 'slider', label: 'X' }] });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(ManifestInvalidError);
      expect((e as ManifestInvalidError).message).toBe('TEMPLATE_MANIFEST_INVALID');
      expect(Array.isArray((e as ManifestInvalidError).details)).toBe(true);
    }
    expect(threw).toBe(true);
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
