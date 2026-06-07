import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createChainInputSchema,
  createInviteInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
} from './chains.js';

test('createChainInputSchema：visibility 默认 private，name trim', () => {
  const input = createChainInputSchema.parse({ name: '  宝宝成长  ' });
  assert.equal(input.name, '宝宝成长');
  assert.equal(input.visibility, 'private');
  assert.equal(input.description, undefined);
});

test('createChainInputSchema：拒绝空 name 与非法 visibility', () => {
  assert.throws(() => createChainInputSchema.parse({ name: '' }));
  assert.throws(() => createChainInputSchema.parse({ name: 'x', visibility: 'friends' }));
});

test('updateChainInputSchema：拒绝空 patch；description 可显式置 null', () => {
  assert.throws(() => updateChainInputSchema.parse({}));
  const ok = updateChainInputSchema.parse({ description: null });
  assert.equal(ok.description, null);
});

test('create/update 接受预设色与图标，拒绝非法值', () => {
  const created = createChainInputSchema.parse({ name: '宝宝', color: 'mint', icon: '👶' });
  assert.equal(created.color, 'mint');
  assert.equal(created.icon, '👶');
  assert.throws(() => createChainInputSchema.parse({ name: 'x', color: 'neon' }));
  assert.throws(() => createChainInputSchema.parse({ name: 'x', icon: '💩' }));
  const cleared = updateChainInputSchema.parse({ icon: null, color: 'gold' });
  assert.equal(cleared.icon, null);
  assert.equal(cleared.color, 'gold');
});

test('updateMemberRoleInputSchema：不允许 owner（转让走专门端点）', () => {
  assert.throws(() => updateMemberRoleInputSchema.parse({ role: 'owner' }));
  assert.equal(updateMemberRoleInputSchema.parse({ role: 'viewer' }).role, 'viewer');
});

test('createInviteInputSchema：role 默认 editor，仅允许 editor/viewer，email 归一化', () => {
  const def = createInviteInputSchema.parse({});
  assert.equal(def.role, 'editor');
  assert.equal(def.email, undefined);
  assert.throws(() => createInviteInputSchema.parse({ role: 'owner' }));
  const withEmail = createInviteInputSchema.parse({ email: '  A@B.COM ' });
  assert.equal(withEmail.email, 'a@b.com');
});

test('transferChainInputSchema：要求 userId', () => {
  assert.throws(() => transferChainInputSchema.parse({}));
  assert.equal(transferChainInputSchema.parse({ userId: 'u1' }).userId, 'u1');
});
