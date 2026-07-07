# 链模板系统 P6：e2e 与收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用全链路 API 测试验证模板系统从建模板到分享页投影的完整闭环，回写 spec 状态，跑终验 DoD。

**Architecture:** e2e 走既有 supertest + 真实测试库先例（`apps/server/tests/` 按域分目录，与 P2/P3 的测试同布局；`src/e2e/` 是设计系统 fixture CLI，不是 HTTP 测试框架，本计划不碰）。断言依赖的端点/错误码/投影形状全部来自 P1–P3 已评审契约。

**Tech Stack:** Jest + supertest + 真实 MySQL 测试库（`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§6 测试策略、§8 breaking 清单）

## Global Constraints

- 执行 prompt T7 边界：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`。
- 测试打 `.env` 指向的 MySQL 测试库，严禁生产库；触库测试文件必须 `afterAll(closeDb)`；每个用例前 `resetDb()`（P2 已扩展：清表含 templates 且清后重 seed 三份 official 模板）。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- `apps/server/src/e2e/` 目录是设计系统截图 fixture CLI（MOMENT_E2E 守卫 + 专用 moment_e2e 库），**本计划不在该目录加任何文件**；全链路测试落 `apps/server/tests/templates/`（P2 已建该目录）。
- `docs/superpowers/specs/2026-08-20-ai-recap-design.md` **不动**（尚未实施）；只回写 chain-templates 一份的状态。**编排者裁决原文**：T7 原文「两份 spec 头部状态改为已实现」系笔误，编排者裁决：只回写 chain-templates 一份；ai-recap spec 尚未实施，标已实现是假陈述，不动。
- 每个 commit 步骤由编排主 Agent 验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

**上游契约（已评审通过，逐字不得改）：**
- 模板 CRUD：`POST /api/templates`（body `{name, icon, manifest}`，201 返回 `TemplateDto`，user key 匹配 `/^u_[0-9a-f]{21}$/`）；`PATCH /api/templates/:key`（增量编辑，version+1）；错误码 `TEMPLATE_MANIFEST_INVALID`（details 为数组）/ `TEMPLATE_NOT_FOUND` / `TEMPLATE_FORBIDDEN` / `TEMPLATE_EDIT_NOT_ADDITIVE`（P2）。
- 链：`POST /api/chains` 必传 `template`；`PATCH /api/chains/:id` 改 template → `TEMPLATE_IMMUTABLE`、改 payload 非法 → `CHAIN_PAYLOAD_INVALID`；`GET /api/chains/:id` 返回 `ChainDetailDto`（含 `templateManifest`）（P3）。
- moment：`POST /api/chains/:chainId/moments` 接受 `kind`（默认 `'standard'`）与 `payload`；非法 → `MOMENT_PAYLOAD_INVALID`；`MomentResponse` 增 `kind: string` / `payload: Record<string, unknown> | null`（P3）。
- 聚合：`GET /api/chains/:chainId/aggregate?view=&kind=&field=` → `AggregateResponse` 判别联合：`{view:'curve', points: AggregateCurvePoint[]}`（`{happenedAt, metric, value, unit}`）/ `{view:'map', points: AggregateMapPoint[]}`（`{momentId, happenedAt, lat, lng, placeName}`）/ `{view:'milestone-axis', items: AggregateMilestoneItem[]}`（`{momentId, happenedAt, label, icon, note}`）/ `{view:'moodline', days: AggregateMoodlineDay[]}`（`{date: 'YYYY-MM-DD', mood, count}`）；timeline → `INVALID_AGGREGATE_VIEW`（P3）。
- 分享：`POST /api/chains/:chainId/share-links`（body `{}`）→ `{token}`；`GET /api/public/share/:token` 匿名 200 返回 `{chain, template, templateManifest, aggregates, moments, nextCursor}`（P3）。
- 测试夹具：`tests/helpers/chains.ts` 的 `createChain(app, owner, name?, template = 'daily')` 走真实 API 建链（P3 已加 template 参数）；`tests/helpers/auth.ts` 的 `createUser(app, name)` / `auth(user)`。

---

### Task 1: user 模板全链路 e2e（建模板 → 建链 → 结构化 moment → 聚合 → 三个负例）

**Files:**
- Test: `apps/server/tests/templates/template-flow.test.ts`（新建）

**Interfaces:**
- Consumes: Global Constraints 列出的全部契约；`resetDb` 重 seed 的 official 模板（P2）。
- Produces: 无新符号（纯测试）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/template-flow.test.ts`：
```ts
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
```

- [ ] **Step 2: 运行确认失败（条件步骤）**

Run: `pnpm --filter @moment/server test -- tests/templates/template-flow.test.ts`
Expected: 若前序（P1–P3）未合入则确认 FAIL；若已合入则记录 PASS 输出并视为 Step 3 的证据（本计划是收尾验证，红灯演示依赖前序未合入状态）。

- [ ] **Step 3: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/templates/template-flow.test.ts`
Expected: PASS，5 个用例全过（全链路 1 + payload 负例 1 + describe 二 3）。

