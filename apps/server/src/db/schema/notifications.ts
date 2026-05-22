import { char, index, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const notifications = mysqlTable(
  'notifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** 通知类型（'moment.created' 等），维度可扩展（spec §5.4，为链免打扰预留） */
    type: varchar('type', { length: 32 }).notNull(),
    /** 标题快照（链名/昵称/摘要），资源删除后仍可展示（spec §3） */
    payload: json('payload').notNull(),
    readAt: timestamp('read_at', { mode: 'date' }),
    // precision 3（毫秒）：与游标编码 getTime()（毫秒）精度对齐，降序 (created_at, id) 游标比较/排序三者一致；不用 6 的理由同 comments.created_at 注释
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  // 未读列表/未读数高频查询（spec §3）
  (t) => [index('idx_notifications_user_read').on(t.userId, t.readAt)]
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
