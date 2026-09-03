import type { TemplateManifest } from '@moment/dto';
import { char, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const templates = mysqlTable('templates', {
  id: char('id', { length: 36 }).primaryKey(),
  /**
   * 全局唯一。official：保留 slug（baby/travel/daily）；user：server 分配 `u_<21 位十六进制随机>`。
   * 用 `u_` 不用 `u/`：`:key` 路由参数不匹配含 `/` 的路径段（spec §2.1 同口径）。
   */
  key: varchar('key', { length: 64 }).notNull().unique(),
  scope: mysqlEnum('scope', ['official', 'user']).notNull(),
  /** user 模板创建者；official 为 null */
  ownerId: char('owner_id', { length: 36 }).references(() => users.id),
  name: varchar('name', { length: 50 }).notNull(),
  description: varchar('description', { length: 500 }),
  /** icon key（词表注册表 key，如 tpl-baby）或单个 emoji；dto 层 1–50 字符（spec §2.1「禁 URL」） */
  icon: varchar('icon', { length: 50 }).notNull(),
  /** 纯数据 DSL manifest（spec §1.3），写入前已过 validateManifest（Task 3） */
  manifest: json('manifest').$type<TemplateManifest>().notNull(),
  /** manifest 版本：仅 manifest 变更时 +1（spec §3.4）；name/description/icon 变更不 bump */
  version: int('version').notNull().default(1),
  /** archive 不影响存量链，只阻止新建链选用（spec §3.4）；不物理删除 */
  status: mysqlEnum('status', ['active', 'archived']).notNull().default('active'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
