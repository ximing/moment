import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentInputSchema, updateMomentInputSchema } from './moments.js';

const baseInput = {
  type: 'text' as const,
  content: '内容',
  happenedAt: '2026-01-01T00:00:00.000Z',
  happenedTzOffset: -480,
};

test('createMomentInputSchema 接受合法 tagIds 且去重由服务端处理', () => {
  const input = createMomentInputSchema.parse({
    ...baseInput,
    tagIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
  });
  assert.equal(input.tagIds?.length, 2);
});

test('createMomentInputSchema 的 tagIds 可省略', () => {
  const input = createMomentInputSchema.parse(baseInput);
  assert.equal(input.tagIds, undefined);
});

test('createMomentInputSchema 拒绝非 uuid 的 tagId', () => {
  assert.throws(() => createMomentInputSchema.parse({ ...baseInput, tagIds: ['not-a-uuid'] }));
});

test('createMomentInputSchema 拒绝超过 20 个 tag', () => {
  const tagIds = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.throws(() => createMomentInputSchema.parse({ ...baseInput, tagIds }));
});

test('updateMomentInputSchema 接受仅含 tagIds 的部分更新', () => {
  const input = updateMomentInputSchema.parse({
    tagIds: ['00000000-0000-4000-8000-000000000003'],
  });
  assert.deepEqual(input.tagIds, ['00000000-0000-4000-8000-000000000003']);
});
