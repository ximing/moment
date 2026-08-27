import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chains, media, moments, users } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { currentStorageMeta, setStorageAdapter } from '../../src/storage/factory.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function insertMedia(
  uploaderId: string,
  opts: { status?: 'uploading' | 'ready' | 'orphaned'; uploadId?: string | null; momentId?: string | null } = {}
): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId ?? null,
    uploaderId,
    s3Key: `tmp/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 12,
    width: null,
    height: null,
    duration: null,
    posterMediaId: null,
    sortOrder: 0,
    status: opts.status ?? 'ready',
    storageMeta: currentStorageMeta(),
    uploadId: opts.uploadId ?? null,
  });
  return id;
}

/** 直插链 + moment + 绑定该 moment 的 media（MEDIA_ALREADY_BOUND 矩阵的 moment 分支）。 */
async function insertMomentBoundMedia(uploaderId: string): Promise<string> {
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: uploaderId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: uploaderId,
    type: 'media',
    content: 'x',
    happenedAt: new Date(),
    happenedTzOffset: 0,
    wallDate: wallDateOf(new Date(), 0),
  });
  return insertMedia(uploaderId, { momentId });
}

describe('DELETE /api/media/:id（丢弃未绑定媒体，design §4.5）', () => {
  it('未登录 401', async () => {
    expect((await request(app).delete(`/api/media/${randomUUID()}`)).status).toBe(401);
  });

  it('uploader 删除 uploading：abort multipart + 行转 orphaned 并写 orphanedAt', async () => {
    const id = await insertMedia(alice.id, { status: 'uploading', uploadId: 'upload-abc' });

    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(204);

    expect(storage.abortMultipart).toHaveBeenCalledWith(`tmp/${id}.jpeg`, 'upload-abc');
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('orphaned');
    expect(row.orphanedAt).not.toBeNull();
    // MySQL timestamp 秒级精度（fsp=0）会向上进位，只断言落在当前时刻附近
    expect(Math.abs(row.orphanedAt!.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('ready 未引用 → 204 转 orphaned 并写 orphanedAt；不动存储对象', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });

    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(204);

    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('orphaned');
    expect(row.orphanedAt).not.toBeNull();
    expect(storage.abortMultipart).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('重复删除 → 204 幂等', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });
    expect((await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice))).status).toBe(204);
    const again = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(again.status).toBe(204);
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('orphaned');
  });

  it('他人的 media → 404；不存在的 id → 404（不泄露存在性）', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });
    const theirs = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(bob));
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('MEDIA_NOT_FOUND');

    const missing = await request(app).delete(`/api/media/${randomUUID()}`).set('Authorization', auth(alice));
    expect(missing.status).toBe(404);

    // 未被误伤：行仍是 ready
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('ready');
  });

  it('moment 绑定 → 400 MEDIA_ALREADY_BOUND', async () => {
    const id = await insertMomentBoundMedia(alice.id);
    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('ready');
  });

  it('users.avatar_media_id 活引用 → 400 MEDIA_ALREADY_BOUND', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });
    await db.update(users).set({ avatarMediaId: id }).where(eq(users.id, alice.id));

    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('ready');
  });

  it('chains.avatar_media_id 活引用 → 400 MEDIA_ALREADY_BOUND', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });
    const chainId = randomUUID();
    await db.insert(chains).values({
      id: chainId,
      name: 'c',
      ownerId: alice.id,
      visibility: 'private',
      template: 'daily',
      avatarMediaId: id,
    });

    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });

  it('chains.cover_media_id 活引用 → 400 MEDIA_ALREADY_BOUND', async () => {
    const id = await insertMedia(alice.id, { status: 'ready' });
    const chainId = randomUUID();
    await db.insert(chains).values({
      id: chainId,
      name: 'c',
      ownerId: alice.id,
      visibility: 'private',
      template: 'daily',
      coverMediaId: id,
    });

    const res = await request(app).delete(`/api/media/${id}`).set('Authorization', auth(alice));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });

  it('既有 POST /:id/abort 也统一写 orphanedAt', async () => {
    const id = await insertMedia(alice.id, { status: 'uploading' });
    const res = await request(app).post(`/api/media/${id}/abort`).set('Authorization', auth(alice));
    expect(res.status).toBe(204);
    const [row] = await db.select().from(media).where(eq(media.id, id));
    expect(row.status).toBe('orphaned');
    expect(row.orphanedAt).not.toBeNull();
  });
});
