import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox, reactions } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
  return { owner, viewer, outsider, chainId, momentId };
}

describe('PUT /api/moments/:id/reaction', () => {
  it('viewer 可点赞：upsert 落库 + 同事务 emitOutbox(reaction.created)', async () => {
    const { viewer, momentId, chainId } = await setup();
    const res = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '🎉' });
    expect(res.status).toBe(204);

    const [row] = await db.select().from(reactions).where(eq(reactions.momentId, momentId));
    expect(row.userId).toBe(viewer.id);
    expect(row.emoji).toBe('🎉');

    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'reaction.created'));
    expect(event.payload).toEqual({ momentId, chainId, userId: viewer.id, emoji: '🎉' });
  });

  it('换表情 = upsert 覆盖（不新增行）；再点同一表情幂等但每次都 emit 事件（换表情才通知语义由 payload 承载）', async () => {
    const { viewer, momentId } = await setup();
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👍' });
    const switched = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '❤️' });
    expect(switched.status).toBe(204);

    const rows = await db.select().from(reactions).where(eq(reactions.momentId, momentId));
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('❤️');
    const events = await db.select().from(outbox).where(eq(outbox.type, 'reaction.created'));
    expect(events).toHaveLength(2);
  });

  it('白名单外 emoji 400 VALIDATION_ERROR；未登录 401；非成员 404；moment 软删 410', async () => {
    const { owner, viewer, outsider, momentId } = await setup();
    const bad = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '🔥' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    expect((await request(app).put(`/api/moments/${momentId}/reaction`).send({ emoji: '👍' })).status).toBe(401);

    const stranger = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(outsider.token)).send({ emoji: '👍' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');

    const { moments } = await import('../../src/db/schema.js');
    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
    const gone = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '👍' });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('DELETE /api/moments/:id/reaction', () => {
  it('取消 = 硬删；未点过 404 REACTION_NOT_FOUND', async () => {
    const { viewer, momentId } = await setup();
    const none = await request(app).delete(`/api/moments/${momentId}/reaction`).set(auth(viewer.token));
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('REACTION_NOT_FOUND');

    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👏' });
    const res = await request(app).delete(`/api/moments/${momentId}/reaction`).set(auth(viewer.token));
    expect(res.status).toBe(204);
    expect(await db.select().from(reactions).where(and(eq(reactions.momentId, momentId)))).toHaveLength(0);
  });
});
