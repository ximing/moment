import { char, index, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const pushTokens = mysqlTable(
  'push_tokens',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** Expo push token 全局唯一：同 token 换账号 = 重新绑定（upsert 改 user_id） */
    expoToken: varchar('expo_token', { length: 128 }).notNull(),
    platform: mysqlEnum('platform', ['ios', 'android', 'web']).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).notNull().defaultNow(),
    /** receipts 返回 DeviceNotRegistered 时置位，此后不再向该设备推送（spec §3） */
    invalidatedAt: timestamp('invalidated_at', { mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uk_push_tokens_expo_token').on(t.expoToken),
    index('idx_push_tokens_user').on(t.userId),
  ]
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;
