import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { MAX_AUDIO_BYTES } from '@moment/dto';
import { db } from '../../src/db/index.js';
import { chains, media, moments, notifications, users } from '../../src/db/schema.js';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';

const mockSend = jest.fn();
const mockPush = { send: mockSend } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  mockSend.mockClear();
  installMockStorage(); // generateAccessUrl 返回假 URL；真实下载由 stubAudioDownload 接管
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

/** 下载桩：fetch 返回指定字节数的音频对象。 */
function stubAudioDownload(bytes: number): void {
  globalThis.fetch = (async () => new Response(new Uint8Array(bytes))) as typeof fetch;
}

function asrReturning(text: string): ASRProvider {
  return { transcribe: async () => ({ text }) };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 直插 voice moment（默认 pending + 1 条 ready audio 行）。 */
async function insertVoice(opts?: {
  content?: string;
  status?: 'pending' | 'done' | 'failed' | null;
  type?: 'voice' | 'text';
  deletedAt?: Date | null;
  withAudio?: boolean;
}): Promise<{ momentId: string; audioId: string | null }> {
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
    type: opts?.type ?? 'voice',
    content: opts?.content ?? '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: opts?.status === undefined ? 'pending' : opts.status,
    deletedAt: opts?.deletedAt ?? null,
  });
  let audioId: string | null = null;
  if (opts?.withAudio !== false) {
    audioId = randomUUID();
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
  }
  return { momentId, audioId };
}

