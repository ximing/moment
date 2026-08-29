import { and, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { momentPersons, moments, momentTags, type Moment } from '../db/schema.js';
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
  /** GET chip 单个人物（spec §6.1）；semi-join moment_persons，同 tagId。 */
  personId?: string;
  /** GET chip 地点整串相等（spec §0/§6.1），零命中空页。 */
  place?: string;
  /** happened_at 闭区间下界（ISO）。仅 order=happened_at 时生效。 */
  happenedFrom?: string;
  /** happened_at 闭区间上界（ISO）。仅 order=happened_at 时生效。 */
  happenedTo?: string;
}

export interface MomentPage {
  rows: Moment[];
  nextCursor: string | null;
}

/**
 * feed 与链内 moments 列表共用的分页查询（spec §5.1 / fused-retrieval §6.1）：
 * WHERE chain_id IN (...) AND deleted_at IS NULL
 *   AND (time, id) < (cursorTime, cursorId)
 *   AND 可选 tagId / personId / place / happenedFrom / happenedTo / before
 * ORDER BY time DESC, id DESC LIMIT n+1
 */
export async function queryMomentPage(query: MomentPageQuery): Promise<MomentPage> {
  const cursor = query.cursor ? decodeCursor(query.order, query.cursor) : undefined;
  if (query.chainIds.length === 0) {
    return { rows: [], nextCursor: null };
  }
  const timeCol = query.order === 'happened_at' ? moments.happenedAt : moments.createdAt;

  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];

  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      or(
        lt(timeCol, cursorTime),
        and(eq(timeCol, cursorTime), lt(moments.id, cursor.id)),
      ) as SQL,
    );
  }

  // before 与 cursor / happenedTo 共存：全部 AND，取更严上界（spec §6.1）。
  // order=created_at + before/区间 已在 feedQuerySchema 层拒绝。
  // 防御：不对 created_at 列做 happened_at 锚定。
  if (query.before && query.order === 'happened_at') {
    conditions.push(lt(moments.happenedAt, new Date(query.before)));
  }

  if (query.happenedFrom && query.order === 'happened_at') {
    conditions.push(gte(moments.happenedAt, new Date(query.happenedFrom)));
  }
  if (query.happenedTo && query.order === 'happened_at') {
    conditions.push(lte(moments.happenedAt, new Date(query.happenedTo)));
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

  if (query.personId) {
    conditions.push(
      inArray(
        moments.id,
        db
          .select({ id: momentPersons.momentId })
          .from(momentPersons)
          .where(eq(momentPersons.personId, query.personId)),
      ),
    );
  }

  if (query.place) {
    conditions.push(eq(moments.placeName, query.place));
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
