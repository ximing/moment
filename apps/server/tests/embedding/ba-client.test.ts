import nock from 'nock';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import {
  BA_HTTP_TIMEOUT_MS,
  deleteInternalEmbeddings,
  upsertInternalEmbedding,
} from '../../src/embedding/ba-client.js';
import { config } from '../../src/config.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';
const origin = new URL(config.INTERNAL_API_BASE_URL);

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  setBaAuthTokenForTests(undefined);
});

describe('ba-client（spec §6.3 worker fetch，10s abort）', () => {
  it('常量 10s；DELETE/POST 带 Bearer，body 形状锁定', async () => {
    expect(BA_HTTP_TIMEOUT_MS).toBe(10_000);
    setBaAuthTokenForTests('ba-secret');
    const vec = [0.1, 0.2];
    nock(`${origin.protocol}//${origin.host}`)
      .delete(`/api/internal/embeddings/${MOMENT}`)
      .matchHeader('Authorization', 'Bearer ba-secret')
      .reply(200, { deleted: 2 });
    nock(`${origin.protocol}//${origin.host}`)
      .post('/api/internal/embeddings', (body) => {
        expect(body).toEqual({
          momentId: MOMENT,
          chainId: CHAIN,
          kind: 'moment',
          vector: vec,
          modelHash: 'a'.repeat(64),
        });
        expect(body.mediaId).toBeUndefined();
        return true;
      })
      .matchHeader('Authorization', 'Bearer ba-secret')
      .reply(200, { ok: true });

    expect(await deleteInternalEmbeddings(MOMENT)).toBe(2);
    await upsertInternalEmbedding({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: vec,
      modelHash: 'a'.repeat(64),
    });
  });

  it('kind=image 带 mediaId；非 2xx throw（可重试，不是 NonRetryableEmbeddingError）', async () => {
    setBaAuthTokenForTests('t');
    nock(`${origin.protocol}//${origin.host}`)
      .post('/api/internal/embeddings', (body) => {
        expect(body.kind).toBe('image');
        expect(body.mediaId).toBe(MEDIA);
        return true;
      })
      .reply(503, { error: { code: 'DOWN' } });
    await expect(
      upsertInternalEmbedding({
        momentId: MOMENT,
        chainId: CHAIN,
        kind: 'image',
        mediaId: MEDIA,
        vector: [1],
        modelHash: 'b'.repeat(64),
      }),
    ).rejects.toThrow(/BA HTTP 503/);
  });
});
