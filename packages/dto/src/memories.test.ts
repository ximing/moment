import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoriesTodayQuerySchema } from './memories.js';

test('memoriesTodayQuerySchema 接受合法 YYYY-MM-DD', () => {
  assert.equal(memoriesTodayQuerySchema.parse({ date: '2026-08-18' }).date, '2026-08-18');
  // 闰日合法
  assert.equal(memoriesTodayQuerySchema.parse({ date: '2024-02-29' }).date, '2024-02-29');
});

test('memoriesTodayQuerySchema 拒绝非法形态', () => {
  assert.throws(() => memoriesTodayQuerySchema.parse({}));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-8-18' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026/08/18' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: 'not-a-date' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-08-18T00:00:00Z' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: 20260818 }));
});

test('memoriesTodayQuerySchema 拒绝不存在的历法日期（round-trip 校验）', () => {
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-02-30' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-13-01' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-00-10' }));
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-04-31' }));
  // 平年 2/29 非法
  assert.throws(() => memoriesTodayQuerySchema.parse({ date: '2026-02-29' }));
});

test('memoriesTodayQuerySchema 非法时 issue message 为 INVALID_DATE', () => {
  const res = memoriesTodayQuerySchema.safeParse({ date: '2026-02-30' });
  assert.equal(res.success, false);
  if (!res.success) {
    assert.equal(res.error.issues[0]?.message, 'INVALID_DATE');
  }
});
