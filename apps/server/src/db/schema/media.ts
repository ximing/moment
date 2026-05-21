import { bigint, char, index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import type { StorageMetadata } from '../../storage/base.adapter.js';
import { moments } from './moments.js';
import { users } from './users.js';

export const media = mysqlTable(
  'media',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 上传完成绑定前为空（spec §3 media.moment_id 可空） */
    momentId: char('moment_id', { length: 36 }).references((): AnyMySqlColumn => moments.id),
    uploaderId: char('uploader_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** 相对 key（不含 prefix）：tmp/{mediaId}.{ext} → chains/{chainId}/{momentId}/{mediaId}.{ext} */
    s3Key: varchar('s3_key', { length: 512 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: int('width'),
    height: int('height'),
    /** 视频时长（秒），客户端元数据可后补，本阶段允许 null */
    duration: int('duration'),
    /** 视频封面（预留，服务端抽帧二期），不做 FK 以避免自引用循环 */
    posterMediaId: char('poster_media_id', { length: 36 }),
    sortOrder: int('sort_order').notNull().default(0),
    status: mysqlEnum('status', ['uploading', 'ready', 'orphaned']).notNull(),
    /** 写入时存储配置快照（按行签名，spec §5.3） */
    storageMeta: json('storage_meta').$type<StorageMetadata>().notNull(),
    /** S3 multipart uploadId；图片单 PUT 为 null */
    uploadId: varchar('upload_id', { length: 128 }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_media_moment').on(t.momentId),
    index('idx_media_uploader').on(t.uploaderId),
  ]
);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
