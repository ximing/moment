import { z } from 'zod';
import type { MomentResponse } from './moments.js';

/**
 * 「那年今日」查询参数（spec memories-today §2）。
 *
 * 两套时钟语义（review I5，显式决策）：
 * - `date` = **查看者本地日期**（viewer clock），客户端取设备当天；
 * - 匹配目标 `moments.wall_date` = **记录者**时区墙钟日期（recorder clock，
 *   = DATE(happened_at − INTERVAL happened_tz_offset MINUTE)）。
 * 跨时区家庭中，同一时刻对不同成员的「那年今日」集合可能不同（贴近当地午夜的记录，
 * 对某成员算昨天/今天不同侧）。这是有意选择：回忆锚定「发生地那一天」，
 * 与 month-index 的墙钟归桶语义一致。
 */
export const memoriesTodayQuerySchema = z.object({
  /** 查看者本地日期 YYYY-MM-DD；非法 → INVALID_DATE */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
    // 正则只限定形态；2026-02-30 这类不存在的日子需按历法round-trip拒绝（Date.parse 会归一化到 3/2 而非 NaN）
    .refine(
      (v) => {
        const [y, m, d] = v.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
      },
      { message: 'INVALID_DATE' },
    ),
});
export type MemoriesTodayQuery = z.infer<typeof memoriesTodayQuerySchema>;

export interface MemoriesYearGroup {
  /** 墙钟年份（= moment 发生年份） */
  year: number;
  /** 组内按墙钟时间升序 */
  moments: MomentResponse[];
}

export interface MemoriesTodayResponse {
  /** 年份倒序；仅含有内容的整数周年（年份严格小于 date 年份） */
  years: MemoriesYearGroup[];
}
