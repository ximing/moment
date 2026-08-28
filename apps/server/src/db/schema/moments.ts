import { boolean, char, date, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const moments = mysqlTable(
  'moments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => chains.id),
    authorId: char('author_id', { length: 36 })
      .notNull()
      .references((): AnyMySqlColumn => users.id),
    type: mysqlEnum('type', ['text', 'media', 'video', 'voice']).notNull(),
    /** 语义类别（spec §1.1）：standard 或链模板 kinds 声明的 key；不进核心索引（spec §2.2） */
    kind: varchar('kind', { length: 64 }).notNull().default('standard'),
    /** 结构化数据（kind 的 payload 或 standard 的扩展字段 mood/geo 等） */
    payload: json('payload').$type<Record<string, unknown>>(),
    content: text('content').notNull(),
    /** ASR 原始转写（spec voice-moment §1）；仅 voice 可能非空，用户不可改（PATCH .strict() 拒绝） */
    transcript: text('transcript'),
    /** 转写状态；仅 voice 非空：创建 pending → done/failed；非 voice 恒 NULL
        （用可空而非 default，避免给 text/media/video 行赋予无意义的转写语义，spec §1） */
    transcriptionStatus: mysqlEnum('transcription_status', ['pending', 'done', 'failed']),
    /** 事件发生时间（UTC 存储的时间点，spec §5.6）。fsp=3 保留毫秒：MySQL timestamp 默认 fsp=0 会截断毫秒，
        导致 create 响应（内存 Date 含 ms）与落库后读回不一致 */
    happenedAt: timestamp('happened_at', { mode: 'date', fsp: 3 }).notNull(),
    /** 提交时时区偏移（分钟，供展示），如东八区 = -480 */
    happenedTzOffset: int('happened_tz_offset').notNull(),
    /** 发生地墙钟日期（'YYYY-MM-DD'）= DATE(happened_at − INTERVAL happened_tz_offset MINUTE)，
        写路径（create/update）随 happenedAt/happenedTzOffset 一并维护的纯冗余投影（那年今日 spec §1）；
        展示仍用 happened_at + happened_tz_offset */
    wallDate: date('wall_date', { mode: 'string' }).notNull(),
    isBackfill: boolean('is_backfill').notNull().default(false),
    /** 地点（spec people-place §2）：WGS-84 原值（EXIF/手动均为 WGS-84 或已换算，§4）。
        place 三列 + place_source 同生同灭（§6 清除语义）。v1 不加 place 索引（§2/§10）。
        mode:'number'：decimal(10,7) 共 10 位有效数字，远在 double 精度内，读写免转换 */
    placeLat: decimal('place_lat', { precision: 10, scale: 7, mode: 'number' }),
    placeLng: decimal('place_lng', { precision: 10, scale: 7, mode: 'number' }),
    /** 展示名（逆地理编码回填或手动/AI 文本） */
    placeName: varchar('place_name', { length: 255 }),
    placeSource: mysqlEnum('place_source', ['manual', 'exif', 'ai']),
    /** 上次 AI 抽取时 sha256(content + '\0' + transcript)（spec §5 幂等判据）；NULL = 从未抽取 */
    aiExtractHash: char('ai_extract_hash', { length: 64 }),
    /** 上次嵌入指纹 sha256(...)（spec fused-retrieval §2.2）；NULL = 从未嵌入。computeEmbedHash 属 P5 */
    embedHash: char('embed_hash', { length: 64 }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [
    index('idx_moments_chain_happened').on(t.chainId, t.happenedAt, t.id),
    index('idx_moments_wall_date').on(t.wallDate),
  ]
);

export type Moment = typeof moments.$inferSelect;
export type NewMoment = typeof moments.$inferInsert;
