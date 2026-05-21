import request from 'supertest';
import type { Response } from 'supertest';
import { db } from '../../src/db/index.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getFeed(token: string, query = ''): Promise<Response> {
  return request(app).get(`/api/feed${query}`).set(auth(token));
}

function ids(res: Response): string[] {
  return res.body.moments.map((m: { id: string }) => m.id);
}

/** 三条链：A（alice=owner）、B（alice=viewer、bob=owner）、C（carol 私有，alice 不可见）。 */
async function setupWorld() {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();
  // createChain 已插入 (chain, 创建者, 'owner') 成员行：alice 即 chainA 的 owner（owner ≥ editor，
  // feed 只要求成员身份）。chain_members 有 UNIQUE(chain_id, user_id)，不得再对 chainA addMember(alice)。
  const chainA = await createChain(alice.id, '链A');
  const chainB = await createChain(bob.id, '链B');
  const chainC = await createChain(carol.id, '链C');
  await addMember(chainB, alice.id, 'viewer');
  return { alice, bob, carol, chainA, chainB, chainC };
}

describe('GET /api/feed 跨链聚合与可见性', () => {
  it('只聚合「我的链」的 moments；软删不出现；按 happened_at 倒序；未登录 401', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const mA1 = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    const mA2 = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-03T00:00:00Z') });
    const mB = await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-05T00:00:00Z') });
    // 链C：alice 不是成员，绝不可见
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-07-01T00:00:00Z') });
    // 链A 软删 moment
    await insertMoment({
      chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z'), deletedAt: new Date(),
    });

    const res = await getFeed(alice.token);
    expect(res.status).toBe(200);
    expect(res.body.moments.length).toBe(3);
    expect(ids(res)).toEqual([mB, mA2, mA1]);
    expect(res.body.nextCursor).toBeNull();

    const anon = await request(app).get('/api/feed');
    expect(anon.status).toBe(401);
  });

  it('无任何链成员关系时返回空列表而非报错；但坏游标仍 400（校验先于空范围短路）', async () => {
    const loner = await registerUser();
    const res = await getFeed(loner.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moments: [], nextCursor: null });

    const badCursor = await getFeed(loner.token, `?cursor=${encodeURIComponent('!!!not-base64!!!')}`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('GET /api/feed 复合游标翻页', () => {
  it('同一 happened_at 的多个 moment 翻页不丢不重', async () => {
    const { alice, chainA } = await setupWorld();
    const same = new Date('2026-06-01T12:00:00Z');
    const expected: string[] = [];
    for (let i = 0; i < 5; i++) {
      expected.push(await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: same }));
    }
    // 用不同时间隔开，验证游标在「同时间戳边界」也正确
    const older = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-05-01T00:00:00Z') });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const q = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const res = await getFeed(alice.token, q);
      expect(res.status).toBe(200);
      collected.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    // 全集 6 条全部出现且仅出现一次，顺序全局倒序（同时间戳内按 id 倒序）
    expect(collected).toHaveLength(6);
    expect(new Set(collected).size).toBe(6);
    expect(collected.slice(0, 5).every((id) => expected.includes(id))).toBe(true);
    expect(collected[5]).toBe(older);
  });

  it('游标损坏返回 400 INVALID_CURSOR（非 base64 / 非 JSON / 字段类型错）', async () => {
    const { alice, chainA } = await setupWorld();
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date() });

    const notBase64 = await getFeed(alice.token, `?cursor=${encodeURIComponent('!!!not-base64!!!')}`);
    expect(notBase64.status).toBe(400);
    expect(notBase64.body.error.code).toBe('INVALID_CURSOR');

    const notJson = await getFeed(alice.token, `?cursor=${encodeURIComponent(Buffer.from('garbage', 'utf8').toString('base64url'))}`);
    expect(notJson.status).toBe(400);
    expect(notJson.body.error.code).toBe('INVALID_CURSOR');

    const wrongTypes = await getFeed(alice.token, `?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ h: 'x', i: 1 }), 'utf8').toString('base64url'))}`);
    expect(wrongTypes.status).toBe(400);
    expect(wrongTypes.body.error.code).toBe('INVALID_CURSOR');
  });

  it('order=created_at 与 order=happened_at 使用同一游标格式语义（c 键）', async () => {
    const { alice, chainA } = await setupWorld();
    await insertMoment({
      chainId: chainA, authorId: alice.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'), createdAt: new Date('2026-06-10T00:00:00Z'),
    });
    await insertMoment({
      chainId: chainA, authorId: alice.id,
      happenedAt: new Date('2026-07-01T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const res = await getFeed(alice.token, '?order=created_at&limit=1');
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    // created_at 更新的（6-10 创建的）在前
    expect(res.body.moments[0].happenedAt).toBe(new Date('2026-05-01T00:00:00Z').toISOString());
    expect(res.body.nextCursor).toBeTruthy();

    const page2 = await getFeed(alice.token, `?order=created_at&limit=1&cursor=${encodeURIComponent(res.body.nextCursor!)}`);
    expect(page2.status).toBe(200);
    expect(page2.body.moments[0].happenedAt).toBe(new Date('2026-07-01T00:00:00Z').toISOString());
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('GET /api/feed 补发可见性（spec §5.6）', () => {
  it('补发 moment 按 happened_at 沉底、按 created_at 置顶', async () => {
    const { alice, chainA } = await setupWorld();
    // 先发两条「当下」moment
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-20T00:00:00Z'), createdAt: new Date('2026-06-20T00:00:00Z') });
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-21T00:00:00Z'), createdAt: new Date('2026-06-21T00:00:00Z') });
    // 6-22 补发一条 6-01 的旧事（is_backfill）
    const backfill = await insertMoment({
      chainId: chainA, authorId: alice.id, isBackfill: true,
      happenedAt: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-06-22T00:00:00Z'),
    });

    const byHappened = await getFeed(alice.token, '?order=happened_at');
    expect(ids(byHappened)[0]).not.toBe(backfill); // 事件时间最旧，排最后

    const byCreated = await getFeed(alice.token, '?order=created_at');
    expect(ids(byCreated)[0]).toBe(backfill); // 添加时间最新，排最前（补发可被其他成员发现）
  });
});

describe('GET /api/feed 过滤', () => {
  it('tagId 只返回带该 tag 的 moment', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const tagRes = await request(app).post(`/api/chains/${chainA}/tags`).set(auth(alice.token)).send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;

    const tagged = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-02T00:00:00Z') });
    await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-03T00:00:00Z') });
    await attachTag(tagged, tagId);

    const res = await getFeed(alice.token, `?tag_id=${tagId}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([tagged]);

    // 非我的链（chainC，carol 私有）的 tag：静默返回空，不报错也不泄露——tag_id 维度的越权语义由本断言覆盖
    // （chainB 的 tag 不行：alice 是 chainB 的 viewer，chainB 属于 alice 的可见范围）
    const otherTag = await request(app).post(`/api/chains/${chainC}/tags`).set(auth(carol.token)).send({ name: '他链' });
    const foreign = await getFeed(alice.token, `?tag_id=${otherTag.body.id}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.moments).toEqual([]);
  });

  it('chain_ids 收窄到我的链子集；含非我的链 id 时静默过滤', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();
    const mA = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-02T00:00:00Z') });
    await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const narrowed = await getFeed(alice.token, `?chain_ids=${chainA}`);
    expect(narrowed.status).toBe(200);
    expect(ids(narrowed)).toEqual([mA]);

    // chainC 不是 alice 的链：不报错、不泄露，等价于只剩 chainA
    const withForeign = await getFeed(alice.token, `?chain_ids=${chainA},${chainC}`);
    expect(withForeign.status).toBe(200);
    expect(ids(withForeign)).toEqual([mA]);

    // chain_ids 全部不是我的链 → 空列表
    const allForeign = await getFeed(alice.token, `?chain_ids=${chainC}`);
    expect(allForeign.status).toBe(200);
    expect(allForeign.body).toEqual({ moments: [], nextCursor: null });
  });

  it('limit 非法返回 400 VALIDATION_ERROR', async () => {
    const { alice } = await setupWorld();
    const res = await getFeed(alice.token, '?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('feed 响应的 moments 含 tags 字段（走 serializeMoments）', async () => {
    const { alice, chainA } = await setupWorld();
    const tagRes = await request(app).post(`/api/chains/${chainA}/tags`).set(auth(alice.token)).send({ name: 'T' });
    const m = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-06-01T00:00:00Z') });
    await attachTag(m, tagRes.body.id);
    const res = await getFeed(alice.token);
    expect(res.body.moments[0].tags).toEqual([{ id: tagRes.body.id, name: 'T' }]);
  });
});
