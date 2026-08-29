import { MAX_IMAGE_BYTES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, moments } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { DERIVED_MIME, NonRetryableCompressError, compressToDerivedWebp } from './compress.js';
import { derivedObjectKey, isCompressibleMime } from './derived.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function markDerivedFailed(mediaId: string): Promise<void> {
  await db
    .update(media)
    .set({
      derivedStatus: 'failed',
      derivedS3Key: null,
      derivedMime: null,
      derivedSize: null,
      derivedWidth: null,
      derivedHeight: null,
    })
    .where(eq(media.id, mediaId));
}

/**
 * moment.compress（spec fused-retrieval §4.2）。
 * 终败写 derived_status=failed 后 throw NonRetryableCompressError；禁止改 outbox.status。
 * 不 emit moment.embed（P5）。
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
      await markDerivedFailed(row.id);
      throw new NonRetryableCompressError('OBJECT_TOO_LARGE', err);
    }
    throw err;
  }

  let out: { buffer: Buffer; width: number; height: number };
  try {
    out = await compressToDerivedWebp(buf);
  } catch (err) {
    if (err instanceof NonRetryableCompressError) {
      await markDerivedFailed(row.id);
    }
    throw err;
  }

  if (out.buffer.length >= row.size) {
    await db
      .update(media)
      .set({
        derivedStatus: 'skipped',
        derivedS3Key: null,
        derivedMime: null,
        derivedSize: null,
        derivedWidth: null,
        derivedHeight: null,
      })
      .where(eq(media.id, row.id));
    return;
  }

  const key = derivedObjectKey(m.chainId, m.id, row.id);
  await getStorage().uploadFile(key, out.buffer);
  await db
    .update(media)
    .set({
      derivedS3Key: key,
      derivedMime: DERIVED_MIME,
      derivedSize: out.buffer.length,
      derivedWidth: out.width,
      derivedHeight: out.height,
      derivedStatus: 'ready',
    })
    .where(eq(media.id, row.id));
}
