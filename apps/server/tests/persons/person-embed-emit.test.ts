import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachPerson, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function embedsFor(momentId: string) {
  const rows = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
  return rows.filter((r) => (r.payload as { momentId?: string }).momentId === momentId);
}

describe('PATCH/DELETE person 触发 embed（spec §4.4）', () => {
  it('改名成功 → 该 person 关联的每个 moment 一条 embed；同名幂等不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(m1, created.body.id);
    await attachPerson(m2, created.body.id);

    const renamed = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: '姥姥' });
    expect(renamed.status).toBe(200);
    expect(await embedsFor(m1)).toHaveLength(1);
    expect(await embedsFor(m2)).toHaveLength(1);

    const noop = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(noop.status).toBe(200);
    expect(await embedsFor(m1)).toHaveLength(1);
  });

  it('DELETE：先能查出 momentId（删关联前），再 emit；时刻本体仍在', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, editor.id, 'editor');
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(editor.token));
    expect(res.status).toBe(204);
    expect(await embedsFor(momentId)).toHaveLength(1);
  });
});
