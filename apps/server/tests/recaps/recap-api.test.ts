import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment, insertRecap } from '../helpers/fixtures.js';

const app = createApp();

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  viewer = await createUser(app, 'viewer@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

async function createChainWithOwner(name = '宝宝成长', template = 'baby') {
  const { createChain } = await import('../helpers/chains.js');
  return createChain(app, owner, name, template);
}

describe('GET /api/chains/:chainId/recaps（spec §6）', () => {
  it('viewer 可读 200，period 倒序', async () => {
    const chain = await createChainWithOwner();
    await insertRecap({ chainId: chain.id, period: '2026-06', status: 'ready', content: '6月' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月' });
    await addMember(chain.id, viewer.id, 'viewer');

    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toHaveLength(2);
    expect(res.body.recaps[0].period).toBe('2026-07'); // 倒序
    expect(res.body.recaps[1].period).toBe('2026-06');
  });

  it('非成员 404 CHAIN_NOT_FOUND', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(outsider));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('空列表 200', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toEqual([]);
  });
});

describe('GET /api/chains/:chainId/recaps/:period（spec §6）', () => {
  it('合法 period → 200 RecapDto', async () => {
    const chain = await createChainWithOwner();
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-07`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-07');
    expect(res.body.content).toBe('7月回顾');
    expect(res.body.status).toBe('ready');
  });

  it('非法 period → 400 INVALID_PERIOD', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-13`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PERIOD');
  });

  it('不存在的 period → 404 RECAP_NOT_FOUND', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-07`).set('Authorization', auth(owner));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECAP_NOT_FOUND');
  });
});

describe('POST /api/chains/:chainId/recaps/:period/regenerate（spec §6）', () => {
  it('editor 写 outbox recap.generate → 202', async () => {
    const chain = await createChainWithOwner();
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(202);

    const { outbox } = await import('../../src/db/schema.js');
    const { db } = await import('../../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId: chain.id, period: '2026-07' });
  });

  it('period 无记录 → 400 RECAP_PERIOD_INACTIVE', async () => {
    const chain = await createChainWithOwner();
    // 2026-07 无记录
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECAP_PERIOD_INACTIVE');
  });

  it('每日每链限 3 次 → 第 4 次 400 RECAP_REGENERATE_LIMIT', async () => {
    const chain = await createChainWithOwner();
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
      expect(res.status).toBe(202);
    }
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECAP_REGENERATE_LIMIT');
  });

  it('viewer 不可重生成 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const chain = await createChainWithOwner();
    await addMember(chain.id, viewer.id, 'viewer');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(viewer));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非法 period → 400 INVALID_PERIOD', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/invalid/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PERIOD');
  });
});
