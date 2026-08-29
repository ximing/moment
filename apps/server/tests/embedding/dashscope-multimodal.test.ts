import { createHash } from 'node:crypto';
import nock from 'nock';
import {
  EMBEDDING_TIMEOUT_MS,
  MULTIMODAL_EMBEDDING_PATH,
  NonRetryableEmbeddingError,
  RetryableEmbeddingError,
  computeEmbeddingModelHash,
} from '../../src/embedding/base.provider.js';
import { DashScopeMultimodalProvider } from '../../src/embedding/dashscope-multimodal.provider.js';

const HOST = 'https://dashscope.aliyuncs.com';
const PATH = '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const DIM = 8;
const VEC = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const DATA_URI = 'data:image/webp;base64,AAAA';

const opts = {
  baseUrl: `${HOST}/api/v1`,
  apiKey: 'sk-test',
  model: 'qwen3-vl-embedding',
  dimension: DIM,
  outputType: 'dense',
  timeoutMs: 200,
};

function replyOk(embedding: number[] = VEC) {
  return { output: { embeddings: [{ index: 0, embedding }] }, request_id: 'r1' };
}

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('NonRetryableEmbeddingError name（P1 processor 只认 error.name）', () => {
  it('钉死字符串', () => {
    const err = new NonRetryableEmbeddingError('EMBEDDING_DIM_MISMATCH');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NonRetryableEmbeddingError');
    expect(err.message).toBe('EMBEDDING_DIM_MISMATCH');
    expect(new RetryableEmbeddingError('x').name).toBe('RetryableEmbeddingError');
    expect(EMBEDDING_TIMEOUT_MS).toBe(20_000);
    expect(MULTIMODAL_EMBEDDING_PATH).toBe(
      '/services/embeddings/multimodal-embedding/multimodal-embedding',
    );
  });
});

describe('computeEmbeddingModelHash', () => {
  it('sha256(model:dim:outputType) 64 hex', () => {
    const expectHex = createHash('sha256').update('qwen3-vl-embedding:2560:dense').digest('hex');
    expect(computeEmbeddingModelHash('qwen3-vl-embedding', 2560, 'dense')).toBe(expectHex);
    expect(expectHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DashScopeMultimodalProvider.embed（spec §4.1；nock 钉 JSON）', () => {
  it('text-only：parameters 无 enable_fusion；Bearer；返回向量', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .matchHeader('Authorization', 'Bearer sk-test')
      .reply(200, replyOk());

    const out = await new DashScopeMultimodalProvider(opts).embed({ text: '外婆家' });
    expect(out).toEqual(VEC);
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '外婆家' }] },
      parameters: { dimension: DIM, output_type: 'dense' },
    });
    expect((captured as { parameters: Record<string, unknown> }).parameters.enable_fusion).toBeUndefined();
  });

  it('image-only：contents[{image:data URI}]，无 enable_fusion', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .reply(200, replyOk());

    await new DashScopeMultimodalProvider(opts).embed({ imageDataUri: DATA_URI });
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ image: DATA_URI }] },
      parameters: { dimension: DIM, output_type: 'dense' },
    });
  });

  it('vl：parameters.enable_fusion=true（官方 HTTP 放 parameters 内）', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .reply(200, replyOk());

    await new DashScopeMultimodalProvider(opts).embed({ text: '正文', imageDataUri: DATA_URI });
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '正文' }, { image: DATA_URI }] },
      parameters: { dimension: DIM, output_type: 'dense', enable_fusion: true },
    });
  });

  it('两者都缺 → NonRetryableEmbeddingError EMPTY_EMBEDDING_REQUEST；零 HTTP', async () => {
    expect(nock.pendingMocks()).toEqual([]);
    await expect(new DashScopeMultimodalProvider(opts).embed({})).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
      message: 'EMPTY_EMBEDDING_REQUEST',
    });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('429/5xx/网络/超时 → RetryableEmbeddingError', async () => {
    nock(HOST).post(PATH).reply(429, { message: 'rate' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(503, { message: 'down' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).replyWithError({ code: 'ECONNRESET', message: 'reset' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).delayConnection(500).reply(200, replyOk());
    await expect(
      new DashScopeMultimodalProvider({ ...opts, timeoutMs: 50 }).embed({ text: 'a' }),
    ).rejects.toMatchObject({ name: 'RetryableEmbeddingError' });
  });

  it('4xx 其它 / 缺 embeddings / 维数不符 → NonRetryableEmbeddingError', async () => {
    nock(HOST).post(PATH).reply(400, { code: 'InvalidParameter' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(200, { output: { embeddings: [] } });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(200, replyOk([0.1, 0.2]));
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });
  });

  it('modelHash / dimensions 来自构造参数', () => {
    const p = new DashScopeMultimodalProvider(opts);
    expect(p.dimensions()).toBe(DIM);
    expect(p.modelHash()).toBe(computeEmbeddingModelHash('qwen3-vl-embedding', DIM, 'dense'));
  });
});
