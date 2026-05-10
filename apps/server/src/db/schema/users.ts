import { char, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: char('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  passwordChangedAt: timestamp('password_changed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
