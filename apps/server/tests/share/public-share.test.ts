import request from 'supertest';
import { db } from '../../src/db/index.js';
import { shareLinks } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

let owner: { id: string; token: string };
let chainId: string;
let shareToken: string;

beforeEach(async () => {
  await resetDb();
  owner = await registerUser();
  chainId = await createChain(owner.id, '宝宝成长');
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({});
  shareToken = res.body.token;
});
afterAll(closeDb);

describe('GET /api/public/share/:token（匿名）', () => {
  it('有效 token：200，返回链信息 + moments，无需登录', async () => {
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z'), content: '第一次翻身' });
    const res = await request(app).get(`/api/public/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.chain).toEqual({ name: '宝宝成长', description: null });
    expect(res.body.moments).toHaveLength(1);
    expect(res.body.moments[0].content).toBe('第一次翻身');
    // 只读计数存在，匿名视角 myReaction 恒 null（Global Constraints 决策）
    expect(res.body.moments[0].commentCount).toBe(0);
    expect(res.body.moments[0].myReaction).toBeNull();
    expect(res.body.nextCursor).toBeNull();
  });

  it('游标翻页：25 条分两页取完，不丢不重；软删 moment 不出现', async () => {
    const base = Date.UTC(2026, 7, 1);
    for (let i = 0; i < 25; i++) {
      await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(base + i * 60_000), content: `m-${i}` });
    }
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(base - 60_000),
      content: 'deleted',
      deletedAt: new Date(),
    });

    const page1 = await request(app).get(`/api/public/share/${shareToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.moments).toHaveLength(20);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app).get(
      `/api/public/share/${shareToken}?cursor=${encodeURIComponent(page1.body.nextCursor)}`
    );
    expect(page2.status).toBe(200);
    expect(page2.body.moments).toHaveLength(5);
    expect(page2.body.nextCursor).toBeNull();

    const ids = new Set([...page1.body.moments, ...page2.body.moments].map((m: { id: string }) => m.id));
    expect(ids.size).toBe(25);
    expect([...page1.body.moments, ...page2.body.moments].some((m: { content: string }) => m.content === 'deleted')).toBe(false);
  });

  it('跨链隔离：别的链的 moment 不出现', async () => {
    const other = await registerUser();
    const otherChain = await createChain(other.id, '别的链');
    await insertMoment({ chainId: otherChain, authorId: other.id, happenedAt: new Date(), content: 'secret' });
    const res = await request(app).get(`/api/public/share/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(0);
  });

  it('未知 token / 吊销 / 过期 → 一律 404 SHARE_NOT_FOUND（不区分原因）', async () => {
    const unknown = await request(app).get(`/api/public/share/${'0'.repeat(64)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SHARE_NOT_FOUND');

    // 吊销
    const revoked = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${revoked.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    const afterRevoke = await request(app).get(`/api/public/share/${revoked.body.token}`);
    expect(afterRevoke.status).toBe(404);
    expect(afterRevoke.body.error.code).toBe('SHARE_NOT_FOUND');

    // 过期（直插一个 expiresAt 在过去的链接，绕过创建时的未来时间惯例）
    const expired = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await db
      .update(shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareLinks.id, expired.body.id));
    const afterExpire = await request(app).get(`/api/public/share/${expired.body.token}`);
    expect(afterExpire.status).toBe(404);
    expect(afterExpire.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('limit 超界 → 400 VALIDATION_ERROR；非法 cursor → 400 INVALID_CURSOR', async () => {
    const badLimit = await request(app).get(`/api/public/share/${shareToken}?limit=51`);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe('VALIDATION_ERROR');

    const badCursor = await request(app).get(`/api/public/share/${shareToken}?cursor=!!!junk`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.code).toBe('INVALID_CURSOR');
  });
});
