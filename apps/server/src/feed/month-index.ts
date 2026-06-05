import type { MonthIndexResponse } from '@moment/dto';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, momentTags } from '../db/schema.js';

/**
 * 月份索引（spec §4.1）：按「查看者时区」归桶——
 *   happened_at − INTERVAL tz_offset MINUTE 后取 DATE_FORMAT '%Y-%m' 聚合 count。
 * tz_offset 语义同 JS getTimezoneOffset（东八区 = -480），已由 dto 校验为 -840..840 整数。
 *
 * 刻意保留的不一致（spec §4.1 定稿）：索引归桶用查看者时区，而卡片/日期贴纸展示用
 * 作者本地（happened_tz_offset）。跨时区家庭在月首/月末可能差一两条——索引是导航辅助
 * 不是账本，接受。
 */
export async function queryMonthIndex(query: {
  chainIds: string[];
  tagId?: string;
  tzOffset: number;
}): Promise<MonthIndexResponse> {
  if (query.chainIds.length === 0) return { months: [] };

  const monthExpr = sql<string>`DATE_FORMAT(${moments.happenedAt} - INTERVAL ${query.tzOffset} MINUTE, '%Y-%m')`;
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
