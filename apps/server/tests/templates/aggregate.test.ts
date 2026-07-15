import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';

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

describe('GET /api/chains/:chainId/aggregate（spec §3.2）', () => {
  it('curve：metric 投影按 happenedAt 升序，软删剔除', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-03-01T08:00:00Z'), kind: 'metric', payload: { metric: 'height', value: 62, unit: 'cm' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-01-01T08:00:00Z'), kind: 'metric', payload: { metric: 'height', value: 55, unit: 'cm' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-02-01T08:00:00Z'), kind: 'metric', payload: { metric: 'weight', value: 7, unit: 'kg' }, deletedAt: new Date() });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'curve', kind: 'metric' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('curve');
    expect(res.body.points).toHaveLength(2); // 软删的 weight 被剔除
    expect(res.body.points[0]).toMatchObject({ metric: 'height', value: 55, unit: 'cm' });
    expect(res.body.points[1]).toMatchObject({ metric: 'height', value: 62 });
  });

  it('map：仅含 geo 的 standard moment 入投影', async () => {
    const chain = await createChain(app, owner, '旅行', 'travel');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-05-01T08:00:00Z'), payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-05-02T08:00:00Z') }); // 无 geo

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'map', field: 'geo' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    expect(res.body.points[0]).toMatchObject({ lat: 39.9, lng: 116.4, placeName: '北京' });
  });

  it('milestone-axis：catalog_key 解析 label/icon，custom_label 回退', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-04-01T08:00:00Z'), kind: 'milestone', payload: { catalog_key: 'first-smile', note: '笑了' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-04-02T08:00:00Z'), kind: 'milestone', payload: { custom_label: '第一次叫妈妈' } });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ label: '第一次微笑', icon: '😊', note: '笑了' });
    expect(res.body.items[1]).toMatchObject({ label: '第一次叫妈妈', icon: null, note: null });
  });

  it('moodline：按 wall_date 分组计数', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T09:00:00Z'), happenedTzOffset: -480, payload: { mood: '😄' } });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-02T01:00:00Z'), happenedTzOffset: -480, payload: { mood: '😭' } });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([
      { date: '2026-06-01', mood: '😄', count: 2 },
      { date: '2026-06-02', mood: '😭', count: 1 },
    ]);
  });

  it('未声明的视图 → 400 INVALID_AGGREGATE_VIEW；timeline 不走聚合端点', async () => {
    const chain = await createChain(app, owner, '日常'); // daily 只声明 moodline
    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'curve' })
      .set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AGGREGATE_VIEW');

    const travel = await createChain(app, owner, '旅行', 'travel');
    const tl = await request(app)
      .get(`/api/chains/${travel.id}/aggregate`)
      .query({ view: 'timeline' })
      .set('Authorization', auth(owner));
    expect(tl.status).toBe(400);
    expect(tl.body.error.code).toBe('INVALID_AGGREGATE_VIEW');
  });

  it('viewer 可读 200；非成员 404 CHAIN_NOT_FOUND', async () => {
    const chain = await createChain(app, owner, '日常');
    await addMember(chain.id, viewer.id, 'viewer');
    const ok = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(viewer));
    expect(ok.status).toBe(200);

    const denied = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline' })
      .set('Authorization', auth(outsider));
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('CHAIN_NOT_FOUND');

    // 未登录 401（@Authorized 与全仓链内 controller 一致）
    const anonymous = await request(app).get(`/api/chains/${chain.id}/aggregate`).query({ view: 'moodline' });
    expect(anonymous.status).toBe(401);
  });
});
