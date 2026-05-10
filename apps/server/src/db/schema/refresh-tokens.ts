import { bigint, char, index, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    deviceInfo: varchar('device_info', { length: 255 }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_refresh_tokens_user').on(t.userId)]
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
