import request from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 东八区（tz_offset=-480）下 2026-08-01 00:30 本地 = UTC 2026-07-31 16:30 */
const AUG_LOCAL = new Date('2026-07-31T16:30:00Z');

describe('GET /api/feed/month-index', () => {
  it('按查看者时区归桶：同一 UTC 时刻，不同 tz_offset 落不同月', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: AUG_LOCAL });

    const east8 = await request(app).get('/api/feed/month-index?tz_offset=-480').set(auth(owner.token));
    expect(east8.status).toBe(200);
    expect(east8.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });

    const utc = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(owner.token));
    expect(utc.status).toBe(200);
    expect(utc.body).toEqual({ months: [{ month: '2026-07', count: 1 }] });
  });

  it('多月倒序聚合；同月计数；软删排除', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-10T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-20T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-15T00:00:00Z'), deletedAt: new Date(),
    });

    const res = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      months: [
        { month: '2026-08', count: 2 },
        { month: '2026-06', count: 1 },
      ],
    });
  });

  it('chain_ids 收窄到我的链子集；非成员链静默忽略；空范围返回 []', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const chainA = await createChain(alice.id, 'A');
    const chainC = await createChain(carol.id, 'C');
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z') });
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-08-02T00:00:00Z') });

    const narrowed = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&chain_ids=${chainA},${chainC}`)
      .set(auth(alice.token));
    expect(narrowed.status).toBe(200);
    expect(narrowed.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });

    const allForeign = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&chain_ids=${chainC}`)
      .set(auth(alice.token));
    expect(allForeign.status).toBe(200);
    expect(allForeign.body).toEqual({ months: [] });

    const loner = await registerUser();
    const empty = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(loner.token));
    expect(empty.body).toEqual({ months: [] });
  });

  it('tag_id 过滤：只统计带该 tag 的 moment', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const tagRes = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagged = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-02T00:00:00Z') });
    await attachTag(tagged, tagRes.body.id);

    const res = await request(app)
      .get(`/api/feed/month-index?tz_offset=0&tag_id=${tagRes.body.id}`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: [{ month: '2026-08', count: 1 }] });
  });

  it('viewer 成员身份即可读（索引只要求成员资格，与 feed 一致）', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const res = await request(app).get('/api/feed/month-index?tz_offset=0').set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(1);
  });

  it('缺省/非法 tz_offset → 400 VALIDATION_ERROR；未登录 401', async () => {
    const owner = await registerUser();
    const missing = await request(app).get('/api/feed/month-index').set(auth(owner.token));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const bad = await request(app).get('/api/feed/month-index?tz_offset=abc').set(auth(owner.token));
    expect(bad.status).toBe(400);

    const outOfRange = await request(app).get('/api/feed/month-index?tz_offset=900').set(auth(owner.token));
    expect(outOfRange.status).toBe(400);

    const anon = await request(app).get('/api/feed/month-index?tz_offset=0');
    expect(anon.status).toBe(401);
  });
});
