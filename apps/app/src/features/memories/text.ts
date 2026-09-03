import type { MemoriesYearGroup } from '@moment/dto';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 查看者设备本地今天（YYYY-MM-DD）：那年今日查询的 date 参数（spec memories-today §2 查看者时钟）。 */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 路由 param 的 date 形态校验（不合法回退设备本地今天）。 */
export function isDateKey(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export type MemoriesSummary = {
  /** 最近周年距今年数：响应年份倒序，years[0] 即最近周年（spec §5 入口条 {N}）。 */
  yearsAgo: number;
  /** 全部周年分组的总条数（spec §5 入口条 {count}）。 */
  count: number;
};

/** 入口条文案数据；无周年内容返回 null（不渲染、不打扰）。语义与 web src/lib/memories.ts 对齐。 */
export function summarizeMemories(years: MemoriesYearGroup[], today: string): MemoriesSummary | null {
  const nearest = years[0];
  if (!nearest) return null;
  const todayYear = Number(today.slice(0, 4));
  const count = years.reduce((n, g) => n + g.moments.length, 0);
  return { yearsAgo: todayYear - nearest.year, count };
}

/** 入口条文案（spec §5：「{N} 年前的今天有 {count} 条时刻」；日历图标与 → 由组件作装饰单独渲染）。 */
export function memoriesBarText(summary: MemoriesSummary): string {
  return `${summary.yearsAgo} 年前的今天有 ${summary.count} 条时刻`;
}

/** 详情页分组头（与 web §4 面板同语义：「{year} 年 · {n} 条」）。 */
export function yearGroupText(year: number, count: number): string {
  return `${year} 年 · ${count} 条`;
}
