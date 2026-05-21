import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentTags } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachTag, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 标准三人场景：owner + viewer 在链内，outsider 在链外。 */
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

describe('GET /api/chains/:chainId/tags', () => {
  it('viewer 可读，返回每 tag 的 moment 数（软删不计入），按 name 排序', async () => {
    const { owner, viewer, chainId } = await setup();
    const t1 = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'b-tag' });
    const t2 = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'a-tag' });
    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);

    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-02T00:00:00Z') });
    const m3 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-01-03T00:00:00Z'), deletedAt: new Date(),
    });
    await attachTag(m1, t1.body.id);
    await attachTag(m2, t1.body.id);
    await attachTag(m3, t1.body.id); // 软删 moment，不应计数

    const res = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.tags.map((t: { name: string }) => t.name)).toEqual(['a-tag', 'b-tag']);
    const bTag = res.body.tags.find((t: { name: string }) => t.name === 'b-tag');
    expect(bTag.momentCount).toBe(2);
    expect(typeof bTag.createdAt).toBe('string');
  });

  it('非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const { viewer, outsider, chainId } = await setup();
    const forbidden = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(outsider.token));
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/tags`);
    expect(anon.status).toBe(401);
    void viewer;
  });
});

describe('POST /api/chains/:chainId/tags', () => {
  it('editor 创建 201；owner 亦可；重名 409 TAG_EXISTS', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');

    const created = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(editor.token)).send({ name: '周岁' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('周岁');
    expect(created.body.momentCount).toBe(0);
    expect(created.body.id).toBeTruthy();

    const byOwner = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '另一个' });
    expect(byOwner.status).toBe(201);

    const dup = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '周岁' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TAG_EXISTS');
  });

  it('viewer 403；非成员 404；空名 400 VALIDATION_ERROR（用 owner，权限中间件先于 zod parse，viewer 到不了校验层）', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const forbidden = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(viewer.token)).send({ name: 'x' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const notMember = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(outsider.token)).send({ name: 'x' });
    expect(notMember.status).toBe(404);

    // 注意：空名校验用例必须用 editor+ 身份（owner），否则会被 requireChainRole 先拦成 403
    const badBody = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '' });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('每链第 101 个 tag 返回 409 TAG_LIMIT_REACHED', async () => {
    const { owner, chainId } = await setup();
    for (let i = 0; i < 100; i++) {
      const res = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: `tag-${i}` });
      expect(res.status).toBe(201);
    }
    const over = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 'tag-100' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('TAG_LIMIT_REACHED');
  });
});

describe('DELETE /api/tags/:id', () => {
  it('editor 可删：先硬删 moment_tags 关联再删 tag，一个事务', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const tag = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '游泳' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachTag(momentId, tag.body.id);

    const res = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(editor.token));
    expect(res.status).toBe(204);

    const links = await db.select().from(momentTags).where(eq(momentTags.tagId, tag.body.id));
    expect(links).toHaveLength(0);
    const list = await request(app).get(`/api/chains/${chainId}/tags`).set(auth(owner.token));
    expect(list.body.tags).toHaveLength(0);
  });

  it('viewer 403；非成员 404 CHAIN_NOT_FOUND；不存在 404 TAG_NOT_FOUND', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const tag = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: 't' });

    const asViewer = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(viewer.token));
    expect(asViewer.status).toBe(403);

    const asOutsider = await request(app).delete(`/api/tags/${tag.body.id}`).set(auth(outsider.token));
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app).delete(`/api/tags/00000000-0000-4000-8000-000000000000`).set(auth(owner.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TAG_NOT_FOUND');
  });
});
