import { and, asc, eq, gt, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, momentPersons, moments, outbox, persons } from '../db/schema.js';
import { getEmbeddingProvider } from '../embedding/factory.js';
import { isCompressibleMime } from '../media/derived.js';
import { assembleEmbedText } from '../moments/embed-hash.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

export const EMBED_BACKFILL_DEFAULT_BATCH = 100;

export interface EmbedBackfillOptions {
  batchSize?: number;
  pauseMs?: number;
}

export interface EmbedBackfillResult {
  compressDispatched: number;
  embedDispatched: number;
}

function payloadId(payload: unknown, key: 'mediaId' | 'momentId'): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function pendingIds(type: typeof OUTBOX_MOMENT_COMPRESS | typeof OUTBOX_MOMENT_EMBED, key: 'mediaId' | 'momentId'): Promise<Set<string>> {
  const rows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.type, type), eq(outbox.status, 'pending')));
  const set = new Set<string>();
  for (const r of rows) {
    const id = payloadId(r.payload, key);
    if (id) set.add(id);
  }
  return set;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 存量回填（spec fused-retrieval §11）：只发射不消费。
 * 1) embedding provider null → 退出 0。
 * 2) 未软删时刻的静态可压图且 derived_status IS NULL → moment.compress（pending 去重；同事务置 pending）。
 * 3) 未软删、无 pending 可压图（列 pending 或 pending compress outbox）、embed_hash IS NULL → moment.embed（pending 去重；空素材跳过）。
 */
export async function runEmbedBackfillSweep(
  opts: EmbedBackfillOptions = {},
): Promise<EmbedBackfillResult> {
  const batchSize = opts.batchSize ?? EMBED_BACKFILL_DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? 0;

  if (getEmbeddingProvider() === null) {
    logger.info(
      'embed backfill skipped: embedding disabled (empty DASHSCOPE_API_KEY or MULTIMODAL_EMBEDDING_ENABLED=false)',
    );
    return { compressDispatched: 0, embedDispatched: 0 };
  }

  const pendingCompressMediaIds = await pendingIds(OUTBOX_MOMENT_COMPRESS, 'mediaId');
  let lastMediaId = '';
  let compressDispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [
      isNull(media.derivedStatus),
      eq(media.status, 'ready'),
      isNotNull(media.momentId),
      isNull(moments.deletedAt),
    ];
    if (lastMediaId !== '') conditions.push(gt(media.id, lastMediaId));
    const rows = await db
      .select({
        mediaId: media.id,
        momentId: media.momentId,
        chainId: moments.chainId,
        mime: media.mime,
      })
      .from(media)
      .innerJoin(moments, eq(media.momentId, moments.id))
      .where(and(...conditions))
      .orderBy(asc(media.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      lastMediaId = row.mediaId;
      if (!row.momentId) continue;
      if (!isCompressibleMime(row.mime)) continue;
      if (pendingCompressMediaIds.has(row.mediaId)) continue;
      await db.transaction(async (tx: DbTx) => {
        await tx
          .update(media)
          .set({ derivedStatus: 'pending' })
          .where(and(eq(media.id, row.mediaId), isNull(media.derivedStatus)));
        await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, {
          momentId: row.momentId,
          chainId: row.chainId,
          mediaId: row.mediaId,
        });
      });
      pendingCompressMediaIds.add(row.mediaId);
      compressDispatched += 1;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await pause(pauseMs);
  }

  const pendingEmbedMomentIds = await pendingIds(OUTBOX_MOMENT_EMBED, 'momentId');
  let lastMomentId = '';
  let embedDispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [isNull(moments.embedHash), isNull(moments.deletedAt)];
    if (lastMomentId !== '') conditions.push(gt(moments.id, lastMomentId));
    const rows = await db
      .select({
        id: moments.id,
        chainId: moments.chainId,
        content: moments.content,
        transcript: moments.transcript,
        placeName: moments.placeName,
      })
      .from(moments)
      .where(and(...conditions))
      .orderBy(asc(moments.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const m of rows) {
      lastMomentId = m.id;
      if (pendingEmbedMomentIds.has(m.id)) continue;

      const mediaRows = await db.select().from(media).where(eq(media.momentId, m.id));
      const pendingImg = mediaRows.some(
        (r) =>
          isCompressibleMime(r.mime) &&
          (r.derivedStatus === 'pending' || pendingCompressMediaIds.has(r.id)),
      );
      if (pendingImg) continue;

      const personRows = await db
        .select({ name: persons.name })
        .from(momentPersons)
        .innerJoin(persons, eq(momentPersons.personId, persons.id))
        .where(eq(momentPersons.momentId, m.id));
      const personNames = personRows.map((r) => r.name).filter((n) => n.length > 0);
      const text = assembleEmbedText(m.content, m.transcript, personNames, m.placeName);
      const readyImg = mediaRows.some(
        (r) => isCompressibleMime(r.mime) && r.derivedStatus === 'ready' && Boolean(r.derivedS3Key),
      );
      if (!text && !readyImg) continue;

      await db.transaction(async (tx: DbTx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId: m.id, chainId: m.chainId });
      });
      pendingEmbedMomentIds.add(m.id);
      embedDispatched += 1;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await pause(pauseMs);
  }

  if (compressDispatched > 0 || embedDispatched > 0) {
    logger.info('embed backfill dispatched', { compressDispatched, embedDispatched });
  }
  return { compressDispatched, embedDispatched };
}
