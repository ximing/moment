import { char, index, mysqlTable, text, timestamp } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { users } from './users.js';

export const comments = mysqlTable(
  'comments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    authorId: char('author_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    // precision 3（毫秒）：与 JS Date/getTime()（毫秒）精度完全对齐。裸 timestamp 为 fsp=0 秒级（且四舍五入），同秒多行时 (created_at, id) 排序退化为随机 UUID 序——需要亚秒精度；但**不能用 6（微秒）**：游标编码 getTime() 只取到毫秒，SQL 的 gt/eq/ORDER BY 却用完整微秒值，同毫秒多行跨页会重复（JS Date 层取不回微秒，precision 6 无收益）
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
    /** 软删（spec §5.7）：删除后不出现在列表与计数 */
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [
    // 列表游标按 (created_at, id) 升序扫描
    index('idx_comments_moment_created').on(t.momentId, t.createdAt, t.id),
  ]
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
