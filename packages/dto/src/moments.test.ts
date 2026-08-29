import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMomentInputSchema,
  listMomentsQuerySchema,
  patchMomentInputSchema,
  type MomentResponse,
} from './moments.js';

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

test('patchMomentInputSchema：.strict() 仍拒绝 type 与未知键；空对象 EMPTY_PATCH；mediaIds 非 uuid 失败', () => {
  assert.ok(patchMomentInputSchema.safeParse({ content: 'new' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'text' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'media' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ hacker: 1 }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ mediaIds: ['m-1'] }).success); // 非 uuid，不是未知键
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

test('createMomentInputSchema：type=video 带/不带 posterMediaId 均通过', () => {
  const video = { ...base, type: 'video' as const, content: '', mediaIds: ['m-1'] };
  assert.ok(createMomentInputSchema.safeParse(video).success);
  assert.ok(
    createMomentInputSchema.safeParse({ ...video, posterMediaId: 'poster-1' }).success
  );
});

test('createMomentInputSchema：type=text / media 传 posterMediaId → MEDIA_NOT_ALLOWED', () => {
  const text = createMomentInputSchema.safeParse({ ...base, posterMediaId: 'poster-1' });
  assert.ok(!text.success);
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'media' as const,
      content: '',
      mediaIds: ['m-1'],
      posterMediaId: 'poster-1',
    }).success
  );
});

test('createMomentInputSchema：posterMediaId 空串拒绝（min(1)）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'video' as const,
      content: '',
      mediaIds: ['m-1'],
      posterMediaId: '',
    }).success
  );
});

test('patchMomentInputSchema：posterMediaId uuid / null 通过 parse（server 再抛 MEDIA_NOT_ALLOWED）', () => {
  assert.ok(patchMomentInputSchema.safeParse({ posterMediaId: UUID_A }).success);
  assert.ok(patchMomentInputSchema.safeParse({ posterMediaId: null }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ posterMediaId: 'poster-1' }).success); // 非 uuid
});

test('createMomentInputSchema：type=voice mediaIds 1~9（0/10 拒绝，MEDIA_COUNT_INVALID）', () => {
  const voice = { ...base, type: 'voice' as const, content: '' };
  assert.ok(!createMomentInputSchema.safeParse({ ...voice, mediaIds: [] }).success);
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...voice,
      mediaIds: Array.from({ length: 10 }, (_, i) => `m-${i}`),
    }).success,
  );
  assert.ok(createMomentInputSchema.safeParse({ ...voice, mediaIds: ['a-1'] }).success);
  assert.ok(
    createMomentInputSchema.safeParse({ ...voice, mediaIds: Array.from({ length: 9 }, (_, i) => `m-${i}`) }).success,
  );
});

test('createMomentInputSchema：type=voice 重复 mediaId 拒绝（MEDIA_COUNT_INVALID）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'voice', content: '', mediaIds: ['m-1', 'm-1'] }).success,
  );
});

test('createMomentInputSchema：type=voice 空 content 通过（转写回填前无文本，spec §2.2）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, type: 'voice', content: '', mediaIds: ['a-1'] }).success);
});

test('createMomentInputSchema：type=voice 传 posterMediaId → MEDIA_NOT_ALLOWED（封面仅 video）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'voice',
      content: '',
      mediaIds: ['a-1'],
      posterMediaId: 'p-1',
    }).success,
  );
});

test('patchMomentInputSchema：.strict() 拒绝 transcript / transcriptionStatus（转写不可经 API 改）', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ transcript: 'x' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ transcriptionStatus: 'done' }).success);
});

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

const UUIDS10 = Array.from(
  { length: 10 },
  (_, i) => `123e4567-e89b-12d3-a456-4266141740${String(i).padStart(2, '0')}`,
);

test('patchMomentInputSchema：mediaIds 单 uuid / 空数组通过；仅 mediaIds 不是 EMPTY_PATCH', () => {
  assert.ok(patchMomentInputSchema.safeParse({ mediaIds: [UUID_A] }).success);
  assert.ok(patchMomentInputSchema.safeParse({ mediaIds: [] }).success);
  const emptyArr = patchMomentInputSchema.parse({ mediaIds: [] });
  assert.deepEqual(emptyArr.mediaIds, []);
});

test('patchMomentInputSchema：mediaIds 10 条 / 重复 id → 失败且 issue MEDIA_COUNT_INVALID', () => {
  const tooLong = patchMomentInputSchema.safeParse({ mediaIds: UUIDS10 });
  assert.ok(!tooLong.success);
  if (!tooLong.success) {
    assert.ok(tooLong.error.issues.some((i) => i.message === 'MEDIA_COUNT_INVALID' && i.path[0] === 'mediaIds'));
  }
  const dup = patchMomentInputSchema.safeParse({ mediaIds: [UUID_A, UUID_A] });
  assert.ok(!dup.success);
  if (!dup.success) {
    assert.ok(dup.error.issues.some((i) => i.message === 'MEDIA_COUNT_INVALID' && i.path[0] === 'mediaIds'));
  }
});

test('createMomentInputSchema：mediaIds 仍接受 m-1（create 不改）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: ['m-1'] }).success);
});

