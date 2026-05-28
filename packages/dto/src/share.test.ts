import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareLinkInputSchema, publicShareQuerySchema } from './share.js';

test('createShareLinkInputSchema：空对象合法（永不过期）', () => {
  assert.deepEqual(createShareLinkInputSchema.parse({}), {});
});

test('createShareLinkInputSchema：接受 ISO datetime，拒绝垃圾串与裸日期', () => {
  const iso = new Date('2027-01-01T00:00:00.000Z').toISOString();
  assert.deepEqual(createShareLinkInputSchema.parse({ expiresAt: iso }), { expiresAt: iso });
  assert.throws(() => createShareLinkInputSchema.parse({ expiresAt: 'not-a-date' }));
  assert.throws(() => createShareLinkInputSchema.parse({ expiresAt: '2027-01-01' }));
});

test('publicShareQuerySchema：limit 默认 20、字符串可 coerce、超界拒绝', () => {
  assert.deepEqual(publicShareQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(publicShareQuerySchema.parse({ limit: '30' }), { limit: 30 });
  assert.throws(() => publicShareQuerySchema.parse({ limit: 0 }));
  assert.throws(() => publicShareQuerySchema.parse({ limit: 51 }));
});

test('publicShareQuerySchema：cursor 空串与超长拒绝（Phase 4 游标边界约定，Phase 5/8 复用同一约定）', () => {
  assert.throws(() => publicShareQuerySchema.parse({ cursor: '' }));
  assert.throws(() => publicShareQuerySchema.parse({ cursor: 'x'.repeat(1025) }));
  assert.deepEqual(publicShareQuerySchema.parse({ cursor: 'abc' }), { cursor: 'abc', limit: 20 });
});
