import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments, outbox } from '../../src/db/schema.js';
import { RetryableLLMError } from '../../src/llm/base.provider.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import { handleMomentGeocode } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(resetDb);
afterEach(() => setGeocodeProvider(undefined)); // 重置注入，防 --runInBand 下跨文件状态污染
afterAll(closeDb);

/** 造一条带 place 的 moment（默认 exif 坐标 + 空 name，即 geocode 待回填形态）。 */
async function seedMoment(opts?: {
  placeSource?: 'manual' | 'exif' | 'ai' | null;
  placeName?: string | null;
  placeLat?: number | null;
  placeLng?: number | null;
  deletedAt?: Date | null;
}): Promise<string> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-20T10:00:00Z'),
  });
  await db
    .update(moments)
    .set({
      placeLat: opts?.placeLat === undefined ? 39.9042 : opts.placeLat,
      placeLng: opts?.placeLng === undefined ? 116.4074 : opts.placeLng,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      placeSource: opts?.placeSource === undefined ? 'exif' : opts.placeSource,
      deletedAt: opts?.deletedAt ?? null,
    })
    .where(eq(moments.id, momentId));
  return momentId;
}

function geocodeReturning(name: string | null, seen?: Array<{ lat: number; lng: number }>): GeocodeProvider {
  return {
    reverse: async (lat, lng) => {
      seen?.push({ lat, lng });
      return name;
    },
  };
}

async function placeRow(momentId: string) {
  const [m] = await db
    .select({
      placeName: moments.placeName,
      placeSource: moments.placeSource,
    })
    .from(moments)
    .where(eq(moments.id, momentId));
  return m;
}

describe('handleMomentGeocode（spec people-place §4）', () => {
  it('成功回填：provider 返回地址 → place_name 落库（截断 255）、place_source 仍为 exif，provider 收到行坐标', async () => {
    const momentId = await seedMoment();
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('北京市东城区东华门街道天安门广场', seen));

    await handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush });

    expect(seen).toEqual([{ lat: 39.9042, lng: 116.4074 }]);
    const row = await placeRow(momentId);
    expect(row.placeName).toBe('北京市东城区东华门街道天安门广场');
    expect(row.placeSource).toBe('exif');
  });

  it('超长地址截断到 255（worker 回填绕过 API 校验，对齐 transcribe 的 5000 截断范式，计划偏差 5）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning('长'.repeat(300)));

    await handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush });

    const row = await placeRow(momentId);
    expect(row.placeName).toHaveLength(255);
    expect(row.placeName).toBe('长'.repeat(255));
  });

  it('provider 返回 null（确定无地址）→ 正常返回、place_name 留空', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning(null));

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull();
  });

  it('空 key 停用（provider null）→ 消费即跳过：正常返回、place_name 留空（坐标照存不阻断，spec §4/§8）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(null);

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull();
    expect(row.placeSource).toBe('exif'); // 坐标列原样保留
  });

  it('moment 不存在 / 已软删 → done 跳过（worker 软删竞态，编排硬约束）', async () => {
    setGeocodeProvider(geocodeReturning('不应被回填'));
    const missing = randomUUID();
    await expect(handleMomentGeocode({ momentId: missing }, { push: mockPush })).resolves.toBeUndefined();

    const deletedId = await seedMoment({ deletedAt: new Date() });
    await handleMomentGeocode({ momentId: deletedId }, { push: mockPush });
    const row = await placeRow(deletedId);
    expect(row.placeName).toBeNull();
  });

  it('手动编辑后不覆盖：place_source=manual（或名已非空）→ 不调 provider、不写 place_name（防竞态覆盖，spec §5 冲突规则）', async () => {
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('不应被回填', seen));

    const manualSource = await seedMoment({ placeSource: 'manual', placeName: null });
    await handleMomentGeocode({ momentId: manualSource }, { push: mockPush });
    expect(await placeRow(manualSource)).toMatchObject({ placeName: null, placeSource: 'manual' });

    const namedExif = await seedMoment({ placeSource: 'exif', placeName: '用户手动改的名' });
    await handleMomentGeocode({ momentId: namedExif }, { push: mockPush });
    expect(await placeRow(namedExif)).toMatchObject({
      placeName: '用户手动改的名',
      placeSource: 'exif',
    });

    const aiNamed = await seedMoment({ placeSource: 'ai', placeName: 'AI 抽取的地名' });
    await handleMomentGeocode({ momentId: aiNamed }, { push: mockPush });
    expect(await placeRow(aiNamed)).toMatchObject({ placeName: 'AI 抽取的地名', placeSource: 'ai' });

    expect(seen).toEqual([]); // 三种形态均不应触达远端
  });

  it('坐标以重读的行为准：payload 快照坐标不消费（计划偏差 4）', async () => {
    const momentId = await seedMoment(); // 行坐标 39.9042, 116.4074
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('北京市东城区', seen));

    await handleMomentGeocode({ momentId, lat: 0, lng: 0 }, { push: mockPush }); // payload 坐标故意不同

    expect(seen).toEqual([{ lat: 39.9042, lng: 116.4074 }]);
    expect(await placeRow(momentId)).toMatchObject({ placeName: '北京市东城区' });
  });

  it('provider 抛错 → 原样传播（processor 退避；handler 不 try/catch，计划偏差 3）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new RetryableLLMError('geocode amap 429');
      },
    });

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).rejects.toBeInstanceOf(RetryableLLMError);

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull(); // 失败不写半截状态
  });

  it('exif 但坐标列为 null（异常态防御）→ 跳过不调 provider', async () => {
    const momentId = await seedMoment({ placeLat: null, placeLng: null });
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('不应被回填', seen));

    await handleMomentGeocode({ momentId }, { push: mockPush });

    expect(seen).toEqual([]);
    expect((await placeRow(momentId)).placeName).toBeNull();
  });
});

describe('runOutboxBatch × moment.geocode（注册表分发 + 既有退避终败，spec §4「终败仅记日志不重派」）', () => {
  async function emitGeocodeRow(momentId: string, over: Partial<typeof outbox.$inferInsert> = {}) {
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.geocode',
      payload: { momentId, lat: 39.9042, lng: 116.4074 },
      status: 'pending',
      ...over,
    });
  }

  it('已注册分发：成功路径经默认 handlers 表回填 place_name', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning('北京市东城区'));
    await emitGeocodeRow(momentId);

    const result = await runOutboxBatch({ push: mockPush }); // 默认 handlers → 证明注册表条目存在
    expect(result.done).toBe(1);
    expect(await placeRow(momentId)).toMatchObject({ placeName: '北京市东城区' });
  });

  it('失败退避：首败 attempts=1、仍 pending（既有指数退避）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new Error('AMAP_DOWN');
      },
    });
    await emitGeocodeRow(momentId);

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.retried).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
    expect((await placeRow(momentId)).placeName).toBeNull();
  });

  it('终败：attempts=5 的行再失败 → status=failed、不重派、place_name 留空（坐标仍在，损失可接受）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new Error('AMAP_STILL_DOWN');
      },
    });
    await emitGeocodeRow(momentId, { attempts: 5 });

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.failed).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();

    const place = await placeRow(momentId);
    expect(place.placeName).toBeNull();
    expect(place.placeSource).toBe('exif'); // 坐标照存
  });
});
