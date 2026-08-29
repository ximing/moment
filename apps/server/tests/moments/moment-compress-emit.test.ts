import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, outbox } from '../../src/db/schema.js';
import { OUTBOX_MOMENT_COMPRESS } from '../../src/outbox/types.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let alice: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
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

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

async function compressRows() {
  return db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));
}

describe('create emit moment.compress（spec fused-retrieval §4.2）', () => {
  it('JPEG：derived_status=pending，outbox payload camelCase {momentId,chainId,mediaId}', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.derivedStatus).toBe('pending');
    expect(row.derivedS3Key).toBeNull();
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ momentId: res.body.id, chainId, mediaId: imageId });
    expect(jobs[0].status).toBe('pending');
  });

  it('两张 JPEG → 两行 compress；PNG 同样可压', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const a = await readyImage(alice.token, 'image/jpeg');
    const b = await readyImage(alice.token, 'image/png');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [a, b],
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => (j.payload as { mediaId: string }).mediaId).sort()).toEqual([a, b].sort());
  });

  it('GIF/HEIC/HEIF：不 emit，derived_status 仍 NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    for (const mime of ['image/gif', 'image/heic', 'image/heif'] as const) {
      const id = await readyImage(alice.token, mime);
      const res = await postMoment(alice.token, chainId, {
        type: 'media',
        content: '',
        happenedAt: '2026-08-29T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [id],
      });
      expect(res.status).toBe(201);
      const [row] = await db.select().from(media).where(eq(media.id, id));
      expect(row.derivedStatus).toBeNull();
    }
    expect(await compressRows()).toHaveLength(0);
  });

  it('JPEG+GIF 混排：只给 JPEG emit/pending', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const jpegId = await readyImage(alice.token, 'image/jpeg');
    const gifId = await readyImage(alice.token, 'image/gif');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [jpegId, gifId],
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { mediaId: string }).mediaId).toBe(jpegId);
    expect((await db.select().from(media).where(eq(media.id, jpegId)))[0].derivedStatus).toBe('pending');
    expect((await db.select().from(media).where(eq(media.id, gifId)))[0].derivedStatus).toBeNull();
  });

  it('视频+poster：只压 poster，视频行 NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    const res = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { mediaId: string }).mediaId).toBe(posterId);
    expect((await db.select().from(media).where(eq(media.id, videoId)))[0].derivedStatus).toBeNull();
    expect((await db.select().from(media).where(eq(media.id, posterId)))[0].derivedStatus).toBe('pending');
  });

  it('纯文字 / 无封面视频：不 emit compress', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '第一次翻身',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(text.status).toBe(201);
    const videoId = await insertReadyVideo(alice.id);
    const video = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-29T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [videoId],
    });
    expect(video.status).toBe(201);
    expect(await compressRows()).toHaveLength(0);
  });

  it('PATCH 只改正文 → compress 行数不变', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(created.status).toBe(201);
    expect(await compressRows()).toHaveLength(1);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '改了正文' });
    expect(patched.status).toBe(200);
    expect(await compressRows()).toHaveLength(1);
  });

  it('PATCH 追加 JPEG → 新 compress payload {momentId,chainId,mediaId} 且新行 derivedStatus=pending', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [oldId],
    });
    const newId = await readyImage(alice.token);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mediaIds: [oldId, newId] });
    expect(patched.status).toBe(200);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(2);
    const payloads = jobs.map((j) => j.payload as { momentId: string; chainId: string; mediaId: string });
    expect(payloads).toEqual(
      expect.arrayContaining([
        { momentId: created.body.id, chainId, mediaId: oldId },
        { momentId: created.body.id, chainId, mediaId: newId },
      ]),
    );
    expect((await db.select().from(media).where(eq(media.id, newId)))[0].derivedStatus).toBe('pending');
  });

  it('PATCH keep 的旧 JPEG 不第二行 compress', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [oldId],
    });
    expect(await compressRows()).toHaveLength(1);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mediaIds: [oldId] });
    expect(patched.status).toBe(200);
    expect(await compressRows()).toHaveLength(1);
    const [row] = await db.select().from(media).where(eq(media.id, oldId));
    expect(row.momentId).toBe(created.body.id);
    expect(row.status).toBe('ready');
  });
});
