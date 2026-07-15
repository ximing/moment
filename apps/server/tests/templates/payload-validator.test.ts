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
