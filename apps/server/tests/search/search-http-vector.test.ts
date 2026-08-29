import { jest } from '@jest/globals';
import request from 'supertest';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { auth } from './helpers.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

beforeEach(resetDb);
afterAll(closeDb);
beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

let storage: ReturnType<typeof installMockStorage>;
beforeEach(() => {
  storage = installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});

function llmText(text: string): LLMProvider {
  return {
    async chat() {
      return {
        content: JSON.stringify({ personNames: [], place: null, time: null, text }),
        model: 'm',
        usage: { prompt: 1, completion: 1, total: 2 },
      };
    },
  };
}

describe('POST /api/search 向量 HTTP', () => {
  it('仅 text 走距离序 {d,i}；embed 只收 text', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const near = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
      content: '近',
    });
    const far = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-12-01T00:00:00Z'),
      content: '远',
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: far,
      chainId,
      kind: 'moment',
      vector: denseVector(0.8),
      modelHash: HEX64_A,
    });

    const embed = jest.fn(async (req: { text?: string; imageDataUri?: string }) => {
      expect(req.imageDataUri).toBeUndefined();
      expect(req.text).toBe('近景');
      return denseVector(0.01);
    });
    setLLMProvider(llmText('近景'));
    setEmbeddingProvider({
      embed,
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });

    const res = await request(app).post('/api/search').set(auth(owner.token)).send({ q: '近景', tzOffset: 0, limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.moments[0].id).toBe(near);
    const raw = JSON.parse(Buffer.from(res.body.nextCursor, 'base64url').toString('utf8')) as {
      d: number;
      i: string;
      h?: unknown;
    };
    expect(raw.i).toBe(near);
    expect(raw.h).toBeUndefined();
    expect(Number.isFinite(raw.d)).toBe(true);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(storage.getObject).not.toHaveBeenCalled();

    const page2 = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '近景', tzOffset: 0, limit: 1, cursor: res.body.nextCursor });
    expect(page2.status).toBe(200);
    expect(page2.body.moments[0].id).toBe(far);
  });
});
