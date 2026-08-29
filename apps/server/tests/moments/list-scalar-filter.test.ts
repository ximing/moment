import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  addMember,
  app,
  attachPerson,
  createChain,
  insertMoment,
  insertPerson,
  registerUser,
} from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setPlace(momentId: string, name: string): Promise<void> {
  await db
    .update(moments)
    .set({
      placeLat: 39.9042,
      placeLng: 116.4074,
      placeName: name,
      placeSource: 'manual',
    })
    .where(eq(moments.id, momentId));
}

describe('GET /api/chains/:chainId/moments 标量过滤（spec §6.1 parse(req.query)）', () => {
  it('person_id / place 过滤；子串不命中；他链 person 空页；非成员 404', async () => {
    const owner = await registerUser();
    const outsider = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const grandma = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    await setPlace(hit, '朝阳公园');
    await setPlace(miss, '奥林匹克公园');

    const byPerson = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${grandma}`)
      .set(auth(owner.token));
    expect(byPerson.status).toBe(200);
    expect(byPerson.body.items.map((m: { id: string }) => m.id)).toEqual([hit]);

    const byPlace = await request(app)
      .get(`/api/chains/${chainId}/moments?place=${encodeURIComponent('朝阳公园')}`)
      .set(auth(owner.token));
    expect(byPlace.status).toBe(200);
    expect(byPlace.body.items.map((m: { id: string }) => m.id)).toEqual([hit]);

    const sub = await request(app)
      .get(`/api/chains/${chainId}/moments?place=${encodeURIComponent('朝阳')}`)
      .set(auth(owner.token));
    expect(sub.status).toBe(200);
    expect(sub.body.items).toEqual([]);

    const foreignPerson = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${foreign}`)
      .set(auth(owner.token));
    expect(foreignPerson.status).toBe(200);
    expect(foreignPerson.body.items).toEqual([]);

    const denied = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${grandma}`)
      .set(auth(outsider.token));
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('happened_from/to 闭区间；与 before AND（before 仍严格 <）；viewer 可读', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');

    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-21T00:00:00.000Z'),
    });

    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-08-20T00:00:00.000Z');
    const res = await request(app)
      .get(`/api/chains/${chainId}/moments?happened_from=${from}&happened_to=${to}`)
      .set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([toEdge, mid, fromEdge]);

    const withBefore = await request(app)
      .get(
        `/api/chains/${chainId}/moments?happened_from=${from}&happened_to=${to}&before=${encodeURIComponent('2026-08-20T00:00:00.000Z')}`,
      )
      .set(auth(viewer.token));
    expect(withBefore.status).toBe(200);
    expect(withBefore.body.items.map((m: { id: string }) => m.id)).toEqual([mid, fromEdge]);
  });

  it('from>to → 400 VALIDATION_ERROR；无 RANGE_REQUIRES_HAPPENED_AT（无 order）；query 上的 order 被 strip', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const bad = await request(app)
      .get(
        `/api/chains/${chainId}/moments?happened_from=${encodeURIComponent('2026-08-02T00:00:00.000Z')}&happened_to=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
      )
      .set(auth(owner.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const messages = (bad.body.error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toContain('VALIDATION_ERROR');
    expect(messages).not.toContain('RANGE_REQUIRES_HAPPENED_AT');

    // 链列表恒 happened_at：即使乱传 order=created_at 也不走 RANGE；区间仍按 happened_at 过滤
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    const inRange = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    const stripped = await request(app)
      .get(
        `/api/chains/${chainId}/moments?order=created_at&happened_from=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
      )
      .set(auth(owner.token));
    expect(stripped.status).toBe(200);
    expect(stripped.body.items.map((m: { id: string }) => m.id)).toEqual([inRange]);
  });

  it('parse(req.query) 吃完整 query：非法 person_id 400；limit 越界仍 INVALID_LIMIT（非 VALIDATION_ERROR）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const nope = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=nope`)
      .set(auth(owner.token));
    expect(nope.status).toBe(400);
    expect(nope.body.error.code).toBe('VALIDATION_ERROR');

    const over = await request(app)
      .get(`/api/chains/${chainId}/moments?limit=51`)
      .set(auth(owner.token));
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('INVALID_LIMIT');

    const zero = await request(app)
      .get(`/api/chains/${chainId}/moments?limit=0`)
      .set(auth(owner.token));
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('INVALID_LIMIT');
  });

  it('过滤翻页游标仍是 {h,i}', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);

    const p1 = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${personId}&limit=1`)
      .set(auth(owner.token));
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(1);
    const raw = JSON.parse(Buffer.from(p1.body.nextCursor as string, 'base64url').toString('utf8')) as {
      h?: unknown;
      d?: unknown;
      c?: unknown;
    };
    expect(typeof raw.h).toBe('number');
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();
  });
});
