import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tagCreateInputSchema } from './tags.js';

test('tagCreateInputSchema trim 名称', () => {
  const input = tagCreateInputSchema.parse({ name: '  周岁  ' });
  assert.equal(input.name, '周岁');
});

test('tagCreateInputSchema 拒绝空名', () => {
  assert.throws(() => tagCreateInputSchema.parse({ name: '   ' }));
});

test('tagCreateInputSchema 拒绝超长名（>50）', () => {
  assert.throws(() => tagCreateInputSchema.parse({ name: 'x'.repeat(51) }));
});

test('tagCreateInputSchema 接受 50 字符名', () => {
  const input = tagCreateInputSchema.parse({ name: 'x'.repeat(50) });
  assert.equal(input.name.length, 50);
});
