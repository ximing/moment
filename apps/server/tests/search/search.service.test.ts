import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { SearchParsed } from '@moment/dto';
import { SEARCH_DEFAULT_LIMIT } from '@moment/dto';
import { Container } from 'typedi';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { SearchService } from '../../src/search/search.service.js';
import { encodeDistanceCursor } from '../../src/search/search-cursor.js';
import { HARD_FILTER_PREFILTER_MAX, VECTOR_CANDIDATE_LIMIT } from '../../src/search/constants.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A, HEX64_B } from '../helpers/lance.js';

beforeEach(resetDb);
afterAll(closeDb);

beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

afterEach(() => {
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});

function llm(parsed: SearchParsed): LLMProvider {
  return {
    async chat() {
      return { content: JSON.stringify(parsed), model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
    },
  };
}

function embedding(vec: number[], hash = HEX64_A, embedFn?: EmbeddingProvider['embed']): EmbeddingProvider {
  return {
    embed: embedFn ?? (async () => vec),
    modelHash: () => hash,
    dimensions: () => vec.length,
  };
}

function svc() {
  return Container.get(SearchService);
}

describe('SearchService 分层 C（spec §4.5 / §5 / §3.3）', () => {
  it('text==="" 仅硬过滤：happened_at 序、{h,i}、不调 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);

    const embedFn = jest.fn<EmbeddingProvider['embed']>();
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A, embedFn));

    const res = await svc().search(owner.id, { q: '外婆', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.parsed).toEqual({ personNames: ['外婆'], place: null, time: null, text: '' });
    expect(embedFn).not.toHaveBeenCalled();
    expect(res.moments[0].persons.some((p) => p.id === grandma)).toBe(true);
    if (res.nextCursor) {
      const raw = JSON.parse(Buffer.from(res.nextCursor, 'base64url').toString('utf8')) as { d?: unknown };
      expect(raw.d).toBeUndefined();
    }
  });

  it('空 embedding + 非空 text → LIKE（% 转义）；limit 缺省 20', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '100%_off',
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: '100X_off',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await svc().search(owner.id, { q: '100%_off', tzOffset: 0 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.parsed.text).toBe('100%_off');
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(HARD_FILTER_PREFILTER_MAX).toBe(200);
    expect(VECTOR_CANDIDATE_LIMIT).toBe(200);
  });

  it('向量：去重最小 L2；平局 momentId DESC；{d,i} 翻页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const near = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
      content: '近',
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-02-01T00:00:00Z'),
      content: '中',
    });
    const tieA = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-03-01T00:00:00Z'),
      content: '平',
    });
    const tieB = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-04-01T00:00:00Z'),
      content: '平2',
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: near,
      chainId,
      kind: 'image',
      mediaId: randomUUID(),
      vector: denseVector(0.0),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: mid,
      chainId,
      kind: 'moment',
      vector: denseVector(0.2),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: tieA,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: tieB,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });

    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '近景' }));
    setEmbeddingProvider(embedding(denseVector(0.0)));

    const p1 = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 2 });
    expect(p1.moments).toHaveLength(2);
    expect(p1.moments[0].id).toBe(near);
    const raw1 = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as { d: number; i: string };
    expect(typeof raw1.d).toBe('number');
    expect(Number.isFinite(raw1.d)).toBe(true);

    const p2 = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 2, cursor: p1.nextCursor! });
    expect(p2.moments[0].id).not.toBe(near);
    const seen = [...p1.moments, ...p2.moments].map((m) => m.id);
    expect(seen).toContain(mid);
    const tiePos = seen.filter((id) => id === tieA || id === tieB);
    if (tiePos.length === 2) {
      expect(tiePos[0] > tiePos[1]).toBe(true);
    }

    const sameD = encodeDistanceCursor(raw1.d, raw1.i);
    const next = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 10, cursor: sameD });
    expect(next.moments.every((m) => m.id !== raw1.i)).toBe(true);
  });

  it('硬过滤 + 向量：结果都含人物', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: '野餐',
    });
    await attachPerson(hit, grandma);
    await upsertMomentVector({
      momentId: hit,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: miss,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '野餐' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    const res = await svc().search(owner.id, { q: '外婆野餐', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.moments[0].persons.some((p) => p.id === grandma)).toBe(true);
  });

  it('modelHash 全不匹配 → 空页，不回退 LIKE（content 能被 LIKE 命中也忽略）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const m = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '独一无二的正文XYZ',
    });
    await upsertMomentVector({
      momentId: m,
      chainId,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_B,
    });
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '独一无二的正文XYZ' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A));
    const res = await svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 });
    expect(res.moments).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it('空 scope 坏距离游标仍 INVALID_CURSOR', async () => {
    const loner = await registerUser();
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: 'x' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    await expect(svc().search(loner.id, { q: 'x', tzOffset: 0, cursor: '!!!' })).rejects.toMatchObject({
      message: 'INVALID_CURSOR',
    });
  });

  it('丢链：无外婆且无其它约束的链不倾倒时间线', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const b = await createChain(owner.id, 'B');
    const grandma = await insertPerson({ chainId: a, name: '外婆' });
    const hit = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const dump = await insertMoment({
      chainId: b,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '' }));
    setEmbeddingProvider(embedding(denseVector(0.01)));
    const res = await svc().search(owner.id, { q: '外婆', tzOffset: -480 });
    expect(res.moments.map((m) => m.id)).toEqual([hit]);
    expect(res.moments.map((m) => m.id)).not.toContain(dump);
  });

  it('硬过滤 0 命中：空页且不调 embed（HARD_FILTER_PREFILTER_MAX）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertPerson({ chainId, name: '外婆' });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    const embedFn = jest.fn(async () => denseVector(0.01));
    setLLMProvider(llm({ personNames: ['外婆'], place: null, time: null, text: '野餐' }));
    setEmbeddingProvider(embedding(denseVector(0.01), HEX64_A, embedFn));
    const res = await svc().search(owner.id, { q: '外婆野餐', tzOffset: -480 });
    expect(res.moments).toEqual([]);
    expect(res.nextCursor).toBeNull();
    expect(embedFn).not.toHaveBeenCalled();
  });

  it('向量翻页窗口是 200 不是 limit*3（第 4 页仍命中）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
        content: `v${i}`,
      });
      ids.push(id);
      await upsertMomentVector({
        momentId: id,
        chainId,
        kind: 'moment',
        vector: denseVector(0.01 * (i + 1)),
        modelHash: HEX64_A,
      });
    }
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '近景' }));
    setEmbeddingProvider(embedding(denseVector(0)));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const res = await svc().search(owner.id, { q: '近景', tzOffset: 0, limit: 1, cursor });
      expect(res.moments).toHaveLength(1);
      seen.push(res.moments[0].id);
      cursor = res.nextCursor ?? undefined;
    }
    expect(new Set(seen).size).toBe(4);
    expect(seen[0]).toBe(ids[0]);
  });

  it('embed 抛错 / LANCE_NOT_READY → 空页，不回退 LIKE', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '独一无二的正文XYZ',
    });
    setLLMProvider(llm({ personNames: [], place: null, time: null, text: '独一无二的正文XYZ' }));
    setEmbeddingProvider({
      embed: async () => {
        throw new Error('dashscope down');
      },
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });
    await expect(svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 })).resolves.toMatchObject({
      moments: [],
      nextCursor: null,
    });

    setEmbeddingProvider(embedding(denseVector(0.01)));
    await closeLanceForTests();
    try {
      const res = await svc().search(owner.id, { q: '独一无二的正文XYZ', tzOffset: 0 });
      expect(res.moments).toEqual([]);
      expect(res.nextCursor).toBeNull();
    } finally {
      await ensureLance();
    }
  });
});
