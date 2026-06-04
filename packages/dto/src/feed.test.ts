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
