import { MAX_IMAGE_BYTES } from '@moment/dto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, moments } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { maybeEmitMomentEmbed } from '../moments/embed-outbox.js';
import { logger } from '../utils/logger.js';
import { DERIVED_MIME, NonRetryableCompressError, compressToDerivedWebp } from './compress.js';
import { derivedObjectKey, isCompressibleMime } from './derived.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function markDerivedFailed(mediaId: string, momentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(media)
      .set({
        derivedStatus: 'failed',
        derivedS3Key: null,
        derivedMime: null,
        derivedSize: null,
        derivedWidth: null,
        derivedHeight: null,
      })
      .where(and(eq(media.id, mediaId), isNotNull(media.momentId)));
    if (result.affectedRows === 0) return;
    await maybeEmitMomentEmbed(tx, momentId);
  });
}

/**
 * moment.compress（spec fused-retrieval §4.2）。
 * 终败写 derived_status=failed 后 throw NonRetryableCompressError；禁止改 outbox.status。
 * ready/skipped/failed 写列的同一事务末尾 maybeEmitMomentEmbed。
 */
export async function handleMomentCompress(
  payload: Record<string, unknown>,
  _deps?: { push: unknown },
): Promise<void> {
  const mediaId = str(payload.mediaId);
  if (!mediaId) return;

  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || !row.momentId) return;

  const [m] = await db.select().from(moments).where(eq(moments.id, row.momentId)).limit(1);
  if (!m || m.deletedAt) return;

  if (!isCompressibleMime(row.mime)) return;

  let buf: Buffer;
  try {
    buf = await getStorage().getObject(row.s3Key, row.storageMeta, MAX_IMAGE_BYTES);
  } catch (err) {
    if (err instanceof Error && err.name === 'ObjectTooLargeError') {
      await markDerivedFailed(row.id, m.id);
      throw new NonRetryableCompressError('OBJECT_TOO_LARGE', err);
    }
    throw err;
  }

  let out: { buffer: Buffer; width: number; height: number };
  try {
    out = await compressToDerivedWebp(buf);
  } catch (err) {
    if (err instanceof NonRetryableCompressError) {
      await markDerivedFailed(row.id, m.id);
    }
    throw err;
  }

  if (out.buffer.length >= row.size) {
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(media)
        .set({
          derivedStatus: 'skipped',
          derivedS3Key: null,
          derivedMime: null,
          derivedSize: null,
          derivedWidth: null,
          derivedHeight: null,
        })
        .where(and(eq(media.id, row.id), isNotNull(media.momentId)));
      if (result.affectedRows === 0) return;
      await maybeEmitMomentEmbed(tx, m.id);
    });
    return;
  }

  const key = derivedObjectKey(m.chainId, m.id, row.id);
  await getStorage().uploadFile(key, out.buffer);
  let wrote = false;
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(media)
      .set({
        derivedS3Key: key,
        derivedMime: DERIVED_MIME,
        derivedSize: out.buffer.length,
        derivedWidth: out.width,
        derivedHeight: out.height,
        derivedStatus: 'ready',
      })
      .where(and(eq(media.id, row.id), isNotNull(media.momentId)));
    if (result.affectedRows === 0) return;
    wrote = true;
    await maybeEmitMomentEmbed(tx, m.id);
  });
  if (!wrote) {
    await getStorage()
      .deleteFile(key, row.storageMeta)
      .catch((err: unknown) => {
        logger.warn('orphan compress derived cleanup failed', err);
      });
  }
}
