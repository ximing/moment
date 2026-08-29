import type { SearchInput, SearchParsed } from '@moment/dto';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { setPlace } from './helpers.js';
import { resolveSearchScope } from '../../src/search/resolve-scope.js';

beforeEach(resetDb);
afterAll(closeDb);

function parsed(over: Partial<SearchParsed> = {}): SearchParsed {
  return { personNames: [], place: null, time: null, text: '', ...over };
}

function input(userOver: Partial<SearchInput> = {}): SearchInput {
  return { q: '外婆', tzOffset: -480, ...userOver };
}

describe('resolveSearchScope（spec §3.2）', () => {
  it('chainIds 与 getMyChains 求交；他链静默丢弃', async () => {
    const alice = await registerUser();
    const carol = await registerUser();
    const a = await createChain(alice.id, 'A');
    const c = await createChain(carol.id, 'C');
    const r = await resolveSearchScope(alice.id, input({ chainIds: [a, c] }), parsed({ text: '野餐' }));
    expect(r.chainIds).toEqual([a]);
    expect(r.text).toBe('野餐');
    expect(r.parsed.text).toBe('野餐');
  });

  it('跨链同名：每链各自 id；链内两名 AND；缺名不加该名过滤', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    const gA = await insertPerson({ chainId: a, name: '外婆' });
    const dA = await insertPerson({ chainId: a, name: '朵朵' });
    const gB = await insertPerson({ chainId: b, name: '外婆' });
    const r = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['  外婆  ', '朵朵'] }),
    );
    expect(new Set(r.chainIds)).toEqual(new Set([a, b]));
    expect(r.personIdsByChain.get(a)?.sort()).toEqual([gA, dA].sort());
    expect(r.personIdsByChain.get(b)).toEqual([gB]); // 朵朵不在 B → 不加
  });

  it('丢链：人名非空且 0 命中且无其它约束 → 去掉该链；全丢则 chainIds=[]', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    await addMember(b, bob.id, 'viewer');
    await insertPerson({ chainId: a, name: '外婆' });
    await insertMoment({ chainId: b, authorId: alice.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const dropped = await resolveSearchScope(alice.id, input(), parsed({ personNames: ['外婆'] }));
    expect(dropped.chainIds).toEqual([a]);

    const none = await resolveSearchScope(alice.id, input({ chainIds: [b] }), parsed({ personNames: ['外婆'] }));
    expect(none.chainIds).toEqual([]);
  });

  it('有 time/硬 place/非空 text/body chip 则 0 命中人名的链仍保留（空 personIds）', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const b = await createChain(alice.id, 'B');
    await insertPerson({ chainId: a, name: '外婆' });
    const park = await insertMoment({
      chainId: b,
      authorId: alice.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await setPlace(park, '朝阳公园');

    const withText = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['外婆'], text: '野餐' }),
    );
    expect(new Set(withText.chainIds)).toEqual(new Set([a, b]));
    expect(withText.personIdsByChain.get(b)).toEqual([]);

    const withBodyPlace = await resolveSearchScope(
      alice.id,
      input({ place: '朝阳公园' }),
      parsed({ personNames: ['外婆'] }),
    );
    expect(new Set(withBodyPlace.chainIds)).toEqual(new Set([a, b]));

    const withTime = await resolveSearchScope(
      alice.id,
      input(),
      parsed({
        personNames: ['外婆'],
        time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      }),
    );
    expect(new Set(withTime.chainIds)).toEqual(new Set([a, b]));
    expect(withTime.wallDate).toBe('2025-08-29');
  });

  it('解析 place：scope 内零命中并入 text，不硬过滤；有命中则硬等值；body.place 不做零命中降级', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const m = await insertMoment({
      chainId: a,
      authorId: alice.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await setPlace(m, '朝阳公园');

    const miss = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ place: '不存在的地方', text: '' }),
    );
    expect(miss.place).toBeNull();
    expect(miss.text).toBe('不存在的地方');
    expect(miss.parsed.place).toBe('不存在的地方');
    expect(miss.parsed.text).toBe('');

    const hit = await resolveSearchScope(alice.id, input(), parsed({ place: '朝阳公园', text: '野餐' }));
    expect(hit.place).toBe('朝阳公园');
    expect(hit.text).toBe('野餐');

    const bodyMiss = await resolveSearchScope(
      alice.id,
      input({ place: '不存在的地方' }),
      parsed({ text: 'x' }),
    );
    expect(bodyMiss.place).toBe('不存在的地方');
    expect(bodyMiss.text).toBe('x');
  });

  it('解析 place trim 后截断 255；空白人名丢弃；normalize 折叠空白', async () => {
    const alice = await registerUser();
    const a = await createChain(alice.id, 'A');
    const id = await insertPerson({ chainId: a, name: '王 叔叔' });
    const r = await resolveSearchScope(
      alice.id,
      input(),
      parsed({ personNames: ['  ', '王   叔叔'] }),
    );
    expect(r.personIdsByChain.get(a)).toEqual([id]);

    const long = 'p'.repeat(300);
    const place = await resolveSearchScope(alice.id, input(), parsed({ place: `  ${long}  `, text: '' }));
    expect(place.text.length).toBe(255);
  });

  it('body 区间与解析 range 取交', async () => {
    const alice = await registerUser();
    await createChain(alice.id, 'A');
    const r = await resolveSearchScope(
      alice.id,
      input({
        happenedFrom: '2026-06-01T00:00:00.000Z',
        happenedTo: '2026-08-31T23:59:59.999Z',
      }),
      parsed({
        time: { kind: 'range', from: '2026-07-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' },
        text: 'x',
      }),
    );
    expect(r.happenedFrom).toBe('2026-07-01T00:00:00.000Z');
    expect(r.happenedTo).toBe('2026-08-31T23:59:59.999Z');
  });
});
