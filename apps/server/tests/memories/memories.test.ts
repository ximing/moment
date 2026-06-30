import request from 'supertest';
import type { Response } from 'supertest';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getToday(token: string, date?: string): Promise<Response> {
  const qs = date === undefined ? '' : `?date=${encodeURIComponent(date)}`;
  return request(app).get(`/api/memories/today${qs}`).set(auth(token));
}

function yearList(res: Response): number[] {
  return res.body.years.map((g: { year: number }) => g.year);
}

function idsOf(res: Response, year: number): string[] {
  const group = res.body.years.find((g: { year: number }) => g.year === year);
  return group ? group.moments.map((m: { id: string }) => m.id) : [];
}

/** 两用户两链：chainA（alice=owner）、chainB（bob=owner，alice=viewer）、chainC（carol 私有）。 */
async function setupWorld() {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();
  const chainA = await createChain(alice.id, '链A');
  const chainB = await createChain(bob.id, '链B');
  const chainC = await createChain(carol.id, '链C');
  await addMember(chainB, alice.id, 'viewer');
  return { alice, bob, carol, chainA, chainB, chainC };
}

describe('GET /api/memories/today 参数校验', () => {
  it('date 非法 → 400 INVALID_DATE；缺省 → 400；未登录 → 401', async () => {
    const alice = await registerUser();
    for (const bad of ['2026-13-40', '2026-02-30', '2026/08/18', 'not-a-date', '2026-8-18']) {
      const res = await getToday(alice.token, bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_DATE');
    }
    const missing = await getToday(alice.token);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_DATE');

    const anon = await request(app).get('/api/memories/today?date=2026-08-18');
    expect(anon.status).toBe(401);
  });

  it('无任何链成员关系时返回空 years', async () => {
    const loner = await registerUser();
    const res = await getToday(loner.token, '2026-08-18');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ years: [] });
  });
});

describe('GET /api/memories/today 周年匹配与可见性', () => {
  it('两用户两链多年份样本：墙钟归日（不同 tzOffset）、仅整数周年、年份倒序、组内墙钟升序', async () => {
    const { alice, bob, carol, chainA, chainB, chainC } = await setupWorld();

    // 2025 年组两条（组内墙钟升序跨 tzOffset 验证）：
    // wall 09:00（UTC 01:00，东八区记录）应排在 wall 10:00（UTC 10:00，零时区记录）之前
    const m2025late = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2025-08-18T10:00:00Z'), happenedTzOffset: 0 });
    const m2025early = await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2025-08-18T01:00:00Z'), happenedTzOffset: -480 });
    // 2024：东八区墙钟 2024-08-18 09:00
    const m2024 = await insertMoment({ chainId: chainB, authorId: bob.id, happenedAt: new Date('2024-08-18T01:00:00Z'), happenedTzOffset: -480 });
    // 2023：UTC 08-17 23:30 + 东八区 → 墙钟 2023-08-18 07:30（记录者墙钟≠UTC 日期的归日样本）
    const m2023 = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2023-08-17T23:30:00Z'), happenedTzOffset: -480 });

    // —— 以下为不应出现的样本 ——
    // 记录者西十区（tzOffset=+600）：UTC 08-18 05:00 → 墙钟 2022-08-17 19:00，不算 08-18
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2022-08-18T05:00:00Z'), happenedTzOffset: 600 });
    // 今年同月同日：年份 = date 年份，非整数周年
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2026-08-18T08:00:00Z'), happenedTzOffset: 0 });
    // 去年 08-17：同月不同日
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2025-08-17T10:00:00Z'), happenedTzOffset: 0 });
    // 非成员链（carol 私有）
    await insertMoment({ chainId: chainC, authorId: carol.id, happenedAt: new Date('2025-08-18T10:00:00Z'), happenedTzOffset: 0 });
    // 软删
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2025-08-18T12:00:00Z'), happenedTzOffset: 0, deletedAt: new Date() });

    const res = await getToday(alice.token, '2026-08-18');
    expect(res.status).toBe(200);
    expect(yearList(res)).toEqual([2025, 2024, 2023]);
    expect(idsOf(res, 2025)).toEqual([m2025early, m2025late]);
    expect(idsOf(res, 2024)).toEqual([m2024]);
    expect(idsOf(res, 2023)).toEqual([m2023]);
    // 序列化形状与 feed 一致（serializeMoments 出口）
    const one = res.body.years[0].moments[0];
    expect(one).toMatchObject({ chainId: chainB, type: 'text', commentCount: 0, reactions: [], myReaction: null });
    expect(one.author.id).toBe(bob.id);
  });

  it('查看者时区≠记录者时区：按记录者墙钟（wall_date）归日，与 date（查看者本地）匹配', async () => {
    const { alice, chainA } = await setupWorld();
    // UTC 视角是 08-17 深夜，东八区记录者墙钟已是 08-18 清晨 → 查看者查 08-18 必须命中
    const hit = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2023-08-17T22:00:00Z'), happenedTzOffset: -480 });
    // UTC 视角是 08-18 清晨，西十区记录者墙钟还是 08-17 下午 → 查看者查 08-18 不得命中
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2022-08-18T02:00:00Z'), happenedTzOffset: 600 });

    const res = await getToday(alice.token, '2026-08-18');
    expect(res.status).toBe(200);
    expect(yearList(res)).toEqual([2023]);
    expect(idsOf(res, 2023)).toEqual([hit]);

    // 同一条反向：西十区那条的墙钟是 2022-08-17，查 08-17 应命中
    const prev = await getToday(alice.token, '2026-08-17');
    expect(yearList(prev)).toEqual([2022]);
  });
});

