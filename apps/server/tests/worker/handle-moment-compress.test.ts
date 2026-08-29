import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { db } from '../../src/db/index.js';
import { media, outbox } from '../../src/db/schema.js';
import { handleMomentCompress } from '../../src/media/handle-moment-compress.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { ObjectTooLargeError } from '../../src/storage/bounded-read.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handlers } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

let storage: MockStorage;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function seed(opts?: {
  mime?: string;
  size?: number;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  deletedAt?: Date | null;
  momentId?: string | null;
}): Promise<{ mediaId: string; momentId: string; chainId: string; s3Key: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId =
    opts?.momentId === null
      ? null
      : await insertMoment({
          chainId,
          authorId: owner.id,
          happenedAt: new Date('2026-08-29T00:00:00Z'),
          deletedAt: opts?.deletedAt ?? undefined,
        });
  const mediaId = randomUUID();
  const s3Key = momentId
    ? `chains/${chainId}/${momentId}/${mediaId}.jpeg`
    : `tmp/${mediaId}.jpeg`;
  await db.insert(media).values({
    id: mediaId,
    momentId,
    uploaderId: owner.id,
    s3Key,
    mime: opts?.mime ?? 'image/jpeg',
    size: opts?.size ?? 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts?.derivedStatus === undefined ? 'pending' : opts.derivedStatus,
  });
  return { mediaId, momentId: momentId ?? '', chainId, s3Key };
}

async function seedSibling(
  parent: { momentId: string; chainId: string },
  size: number,
): Promise<{ mediaId: string; momentId: string; chainId: string; s3Key: string }> {
  const [row] = await db
    .select({ uploaderId: media.uploaderId })
    .from(media)
    .where(eq(media.momentId, parent.momentId))
    .limit(1);
  const mediaId = randomUUID();
  const s3Key = `chains/${parent.chainId}/${parent.momentId}/${mediaId}.jpeg`;
  await db.insert(media).values({
    id: mediaId,
    momentId: parent.momentId,
    uploaderId: row!.uploaderId,
    s3Key,
    mime: 'image/jpeg',
    size,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: 'pending',
  });
  return { mediaId, momentId: parent.momentId, chainId: parent.chainId, s3Key };
}

async function derivedCols(mediaId: string) {
  const [row] = await db
    .select({
      derivedS3Key: media.derivedS3Key,
      derivedMime: media.derivedMime,
      derivedSize: media.derivedSize,
      derivedWidth: media.derivedWidth,
      derivedHeight: media.derivedHeight,
      derivedStatus: media.derivedStatus,
    })
    .from(media)
    .where(eq(media.id, mediaId));
  return row;
}

