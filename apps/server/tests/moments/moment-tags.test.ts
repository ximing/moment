import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentTags, moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const editor = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, editor.id, 'editor');
  return { owner, editor, chainId };
}

async function createTag(chainId: string, token: string, name: string): Promise<string> {
  const res = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const momentBody = (tagIds: string[]) => ({
  type: 'text',
  content: '一条 moment',
  happenedAt: '2026-01-01T00:00:00.000Z',
  happenedTzOffset: -480,
  tagIds,
});

describe('POST /api/chains/:chainId/moments 携带 tagIds', () => {
  it('创建成功且响应含 tags；moment_tags 落库', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const tagB = await createTag(chainId, editor.token, 'B');

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA, tagB]));
    expect(res.status).toBe(201);
    expect(res.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['A', 'B']);

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, res.body.id));
    expect(links.map((l) => l.tagId).sort()).toEqual([tagA, tagB].sort());
  });

  it('tagIds 去重后入库；空数组等同无 tag', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');

    const dup = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA, tagA]));
    expect(dup.status).toBe(201);
    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, dup.body.id));
    expect(links).toHaveLength(1);

    const none = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([]));
    expect(none.status).toBe(201);
    expect(none.body.tags).toEqual([]);
  });

  it('引用其他链的 tag 返回 400 TAG_NOT_IN_CHAIN 且整笔回滚（moment 不落库）', async () => {
    const { editor, chainId } = await setup();
    const otherOwner = await registerUser();
    const otherChain = await createChain(otherOwner.id);
    const foreignTag = await createTag(otherChain, otherOwner.token, '别人的');

    const before = await db.select({ id: moments.id }).from(moments);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([foreignTag]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TAG_NOT_IN_CHAIN');

    const after = await db.select({ id: moments.id }).from(moments);
    expect(after).toHaveLength(before.length);
  });
});

describe('PATCH /api/moments/:id 携带 tagIds', () => {
  it('tagIds 全量重建关联；不传 tagIds 则保持不变', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const tagB = await createTag(chainId, editor.token, 'B');

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    expect(created.status).toBe(201);
    const momentId = created.body.id as string;

    const patched = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(editor.token))
      .send({ tagIds: [tagB] });
    expect(patched.status).toBe(200);
    expect(patched.body.tags.map((t: { id: string }) => t.id)).toEqual([tagB]);

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(links.map((l) => l.tagId)).toEqual([tagB]);

    // 不带 tagIds 的部分更新不动 moment_tags
    await request(app).patch(`/api/moments/${momentId}`).set(auth(editor.token)).send({ content: '改内容' });
    const linksAfter = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(linksAfter.map((l) => l.tagId)).toEqual([tagB]);
  });

  it('PATCH 引用他链 tag 返回 400 TAG_NOT_IN_CHAIN 且关联不被破坏', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const otherOwner = await registerUser();
    const otherChain = await createChain(otherOwner.id);
    const foreignTag = await createTag(otherChain, otherOwner.token, '别人的');

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    const momentId = created.body.id as string;

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(editor.token))
      .send({ tagIds: [foreignTag] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TAG_NOT_IN_CHAIN');

    const links = await db.select().from(momentTags).where(eq(momentTags.momentId, momentId));
    expect(links.map((l) => l.tagId)).toEqual([tagA]);
  });
});

describe('GET /api/moments/:id 响应含 tags', () => {
  it('详情返回 tags 数组', async () => {
    const { editor, chainId } = await setup();
    const tagA = await createTag(chainId, editor.token, 'A');
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(editor.token))
      .send(momentBody([tagA]));
    const momentId = created.body.id as string;

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(editor.token));
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([{ id: tagA, name: 'A' }]);
  });
});
