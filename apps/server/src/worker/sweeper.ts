import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, moments, type Media } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { logger } from '../utils/logger.js';

export interface SweepResult {
  scanned: number;
  deletedRows: number;
  deletedObjects: number;
  abortedUploads: number;
  dryRun: boolean;
}

/** 单轮每类最多处理行数：防爆量长事务与 S3 请求风暴；剩余下一轮继续。 */
const BATCH_LIMIT = 500;

function newResult(dryRun: boolean): SweepResult {
  return { scanned: 0, deletedRows: 0, deletedObjects: 0, abortedUploads: 0, dryRun };
}

/**
 * 单行的 S3 清理：abort 未完成 multipart（若有 uploadId）+ deleteFile。
 * 返回 false = deleteFile 失败：**行保留、下轮重试**——正式对象（chains/... 前缀）不在任何 bucket
 * lifecycle 规则覆盖内（也不可能加，会误删活对象），若删行即成永久孤儿且无重试路径。
 * abort 失败只告警不阻塞：未完成 multipart 由 lifecycle 的 AbortIncompleteMultipartUpload 7 天规则兜底（Task 7）。
 */
async function destroyMediaObject(row: Media, result: SweepResult): Promise<boolean> {
  const storage = getStorage();
  if (row.uploadId) {
    try {
      await storage.abortMultipart(row.s3Key, row.uploadId);
      result.abortedUploads += 1;
    } catch (err) {
      logger.warn('sweeper abort multipart failed（AbortIncompleteMultipartUpload lifecycle 兜底）', {
        mediaId: row.id,
        err: String(err),
      });
    }
  }
  try {
    await storage.deleteFile(row.s3Key, row.storageMeta);
    result.deletedObjects += 1;
    return true;
  } catch (err) {
    logger.warn('sweeper delete object failed（保留行，下轮重试）', {
      mediaId: row.id,
      key: row.s3Key,
      err: String(err),
    });
    return false;
  }
}

/** uploading 超 MEDIA_UPLOADING_TTL_HOURS 的 media 行 + S3 对象（防孤儿，spec §5.5）。 */
export async function sweepStaleUploadingMedia(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<SweepResult> {
  const result = newResult(opts?.dryRun ?? config.SWEEPER_DRY_RUN);
  const cutoff = new Date(now.getTime() - config.MEDIA_UPLOADING_TTL_HOURS * 3_600_000);
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.status, 'uploading'), lt(media.createdAt, cutoff)))
    .orderBy(asc(media.createdAt)) // FIFO：持续积压时老行优先，避免无 ORDER BY 的选择不确定饿死老行
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const row of rows) {
    if (result.dryRun) {
      logger.info('sweeper dry-run: would delete stale uploading media', {
        mediaId: row.id,
        key: row.s3Key,
        createdAt: row.createdAt,
      });
      continue;
    }
    if (!(await destroyMediaObject(row, result))) continue; // 对象删除失败：行留下轮重试
    await db.delete(media).where(eq(media.id, row.id));
    result.deletedRows += 1;
  }
  logger.info('sweeper stale uploading media done', { ...result });
  return result;
}

/** 软删超 MOMENT_SOFT_DELETE_RETENTION_DAYS 天 moment 的媒体：S3 对象 + media 行硬删。 */
export async function sweepSoftDeletedMomentMedia(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<SweepResult> {
  const result = newResult(opts?.dryRun ?? config.SWEEPER_DRY_RUN);
  const cutoff = new Date(now.getTime() - config.MOMENT_SOFT_DELETE_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(media)
    .innerJoin(moments, eq(media.momentId, moments.id))
    .where(and(isNotNull(moments.deletedAt), lt(moments.deletedAt, cutoff)))
    .orderBy(asc(moments.deletedAt)) // FIFO：同上，老行优先
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  for (const { media: row } of rows) {
    if (result.dryRun) {
      logger.info('sweeper dry-run: would delete media of soft-deleted moment', {
        mediaId: row.id,
        momentId: row.momentId,
        key: row.s3Key,
      });
      continue;
    }
    if (!(await destroyMediaObject(row, result))) continue; // 对象删除失败：行留下轮重试
    await db.delete(media).where(eq(media.id, row.id));
    result.deletedRows += 1;
  }
  logger.info('sweeper soft-deleted moment media done', { ...result });
  return result;
}

/**
 * 转写悬挂兜底 cutoff（spec voice-moment §4.4）：必须大于 processor 最大累计退避窗口——
 * RETRY_DELAYS_MS 五档（1min → 5min → 15min → 1h → 4h）累计约 5h21m，取 6h 留约 40 分钟余量
 * 覆盖调度抖动；cutoff 过小会在合法重试期间抢置 failed，后续重试成功又被幂等守卫丢弃。
 */
export const VOICE_TRANSCRIPTION_STALE_HOURS = 6;

export interface TranscriptionSweepResult {
  scanned: number;
  markedFailed: number;
  dryRun: boolean;
}

/**
 * voice 转写悬挂兜底（spec §4.4）：outbox 5 次退避耗尽标 failed 后仍挂 pending 的 moment，
 * 以及 outbox 行丢失 / worker 长期宕机的极端场景，createdAt 超 6h 的 pending 一律置 failed。
 * 与现有 sweep 任务同周期执行（worker/index.ts 的 SWEEPER_INTERVAL_MS 块）。
 */
export async function sweepStaleVoiceTranscriptions(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<TranscriptionSweepResult> {
  const result: TranscriptionSweepResult = {
    scanned: 0,
    markedFailed: 0,
    dryRun: opts?.dryRun ?? config.SWEEPER_DRY_RUN,
  };
  const cutoff = new Date(now.getTime() - VOICE_TRANSCRIPTION_STALE_HOURS * 3_600_000);
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(
      and(
        eq(moments.type, 'voice'),
        eq(moments.transcriptionStatus, 'pending'),
        lt(moments.createdAt, cutoff),
        isNull(moments.deletedAt)
      )
    )
    .orderBy(asc(moments.createdAt))
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;

  if (result.dryRun) {
    for (const row of rows) {
      logger.info('sweeper dry-run: would fail stale voice transcription', { momentId: row.id });
    }
    logger.info('sweeper stale voice transcriptions done', { ...result });
    return result;
  }

  if (rows.length > 0) {
    // 条件更新：扫描后若已完成或软删则安全跳过，且不计入实际失败数。
    const [updateResult] = await db
      .update(moments)
      .set({ transcriptionStatus: 'failed' })
      .where(
        and(
          inArray(
            moments.id,
            rows.map((row) => row.id)
          ),
          eq(moments.type, 'voice'),
          eq(moments.transcriptionStatus, 'pending'),
          isNull(moments.deletedAt)
        )
      );
    result.markedFailed = Number(updateResult.affectedRows);
  }

  logger.info('sweeper stale voice transcriptions done', { ...result });
  return result;
}
