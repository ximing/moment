import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentInputSchema, listMomentsQuerySchema, patchMomentInputSchema } from './moments.js';

const base = {
  type: 'text' as const,
  content: 'hello',
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

test('createMomentInputSchema：type=text 拒绝 mediaIds', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, mediaIds: ['m-1'] }).success);
});

test('createMomentInputSchema：type=text 拒绝空 content', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, content: '   ' }).success);
});

test('createMomentInputSchema：type=video 恰好 1 个 mediaId', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'video', content: '', mediaIds: [] }).success
  );
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'video',
      content: '',
      mediaIds: ['m-1', 'm-2'],
    }).success
  );
  assert.ok(
    createMomentInputSchema.safeParse({ ...base, type: 'video', content: '', mediaIds: ['m-1'] }).success
  );
});

test('createMomentInputSchema：type=media 1–9 个 mediaId', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: [] }).success
  );
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'media',
      content: '',
      mediaIds: Array.from({ length: 10 }, (_, i) => `m-${i}`),
    }).success
  );
  assert.ok(
    createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: ['m-1'] }).success
  );
});

test('createMomentInputSchema：mediaIds 含重复值 → 拒绝（MEDIA_COUNT_INVALID）', () => {
  const dup = {
    ...base,
    type: 'media' as const,
    content: '',
    mediaIds: ['m-1', 'm-1'],
  };
  const parsed = createMomentInputSchema.safeParse(dup);
  assert.ok(!parsed.success);
  // 重复穿透会导致发布事务对同一 tmp 对象 copy 两次（第二次 NoSuchKey），必须在 dto 层拦截
});

test('createMomentInputSchema：默认值 isBackfill=false、mediaIds=[]', () => {
  const parsed = createMomentInputSchema.parse(base);
  assert.equal(parsed.isBackfill, false);
  assert.deepEqual(parsed.mediaIds, []);
});

test('createMomentInputSchema：happenedAt 必须可解析、tzOffset 范围 ±14h（分钟）', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, happenedAt: 'not-a-date' }).success);
  assert.ok(!createMomentInputSchema.safeParse({ ...base, happenedTzOffset: 900 }).success);
});

test('patchMomentInputSchema：仅四个字段、全 optional、.strict() 拒绝未知键（mediaIds/type）；空对象拒绝', () => {
  assert.ok(patchMomentInputSchema.safeParse({ content: 'new' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success); // 空补丁 → EMPTY_PATCH
  assert.ok(!patchMomentInputSchema.safeParse({ mediaIds: ['m-1'] }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'text' }).success);
});

test('listMomentsQuerySchema：cursor 空串/超长拒绝，缺省与合法串通过', () => {
  assert.ok(listMomentsQuerySchema.safeParse({}).success);
  assert.ok(listMomentsQuerySchema.safeParse({ cursor: 'abc', limit: '20' }).success);
  assert.ok(!listMomentsQuerySchema.safeParse({ cursor: '' }).success);
  assert.ok(!listMomentsQuerySchema.safeParse({ cursor: 'x'.repeat(1025) }).success);
});

test('listMomentsQuerySchema before 可选且必须是合法 datetime', () => {
  assert.equal(listMomentsQuerySchema.parse({}).before, undefined);
  assert.equal(
    listMomentsQuerySchema.parse({ before: '2026-08-01T00:00:00.000Z' }).before,
    '2026-08-01T00:00:00.000Z',
  );
  assert.throws(() => listMomentsQuerySchema.parse({ before: 'garbage' }));
});

test('listMomentsQuerySchema 既有行为不回退：cursor/limit 原样', () => {
  const q = listMomentsQuerySchema.parse({ cursor: 'abc', limit: '50' });
  assert.equal(q.cursor, 'abc');
  assert.equal(q.limit, '50'); // limit 仍是 string，service 层解析（INVALID_LIMIT 语义不动）
  assert.throws(() => listMomentsQuerySchema.parse({ cursor: '' }));
});

test('createMomentInputSchema：kind 默认 standard、非法 kind 拒绝、payload 仅对象', () => {
  const base = { type: 'text' as const, content: 'x', happenedAt: new Date().toISOString(), happenedTzOffset: -480 };
  const def = createMomentInputSchema.parse(base);
  assert.equal(def.kind, 'standard');
  assert.equal(def.payload, undefined);
  assert.equal(createMomentInputSchema.parse({ ...base, kind: 'milestone', payload: { catalog_key: 'first-smile' } }).kind, 'milestone');
  assert.throws(() => createMomentInputSchema.parse({ ...base, kind: 'Milestone' }));
  assert.throws(() => createMomentInputSchema.parse({ ...base, payload: 'nope' }));
});

test('patchMomentInputSchema：kind/payload 可选，strict 仍拒未知键', () => {
  const ok = patchMomentInputSchema.parse({ payload: { mood: '😄' } });
  assert.deepEqual(ok.payload, { mood: '😄' });
  assert.throws(() => patchMomentInputSchema.parse({ kind: 'milestone', hacker: 1 }));
});
