import request from 'supertest';
import type { Response } from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import {
  addMember,
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

function getFeed(token: string, query = ''): Promise<Response> {
  return request(app).get(`/api/feed${query}`).set(auth(token));
}

function ids(res: Response): string[] {
  return res.body.moments.map((m: { id: string }) => m.id);
}

function issueMessages(res: Response): string[] {
  const details = res.body.error?.details as { message?: string }[] | undefined;
  return Array.isArray(details) ? details.map((d) => d.message ?? '') : [];
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

describe('GET /api/feed 标量过滤（fused-retrieval spec §6.1 / §9）', () => {
  it('person_id 只返回关联该人的 moment；他链/不存在 person → 200 空页（同 tag_id）', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const chainA = await createChain(alice.id, 'A');
    const chainC = await createChain(carol.id, 'C');
    const grandma = await insertPerson({ chainId: chainA, name: '外婆' });
    const foreign = await insertPerson({ chainId: chainC, name: '外人' });
    const hit = await insertMoment({
      chainId: chainA,
      authorId: alice.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await insertMoment({
      chainId: chainA,
      authorId: alice.id,
      happenedAt: new Date('2026-08-11T00:00:00Z'),
    });
    await attachPerson(hit, grandma);

    const res = await getFeed(alice.token, `?person_id=${grandma}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);
    expect(res.body.moments[0].persons.some((p: { id: string }) => p.id === grandma)).toBe(true);

    const other = await getFeed(alice.token, `?person_id=${foreign}`);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ moments: [], nextCursor: null });

    const missing = await getFeed(alice.token, '?person_id=00000000-0000-4000-8000-000000000099');
    expect(missing.status).toBe(200);
    expect(missing.body.moments).toEqual([]);
  });

  it('place 整串相等；子串 朝阳 打不中 朝阳公园', async () => {
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
    await setPlace(park, '朝阳公园');
    await setPlace(other, '奥林匹克公园');

    const exact = await getFeed(owner.token, `?place=${encodeURIComponent('朝阳公园')}`);
    expect(exact.status).toBe(200);
    expect(ids(exact)).toEqual([park]);

    const sub = await getFeed(owner.token, `?place=${encodeURIComponent('朝阳')}`);
    expect(sub.status).toBe(200);
    expect(sub.body.moments).toEqual([]);
  });

  it('happened_from/to 闭区间；与 tag_id/before AND', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const tagRes = await request(app)
      .post(`/api/chains/${chainId}/tags`)
      .set(auth(owner.token))
      .send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;
    const personId = await insertPerson({ chainId, name: '朵朵' });

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
    await seed('2026-08-10T00:00:00.000Z', { tag: true, place: '朝阳公园' });
    await seed('2026-08-10T00:00:00.000Z', { person: true, place: '朝阳公园' });
    await seed('2026-08-10T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '奥林匹克公园',
    });
    await seed('2026-08-15T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });
    await seed('2026-08-20T00:00:00.000Z', {
      person: true,
      tag: true,
      place: '朝阳公园',
    });

    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-08-31T23:59:59.999Z');
    const before = encodeURIComponent('2026-08-15T00:00:00.000Z');
    const res = await getFeed(
      owner.token,
      `?person_id=${personId}&tag_id=${tagId}&place=${encodeURIComponent('朝阳公园')}&happened_from=${from}&happened_to=${to}&before=${before}`,
    );
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);
  });

  it('happened_from/to + order=created_at → 400 RANGE_REQUIRES_HAPPENED_AT（信封仍 VALIDATION_ERROR）', async () => {
    const owner = await registerUser();
    await createChain(owner.id);
    const from = encodeURIComponent('2026-08-01T00:00:00.000Z');
    const res = await getFeed(owner.token, `?order=created_at&happened_from=${from}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(issueMessages(res)).toContain('RANGE_REQUIRES_HAPPENED_AT');

    const onlyTo = await getFeed(
      owner.token,
      `?order=created_at&happened_to=${encodeURIComponent('2026-08-31T00:00:00.000Z')}`,
    );
    expect(onlyTo.status).toBe(400);
    expect(issueMessages(onlyTo)).toContain('RANGE_REQUIRES_HAPPENED_AT');

    const before = await getFeed(
      owner.token,
      `?order=created_at&before=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
    );
    expect(before.status).toBe(400);
    expect(issueMessages(before)).toContain('BEFORE_REQUIRES_HAPPENED_AT');
    expect(issueMessages(before)).not.toContain('RANGE_REQUIRES_HAPPENED_AT');
  });

  it('happened_from > happened_to 用 Date.parse，带偏移不靠字典序', async () => {
    const owner = await registerUser();
    await createChain(owner.id);

    const ok = await getFeed(
      owner.token,
      `?happened_from=${encodeURIComponent('2026-08-01T00:00:00+08:00')}&happened_to=${encodeURIComponent('2026-07-31T23:00:00Z')}`,
    );
    expect(ok.status).toBe(200);

    const bad = await getFeed(
      owner.token,
      `?happened_from=${encodeURIComponent('2026-08-02T00:00:00.000Z')}&happened_to=${encodeURIComponent('2026-08-01T00:00:00.000Z')}`,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      (bad.body.error.details as { message: string; path: unknown[] }[]).some(
        (i) => i.message === 'VALIDATION_ERROR' && i.path[0] === 'happened_to',
      ),
    ).toBe(true);
  });

  it('非法 person_id → 400 VALIDATION_ERROR；chip GET 游标仍是 {h,i} 不是 {d,i}', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const personId = await insertPerson({ chainId, name: '外婆' });
    const same = new Date('2026-08-10T00:00:00Z');
    const a = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    const b = await insertMoment({ chainId, authorId: owner.id, happenedAt: same });
    await attachPerson(a, personId);
    await attachPerson(b, personId);

    const nope = await getFeed(owner.token, '?person_id=nope');
    expect(nope.status).toBe(400);
    expect(nope.body.error.code).toBe('VALIDATION_ERROR');

    const p1 = await getFeed(owner.token, `?person_id=${personId}&limit=1`);
    expect(p1.status).toBe(200);
    expect(p1.body.moments).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const raw = JSON.parse(Buffer.from(p1.body.nextCursor as string, 'base64url').toString('utf8')) as {
      h?: unknown;
      c?: unknown;
      d?: unknown;
      i?: unknown;
    };
    expect(typeof raw.h).toBe('number');
    expect(typeof raw.i).toBe('string');
    expect(raw.d).toBeUndefined();
    expect(raw.c).toBeUndefined();
  });

  it('viewer 成员可过滤；未登录 401', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    const personId = await insertPerson({ chainId, name: '外婆' });
    const hit = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await attachPerson(hit, personId);

    const res = await getFeed(viewer.token, `?person_id=${personId}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([hit]);

    const anon = await request(app).get(`/api/feed?person_id=${personId}`);
    expect(anon.status).toBe(401);
  });
});
