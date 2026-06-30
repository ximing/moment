/**
 * `wall_date` 的 JS 等值（必须与迁移回填公式逐字节一致）：
 *   DATE(happened_at − INTERVAL happened_tz_offset MINUTE)
 * happened_tz_offset 语义同 JS getTimezoneOffset（东八区 = -480），墙钟 = UTC − offset 分钟；
 * 移位后取 UTC 历法日即得 'YYYY-MM-DD'。
 * create / update / 测试夹具 insertMoment 三处写路径必须共用本函数（spec memories-today §1）。
 */
export function wallDateOf(happenedAt: Date, happenedTzOffset: number): string {
  const shifted = new Date(happenedAt.getTime() - happenedTzOffset * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
