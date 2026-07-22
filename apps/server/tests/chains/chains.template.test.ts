import type { ChainDto } from '@moment/dto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('POST /api/chains + template（spec §3.2）', () => {
  it('缺 template → 400 VALIDATION_ERROR（dto 必填）', async () => {
    const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('未知 template / 已归档 template → 404 TEMPLATE_NOT_FOUND', async () => {
    const unknown = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: 'x', template: 'nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('TEMPLATE_NOT_FOUND');

    // archived 模板不可选用（spec §3.4）：先建再归档
    const created = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(owner))
      .send({ name: '临时', icon: 'T', manifest: { version: 1 } });
    const key = created.body.key as string;
    await request(app).delete(`/api/templates/${key}`).set('Authorization', auth(owner));
    const archived = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: 'x', template: key });
    expect(archived.status).toBe(404);
    expect(archived.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('baby 链带合法 payload → 201，响应含 template/payload', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby', payload: { birthdate: '2025-01-01', gender: 'girl' } });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.template).toBe('baby');
    expect(chain.payload).toEqual({ birthdate: '2025-01-01', gender: 'girl' });
  });

  it('baby 链非法 payload → 400 CHAIN_PAYLOAD_INVALID；daily 链带 payload → 400', async () => {
    const bad = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby', payload: { birthdate: '2025/01/01' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');

    const noSchema = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '日常', template: 'daily', payload: { mood: '😄' } });
    expect(noSchema.status).toBe(400);
    expect(noSchema.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');
  });
});

describe('PATCH /api/chains/:id（spec §3.2、§8.3）', () => {
  it('body 带 template 键 → 400 TEMPLATE_IMMUTABLE（即使值相同）', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '日常', template: 'daily' });
    const chainId = create.body.id as string;
    const res = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ template: 'baby' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_IMMUTABLE');
  });

  it('改 payload：合法 200 生效；非法 400 CHAIN_PAYLOAD_INVALID；显式 null 清空', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby' });
    const chainId = create.body.id as string;

    const ok = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { birthdate: '2025-06-01' } });
    expect(ok.status).toBe(200);
    expect(ok.body.payload).toEqual({ birthdate: '2025-06-01' });

    const bad = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: { birthdate: '06/01' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');

    const cleared = await request(app)
      .patch(`/api/chains/${chainId}`)
      .set('Authorization', auth(owner))
      .send({ payload: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.payload).toBeNull();
  });
});

describe('GET /api/chains/:id 内嵌 templateManifest（spec §3.2）', () => {
  it('详情含 templateManifest（baby 有 kinds 与 milestoneCatalog）；列表不含', async () => {
    const create = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝', template: 'baby' });
    const chainId = create.body.id as string;

    const detail = await request(app).get(`/api/chains/${chainId}`).set('Authorization', auth(owner));
    expect(detail.status).toBe(200);
    expect(detail.body.template).toBe('baby');
    expect(detail.body.templateManifest.kinds.map((k: { key: string }) => k.key)).toEqual(['milestone', 'metric']);
    expect(detail.body.templateManifest.milestoneCatalog.length).toBeGreaterThanOrEqual(5);

    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    const item = (list.body as { id: string; template: string }[]).find((c) => c.id === chainId)!;
    expect(item.template).toBe('baby');
    expect('templateManifest' in item).toBe(false);
  });
});
