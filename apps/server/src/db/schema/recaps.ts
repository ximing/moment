import { char, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';

/**
 * AI 月度回顾（spec §2）。
 * period = char(7) YYYY-MM，按 moment 的 wall_date 归属月份。
 * UNIQUE(chain_id, period)：重生成 = upsert（覆盖 content/highlights/status，保留 created_at）。
 * FK ON DELETE CASCADE：软删链的 recaps 随链硬删级联（链删除是硬删语义，spec §2）。
 */
export const recaps = mysqlTable(
  'recaps',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => chains.id, { onDelete: 'cascade' }),
    /** YYYY-MM（char(7)，按 wall_date 归属月，spec §2） */
    period: char('period', { length: 7 }).notNull(),
    status: mysqlEnum('status', ['generating', 'ready', 'failed', 'degraded']).notNull().default('generating'),
    /** Markdown 正文（spec §2 content text） */
    content: text('content').notNull(),
    /**
     * 引用的 moment id 有序列表（客户端渲染「高光时刻」跳转，spec §2/§7）。
     * spec §4 写 `highlight_moment_ids: number[]`，但 moments.id 是 char(36) UUID，
     * 故类型为 string[]（spec 笔误的机械修正，非设计发明）。
     */
    highlights: json('highlights').$type<string[]>().notNull().default([]),
    /** 实际使用的模型名（审计）；failed/degraded 时为 null */
    model: varchar('model', { length: 255 }),
    /** prompt 模板版本（重生成对比用） */
    promptVersion: int('prompt_version').notNull().default(1),
    /** token 用量 {prompt, completion, total}（成本核算）；failed/degraded 时为 null。
     *  透传 LLMChatResponse.usage（shape 一致，T3 末尾 S5 注），不重发明字段名。 */
    tokenUsage: json('token_usage').$type<{ prompt: number; completion: number; total: number }>(),
    /** failed 时的摘要；非 failed 为 null */
    error: text('error'),
    /** 生成完成时间；generating/failed 时为 null */
    generatedAt: timestamp('generated_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex('idx_recaps_chain_period').on(t.chainId, t.period)]
);

export type Recap = typeof recaps.$inferSelect;
export type NewRecap = typeof recaps.$inferInsert;
