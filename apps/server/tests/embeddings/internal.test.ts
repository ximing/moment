import request from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { closeLanceForTests, ensureLance, isLanceReady, resetLanceForTests } from '../../src/lancedb/factory.js';
import { listVectorsByMomentId } from '../../src/lancedb/repository.js';
import { closeDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';
const TOKEN = 'ba-test-token-32bytes-minimum-ok';

const app = listenLocal(createApp());

afterAll(async () => {
  setBaAuthTokenForTests(undefined);
  await closeLanceForTests();
  await closeDb();
});

function body(over: Record<string, unknown> = {}) {
  return {
    momentId: MOMENT,
    chainId: CHAIN,
    kind: 'moment',
    vector: denseVector(0.11),
    modelHash: HEX64_A,
    ...over,
  };
}

describe('createApp 不 connect Lance（spec §1 / §9）', () => {
  it('close 之后 createApp 保持 isLanceReady=false', async () => {
    await closeLanceForTests();
    expect(isLanceReady()).toBe(false);
    createApp();
    expect(isLanceReady()).toBe(false);
  });
});

describe('BA 未配置 → 401 BA_NOT_CONFIGURED', () => {
  beforeEach(() => setBaAuthTokenForTests(''));

  it('无头 / 带 Bearer 都是同一 code（不探测开关）', async () => {
    const a = await request(app).post('/api/internal/embeddings').send(body());
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe('BA_NOT_CONFIGURED');
    expect(a.body.error).not.toHaveProperty('configured');
    const b = await request(app).post('/api/internal/embeddings').set('Authorization', `Bearer ${TOKEN}`).send(body());
    expect(b.status).toBe(401);
    expect(b.body.error.code).toBe('BA_NOT_CONFIGURED');
  });
});

describe('BA 已配置 HTTP（spec §6.3 / §9）', () => {
  beforeAll(async () => {
    await ensureLance();
  });
  beforeEach(async () => {
    setBaAuthTokenForTests(TOKEN);
    await resetLanceForTests();
  });
  afterEach(() => setBaAuthTokenForTests(undefined));

  it('错/缺 token → 401 BA_AUTH_INVALID', async () => {
    const missing = await request(app).post('/api/internal/embeddings').send(body());
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('BA_AUTH_INVALID');
    const wrong = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', 'Bearer nope')
      .send(body());
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('BA_AUTH_INVALID');
  });

  it('vector 长度 ≠ dim → 400 EMBEDDING_DIM_MISMATCH', async () => {
    const res = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ vector: [1, 2, 3] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMBEDDING_DIM_MISMATCH');
    expect(config.MULTIMODAL_EMBEDDING_DIMENSION).not.toBe(3);
  });

  it('kind=image 缺 mediaId → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ kind: 'image' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('合法 Bearer upsert 200 {ok:true} 幂等；DELETE 清空；非 uuid 400', async () => {
    const post = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body());
    expect(post.status).toBe(200);
    expect(post.body).toEqual({ ok: true });

    const again = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ vector: denseVector(0.5) }));
    expect(again.status).toBe(200);

    const img = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ kind: 'image', mediaId: MEDIA, vector: denseVector(0.7) }));
    expect(img.status).toBe(200);
    expect(await listVectorsByMomentId(MOMENT)).toHaveLength(2);

    const del = await request(app)
      .delete(`/api/internal/embeddings/${MOMENT}`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: 2 });
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);

    const bad = await request(app)
      .delete('/api/internal/embeddings/not-a-uuid')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
