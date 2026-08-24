import { char, index, int, mysqlEnum, mysqlTable, primaryKey, timestamp } from 'drizzle-orm/mysql-core';
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
    /** per-user 展示顺序（spec chain-ordering §2）：值越小越靠前，允许负数（新链置顶 min-1）；无唯一约束，reorder 全量重写收敛 */
    sortOrder: int('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.userId] }), index('idx_chain_members_user').on(t.userId)]
);

export type ChainMember = typeof chainMembers.$inferSelect;
