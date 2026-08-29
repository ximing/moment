import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

let storage: MockStorage;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

async function insertBoundImage(opts: {
  momentId: string;
  uploaderId: string;
  derivedStatus: 'pending' | 'ready' | 'skipped' | 'failed' | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/x/${opts.momentId}/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts.derivedStatus,
    derivedS3Key:
      opts.derivedStatus === 'ready' ? `chains/x/${opts.momentId}/${id}.derived.webp` : null,
    derivedMime: opts.derivedStatus === 'ready' ? 'image/webp' : null,
  });
  return id;
}

describe('serializeMoments derivedUrl（spec §2.1 / §9）', () => {
  it('链内 GET：ready 出 derivedUrl；pending 为 null；JSON 为预签名 GET；不 getObject', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const readyMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
    });
    const pendingMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-28T00:00:00Z'),
    });
    const readyId = await insertBoundImage({
      momentId: readyMoment,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });
    await insertBoundImage({
      momentId: pendingMoment,
      uploaderId: owner.id,
      derivedStatus: 'pending',
    });

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const readyItem = res.body.items.find((m: { id: string }) => m.id === readyMoment);
    const pendingItem = res.body.items.find((m: { id: string }) => m.id === pendingMoment);
    expect(readyItem.media[0].url).toBe('https://fake.local/presigned-get');
    expect(readyItem.media[0].derivedUrl).toBe('https://fake.local/presigned-get');
    expect(readyItem.media[0].posterDerivedUrl).toBeNull();
    expect(pendingItem.media[0].derivedUrl).toBeNull();
    expect(storage.generateAccessUrl).toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('视频封面 ready → posterDerivedUrl；poster 行不进 media[]', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
    });
    const posterId = await insertBoundImage({
      momentId,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });
    const videoId = randomUUID();
    await db.insert(media).values({
      id: videoId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/x/${momentId}/${videoId}.mp4`,
      mime: 'video/mp4',
      size: 2048,
      status: 'ready',
      storageMeta: TEST_META,
      posterMediaId: posterId,
      derivedStatus: null,
    });
    await db.update(moments).set({ type: 'video' }).where(eq(moments.id, momentId));

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].id).toBe(videoId);
    expect(res.body.media[0].posterMediaId).toBe(posterId);
    expect(res.body.media[0].posterUrl).toBe('https://fake.local/presigned-get');
    expect(res.body.media[0].posterDerivedUrl).toBe('https://fake.local/presigned-get');
    expect(res.body.media[0].derivedUrl).toBeNull();
  });

  it('share-album：有 derivedUrl，无 persons/place 键', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
      content: '有图',
    });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId, 'manual');
    const imageId = await insertBoundImage({
      momentId,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });

    const link = await request(app).post(`/api/chains/${chainId}/share-links`).set(auth(owner.token)).send({});
    expect(link.status).toBe(201);
    const res = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    expect('persons' in res.body.moments[0]).toBe(false);
    expect('place' in res.body.moments[0]).toBe(false);
    expect(res.body.moments[0].media[0].derivedUrl).toBe('https://fake.local/presigned-get');
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
