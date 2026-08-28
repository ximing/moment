import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, persons } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachPerson, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 标准三人场景：owner + viewer 在链内，outsider 在链外（镜像 tags.test.ts）。 */
async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  return { owner, viewer, outsider, chainId };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/chains/:chainId/persons', () => {
  it('viewer 可读，按 name 升序，字段恰为 {id, name, userId}（spec §6 词典响应无 source/momentCount）', async () => {
    const { owner, viewer, chainId } = await setup();
    const waipo = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const baba = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '爸爸', userId: owner.id });
    expect(waipo.status).toBe(201);
    expect(baba.status).toBe(201);

    const res = await request(app).get(`/api/chains/${chainId}/persons`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    // utf8mb4 下 '外'(U+5916) < '爸'(U+7238)，name 升序实际为 外婆 → 爸爸
    expect(res.body.persons.map((p: { name: string }) => p.name)).toEqual(['外婆', '爸爸']);
    expect(res.body.persons[0]).toEqual({ id: waipo.body.id, name: '外婆', userId: null });
    expect(res.body.persons[1]).toEqual({ id: baba.body.id, name: '爸爸', userId: owner.id });
  });

  it('非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const { outsider, chainId } = await setup();
    const forbidden = await request(app).get(`/api/chains/${chainId}/persons`).set(auth(outsider.token));
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/persons`);
    expect(anon.status).toBe(401);
  });
});

describe('POST /api/chains/:chainId/persons', () => {
  it('editor 创建 201；owner 亦可', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');

    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(editor.token))
      .send({ name: '朵朵' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), name: '朵朵', userId: null });

    const byOwner = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '爷爷' });
    expect(byOwner.status).toBe(201);
  });

  it('幂等创建（spec §6）：trim + 内部连续空白归一化撞名 → 返回已存在行 200，词典仍只有一行', async () => {
    const { owner, chainId } = await setup();
    const first = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '王 叔叔' });
    expect(first.status).toBe(201);

    const again = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '  王   叔叔 ' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const rows = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(rows).toHaveLength(1);
  });

  it('跨链同名不冲突：各自 201（uk 是 (chain_id, name)）', async () => {
    const { owner } = await setup();
    const c1 = await createChain(owner.id, '链一');
    const c2 = await createChain(owner.id, '链二');
    const r1 = await request(app).post(`/api/chains/${c1}/persons`).set(auth(owner.token)).send({ name: '朵朵' });
    const r2 = await request(app).post(`/api/chains/${c2}/persons`).set(auth(owner.token)).send({ name: '朵朵' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.id).not.toBe(r2.body.id);
  });

  it('viewer 403；非成员 404；空名 400 VALIDATION_ERROR（用 owner——角色中间件先于 zod parse）', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const asViewer = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(viewer.token))
      .send({ name: 'x' });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const notMember = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(outsider.token))
      .send({ name: 'x' });
    expect(notMember.status).toBe(404);

    const badBody = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '' });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('userId 非本链成员 → 400 PERSON_USER_NOT_IN_CHAIN', async () => {
    const { owner, chainId } = await setup();
    const outsider = await registerUser();
    const res = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '路人', userId: outsider.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_USER_NOT_IN_CHAIN');
  });
});

describe('PATCH /api/chains/:chainId/persons/:personId', () => {
  it('editor 改名 200；归一化后同名（含 trim）幂等返回', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(editor.token))
      .send({ name: '姥姥' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: created.body.id, name: '姥姥', userId: null });

    const noop = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(noop.status).toBe(200);
    expect(noop.body.name).toBe('姥姥');
  });

  it('撞名归一化 → 409 PERSON_NAME_CONFLICT（v1 不做合并，spec §6）', async () => {
    const { owner, chainId } = await setup();
    const a = await request(app).post(`/api/chains/${chainId}/persons`).set(auth(owner.token)).send({ name: '外婆' });
    const b = await request(app).post(`/api/chains/${chainId}/persons`).set(auth(owner.token)).send({ name: '姥姥' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const res = await request(app)
      .patch(`/api/chains/${chainId}/persons/${a.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERSON_NAME_CONFLICT');
  });

  it('viewer 403；他链 personId 404 PERSON_NOT_FOUND（防跨链探测）；不存在 404', async () => {
    const { owner, viewer, chainId } = await setup();
    const otherChain = await createChain(owner.id, '他链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '外人' });
    expect(foreign.status).toBe(201);

    const asViewer = await request(app)
      .patch(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(viewer.token))
      .send({ name: 'x' });
    expect(asViewer.status).toBe(403);

    const crossChain = await request(app)
      .patch(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(owner.token))
      .send({ name: '改名' });
    expect(crossChain.status).toBe(404);
    expect(crossChain.body.error.code).toBe('PERSON_NOT_FOUND');

    const missing = await request(app)
      .patch(`/api/chains/${chainId}/persons/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner.token))
      .send({ name: '改名' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PERSON_NOT_FOUND');
  });
});

describe('DELETE /api/chains/:chainId/persons/:personId', () => {
  it('editor 可删：先删 moment_persons 关联再删词典行（一个事务），moment 本体不动', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(editor.token));
    expect(res.status).toBe(204);

    expect(await db.select().from(momentPersons).where(eq(momentPersons.personId, person.body.id))).toHaveLength(0);
    expect(await db.select().from(persons).where(eq(persons.id, person.body.id))).toHaveLength(0);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.id).toBe(momentId);
  });

  it('viewer 403；他链 personId 404；不存在 404 PERSON_NOT_FOUND', async () => {
    const { owner, viewer, chainId } = await setup();
    const otherChain = await createChain(owner.id, '他链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '外人' });
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });

    const asViewer = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(viewer.token));
    expect(asViewer.status).toBe(403);

    const crossChain = await request(app)
      .delete(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(owner.token));
    expect(crossChain.status).toBe(404);
    expect(crossChain.body.error.code).toBe('PERSON_NOT_FOUND');

    const missing = await request(app)
      .delete(`/api/chains/${chainId}/persons/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PERSON_NOT_FOUND');
  });
});

describe('链删除清理（chain.service 删除 tx，spec §2 FK 不写 onDelete 的镜像范式）', () => {
  it('删链后 persons / moment_persons 全清', async () => {
    const { owner, chainId } = await setup();
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app).delete(`/api/chains/${chainId}`).set(auth(owner.token));
    expect(res.status).toBe(204);

    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(momentPersons)).toHaveLength(0);
  });
});
