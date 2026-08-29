import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentDeleted } from '../../src/worker/handlers.js';
import { MockPushService } from '../../src/push/mock.js';

const app = listenLocal(createApp());

let storage: MockStorage;
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

async function readyImage(token: string, mime = 'image/jpeg'): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size: 1024, kind: 'image' });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

/** 直插 ready 视频行（multipart 通道造数成本高，归属校验只看行字段，同 create-moment.test.ts）。 */
async function insertReadyVideo(uploaderId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.mp4`,
    mime: 'video/mp4',
    size: 1024,
    status: 'ready',
    storageMeta: {},
  });
  return id;
}

async function setup() {
  const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
  const videoId = await insertReadyVideo(alice.id);
  const posterId = await readyImage(alice.token);
  return { chainId, videoId, posterId };
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const videoBody = (videoId: string, posterMediaId?: string) => ({
  type: 'video' as const,
  content: '',
  happenedAt: '2026-08-22T10:00:00+08:00',
  happenedTzOffset: -480,
  mediaIds: [videoId],
  ...(posterMediaId ? { posterMediaId } : {}),
});

describe('POST moments with posterMediaId（视频封面绑定）', () => {
  it('成功路径：poster 行绑 momentId + s3_key copy 到 final，视频行写 poster_media_id，响应 media 恰 1 条', async () => {
    const { chainId, videoId, posterId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    expect(res.status).toBe(201);
    // poster 不泄漏为第 2 条媒体；视频行出 posterMediaId / posterUrl
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].id).toBe(videoId);
    expect(res.body.media[0].posterMediaId).toBe(posterId);
    expect(res.body.media[0].posterUrl).toBe(`/api/media/${posterId}`);

    const [posterRow] = await db.select().from(media).where(eq(media.id, posterId));
    expect(posterRow.momentId).toBe(res.body.id);
    expect(posterRow.s3Key).toBe(`chains/${chainId}/${res.body.id}/${posterId}.jpeg`);
    expect(posterRow.sortOrder).toBe(0); // 不参与宫格排序，保持上传时的默认值
    const [videoRow] = await db.select().from(media).where(eq(media.id, videoId));
    expect(videoRow.posterMediaId).toBe(posterId);
    // poster 的 tmp 对象与媒体行走同一 post-commit 清理
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${posterId}.jpeg`, expect.anything());
  });

  it('无封面视频：posterMediaId / posterUrl 均 null；图片行两字段恒 null', async () => {
    const { chainId, videoId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId));
    expect(res.status).toBe(201);
    expect(res.body.media[0].posterMediaId).toBeNull();
    expect(res.body.media[0].posterUrl).toBeNull();

    const imageId = await readyImage(alice.token);
    const grid = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(grid.status).toBe(201);
    expect(grid.body.media[0].posterMediaId).toBeNull();
    expect(grid.body.media[0].posterUrl).toBeNull();
  });

  it('poster 非本人上传 → 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const bobPoster = await readyImage(bob.token);
    const res = await postMoment(alice.token, chainId, videoBody(videoId, bobPoster));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster 非 ready（presign 未 complete）→ 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    const res = await postMoment(alice.token, chainId, videoBody(videoId, presigned.body.mediaId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster 已绑定其他 moment → 400 MEDIA_INVALID', async () => {
    const { chainId, posterId } = await setup();
    const video2 = await insertReadyVideo(alice.id);
    const first = await postMoment(alice.token, chainId, videoBody(video2, posterId));
    expect(first.status).toBe(201);
    const video3 = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, videoBody(video3, posterId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster mime 为 video/* → 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const otherVideo = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, videoBody(videoId, otherVideo));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('posterMediaId 同时是内容媒体（mediaIds[0]）→ 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId, videoId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('dto 层：type=media / text 传 posterMediaId → 400 VALIDATION_ERROR', async () => {
    const { chainId } = await setup();
    const imageId = await readyImage(alice.token);
    const asMedia = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
      posterMediaId: imageId,
    });
    expect(asMedia.status).toBe(400);
    expect(asMedia.body.error.code).toBe('VALIDATION_ERROR');
    const asText = await postMoment(alice.token, chainId, {
      type: 'text',
      content: 'hi',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      posterMediaId: imageId,
    });
    expect(asText.status).toBe(400);
    expect(asText.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH 传 posterMediaId → 400 MEDIA_NOT_ALLOWED；视频行 / poster 行 momentId 与 s3_key 未动', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    const [beforeV] = await db.select().from(media).where(eq(media.id, videoId));
    const [beforeP] = await db.select().from(media).where(eq(media.id, posterId));
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ posterMediaId: posterId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [afterV] = await db.select().from(media).where(eq(media.id, videoId));
    const [afterP] = await db.select().from(media).where(eq(media.id, posterId));
    expect(afterV.momentId).toBe(created.body.id);
    expect(afterP.momentId).toBe(created.body.id);
    expect(afterV.s3Key).toBe(beforeV.s3Key);
    expect(afterP.s3Key).toBe(beforeP.s3Key);
  });

  it('PATCH posterMediaId: null → 400 MEDIA_NOT_ALLOWED；视频/poster 行未动', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ posterMediaId: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [v] = await db.select().from(media).where(eq(media.id, videoId));
    const [p] = await db.select().from(media).where(eq(media.id, posterId));
    expect(v.momentId).toBe(created.body.id);
    expect(p.momentId).toBe(created.body.id);
  });

  it('软删带 poster 的 video moment：handleMomentDeleted 后 poster 行随视频行同标 orphaned', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    await request(app)
      .delete(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    await handleMomentDeleted(
      { momentId: created.body.id, chainId, authorId: alice.id },
      { push: new MockPushService() }
    );
    const [posterRow] = await db.select().from(media).where(eq(media.id, posterId));
    const [videoRow] = await db.select().from(media).where(eq(media.id, videoId));
    expect(posterRow.status).toBe('orphaned');
    expect(videoRow.status).toBe('orphaned');
  });
});
