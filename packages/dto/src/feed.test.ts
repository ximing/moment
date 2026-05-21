import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedQuerySchema } from './feed.js';

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
