import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 造一条带人物（manual）+ 地点（exif 坐标、名字待回填）的 moment。 */
async function seedRichMoment(chainId: string, authorId: string): Promise<{ momentId: string; personId: string }> {
  const momentId = await insertMoment({ chainId, authorId, happenedAt: new Date('2026-08-01T00:00:00Z') });
  const personId = await insertPerson({ chainId, name: '外婆' });
  await attachPerson(momentId, personId, 'manual');
  await db
    .update(moments)
    .set({ placeLat: 39.9042, placeLng: 116.4074, placeName: null, placeSource: 'exif' })
    .where(eq(moments.id, momentId));
  return { momentId, personId };
}

describe('serializeMoments includePrivate 双路（spec §6/§8/§9 隐私红线）', () => {
  it('链内路径：GET /api/chains/:chainId/moments 输出含 persons/place（批取，含 source）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const item = res.body.items.find((m: { id: string }) => m.id === momentId);
    expect(item.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(item.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
  });

  it('链内路径：GET /api/moments/:id 输出含 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
  });

  it('链内路径：GET /api/feed?chain_ids= 输出含 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const item = res.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(item.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(item.place.source).toBe('exif');
  });

  it('链内路径：无人物无地点的 moment 输出 persons=[]、place=null（字段必存在，P1 偏差 2 收口）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].persons).toEqual([]);
    expect(res.body.items[0].place).toBeNull();
  });

  it('share-album：GET /api/public/share/:token 输出零 persons/place 键（隐私红线）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await seedRichMoment(chainId, owner.id);

    const link = await request(app).post(`/api/chains/${chainId}/share-links`).set(auth(owner.token)).send({});
    expect(link.status).toBe(201);

    const res = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    // 红线断言：键完全不存在（不是空数组/null 值）
    expect('persons' in res.body.moments[0]).toBe(false);
    expect('place' in res.body.moments[0]).toBe(false);
    expect(Object.keys(res.body.moments[0])).not.toContain('persons');
    expect(Object.keys(res.body.moments[0])).not.toContain('place');
  });
});
