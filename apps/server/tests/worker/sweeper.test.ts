import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { handleMomentDeleted, handleMomentTranscribe, handlers } from '../../src/worker/handlers.js';
import {
  sweepSoftDeletedMomentMedia,
  sweepStaleUploadingMedia,
  sweepStaleVoiceTranscriptions,
} from '../../src/worker/sweeper.js';

let storage: MockStorage;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

/** 直插最小链 + moment（sweeper 只关心 moments.deletedAt 与 media 行）。 */
async function insertMomentWithMedia(opts: {
  momentDeletedAt?: Date | null;
  mediaStatus?: 'uploading' | 'ready' | 'orphaned';
  mediaCreatedAt?: Date;
  uploadId?: string | null;
}): Promise<{ momentId: string; mediaId: string }> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  const { chains } = await import('../../src/db/schema.js');
  await db.insert(chains).values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: 'media',
    content: 'x',
    happenedAt: new Date(),
    happenedTzOffset: 0,
    wallDate: wallDateOf(new Date(), 0),
    deletedAt: opts.momentDeletedAt ?? null,
  });
  const mediaId = randomUUID();
  await db.insert(media).values({
    id: mediaId,
    momentId,
    uploaderId: userId,
    s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: opts.mediaStatus ?? 'ready',
    storageMeta: TEST_META,
    uploadId: opts.uploadId ?? null,
    createdAt: opts.mediaCreatedAt ?? new Date(),
  });
  return { momentId, mediaId };
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

describe('sweepStaleUploadingMedia（uploading 超 24h，spec §5.5）', () => {
  it('超期 uploading：abort multipart + deleteFile + 硬删行；未超期与 ready 不动', async () => {
    const stale = await insertMomentWithMedia({
      mediaStatus: 'uploading',
      mediaCreatedAt: new Date(Date.now() - 25 * 3_600_000),
      uploadId: 'upload-123',
    });
    const fresh = await insertMomentWithMedia({ mediaStatus: 'uploading' });
    const ready = await insertMomentWithMedia({
      mediaStatus: 'ready',
      mediaCreatedAt: new Date(Date.now() - 48 * 3_600_000),
    });

    const result = await sweepStaleUploadingMedia();

    expect(result.scanned).toBe(1);
    expect(result.abortedUploads).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(result.deletedRows).toBe(1);
    expect(storage.abortMultipart).toHaveBeenCalledWith(
      expect.stringContaining(stale.mediaId),
      'upload-123'
    );
    expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringContaining(stale.mediaId), TEST_META);
    expect(await db.select().from(media).where(eq(media.id, stale.mediaId))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, fresh.mediaId))).toHaveLength(1);
    expect(await db.select().from(media).where(eq(media.id, ready.mediaId))).toHaveLength(1);
  });

  it('dry-run：只日志不删行不调存储', async () => {
    const stale = await insertMomentWithMedia({
      mediaStatus: 'uploading',
      mediaCreatedAt: new Date(Date.now() - 25 * 3_600_000),
    });
    const result = await sweepStaleUploadingMedia(new Date(), { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.deletedRows).toBe(0);
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(await db.select().from(media).where(eq(media.id, stale.mediaId))).toHaveLength(1);
  });
});

describe('sweepSoftDeletedMomentMedia（软删超 30 天 moment 的媒体）', () => {
  it('超期：S3 对象 + media 行硬删；未超期与活 moment 的媒体不动', async () => {
    const old = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    const recent = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 86_400_000),
    });
    const alive = await insertMomentWithMedia({});

    const result = await sweepSoftDeletedMomentMedia();

    expect(result.scanned).toBe(1);
    expect(result.deletedRows).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringContaining(old.mediaId), TEST_META);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, recent.mediaId))).toHaveLength(1);
    expect(await db.select().from(media).where(eq(media.id, alive.mediaId))).toHaveLength(1);
  });

  it('deleteFile 失败：行保留、下轮重试（正式对象无 lifecycle 兜底，删行即永久孤儿）', async () => {
    const old = await insertMomentWithMedia({
      momentDeletedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 down'));

    const result = await sweepSoftDeletedMomentMedia();
    expect(result.scanned).toBe(1);
    expect(result.deletedObjects).toBe(0);
    expect(result.deletedRows).toBe(0);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(1);

    // 下轮重试成功 → 行正常删除
    const retry = await sweepSoftDeletedMomentMedia();
    expect(retry.deletedRows).toBe(1);
    expect(await db.select().from(media).where(eq(media.id, old.mediaId))).toHaveLength(0);
  });
});

