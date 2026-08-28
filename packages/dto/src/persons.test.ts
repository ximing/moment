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
