import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDatetime } from './feed.js';
import {
  INTENT_MAX_QUERY_CHARS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  searchInputSchema,
  type SearchInput,
  type SearchParsed,
  type SearchResponse,
  type SearchTime,
} from './search.js';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174001';

const base = {
  q: '去年今天和外婆',
  tzOffset: -480,
};

test('INTENT / SEARCH 上限常量锁定（spec §3.1 / §5）', () => {
  assert.equal(INTENT_MAX_QUERY_CHARS, 500);
  assert.equal(SEARCH_DEFAULT_LIMIT, 20);
  assert.equal(SEARCH_MAX_LIMIT, 50);
});

test('searchInputSchema：最小合法 body（q+tzOffset）', () => {
  const r = searchInputSchema.parse(base);
  assert.equal(r.q, '去年今天和外婆');
  assert.equal(r.tzOffset, -480);
  assert.equal(r.limit, undefined);
  assert.equal(r.cursor, undefined);
  assert.equal(r.chainIds, undefined);
});

test('searchInputSchema：q trim + 空串拒绝 + 上限 500', () => {
  assert.equal(searchInputSchema.parse({ ...base, q: '  外婆  ' }).q, '外婆');
  assert.ok(!searchInputSchema.safeParse({ ...base, q: '   ' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, q: '' }).success);
  assert.ok(searchInputSchema.safeParse({ ...base, q: 'x'.repeat(500) }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, q: 'x'.repeat(501) }).success);
});

test('searchInputSchema：缺 tzOffset 拒绝；范围 -840..840 整数', () => {
  assert.ok(!searchInputSchema.safeParse({ q: '外婆' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: -841 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: 841 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, tzOffset: -480.5 }).success);
  assert.equal(searchInputSchema.parse({ ...base, tzOffset: 840 }).tzOffset, 840);
});

test('searchInputSchema：可选 uuid 字段；limit 1..50', () => {
  const r = searchInputSchema.parse({
    ...base,
    chainIds: [UUID_A],
    personId: UUID_A,
    tagId: UUID_B,
    place: '朝阳公园',
    cursor: 'abc',
    limit: 50,
  });
  assert.deepEqual(r.chainIds, [UUID_A]);
  assert.equal(r.limit, 50);
  assert.ok(!searchInputSchema.safeParse({ ...base, personId: 'nope' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, limit: 0 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, limit: 51 }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, cursor: '' }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, cursor: 'x'.repeat(1025) }).success);
});

test('searchInputSchema：place trim 1..255', () => {
  assert.equal(searchInputSchema.parse({ ...base, place: '  朝阳公园  ' }).place, '朝阳公园');
  assert.ok(!searchInputSchema.safeParse({ ...base, place: '' }).success);
  assert.ok(searchInputSchema.safeParse({ ...base, place: 'x'.repeat(255) }).success);
  assert.ok(!searchInputSchema.safeParse({ ...base, place: 'x'.repeat(256) }).success);
});

test('searchInputSchema：happenedFrom/To 复用 isoDatetime；from>to 用 Date.parse（禁止字符串 >）', () => {
  const ok = searchInputSchema.parse({
    ...base,
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(ok.happenedFrom, '2026-08-01T00:00:00.000Z');
  assert.ok(!searchInputSchema.safeParse({ ...base, happenedFrom: '2026/08/01' }).success);
  assert.ok(!isoDatetime.safeParse('2026/08/01').success);

  // 字典序 from > to，但带偏移后 Date.parse(from) < Date.parse(to) → 合法（spec §6.1 陷阱）
  const offsetOk = searchInputSchema.safeParse({
    ...base,
    happenedFrom: '2026-08-01T00:00:00+08:00', // UTC 7/31 16:00
    happenedTo: '2026-07-31T23:00:00Z',
  });
  assert.ok(offsetOk.success);

  const bad = searchInputSchema.safeParse({
    ...base,
    happenedFrom: '2026-08-02T00:00:00.000Z',
    happenedTo: '2026-08-01T00:00:00.000Z',
  });
  assert.ok(!bad.success);
  if (!bad.success) {
    assert.ok(bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happenedTo'));
  }
});

test('SearchTime / SearchParsed / SearchResponse 类型可赋值', () => {
  const range: SearchTime = { kind: 'range', from: '2026-06-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' };
  const wall: SearchTime = { kind: 'wall_date', year: 2025, month: 8, day: 29 };
  const parsed: SearchParsed = { personNames: ['外婆'], place: '朝阳公园', time: wall, text: '野餐' };
  const empty: SearchParsed = { personNames: [], place: null, time: null, text: '去年今天和外婆' };
  assert.equal(range.kind, 'range');
  assert.equal(parsed.time?.kind, 'wall_date');
  assert.equal(empty.place, null);

  const input: SearchInput = { q: '外婆', tzOffset: -480 };
  assert.equal(input.q, '外婆');

  const res: SearchResponse = { moments: [], nextCursor: null, parsed: empty };
  assert.equal(res.nextCursor, null);
});
