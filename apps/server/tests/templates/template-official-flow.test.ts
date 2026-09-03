import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let alice: TestUser;
let carol: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createUser(app, 'alice');
  carol = await createUser(app, 'carol');
});

afterAll(closeDb);

const base = {
  type: 'text' as const,
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('baby 链：milestone + metric → milestone-axis / curve 投影', () => {
  it('全链路投影正确；软删 moment 从投影剔除；viewer 可读聚合', async () => {
    const chain = await createChain(app, alice, '宝宝成长', 'baby');
    await addMember(chain.id, carol.id, 'viewer');

    const milestone = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: '第一次微笑',
      kind: 'milestone',
      payload: { catalog_key: 'first-smile' },
    });
    expect(milestone.status).toBe(201);
    expect(milestone.body.kind).toBe('milestone');

    const metric = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: '量身高',
      kind: 'metric',
      payload: { metric: 'height', value: 62, unit: 'cm' },
    });
    expect(metric.status).toBe(201);

    // milestone-axis：catalog_key 解析为目录 label + icon
    const axis = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis', kind: 'milestone' })
      .set('Authorization', auth(alice));
    expect(axis.status).toBe(200);
    expect(axis.body.items).toHaveLength(1);
    expect(axis.body.items[0]).toMatchObject({ label: '第一次微笑', icon: 'milestone-first-smile' });

    // curve：携带 metric 字段供前端拆双线（P3 决策 2）
    const curve = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'curve', kind: 'metric' })
      .set('Authorization', auth(carol)); // viewer 可读
    expect(curve.status).toBe(200);
    expect(curve.body.points).toEqual([
      { happenedAt: '2026-08-15T02:00:00.000Z', metric: 'height', value: 62, unit: 'cm' },
    ]);

    // 软删后从投影剔除
    await request(app)
      .delete(`/api/moments/${milestone.body.id}`)
      .set('Authorization', auth(alice));
    const axisAfter = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis', kind: 'milestone' })
      .set('Authorization', auth(alice));
    expect(axisAfter.body.items).toHaveLength(0);
  });

  it('非法 metric payload → 400 MOMENT_PAYLOAD_INVALID；链 payload 非法 → CHAIN_PAYLOAD_INVALID', async () => {
    const chain = await createChain(app, alice, '宝宝成长', 'baby');

    const badMoment = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: 'x',
      kind: 'metric',
      payload: { metric: 'height', value: -1, unit: 'cm' },
    });
    expect(badMoment.status).toBe(400);
    expect(badMoment.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');

    const badChain = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(alice))
      .send({ payload: { gender: 'alien' } });
    expect(badChain.status).toBe(400);
    expect(badChain.body.error.code).toBe('CHAIN_PAYLOAD_INVALID');
  });
});

describe('travel 链：geo 字段 → map 投影', () => {
  it('standard moment 挂 geo → map 投影；payload 含未声明 key → 400', async () => {
    const chain = await createChain(app, alice, '关西行', 'travel');

    const ok = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: '到京都了',
      payload: { geo: { lat: 35.0116, lng: 135.7681, place_name: '京都' } },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.payload).toEqual({ geo: { lat: 35.0116, lng: 135.7681, place_name: '京都' } });

    const map = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'map', field: 'geo' })
      .set('Authorization', auth(alice));
    expect(map.status).toBe(200);
    expect(map.body.points).toHaveLength(1);
    expect(map.body.points[0]).toMatchObject({ lat: 35.0116, lng: 135.7681, placeName: '京都' });

    const bad = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: 'x',
      payload: { mood: '😄' }, // travel 未声明 mood 字段
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MOMENT_PAYLOAD_INVALID');
  });
});

describe('daily 链：mood 字段 → moodline 投影（按 wall_date 分组）', () => {
  it('两条同日心情聚合成 count=2，date 为墙钟日', async () => {
    const chain = await createChain(app, alice, '日常', 'daily');

    await postMoment(alice.accessToken, chain.id, { ...base, content: '开心', payload: { mood: '😄' } });
    await postMoment(alice.accessToken, chain.id, { ...base, content: '也开心', payload: { mood: '😄' } });

    const moodline = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'moodline', field: 'mood' })
      .set('Authorization', auth(alice));
    expect(moodline.status).toBe(200);
    expect(moodline.body.days).toEqual([{ date: '2026-08-15', mood: '😄', count: 2 }]);
  });
});

