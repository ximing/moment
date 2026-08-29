import { randomUUID } from 'node:crypto';
import { getStorage, currentStorageMeta } from '../../src/storage/factory.js';
import { alignedGetPresign } from '../../src/media/presign-ttl.js';

// CONVENTIONS §3.3：默认跳过，严禁默认测试依赖外部桶状态。
// 运行方式：在 .env 配好真实桶凭据后 `RUN_S3_IT=1 pnpm --filter @moment/server test -- s3-it`
const d = process.env.RUN_S3_IT === '1' ? describe : describe.skip;

d('S3 真实桶 smoke（RUN_S3_IT=1）', () => {
  const storage = getStorage();

  it('单 PUT：presignPut → 直传 → head 校验 → copy → 预签名 GET 可读 → 清理', async () => {
    const src = `tmp/smoke-${randomUUID()}.png`;
    const dest = `chains/smoke-chain/smoke-moment/${randomUUID()}.png`;
    const png = Buffer.from('moment-s3-smoke-fake-png-bytes', 'utf8');

    const putUrl = await storage.presignPut(src, { contentType: 'image/png' }, 900);
    const put = await fetch(putUrl, {
      method: 'PUT',
      body: new Uint8Array(png),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status).toBe(200);

    const head = await storage.headObject(src);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(png.length);
    expect(head!.contentType).toBe('image/png');

    await storage.copyObject(src, dest);
    expect(await storage.fileExists(dest)).toBe(true);

    // 与生产路径（resolveAccessUrl）同参：整点对齐的 signingDate + TTL+3600，而非裸 60s
    const { signingDate, expiresIn } = alignedGetPresign();
    const access = await storage.generateAccessUrl(dest, currentStorageMeta(), expiresIn, signingDate);
    const got = await fetch(access);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).length).toBe(png.length);

    await storage.deleteFile(src);
    await storage.deleteFile(dest);
    expect(await storage.fileExists(dest)).toBe(false);
  });

  it('multipart：init → part 预签名直传 → complete → head → abort 不残留', async () => {
    const key = `tmp/smoke-mp-${randomUUID()}.bin`;
    const body = Buffer.from('moment-s3-smoke-part-1', 'utf8');

    const uploadId = await storage.initMultipart(key, { contentType: 'application/octet-stream' });
    const partUrl = await storage.presignPart(key, uploadId, 1, 900);
    const put = await fetch(partUrl, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();

    await storage.completeMultipart(key, uploadId, [{ partNumber: 1, etag: etag! }]);
    const head = await storage.headObject(key);
    expect(head?.size).toBe(body.length);

    await storage.deleteFile(key);
  });

  it('abort 路径：init 后直接 abort，不产生对象', async () => {
    const key = `tmp/smoke-abort-${randomUUID()}.bin`;
    const uploadId = await storage.initMultipart(key, { contentType: 'application/octet-stream' });
    await storage.abortMultipart(key, uploadId);
    expect(await storage.fileExists(key)).toBe(false);
  });

  it('getObject 有界读取：小对象返回原字节；超 maxBytes 抛 ObjectTooLargeError', async () => {
    const key = `tmp/getobj-${randomUUID()}.bin`;
    const body = Buffer.from('hello-get-object');
    await storage.uploadFile(key, body);
    const meta = currentStorageMeta();
    const got = await storage.getObject(key, meta, 1024);
    expect(Buffer.compare(got, body)).toBe(0);
    await expect(storage.getObject(key, meta, 4)).rejects.toMatchObject({ name: 'ObjectTooLargeError' });
    await storage.deleteFile(key, meta);
  });
});

