import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAIN_JOBS_DEFAULT_LIMIT,
  CHAIN_JOBS_MAX_LIMIT,
  chainJobsQuerySchema,
  type ChainJobDto,
  type ChainJobListResponse,
  type ChainJobsQuery,
} from './jobs.js';

test('ChainJobDto / ChainJobListResponse 类型可赋值（spec §6.4 / P1）', () => {
  const compress: ChainJobDto = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    type: 'moment.compress',
    status: 'pending',
    momentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    mediaId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    attempts: 1,
    lastError: 'OBJECT_TOO_LARGE',
    createdAt: '2026-08-29T00:00:00.000Z',
    processedAt: null,
  };
  const embed: ChainJobDto = {
    ...compress,
    type: 'moment.embed',
    status: 'failed',
    mediaId: null,
    lastError: null,
    processedAt: '2026-08-29T00:01:00.000Z',
  };
  const done: ChainJobDto = { ...embed, status: 'done' };
  const list: ChainJobListResponse = { jobs: [compress, embed, done] };
  assert.equal(list.jobs.length, 3);
  assert.equal(list.jobs[0].type, 'moment.compress');
  assert.equal(list.jobs[1].mediaId, null);
});

test('CHAIN_JOBS limit 常量锁定（spec §6.4：1..50 默认 50）', () => {
  assert.equal(CHAIN_JOBS_DEFAULT_LIMIT, 50);
  assert.equal(CHAIN_JOBS_MAX_LIMIT, 50);
});

test('chainJobsQuerySchema：缺省 status=pending,failed 且 limit=50', () => {
  const r = chainJobsQuerySchema.parse({});
  assert.deepEqual(r.status, ['pending', 'failed']);
  assert.equal(r.limit, 50);
  const typed: ChainJobsQuery = r;
  assert.equal(typed.limit, 50);
});

test('chainJobsQuerySchema：status csv trim + 去重保序；单段合法', () => {
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'done' }).status, ['done']);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'pending,failed,done' }).status, [
    'pending',
    'failed',
    'done',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: ' pending , failed ' }).status, [
    'pending',
    'failed',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'failed,pending,failed' }).status, [
    'failed',
    'pending',
  ]);
  assert.deepEqual(chainJobsQuerySchema.parse({ status: 'pending,' }).status, ['pending']);
});

test('chainJobsQuerySchema：非法 status / 空 csv → 失败且 message 含 VALIDATION_ERROR', () => {
  for (const status of ['PENDING', 'pending,foo', 'pending,done,nope', '', ',,,', ' , ']) {
    const bad = chainJobsQuerySchema.safeParse({ status });
    assert.equal(bad.success, false, `expected reject status=${JSON.stringify(status)}`);
    if (!bad.success) {
      assert.ok(
        bad.error.issues.some((i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'status'),
        JSON.stringify(bad.error.issues),
      );
    }
  }
});

test('chainJobsQuerySchema：limit 1..50；query 字符串 coerce；非法拒绝', () => {
  assert.equal(chainJobsQuerySchema.parse({ limit: '1' }).limit, 1);
  assert.equal(chainJobsQuerySchema.parse({ limit: 50 }).limit, 50);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 0 }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 51 }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 'abc' }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: '' }).success);
  assert.ok(!chainJobsQuerySchema.safeParse({ limit: 1.5 }).success);
});

test('chainJobsQuerySchema：未知键 cursor/before/order strip，不失败', () => {
  const r = chainJobsQuerySchema.parse({
    status: 'done',
    limit: '3',
    cursor: 'abc',
    before: '2026-08-01T00:00:00.000Z',
    order: 'created_at',
  });
  assert.deepEqual(r, { status: ['done'], limit: 3 });
  assert.equal('cursor' in r, false);
});
