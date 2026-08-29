import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { MockPushService } from '../../src/push/mock.js';
import type { PushService } from '../../src/push/push-service.js';
import type { OutboxHandler } from '../../src/worker/handlers.js';
import { CLAIM_LEASE_MS, RETRY_DELAYS_MS, runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

function emitRow(id: string, over: Partial<typeof outbox.$inferInsert> = {}): Promise<unknown> {
  return db.insert(outbox).values({ id, type: 'comment.created', payload: {}, status: 'pending', ...over });
}

const okPush: PushService = new MockPushService();

describe('runOutboxBatch', () => {
  it('成功处理：claim → handler 执行 → status=done + processed_at', async () => {
    await emitRow('ob-1');
    const handler = jest.fn<OutboxHandler>().mockResolvedValue(undefined);

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': handler } });
    expect(result).toEqual({ claimed: 1, done: 1, retried: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-1'));
    expect(row.status).toBe('done');
    expect(row.processedAt).not.toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
  });

  it('失败重试：attempts+1、next_retry_at = now + 1min（首档退避）', async () => {
    await emitRow('ob-2');
    const before = Date.now();
    const failing: OutboxHandler = async () => {
      throw new Error('EXPO_DOWN');
    };

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 1, failed: 0 });

    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-2'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt!.getTime() - before).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0] - 1000);
    expect(row.nextRetryAt!.getTime() - before).toBeLessThanOrEqual(RETRY_DELAYS_MS[0] + 5000);
    expect(row.lastError).toBe('EXPO_DOWN');
  });

  it('退避按 attempts 递增档位；attempts=5 仍按 4h 档重试，attempts>5 → failed', async () => {
    const failing: OutboxHandler = async () => {
      throw new Error('STILL_DOWN');
    };
    // 第 5 次失败：仍走重试，用最后一档 4h（4h 档可达）
    await emitRow('ob-3', { attempts: 4 });
    const fifth = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(fifth.retried).toBe(1);
    const [row5] = await db.select().from(outbox).where(eq(outbox.id, 'ob-3'));
    expect(row5.status).toBe('pending');
    expect(row5.attempts).toBe(5);

    // 第 6 次失败（5 档退避用尽）：failed
    await emitRow('ob-3b', { attempts: 5 });
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-3b'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastError).toBe('STILL_DOWN');
  });

  it('未到期的行不 claim（租约生效）：claim 后立即再跑不重复处理', async () => {
    await emitRow('ob-4');
    const handler = jest.fn<OutboxHandler>().mockResolvedValue(undefined);
    const deps = { push: okPush, handlers: { 'comment.created': handler } };

    await runOutboxBatch(deps);
    const second = await runOutboxBatch(deps);
    // 第一次已 done；done 行本就不参与。改用「租约挡 pending」的场景：
    expect(second.claimed).toBe(0);

    await emitRow('ob-5');
    const slowFail: OutboxHandler = async () => {
      throw new Error('RETRY_LATER');
    };
    await runOutboxBatch({ ...deps, handlers: { 'comment.created': slowFail } });
    // 失败后 next_retry_at 在未来（1min 档），下一批不再 claim
    const third = await runOutboxBatch({ ...deps, handlers: { 'comment.created': slowFail } });
    expect(third.claimed).toBe(0);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-5'));
    expect(row.attempts).toBe(1);
  });

  it('未注册的 type → 直接 failed（不无限重试）', async () => {
    await emitRow('ob-6', { type: 'future.sweep' });
    const result = await runOutboxBatch({ push: okPush, handlers: {} });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-6'));
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('NO_HANDLER');
  });

  it('claim 时先把选中行 next_retry_at 推到 now+60s（崩溃保护租约），再执行 handler', async () => {
    await emitRow('ob-7');
    const before = Date.now();
    let seenNextRetryAt: number | null = null;
    const slowHandler: OutboxHandler = async () => {
      // handler 执行中回读：租约必须已写入（claim 事务已提交）
      const [mid] = await db.select().from(outbox).where(eq(outbox.id, 'ob-7'));
      seenNextRetryAt = mid.nextRetryAt?.getTime() ?? null;
      throw new Error('CRASH_SIMULATED');
    };

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': slowHandler } });
    expect(result.retried).toBe(1);
    expect(seenNextRetryAt).not.toBeNull();
    expect(seenNextRetryAt!).toBeGreaterThanOrEqual(before + CLAIM_LEASE_MS - 1000);
  });

  it('成功路径把上次 last_error 清掉', async () => {
    await emitRow('ob-clear', { lastError: 'OLD' });
    const handler = jest.fn<OutboxHandler>().mockResolvedValue(undefined);
    await runOutboxBatch({ push: okPush, handlers: { 'comment.created': handler } });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-clear'));
    expect(row.status).toBe('done');
    expect(row.lastError).toBeNull();
  });

  it('last_error 截断到 512', async () => {
    await emitRow('ob-long');
    const failing: OutboxHandler = async () => {
      throw new Error('E'.repeat(600));
    };
    await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-long'));
    expect(row.status).toBe('pending');
    expect(row.lastError).toHaveLength(512);
    expect(row.lastError).toBe('E'.repeat(512));
  });

  it('error.name=NonRetryableCompressError → 立即 failed，不占 5 档退避', async () => {
    await emitRow('ob-nrc');
    const failing: OutboxHandler = async () => {
      const err = new Error('bad jpeg');
      err.name = 'NonRetryableCompressError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-nrc'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).toBeNull();
    expect(row.processedAt).not.toBeNull();
    expect(row.lastError).toBe('bad jpeg');
  });

  it('error.name=NonRetryableEmbeddingError → 立即 failed', async () => {
    await emitRow('ob-nre');
    const failing: OutboxHandler = async () => {
      const err = new Error('dim mismatch');
      err.name = 'NonRetryableEmbeddingError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-nre'));
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('dim mismatch');
  });

  it('NonRetryableLLMError 仍走 5 档退避（不扩立即失败）', async () => {
    await emitRow('ob-llm');
    const failing: OutboxHandler = async () => {
      const err = new Error('LLM 4xx');
      err.name = 'NonRetryableLLMError';
      throw err;
    };
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 1, failed: 0 });
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-llm'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('LLM 4xx');
    expect(row.nextRetryAt).not.toBeNull();
  });
});

