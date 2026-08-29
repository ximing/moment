import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import nock from 'nock';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { SearchParsed } from '@moment/dto';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { deleteVectorsByMomentId, listVectorsByMomentId, upsertMomentVector } from '../../src/lancedb/repository.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import type { PushService } from '../../src/push/push-service.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { auth } from './helpers.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const origin = new URL(config.INTERNAL_API_BASE_URL);

const PLACE = {
  name: '外婆家',
  lat: 39.9042,
  lng: 116.4074,
};

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function dualLlm(intent: SearchParsed): LLMProvider {
  return {
    async chat(req) {
      const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
      if (sys.includes('搜索意图解析器')) {
        return {
          content: JSON.stringify(intent),
          model: 'mock-intent',
          usage: { prompt: 1, completion: 1, total: 2 },
        };
      }
      return {
        content: JSON.stringify({ persons: [], places: [] }),
        model: 'mock-extract',
        usage: { prompt: 1, completion: 1, total: 2 },
      };
    },
  };
}

function mockEmbedding(): EmbeddingProvider {
  return {
    embed: async () => denseVector(0.1),
    modelHash: () => HEX64_A,
    dimensions: () => denseVector().length,
  };
}

function installObjectStore(storage: MockStorage, objects: Map<string, Buffer>): void {
  storage.getObject.mockImplementation(async (key) => {
    const buf = objects.get(key);
    if (!buf) throw new Error(`getObject missing ${key}`);
    return buf;
  });
  storage.uploadFile.mockImplementation(async (key, body) => {
    objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
  });
  storage.copyObject.mockImplementation(async (src, dest) => {
    const buf = objects.get(src);
    if (buf) objects.set(dest, buf);
  });
  storage.headObject.mockImplementation(async (key) => {
    const buf = objects.get(key);
    if (!buf) return null;
    return { size: buf.length, contentType: 'image/jpeg', lastModified: new Date() };
  });
}

function installBaLanceBridge(): nock.Scope {
  setBaAuthTokenForTests('e2e-ba');
  const scope = nock(`${origin.protocol}//${origin.host}`).persist();
  scope.delete(/\/api\/internal\/embeddings\/[0-9a-f-]+$/i).reply(200, async (uri: string) => {
    const momentId = uri.split('/').pop() as string;
    const deleted = await deleteVectorsByMomentId(momentId);
    return { deleted };
  });
  scope.post('/api/internal/embeddings').reply(200, async (_uri: string, raw: nock.Body) => {
    const body = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    await upsertMomentVector({
      momentId: String(body.momentId),
      chainId: String(body.chainId),
      kind: body.kind as 'moment' | 'image',
      mediaId: typeof body.mediaId === 'string' ? body.mediaId : undefined,
      vector: body.vector as number[],
      modelHash: String(body.modelHash),
    });
    return { ok: true };
  });
  return scope;
}

async function drainOutbox(maxBatches = 12): Promise<void> {
  for (let i = 0; i < maxBatches; i++) {
    const batch = await runOutboxBatch({ push: mockPush, batchSize: 50 });
    if (batch.claimed === 0) return;
    expect(batch.failed).toBe(0);
  }
  throw new Error('outbox did not drain');
}

async function readyJpeg(token: string, objects: Map<string, Buffer>, jpeg: Buffer): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set(auth(token))
    .send({ mime: 'image/jpeg', size: jpeg.length, kind: 'image' });
  expect(presigned.status).toBe(201);
  const mediaId = presigned.body.mediaId as string;
  const [row] = await db.select().from(media).where(eq(media.id, mediaId));
  objects.set(row.s3Key, jpeg);
  const complete = await request(app).post(`/api/media/${mediaId}/complete`).set(auth(token)).send({});
  expect(complete.status).toBe(200);
  return mediaId;
}

let storage: MockStorage;
let objects: Map<string, Buffer>;

beforeAll(ensureLance);
beforeEach(async () => {
  await resetDb();
  await resetLanceForTests();
  objects = new Map();
  storage = installMockStorage();
  installObjectStore(storage, objects);
  nock.cleanAll();
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1/);
  installBaLanceBridge();
  setEmbeddingProvider(mockEmbedding());
  setLLMProvider(
    dualLlm({ personNames: ['外婆'], place: '外婆家', time: null, text: '' }),
  );
});
afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
  setBaAuthTokenForTests(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});
afterAll(async () => {
  await closeLanceForTests();
  await closeDb();
});

