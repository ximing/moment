import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, momentPersons, moments, outbox, persons, users } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { RetryableLLMError, type LLMChatResponse, type LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentExtract, handleMomentTranscribe } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  installMockStorage();
  setEmbeddingProvider(null);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setLLMProvider(undefined);
  setASRProvider(undefined);
  setStorageAdapter(null);
  setEmbeddingProvider(undefined);
});
afterAll(closeDb);

const DEFAULT_CONTENT = '今天在外婆家和朵朵玩，去了朝阳公园';

/** mock LLM：chat 返回指定 persons/places 的 JSON，记录调用次数。
 *  参数名用 personNames/placeNames——避免与 schema 表 `persons` 的 import 遮蔽（eslint no-shadow）。 */
function llmReturning(
  personNames: string[],
  placeNames: string[],
  counter?: { calls: number },
): LLMProvider {
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

/** 造一条 moment（默认有正文素材、hash NULL、place 全空）。 */
async function seedMoment(opts?: {
  content?: string;
  transcript?: string | null;
  deletedAt?: Date | null;
  placeLat?: number | null;
  placeLng?: number | null;
  placeName?: string | null;
  placeSource?: 'manual' | 'exif' | 'ai' | null;
}): Promise<{ momentId: string; chainId: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-20T10:00:00Z'),
    content: opts?.content ?? DEFAULT_CONTENT,
  });
  await db
    .update(moments)
    .set({
      transcript: opts?.transcript === undefined ? null : opts.transcript,
      deletedAt: opts?.deletedAt ?? null,
      placeLat: opts?.placeLat === undefined ? null : opts.placeLat,
      placeLng: opts?.placeLng === undefined ? null : opts.placeLng,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      placeSource: opts?.placeSource === undefined ? null : opts.placeSource,
    })
    .where(eq(moments.id, momentId));
  return { momentId, chainId };
}

async function momentRow(momentId: string) {
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
  return m;
}

async function linkRows(momentId: string) {
  return db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 直插 voice moment（pending + 1 条 ready audio），镜像 handle-moment-transcribe.test.ts。 */
async function insertVoice(): Promise<string> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: 'voice',
    content: '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: 'pending',
  });
  const audioId = randomUUID();
  await db.insert(media).values({
    id: audioId,
    momentId,
    uploaderId: userId,
    s3Key: `chains/${chainId}/${momentId}/${audioId}.wav`,
    mime: 'audio/wav',
    size: 1024,
    duration: 12,
    status: 'ready',
    storageMeta: {},
  });
  return momentId;
}