describe('GET /api/memories/today 历法边界', () => {
  it('2/29：平年今日查询不出现闰日记录；闰年今日查询出现；闰日查询不带出 02-28 记录', async () => {
    const { alice, chainA } = await setupWorld();
    const leapDay = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2020-02-29T10:00:00Z'), happenedTzOffset: 0 });
    await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2021-02-28T10:00:00Z'), happenedTzOffset: 0 });

    // 平年今日（2025-02-28）：只命中 02-28 记录，闰日的 2020-02-29 不出现
    const common = await getToday(alice.token, '2025-02-28');
    expect(yearList(common)).toEqual([2021]);

    // 闰年今日（2024-02-29）：命中 2020 闰日记录，且不带出 02-28 记录
    const leap = await getToday(alice.token, '2024-02-29');
    expect(yearList(leap)).toEqual([2020]);
    expect(idsOf(leap, 2020)).toEqual([leapDay]);
  });

  it('12-31 / 01-01 跨年：墙钟年份随 wall_date 跨界', async () => {
    const { alice, chainA } = await setupWorld();
    // UTC 2024-12-31 20:00 + 东八区 → 墙钟 2025-01-01 04:00
    const newYear = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2024-12-31T20:00:00Z'), happenedTzOffset: -480 });
    // UTC 2025-01-01 02:00 + 西十一区 → 墙钟 2024-12-31 15:00
    const yearEnd = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2025-01-01T02:00:00Z'), happenedTzOffset: 660 });

    const jan1 = await getToday(alice.token, '2026-01-01');
    expect(yearList(jan1)).toEqual([2025]);
    expect(idsOf(jan1, 2025)).toEqual([newYear]);

    const dec31 = await getToday(alice.token, '2026-12-31');
    expect(yearList(dec31)).toEqual([2024]);
    expect(idsOf(dec31, 2024)).toEqual([yearEnd]);
  });
});

describe('wall_date 写路径', () => {
  it('create：API 创建按 happenedTzOffset 归日写入 wall_date', async () => {
    const { alice, chainA } = await setupWorld();
    const create = await request(app)
      .post(`/api/chains/${chainA}/moments`)
      .set(auth(alice.token))
      .send({ type: 'text', content: '东八区清晨', happenedAt: '2023-08-17T23:30:00.000Z', happenedTzOffset: -480 });
    expect(create.status).toBe(201);

    const res = await getToday(alice.token, '2026-08-18');
    expect(yearList(res)).toEqual([2023]);
    expect(idsOf(res, 2023)).toEqual([create.body.id]);
  });

  it('update：改 happenedAt 后 wall_date 重算（旧日期不再命中，新日期命中）', async () => {
    const { alice, chainA } = await setupWorld();
    const id = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2025-08-18T10:00:00Z'), happenedTzOffset: 0 });
    expect(yearList(await getToday(alice.token, '2026-08-18'))).toEqual([2025]);

    const patch = await request(app)
      .patch(`/api/moments/${id}`)
      .set(auth(alice.token))
      .send({ happenedAt: '2025-08-19T10:00:00.000Z' });
    expect(patch.status).toBe(200);

    expect((await getToday(alice.token, '2026-08-18')).body).toEqual({ years: [] });
    const moved = await getToday(alice.token, '2026-08-19');
    expect(yearList(moved)).toEqual([2025]);
    expect(idsOf(moved, 2025)).toEqual([id]);
  });

  it('update：单独改 happenedTzOffset（不改时间点）也重算 wall_date', async () => {
    const { alice, chainA } = await setupWorld();
    // UTC 2024-08-18 05:00，零时区 → 墙钟 08-18
    const id = await insertMoment({ chainId: chainA, authorId: alice.id, happenedAt: new Date('2024-08-18T05:00:00Z'), happenedTzOffset: 0 });
    expect(yearList(await getToday(alice.token, '2026-08-18'))).toEqual([2024]);

    // 改为西十区（+600）：同一 UTC 时刻 → 墙钟 2024-08-17 19:00
    const patch = await request(app)
      .patch(`/api/moments/${id}`)
      .set(auth(alice.token))
      .send({ happenedTzOffset: 600 });
    expect(patch.status).toBe(200);

    expect((await getToday(alice.token, '2026-08-18')).body).toEqual({ years: [] });
    const moved = await getToday(alice.token, '2026-08-17');
    expect(yearList(moved)).toEqual([2024]);
    expect(idsOf(moved, 2024)).toEqual([id]);
  });
});