describe('handleMomentDeleted（outbox moment.deleted → 标记 orphaned，幂等）', () => {
  it('ready → orphaned；重复调用不报错不再变', async () => {
    const { momentId, mediaId } = await insertMomentWithMedia({
      momentDeletedAt: new Date(),
      mediaStatus: 'ready',
    });
    await handleMomentDeleted({ momentId, chainId: 'ignored' }, { push: undefined as never });
    let [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');

    await handleMomentDeleted({ momentId, chainId: 'ignored' }, { push: undefined as never });
    [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');
  });

  it('handlers 注册表含 moment.deleted', () => {
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(Object.keys(handlers)).toHaveLength(6);
  });
});

describe('sweepStaleVoiceTranscriptions（spec voice-moment §4.4：6h cutoff 兜底悬挂 pending）', () => {
  /** 直插 moment（voice 默认带 transcriptionStatus；text 恒 null）。 */
  async function insertMomentWithTranscription(opts: {
    createdAt: Date;
    deletedAt?: Date | null;
    status?: 'pending' | 'done' | 'failed';
    type?: 'voice' | 'text';
  }): Promise<string> {
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
    const chainId = randomUUID();
    const { chains } = await import('../../src/db/schema.js');
    await db
      .insert(chains)
      .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
    const momentId = randomUUID();
    const type = opts.type ?? 'voice';
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: userId,
      type,
      content: '',
      happenedAt: opts.createdAt,
      happenedTzOffset: 0,
      wallDate: wallDateOf(opts.createdAt, 0),
      createdAt: opts.createdAt,
      deletedAt: opts.deletedAt ?? null,
      transcriptionStatus: type === 'voice' ? (opts.status ?? 'pending') : null,
    });
    return momentId;
  }

  it('只将未软删、pending、严格超过 6h 的 voice moment 标为 failed', async () => {
    const now = new Date('2026-08-23T12:00:00Z');
    const stale = await insertMomentWithTranscription({ createdAt: new Date(now.getTime() - 7 * 3_600_000) });
    const atCutoff = await insertMomentWithTranscription({ createdAt: new Date(now.getTime() - 6 * 3_600_000) });
    const doneM = await insertMomentWithTranscription({
      createdAt: new Date(now.getTime() - 7 * 3_600_000),
      status: 'done',
    });
    const deleted = await insertMomentWithTranscription({
      createdAt: new Date(now.getTime() - 7 * 3_600_000),
      deletedAt: new Date(now.getTime() - 1 * 3_600_000),
    });
    const textM = await insertMomentWithTranscription({
      createdAt: new Date(now.getTime() - 7 * 3_600_000),
      type: 'text',
    });

    const result = await sweepStaleVoiceTranscriptions(now);

    expect(result).toEqual({ scanned: 1, markedFailed: 1, dryRun: false });
    const rows = await db.select().from(moments);
    const by = (id: string) => rows.find((row) => row.id === id)!;
    expect(by(stale).transcriptionStatus).toBe('failed');
    expect(by(atCutoff).transcriptionStatus).toBe('pending');
    expect(by(doneM).transcriptionStatus).toBe('done');
    expect(by(deleted).transcriptionStatus).toBe('pending');
    expect(by(textM).transcriptionStatus).toBeNull();
  });

  it('dry-run 只报告严格超过 cutoff 的候选项，不更新状态', async () => {
    const now = new Date('2026-08-23T12:00:00Z');
    const stale = await insertMomentWithTranscription({ createdAt: new Date(now.getTime() - 7 * 3_600_000) });

    const result = await sweepStaleVoiceTranscriptions(now, { dryRun: true });

    expect(result).toEqual({ scanned: 1, markedFailed: 0, dryRun: true });
    const [row] = await db.select().from(moments).where(eq(moments.id, stale));
    expect(row.transcriptionStatus).toBe('pending');
  });
});