describe('handleMomentExtract（spec people-place §5）', () => {
  it('成功：词典 upsert 两行 + moment_persons 两行 source=ai + place 填 places[0]（source=ai 无坐标）+ hash 写回', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆', '朵朵'], ['朝阳公园']));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict.map((p) => p.name).sort()).toEqual(['外婆', '朵朵']);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const m = await momentRow(momentId);
    expect(m.placeName).toBe('朝阳公园');
    expect(m.placeSource).toBe('ai');
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.aiExtractHash).toBe(computeAiExtractHash(DEFAULT_CONTENT, null));
  });

  it('词典复用 + 名归一化：抽出名归一化后撞已有词典行 → 复用 id、不新建（spec §2/§5）', async () => {
    const { momentId, chainId } = await seedMoment();
    // 既有词典行名含单内部空格「王 叔叔」；LLM 抽出带多余空白的「  王   叔叔 」，
    // 经 normalizePersonName（trim + 折叠连续空白为单空格，spec §2）归一为「王 叔叔」→ 撞 uk 复用 id。
    const existingId = await insertPerson({ chainId, name: '王 叔叔' });
    setLLMProvider(llmReturning(['  王   叔叔  ', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict).toHaveLength(2); // 王叔叔复用 + 外婆新建
    const links = await linkRows(momentId);
    expect(links.map((l) => l.personId).sort()).toEqual([existingId, dict.find((p) => p.name === '外婆')!.id].sort());
  });

  it('仅补缺 / manual 不降级：已有 manual 行的 person 原行不动（source 保持 manual），只补 ai 行', async () => {
    const { momentId, chainId } = await seedMoment();
    const duoduoId = await insertPerson({ chainId, name: '朵朵' });
    await attachPerson(momentId, duoduoId, 'manual');
    setLLMProvider(llmReturning(['朵朵', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    const duoduo = links.find((l) => l.personId === duoduoId)!;
    expect(duoduo.source).toBe('manual'); // 不降级（spec §5 冲突规则）
    expect(links.find((l) => l.personId !== duoduoId)!.source).toBe('ai');
  });

  it('place 非空不覆盖：manual 名 / exif 坐标 / ai 已有名三种形态均不动（spec §5 冲突规则）', async () => {
    const manualNamed = await seedMoment({ placeName: '家', placeSource: 'manual' });
    const exifCoord = await seedMoment({ placeLat: 39.9042, placeLng: 116.4074, placeSource: 'exif' });
    const aiNamed = await seedMoment({ placeName: 'AI 上次抽的地名', placeSource: 'ai' });
    setLLMProvider(llmReturning(['外婆'], ['朝阳公园']));

    await handleMomentExtract({ momentId: manualNamed.momentId }, { push: mockPush });
    await handleMomentExtract({ momentId: exifCoord.momentId }, { push: mockPush });
    await handleMomentExtract({ momentId: aiNamed.momentId }, { push: mockPush });

    expect(await momentRow(manualNamed.momentId)).toMatchObject({ placeName: '家', placeSource: 'manual' });
    expect(await momentRow(exifCoord.momentId)).toMatchObject({ placeName: null, placeSource: 'exif' });
    expect(await momentRow(aiNamed.momentId)).toMatchObject({ placeName: 'AI 上次抽的地名', placeSource: 'ai' });
  });

  it('place 填充截断 255（worker 回填绕过 API 校验，对齐 P3 PLACE_NAME_MAX_CHARS 范式）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider(llmReturning([], ['长'.repeat(300)]));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const m = await momentRow(momentId);
    expect(m.placeName).toHaveLength(255);
    expect(m.placeName).toBe('长'.repeat(255));
  });

  it('hash 幂等：同内容二投 → 第二次消费短路，不再调 LLM、行集合不变（spec §5）', async () => {
    const { momentId } = await seedMoment();
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await handleMomentExtract({ momentId }, { push: mockPush });
    await handleMomentExtract({ momentId }, { push: mockPush }); // 同内容二投

    expect(counter.calls).toBe(1);
    expect(await linkRows(momentId)).toHaveLength(1);
  });

  it('LLM_API_KEY 空（provider null）→ 消费即跳过、不写 hash、不建词典（编排硬约束）', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(null);

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).resolves.toBeUndefined();

    const m = await momentRow(momentId);
    expect(m.aiExtractHash).toBeNull();
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
  });

  it('空素材（content 与 transcript 均空）→ 跳过、不写 hash、不调 LLM（偏差 6，对齐 sweep 素材判据）', async () => {
    const { momentId } = await seedMoment({ content: '' });
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).resolves.toBeUndefined();

    expect(counter.calls).toBe(0);
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('transcript 主素材：voice 时刻 content 空、transcript 非空 → 以 transcript 抽取，hash 覆盖两者', async () => {
    const { momentId } = await seedMoment({ content: '', transcript: '带朵朵去了外婆家' });
    setLLMProvider(llmReturning(['朵朵', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    expect(await linkRows(momentId)).toHaveLength(2);
    const m = await momentRow(momentId);
    expect(m.aiExtractHash).toBe(computeAiExtractHash('', '带朵朵去了外婆家'));
  });

  it('moment 不存在 / 已软删 → done 跳过，不调 LLM（worker 软删竞态，编排硬约束）', async () => {
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await expect(
      handleMomentExtract({ momentId: randomUUID() }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const deleted = await seedMoment({ deletedAt: new Date() });
    await handleMomentExtract({ momentId: deleted.momentId }, { push: mockPush });
    expect((await momentRow(deleted.momentId)).aiExtractHash).toBeNull();

    expect(counter.calls).toBe(0);
  });

  it('空抽取结果（persons/places 均空）→ 合法终态：写 hash、零副作用行', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning([], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    expect((await momentRow(momentId)).aiExtractHash).toBe(computeAiExtractHash(DEFAULT_CONTENT, null));
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
    expect(await linkRows(momentId)).toHaveLength(0);
    expect((await momentRow(momentId)).placeName).toBeNull();
  });

  it('复活语义（偏差 4）：删除后内容未变 → 不重抽、删除保持；内容变化 → 重抽复活为 ai 行', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆'], []));

    // 第一次抽取：外婆 ai 行 + hash 写回
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await linkRows(momentId)).toHaveLength(1);

    // 用户删除该 ai 行（PATCH personIds 全量替换路径的等效直删）
    await db.delete(momentPersons).where(eq(momentPersons.momentId, momentId));

    // 内容未变：再次消费 → hash 短路，行保持删除（spec §5「删除 ai 行后保持删除」）
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await linkRows(momentId)).toHaveLength(0);

    // 内容变化（等效 PATCH content + 新事件）：重抽 → 重新落库，复活为 ai 行（spec 接受的语义）
    await db.update(moments).set({ content: '又和外婆出门了' }).where(eq(moments.id, momentId));
    await handleMomentExtract({ momentId }, { push: mockPush });
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0].source).toBe('ai');
    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict).toHaveLength(1); // 词典行不重复建
    expect((await momentRow(momentId)).aiExtractHash).toBe(computeAiExtractHash('又和外婆出门了', null));
  });

  it('LLM IO 期间素材变化 → 落库事务丢弃本次结果：不写 hash、不落行（stale 防御，偏差 10）', async () => {
    const { momentId } = await seedMoment();
    const started = deferred<void>();
    const result = deferred<LLMChatResponse>();
    setLLMProvider({
      chat: async () => {
        started.resolve();
        return result.promise;
      },
    });

    const handling = handleMomentExtract({ momentId }, { push: mockPush });
    await started.promise;
    // LLM IO 期间用户改了正文（变化路径会发射新事件按新内容重抽）
    await db.update(moments).set({ content: '用户改了正文' }).where(eq(moments.id, momentId));
    result.resolve({
      content: JSON.stringify({ persons: ['外婆'], places: [] }),
      model: 'mock-model',
      usage: { prompt: 1, completion: 1, total: 2 },
    });
    await handling;

    expect(await linkRows(momentId)).toHaveLength(0); // stale 结果丢弃
    expect((await momentRow(momentId)).aiExtractHash).toBeNull(); // 不写 hash
  });

  it('provider 抛 RetryableLLMError → 原样传播（processor 退避），hash 不写（偏差 5）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new RetryableLLMError('LLM 429');
      },
    });

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
    expect(await linkRows(momentId)).toHaveLength(0);
  });
});

