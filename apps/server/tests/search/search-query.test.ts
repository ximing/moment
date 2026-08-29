import { decodeCursor } from '../../src/feed/cursor.js';
import {
  hasHardFilter,
  listSearchIds,
  querySearchTimePage,
  type SearchSqlFilter,
} from '../../src/search/search-query.js';
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
import { auth, idsOf, setPlace, setTranscript } from './helpers.js';
import request from 'supertest';

beforeEach(resetDb);
afterAll(closeDb);

function base(chainIds: string[], over: Partial<SearchSqlFilter> = {}): SearchSqlFilter {
  return { chainIds, personIdsByChain: new Map(chainIds.map((id) => [id, []])), ...over };
}

describe('hasHardFilter', () => {
  it('仅空 person 列表不算硬过滤；有 id / place / 时间才算', () => {
    expect(hasHardFilter({ personIdsByChain: new Map([['c', []]]), place: null })).toBe(false);
    expect(hasHardFilter({ personIdsByChain: new Map([['c', ['p']]]), place: null })).toBe(true);
    expect(hasHardFilter({ personIdsByChain: new Map(), place: '朝阳公园' })).toBe(true);
    expect(hasHardFilter({ personIdsByChain: new Map(), place: null, wallDate: '2025-08-29' })).toBe(true);
  });
});

describe('querySearchTimePage 析取 / wall_date / LIKE / 游标', () => {
  it('链内两 person AND；跨链同名析取；0 人名链不过滤人物', async () => {
    const owner = await registerUser();
    const a = await createChain(owner.id, 'A');
    const b = await createChain(owner.id, 'B');
    const c = await createChain(owner.id, 'C');
    const gA = await insertPerson({ chainId: a, name: '外婆' });
    const dA = await insertPerson({ chainId: a, name: '朵朵' });
    const gB = await insertPerson({ chainId: b, name: '外婆' });
    const both = await insertMoment({ chainId: a, authorId: owner.id, happenedAt: new Date('2026-08-10T00:00:00Z') });
    const onlyG = await insertMoment({ chainId: a, authorId: owner.id, happenedAt: new Date('2026-08-09T00:00:00Z') });
    const onB = await insertMoment({ chainId: b, authorId: owner.id, happenedAt: new Date('2026-08-08T00:00:00Z') });
    const onC = await insertMoment({ chainId: c, authorId: owner.id, happenedAt: new Date('2026-08-07T00:00:00Z') });
    await attachPerson(both, gA);
    await attachPerson(both, dA);
    await attachPerson(onlyG, gA);
    await attachPerson(onB, gB);

    const page = await querySearchTimePage({
      ...base([a, b, c], {
        personIdsByChain: new Map([
          [a, [gA, dA]],
          [b, [gB]],
          [c, []],
        ]),
      }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([both, onB, onC]);
    void onlyG;
  });

  it('wall_date 等值（不是 happened_at 分桶）；软删除外', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T16:00:00Z'),
      happenedTzOffset: -480, // wall 2025-08-30
    });
    const sameUtc = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T16:00:00Z'),
      happenedTzOffset: 0, // wall 2025-08-29
    });
    const gone = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-29T00:00:00Z'),
      happenedTzOffset: 0,
      deletedAt: new Date(),
    });
    const page = await querySearchTimePage({ ...base([chainId], { wallDate: '2025-08-29' }), limit: 20 });
    expect(idsOf(page.rows)).toEqual([sameUtc]);
    void hit;
    void gone;
  });

  it('季节 range 闭区间 happened_at', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const before = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-05-31T23:59:59.000Z'),
    });
    const fromEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-06-01T00:00:00.000Z'),
    });
    const toEdge = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-08-31T23:59:59.999Z'),
    });
    const after = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2025-09-01T00:00:00.000Z'),
    });
    const page = await querySearchTimePage({
      ...base([chainId], {
        happenedFrom: '2025-06-01T00:00:00.000Z',
        happenedTo: '2025-08-31T23:59:59.999Z',
      }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([toEdge, fromEdge]);
    void before;
    void after;
  });

  it('LIKE：content/transcript/place_name/persons.name OR；转义 % _ \\', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const pct = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: 'hello%world',
    });
    const wild = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
      content: 'helloXworld',
    });
    const under = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-08T00:00:00Z'),
      content: 'a_b',
    });
    const axb = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-07T00:00:00Z'),
      content: 'axb',
    });
    const byPlace = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-06T00:00:00Z'),
      content: '无',
    });
    await setPlace(byPlace, '朝阳公园');
    const byTr = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-05T00:00:00Z'),
      content: '无',
    });
    await setTranscript(byTr, '朵朵说话');
    const personMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-04T00:00:00Z'),
      content: '无',
    });
    const pid = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(personMoment, pid);

    const pctPage = await querySearchTimePage({
      ...base([chainId], { likeText: 'hello%world' }),
      limit: 20,
    });
    expect(idsOf(pctPage.rows)).toEqual([pct]);
    void wild;

    const underPage = await querySearchTimePage({
      ...base([chainId], { likeText: 'a_b' }),
      limit: 20,
    });
    expect(idsOf(underPage.rows)).toEqual([under]);
    void axb;

    const placePage = await querySearchTimePage({
      ...base([chainId], { likeText: '朝阳公园' }),
      limit: 20,
    });
    expect(idsOf(placePage.rows)).toContain(byPlace);

    const trPage = await querySearchTimePage({
      ...base([chainId], { likeText: '朵朵说话' }),
      limit: 20,
    });
    expect(idsOf(trPage.rows)).toContain(byTr);

    const namePage = await querySearchTimePage({
      ...base([chainId], { likeText: '外婆' }),
      limit: 20,
    });
    expect(idsOf(namePage.rows)).toContain(personMoment);
  });

  it('{h,i} 翻页；坏游标先于空 scope；listSearchIds cap', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });

    const p1 = await querySearchTimePage({ ...base([chainId]), limit: 1 });
    expect(p1.rows).toHaveLength(1);
    const decoded = decodeCursor('happened_at', p1.nextCursor!);
    expect(decoded.id).toBe(p1.rows[0].id);
    const raw = JSON.parse(Buffer.from(p1.nextCursor!, 'base64url').toString('utf8')) as { d?: unknown };
    expect(raw.d).toBeUndefined();

    const p2 = await querySearchTimePage({ ...base([chainId]), cursor: p1.nextCursor!, limit: 1 });
    expect(new Set([p1.rows[0].id, p2.rows[0].id])).toEqual(new Set([a, b]));

    await expect(querySearchTimePage({ ...base([]), cursor: '!!!', limit: 20 })).rejects.toMatchObject({
      message: 'INVALID_CURSOR',
    });

    const ids = await listSearchIds(base([chainId]), 1);
    expect(ids).toHaveLength(1);
  });

  it('body tagId + personId AND；空 chainIds 合法游标 → 空页', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const tagRes = await request(app).post(`/api/chains/${chainId}/tags`).set(auth(owner.token)).send({ name: '野餐' });
    const tagId = tagRes.body.id as string;
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    const miss = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-09T00:00:00Z'),
    });
    await attachPerson(hit, personId);
    await attachTag(hit, tagId);
    await attachPerson(miss, personId);

    const page = await querySearchTimePage({
      ...base([chainId], { personId, tagId }),
      limit: 20,
    });
    expect(idsOf(page.rows)).toEqual([hit]);

    const empty = await querySearchTimePage({ ...base([]), limit: 20 });
    expect(empty.rows).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    void miss;
  });
});
