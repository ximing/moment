import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import { createUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function presignImage(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'image/jpeg', size: 1024, kind: 'image', ...over });
}

async function presignVideo(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'video/mp4', size: 64 * 1024 * 1024, kind: 'video', ...over });
}

describe('POST /api/media/presign', () => {
  it('未登录 401', async () => {
    expect((await request(app).post('/api/media/presign').send({})).status).toBe(401);
  });

  it('图片：插 uploading 行 + tmp key，返回预签名 PUT', async () => {
    const res = await presignImage(alice.token, { sortOrder: 2 });
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('put');
    expect(res.body.url).toBe('https://fake.local/presigned-put');
    expect(res.body.uploadId).toBeNull();
    expect(res.body.partSize).toBeNull();

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row).toMatchObject({
      uploaderId: alice.id,
      mime: 'image/jpeg',
      size: 1024,
      status: 'uploading',
      sortOrder: 2,
      uploadId: null,
    });
    expect(row.s3Key).toBe(`tmp/${res.body.mediaId}.jpeg`); // mime-types: image/jpeg → .jpeg
    expect(storage.presignPut).toHaveBeenCalledWith(row.s3Key, { contentType: 'image/jpeg' }, 900);
  });

  it('图片超 10MB → 413 MEDIA_TOO_LARGE，且不插行', async () => {
    const res = await presignImage(alice.token, { size: MAX_IMAGE_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('视频超 500MB → 413', async () => {
    const res = await presignVideo(alice.token, { size: MAX_VIDEO_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
  });

  it('kind 与 mime 不一致 → 400 VALIDATION_ERROR', async () => {
    const res = await presignImage(alice.token, { mime: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('视频：init multipart，返回 uploadId/partSize，upload_id 落库', async () => {
    const res = await presignVideo(alice.token);
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('multipart');
    expect(res.body.url).toBeNull();
    expect(res.body.uploadId).toBe('fake-upload-id');
    expect(res.body.partSize).toBe(VIDEO_PART_SIZE);

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row.status).toBe('uploading');
    expect(row.uploadId).toBe('fake-upload-id');
    expect(storage.initMultipart).toHaveBeenCalledWith(row.s3Key, { contentType: 'video/mp4' });
  });
});

describe('POST /api/media/:id/parts', () => {
  it('仅 uploader 本人：逐 part 预签名', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ partNumbers: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.partSize).toBe(VIDEO_PART_SIZE);
    expect(res.body.urls).toHaveLength(2);
    expect(res.body.urls[0]).toEqual({
      partNumber: 1,
      url: 'https://fake.local/presigned-part',
      expiresIn: 900,
    });
    expect(storage.presignPart).toHaveBeenCalledTimes(2);
  });

  it('非 uploader → 404 MEDIA_NOT_FOUND（不泄露存在性）', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ partNumbers: [1] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('图片（无 uploadId）→ 409 MEDIA_INVALID_STATE', async () => {
    const presigned = await presignImage(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ partNumbers: [1] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEDIA_INVALID_STATE');
  });
});

describe('POST /api/media/:id/complete', () => {
  it('图片：HeadObject 校验通过 → ready；重复 complete 幂等返回相同结果', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });

    const first = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      mediaId: presigned.body.mediaId,
      status: 'ready',
      mime: 'image/jpeg',
      size: 1024,
    });
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');

    const second = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // 幂等：HeadObject 只在第一次 complete 时调用
    expect(storage.headObject).toHaveBeenCalledTimes(1);
  });

  it('视频：先 completeMultipart（service 层按 partNumber 升序排序后再传 adapter），再 HeadObject 校验', async () => {
    const presigned = await presignVideo(alice.token);
    storage.headObject.mockResolvedValue({
      size: 64 * 1024 * 1024,
      contentType: 'video/mp4',
      lastModified: new Date(),
    });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a"' }] });
    expect(res.status).toBe(200);
    // mock 原样记录入参：断言收到的是「升序排序后」的数组——排序契约钉在 service 层
    // （S3 CompleteMultipartUpload 要求 parts 严格升序；mock adapter 不会替 service 排序）
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      `tmp/${presigned.body.mediaId}.mp4`,
      'fake-upload-id',
      [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
      ]
    );
  });

  it('视频：parts 为空 → 400 MEDIA_INVALID，不触 S3（与图片分支对称）', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });

  it('视频：S3 已合片但 HeadObject 校验 422 后，重试不再触合片（幂等覆盖中间态）', async () => {
    const presigned = await presignVideo(alice.token);
    // 合片成功、HeadObject size 不符 → 422，状态停留 uploading
    storage.headObject.mockResolvedValue({ size: 1, contentType: 'video/mp4', lastModified: new Date() });
    const first = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 1, etag: '"a"' }] });
    expect(first.status).toBe(422);
    expect(first.body.error.code).toBe('MEDIA_MISMATCH');
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);

    // 客户端重试（同 parts）：uploadId 已在合片成功后被置空 → 跳过 completeMultipart
    // （否则 S3 NoSuchUpload → 500），只做 HeadObject；对象一致 → ready
    storage.headObject.mockResolvedValue({
      size: 64 * 1024 * 1024,
      contentType: 'video/mp4',
      lastModified: new Date(),
    });
    const retry = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 1, etag: '"a"' }] });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('ready');
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
  });

  it('HeadObject size/mime 与申请不符 → 422 MEDIA_MISMATCH，状态仍 uploading', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 999, contentType: 'image/jpeg', lastModified: new Date() });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MEDIA_MISMATCH');
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('uploading');
  });

  it('HeadObject 不存在 → 422 MEDIA_MISMATCH', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue(null);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it('orphaned 状态 → 409 MEDIA_INVALID_STATE', async () => {
    const presigned = await presignImage(alice.token);
    await db.update(media).set({ status: 'orphaned' }).where(eq(media.id, presigned.body.mediaId));
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(409);
  });
});

describe('POST /api/media/:id/abort', () => {
  it('multipart：abortMultipart + 状态 orphaned；重复 abort 幂等 204', async () => {
    const presigned = await presignVideo(alice.token);
    const mediaId = presigned.body.mediaId;
    const res = await request(app)
      .post(`/api/media/${mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledWith(`tmp/${mediaId}.mp4`, 'fake-upload-id');
    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');

    const again = await request(app)
      .post(`/api/media/${mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(again.status).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledTimes(1);
  });

  it('非 uploader → 404', async () => {
    const presigned = await presignImage(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/abort`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });

  it('ready 媒体 abort → 409 MEDIA_INVALID_STATE（终态保护），状态保持 ready', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEDIA_INVALID_STATE');
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
    expect(storage.abortMultipart).not.toHaveBeenCalled();
  });
});
