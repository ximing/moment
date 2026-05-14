import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { outbox } from '../db/schema.js';
import type { OutboxType } from './types.js';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 在业务事务内调用：同事务写一条 outbox 行（status='pending'）。
 * 事务回滚时本行随之消失，保证「业务写 + 异步副作用意图」原子（spec §5.4）。
 */
export async function emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void> {
  await tx.insert(outbox).values({
    id: randomUUID(),
    type,
    payload,
    status: 'pending',
  });
}

export { OUTBOX_MOMENT_CREATED, OUTBOX_MOMENT_DELETED, type OutboxType } from './types.js';
