import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import nock from 'nock';
import { eq } from 'drizzle-orm';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { media, moments, momentPersons, outbox, persons } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { NonRetryableEmbeddingError } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { handleMomentEmbed } from '../../src/embedding/handle-moment-embed.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { computeEmbedHash, derivedFingerprintOf } from '../../src/moments/embed-hash.js';
import { ObjectTooLargeError } from '../../src/storage/bounded-read.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handlers } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const origin = new URL(config.INTERNAL_API_BASE_URL);
const WEBP = Buffer.from('RIFF....WEBP', 'utf8');
const DATA_URI = `data:image/webp;base64,${WEBP.toString('base64')}`;

let storage: MockStorage;
const embedCalls: Array<{ text?: string; imageDataUri?: string }> = [];

function mockProvider(vec = denseVector(0.1)): EmbeddingProvider {
  embedCalls.length = 0;
  return {
    embed: async (req) => {
      embedCalls.push({ text: req.text, imageDataUri: req.imageDataUri });
      return vec;
    },
    modelHash: () => HEX64_A,
    dimensions: () => config.MULTIMODAL_EMBEDDING_DIMENSION,
  };
}

function baNock(opts: { deletes?: number; posts?: number } = {}) {
  const deletes = opts.deletes ?? 1;
  const posts = opts.posts ?? 1;
  setBaAuthTokenForTests('ba-test');
  nock(`${origin.protocol}//${origin.host}`).delete(/\/api\/internal\/embeddings\//).times(deletes).reply(200, { deleted: 0 });
  if (posts > 0) {
    nock(`${origin.protocol}//${origin.host}`).post('/api/internal/embeddings').times(posts).reply(200, { ok: true });
  }
}

async function seedMoment(opts?: {
  content?: string;
  transcript?: string | null;
  placeName?: string | null;
  deletedAt?: Date | null;
  embedHash?: string | null;
}): Promise<{ momentId: string; chainId: string; ownerId: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-29T10:00:00Z'),
    content: opts?.content ?? '第一次翻身',
  });
  await db
    .update(moments)
    .set({
      transcript: opts?.transcript === undefined ? null : opts.transcript,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      deletedAt: opts?.deletedAt ?? null,
      embedHash: opts?.embedHash === undefined ? null : opts.embedHash,
    })
    .where(eq(moments.id, momentId));
  return { momentId, chainId, ownerId: owner.id };
}

