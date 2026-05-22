import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REACTION_EMOJIS, createCommentInputSchema, reactionInputSchema } from './comments.js';

test('REACTION_EMOJIS 白名单 10 个、无重复', () => {
  assert.equal(REACTION_EMOJIS.length, 10);
  assert.equal(new Set(REACTION_EMOJIS).size, 10);
});

test('reactionInputSchema 只接受白名单 emoji', () => {
  assert.equal(reactionInputSchema.parse({ emoji: '👍' }).emoji, '👍');
  assert.throws(() => reactionInputSchema.parse({ emoji: '🔥' }));
  assert.throws(() => reactionInputSchema.parse({}));
});

test('createCommentInputSchema trim、1–1000 字', () => {
  assert.equal(createCommentInputSchema.parse({ content: '  好可爱  ' }).content, '好可爱');
  assert.throws(() => createCommentInputSchema.parse({ content: '   ' }));
  assert.throws(() => createCommentInputSchema.parse({ content: 'x'.repeat(1001) }));
  assert.ok(createCommentInputSchema.parse({ content: 'x'.repeat(1000) }));
});
