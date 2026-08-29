import request from 'supertest';
import { SEARCH_DEFAULT_LIMIT } from '@moment/dto';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import type { SearchParsed } from '@moment/dto';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { auth, setPlace } from './helpers.js';

beforeEach(resetDb);
afterAll(closeDb);

let storage: ReturnType<typeof installMockStorage>;
beforeEach(() => {
  storage = installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
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

describe('POST /api/search HTTP（spec §6.2 / §9）', () => {
  it('未登录 401；缺 tzOffset / q 超 500 / from>to → 400 VALIDATION_ERROR', async () => {
    expect((await request(app).post('/api/search').send({ q: '外婆', tzOffset: -480 })).status).toBe(401);

    const user = await registerUser();
    const missingTz = await request(app).post('/api/search').set(auth(user.token)).send({ q: '外婆' });
    expect(missingTz.status).toBe(400);
    expect(missingTz.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await request(app)
      .post('/api/search')
      .set(auth(user.token))
      .send({ q: 'x'.repeat(501), tzOffset: 0 });
    expect(tooLong.status).toBe(400);

    const range = await request(app)
      .post('/api/search')
      .set(auth(user.token))
      .send({
        q: '外婆',
        tzOffset: 0,
        happenedFrom: '2026-08-02T00:00:00.000Z',
        happenedTo: '2026-08-01T00:00:00.000Z',
      });
    expect(range.status).toBe(400);
    expect(JSON.stringify(range.body)).not.toContain('RANGE_REQUIRES_HAPPENED_AT');
  });

  it('空 LLM：parsed.text===q；body before 被 strip；不调用 getObject；默认 limit 语义 20', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const m = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '野餐', tzOffset: -480, before: '2026-08-01T00:00:00Z', order: 'created_at' });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({ personNames: [], place: null, time: null, text: '野餐' });
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([m]);
    expect(res.body.moments[0].persons).toBeDefined();
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
  });

  it('他链 chainIds 静默丢弃；空页；坏游标 400 INVALID_CURSOR', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const a = await createChain(alice.id, 'A');
    const c = await createChain(carol.id, 'C');
    await insertMoment({
      chainId: a,
      authorId: alice.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '野餐',
    });
    await insertMoment({
      chainId: c,
      authorId: carol.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
      content: '野餐',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(alice.token))
      .send({ q: '野餐', tzOffset: 0, chainIds: [c] });
    expect(res.status).toBe(200);
    expect(res.body.moments).toEqual([]);

    const bad = await request(app)
      .post('/api/search')
      .set(auth(alice.token))
      .send({ q: '野餐', tzOffset: 0, cursor: '!!!not-base64!!!' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
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
    setEmbeddingProvider(null);
    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '外婆', tzOffset: -480 });
    expect(res.status).toBe(200);
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([hit]);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(dump);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('季节 range 闭区间 + chip AND place（不带 before）', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const grandma = await insertPerson({ chainId: a, name: '外婆' });
    const inSummer = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-07-15T00:00:00Z'),
    });
    const outSummer = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-09-01T00:00:00Z'),
    });
    const noPerson = await insertMoment({
      chainId: a,
      authorId: owner.id,
      happenedAt: new Date('2025-07-15T00:00:00Z'),
    });
    await attachPerson(inSummer, grandma);
    await attachPerson(outSummer, grandma);
    await setPlace(inSummer, '朝阳公园');
    await setPlace(outSummer, '朝阳公园');
    await setPlace(noPerson, '朝阳公园');

    setLLMProvider(
      llm({
        personNames: ['外婆'],
        place: null,
        time: { kind: 'range', from: '2025-06-01T00:00:00.000Z', to: '2025-08-31T23:59:59.999Z' },
        text: '',
      }),
    );
    setEmbeddingProvider(null);

    const res = await request(app)
      .post('/api/search')
      .set(auth(owner.token))
      .send({ q: '去年夏天和外婆', tzOffset: -480, place: '朝阳公园' });
    expect(res.status).toBe(200);
    expect(res.body.moments.map((x: { id: string }) => x.id)).toEqual([inSummer]);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(outSummer);
    expect(res.body.moments.map((x: { id: string }) => x.id)).not.toContain(noPerson);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
