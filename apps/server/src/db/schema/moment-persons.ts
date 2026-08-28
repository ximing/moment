import { char, index, mysqlEnum, mysqlTable, primaryKey } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { persons } from './persons.js';

/**
 * moment ↔ person 关联（spec people-place §2，镜像 moment_tags）。
 * source=ai 的行被用户手动确认/重选后升级 manual（§5 冲突规则）；同行不允许两 source（PK 保证）。
 * FK 不写 onDelete：链删除 tx 需同步补本表 delete（镜像 tags 范式，P2 落实）。
 */
export const momentPersons = mysqlTable(
  'moment_persons',
  {
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    personId: char('person_id', { length: 36 })
      .notNull()
      .references(() => persons.id),
    source: mysqlEnum('source', ['manual', 'ai']).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.momentId, t.personId] }),
    // M2 按人物圈结果集的驱动索引（spec §2，语义同 idx_moment_tags_tag_moment）
    index('idx_moment_persons_person_moment').on(t.personId, t.momentId),
  ],
);

export type MomentPerson = typeof momentPersons.$inferSelect;
