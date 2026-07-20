import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain } from '../helpers/chains.js';
import { insertMoment, insertRecap } from '../helpers/fixtures.js';
import { db } from '../../src/db/index.js';
import { chains } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

async function shareToken(chainId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', auth(owner))
    .send({});
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('GET /api/public/share/:token 附 recap（spec §6 + S2）', () => {
  it('share_recaps_enabled=true + 有 ready recap → 响应含 recap', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeTruthy();
    expect(res.body.recap.period).toBe('2026-07');
    expect(res.body.recap.status).toBe('ready');
    expect(res.body.recap.content).toBe('7月回顾');
  });

  it('含 degraded recap（S2 注：降级回顾同样外发）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'degraded', content: '降级回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeTruthy();
    expect(res.body.recap.status).toBe('degraded');
  });

  it('generating/failed 不外发（recap 为 undefined）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'failed', content: '', error: 'err' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });

  it('取最近一期（period 倒序第一条）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), content: '6月' });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '7月' });
    await insertRecap({ chainId: chain.id, period: '2026-06', status: 'ready', content: '6月回顾' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.body.recap.period).toBe('2026-07'); // 最近一期
  });

  it('share_recaps_enabled=false → 不外发 recap', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    // 关闭开关
    await db.update(chains).set({ shareRecapsEnabled: false }).where(eq(chains.id, chain.id));
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });

  it('无 recap → recap undefined', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });
});
