import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chainAppearanceColorSchema,
  chainColorSchema,
  chainIconSchema,
  chainImageFocusSchema,
  createChainInputSchema,
  createInviteInputSchema,
  reorderChainsInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
  type ChainDto,
  type ChainMemberPreview,
} from './chains.js';

test('createChainInputSchema：visibility 默认 private，name trim', () => {
  const input = createChainInputSchema.parse({ name: '  宝宝成长  ', template: 'daily' });
  assert.equal(input.name, '宝宝成长');
  assert.equal(input.visibility, 'private');
  assert.equal(input.description, undefined);
});

test('createChainInputSchema：拒绝空 name 与非法 visibility', () => {
  assert.throws(() => createChainInputSchema.parse({ name: '', template: 'daily' }));
  assert.throws(() => createChainInputSchema.parse({ name: 'x', template: 'daily', visibility: 'friends' }));
});

test('updateChainInputSchema：拒绝空 patch；description 可显式置 null', () => {
  assert.throws(() => updateChainInputSchema.parse({}));
  const ok = updateChainInputSchema.parse({ description: null });
  assert.equal(ok.description, null);
});

test('create/update 接受预设色与图标，拒绝非法色与非 Emoji 图标', () => {
  const created = createChainInputSchema.parse({ name: '宝宝', template: 'daily', color: 'mint', icon: '👶' });
  assert.equal(created.color, 'mint');
  assert.equal(created.icon, '👶');
  assert.throws(() => createChainInputSchema.parse({ name: 'x', template: 'daily', color: 'neon' }));
  assert.throws(() => createChainInputSchema.parse({ name: 'x', template: 'daily', icon: 'not-an-emoji' }));
  const cleared = updateChainInputSchema.parse({ icon: null, color: 'gold' });
  assert.equal(cleared.icon, null);
  assert.equal(cleared.color, 'gold');
});

test('链自定义色规范化；既有 ChainColor 仍只接受预设', () => {
  assert.equal(chainAppearanceColorSchema.parse('#a1b2c3'), '#A1B2C3');
  assert.equal(chainAppearanceColorSchema.parse('mint'), 'mint');
  assert.throws(() => chainAppearanceColorSchema.parse('#abc'));
  assert.throws(() => chainColorSchema.parse('#A1B2C3'));
});

test('链 Emoji 接受单个组合序列并拒绝文本或多个 Emoji', () => {
  for (const icon of ['👶🏽', '🏳️‍🌈', '👨‍👩‍👧‍👦']) assert.equal(chainIconSchema.parse(icon), icon);
  for (const icon of ['', 'family', '😀😃']) assert.throws(() => chainIconSchema.parse(icon));
});

test('图片模式拒绝与 color/icon 混传；旧 color+icon 仍可解析', () => {
  const legacy = createChainInputSchema.parse({ name: '旧端', template: 'daily', color: 'mint', icon: '👶' });
  assert.equal(legacy.icon, '👶');
  assert.throws(() => createChainInputSchema.parse({
    name: '冲突', template: 'daily', color: 'mint', avatarMediaId: '00000000-0000-4000-8000-000000000001',
  }));
});

test('focus 边界与删除封面组合', () => {
  assert.deepEqual(chainImageFocusSchema.parse({ x: 0, y: 1 }), { x: 0, y: 1 });
  assert.throws(() => chainImageFocusSchema.parse({ x: -0.01, y: 0.5 }));
  assert.throws(() => createChainInputSchema.parse({
    name: '无图焦点', template: 'daily', coverFocus: { x: 0.5, y: 0.5 },
  }));
  assert.throws(() => updateChainInputSchema.parse({ coverMediaId: null, coverFocus: { x: 0.5, y: 0.5 } }));
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

test('ChainMemberPreview 只有四字段；ChainDto 要求 membersPreview + memberCount', () => {
  const preview: ChainMemberPreview = {
    userId: 'u1',
    nickname: '妈',
    avatarUrl: null,
    role: 'owner',
  };
  assert.deepEqual(Object.keys(preview).sort(), ['avatarUrl', 'nickname', 'role', 'userId']);
  const slice: Pick<ChainDto, 'membersPreview' | 'memberCount'> = {
    membersPreview: [preview],
    memberCount: 1,
  };
  assert.equal(slice.memberCount, 1);
  assert.equal(slice.membersPreview[0].role, 'owner');
});

test('createChainInputSchema：template 必填；payload 仅接受对象或 null', () => {
  assert.throws(() => createChainInputSchema.parse({ name: 'x' })); // 缺 template
  const ok = createChainInputSchema.parse({ name: 'x', template: 'baby', payload: { birthdate: '2025-01-01' } });
  assert.equal(ok.template, 'baby');
  assert.deepEqual(ok.payload, { birthdate: '2025-01-01' });
  assert.throws(() => createChainInputSchema.parse({ name: 'x', template: 'baby', payload: 'nope' }));
});

test('updateChainInputSchema：payload 可改、可显式置 null；schema 不含 template 键', () => {
  const ok = updateChainInputSchema.parse({ payload: { birthdate: '2025-01-01' } });
  assert.deepEqual(ok.payload, { birthdate: '2025-01-01' });
  const cleared = updateChainInputSchema.parse({ payload: null });
  assert.equal(cleared.payload, null);
  // template 不在 schema 内（zod 默认剥离未知键）；改 template 的 TEMPLATE_IMMUTABLE 由 server controller 检测原始 body（Task 4）。
  // 注意：updateChainInputSchema 带 .refine()，类型是 ZodEffects 没有 .shape——用 parse 行为断言（传入 template 被剥离）
  const stripped = updateChainInputSchema.parse({ name: '改名', template: 'baby' });
  assert.equal('template' in stripped, false);
});

test('reorderChainsInputSchema：正常与空数组（无链用户恒等提交）通过', () => {
  assert.deepEqual(reorderChainsInputSchema.parse({ chainIds: ['a', 'b'] }), { chainIds: ['a', 'b'] });
  assert.deepEqual(reorderChainsInputSchema.parse({ chainIds: [] }), { chainIds: [] });
});

test('reorderChainsInputSchema：200 条恰好通过；36 字符 id 恰好通过', () => {
  assert.ok(
    reorderChainsInputSchema.safeParse({ chainIds: Array.from({ length: 200 }, (_, i) => `c${i}`) }).success,
  );
  assert.ok(reorderChainsInputSchema.safeParse({ chainIds: ['x'.repeat(36)] }).success);
});

test('reorderChainsInputSchema：拒绝空 id、超 36 字符 id、超 200 长度、缺键/非数组', () => {
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: [''] }));
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: ['x'.repeat(37)] }));
  assert.throws(() =>
    reorderChainsInputSchema.parse({ chainIds: Array.from({ length: 201 }, (_, i) => `c${i}`) }),
  );
  assert.throws(() => reorderChainsInputSchema.parse({}));
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: 'c1' }));
});