describe('分享页：匿名可见模板与聚合投影', () => {
  it('GET /api/public/share/:token 附 template + templateManifest + aggregates', async () => {
    const chain = await createChain(app, alice, '宝宝成长', 'baby');
    await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: '第一次微笑',
      kind: 'milestone',
      payload: { catalog_key: 'first-smile' },
    });

    const link = await request(app)
      .post(`/api/chains/${chain.id}/share-links`)
      .set('Authorization', auth(alice))
      .send({});
    expect(link.status).toBe(201);

    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.template).toBe('baby');
    expect(pub.body.templateManifest.kinds.map((k: { key: string }) => k.key)).toEqual(['milestone', 'metric']);
    const views = (pub.body.aggregates as { view: string }[]).map((a) => a.view).sort();
    expect(views).toEqual(['curve', 'milestone-axis']);
    const axis = (pub.body.aggregates as { view: string; items?: { label: string }[] }[]).find(
      (a) => a.view === 'milestone-axis',
    );
    expect(axis?.items?.[0]?.label).toBe('第一次微笑');
  });
});

describe('archived 模板：存量链照常运行（spec §3.4：archive 只阻止新建链选用）', () => {
  it('archive 后存量链仍可发 kind moment + 查聚合；新建链选 archived 模板 → 404 TEMPLATE_NOT_FOUND', async () => {
    // 建 user 模板 → 建链引用 → archive 该模板
    const tpl = await request(app)
      .post('/api/templates')
      .set('Authorization', auth(alice))
      .send({
        name: '第一次记录',
        icon: '🌱',
        manifest: {
          version: 1,
          kinds: [
            {
              key: 'firsts',
              label: '第一次',
              payloadSchema: {
                type: 'object',
                required: ['custom_label'],
                additionalProperties: false,
                properties: { custom_label: { type: 'string', minLength: 1, maxLength: 50 } },
              },
              publisher: { entry: 'button', label: '记一个第一次' },
            },
          ],
          views: [{ type: 'milestone-axis', label: '第一次', source: { kind: 'firsts' } }],
        },
      });
    expect(tpl.status).toBe(201);
    const chain = await createChain(app, alice, '宝宝第一次', tpl.body.key);

    const archived = await request(app)
      .delete(`/api/templates/${tpl.body.key}`)
      .set('Authorization', auth(alice));
    expect(archived.status).toBe(204);

    // 存量链：发 kind moment + 聚合照常
    const created = await postMoment(alice.accessToken, chain.id, {
      ...base,
      content: '第一次叫妈妈',
      kind: 'firsts',
      payload: { custom_label: '第一次叫妈妈' },
    });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('firsts');

    const agg = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'milestone-axis', kind: 'firsts' })
      .set('Authorization', auth(alice));
    expect(agg.status).toBe(200);
    expect(agg.body.items).toHaveLength(1);

    // 新建链选 archived 模板被拒（archived 视同不存在，P3 Global Constraints）
    const fresh = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(alice))
      .send({ name: '新链', template: tpl.body.key });
    expect(fresh.status).toBe(404);
    expect(fresh.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('breaking 变更（spec §8）', () => {
  it('POST /api/chains 缺 template → 400', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(alice))
      .send({ name: '没有模板' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/chains 改 template → 400 TEMPLATE_IMMUTABLE', async () => {
    const chain = await createChain(app, alice, '日常', 'daily');
    const res = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(alice))
      .send({ template: 'travel' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_IMMUTABLE');
  });

  it('聚合端点 view=timeline → 400 INVALID_AGGREGATE_VIEW（前端走 moments 列表分章）', async () => {
    const chain = await createChain(app, alice, '关西行', 'travel');
    const res = await request(app)
      .get(`/api/chains/${chain.id}/aggregate`)
      .query({ view: 'timeline' })
      .set('Authorization', auth(alice));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AGGREGATE_VIEW');
  });
});
