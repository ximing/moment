import { char, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { media } from './media.js';
import { users } from './users.js';

export const chains = mysqlTable('chains', {
  id: char('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  /** Phase 2 Global Constraints 注释「media 表属 Phase 3，本阶段不加外键，Phase 3 迁移时补 FK」，本计划兑现。
   *  与 media → moments → chains 构成 ESM 循环引用，安全同上（references 回调惰性求值）。 */
  coverMediaId: char('cover_media_id', { length: 36 }).references((): AnyMySqlColumn => media.id, { onDelete: 'set null' }),
  /** 预设色板值（dto CHAIN_COLORS）；null = 客户端按 id 哈希回退 */
  color: varchar('color', { length: 16 }),
  /** 预设图标 emoji（dto CHAIN_ICONS）；null = 只画色点 */
  icon: varchar('icon', { length: 16 }),
  visibility: mysqlEnum('visibility', ['private', 'link', 'public']).notNull().default('private'),
  /** 链模板 key → templates.key（应用层校验不加 FK，spec §2.2）；创建时选定不可改 */
  template: varchar('template', { length: 64 }).notNull(),
  /** 链级模板数据（宝宝生日、行程列表等），按 manifest.chainPayloadSchema 校验 */
  payload: json('payload').$type<Record<string, unknown>>(),
  ownerId: char('owner_id', { length: 36 })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
});

export type Chain = typeof chains.$inferSelect;
export type NewChain = typeof chains.$inferInsert;
