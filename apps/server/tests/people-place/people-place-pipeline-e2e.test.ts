import { jest } from '@jest/globals';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, outbox, persons as personsTable } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { runExtractBackfillSweep } from '../../src/worker/extract-backfill.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { app, insertMoment } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

let storage: MockStorage;
let owner: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  owner = await createUser(app, 'alice');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setLLMProvider(undefined);
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** mock LLM provider（P4 范式）：chat 返回抽取 JSON，记录调用次数。 */
function llmReturning(personNames: string[], placeNames: string[], counter?: { calls: number }): LLMProvider {
  return {
    async chat() {
      if (counter) counter.calls += 1;
      return {
        content: JSON.stringify({ persons: personNames, places: placeNames }),
        model: 'mock-model',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

/** 走真实接口造一条 ready audio media（presign → complete），对齐 create-voice-moment.test.ts 的 readyMedia。 */
async function readyAudio(token: string): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set(authHeader(token))
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12 });
  expect(presigned.status).toBe(201);
  storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
  const complete = await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set(authHeader(token))
    .send({});
  expect(complete.status).toBe(200);
  return presigned.body.mediaId as string;
}

describe('voice 时刻 transcribe → extract 全链路（spec §5 voice 独立触发）', () => {
  it('HTTP 建带 audio 的 voice moment → 转写 mock 回填 → 抽取 mock 落库 + hash 幂等（两批消费，终态与行序无关）', async () => {
    const chainId = await createChainWithMembers(owner.id);
    const audioId = await readyAudio(owner.token);
    // transcribe 链路的两个远端 IO：存储预签名 URL（mock storage）+ 拉音频字节（mock fetch）
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider({ transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) } satisfies ASRProvider);
    const llmCalls = { calls: 0 };
    setLLMProvider(llmReturning(['朵朵', '外婆'], ['外婆家'], llmCalls));

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(authHeader(owner.token))
      .send({
        type: 'voice',
        content: '',
        happenedAt: '2026-08-23T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [audioId],
      });
    expect(created.status).toBe(201);
    expect(created.body.transcriptionStatus).toBe('pending');
    expect(created.body.persons).toEqual([]); // 建时刻无人物；抽取是异步补缺
    const momentId = created.body.id as string;

    // 第一批：moment.created → moment.transcribe（转写回填 + 同事务补发 extract）→ create 时的 moment.extract。
    // 行内处理顺序不保证（见计划偏差 4），两条路径终态收敛。
    const first = await runOutboxBatch({ push: mockPush });
    expect(first.done).toBeGreaterThanOrEqual(3);
    expect(first.failed).toBe(0);

    const [afterFirst] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(afterFirst.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(afterFirst.transcriptionStatus).toBe('done');

    // 第二批：transcribe 补发的 moment.extract 行 → 消费终态（先行路径：完成抽取；后行路径：hash 短路 no-op）
    const second = await runOutboxBatch({ push: mockPush });
    expect(second.done).toBeGreaterThanOrEqual(1);
    expect(second.failed).toBe(0);
    // 无论行序，LLM 恰好被调用一次（hash 幂等：同内容二投不重抽，spec §5）
    expect(llmCalls.calls).toBe(1);

    // 落库断言：词典两行 + ai 关联两行 + place 全空填文本名 + hash 写回（P4 唯一实现同源计算）
    const dict = await db.select().from(personsTable).where(eq(personsTable.chainId, chainId));
    // 名顺序与 LLM 输出/词典 upsert 顺序无关（计划偏差 4：断言只写终态，两序均绿）；
    // 不用默认 .sort() 比较定序数组——'外'(U+5916) < '朵'(U+6735) 使 ['朵朵','外婆'].sort() === ['外婆','朵朵']
    expect(dict).toHaveLength(2);
    expect(dict.map((p) => p.name)).toEqual(expect.arrayContaining(['朵朵', '外婆']));
    const links = await db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeName).toBe('外婆家');
    expect(m.placeSource).toBe('ai');
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.aiExtractHash).toBe(computeAiExtractHash('今天带朵朵去外婆家吃饭', '今天带朵朵去外婆家吃饭'));

    // 响应回读：voice 时刻主素材（transcript）确实进了抽取管线
    const detail = await request(app).get(`/api/moments/${momentId}`).set(authHeader(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(detail.body.persons).toHaveLength(2);
    expect(detail.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'ai' });
  });
});

describe('回填 sweep 测试库演练（spec §5 存量回填 / §9「回填 sweep 幂等二跑」/ §11 P7）', () => {
  it('存量时刻分批派发 → mock LLM 消费写 hash → 二跑幂等（dispatched=0、无新行）', async () => {
    const chainId = await createChainWithMembers(owner.id);
    // 存量：2 条有素材未抽取（hash NULL）+ 1 条已抽取（hash 非空，扫描判据天然排除）
    const m1 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z'), content: '在外婆家第一天',
    });
    const m2 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-02T00:00:00Z'), content: '朵朵学会了走路',
    });
    const m3 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-03T00:00:00Z'), content: '已抽取过的存量',
    });
    await db.update(moments).set({ aiExtractHash: 'a'.repeat(64) }).where(eq(moments.id, m3));

    // sweep 只判 provider 非 null（占位 provider，不调 chat——对齐 P4 extract-backfill.test 范式）
    setLLMProvider({} as unknown as LLMProvider);
    const first = await runExtractBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(first.dispatched).toBe(2);

    // 常驻 worker 消费（mock LLM 真实抽取落库）
    setLLMProvider(llmReturning(['外婆'], []));
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(2);
    expect(batch.failed).toBe(0);
    for (const id of [m1, m2]) {
      const [row] = await db
        .select({ aiExtractHash: moments.aiExtractHash })
        .from(moments)
        .where(eq(moments.id, id));
      expect(row.aiExtractHash).not.toBeNull();
    }

    // 二跑幂等：hash 判据排除已抽取行 → dispatched=0、无新 outbox 行（既有行全部 done）
    setLLMProvider({} as unknown as LLMProvider);
    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    const extractRows = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(extractRows).toHaveLength(2);
    expect(extractRows.every((r) => r.status === 'done')).toBe(true);
  });
});