describe('handleMomentTranscribe（spec voice-moment §4.3）', () => {
  it('成功：单事务落 transcript + done，空 content 条件回填且不发通知', async () => {
    const storage = installMockStorage();
    const { momentId, audioId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning('宝宝第一次叫奶奶'));

    await handleMomentTranscribe({ momentId }, { push: mockPush });

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBe('宝宝第一次叫奶奶');
    expect(m.transcriptionStatus).toBe('done');
    expect(m.content).toBe('宝宝第一次叫奶奶');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      expect.stringContaining(audioId!),
      {},
      300,
    );
    expect(await db.select().from(notifications)).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("用户已编辑 content → 不覆盖（WHERE content='' 条件回填），transcript 仍落原文", async () => {
    const { momentId } = await insertVoice({ content: '手动修正' });
    stubAudioDownload(100);
    setASRProvider(asrReturning('ASR 原文'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.content).toBe('手动修正');
    expect(m.transcript).toBe('ASR 原文');
    expect(m.transcriptionStatus).toBe('done');
  });

  describe('ASR IO 期间的并发终态防御', () => {
    it('并发置 failed 后，迟到转写不覆盖终态或正文', async () => {
      const { momentId } = await insertVoice();
      stubAudioDownload(100);
      const started = deferred<void>();
      const result = deferred<{ text: string }>();
      setASRProvider({
        transcribe: async () => {
          started.resolve();
          return result.promise;
        },
      });

      const handling = handleMomentTranscribe({ momentId }, { push: mockPush });
      await started.promise;
      await db
        .update(moments)
        .set({ transcriptionStatus: 'failed' })
        .where(eq(moments.id, momentId));
      result.resolve({ text: '迟到转写' });
      await handling;

      const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
      expect(m.transcriptionStatus).toBe('failed');
      expect(m.transcript).toBeNull();
      expect(m.content).toBe('');
    });

    it('并发软删后，迟到转写不写终态、原文或正文', async () => {
      const { momentId } = await insertVoice();
      stubAudioDownload(100);
      const started = deferred<void>();
      const result = deferred<{ text: string }>();
      setASRProvider({
        transcribe: async () => {
          started.resolve();
          return result.promise;
        },
      });

      const handling = handleMomentTranscribe({ momentId }, { push: mockPush });
      await started.promise;
      const deletedAt = new Date();
      await db.update(moments).set({ deletedAt }).where(eq(moments.id, momentId));
      result.resolve({ text: '迟到转写' });
      await handling;

      const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
      expect(m.deletedAt).not.toBeNull();
      expect(m.transcriptionStatus).toBe('pending');
      expect(m.transcript).toBeNull();
      expect(m.content).toBe('');
    });

    it('重复 handler 并发成功时，先完成的转写胜出，迟到结果不覆盖', async () => {
      const { momentId } = await insertVoice();
      stubAudioDownload(100);
      const bothStarted = deferred<void>();
      const results = [deferred<{ text: string }>(), deferred<{ text: string }>()];
      let calls = 0;
      setASRProvider({
        transcribe: async () => {
          const call = calls++;
          if (calls === 2) bothStarted.resolve();
          return results[call].promise;
        },
      });

      const firstHandler = handleMomentTranscribe({ momentId }, { push: mockPush });
      const secondHandler = handleMomentTranscribe({ momentId }, { push: mockPush });
      await bothStarted.promise;
      results[0].resolve({ text: '先完成' });
      await Promise.race([firstHandler, secondHandler]);
      results[1].resolve({ text: '迟到结果' });
      await Promise.all([firstHandler, secondHandler]);

      const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
      expect(m.transcriptionStatus).toBe('done');
      expect(m.transcript).toBe('先完成');
      expect(m.content).toBe('先完成');
    });
  });

  it('空文本（笑声/环境音）→ done，transcript 存空串', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning(''));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('done');
    expect(m.transcript).toBe('');
    expect(m.content).toBe('');
  });

  it('超长转写截断到 5000 字符（对齐 dto content max(5000)，worker 回填绕过 API 校验）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning('x'.repeat(6000)));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toHaveLength(5000);
    expect(m.content).toHaveLength(5000);
    expect(m.transcriptionStatus).toBe('done');
  });

  it('RetryableLLMError → 传播（processor 退避），状态保持 pending', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider({
      transcribe: async () => {
        throw new RetryableLLMError('ASR 429');
      },
    });
    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('pending');
  });

  it('NonRetryableLLMError → 自落 failed 后正常返回（不占退避额度）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider({
      transcribe: async () => {
        throw new NonRetryableLLMError('ASR 400', 400);
      },
    });
    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).resolves.toBeUndefined();
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('其他异常 → 传播给 processor，状态保持 pending', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider({
      transcribe: async () => {
        throw new Error('unexpected provider failure');
      },
    });
    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toThrow(
      'unexpected provider failure',
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('pending');
  });

  it('getASRProvider() === null（部署方停用）→ 落 failed 正常返回（spec §0 停用形态）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(null);
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('无 audio 行（异常态）→ 落 failed', async () => {
    const { momentId } = await insertVoice({ withAudio: false });
    setASRProvider(asrReturning('不应被调用'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('下载非 2xx → 抛给 processor 重试，状态保持 pending', async () => {
    const { momentId } = await insertVoice();
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    setASRProvider(asrReturning('不应被调用'));

    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toThrow(
      'audio download failed: 503',
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('pending');
  });

  describe('音频下载有界读取', () => {
    it('Content-Length 已超限 → 不读取响应体，直接落 failed 且不调用 ASR', async () => {
      const { momentId } = await insertVoice();
      const response = new Response(null, {
        headers: { 'content-length': String(MAX_AUDIO_BYTES + 1) },
      });
      const arrayBuffer = jest.spyOn(response, 'arrayBuffer');
      globalThis.fetch = (async () => response) as typeof fetch;
      const transcribe = jest.fn<ASRProvider['transcribe']>().mockResolvedValue({ text: '不应被调用' });
      setASRProvider({ transcribe });

      await handleMomentTranscribe({ momentId }, { push: mockPush });

      const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
      expect(m.transcriptionStatus).toBe('failed');
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
    });

    it('无 Content-Length 的分块流累计超限 → 立即 cancel，未读完且不调用 ASR', async () => {
      const { momentId } = await insertVoice();
      const chunk = new Uint8Array(4 * 1024 * 1024);
      const totalChunks = 10;
      let pulls = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
          if (pulls === totalChunks) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      globalThis.fetch = (async () => new Response(body)) as typeof fetch;
      const transcribe = jest.fn<ASRProvider['transcribe']>().mockResolvedValue({ text: '不应被调用' });
      setASRProvider({ transcribe });

      await handleMomentTranscribe({ momentId }, { push: mockPush });

      const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
      expect(m.transcriptionStatus).toBe('failed');
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThan(totalChunks);
      expect(transcribe).not.toHaveBeenCalled();
    });
  });

  it('下载字节超 MAX_AUDIO_BYTES → 落 failed（行 size 与对象不符的防御，spec §4.3 步骤 4）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(MAX_AUDIO_BYTES + 1);
    setASRProvider(asrReturning('不应被调用'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('幂等守卫：不存在 / 已软删 / 非 pending / 非 voice 直接返回，不写任何状态', async () => {
    const deleted = await insertVoice({ deletedAt: new Date() });
    const done = await insertVoice({ status: 'done', content: 'x' });
    const text = await insertVoice({ type: 'text', status: null, content: 'hi' });
    setASRProvider(asrReturning('不应被调用'));
    await expect(
      handleMomentTranscribe({ momentId: randomUUID() }, { push: mockPush }),
    ).resolves.toBeUndefined();
    await handleMomentTranscribe({ momentId: deleted.momentId }, { push: mockPush });
    await handleMomentTranscribe({ momentId: done.momentId }, { push: mockPush });
    await handleMomentTranscribe({ momentId: text.momentId }, { push: mockPush });
    const rows = await db.select().from(moments);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(deleted.momentId).transcriptionStatus).toBe('pending');
    expect(by(done.momentId).transcriptionStatus).toBe('done');
    expect(by(text.momentId).transcriptionStatus).toBeNull();
  });
});
