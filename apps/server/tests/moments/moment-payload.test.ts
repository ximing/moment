import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

const base = () => ({
  type: 'text' as const,
  content: '记录',
  happenedAt: new Date().toISOString(),
  happenedTzOffset: -480,
});

describe('moments kind/payload（spec §3.2）', () => {
  it('baby 链发 milestone → 201，响应带 kind/payload（serializer 唯一出口）', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { catalog_key: 'first-smile', note: '今天笑了' } });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('milestone');
    expect(res.body.payload).toEqual({ catalog_key: 'first-smile', note: '今天笑了' });
  });

  it('模板未声明的 kind → 400 MOMENT_PAYLOAD_INVALID', async () => {
    const chain = await createChain(app, owner, '日常');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { custom_label: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('daily 链 standard + mood：options 内 201；options 外 400', async () => {
    const chain = await createChain(app, owner, '日常');
    const ok = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '😄' } });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('standard');
    expect(ok.body.payload).toEqual({ mood: '😄' });

    const bad = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '🤯' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('travel 链 geo 通过；baby 链（无 momentFields）带 mood → 400', async () => {
    const travel = await createChain(app, owner, '旅行', 'travel');
    const ok = await request(app)
      .post(`/api/chains/${travel.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } } });
    expect(ok.status).toBe(201);

    const baby = await createChain(app, owner, '宝宝', 'baby');
    const bad = await request(app)
      .post(`/api/chains/${baby.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), payload: { mood: '😄' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });

  it('PATCH 合并校验：改 payload 非法 → 400；合法 → 200；改 kind 后按新 kind 校验', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    const create = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send({ ...base(), kind: 'milestone', payload: { catalog_key: 'first-smile' } });
    const momentId = create.body.id as string;

    const bad = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { note: '丢了标识' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');

    const ok = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { catalog_key: 'first-roll', note: '会翻身了' } });
    expect(ok.status).toBe(200);
    expect(ok.body.payload).toEqual({ catalog_key: 'first-roll', note: '会翻身了' });
  });

  it('既有行为不变：不带 kind/payload 的文本 moment → 201，kind=standard、payload=null', async () => {
    const chain = await createChain(app, owner, '日常');
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(owner))
      .send(base());
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('standard');
    expect(res.body.payload).toBeNull();
  });
});
