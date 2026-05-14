import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentInputSchema, patchMomentInputSchema } from './moments.js';

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
