import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

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

async function insertMoment(chainId: string, authorId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(moments).values({
    id,
    chainId,
    authorId,
    type: 'media',
    content: 'with photo',
    happenedAt: new Date('2026-08-29T10:00:00Z'),
    happenedTzOffset: -480,
    wallDate: wallDateOf(new Date('2026-08-29T10:00:00Z'), -480),
  });
  return id;
}

async function insertReadyMedia(opts: {
  uploaderId: string;
  momentId: string | null;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  derivedS3Key?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/c-1/m-1/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts.derivedStatus ?? null,
    derivedS3Key: opts.derivedS3Key ?? null,
  });
  return id;
}

describe('GET /api/media/:id?variant=', () => {
  it('缺省 / original：即使 derived 已 ready 仍签 s3_key；Cache-Control 不变；不 getObject', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db
      .update(media)
      .set({ derivedStatus: 'ready', derivedS3Key: derivedKey, derivedMime: 'image/webp' })
      .where(eq(media.id, mediaId));

    const def = await request(app).get(`/api/media/${mediaId}`).set('Authorization', `Bearer ${bob.token}`);
    expect(def.status).toBe(302);
    expect(def.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      `chains/c-1/m-1/${mediaId}.jpeg`,
      TEST_META,
      expect.any(Number),
      expect.any(Date),
    );

    storage.generateAccessUrl.mockClear();
    const orig = await request(app)
      .get(`/api/media/${mediaId}?variant=original`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(orig.status).toBe(302);
    expect(storage.generateAccessUrl.mock.calls[0]![0]).toBe(`chains/c-1/m-1/${mediaId}.jpeg`);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('variant=derived 且 ready：签 derived_s3_key', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db
      .update(media)
      .set({ derivedStatus: 'ready', derivedS3Key: derivedKey, derivedMime: 'image/webp' })
      .where(eq(media.id, mediaId));

    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=derived`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      derivedKey,
      TEST_META,
      expect.any(Number),
      expect.any(Date),
    );
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('derived 非 ready / key 空 → 404 DERIVED_NOT_READY（不回退原图）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const pendingId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'pending',
    });
    const skippedId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'skipped',
    });
    const failedId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'failed',
    });
    const nullId = await insertReadyMedia({ uploaderId: alice.id, momentId, derivedStatus: null });
    const emptyKey = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'ready',
      derivedS3Key: null,
    });

    for (const id of [pendingId, skippedId, failedId, nullId, emptyKey]) {
      const res = await request(app)
        .get(`/api/media/${id}?variant=derived`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DERIVED_NOT_READY');
    }
  });

  it('非法 variant → 400 VALIDATION_ERROR', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=thumb`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('variant 空串 → 400 VALIDATION_ERROR（不是缺省 original）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('未登录 derived 仍 401（鉴权先于 DERIVED_NOT_READY）', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null, derivedStatus: null });
    const res = await request(app).get(`/api/media/${mediaId}?variant=derived`);
    expect(res.status).toBe(401);
  });

  it('share token + derived ready：匿名 302 签派生 key', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db.update(media).set({ derivedStatus: 'ready', derivedS3Key: derivedKey }).where(eq(media.id, mediaId));
    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(link.status).toBe(201);

    const res = await request(app).get(`/api/media/${mediaId}?variant=derived&st=${link.body.token}`);
    expect(res.status).toBe(302);
    expect(storage.generateAccessUrl.mock.calls[0]![0]).toBe(derivedKey);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
