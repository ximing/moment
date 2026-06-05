import type { MomentResponse } from '@moment/dto';
import { localDateKey } from '@/lib/time';

export interface DateGroup {
  /** YYYY-MM-DD（作者本地墙钟） */
  date: string;
  moments: MomentResponse[];
}

/**
 * 日期分组必须基于 pages.flatMap 后的全量已加载列表计算（spec §3.2）：
 * 用 Map 按 key 归并而非相邻分段——跨页边界的同一天只渲染一枚日期贴纸，
 * key 为日期字符串，新页插入时分组稳定。
 */
export function groupMomentsByDate(moments: MomentResponse[]): DateGroup[] {
  const byDate = new Map<string, MomentResponse[]>();
  for (const m of moments) {
    const key = localDateKey(m.happenedAt, m.happenedTzOffset);
    const list = byDate.get(key);
    if (list) list.push(m);
    else byDate.set(key, [m]);
  }
  return [...byDate.entries()].map(([date, list]) => ({ date, moments: list }));
}
