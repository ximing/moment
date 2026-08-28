import assert from 'node:assert/strict';
import { test } from 'node:test';
// 副作用 import：tsx 会擦除 `import type`，没有这一行 jobs.ts 缺席时本文件不会红
import './jobs.js';
import type { ChainJobDto, ChainJobListResponse } from './jobs.js';

test('ChainJobDto / ChainJobListResponse 类型可赋值（spec §6.4）', () => {
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
