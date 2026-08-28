import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, moments, outbox, users } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { RetryableLLMError } from '../../src/llm/base.provider.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  installMockStorage();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const baseBody = {
  type: 'text' as const,
  content: '在外婆家吃饭',
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

async function extractEvents() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
}

/** 直插 voice moment（pending + 1 条 ready audio），镜像 handle-moment-transcribe.test.ts 的 insertVoice。 */
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

function asrReturning(text: string): ASRProvider {
  return { transcribe: async () => ({ text }) };
}

describe('发射侧：moments create/update 的 hash 判据（spec people-place §5）', () => {
  it('POST create → 同事务写 moment.extract（payload {momentId} camelCase，偏差 1）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(res.status).toBe(201);

    const events = await extractEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.extract', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId: res.body.id });
  });

  it('PATCH content 变化 → 追加一行', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);
    expect(await extractEvents()).toHaveLength(1);

    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: '改了正文，提到朵朵' });
    expect(patched.status).toBe(200);
    expect(await extractEvents()).toHaveLength(2);
    const events = await extractEvents();
    expect(events[1].payload).toEqual({ momentId: created.body.id });
  });

  it('hash 已写（消费完成形态）后：PATCH 同内容 / 仅 tagIds → 均不追加（内容没变不重抽，spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);

    // 模拟 worker 消费成功：hash 已写为当前内容的 hash
    await db
      .update(moments)
      .set({ aiExtractHash: computeAiExtractHash(baseBody.content, null) })
      .where(eq(moments.id, created.body.id));

    const sameContent = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: baseBody.content });
    expect(sameContent.status).toBe(200);
    expect(await extractEvents()).toHaveLength(1); // 不追加

    const tagOnly = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ tagIds: [] });
    expect(tagOnly.status).toBe(200);
    expect(await extractEvents()).toHaveLength(1); // 不追加
  });

  it('hash 未写时重复 PATCH 同内容 → 仍追加：发射判据是 ai_extract_hash 而非 pending 去重（偏差 8）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);

    // hash 仍 NULL（worker 未消费）：同内容 PATCH 再发一行，消费侧 hash 幂等吸收
    const again = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: baseBody.content });
    expect(again.status).toBe(200);
    expect(await extractEvents()).toHaveLength(2);
  });
});

describe('发射侧：transcribe 回填补发射（spec §5 voice 独立触发）', () => {
  it('转写成功落 transcript 的同事务补写 moment.extract（payload {momentId}）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider(asrReturning('今天带朵朵去外婆家吃饭'));

    await handleMomentTranscribe({ momentId }, { push: mockPush });

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(m.transcriptionStatus).toBe('done');
    // voice 独立触发：否则转写文本永远进不了抽取管线（spec §5）
    const events = await extractEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.extract', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId });
  });

  it('转写失败（Retryable 传播）→ 不写 extract 行、transcript 保持 NULL（事务回滚语义）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider({
      transcribe: async () => {
        throw new RetryableLLMError('ASR 429');
      },
    });

    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBeNull();
    expect(await extractEvents()).toHaveLength(0);
  });
});
