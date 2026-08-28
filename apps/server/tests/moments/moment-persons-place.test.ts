import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const baseBody = {
  type: 'text' as const,
  content: '在外婆家吃饭',
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

async function geocodeEvents() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
}

async function momentRow(momentId: string) {
  const [row] = await db.select().from(moments).where(eq(moments.id, momentId));
  return row;
}

async function linkRows(momentId: string) {
  return db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
}

describe('POST /api/chains/:chainId/moments — personIds（spec §6）', () => {
  it('全部属链 → 写 moment_persons source=manual（重复 id 去重），响应 persons 回读', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const p1 = await insertPerson({ chainId, name: '外婆' });
    const p2 = await insertPerson({ chainId, name: '朵朵' });

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, personIds: [p2, p1, p2] });
    expect(res.status).toBe(201);
    // serializer 按 (momentId, personId) 升序输出；p1/p2 是 randomUUID，先后不定——
    // 排序后比对 id 集合，字段逐元素断言不依赖顺序
    expect(res.body.persons.map((p: { id: string }) => p.id).sort()).toEqual([p1, p2].sort());
    const byId = new Map(res.body.persons.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(p1)).toEqual({ id: p1, name: '外婆', userId: null, source: 'manual' });
    expect(byId.get(p2)).toEqual({ id: p2, name: '朵朵', userId: null, source: 'manual' });
    const links = await linkRows(res.body.id);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'manual')).toBe(true);
  });

  it('含他链 person → 400 PERSON_NOT_IN_CHAIN，事务回滚（moment 不落库）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const mine = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, personIds: [mine, foreign] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_NOT_IN_CHAIN');
    expect(await db.select().from(moments).where(eq(moments.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(momentPersons)).toHaveLength(0);
  });

  it('不传 personIds → 无关联行，响应 persons=[]、place=null', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody });
    expect(res.status).toBe(201);
    expect(await linkRows(res.body.id)).toHaveLength(0);
    expect(res.body.persons).toEqual([]);
    expect(res.body.place).toBeNull();
  });
});

describe('POST — place 赋值表（spec §6，逐行）', () => {
  it('坐标 + 名字 → manual，不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家', lat: 39.9, lng: 116.4 } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });
    const row = await momentRow(res.body.id);
    expect(row.placeSource).toBe('manual');
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('仅坐标 → exif，同事务写 outbox moment.geocode（payload {momentId, lat, lng}）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const events = await geocodeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.geocode', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId: res.body.id, lat: 39.9042, lng: 116.4074 });
  });

  it('仅名字 → manual，无坐标、不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家' } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'manual' });
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('place:null 等价未传（P1 偏差 4）：place null、无 outbox', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: null });
    expect(res.status).toBe(201);
    expect(res.body.place).toBeNull();
    const row = await momentRow(res.body.id);
    expect(row.placeSource).toBeNull();
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('坐标越界（lat 91）→ 400（spec §9 server 级复验 dto 的范围校验）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 91, lng: 0 } });
    expect(res.status).toBe(400);
    // server 全局错误处理把 ZodError 统一映射为 VALIDATION_ERROR（middlewares/error-handler.ts，
    // 同本套件空名用例）；范围校验由 dto 的 zod min/max（lat ∈ [-90,90]）拒绝，
    // PLACE_COORDS_INVALID 只是「同有同无/至少其一」refine 的 message，不作为 HTTP code 出现
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/moments/:id — personIds 全量替换（spec §6）', () => {
  it('提交集合写 manual、集合外 manual/ai 一并删；ai 行被重选后升级 manual（spec §5 冲突规则）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    const b = await insertPerson({ chainId, name: '朵朵' });
    await attachPerson(momentId, a, 'manual');
    await attachPerson(momentId, b, 'ai');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [b] });
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([{ id: b, name: '朵朵', userId: null, source: 'manual' }]);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: b, source: 'manual' });
  });

  it('空数组 = 清空全部人物', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, a, 'manual');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([]);
    expect(await linkRows(momentId)).toHaveLength(0);
  });

  it('缺省 undefined = 不变（ai 行保留、不因保存被升级——dirty tracking 的 server 侧语义）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, a, 'ai');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ content: '只改正文' });
    expect(res.status).toBe(200);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: a, source: 'ai' });
  });

  it('含他链 person → 400 PERSON_NOT_IN_CHAIN，原关联保留（回滚）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });
    await attachPerson(momentId, a, 'manual');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [foreign] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_NOT_IN_CHAIN');
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: a, source: 'manual' });
  });
});

describe('PATCH — place（spec §6 赋值表 + 清除语义）', () => {
  it('place:null 显式清除三列 + source（spec §5 冲突规则：显式清除 > 一切）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家', lat: 39.9, lng: 116.4 } });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: null });
    expect(res.status).toBe(200);
    expect(res.body.place).toBeNull();
    const row = await momentRow(created.body.id);
    expect(row.placeLat).toBeNull();
    expect(row.placeLng).toBeNull();
    expect(row.placeName).toBeNull();
    expect(row.placeSource).toBeNull();
  });

  it('仅坐标 → exif，同事务写 geocode outbox（manual 文本 place 被整体覆盖）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家' } });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { lat: 39.9042, lng: 116.4074 } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const events = await geocodeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ momentId: created.body.id, lat: 39.9042, lng: 116.4074 });
  });

  it('仅名字 → manual，坐标清空（三列同生同灭）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(created.status).toBe(201);
    expect(await geocodeEvents()).toHaveLength(1);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { name: '外婆家' } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'manual' });
    // 手动文本不触发 geocode（spec §4）
    expect(await geocodeEvents()).toHaveLength(1);
  });

  it('坐标 + 名字 → manual，不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { name: '北京', lat: 39.9, lng: 116.4 } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '北京', source: 'manual' });
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('缺省 undefined = 不变（exif 值保留，不重复发 geocode）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(created.status).toBe(201);
    expect(await geocodeEvents()).toHaveLength(1);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: '只改正文' });
    expect(res.status).toBe(200);
    const row = await momentRow(created.body.id);
    expect(row.placeSource).toBe('exif');
    expect(row.placeLat).toBeCloseTo(39.9042, 4);
    expect(await geocodeEvents()).toHaveLength(1);
  });
});
