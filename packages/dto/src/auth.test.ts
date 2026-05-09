import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginInputSchema, registerInputSchema } from './auth.js';

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

test('loginInputSchema 同样归一化 email', () => {
  const input = loginInputSchema.parse({ email: 'Bob@Example.com', password: 'x' });
  assert.equal(input.email, 'bob@example.com');
});
