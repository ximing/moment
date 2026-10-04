import {
  char,
  index,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./users.js";

/**
 * 接口令牌。明文只在创建响应里返回一次，库里只存 sha256。
 * 吊销是物理删除，没有 revoked_at。
 */
export const accessTokens = mysqlTable(
  "access_tokens",
  {
    id: char("id", { length: 36 }).primaryKey(),
    userId: char("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    tokenPreview: varchar("token_preview", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_access_tokens_user").on(t.userId)],
);

export type AccessTokenRow = typeof accessTokens.$inferSelect;
