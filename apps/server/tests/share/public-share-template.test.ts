import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';

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

describe('GET /api/public/share/:token 模板数据（spec §3.2）', () => {
  it('baby 链：响应含 template/templateManifest/aggregates（milestone-axis + curve，无 timeline）', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date(), kind: 'milestone', payload: { catalog_key: 'first-steps' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date(), kind: 'metric', payload: { metric: 'height', value: 70, unit: 'cm' }, deletedAt: new Date() }); // 软删不进投影
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toBe('baby');
    expect(res.body.templateManifest.kinds).toHaveLength(2);
    const views = (res.body.aggregates as { view: string }[]).map((a) => a.view).sort();
    expect(views).toEqual(['curve', 'milestone-axis']);
    const axis = res.body.aggregates.find((a: { view: string }) => a.view === 'milestone-axis');
    expect(axis.items).toHaveLength(1);
    expect(axis.items[0].label).toBe('第一次走路');
    const curve = res.body.aggregates.find((a: { view: string }) => a.view === 'curve');
    expect(curve.points).toHaveLength(0); // 唯一 metric 已软删
  });

  it('daily 链：aggregates 仅 moodline；manifest 随模板给出', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toBe('daily');
    expect((res.body.aggregates as { view: string }[]).map((a) => a.view)).toEqual(['moodline']);
    expect(res.body.aggregates[0].days).toHaveLength(1);
  });
});
