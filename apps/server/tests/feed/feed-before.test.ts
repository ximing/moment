import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const jul = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-15T00:00:00Z') });
  const augEdge = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00.000Z') });
  const aug = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-20T00:00:00Z') });
  return { owner, chainId, jul, augEdge, aug };
}

describe('GET /api/feed?before=', () => {
  it('单独锚定：只返回 happened_at 严格小于 before 的（等于 before 的那条不出现）', async () => {
    const { owner, jul, augEdge, aug } = await setup();
    const res = await request(app)
      .get(`/api/feed?before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const ids = res.body.moments.map((m: { id: string }) => m.id);
    expect(ids).toEqual([jul]); // augEdge 恰好等于 before：严格小于 → 排除；aug 更晚 → 排除
    void augEdge;
    void aug;
  });

  it('before 与 cursor 同传：AND 取更严上界，翻页不越界', async () => {
    const { owner, chainId } = await setup();
    // 7 月再补 3 条，limit=2 翻页验证不会翻到 8 月
    for (let i = 1; i <= 3; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(`2026-07-0${i}T00:00:00Z`) });
    }
    const before = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const p1 = await request(app).get(`/api/feed?before=${before}&limit=2`).set(auth(owner.token));
    expect(p1.status).toBe(200);
    expect(p1.body.moments).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/api/feed?before=${before}&limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set(auth(owner.token));
    expect(p2.status).toBe(200);
    const ids = [...p1.body.moments, ...p2.body.moments].map((m: { happenedAt: string }) => m.happenedAt);
    expect(ids.every((h: string) => Date.parse(h) < Date.parse('2026-08-01T00:00:00.000Z'))).toBe(true);
    expect(p2.body.moments).toHaveLength(2);
  });

  it('before + order=created_at → 400 VALIDATION_ERROR（dto superRefine）', async () => {
    const { owner } = await setup();
    const res = await request(app)
      .get(`/api/feed?order=created_at&before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('before 非法值 → 400 VALIDATION_ERROR', async () => {
    const { owner } = await setup();
    const res = await request(app).get('/api/feed?before=not-a-date').set(auth(owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/chains/:chainId/moments?before=', () => {
  it('链内列表同样支持 before（恒 happened_at 语义），含严格小于边界', async () => {
    const { owner, chainId, jul } = await setup();
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((m: { id: string }) => m.id);
    expect(ids).toEqual([jul]);

    const bad = await request(app)
      .get(`/api/chains/${chainId}/moments?before=garbage`)
      .set(auth(owner.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