describe('融合检索 e2e（spec §9：建时刻人+地点+图 → compress mock → embed mock → GET person_id → POST search → share-album）', () => {
  it('全管线：派生 ready + 向量落 Lance + chip/search 命中 + 请求线程零 getObject + 分享无 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const jpeg = await jpegOf(2000, 1000);

    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    const personId = person.body.id as string;

    const mediaId = await readyJpeg(owner.token, objects, jpeg);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'media',
        content: '第一次翻身，在外婆家',
        happenedAt: '2026-08-20T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [mediaId],
        personIds: [personId],
        place: PLACE,
      });
    expect(created.status).toBe(201);
    expect(created.body.persons).toEqual([
      { id: personId, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(created.body.place).toEqual({ ...PLACE, source: 'manual' });
    const momentId = created.body.id as string;

    const compressPending = await db.select().from(outbox).where(eq(outbox.type, 'moment.compress'));
    expect(compressPending).toHaveLength(1);
    expect(compressPending[0]!.payload).toEqual({ momentId, chainId, mediaId });

    const jobsBefore = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set(auth(owner.token));
    expect(jobsBefore.status).toBe(200);
    expect(jobsBefore.body.jobs.some((j: { type: string }) => j.type === 'moment.compress')).toBe(true);
    expect(jobsBefore.body.jobs.every((j: { type: string }) => j.type !== 'moment.extract')).toBe(true);

    await drainOutbox();
    storage.getObject.mockClear();

    const [mediaRow] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(mediaRow.derivedStatus).toBe('ready');
    expect(mediaRow.derivedMime).toBe('image/webp');
    expect(mediaRow.derivedS3Key).toBe(derivedObjectKey(chainId, momentId, mediaId));
    expect(mediaRow.derivedWidth).toBe(1280);
    expect(mediaRow.derivedHeight).toBe(640);
    expect(objects.has(mediaRow.derivedS3Key as string)).toBe(true);

    const [momentRow] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(momentRow.embedHash).toEqual(expect.any(String));
    expect(momentRow.embedHash).toHaveLength(64);

    const vectors = await listVectorsByMomentId(momentId);
    expect(vectors.some((v) => v.kind === 'moment')).toBe(true);
    expect(vectors.every((v) => v.modelHash === HEX64_A)).toBe(true);

    const derivedGet = await request(app)
      .get(`/api/media/${mediaId}?variant=derived`)
      .set(auth(owner.token));
    expect(derivedGet.status).toBe(302);
    expect(
      storage.generateAccessUrl.mock.calls.some((c) => String(c[0]).endsWith('.derived.webp')),
    ).toBe(true);

    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&person_id=${personId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    expect(feed.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(feed.body.moments[0].persons[0].name).toBe('外婆');
    expect(feed.body.moments[0].media[0].derivedUrl).toBe('https://fake.local/presigned-get');
    expect(feed.body.moments[0].media[0].url).toBe('https://fake.local/presigned-get');

    const list = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${personId}`)
      .set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: { id: string }) => m.id)).toEqual([momentId]);

    const missing = await request(app)
      .get(`/api/feed?person_id=${randomUUID()}`)
      .set(auth(owner.token));
    expect(missing.status).toBe(200);
    expect(missing.body.moments).toEqual([]);

    const otherChain = await createChain(owner.id, '另一链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '邻居' });
    expect(foreign.status).toBe(201);
    const foreignList = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${foreign.body.id}`)
      .set(auth(owner.token));
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.items).toEqual([]);

    setLLMProvider(
      dualLlm({ personNames: ['外婆'], place: '外婆家', time: null, text: '' }),
    );
    const hardSearch = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '外婆',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(hardSearch.status).toBe(200);
    expect(hardSearch.body.parsed).toEqual({
      personNames: ['外婆'],
      place: '外婆家',
      time: null,
      text: '',
    });
    expect(hardSearch.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(hardSearch.body.nextCursor).toBeNull();

    const embed = jest.fn(async (req: { text?: string; imageDataUri?: string }) => {
      expect(req.imageDataUri).toBeUndefined();
      expect(req.text).toBe('第一次翻身');
      return denseVector(0.1);
    });
    setEmbeddingProvider({
      embed,
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });
    setLLMProvider(
      dualLlm({ personNames: [], place: null, time: null, text: '第一次翻身' }),
    );
    const vectorSearch = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '第一次翻身',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(vectorSearch.status).toBe(200);
    expect(vectorSearch.body.moments[0].id).toBe(momentId);
    expect(vectorSearch.body.parsed.text).toBe('第一次翻身');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(vectorSearch.body.nextCursor).toBeNull();

    expect(storage.getObject).not.toHaveBeenCalled();

    const jobsAfter = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set(auth(owner.token));
    expect(jobsAfter.status).toBe(200);
    expect(jobsAfter.body.jobs).toEqual([]);

    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set(auth(owner.token))
      .send({});
    expect(link.status).toBe(201);
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    const shared = pub.body.moments[0];
    expect('persons' in shared).toBe(false);
    expect('place' in shared).toBe(false);
    expect(Object.keys(shared)).not.toContain('persons');
    expect(Object.keys(shared)).not.toContain('place');
    expect(shared.content).toBe('第一次翻身，在外婆家');
    expect(shared.media[0].derivedUrl).toBe('https://fake.local/presigned-get');

    const pending = await db.select().from(outbox).where(eq(outbox.status, 'pending'));
    expect(pending).toHaveLength(0);
  });

  it('丢链：q=外婆 且无其它约束时，没有该人名的链不倾倒整链时间线（spec §3.2 / §9）', async () => {
    const owner = await registerUser();
    const withGrandma = await createChain(owner.id, '有外婆');
    const other = await createChain(owner.id, '无外婆');
    const person = await request(app)
      .post(`/api/chains/${withGrandma}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);

    const hit = await request(app)
      .post(`/api/chains/${withGrandma}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'text',
        content: '和外婆吃饭',
        happenedAt: '2026-08-20T10:00:00+08:00',
        happenedTzOffset: -480,
        personIds: [person.body.id],
      });
    expect(hit.status).toBe(201);
    const dumped = await request(app)
      .post(`/api/chains/${other}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'text',
        content: '完全无关的日记',
        happenedAt: '2026-08-21T10:00:00+08:00',
        happenedTzOffset: -480,
      });
    expect(dumped.status).toBe(201);

    setEmbeddingProvider(null);
    setLLMProvider(
      dualLlm({ personNames: ['外婆'], place: null, time: null, text: '' }),
    );
    const res = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '外婆',
      tzOffset: -480,
    });
    expect(res.status).toBe(200);
    const ids = res.body.moments.map((m: { id: string }) => m.id);
    expect(ids).toContain(hit.body.id);
    expect(ids).not.toContain(dumped.body.id);
  });

  it('空 embedding：LIKE 转义后命中 content，不调 getObject，parsed.text===q', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '100%野餐_计划',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    storage.getObject.mockClear();

    const res = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '100%野餐_计划',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '100%野餐_计划',
    });
    expect(res.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