test('createMomentInputSchema：接受 personIds 与 place（spec §6）', () => {
  const r = createMomentInputSchema.safeParse({
    ...base,
    personIds: [UUID_A, UUID_B],
    place: { name: '北京', lat: 39.9, lng: 116.4 },
  });
  assert.ok(r.success);
});

test('createMomentInputSchema：place 仅坐标合法（EXIF 路）；place:null 在 create 等价未传（spec §6）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, place: { lat: 39.9, lng: 116.4 } }).success);
  assert.ok(createMomentInputSchema.safeParse({ ...base, place: null }).success);
});

test('createMomentInputSchema：personIds 超 20 / 非 uuid 拒绝', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, personIds: Array.from({ length: 21 }, () => UUID_A) }).success
  );
  assert.ok(!createMomentInputSchema.safeParse({ ...base, personIds: ['not-a-uuid'] }).success);
});

test('createMomentInputSchema：place 缺一半坐标 / 空对象拒绝（PLACE_COORDS_INVALID）', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, place: { lat: 39.9 } }).success);
  assert.ok(!createMomentInputSchema.safeParse({ ...base, place: {} }).success);
});

test('patchMomentInputSchema：place:null 显式清除是合法非空 patch（spec §6）', () => {
  assert.ok(patchMomentInputSchema.safeParse({ place: null }).success);
});

test('patchMomentInputSchema：personIds 空数组 = 清空全部人物，合法非空 patch', () => {
  assert.ok(patchMomentInputSchema.safeParse({ personIds: [] }).success);
});

test('patchMomentInputSchema：personIds/place 全 undefined 仍 EMPTY_PATCH（缺省 = 不变，不是有效 patch）', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ personIds: undefined, place: undefined }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success);
});

test('patchMomentInputSchema：place 对象 refine 违规拒绝；未知键仍 strict 拒绝', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ place: { lng: 116.4 } }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ placeSource: 'manual' }).success); // source 只由 server 赋值
});

test('MomentResponse：含 persons/place 字段可赋值（P2 已必填化）', () => {
  const res: MomentResponse = {
    id: UUID_A,
    chainId: UUID_B,
    author: { id: UUID_A, nickname: '爸爸', avatarUrl: null },
    type: 'media',
    content: '外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-28T12:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-28T12:00:00.000Z',
    media: [],
    tags: [],
    persons: [
      { id: UUID_A, name: '外婆', userId: null, source: 'ai' },
      { id: UUID_B, name: '爸爸', userId: UUID_A, source: 'manual' },
    ],
    place: { lat: 39.9042, lng: 116.4074, name: '北京市东城区', source: 'exif' },
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
  assert.equal(res.persons.length, 2);
  assert.equal(res.persons[0].source, 'ai');
  assert.equal(res.place!.source, 'exif');

  const noPlace: MomentResponse = { ...res, persons: [], place: null };
  assert.equal(noPlace.place, null);

  // P2 收口（P1 偏差 2）：persons/place 必填。tsx 不做类型检查，
  // 必填由 pnpm --filter @moment/dto build（tsc）把关；运行时断言钉字段语义。
  assert.equal(Array.isArray(res.persons), true);
});

test('listMomentsQuerySchema：person_id/place/happened_from/to；before 松紧不变；limit 仍是 string', () => {
  const q = listMomentsQuerySchema.parse({
    person_id: UUID_A,
    place: '朝阳公园',
    happened_from: '2026-08-01T00:00:00.000Z',
    happened_to: '2026-08-31T23:59:59.999Z',
    cursor: 'abc',
    limit: '50',
  });
  assert.equal(q.person_id, UUID_A);
  assert.equal(q.place, '朝阳公园');
  assert.equal(q.limit, '50');
  assert.ok(!listMomentsQuerySchema.safeParse({ person_id: 'nope' }).success);
  assert.ok(!listMomentsQuerySchema.safeParse({ happened_from: '2026/08/01' }).success);
  // 既有 before 仍走 isoTimestampSchema：Date.parse 宽松串继续合法（isoDatetime 会拒 2026/08/01）
  assert.ok(listMomentsQuerySchema.safeParse({ before: '2026/08/01' }).success);
});

test('listMomentsQuerySchema：from>to → VALIDATION_ERROR；无 RANGE_REQUIRES_HAPPENED_AT（无 order 字段）', () => {
  const bad = listMomentsQuerySchema.safeParse({
    happened_from: '2026-08-02T00:00:00.000Z',
    happened_to: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR'));
    assert.ok(!bad.error.issues.some((i) => i.message === 'RANGE_REQUIRES_HAPPENED_AT'));
  }
});

test('MomentMedia：derivedUrl / posterDerivedUrl 必填（P1 偏差 1 由 P3 收口）', () => {
  const ready: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'image/jpeg',
    width: 64,
    height: 48,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: `/api/media/${UUID_A}?variant=derived`,
    posterDerivedUrl: null,
  };
  assert.equal(ready.derivedUrl, `/api/media/${UUID_A}?variant=derived`);
  assert.equal(ready.posterDerivedUrl, null);

  const video: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 12,
    sortOrder: 0,
    posterMediaId: UUID_B,
    posterUrl: `/api/media/${UUID_B}`,
    derivedUrl: null,
    posterDerivedUrl: `/api/media/${UUID_B}?variant=derived`,
  };
  assert.equal(video.posterDerivedUrl, `/api/media/${UUID_B}?variant=derived`);
});

