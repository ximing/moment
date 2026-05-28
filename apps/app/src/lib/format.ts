function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** happened_at 按记录时的时区偏移展示（spec §5.6：存 UTC，展示用提交方时区）。
 *  与 Phase 6 web 版 formatHappenedAt 同构：shifted 的 UTC 字段才是提交者墙钟，
 *  必须用 getUTC* 取值——用本地 getter 会在非 UTC 设备上再叠加设备时区偏移。 */
export function formatMomentTime(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** 相对时间（通知/评论列表用，设备本地时区）。 */
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
