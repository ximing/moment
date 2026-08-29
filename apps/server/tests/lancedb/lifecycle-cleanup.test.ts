import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { listVectorsByMomentId, upsertMomentVector } from '../../src/lancedb/repository.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { insertMoment } from '../helpers/fixtures.js';

const app = listenLocal(createApp());

beforeAll(async () => {
  await ensureLance();
});
beforeEach(async () => {
  await resetDb();
  await resetLanceForTests();
});
afterAll(async () => {
  await closeLanceForTests();
  await closeDb();
});

describe('软删 / 链删清 Lance（spec §1；server 直连，不经 BA）', () => {
  it('DELETE /api/moments/:id 提交后该 momentId 向量为空', async () => {
    const alice = await createUser(app, 'alice');
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment({
      chainId,
      authorId: alice.id,
      happenedAt: new Date(),
      content: '待删',
    });
    await upsertMomentVector({
      momentId,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    expect(await listVectorsByMomentId(momentId)).toHaveLength(1);

    const res = await request(app).delete(`/api/moments/${momentId}`).set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(await listVectorsByMomentId(momentId)).toEqual([]);
  });

  it('DELETE /api/chains/:id 提交后该 chain 下向量为空', async () => {
    const alice = await createUser(app, 'alice-chain');
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment({
      chainId,
      authorId: alice.id,
      happenedAt: new Date(),
      content: '链内',
    });
    await upsertMomentVector({
      momentId,
      chainId,
      kind: 'moment',
      vector: denseVector(0.4),
      modelHash: HEX64_A,
    });

    const res = await request(app).delete(`/api/chains/${chainId}`).set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(await listVectorsByMomentId(momentId)).toEqual([]);
  });
});
