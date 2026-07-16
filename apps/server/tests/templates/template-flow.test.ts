import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
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

/** 合法的用户模板 manifest：一个 custom_label 风格的 kind + milestone-axis 视图。 */
const firstsManifest = {
  version: 1,
  kinds: [
    {
      key: 'firsts',
      label: '第一次',
      payloadSchema: {
        type: 'object',
        required: ['custom_label'],
        additionalProperties: false,
        properties: {
          custom_label: { type: 'string', minLength: 1, maxLength: 50 },
          note: { type: 'string', maxLength: 500 },
        },
      },
      publisher: { entry: 'button', label: '记一个第一次' },
    },
  ],
  views: [{ type: 'milestone-axis', label: '第一次', source: { kind: 'firsts' } }],
};

async function createTemplate(user: TestUser, manifest: object = firstsManifest) {
  const res = await request(app)
    .post('/api/templates')
    .set('Authorization', auth(user))
    .send({ name: '第一次记录', icon: '🌱', manifest });
  if (res.status !== 201) {
    throw new Error(`createTemplate failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { key: string; version: number };
}

const momentBase = {
  type: 'text' as const,
  content: '今天第一次叫妈妈',
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('user 模板全链路：建模板 → 建链 → 发 kind moment → 聚合投影', () => {
  it('全链路 201/200，聚合投影返回结构化数据', async () => {
    // 1. 建 user 模板
    const tpl = await createTemplate(alice);
    expect(tpl.key).toMatch(/^u_[0-9a-f]{21}$/);
    expect(tpl.version).toBe(1);

    // 2. 建链引用该模板（链详情内嵌 manifest，无需二次请求）
    const chain = await createChain(app, alice, '宝宝第一次', tpl.key);
    expect(chain.template).toBe(tpl.key);

    // 3. 发 kind moment（payload 过 firsts 的 payloadSchema）
    const created = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(alice))
      .send({ ...momentBase, kind: 'firsts', payload: { custom_label: '第一次叫妈妈', note: '心都化了' } });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('firsts');
    expect(created.body.payload).toEqual({ custom_label: '第一次叫妈妈', note: '心都化了' });

    // 4. 聚合端点：milestone-axis 投影（custom_label 原文即 label，无目录故 icon 为 null）
    const agg = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis', kind: 'firsts' })
      .set('Authorization', auth(alice));
    expect(agg.status).toBe(200);
    expect(agg.body.view).toBe('milestone-axis');
    expect(agg.body.items).toHaveLength(1);
    expect(agg.body.items[0]).toMatchObject({
      momentId: created.body.id,
      label: '第一次叫妈妈',
      icon: null,
      note: '心都化了',
    });
  });

  it('payload 不过 kind 的 payloadSchema → 400 MOMENT_PAYLOAD_INVALID', async () => {
    const tpl = await createTemplate(alice);
    const chain = await createChain(app, alice, '宝宝第一次', tpl.key);
    const res = await request(app)
      .post(`/api/chains/${chain.id}/moments`)
      .set('Authorization', auth(alice))
      .send({ ...momentBase, kind: 'firsts', payload: { note: '缺 custom_label' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });
});

describe('模板编辑与权限负例', () => {
  it('非增量编辑（删 kind）→ 400 TEMPLATE_EDIT_NOT_ADDITIVE；增量新增 kind → version+1', async () => {
    const tpl = await createTemplate(alice);

    const shrink = await request(app)
      .patch(`/api/templates/${tpl.key}`)
      .set('Authorization', auth(alice))
      .send({ manifest: { version: 1 } });
    expect(shrink.status).toBe(400);
    expect(shrink.body.error.code).toBe('TEMPLATE_EDIT_NOT_ADDITIVE');

    const grown = await request(app)
      .patch(`/api/templates/${tpl.key}`)
      .set('Authorization', auth(alice))
      .send({
        manifest: {
          ...firstsManifest,
          kinds: [
            ...firstsManifest.kinds,
            {
              key: 'sleeptime',
              label: '睡眠',
              payloadSchema: {
                type: 'object',
                required: ['hours'],
                additionalProperties: false,
                properties: { hours: { type: 'number', exclusiveMinimum: 0 } },
              },
              publisher: { entry: 'button', label: '记睡眠' },
            },
          ],
        },
      });
    expect(grown.status).toBe(200);
    expect(grown.body.version).toBe(2);
  });

  it('非法 manifest → 400 TEMPLATE_MANIFEST_INVALID 且 details 为数组', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({ name: 'x', icon: 'x', manifest: { version: 1, hacker: true } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_MANIFEST_INVALID');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('非 owner 改/删他人模板 → 403 TEMPLATE_FORBIDDEN', async () => {
    const tpl = await createTemplate(alice);
    const patched = await request(app)
      .patch(`/api/templates/${tpl.key}`)
      .set('Authorization', auth(bob))
      .send({ name: '抢改名' });
    expect(patched.status).toBe(403);
    expect(patched.body.error.code).toBe('TEMPLATE_FORBIDDEN');

    const deleted = await request(app)
      .delete(`/api/templates/${tpl.key}`)
      .set('Authorization', auth(bob));
    expect(deleted.status).toBe(403);
    expect(deleted.body.error.code).toBe('TEMPLATE_FORBIDDEN');
  });
});