describe('runOutboxBatch × moment.extract（注册表分发 + 既有退避终败，spec §5/偏差 5）', () => {
  async function emitExtractRow(momentId: string, over: Partial<typeof outbox.$inferInsert> = {}) {
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.extract',
      payload: { momentId },
      status: 'pending',
      ...over,
    });
  }

  it('已注册分发：成功路径经默认 handlers 表落库（词典 + ai 行 + hash）', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆'], ['朝阳公园']));
    await emitExtractRow(momentId);

    const result = await runOutboxBatch({ push: mockPush }); // 默认 handlers → 证明注册表条目存在
    expect(result.done).toBe(1);
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(1);
    expect((await momentRow(momentId)).aiExtractHash).not.toBeNull();
  });

  it('失败退避：首败 attempts=1、仍 pending（既有指数退避）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new Error('LLM_DOWN');
      },
    });
    await emitExtractRow(momentId);

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.retried).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('终败：attempts=5 的行再失败 → status=failed、不重派、hash 不写（终败仅记日志，偏差 5）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new Error('LLM_STILL_DOWN');
      },
    });
    await emitExtractRow(momentId, { attempts: 5 });

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.failed).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('transcribe 回填 → extract 全链路：转写落库 + extract 行 → 消费后从 transcript 抽取人物（spec §5 voice 独立触发）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    const asr: ASRProvider = { transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) };
    setASRProvider(asr);
    setLLMProvider(llmReturning(['朵朵', '外婆'], ['外婆家']));

    // 转写回填（Task 3 的补发射在此刻产出 moment.extract 行）
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const events = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(events).toHaveLength(1);

    // 常驻 worker 消费该行 → 从 transcript 抽取落库
    const result = await runOutboxBatch({ push: mockPush });
    expect(result.done).toBe(2); // extract + transcribe 同事务补发的 embed（null provider → handler 跳过仍 done）
    expect(result.failed).toBe(0);

    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const m = await momentRow(momentId);
    expect(m.placeName).toBe('外婆家');
    expect(m.placeSource).toBe('ai');
    expect(m.aiExtractHash).toBe(computeAiExtractHash('今天带朵朵去外婆家吃饭', '今天带朵朵去外婆家吃饭'));
  });
});
