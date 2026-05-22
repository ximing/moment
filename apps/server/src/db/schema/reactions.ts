import { char, index, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { users } from './users.js';

export const reactions = mysqlTable(
  'reactions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // 换表情 = upsert 依赖此唯一键（spec §3）
    uniqueIndex('uk_reactions_moment_user').on(t.momentId, t.userId),
    // 批量计数 GROUP BY(moment_id, emoji) 的支撑索引
    index('idx_reactions_moment').on(t.momentId),
  ]
);

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;
