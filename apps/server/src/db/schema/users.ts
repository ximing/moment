import { char, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { media } from './media.js';

export const users = mysqlTable('users', {
  id: char('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  passwordChangedAt: timestamp('password_changed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  /** 头像媒体：Phase 1 Task 4 注释「随媒体阶段迁移补列（media 表）」，本计划兑现。
   *  与 media.ts 存在 ESM 循环引用（media.uploader_id → users），安全：references 回调惰性求值，
   *  模块求值期不触达对方绑定。业务 API（上传/绑定头像）不在本计划范围。 */
  avatarMediaId: char('avatar_media_id', { length: 36 }).references((): AnyMySqlColumn => media.id, { onDelete: 'set null' }),
  /** 头像预设色（dto CHAIN_COLORS）；null = 默认暖黄底 */
  avatarColor: varchar('avatar_color', { length: 16 }),
  /** 头像预设图标；null = 显示昵称首字 */
  avatarIcon: varchar('avatar_icon', { length: 16 }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
