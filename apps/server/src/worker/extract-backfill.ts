import { and, asc, eq, gt, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, outbox } from '../db/schema.js';
import { getLLMProvider } from '../llm/factory.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_EXTRACT } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

/** 默认批量大小（spec §5「批量大小与间隔做参数」，CLI 可覆盖）。 */
export const EXTRACT_BACKFILL_DEFAULT_BATCH = 100;

export interface ExtractBackfillOptions {
  /** 每批扫描的 moment 数上限（正整数）。 */
  batchSize?: number;
  /** 批间暂停毫秒（给共享测试库/远端 DB 留呼吸；0 = 不暂停）。 */
  pauseMs?: number;
}

/**
 * 存量回填 sweep（spec people-place §5）：扫描
 * `ai_extract_hash IS NULL AND deleted_at IS NULL
 *  AND (content <> '' OR (transcript IS NOT NULL AND transcript <> ''))`
 * 的时刻，分批写 moment.extract outbox 行。**只发射不消费**——实际抽取由常驻 worker 的
 * outbox 循环完成（本函数不被 worker/index.ts 调度，是一次性脚本的函数体）。
 *
 * 素材判据与 handler 一致（偏差 6/11）：空 transcript（转写成功但无文本）视同无素材——
 * 否则该类行 ai_extract_hash 恒 NULL，每次跑 backfill 都重复派发（跨 run 不幂等）。
 *
 * - LLM_API_KEY 空 → 直接退出（不查询不发射，spec §5）。
 * - 幂等：消费成功后 hash 已写，`IS NULL` 判据天然排除（二跑不重扫）；
 *   「发射未消费」窗口内的二跑由 pending outbox 去重吸收（对齐 recap-scheduler 的
 *   alreadyDispatched 范式，见偏差 8）。单次调用内以 moments.id 游标分页推进
 *   （gt(lastId) + orderBy(asc)）——天然终止且不产生随扫描量增长的巨型 IN 子句。
 * - @returns {dispatched} 本次派发的 outbox 行数
 */
export async function runExtractBackfillSweep(
  opts: ExtractBackfillOptions = {},
): Promise<{ dispatched: number }> {
  const batchSize = opts.batchSize ?? EXTRACT_BACKFILL_DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? 0;

  if (getLLMProvider() === null) {
    logger.info('extract backfill skipped: LLM disabled (empty LLM_API_KEY)');
    return { dispatched: 0 };
  }

  // pending 去重：进入时查一次 pending 行的 momentId 集合。sweep 运行期该集合只会因
  // 本函数自己的发射而扩大（发射前已逐行判过），无需逐批重查；跨 run 的「发射未消费」
  // 窗口由每次调用进入时的这次重查吸收（对齐 recap-scheduler 的 alreadyDispatched 范式）。
  const pendingMomentIds = new Set(
    (
      await db
        .select({ payload: outbox.payload })
        .from(outbox)
        .where(and(eq(outbox.type, OUTBOX_MOMENT_EXTRACT), eq(outbox.status, 'pending')))
    )
      .map((r) => (r.payload as { momentId?: unknown }).momentId)
      .filter((x): x is string => typeof x === 'string'),
  );

  let lastId = '';
  let dispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [
      isNull(moments.aiExtractHash),
      isNull(moments.deletedAt),
      or(ne(moments.content, ''), and(isNotNull(moments.transcript), ne(moments.transcript, ''))),
    ];
    if (lastId !== '') conditions.push(gt(moments.id, lastId));
    const rows = await db
      .select({ id: moments.id })
      .from(moments)
      .where(and(...conditions))
      .orderBy(asc(moments.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const { id } of rows) {
      lastId = id; // 游标推进（含 pending 跳过的行——否则同批全跳过时游标不前进会死循环）
      if (pendingMomentIds.has(id)) continue;
      await db.transaction(async (tx: DbTx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId: id });
      });
      dispatched++;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  if (dispatched > 0) logger.info('extract backfill dispatched', { dispatched });
  return { dispatched };
}
