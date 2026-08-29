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

  it('handlers 登记 moment.compress', () => {
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
  });
});
