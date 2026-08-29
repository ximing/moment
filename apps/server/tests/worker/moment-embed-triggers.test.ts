import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, moments, outbox, users } from '../../src/db/schema.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { handleMomentExtract, handleMomentGeocode, handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
let storage: MockStorage;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setGeocodeProvider(undefined);
  setASRProvider(undefined);
});
afterAll(closeDb);

async function embedCount(momentId: string): Promise<number> {
  const rows = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
  return rows.filter((r) => (r.payload as { momentId?: string }).momentId === momentId).length;
}

describe('extract/geocode/transcribe 触发 embed（spec §4.4）', () => {
  it('persistExtraction 成功 → 同事务 embed（人名进 hash）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '今天带朵朵去外婆家',
    });
    setLLMProvider({
      chat: async () => ({
        content: '{"persons":["朵朵","外婆"],"places":[]}',
        model: 'm',
        usage: { prompt: 1, completion: 1, total: 2 },
      }),
    } as unknown as LLMProvider);
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await embedCount(momentId)).toBe(1);
  });

  it('geocode 回填 place_name 成功 → embed；null 地址不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await db
      .update(moments)
      .set({ placeLat: 39.9, placeLng: 116.4, placeName: null, placeSource: 'exif' })
      .where(eq(moments.id, momentId));
    setGeocodeProvider({ reverse: async () => '天安门' } as GeocodeProvider);
    await handleMomentGeocode({ momentId }, { push: mockPush });
    expect(await embedCount(momentId)).toBe(1);

    const other = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await db
      .update(moments)
      .set({ placeLat: 1, placeLng: 2, placeName: null, placeSource: 'exif' })
      .where(eq(moments.id, other));
    setGeocodeProvider({ reverse: async () => null } as GeocodeProvider);
    await handleMomentGeocode({ momentId: other }, { push: mockPush });
    expect(await embedCount(other)).toBe(0);
  });

  it('transcribe 成功且 hash 变 → 同事务直接 embed（不依赖 extract）', async () => {
    // seed 对齐 tests/worker/handle-moment-transcribe.test.ts 的 insertVoice + stubAudioDownload
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
    const chainId = randomUUID();
    await db.insert(chains).values({
      id: chainId,
      name: 'c',
      ownerId: userId,
      visibility: 'private',
      template: 'daily',
    });
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
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setLLMProvider(null);
    setASRProvider({ transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) } as unknown as ASRProvider);
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('done');
    expect(await embedCount(momentId)).toBe(1);
  });
});
