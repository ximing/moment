import { char, index, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * 全局 Agent 对话（spec 2026-10-02）。
 * generating_at 用 fsp 3：租约比较的是这一轮写下的 Date，秒级 timestamp 会把毫秒抹掉，finally 对不上自己的租约。
 */
export const agentThreads = mysqlTable(
  'agent_threads',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 80 }).notNull(),
    generatingAt: timestamp('generating_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('idx_agent_threads_user_updated').on(t.userId, t.updatedAt)],
);

export const agentMessages = mysqlTable(
  'agent_messages',
  {
    id: char('id', { length: 36 }).primaryKey(),
    threadId: char('thread_id', { length: 36 })
      .notNull()
      .references(() => agentThreads.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['user', 'assistant']).notNull(),
    content: text('content').notNull(),
    /** 助手消息上的时刻 id，最多 12 个，去重保序。用户消息为 null。 */
    momentIds: json('moment_ids').$type<string[]>(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('idx_agent_messages_thread_created').on(t.threadId, t.createdAt)],
);

export type AgentThreadRow = typeof agentThreads.$inferSelect;
export type AgentMessageRow = typeof agentMessages.$inferSelect;
