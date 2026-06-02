import { char, index, mysqlTable, timestamp } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const shareLinks = mysqlTable(
  'share_links',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    /** 64 字符 hex（randomBytes(32)），不可猜测 + 唯一索引（spec §6） */
    token: char('token', { length: 64 }).notNull().unique(),
    createdBy: char('created_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** null = 永不过期 */
    expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }),
    /** null = 未吊销；吊销置时间戳（一链多链接、单独吊销，spec §1） */
    revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
    /**
     * fsp:3 毫秒精度（本表特例，全仓其余表为秒级）：
     * 1) owner 列表 ORDER BY created_at DESC 在秒级下同秒并列 → filesort 顺序不确定（测试 flaky）；
     * 2) 与 JS Date 毫秒精度一致，ShareLinkService.create 返回内存行与 list 回查行精度自洽。
     */
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('idx_share_links_chain').on(t.chainId)]
);

export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;
