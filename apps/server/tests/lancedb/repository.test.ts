import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import {
  deleteVectorsByChainId,
  deleteVectorsByMomentId,
  listVectorsByMomentId,
  upsertMomentVector,
} from '../../src/lancedb/repository.js';
import { denseVector, HEX64_A, HEX64_B } from '../helpers/lance.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';

beforeAll(async () => {
  await ensureLance();
});
beforeEach(async () => {
  await resetLanceForTests();
});
afterAll(async () => {
  await closeLanceForTests();
});

function asNumbers(v: unknown): number[] {
  return Array.from(v as ArrayLike<number>);
}

describe('upsertMomentVector / deleteVectorsByMomentId', () => {
  it('kind=moment upsert 幂等：同 id 更新 vector/modelHash，list 仍一条', async () => {
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      mediaId: 'should-be-ignored',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.2),
      modelHash: HEX64_B,
    });
    const rows = await listVectorsByMomentId(MOMENT);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`moment:${MOMENT}`);
    expect(rows[0].kind).toBe('moment');
    expect(rows[0].mediaId).toBe('');
    expect(rows[0].chainId).toBe(CHAIN);
    expect(rows[0].modelHash).toBe(HEX64_B);
    expect(asNumbers(rows[0].vector)[0]).toBeCloseTo(0.2, 5);
    expect(asNumbers(rows[0].vector)).toHaveLength(denseVector().length);
  });

  it('kind=image 用 media:{mediaId}；同 moment 主向量+附图 DELETE 清空', async () => {
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'image',
      mediaId: MEDIA,
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    const before = await listVectorsByMomentId(MOMENT);
    expect(before.map((r) => r.id).sort()).toEqual([`media:${MEDIA}`, `moment:${MOMENT}`].sort());
    const deleted = await deleteVectorsByMomentId(MOMENT);
    expect(deleted).toBe(2);
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);
    expect(await deleteVectorsByMomentId(MOMENT)).toBe(0);
  });

  it('kind=image 缺 mediaId → VALIDATION_ERROR；非 uuid momentId 删除返回 0', async () => {
    await expect(
      upsertMomentVector({
        momentId: MOMENT,
        chainId: CHAIN,
        kind: 'image',
        vector: denseVector(0.1),
        modelHash: HEX64_A,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    expect(await deleteVectorsByMomentId("x' OR 1=1")).toBe(0);
    expect(await listVectorsByMomentId('not-a-uuid')).toEqual([]);
  });

  it('deleteVectorsByChainId 清该链全部 kind；非 uuid 返回 0', async () => {
    const m2 = '123e4567-e89b-12d3-a456-426614174099';
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: m2,
      chainId: CHAIN,
      kind: 'image',
      mediaId: MEDIA,
      vector: denseVector(0.2),
      modelHash: HEX64_A,
    });
    expect(await deleteVectorsByChainId(CHAIN)).toBe(2);
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);
    expect(await listVectorsByMomentId(m2)).toEqual([]);
    expect(await deleteVectorsByChainId("x' OR 1=1")).toBe(0);
  });
});
