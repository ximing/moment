import { and, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, momentTags, type Moment } from '../db/schema.js';
import { decodeCursor, encodeCursor, type MomentOrder } from './cursor.js';

export interface MomentPageQuery {
  /** 可见范围（feed=我的链子集；链内列表=单链）。可为空数组：返回空页（游标仍先校验）。 */
  chainIds: string[];
  order: MomentOrder;
  limit: number;
  cursor?: string;
  tagId?: string;
  /** 日期锚定：happened_at < before（严格小于）。仅 happened_at 语义下由调用方传入。 */
  before?: string;
}

export interface MomentPage {
  rows: Moment[];
  nextCursor: string | null;
}

/**
 * feed 与链内 moments 列表共用的分页查询（spec §5.1）：
 * WHERE chain_id IN (...) AND deleted_at IS NULL
 *   AND (time, id) < (cursorTime, cursorId)   -- 复合游标，OR 展开以走索引
 * ORDER BY time DESC, id DESC LIMIT n+1       -- 多取 1 条判断 hasMore
 * tagId 过滤以 moment_tags(tag_id, moment_id) 为驱动表（semi-join 子查询）。
 */
export async function queryMomentPage(query: MomentPageQuery): Promise<MomentPage> {
  // 游标校验前置：即使可见范围为空，坏游标也恒 400 INVALID_CURSOR（而非 200 空列表）
  const cursor = query.cursor ? decodeCursor(query.order, query.cursor) : undefined;
  if (query.chainIds.length === 0) {
    return { rows: [], nextCursor: null };
  }
  const timeCol = query.order === 'happened_at' ? moments.happenedAt : moments.createdAt;

  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];

  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      // or() 的签名返回 SQL | undefined，此处两个参数恒非空，运行时不可能为 undefined，断言安全
      or(
        lt(timeCol, cursorTime),
        and(eq(timeCol, cursorTime), lt(moments.id, cursor.id)),
      ) as SQL,
    );
  }

  // before 与 cursor 共存：两个条件都进 conditions，AND 取更严上界（spec §4.2）。
  // order=created_at + before 已在 feedQuerySchema 层拒绝；链内列表恒 happened_at。
  // 防御：万一未来出现 created_at + before 的调用方，宁可忽略 before 也不对错列做锚定。
  if (query.before && query.order === 'happened_at') {
    conditions.push(lt(moments.happenedAt, new Date(query.before)));
  }

  if (query.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db
          .select({ id: momentTags.momentId })
          .from(momentTags)
          .where(eq(momentTags.tagId, query.tagId)),
      ),
    );
  }

  const rows = await db
    .select()
    .from(moments)
    .where(and(...conditions))
    .orderBy(desc(timeCol), desc(moments.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          query.order,
          (query.order === 'happened_at' ? last.happenedAt : last.createdAt).getTime(),
          last.id,
        )
      : null;
  return { rows: page, nextCursor };
}