async function addReadyImage(opts: {
  momentId: string;
  chainId: string;
  ownerId: string;
  sortOrder: number;
  mediaId?: string;
}): Promise<{ mediaId: string; derivedKey: string }> {
  const mediaId = opts.mediaId ?? randomUUID();
  const derivedKey = derivedObjectKey(opts.chainId, opts.momentId, mediaId);
  await db.insert(media).values({
    id: mediaId,
    momentId: opts.momentId,
    uploaderId: opts.ownerId,
    s3Key: `chains/${opts.chainId}/${opts.momentId}/${mediaId}.jpg`,
    mime: 'image/jpeg',
    size: 2048,
    sortOrder: opts.sortOrder,
    status: 'ready',
    storageMeta: {},
    derivedS3Key: derivedKey,
    derivedMime: 'image/webp',
    derivedSize: 100,
    derivedWidth: 512,
    derivedHeight: 256,
    derivedStatus: 'ready',
  });
  return { mediaId, derivedKey };
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  storage.getObject.mockResolvedValue(WEBP);
  setEmbeddingProvider(mockProvider());
  embedCalls.length = 0;
  nock.cleanAll();
  nock.disableNetConnect();
  // fixtures.registerUser 走 listenLocal 随机端口；BA 仍只允许 nock（host 钉死 INTERNAL_API_BASE_URL）。
  nock.enableNetConnect((host) => host.startsWith('127.0.0.1:') && host !== origin.host);
});
afterEach(() => {
  setStorageAdapter(null);
  setEmbeddingProvider(undefined);
  setBaAuthTokenForTests(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});
afterAll(closeDb);

describe('handleMomentEmbed（spec fused-retrieval §4.3）', () => {
  it('vl + 附图：先 DELETE 再两条 POST；读 derived key 不是原图；写 embed_hash；data URI', async () => {
    const { momentId, chainId, ownerId } = await seedMoment({ content: '正文', placeName: '公园' });
    const first = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const extra = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 1, mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const personId = randomUUID();
    await db.insert(persons).values({ id: personId, chainId, name: '外婆' });
    await db.insert(momentPersons).values({ momentId, personId, source: 'manual' });

    const posts: unknown[] = [];
    setBaAuthTokenForTests('ba-test');
    const scope = nock(`${origin.protocol}//${origin.host}`);
    scope.delete(`/api/internal/embeddings/${momentId}`).reply(200, { deleted: 0 });
    scope.post('/api/internal/embeddings', (body) => {
      posts.push(body);
      return true;
    }).times(2).reply(200, { ok: true });

    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });

    expect(storage.getObject).toHaveBeenCalledWith(first.derivedKey, {}, MAX_IMAGE_BYTES);
    expect(storage.getObject).toHaveBeenCalledWith(extra.derivedKey, {}, MAX_IMAGE_BYTES);
    expect(storage.getObject.mock.calls.every((c) => String(c[0]).includes('.derived.webp'))).toBe(true);
    expect(embedCalls[0]).toEqual({ text: expect.stringContaining('正文'), imageDataUri: DATA_URI });
    expect(embedCalls[1]).toEqual({ imageDataUri: DATA_URI });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ momentId, chainId, kind: 'moment', modelHash: HEX64_A });
    expect((posts[0] as { mediaId?: string }).mediaId).toBeUndefined();
    expect(posts[1]).toMatchObject({ kind: 'image', mediaId: extra.mediaId });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    const fp = derivedFingerprintOf([
      { id: first.mediaId, mime: 'image/jpeg', sortOrder: 0, derivedStatus: 'ready', derivedS3Key: first.derivedKey },
      { id: extra.mediaId, mime: 'image/jpeg', sortOrder: 1, derivedStatus: 'ready', derivedS3Key: extra.derivedKey },
    ]);
    expect(m.embedHash).toBe(
      computeEmbedHash({
        content: '正文',
        transcript: null,
        personNames: ['外婆'],
        placeName: '公园',
        derivedFingerprint: fp,
        model: config.MULTIMODAL_EMBEDDING_MODEL,
        dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
      }),
    );
    expect(scope.isDone()).toBe(true);
  });

  it('hash 相同 → 零 getObject 零 BA 零 embed()', async () => {
    const { momentId, chainId } = await seedMoment({ content: 'x' });
    const hash = computeEmbedHash({
      content: 'x',
      transcript: null,
      personNames: [],
      placeName: null,
      derivedFingerprint: '',
      model: config.MULTIMODAL_EMBEDDING_MODEL,
      dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
    });
    await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(embedCalls).toEqual([]);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('getEmbeddingProvider()=null → 跳过且不写 hash', async () => {
    setEmbeddingProvider(null);
    const { momentId, chainId } = await seedMoment();
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(embedCalls).toEqual([]);
  });

  it('软删 / 不存在 → 跳过，不调 BA', async () => {
    await expect(handleMomentEmbed({ momentId: randomUUID(), chainId: randomUUID() }, { push: mockPush })).resolves.toBeUndefined();
    const { momentId, chainId } = await seedMoment({ deletedAt: new Date() });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('无文本无 ready 图：DELETE 一次，不 POST，不写 hash', async () => {
    const { momentId, chainId } = await seedMoment({ content: '' });
    baNock({ deletes: 1, posts: 0 });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(embedCalls).toEqual([]);
  });

  it('failed 图不组装；pending 不在 ready 列表；第一张含 poster（sortOrder,id）', async () => {
    const { momentId, chainId, ownerId } = await seedMoment({ content: 'v' });
    const posterId = '11111111-1111-4111-8111-111111111111';
    const laterId = '22222222-2222-4222-8222-222222222222';
    const failedId = randomUUID();
    await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: laterId });
    const poster = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: posterId });
    await db.insert(media).values({
      id: failedId,
      momentId,
      uploaderId: ownerId,
      s3Key: 'orig.jpg',
      mime: 'image/jpeg',
      size: 10,
      sortOrder: 0,
      status: 'ready',
      storageMeta: {},
      derivedStatus: 'failed',
    });
    baNock({ deletes: 1, posts: 2 });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(embedCalls[0]!.imageDataUri).toBe(DATA_URI);
    expect(storage.getObject.mock.calls[0]![0]).toBe(poster.derivedKey);
  });

  it('ObjectTooLargeError on derived → NonRetryableEmbeddingError；不改 outbox.status', async () => {
    const { momentId, chainId, ownerId } = await seedMoment();
    const img = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0 });
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(img.derivedKey, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'pending',
    });
    await expect(handleMomentEmbed({ momentId, chainId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
      message: 'OBJECT_TOO_LARGE',
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('pending');
  });

  it('processor：NonRetryableEmbeddingError 立即 failed + last_error', async () => {
    const { momentId, chainId, ownerId } = await seedMoment();
    const img = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0 });
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(img.derivedKey, MAX_IMAGE_BYTES));
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'pending',
    });
    const result = await runOutboxBatch({ push: mockPush });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [ob] = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(ob.status).toBe('failed');
    expect(ob.lastError).toBe('OBJECT_TOO_LARGE');
    expect(ob.attempts).toBe(1);
  });

  it('handlers 登记 moment.embed', () => {
    expect(handlers['moment.embed']).toBe(handleMomentEmbed);
  });
});
