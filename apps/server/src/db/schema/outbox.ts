import { char, index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const outbox = mysqlTable(
  'outbox',
  {
    id: char('id', { length: 36 }).primaryKey(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    status: mysqlEnum('status', ['pending', 'done', 'failed']).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { mode: 'date' }),
  },
  (t) => [index('idx_outbox_status_next_retry').on(t.status, t.nextRetryAt)]
);

export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;
