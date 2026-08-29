import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { decodeCursor } from '../../src/feed/cursor.js';
import { queryMomentPage } from '../../src/feed/moment-query.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  app,
  attachPerson,
  attachTag,
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

function ids(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

describe('queryMomentPage 标量过滤（fused-retrieval spec §6.1）', () => {
  it('personId：semi-join moment_persons；未关联 / 他链 person / 不存在 id → 空页（不抛）', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const chainA = await createChain(owner.id, 'A');
    const chainB = await createChain(other.id, 'B');
    const grandma = await insertPerson({ chainId: chainA, name: '外婆' });
    const foreign = await insertPerson({ chainId: chainB, name: '外人' });
    const hit = await insertMoment({
      chainId: chainA,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId: chainA,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);
    void miss;

    const page = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: grandma,
    });
    expect(ids(page.rows)).toEqual([hit]);

    const noLink = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: foreign,
    });
    expect(noLink.rows).toEqual([]);
    expect(noLink.nextCursor).toBeNull();

    const missing = await queryMomentPage({
      chainIds: [chainA],
      order: 'happened_at',
      limit: 20,
      personId: '00000000-0000-4000-8000-000000000099',
    });
    expect(missing.rows).toEqual([]);
  });

  it('personId：软删 moment 不出现', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const live = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const gone = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
      deletedAt: new Date(),
    });
    await attachPerson(live, personId);
    await attachPerson(gone, personId);

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      personId,
    });
    expect(ids(page.rows)).toEqual([live]);
  });

  it('place：整串相等；子串不命中；零命中空页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const park = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const other = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
    });
    const unnamed = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-08T00:00:00Z'),
    });
    await setPlace(park, '朝阳公园');
    await setPlace(other, '奥林匹克公园');

    const exact = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '朝阳公园',
    });
    expect(ids(exact.rows)).toEqual([park]);

    const substring = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '朝阳',
    });
    expect(substring.rows).toEqual([]);

    const none = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      place: '不存在的地方',
    });
    expect(none.rows).toEqual([]);
    void unnamed;
  });

  it('happenedFrom/To：happened_at 闭区间 [from, to]；只用 happened_at 不用 wall_date', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const before = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T23:59:59.000Z'),
    });
    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const mid = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T12:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-31T23:59:59.999Z'),
    });
    const after = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-01T00:00:00.000Z',
      happenedTo: '2026-08-31T23:59:59.999Z',
    });
    expect(ids(page.rows)).toEqual([toEdge, mid, fromEdge]);
    void before;
    void after;
  });

  it('happenedFrom/To：比较 UTC 瞬时（带偏移 ISO 经 Date 解析）；不按 wall_date 分桶', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    // 同一 UTC 瞬时、不同 happened_tz_offset → 不同 wall_date（东八 08-01 vs UTC 07-31）
    const east8 = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T16:30:00Z'),
      happenedTzOffset: -480,
    });
    const utc = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-07-31T16:30:00Z'),
      happenedTzOffset: 0,
    });

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-01T00:00:00+08:00', // UTC 7/31 16:00
      happenedTo: '2026-07-31T17:00:00Z',
    });
    expect(new Set(ids(page.rows))).toEqual(new Set([east8, utc]));
  });

  it('只 from / 只 to 各自生效', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const a = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const b = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-20T00:00:00Z'),
    });

    const fromOnly = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedFrom: '2026-08-10T00:00:00.000Z',
    });
    expect(ids(fromOnly.rows)).toEqual([b]);

    const toOnly = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      happenedTo: '2026-08-10T00:00:00.000Z',
    });
    expect(ids(toOnly.rows)).toEqual([a]);
  });

  it('personId + tagId + place + happened_* + before 全部 AND；before 仍严格 <', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const tagRes = await request(app)
      .post(`/api/chains/${chainId}/tags`)
      .set(auth(owner.token))
      .send({ name: '野餐' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;

    async function seed(at: string, opts: { person?: boolean; tag?: boolean; place?: string }) {
      const id = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(at),
      });
      if (opts.person) await attachPerson(id, personId);
      if (opts.tag) await attachTag(id, tagId);
      if (opts.place) await setPlace(id, opts.place);
      return id;
    }

    const hit = await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });
    await seed('2026-08-10T00:00:00.000Z', { tag: true, place: '朝阳公园' }); // 无人
    await seed('2026-08-10T00:00:00.000Z', { person: true, place: '朝阳公园' }); // 无 tag
    await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '奥林匹克公园',
    });
    await seed('2026-08-20T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    }); // 晚于 before
    const beforeEdge = await seed('2026-08-15T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    }); // happened_at === before → 排除

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 20,
      personId,
      tagId,
      place: '朝阳公园',
      happenedFrom: '2026-08-01T00:00:00.000Z',
      happenedTo: '2026-08-31T00:00:00.000Z',
      before: '2026-08-15T00:00:00.000Z',
    });
    expect(ids(page.rows)).toEqual([hit]);
    void beforeEdge;
  });

  it('personId 与 order=created_at 可共存；区间在 created_at 下被忽略（不得打 happened_at，也不得打 timeCol/created_at）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const olderEvent = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    const newerEvent = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    const createdBeforeRange = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    const unattached = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-15T00:00:00Z'),
      createdAt: new Date('2026-08-25T00:00:00Z'),
    });
    await attachPerson(olderEvent, personId);
    await attachPerson(newerEvent, personId);
    await attachPerson(createdBeforeRange, personId);

    const byCreated = await queryMomentPage({
      chainIds: [chainId],
      order: 'created_at',
      limit: 20,
      personId,
      // 若误 gte(happened_at) → 丢掉 olderEvent；若误 gte(timeCol/created_at) → 丢掉 createdBeforeRange
      happenedFrom: '2026-08-01T00:00:00.000Z',
    });
    expect(ids(byCreated.rows)).toEqual([olderEvent, newerEvent, createdBeforeRange]);
    void unattached;
  });

  it('过滤后仍用 {h,i} 游标翻页；坏游标仍 INVALID_CURSOR（先于空结果）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: same }); // 无人物，不得漏进翻页

    const p1 = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 1,
      personId,
    });
    expect(p1.rows).toHaveLength(1);
    expect(p1.nextCursor).toBeTruthy();
    const decoded = decodeCursor('happened_at', p1.nextCursor!);
    expect(decoded).toEqual({ time: same.getTime(), id: p1.rows[0].id });
    const raw = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as {
      h?: unknown;
      c?: unknown;
      d?: unknown;
      i?: unknown;
    };
    expect(raw).toEqual({ h: same.getTime(), i: p1.rows[0].id });
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();

    const p2 = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit: 1,
      personId,
      cursor: p1.nextCursor!,
    });
    expect(p2.rows).toHaveLength(1);
    expect(p2.rows[0].id).not.toBe(p1.rows[0].id);
    expect(new Set([p1.rows[0].id, p2.rows[0].id])).toEqual(new Set([a, b]));

    await expect(
      queryMomentPage({
        chainIds: [chainId],
        order: 'happened_at',
        limit: 20,
        personId,
        cursor: '!!!not-base64!!!',
      }),
    ).rejects.toMatchObject({ message: 'INVALID_CURSOR' });
  });
});
