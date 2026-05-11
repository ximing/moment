import { char, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const chains = mysqlTable('chains', {
  id: char('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  // 引用未来的 media.id——media 表属 Phase 3，本阶段不加外键，Phase 3 迁移时补 FK。
  coverMediaId: char('cover_media_id', { length: 36 }),
  visibility: mysqlEnum('visibility', ['private', 'link', 'public']).notNull().default('private'),
  ownerId: char('owner_id', { length: 36 })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
});

export type Chain = typeof chains.$inferSelect;
export type NewChain = typeof chains.$inferInsert;
