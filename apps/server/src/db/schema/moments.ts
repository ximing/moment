import { index, mysqlEnum, mysqlTable, char, int, text, timestamp, boolean } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const moments = mysqlTable(
  'moments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => chains.id),
    authorId: char('author_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => users.id),
    type: mysqlEnum('type', ['text', 'media', 'video']).notNull(),
    content: text('content').notNull(),
    /** 事件发生时间（UTC 存储的时间点，spec §5.6）。fsp=3 保留毫秒：MySQL timestamp 默认 fsp=0 会截断毫秒，
        导致 create 响应（内存 Date 含 ms）与落库后读回不一致 */
    happenedAt: timestamp('happened_at', { mode: 'date', fsp: 3 }).notNull(),
    /** 提交时时区偏移（分钟，供展示），如东八区 = -480 */
    happenedTzOffset: int('happened_tz_offset').notNull(),
    isBackfill: boolean('is_backfill').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [index('idx_moments_chain_happened').on(t.chainId, t.happenedAt, t.id)]
);

export type Moment = typeof moments.$inferSelect;
export type NewMoment = typeof moments.$inferInsert;
