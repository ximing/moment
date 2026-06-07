import type { MonthIndexResponse } from '@moment/dto';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, momentTags } from '../db/schema.js';

/**
 * 月份索引：按每条钉死的发生地墙钟归桶——
 *   happened_at − INTERVAL happened_tz_offset MINUTE 后取 DATE_FORMAT '%Y-%m'。
 * 查询参数 tz_offset 仍必填（dto 契约），归桶不再用它。
 */
export async function queryMonthIndex(query: {
  chainIds: string[];
  tagId?: string;
  tzOffset: number;
}): Promise<MonthIndexResponse> {
  void query.tzOffset;
  if (query.chainIds.length === 0) return { months: [] };

  const monthExpr = sql<string>`DATE_FORMAT(${moments.happenedAt} - INTERVAL ${moments.happenedTzOffset} MINUTE, '%Y-%m')`;
  const conditions: SQL[] = [inArray(moments.chainId, query.chainIds), isNull(moments.deletedAt)];
  if (query.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db.select({ id: momentTags.momentId }).from(momentTags).where(eq(momentTags.tagId, query.tagId)),
      ),
    );
  }

  const rows = await db
    .select({ month: monthExpr, count: sql<number>`COUNT(*)` })
    .from(moments)
    .where(and(...conditions))
    .groupBy(monthExpr)
    .orderBy(desc(monthExpr));

  return { months: rows.map((r) => ({ month: r.month, count: Number(r.count) })) };
}
