import { randomUUID } from 'node:crypto';
import { searchMomentVectors, upsertMomentVector } from '../../src/lancedb/repository.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';

const CHAIN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHAIN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(ensureLance);
beforeEach(resetLanceForTests);
afterAll(closeLanceForTests);

describe('searchMomentVectors（spec §4.5）', () => {
  it('L2 近邻；where chainId；momentId 预过滤；非 uuid 丢弃', async () => {
    const near = randomUUID();
    const far = randomUUID();
    const otherChain = randomUUID();
    await upsertMomentVector({
      momentId: near,
      chainId: CHAIN_A,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: far,
      chainId: CHAIN_A,
      kind: 'moment',
      vector: denseVector(0.9),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: otherChain,
      chainId: CHAIN_B,
      kind: 'moment',
      vector: denseVector(0.01),
      modelHash: HEX64_A,
    });

    const all = await searchMomentVectors({
      vector: denseVector(0.01),
      chainIds: [CHAIN_A],
      limit: 200,
    });
    expect(new Set(all.map((r) => r.momentId))).toEqual(new Set([near, far]));
    const dNear = all.find((r) => r.momentId === near)!.distance;
    const dFar = all.find((r) => r.momentId === far)!.distance;
    expect(dNear).toBeLessThan(dFar);
    expect(all.every((r) => Number.isFinite(r.distance))).toBe(true);

    const pre = await searchMomentVectors({
      vector: denseVector(0.01),
      chainIds: [CHAIN_A],
      momentIds: [far],
      limit: 200,
    });
    expect(pre.map((r) => r.momentId)).toEqual([far]);

    expect(await searchMomentVectors({ vector: denseVector(0.01), chainIds: [], limit: 200 })).toEqual([]);
    expect(
      await searchMomentVectors({
        vector: denseVector(0.01),
        chainIds: [CHAIN_A],
        momentIds: ["x' OR 1=1"],
        limit: 200,
      }),
    ).toEqual([]);
  });

  it('limit 截断为传入值（窗口=200 由调用方传 VECTOR_CANDIDATE_LIMIT，禁止内部改成 limit*3）', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertMomentVector({
        momentId: randomUUID(),
        chainId: CHAIN_A,
        kind: 'moment',
        vector: denseVector(0.01 * (i + 1)),
        modelHash: HEX64_A,
      });
    }
    const rows = await searchMomentVectors({ vector: denseVector(0.01), chainIds: [CHAIN_A], limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
