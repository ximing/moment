import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentThreadInputSchema, postAgentTurnInputSchema } from './agent.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

test('postAgentTurnInputSchema：trim、拒绝空内容、多余字段和坏 uuid', () => {
  assert.equal(postAgentTurnInputSchema.parse({ content: '  你好  ' }).content, '你好');
  assert.equal(postAgentTurnInputSchema.safeParse({ content: '' }).success, false);
  assert.equal(postAgentTurnInputSchema.safeParse({ content: '   ' }).success, false);
  assert.equal(postAgentTurnInputSchema.safeParse({ content: '你好', extra: 1 }).success, false);
  assert.equal(postAgentTurnInputSchema.safeParse({ content: 'x'.repeat(2001) }).success, false);
  assert.equal(postAgentTurnInputSchema.safeParse({ content: 'x'.repeat(2000) }).success, true);

  const withContext = postAgentTurnInputSchema.parse({
    content: '看看',
    context: { chainId: UUID },
  });
  assert.equal(withContext.context?.chainId, UUID);
  assert.equal(withContext.context?.momentId, undefined);

  assert.equal(postAgentTurnInputSchema.safeParse({ content: '看看', context: { chainId: 'nope' } }).success, false);
  assert.equal(
    postAgentTurnInputSchema.safeParse({ content: '看看', context: { momentId: 'not-a-uuid' } }).success,
    false,
  );
  assert.equal(postAgentTurnInputSchema.safeParse({ content: '看看', context: { extra: 1 } }).success, false);
  assert.equal(postAgentTurnInputSchema.safeParse({ content: '看看', context: { chainId: UUID, momentId: UUID } }).success, true);
});

test('createAgentThreadInputSchema：只接受空对象', () => {
  assert.deepEqual(createAgentThreadInputSchema.parse({}), {});
  assert.equal(createAgentThreadInputSchema.safeParse({ title: '新的对话' }).success, false);
  assert.equal(createAgentThreadInputSchema.safeParse(null).success, false);
});
