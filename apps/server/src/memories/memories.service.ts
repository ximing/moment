import type { MemoriesTodayResponse, MemoriesYearGroup } from '@moment/dto';
import { and, asc, desc, inArray, isNull } from 'drizzle-orm';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { moments, type Moment } from '../db/schema.js';
import { getMyChains } from '../feed/membership.js';
import { serializeMoments } from '../moments/moment-serializer.js';

/** 固定回溯年数（spec memories-today §3）：家庭产品数据起点远小于此；IN 列表最长 50 项，无性能问题 */
const LOOKBACK_YEARS = 50;

/**
 * 那年今日：date（查看者本地日期）的每个往年同月同日 → 候选 wall_date 串枚举（可 sargable，
 * IN 等值走 idx_moments_wall_date range scan；函数包裹列的写法不走索引，review I1 已修正为枚举）。
 * 仅整数周年：年份严格小于 date 年份。2/29 边界由枚举天然保证——非闰年 Date.UTC 溢出到 3/1，
 * round-trip 校验失败即跳过，候选里只有闰年的 02-29。
 */
function candidateWallDates(date: string): string[] {
  const [y, m, d] = date.split('-').map(Number);
  const candidates: string[] = [];
  for (let year = y - 1; year >= y - LOOKBACK_YEARS; year--) {
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) continue;
    candidates.push(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return candidates;
}

/** 组内墙钟升序的比较键：happened_at − happened_tz_offset（与 wall_date 同一墙钟系） */
function wallClockMs(m: Moment): number {
  return m.happenedAt.getTime() - m.happenedTzOffset * 60_000;
}

@Service()
export class MemoriesService {
  /** 可见范围与 feed 一致（我的链、未软删）；纯读端点，无 outbox 副作用。 */
  async today(userId: string, date: string): Promise<MemoriesTodayResponse> {
    const candidates = candidateWallDates(date);
    const myChains = await getMyChains(userId);
    const scope = [...myChains.keys()];
    if (candidates.length === 0 || scope.length === 0) return { years: [] };

    const rows = await db
      .select()
      .from(moments)
      .where(
        and(
          inArray(moments.chainId, scope),
          isNull(moments.deletedAt),
          inArray(moments.wallDate, candidates),
        ),
      )
      .orderBy(desc(moments.wallDate), asc(moments.happenedAt));

    // 内存按墙钟年份分组：行已按 wall_date 倒序 → Map 插入序即年份倒序；组内再按墙钟时间升序
    const byYear = new Map<number, Moment[]>();
    for (const row of rows) {
      const year = Number(row.wallDate.slice(0, 4));
      const list = byYear.get(year) ?? [];
      list.push(row);
      byYear.set(year, list);
    }

    const years: MemoriesYearGroup[] = [];
    for (const [year, list] of byYear) {
      list.sort((a, b) => wallClockMs(a) - wallClockMs(b));
      years.push({ year, moments: await serializeMoments(list, userId) });
    }
    return { years };
  }
}
