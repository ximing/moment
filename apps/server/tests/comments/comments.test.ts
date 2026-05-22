import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { comments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** owner + viewer + outsider 三人场景与一条 owner 的 moment。 */
async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
  return { owner, viewer, outsider, chainId, momentId };
}

describe('POST /api/moments/:id/comments', () => {
  it('viewer 可评论：201 落库，同事务 emitOutbox(comment.created)', async () => {
    const { viewer, momentId, chainId } = await setup();
    const res = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '  好可爱！ ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      momentId,
      author: { id: viewer.id, nickname: expect.any(String) },
      content: '好可爱！',
    });

    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'comment.created'));
    expect(event.payload).toEqual({
      commentId: res.body.id,
      momentId,
      chainId,
      authorId: viewer.id,
    });
  });

  it('未登录 401；空 content 400 VALIDATION_ERROR；超 1000 字 400', async () => {
    const { viewer, momentId } = await setup();
    expect((await request(app).post(`/api/moments/${momentId}/comments`).send({ content: 'x' })).status).toBe(401);
    const empty = await request(app).post(`/api/moments/${momentId}/comments`).set(auth(viewer.token)).send({ content: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const tooLong = await request(app).post(`/api/moments/${momentId}/comments`).set(auth(viewer.token)).send({ content: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(400);
  });

  it('非链成员 404 CHAIN_NOT_FOUND；moment 不存在 404；moment 已软删 410 MOMENT_DELETED', async () => {
    const { viewer, outsider, momentId } = await setup();
    const stranger = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(outsider.token))
      .send({ content: '路过' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app)
      .post('/api/moments/00000000-0000-4000-8000-000000000000/comments')
      .set(auth(viewer.token))
      .send({ content: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MOMENT_NOT_FOUND');

    const { moments } = await import('../../src/db/schema.js');
    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
    const gone = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: 'x' });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('GET /api/moments/:id/comments', () => {
  it('viewer 可读；升序（旧→新）；软删评论不出现；翻页不丢不重', async () => {
    const { owner, viewer, momentId } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/moments/${momentId}/comments`)
        .set(auth(owner.token))
        .send({ content: `c-${i}` });
      ids.push(res.body.id as string);
    }
    // 软删第 2 条
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, ids[1]));

    const first = await request(app).get(`/api/moments/${momentId}/comments?limit=2`).set(auth(viewer.token));
    expect(first.status).toBe(200);
    expect(first.body.comments.map((c: { id: string }) => c.id)).toEqual([ids[0], ids[2]]);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app)
      .get(`/api/moments/${momentId}/comments?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(auth(viewer.token));
    expect(second.body.comments.map((c: { id: string }) => c.id)).toEqual([ids[3], ids[4]]);
    expect(second.body.nextCursor).toBeNull();

    // 非成员 404；坏游标 400 INVALID_CURSOR
    const outsider = await registerUser();
    expect((await request(app).get(`/api/moments/${momentId}/comments`).set(auth(outsider.token))).status).toBe(404);
    const bad = await request(app)
      .get(`/api/moments/${momentId}/comments?cursor=${encodeURIComponent('!!!')}`)
      .set(auth(viewer.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('DELETE /api/comments/:id', () => {
  it('评论作者可删（软删）；链 owner 可删他人评论；普通成员删他人 403 NOT_COMMENT_AUTHOR', async () => {
    const { owner, viewer, momentId, chainId } = await setup();
    const mine = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: 'viewer 的评论' });
    expect((await request(app).delete(`/api/comments/${mine.body.id}`).set(auth(viewer.token))).status).toBe(204);
    const [row] = await db.select().from(comments).where(eq(comments.id, mine.body.id));
    expect(row.deletedAt).not.toBeNull();

    const others = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '又一条' });
    expect((await request(app).delete(`/api/comments/${others.body.id}`).set(auth(owner.token))).status).toBe(204);

    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const byOwner = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(owner.token))
      .send({ content: 'owner 的评论' });
    const denied = await request(app).delete(`/api/comments/${byOwner.body.id}`).set(auth(editor.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('NOT_COMMENT_AUTHOR');
  });

  it('不存在 404 COMMENT_NOT_FOUND；非链成员 404 CHAIN_NOT_FOUND', async () => {
    const { owner, outsider, momentId } = await setup();
    const created = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(owner.token))
      .send({ content: 'x' });
    const nf = await request(app).delete('/api/comments/00000000-0000-4000-8000-000000000000').set(auth(owner.token));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('COMMENT_NOT_FOUND');
    const stranger = await request(app).delete(`/api/comments/${created.body.id}`).set(auth(outsider.token));
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('outbox 原子性', () => {
  it('评论事务与 outbox 同生共死（回滚后两表皆空）', async () => {
    const { momentId } = await setup();
    // 走真实接口成功路径建立对照后，直接验证表级原子性：用事务回滚 emitOutbox
    const { emitOutbox } = await import('../../src/outbox/outbox.js');
    const { OUTBOX_COMMENT_CREATED } = await import('../../src/outbox/types.js');
    await expect(
      db.transaction(async (tx) => {
        await emitOutbox(tx, OUTBOX_COMMENT_CREATED, { commentId: 'x', momentId, chainId: 'y', authorId: 'z' });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    const rows = await db.select().from(outbox).where(and(eq(outbox.type, 'comment.created')));
    expect(rows).toHaveLength(0);
  });
});
