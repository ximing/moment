import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, persons } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('people/place schema 冒烟（P1：两表五列，spec §2）', () => {
  it('persons / moment_persons 可 insert/select，moments 五列可写可读回', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });

    const personId = await insertPerson({ chainId, name: '外婆', userId: owner.id });
    await attachPerson(momentId, personId, 'ai');

    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(person.chainId).toBe(chainId);
    expect(person.name).toBe('外婆');
    expect(person.userId).toBe(owner.id);
    expect(person.createdAt).toBeInstanceOf(Date);

    const links = await db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ momentId, personId, source: 'ai' });

    const hash = 'a'.repeat(64);
    await db
      .update(moments)
      .set({
        placeLat: 39.9042,
        placeLng: 116.4074,
        placeName: '北京市东城区',
        placeSource: 'exif',
        aiExtractHash: hash,
      })
      .where(eq(moments.id, momentId));

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeLat).toBeCloseTo(39.9042, 4);
    expect(m.placeLng).toBeCloseTo(116.4074, 4);
    expect(m.placeName).toBe('北京市东城区');
    expect(m.placeSource).toBe('exif');
    expect(m.aiExtractHash).toBe(hash);
  });

  it('moments 五列默认全 NULL（增量列零回填，spec §2）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.placeName).toBeNull();
    expect(m.placeSource).toBeNull();
    expect(m.aiExtractHash).toBeNull();
  });

  it('uk_persons_chain_name：同链同名撞唯一约束，异链同名放行', async () => {
    const owner = await registerUser();
    const c1 = await createChain(owner.id, '链一');
    const c2 = await createChain(owner.id, '链二');
    await insertPerson({ chainId: c1, name: '朵朵' });
    await expect(insertPerson({ chainId: c1, name: '朵朵' })).rejects.toThrow();
    await expect(insertPerson({ chainId: c2, name: '朵朵' })).resolves.toEqual(expect.any(String));
  });

  it('moment_persons 主键 (moment_id, person_id)：同行两 source 不允许（spec §2）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId, 'ai');
    await expect(attachPerson(momentId, personId, 'manual')).rejects.toThrow();
  });

  it('resetDb 覆盖新表：persons / moment_persons 被清空', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-01-01T00:00:00Z') });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId);

    await resetDb();

    expect(await db.select().from(momentPersons)).toHaveLength(0);
    expect(await db.select().from(persons)).toHaveLength(0);
  });
});
