import type { TemplateDto } from '@moment/dto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});
afterAll(closeDb);

const minimalManifest = { version: 1 };

async function createTemplate(user: TestUser, manifest: object = minimalManifest): Promise<TemplateDto> {
  const res = await request(app)
    .post('/api/templates')
    .set('Authorization', auth(user))
    .send({ name: '喂奶记录', icon: '🍼', manifest });
  expect(res.status).toBe(201);
  return res.body as TemplateDto;
}

describe('POST /api/templates', () => {
  it('201：server 分配 u_ 前缀 key，version=1，scope=user', async () => {
    const t = await createTemplate(alice);
    expect(t.key).toMatch(/^u_[0-9a-f]{21}$/);
    expect(t.scope).toBe('user');
    expect(t.ownerId).toBe(alice.id);
    expect(t.version).toBe(1);
    expect(t.status).toBe('active');
    expect(t.manifest).toEqual(minimalManifest);
  });

  it('非法 manifest → 400 TEMPLATE_MANIFEST_INVALID（details 带 ajv 路径）；未登录 401', async () => {
    const bad = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: 'x', icon: 'x', manifest: { version: 1, hacker: true } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TEMPLATE_MANIFEST_INVALID');
    expect(Array.isArray(bad.body.error.details)).toBe(true);

    expect((await request(app).post('/api/templates').send({ name: 'x', icon: 'x', manifest: minimalManifest })).status).toBe(401);
  });
});

describe('GET /api/templates', () => {
  it('默认返回 official 全部 + 我的 user 模板（不含他人的、不含已归档）', async () => {
    const mine = await createTemplate(alice);
    await createTemplate(bob);
    const res = await request(app).get('/api/templates').set('Authorization', auth(alice));
    expect(res.status).toBe(200);
    const list = res.body as TemplateDto[];
    expect(list.filter((t) => t.scope === 'official')).toHaveLength(3);
    const userOnes = list.filter((t) => t.scope === 'user');
    expect(userOnes).toHaveLength(1);
    expect(userOnes[0].key).toBe(mine.key);
  });

  it('?scope=official 只返回三份官方模板；?scope=user 只返回我的', async () => {
    await createTemplate(alice);
    const official = await request(app)
      .get('/api/templates')
      .query({ scope: 'official' })
      .set('Authorization', auth(alice));
    expect((official.body as TemplateDto[]).map((t) => t.key).sort()).toEqual(['baby', 'daily', 'travel']);
    const mine = await request(app).get('/api/templates').query({ scope: 'user' }).set('Authorization', auth(alice));
    expect((mine.body as TemplateDto[]).every((t) => t.ownerId === alice.id)).toBe(true);
  });
});

describe('GET /api/templates/:key', () => {
  it('official 模板可读（baby 含里程碑目录）；未知 key 404 TEMPLATE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/templates/baby').set('Authorization', auth(alice));
    expect(res.status).toBe(200);
    expect((res.body as TemplateDto).manifest.milestoneCatalog?.length).toBeGreaterThanOrEqual(5);

    const missing = await request(app).get('/api/templates/nope').set('Authorization', auth(alice));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('PATCH /api/templates/:key', () => {
  it('改 name 不 bump version；增量改 manifest version+1 且 manifest.version 同步', async () => {
    const t = await createTemplate(alice);
    const renamed = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ name: '改名了' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.version).toBe(1);

    const grown = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ manifest: { version: 99, momentFields: [{ key: 'note', type: 'text', label: '备注' }] } });
    expect(grown.status).toBe(200);
    expect(grown.body.version).toBe(2);
    // manifest.version 由 server 归一为行版本（客户端填的 99 被覆盖）
    expect(grown.body.manifest.version).toBe(2);
  });

  it('非增量编辑 → 400 TEMPLATE_EDIT_NOT_ADDITIVE', async () => {
    const t = await createTemplate(alice, {
      version: 1,
      momentFields: [{ key: 'mood', type: 'emoji-picker', label: '心情', options: ['😄', '😭'] }],
    });
    const res = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ manifest: { version: 1, momentFields: [{ key: 'mood', type: 'emoji-picker', label: '心情', options: ['😄'] }] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_EDIT_NOT_ADDITIVE');
  });

  it('非 owner 改 / 改 official → 403 TEMPLATE_FORBIDDEN', async () => {
    const t = await createTemplate(alice);
    const byOther = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(bob))
      .send({ name: 'hack' });
    expect(byOther.status).toBe(403);
    expect(byOther.body.error.code).toBe('TEMPLATE_FORBIDDEN');

    const official = await request(app)
      .patch('/api/templates/baby')
      .set('Authorization', auth(alice))
      .send({ name: 'hack' });
    expect(official.status).toBe(403);
    expect(official.body.error.code).toBe('TEMPLATE_FORBIDDEN');
  });
});

describe('DELETE /api/templates/:key', () => {
  it('archive 后列表不可见、详情可读（存量链不受影响，spec §3.4）；非 owner 403', async () => {
    const t = await createTemplate(alice);
    const forbidden = await request(app).delete(`/api/templates/${t.key}`).set('Authorization', auth(bob));
    expect(forbidden.status).toBe(403);

    const res = await request(app).delete(`/api/templates/${t.key}`).set('Authorization', auth(alice));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/templates').set('Authorization', auth(alice));
    expect((list.body as TemplateDto[]).find((x) => x.key === t.key)).toBeUndefined();

    const detail = await request(app).get(`/api/templates/${t.key}`).set('Authorization', auth(alice));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('archived');

    // 行为声明（编排者裁决 S3）：archived 模板仍可 PATCH（archive 只阻止新建链选用，不冻结定义）
    const patchArchived = await request(app)
      .patch(`/api/templates/${t.key}`)
      .set('Authorization', auth(alice))
      .send({ name: '归档后改名' });
    expect(patchArchived.status).toBe(200);
    expect(patchArchived.body.status).toBe('archived');
  });
});
