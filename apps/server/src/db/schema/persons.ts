import { char, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

/**
 * 人物词典（spec people-place §2，镜像 tags）：链级作用域。
 * 名归一化（trim + 去内部连续空白）在应用层，不写 DB 函数。
 * FK 不写 onDelete：链删除在 chain.service 删除 tx 内逐表 delete（镜像 tags 范式）。
 */
export const persons = mysqlTable(
  'persons',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    name: varchar('name', { length: 50 }).notNull(),
    /** 可选链接到链成员用户（"爸爸"就是注册用户），供 M3「爸爸发了哪些」类查询 */
    userId: char('user_id', { length: 36 }).references(() => users.id),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  // uk 左前缀已覆盖按 chain_id 过滤，不另建 (chain_id) 索引（与 tags 一致，spec §2）
  (t) => [uniqueIndex('uk_persons_chain_name').on(t.chainId, t.name)],
);

export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;
