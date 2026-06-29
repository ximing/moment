import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePasswordInputSchema, loginInputSchema, registerInputSchema, updateMeInputSchema } from './auth.js';

test('registerInputSchema 归一化 email（trim + lowercase）', () => {
  const input = registerInputSchema.parse({
    email: '  Alice@Example.COM ',
    password: 'secret123',
    nickname: 'Alice',
  });
  assert.equal(input.email, 'alice@example.com');
});

test('registerInputSchema 拒绝非法 email', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'not-an-email', password: 'secret123', nickname: 'A' })
  );
});

test('registerInputSchema 拒绝过短密码（<8）', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'a@b.com', password: 'short', nickname: 'A' })
  );
});

test('registerInputSchema 拒绝空 nickname', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'a@b.com', password: 'secret123', nickname: '' })
  );
});

test('updateMeInputSchema：拒绝空 patch；接受头像色/图标与 mediaId', () => {
  assert.throws(() => updateMeInputSchema.parse({}));
  const ok = updateMeInputSchema.parse({ avatarColor: 'mint', avatarIcon: '⭐' });
  assert.equal(ok.avatarColor, 'mint');
  assert.equal(ok.avatarIcon, '⭐');
  const bound = updateMeInputSchema.parse({ avatarMediaId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(bound.avatarMediaId, '11111111-1111-4111-8111-111111111111');
  const cleared = updateMeInputSchema.parse({ avatarMediaId: null });
  assert.equal(cleared.avatarMediaId, null);
});

test('loginInputSchema 同样归一化 email', () => {
  const input = loginInputSchema.parse({ email: 'Bob@Example.com', password: 'x' });
  assert.equal(input.email, 'bob@example.com');
});

test('changePasswordInputSchema：新密码对齐 register 规则（8–72），旧密码非空即可', () => {
  const ok = changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'new-secret-1' });
  assert.equal(ok.newPassword, 'new-secret-1');
  assert.throws(() => changePasswordInputSchema.parse({ oldPassword: '', newPassword: 'new-secret-1' }));
  assert.throws(() => changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'short' }));
  assert.throws(() => changePasswordInputSchema.parse({ oldPassword: 'x', newPassword: 'a'.repeat(73) }));
});
