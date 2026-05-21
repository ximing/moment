import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let carol: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
  carol = await createUser(app, 'carol');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 直插一条已 ready 的 media（绑定可选），返回 mediaId。 */
async function insertReadyMedia(opts: { uploaderId: string; momentId: string | null; status?: 'ready' | 'uploading' }): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/c-1/m-1/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: opts.status ?? 'ready',
    storageMeta: { bucket: 'moment-test-placeholder', prefix: 'test/attachments', region: 'us-east-1', isPublicBucket: 'false' },
  });
  return id;
}

async function insertMoment(chainId: string, authorId: string, deleted = false): Promise<string> {
  const id = randomUUID();
  await db.insert(moments).values({
    id,
    chainId,
    authorId,
    type: 'media',
    content: 'with photo',
    happenedAt: new Date('2026-08-15T10:00:00Z'),
    happenedTzOffset: -480,
    deletedAt: deleted ? new Date() : null,
  });
  return id;
}

describe('GET /api/media/:id', () => {
  it('绑定 moment：链内 viewer 成员 → 302 到预签名 URL，带 Cache-Control', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      `chains/c-1/m-1/${mediaId}.jpeg`,
      { bucket: 'moment-test-placeholder', prefix: 'test/attachments', region: 'us-east-1', isPublicBucket: 'false' },
      expect.any(Number),
      expect.any(Date)
    );
    const ttlArg = storage.generateAccessUrl.mock.calls[0]![2] as number;
    expect(ttlArg).toBeGreaterThan(3600);
    expect(ttlArg).toBeLessThanOrEqual(7200);
  });

  it('绑定 moment：非链成员 → 404（ChainPolicy CHAIN_NOT_FOUND）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${carol.token}`);
    expect(res.status).toBe(404);
  });

  it('绑定 moment：moment 已软删 → 404', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id, true);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });

  it('未绑定 moment：uploader 本人 → 302；他人 → 404', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });

    const own = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(own.status).toBe(302);

    const other = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(other.status).toBe(404);
  });

  it('status=uploading → 404（未 complete 的媒体不外发）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId, status: 'uploading' });
    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(404);
  });

  it('带 ?st= share token → 403 SHARE_NOT_SUPPORTED（Phase 8 实现透传）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}?st=some-token`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHARE_NOT_SUPPORTED');
  });

  it('未登录 → 401（用真实存在的 mediaId，只考察鉴权这一个维度）', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });
    const res = await request(app).get(`/api/media/${mediaId}`);
    expect(res.status).toBe(401);
  });
});
