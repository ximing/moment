import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedQuerySchema, monthIndexQuerySchema } from './feed.js';

test('feedQuerySchema 全默认值', () => {
  const q = feedQuerySchema.parse({});
  assert.equal(q.order, 'happened_at');
  assert.equal(q.limit, 20);
  assert.equal(q.cursor, undefined);
  assert.equal(q.chain_ids, undefined);
  assert.equal(q.tag_id, undefined);
});

test('feedQuerySchema limit 由字符串 coerce，上限 50', () => {
  assert.equal(feedQuerySchema.parse({ limit: '7' }).limit, 7);
  assert.throws(() => feedQuerySchema.parse({ limit: '51' }));
  assert.throws(() => feedQuerySchema.parse({ limit: '0' }));
});

test('feedQuerySchema order 只接受两个枚举值', () => {
  assert.equal(feedQuerySchema.parse({ order: 'created_at' }).order, 'created_at');
  assert.throws(() => feedQuerySchema.parse({ order: 'updated_at' }));
});

test('feedQuerySchema chain_ids 必须是逗号分隔 uuid', () => {
  const ok = feedQuerySchema.parse({
    chain_ids: '00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002',
  });
  assert.equal(ok.chain_ids?.split(',').length, 2);
  assert.throws(() => feedQuerySchema.parse({ chain_ids: 'not-uuid' }));
  assert.throws(() => feedQuerySchema.parse({ chain_ids: '00000000-0000-4000-8000-000000000001,' }));
});

test('feedQuerySchema tag_id 必须 uuid', () => {
  assert.throws(() => feedQuerySchema.parse({ tag_id: 'nope' }));
});

test('feedQuerySchema before 接受 ISO datetime，缺省为 undefined', () => {
  assert.equal(feedQuerySchema.parse({}).before, undefined);
  const q = feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' });
  assert.equal(q.before, '2026-08-01T00:00:00.000Z');
});

test('feedQuerySchema before 拒绝非法 datetime', () => {
  assert.throws(() => feedQuerySchema.parse({ before: 'not-a-date' }));
  assert.throws(() => feedQuerySchema.parse({ before: '2026-13-99' }));
});

test('feedQuerySchema 拒绝 before + order=created_at（VALIDATION_ERROR 路径）', () => {
  assert.throws(() =>
    feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z', order: 'created_at' }),
  );
  // before + 默认 order(happened_at) 合法
  assert.equal(
    feedQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' }).order,
    'happened_at',
  );
});

test('monthIndexQuerySchema tz_offset 必填且为 -840..840 的整数（coerce）', () => {
  assert.throws(() => monthIndexQuerySchema.parse({})); // 缺省 → coerce(undefined)=NaN → 拒绝
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: 'abc' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '841' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '-841' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '-480.5' }));
  assert.equal(monthIndexQuerySchema.parse({ tz_offset: '-480' }).tz_offset, -480);
});

test('monthIndexQuerySchema chain_ids/tag_id 规则与 feedQuerySchema 一致', () => {
  const ok = monthIndexQuerySchema.parse({
    tz_offset: '0',
    chain_ids: '00000000-0000-4000-8000-000000000001',
    tag_id: '00000000-0000-4000-8000-000000000002',
  });
  assert.equal(ok.chain_ids, '00000000-0000-4000-8000-000000000001');
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '0', chain_ids: 'not-uuid' }));
  assert.throws(() => monthIndexQuerySchema.parse({ tz_offset: '0', tag_id: 'nope' }));
});

const UUID_A = '00000000-0000-4000-8000-000000000001';

test('feedQuerySchema：person_id 与 tag_id 同一 uuidLoose（非更严 z.uuid）', () => {
  assert.equal(feedQuerySchema.parse({ person_id: UUID_A }).person_id, UUID_A);
  assert.throws(() => feedQuerySchema.parse({ person_id: 'nope' }));
  // 全默认仍无新字段
  const q = feedQuerySchema.parse({});
  assert.equal(q.person_id, undefined);
  assert.equal(q.place, undefined);
  assert.equal(q.happened_from, undefined);
  assert.equal(q.happened_to, undefined);
});

test('feedQuerySchema：place trim 1..255', () => {
  assert.equal(feedQuerySchema.parse({ place: '  朝阳公园  ' }).place, '朝阳公园');
  assert.throws(() => feedQuerySchema.parse({ place: '' }));
  assert.throws(() => feedQuerySchema.parse({ place: 'x'.repeat(256) }));
});

test('feedQuerySchema：happened_from/to 用 isoDatetime，拒绝 2026/08/01', () => {
  const q = feedQuerySchema.parse({
    happened_from: '2026-08-01T00:00:00.000Z',
    happened_to: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(q.happened_from, '2026-08-01T00:00:00.000Z');
  assert.throws(() => feedQuerySchema.parse({ happened_from: '2026/08/01' }));
});

test('feedQuerySchema：happened_from > happened_to 用 Date.parse，带偏移不靠字典序', () => {
  // 字典序 from > to，瞬时 from < to → 合法
  const ok = feedQuerySchema.safeParse({
    happened_from: '2026-08-01T00:00:00+08:00',
    happened_to: '2026-07-31T23:00:00Z',
  });
  assert.ok(ok.success);

  const bad = feedQuerySchema.safeParse({
    happened_from: '2026-08-02T00:00:00.000Z',
    happened_to: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happened_to'));
  }
});

test('feedQuerySchema：区间 + order=created_at → RANGE_REQUIRES_HAPPENED_AT；before 仍 BEFORE_REQUIRES_HAPPENED_AT', () => {
  const range = feedQuerySchema.safeParse({
    happened_from: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!range.success);
  if (!range.success) {
    assert.ok(range.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
  const onlyTo = feedQuerySchema.safeParse({
    happened_to: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!onlyTo.success);

  const before = feedQuerySchema.safeParse({
    before: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.ok(!before.success);
  if (!before.success) {
    assert.ok(before.error.issues.some((i) => i.message === 'BEFORE_REQUIRES_HAPPENED_AT'));
    assert.ok(!before.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
});

test('monthIndexQuerySchema 不加 person_id/place/happened_*（spec §6.1）', () => {
  const q = monthIndexQuerySchema.parse({
    tz_offset: '0',
    person_id: UUID_A,
    place: '朝阳公园',
    happened_from: '2026-08-01T00:00:00.000Z',
  });
  assert.equal((q as { person_id?: string }).person_id, undefined);
  assert.equal((q as { place?: string }).place, undefined);
  assert.equal((q as { happened_from?: string }).happened_from, undefined);
});

