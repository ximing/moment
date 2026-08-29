import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chains, media, moments } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let storage: MockStorage;
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
    wallDate: wallDateOf(new Date('2026-08-15T10:00:00Z'), -480),
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
    expect(storage.getObject).not.toHaveBeenCalled();
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

  it('带 ?st= 未知 share token → 404 SHARE_NOT_FOUND（Phase 8 已落地透传，完整矩阵见 tests/share/share-media.test.ts）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}?st=${'0'.repeat(64)}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('未登录 → 401（用真实存在的 mediaId，只考察鉴权这一个维度）', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });
    const res = await request(app).get(`/api/media/${mediaId}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/media/:id — 链头像/封面引用', () => {
  it('链头像：viewer 成员 → 302；非成员 → 404；非成员 uploader 本人也 → 404（链引用优先）', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const mediaId = await insertReadyMedia({ uploaderId: carol.id, momentId: null });
    await db.update(chains).set({ avatarMediaId: mediaId }).where(eq(chains.id, chainId));

    const member = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(member.status).toBe(302);
    expect(member.headers.location).toBe('https://fake.local/presigned-get');

    // uploader 本人（carol）不是链成员 → 链引用优先，404
    const uploader = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${carol.token}`);
    expect(uploader.status).toBe(404);
  });

  it('链封面：链成员 → 302；未被任何链引用的未绑定 media 仍只允许 uploader', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const coverId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });
    await db.update(chains).set({ coverMediaId: coverId }).where(eq(chains.id, chainId));

    const member = await request(app)
      .get(`/api/media/${coverId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(member.status).toBe(302);

    const unbound = await insertReadyMedia({ uploaderId: alice.id, momentId: null });
    const own = await request(app)
      .get(`/api/media/${unbound}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(own.status).toBe(302);
    const other = await request(app)
      .get(`/api/media/${unbound}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(other.status).toBe(404);
  });
});
