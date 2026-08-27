import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, shareLinks } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

let storage: MockStorage;
let owner: { id: string; token: string };
let other: { id: string; token: string };
let chainId: string;
let otherChainId: string;
let shareToken: string;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

/** 直插 ready media（可绑定 moment）。 */
async function insertReadyMedia(uploaderId: string, momentId: string | null): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId,
    uploaderId,
    s3Key: `chains/x/y/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
  });
  return id;
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  owner = await registerUser();
  other = await registerUser();
  chainId = await createChain(owner.id, '公开链');
  otherChainId = await createChain(other.id, '别的链');
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({});
  shareToken = res.body.token;
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

describe('GET /api/media/:id?st=（share token 透传，spec §5.3）', () => {
  it('匿名 + 有效 st + 本链 media → 302 预签名', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    const res = await request(app).get(`/api/media/${mediaId}?st=${shareToken}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalled();
  });

  it('有效 st + 跨链 media → 404 MEDIA_NOT_FOUND（不泄露存在性）', async () => {
    const otherMoment = await insertMoment({ chainId: otherChainId, authorId: other.id, happenedAt: new Date() });
    const foreignMedia = await insertReadyMedia(other.id, otherMoment);

    const res = await request(app).get(`/api/media/${foreignMedia}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('st 吊销/过期/未知 → 404 SHARE_NOT_FOUND', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    // 吊销
    const revoked = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${revoked.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const r1 = await request(app).get(`/api/media/${mediaId}?st=${revoked.body.token}`);
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe('SHARE_NOT_FOUND');

    // 过期
    const expiring = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await db
      .update(shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareLinks.id, expiring.body.id));
    const r2 = await request(app).get(`/api/media/${mediaId}?st=${expiring.body.token}`);
    expect(r2.status).toBe(404);
    expect(r2.body.error.code).toBe('SHARE_NOT_FOUND');

    // 未知
    const r3 = await request(app).get(`/api/media/${mediaId}?st=${'f'.repeat(64)}`);
    expect(r3.status).toBe(404);
    expect(r3.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('有效 st + 未绑定 moment 的 media → 404（tmp/半成品不外发）', async () => {
    const unbound = await insertReadyMedia(owner.id, null);
    const res = await request(app).get(`/api/media/${unbound}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('有效 st + 软删 moment 的 media → 404', async () => {
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      deletedAt: new Date(),
    });
    const mediaId = await insertReadyMedia(owner.id, momentId);
    const res = await request(app).get(`/api/media/${mediaId}?st=${shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('匿名 无 st → 401；st 存在时忽略登录态（有效 st + 非成员登录 → 仍 302）', async () => {
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const mediaId = await insertReadyMedia(owner.id, momentId);

    const anon = await request(app).get(`/api/media/${mediaId}`);
    expect(anon.status).toBe(401);

    const loggedInOutsider = await request(app)
      .get(`/api/media/${mediaId}?st=${shareToken}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(loggedInOutsider.status).toBe(302);
  });

  it('有效 st + 本链 avatar/cover（未绑定 moment）→ 302', async () => {
    const avatarId = await insertReadyMedia(owner.id, null);
    const coverId = await insertReadyMedia(owner.id, null);
    await db
      .update(chains)
      .set({ avatarMediaId: avatarId, coverMediaId: coverId })
      .where(eq(chains.id, chainId));

    const avatarRes = await request(app).get(`/api/media/${avatarId}?st=${shareToken}`);
    expect(avatarRes.status).toBe(302);
    expect(avatarRes.headers.location).toBe('https://fake.local/presigned-get');

    const coverRes = await request(app).get(`/api/media/${coverId}?st=${shareToken}`);
    expect(coverRes.status).toBe(302);
    expect(coverRes.headers.location).toBe('https://fake.local/presigned-get');
    expect(storage.generateAccessUrl).toHaveBeenCalledTimes(2);
  });

  it('有效 st + 跨链 avatar/cover → 404 MEDIA_NOT_FOUND（不允许借 token 探测他链资源）', async () => {
    const foreignAvatar = await insertReadyMedia(other.id, null);
    const foreignCover = await insertReadyMedia(other.id, null);
    await db
      .update(chains)
      .set({ avatarMediaId: foreignAvatar, coverMediaId: foreignCover })
      .where(eq(chains.id, otherChainId));

    const r1 = await request(app).get(`/api/media/${foreignAvatar}?st=${shareToken}`);
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe('MEDIA_NOT_FOUND');

    const r2 = await request(app).get(`/api/media/${foreignCover}?st=${shareToken}`);
    expect(r2.status).toBe(404);
    expect(r2.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('吊销 token + 本链 avatar → 404 SHARE_NOT_FOUND（不泄露存在性）', async () => {
    const avatarId = await insertReadyMedia(owner.id, null);
    await db.update(chains).set({ avatarMediaId: avatarId }).where(eq(chains.id, chainId));

    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${link.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    const res = await request(app).get(`/api/media/${avatarId}?st=${link.body.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SHARE_NOT_FOUND');
  });
});