- [ ] **Step 4: Commit（由编排主 Agent 验收后执行；实现 SubAgent 跳过并报告待提交文件清单）**

```bash
git add apps/server/tests/templates/template-flow.test.ts
git commit -m "test(server): add user template end-to-end flow"
```

---

### Task 2: official 三模板 + 分享页 + breaking 负例 e2e

**Files:**
- Test: `apps/server/tests/templates/template-official-flow.test.ts`（新建）

**Interfaces:**
- Consumes: Global Constraints 全部契约；official 三模板（`resetDb` 后由 seed 保证存在）；`addMember`（`tests/helpers/chains.ts`）。
- Produces: 无新符号。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/templates/template-official-flow.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

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
    expect(axis.body.items[0]).toMatchObject({ label: '第一次微笑', icon: '😊' });

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
```

- [ ] **Step 2: 运行确认失败（条件步骤）**

Run: `pnpm --filter @moment/server test -- tests/templates/template-official-flow.test.ts`
Expected: 同 Task 1 Step 2 的口径——前序未合入确认 FAIL，已合入则记录 PASS 并视为 Step 3 证据。

- [ ] **Step 3: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/templates/template-official-flow.test.ts`
Expected: PASS，9 个用例全过（baby 2 + travel 1 + daily 1 + 分享 1 + archived 存量链 1 + breaking 3）。

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 全绿（既有 + P2/P3 新增 + 本计划 14 个 e2e 用例；不写死总数，报告实际 pass/fail 数）。

- [ ] **Step 5: Commit（由编排主 Agent 验收后执行；实现 SubAgent 跳过并报告待提交文件清单）**

```bash
git add apps/server/tests/templates/template-official-flow.test.ts
git commit -m "test(server): add official templates and share-page e2e"
```

---

### Task 3: spec 状态回写 + breaking 核对表 + 终验 DoD

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-chain-templates-design.md:4`（状态行）

**Interfaces:**
- Consumes: spec §8 breaking 清单（四项）。
- Produces: 无（文档 + 验证）。

- [ ] **Step 1: 回写 spec 状态**

Modify `docs/superpowers/specs/2026-08-20-chain-templates-design.md` 第 4 行：
```
> 状态：已实现（P1–P6 合入，<合入当日日期>——由实现者填实际日期）
```
（`2026-08-20-ai-recap-design.md` 不动——尚未实施。）

- [ ] **Step 2: breaking 清单逐项核对（spec §8 → 落地点）**

逐项打开确认并记录结果：

| spec §8 项 | 落地点 | 验证方式 |
|---|---|---|
| 1. `POST /chains` 必传 `template` | P3 Task 1（dto schema）+ Task 3（service） | Task 2 的「缺 template → 400」用例 |
| 2. `Chain`/`Moment` 响应 DTO 增字段 | P3 Task 1（dto）+ Task 3（`toChainDto`）+ Task 4（serializer） | Task 1 全链路用例断言 `kind`/`payload` 回显 |
| 3. `PATCH /chains` 改 template → `TEMPLATE_IMMUTABLE` | P3 Task 4（controller 原始 body 检测） | Task 2 的 breaking 用例 |
| 4. 迁移与代码同批部署 | P3 Task 3（三阶段迁移 + Global Constraints 声明） | 人工核对 P3 迁移文件存在且 Global Constraints 含部署顺序声明；**完工报告必须写明迁移文件路径 + Global Constraints 声明行号** |

- [ ] **Step 3: 全仓 build**

Run: `pnpm build`
Expected: exit 0（P4/P5 已修中间态，全仓必须编译通过；若红即为 P4/P5 遗漏，停手报告）。

- [ ] **Step 4: server 全量测试**

Run: `pnpm --filter @moment/server test`
Expected: 全绿，记录 pass 总数（含本计划新增 14 个 e2e 用例）。

- [ ] **Step 5: lint**

Run: `pnpm lint`
Expected: exit 0。

- [ ] **Step 6: Commit（由编排主 Agent 验收后执行；实现 SubAgent 跳过并报告待提交文件清单）**

```bash
git add docs/superpowers/specs/2026-08-20-chain-templates-design.md
git commit -m "docs: mark chain template system spec as implemented"
```

---

## DoD（终验清单）

- [ ] `pnpm build` 全仓 exit 0
- [ ] `pnpm --filter @moment/server test` 全绿（报告实际 pass/fail 数）
- [ ] `pnpm lint` exit 0
- [ ] 14 个 e2e 用例覆盖：user 模板全链路 + 三负例（非增量/非法 manifest/非 owner）+ official 三模板投影 + 软删剔除 + viewer 权限 + archived 模板存量链照常 + 分享页模板数据 + 三项 breaking 负例
- [ ] spec §8 四项 breaking 全部有落地点核对记录
- [ ] `2026-08-20-chain-templates-design.md` 状态 = 已实现；`2026-08-20-ai-recap-design.md` 未动
- [ ] 每个 commit 由编排主 Agent 执行，conventional commits
