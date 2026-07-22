import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/chains/:chainId/moments（共用 builder 重构后行为）', () => {
  it('跨页稳定：同 happened_at 多 moment 翻页不丢不重，nextCursor 与 feed 同格式', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const same = new Date('2026-06-01T12:00:00Z');
    for (let i = 0; i < 4; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      // 显式标注：循环里 cursor 由 res.body.nextCursor 赋值，res 初始化器又用到 cursor，
      // 不标注会形成类型推断环（TS7022）
      const q: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const res: request.Response = await request(app).get(`/api/chains/${chainId}/moments${q}`).set(auth(owner.token));
      expect(res.status).toBe(200);
      collected.push(...res.body.items.map((m: { id: string }) => m.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(collected).toHaveLength(4);
    expect(new Set(collected).size).toBe(4);
  });

  it('软删 moment 不出现在链内列表', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-06-02T00:00:00Z'), deletedAt: new Date(),
    });
    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('游标损坏返回 400 INVALID_CURSOR（与 feed 一致）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?cursor=${encodeURIComponent('%%%bad%%%')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('响应 items 含 tags 字段', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].tags).toEqual([]);
  });

  it('空串 cursor → 400 VALIDATION_ERROR', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?cursor=`)
      .set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
