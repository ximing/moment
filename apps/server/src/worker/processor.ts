import { and, asc, eq, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { outbox } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { PushService } from '../push/push-service.js';
import { getPushService } from '../push/factory.js';
import { handlers as defaultHandlers, type OutboxHandler } from './handlers.js';

/** 指数退避档位（spec §5.4）：1min → 5min → 15min → 1h → 4h */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 4 * 3_600_000] as const;
/** claim 租约：处理期间（含慢 IO 的 push）其他批次/进程不取同一行；崩溃后 60s 自动重投。 */
export const CLAIM_LEASE_MS = 60_000;

export interface OutboxBatchResult {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
}

export interface ProcessorDeps {
  push?: PushService;
  handlers?: Record<string, OutboxHandler>;
  batchSize?: number;
  now?: () => Date;
}

/**
 * 一批 outbox 消费（spec §5.4）：
 * 1) claim：短事务内 SELECT ... FOR UPDATE SKIP LOCKED 取到期 pending 行，写 60s 租约后提交
 *    ——处理（含 Expo Push 慢 IO）在锁外进行，不长期持锁；多 worker 并发下同一行只被一个批次持有。
 * 2) 逐条分发 handler；成功 → done；失败 → attempts+1 + 档位退避；attempts>5（5 档退避全部用尽）→ failed。
 * 3) 未注册 type → 直接 failed（不重试无效循环；已注册类型含 moment.deleted 的 no-op 占位，见 handlers.ts）。
 */
export async function runOutboxBatch(deps: ProcessorDeps = {}): Promise<OutboxBatchResult> {
  const push = deps.push ?? getPushService();
  const table = deps.handlers ?? defaultHandlers;
  const batchSize = deps.batchSize ?? config.WORKER_BATCH_SIZE;
  const now = deps.now ?? (() => new Date());

  const claimedIds = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.status, 'pending'),
          or(isNull(outbox.nextRetryAt), lte(outbox.nextRetryAt, now())) as SQL,
        )
      )
      .orderBy(asc(outbox.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(outbox)
      .set({ nextRetryAt: new Date(now().getTime() + CLAIM_LEASE_MS) })
      .where(inArray(outbox.id, rows.map((r) => r.id)));
    return rows.map((r) => r.id);
  });

  const result: OutboxBatchResult = { claimed: claimedIds.length, done: 0, retried: 0, failed: 0 };
  if (claimedIds.length === 0) return result;

  const rows = await db.select().from(outbox).where(inArray(outbox.id, claimedIds));
  for (const row of rows) {
    const handler = table[row.type];
    if (!handler) {
      logger.warn('no handler for outbox type; marking failed', { id: row.id, type: row.type });
      await db
        .update(outbox)
        .set({ status: 'failed', processedAt: now(), nextRetryAt: null })
        .where(eq(outbox.id, row.id));
      result.failed += 1;
      continue;
    }
    try {
      await handler(row.payload as Record<string, unknown>, { push });
      await db
        .update(outbox)
        .set({ status: 'done', processedAt: now(), nextRetryAt: null })
        .where(eq(outbox.id, row.id));
      result.done += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      // attempts=5 时仍按 4h 档（RETRY_DELAYS_MS[4]）排重试；>5（5 档用尽）才 failed
      if (attempts > RETRY_DELAYS_MS.length) {
        logger.error('outbox entry exhausted retries', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ status: 'failed', attempts, processedAt: now(), nextRetryAt: null })
          .where(eq(outbox.id, row.id));
        result.failed += 1;
      } else {
        logger.warn('outbox entry failed; will retry', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ attempts, nextRetryAt: new Date(now().getTime() + RETRY_DELAYS_MS[attempts - 1]) })
          .where(eq(outbox.id, row.id));
        result.retried += 1;
      }
    }
  }
  return result;
}
