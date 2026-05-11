import { char, index, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const chainInvites = mysqlTable(
  'chain_invites',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    // 48 字节随机 base64url（64 字符，~384bit 熵）。MySQL utf8mb4 默认 CI collation 下比较/唯一
    // 会折叠大小写，有效熵略降（~336bit），爆破仍不可行，可接受；share_links 等同型 token 沿用本约定。
    token: char('token', { length: 64 }).notNull().unique(),
    email: varchar('email', { length: 255 }),
    role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),
    createdBy: char('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_chain_invites_chain').on(t.chainId)]
);

export type ChainInvite = typeof chainInvites.$inferSelect;
export type NewChainInvite = typeof chainInvites.$inferInsert;
