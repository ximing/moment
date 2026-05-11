import { char, index, mysqlEnum, mysqlTable, primaryKey, timestamp } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const chainMembers = mysqlTable(
  'chain_members',
  {
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull(),
    joinedAt: timestamp('joined_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.userId] }), index('idx_chain_members_user').on(t.userId)]
);

export type ChainMember = typeof chainMembers.$inferSelect;
