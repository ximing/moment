import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_IMAGE_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import { ApiError, createMomentClient, type PutFn } from './index.js';

interface Recorded {
  method: string;
  url: string;
  body?: unknown;
}

function makeClient(opts: {
  presignBody: Record<string, unknown>;
  onPut?: (url: string, partIndex: number) => { etag: string | null };
}) {
  const calls: Recorded[] = [];
  const putUrls: string[] = [];
  let partSeq = 0;
  const putWithProgress: PutFn = async (url, blob, contentType, onProgress) => {
    putUrls.push(url);
    onProgress?.(0, blob.size);
    onProgress?.(blob.size, blob.size);
    return opts.onPut ? opts.onPut(url, ++partSeq) : { etag: `"etag-${url.slice(-1)}"` };
  };
  const client = createMomentClient({
    baseUrl: '',
    tokenStore: {
      getAccessToken: () => 'a',
      getRefreshToken: () => 'r',
      setTokens: () => {},
      clear: () => {},
    },
    putWithProgress,
    fetchImpl: async (url, init) => {
      const u = String(url);
      calls.push({
        method: init?.method ?? 'GET',
        url: u,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (u === '/api/media/presign') {
        return Response.json(opts.presignBody, { status: 201 });
      }
      if (u.endsWith('/parts')) {
        const { partNumbers } = calls[calls.length - 1]!.body as { partNumbers: number[] };
        return Response.json({
          mediaId: 'md1',
          partSize: VIDEO_PART_SIZE,
          urls: partNumbers.map((partNumber) => ({ partNumber, url: `https://s3/part/${partNumber}`, expiresIn: 900 })),
        });
      }
      if (u.endsWith('/complete')) {
        return Response.json({ mediaId: 'md1', status: 'ready', mime: 'video/mp4', size: 1 });
      }
      return Response.json({});
    },
  });
  return { client, calls, putUrls };
}

test('图片：presign(put) → 单次 PUT → complete(parts=[])；onProgress 走到 100%', async () => {
  const progress: [number, number][] = [];
  const { client, calls, putUrls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'https://s3/put', uploadId: null, partSize: null },
  });
  const blob = new Blob(['hello image']);
  const res = await client.uploadMedia({
    file: blob,
    mime: 'image/jpeg',
    size: blob.size,
    kind: 'image',
    sortOrder: 0,
    onProgress: (loaded, total) => progress.push([loaded, total]),
  });
  assert.equal(res.status, 'ready');
  assert.deepEqual(putUrls, ['https://s3/put']);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST /api/media/presign',
    'POST /api/media/md1/complete',
  ]);
  assert.deepEqual(calls[1]!.body, { parts: [] });
  assert.deepEqual(progress.at(-1), [blob.size, blob.size]);
});

test('图片超 MAX_IMAGE_BYTES → 本地直接 413 MEDIA_TOO_LARGE，不发起任何请求', async () => {
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'u', uploadId: null, partSize: null },
  });
  await assert.rejects(
    () =>
      client.uploadMedia({
        file: new Blob(['x']),
        mime: 'image/jpeg',
        size: MAX_IMAGE_BYTES + 1,
        kind: 'image',
      }),
    (e: unknown) => e instanceof ApiError && e.code === 'MEDIA_TOO_LARGE' && e.status === 413
  );
  assert.equal(calls.length, 0);
});

test('视频：分批取 part URL、片间串行 PUT、etag 汇总进 complete；进度单调不减', async () => {
  // partSize 来自服务端 presign 响应（= VIDEO_PART_SIZE）；造 2.5 part 的数据
  const total = Math.floor(VIDEO_PART_SIZE * 2.5);
  const presign = {
    mediaId: 'md1',
    method: 'multipart' as const,
    url: null,
    uploadId: 'up-1',
    partSize: VIDEO_PART_SIZE,
  };
  const putOrder: number[] = [];
  const { client, calls, putUrls } = makeClient({
    presignBody: presign,
    onPut: (url) => {
      const partNumber = Number(url.split('/').pop());
      putOrder.push(partNumber);
      return { etag: `"e${partNumber}"` };
    },
  });
  const blob = new Blob(['v'.repeat(8)]); // 内容无所谓，slice 只按大小
  const progress: number[] = [];
  await client.uploadMedia({
    file: blob,
    mime: 'video/mp4',
    size: total,
    kind: 'video',
    durationSeconds: 120,
    onProgress: (loaded) => progress.push(loaded),
  });
  const complete = calls.find((c) => c.url.endsWith('/complete'))!;
  assert.deepEqual(complete!.body, {
    parts: [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ],
  });
  // 串行：PUT 顺序严格 1,2,3；分批取 URL（3 片一批 BATCH=10 时只请求一次 parts）
  assert.deepEqual(putOrder, [1, 2, 3]);
  const partsCalls = calls.filter((c) => c.url.endsWith('/parts'));
  assert.equal(partsCalls.length, 1);
  assert.deepEqual((partsCalls[0]!.body as { partNumbers: number[] }).partNumbers, [1, 2, 3]);
  assert.deepEqual(putUrls, ['https://s3/part/1', 'https://s3/part/2', 'https://s3/part/3']);
  // 进度单调不减，最终到 total
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i]! >= progress[i - 1]!);
  assert.equal(progress.at(-1), total);
  // presign 携带 durationSeconds
  assert.equal((calls[0]!.body as { durationSeconds?: number }).durationSeconds, 120);
});

test('视频：part 2 第一次失败 → 同一 URL 重试成功（每片 ≤3 次），重试后仍继续后续 part', async () => {
  const total = VIDEO_PART_SIZE * 2;
  const attempts = new Map<string, number>();
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: (url) => {
      const key = url.split('/').pop()!;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (key === '2' && n === 1) throw new ApiError('网络抖动', 0, 'NETWORK_ERROR');
      return { etag: `"e${key}"` };
    },
  });
  await client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' });
  assert.equal(attempts.get('2'), 2); // 重试一次成功
  const complete = calls.find((c) => c.url.endsWith('/complete'))!;
  assert.deepEqual(complete!.body, {
    parts: [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
    ],
  });
});

test('视频：某 part 连续 3 次失败 → 抛 ApiError 且不调 complete', async () => {
  const total = VIDEO_PART_SIZE;
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: () => {
      throw new ApiError('始终失败', 0, 'NETWORK_ERROR');
    },
  });
  await assert.rejects(
    () => client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' }),
    (e: unknown) => e instanceof ApiError
  );
  assert.equal(calls.find((c) => c.url.endsWith('/complete')), undefined);
});

test('视频：PUT 成功但响应无 ETag → ETAG_MISSING 立即失败，不重试', async () => {
  const total = VIDEO_PART_SIZE;
  let putCalls = 0;
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'multipart', url: null, uploadId: 'up-1', partSize: VIDEO_PART_SIZE },
    onPut: () => {
      putCalls += 1;
      return { etag: null }; // 桶 CORS 未 ExposeHeaders ETag 时的形态
    },
  });
  await assert.rejects(
    () => client.uploadMedia({ file: new Blob(['v']), mime: 'video/mp4', size: total, kind: 'video' }),
    (e: unknown) => e instanceof ApiError && e.code === 'ETAG_MISSING'
  );
  assert.equal(putCalls, 1); // 不作为可重试失败
  assert.equal(calls.find((c) => c.url.endsWith('/complete')), undefined);
});
