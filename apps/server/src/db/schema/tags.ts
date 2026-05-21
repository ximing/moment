import {
  char,
  index,
  mysqlTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { moments } from './moments.js';

export const tags = mysqlTable(
  'tags',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    name: varchar('name', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uk_tags_chain_name').on(t.chainId, t.name)],
);

export const momentTags = mysqlTable(
  'moment_tags',
  {
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    tagId: char('tag_id', { length: 36 })
      .notNull()
      .references(() => tags.id),
  },
  (t) => [
    primaryKey({ columns: [t.momentId, t.tagId] }),
    // feed tagId 过滤的驱动索引：以 (tag_id, moment_id) 圈出小结果集再回表（spec §5.1）
    index('idx_moment_tags_tag_moment').on(t.tagId, t.momentId),
  ],
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type MomentTag = typeof momentTags.$inferSelect;
