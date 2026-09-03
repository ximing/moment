import type { MemoriesYearGroup } from '@moment/dto';
import { localDateKey } from './time';

/** 查看者本地今天（YYYY-MM-DD）：那年今日查询的 date 参数（spec memories-today §2 查看者时钟）。 */
export function todayKey(now = new Date()): string {
  return localDateKey(now.toISOString(), now.getTimezoneOffset());
}

export type MemoriesSummary = {
  /** 最近周年距今年数：响应年份倒序，years[0] 即最近周年（spec §4 入口条 {N}）。 */
  yearsAgo: number;
  /** 全部周年分组的总条数（spec §4 入口条 {count}）。 */
  count: number;
};

/** 入口条文案数据；无周年内容返回 null（不渲染、不打扰）。 */
export function summarizeMemories(years: MemoriesYearGroup[], today: string): MemoriesSummary | null {
  const nearest = years[0];
  if (!nearest) return null;
  const todayYear = Number(today.slice(0, 4));
  const count = years.reduce((n, g) => n + g.moments.length, 0);
  return { yearsAgo: todayYear - nearest.year, count };
}

/** 入口条文案（spec §4：「{N} 年前的今天 · 共 {count} 条」；日历图标由组件作装饰单独渲染）。 */
export function memoriesBarText(summary: MemoriesSummary): string {
  return `${summary.yearsAgo} 年前的今天 · 共 ${summary.count} 条`;
}
