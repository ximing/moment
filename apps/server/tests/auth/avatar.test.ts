import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { currentStorageMeta, setStorageAdapter } from '../../src/storage/factory.js';
import { auth, createUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

beforeEach(resetDb);
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function insertReadyImage(uploaderId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 12,
    width: null,
    height: null,
    duration: null,
    posterMediaId: null,
    sortOrder: 0,
    status: 'ready',
    storageMeta: currentStorageMeta(),
    uploadId: null,
  });
  return id;
}

describe('PATCH /api/auth/me 头像', () => {
  it('绑定 ready 图片：copy 到 users/.../avatar，资料带 6 天预签名 URL', async () => {
    const storage = installMockStorage();
    const user = await createUser(app, 'ava@example.com', 'Ava');
    const mediaId = await insertReadyImage(user.id);

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth(user))
      .send({ avatarMediaId: mediaId });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe('https://fake.local/presigned-get');
    expect(typeof res.body.avatarExpiresAt).toBe('string');
    const exp = Date.parse(res.body.avatarExpiresAt);
    expect(exp - Date.now()).toBeGreaterThan(5 * 24 * 3600 * 1000);

    expect(storage.copyObject).toHaveBeenCalled();
    const dest = (storage.copyObject.mock.calls[0] as unknown[])[1];
    expect(String(dest)).toContain(`users/${user.id}/avatar/${mediaId}`);

    const me = await request(app).get('/api/auth/me').set('Authorization', auth(user));
    expect(me.body.avatarUrl).toBe('https://fake.local/presigned-get');
  });

  it('非图片 / 非本人 / 已绑 moment → 失败；null 清除', async () => {
    installMockStorage();
    const user = await createUser(app, 'ava2@example.com', 'Ava');
    const other = await createUser(app, 'oth@example.com', 'Oth');
    const own = await insertReadyImage(user.id);
    const theirs = await insertReadyImage(other.id);

    const videoId = randomUUID();
    await db.insert(media).values({
      id: videoId,
      momentId: null,
      uploaderId: user.id,
      s3Key: `tmp/${videoId}.mp4`,
      mime: 'video/mp4',
      size: 12,
      width: null,
      height: null,
      duration: 3,
      posterMediaId: null,
      sortOrder: 0,
      status: 'ready',
      storageMeta: currentStorageMeta(),
      uploadId: null,
    });

    expect(
      (await request(app).patch('/api/auth/me').set('Authorization', auth(user)).send({ avatarMediaId: videoId })).status
    ).toBe(400);
    expect(
      (await request(app).patch('/api/auth/me').set('Authorization', auth(user)).send({ avatarMediaId: theirs })).status
    ).toBe(404);

    await request(app).patch('/api/auth/me').set('Authorization', auth(user)).send({ avatarMediaId: own });
    const cleared = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth(user))
      .send({ avatarMediaId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.avatarUrl).toBeNull();
  });

  it('替换头像：旧 media 标 orphaned 并写 orphanedAt；新头像被活引用 DELETE 拒绝', async () => {
    installMockStorage();
    const user = await createUser(app, 'ava3@example.com', 'Ava');
    const first = await insertReadyImage(user.id);
    const second = await insertReadyImage(user.id);

    await request(app).patch('/api/auth/me').set('Authorization', auth(user)).send({ avatarMediaId: first });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth(user))
      .send({ avatarMediaId: second });
    expect(res.status).toBe(200);

    const [prev] = await db.select().from(media).where(eq(media.id, first));
    expect(prev.status).toBe('orphaned');
    expect(prev.orphanedAt).not.toBeNull();

    const [cur] = await db.select().from(media).where(eq(media.id, second));
    expect(cur.status).toBe('ready');
    expect(cur.orphanedAt).toBeNull();

    // 旧头像已 orphaned：DELETE 幂等 204；新头像是 users.avatar_media_id 活引用：400
    expect((await request(app).delete(`/api/media/${first}`).set('Authorization', auth(user))).status).toBe(204);
    const bound = await request(app).delete(`/api/media/${second}`).set('Authorization', auth(user));
    expect(bound.status).toBe(400);
    expect(bound.body.error.code).toBe('MEDIA_ALREADY_BOUND');
  });
});