describe('handleMomentCompress（spec fused-retrieval §4.2）', () => {
  it('JPEG fixture → ready，边 ≤512，mime webp，upload 派生 key，getObject 读原图 s3Key', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId, s3Key } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });

    expect(storage.getObject).toHaveBeenCalledWith(s3Key, TEST_META, MAX_IMAGE_BYTES);
    const key = derivedObjectKey(chainId, momentId, mediaId);
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    expect(storage.uploadFile.mock.calls[0]![0]).toBe(key);
    const uploaded = storage.uploadFile.mock.calls[0]![1] as Buffer;
    expect(uploaded.length).toBeLessThan(jpeg.length);
    const row = await derivedCols(mediaId);
    expect(row.derivedStatus).toBe('ready');
    expect(row.derivedS3Key).toBe(key);
    expect(row.derivedMime).toBe('image/webp');
    expect(row.derivedSize).toBe(uploaded.length);
    expect(row.derivedWidth).toBe(512);
    expect(row.derivedHeight).toBe(256);
  });

  it('派生 key 用重读的 moments.chainId，不消费 payload.chainId', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress(
      { momentId, chainId: 'payload-chain-mismatch', mediaId },
      { push: mockPush },
    );
    expect(storage.uploadFile.mock.calls[0]![0]).toBe(derivedObjectKey(chainId, momentId, mediaId));
  });

  it('输出 length ≥ 原 size → skipped，不 upload，派生其余列 NULL', async () => {
    const jpeg = await jpegOf(64, 48);
    const { mediaId, momentId, chainId } = await seed({ size: 1 });
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });

    expect(storage.uploadFile).not.toHaveBeenCalled();
    const row = await derivedCols(mediaId);
    expect(row.derivedStatus).toBe('skipped');
    expect(row.derivedS3Key).toBeNull();
    expect(row.derivedMime).toBeNull();
    expect(row.derivedSize).toBeNull();
    expect(row.derivedWidth).toBeNull();
    expect(row.derivedHeight).toBeNull();
  });

  it('GIF：不 getObject，derived_status 仍 NULL（不是 skipped）', async () => {
    const { mediaId, momentId, chainId } = await seed({ mime: 'image/gif', derivedStatus: null });
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
  });

  it('HEIC/HEIF：不 getObject，derived_status 仍 NULL', async () => {
    for (const mime of ['image/heic', 'image/heif'] as const) {
      const { mediaId, momentId, chainId } = await seed({ mime, derivedStatus: null });
      await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
      expect(storage.getObject).not.toHaveBeenCalled();
      expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
    }
  });

  it('视频行：不 getObject', async () => {
    const { mediaId, momentId, chainId } = await seed({ mime: 'video/mp4', derivedStatus: null });
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
  });

  it('poster 行（独立 image）可压 → ready', async () => {
    const jpeg = await jpegOf(800, 800);
    const { mediaId, momentId, chainId, s3Key } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).toHaveBeenCalledWith(s3Key, TEST_META, MAX_IMAGE_BYTES);
    expect((await derivedCols(mediaId)).derivedStatus).toBe('ready');
  });

  it('media 不存在 / 无 moment / 时刻已软删 → 跳过，不 getObject', async () => {
    await expect(
      handleMomentCompress(
        { momentId: randomUUID(), chainId: randomUUID(), mediaId: randomUUID() },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    const unbound = await seed({ momentId: null, derivedStatus: null });
    await expect(
      handleMomentCompress(
        { momentId: unbound.momentId, chainId: unbound.chainId, mediaId: unbound.mediaId },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    const deleted = await seed({ deletedAt: new Date() });
    await expect(
      handleMomentCompress(
        { momentId: deleted.momentId, chainId: deleted.chainId, mediaId: deleted.mediaId },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('ObjectTooLargeError → derived_status=failed，throw NonRetryableCompressError OBJECT_TOO_LARGE；不改 outbox.status', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });

    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'OBJECT_TOO_LARGE',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('pending');
  });

  it('损坏图 → failed + NonRetryableCompressError SHARP_DECODE_FAILED', async () => {
    const { mediaId, momentId, chainId } = await seed();
    storage.getObject.mockResolvedValue(Buffer.from('not-an-image'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'SHARP_DECODE_FAILED',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
  });

  it('uploadFile 抛错 → 传播，derived_status 仍 pending（可重试）', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    storage.uploadFile.mockRejectedValue(new Error('S3_DOWN'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toThrow('S3_DOWN');
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
  });

  it('processor + 默认 handlers：NonRetryableCompressError 立即 failed + last_error', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });
    const result = await runOutboxBatch({ push: mockPush });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('failed');
    expect(ob.attempts).toBe(1);
    expect(ob.nextRetryAt).toBeNull();
    expect(ob.lastError).toBe('OBJECT_TOO_LARGE');
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
  });

  it('全部可压图终态 ready → emit moment.embed；仍 pending 则不发', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const a = await seed({ size: jpeg.length });
    const b = await seedSibling(a, jpeg.length);
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId: a.momentId, chainId: a.chainId, mediaId: a.mediaId }, { push: mockPush });
    expect(await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).toHaveLength(0);

    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId: b.momentId, chainId: b.chainId, mediaId: b.mediaId }, { push: mockPush });
    const embeds = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(embeds).toHaveLength(1);
    expect(embeds[0].payload).toEqual({ momentId: a.momentId, chainId: a.chainId });
  });

  it('一张 failed、其余 ready：仍 emit embed（failed 不阻塞）', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const ready = await seed({ size: jpeg.length });
    const fail = await seedSibling(ready, 1024);
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress(
      { momentId: ready.momentId, chainId: ready.chainId, mediaId: ready.mediaId },
      { push: mockPush },
    );
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(fail.s3Key, MAX_IMAGE_BYTES));
    await expect(
      handleMomentCompress({ momentId: fail.momentId, chainId: fail.chainId, mediaId: fail.mediaId }, { push: mockPush }),
    ).rejects.toMatchObject({ name: 'NonRetryableCompressError' });
    const embeds = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(embeds).toHaveLength(1);
    expect((await derivedCols(fail.mediaId)).derivedStatus).toBe('failed');
  });

  it('skipped 终态同样可触发 embed', async () => {
    const jpeg = await jpegOf(64, 48);
    const row = await seed({ size: 1 });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId: row.momentId, chainId: row.chainId, mediaId: row.mediaId }, { push: mockPush });
    expect((await derivedCols(row.mediaId)).derivedStatus).toBe('skipped');
    expect(await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).toHaveLength(1);
  });

  it('handlers 登记 moment.compress', () => {
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
  });

  it('orphan 后再走完 ready：UPDATE 0 行、不发 embed、派生列不写到 orphan 行、deleteFile 收到 derivedObjectKey', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    const embedBefore = (await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).length;
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    const cols = await derivedCols(mediaId);
    expect(cols.derivedStatus).toBe('pending'); // seed 默认 pending，禁止写成 ready
    expect(cols.derivedS3Key).toBeNull();
    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.momentId).toBeNull();
    expect(row.status).toBe('orphaned');
    expect(storage.deleteFile).toHaveBeenCalledWith(derivedObjectKey(chainId, momentId, mediaId), TEST_META);
    expect((await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).length).toBe(embedBefore);
  });

  it('ready 路径 deleteFile 失败只 warn，handler 不抛', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 down'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).resolves.toBeUndefined();
  });

  it('skipped 路径 0 行不调用这次 deleteFile（无 upload）', async () => {
    const jpeg = await jpegOf(64, 48);
    const { mediaId, momentId, chainId } = await seed({ size: 1 }); // 压缩后必 ≥ 1 → skipped
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    storage.deleteFile.mockClear();
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
  });

  it('failed 路径 0 行不把 derived_status 写成 failed', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      throw new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES);
    });
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
    expect((await db.select().from(media).where(eq(media.id, mediaId)))[0].momentId).toBeNull();
  });
});
