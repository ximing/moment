/**
 * 按 moment 提交者的时区展示 happened_at。
 * dto 语义（Phase 3）：happenedTzOffset 同 JS getTimezoneOffset（分钟，东八区 = -480），
 * 故提交者本地墙钟 = UTC 时刻 - offset。
 */
export function formatHappenedAt(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(Date.parse(iso) - tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
    shifted.getUTCHours()
  )}:${pad(shifted.getUTCMinutes())}`;
}

/** 日期分组 key：作者本地墙钟日期（与 formatHappenedAt 同一换算，spec §3.2）。 */
export function localDateKey(iso: string, tzOffsetMinutes: number): string {
  const d = new Date(Date.parse(iso) - tzOffsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 提交 moment 时随表单发送的时区偏移（分钟）。 */
export function currentTzOffset(): number {
  return new Date().getTimezoneOffset();
}

/** 跳到月份 M 的 before 参数（spec §4.3）：M 的下一月月初 00:00（查看者本地）换算 UTC ISO。 */
export function monthBeforeParam(month: string): string {
  const [y, m] = month.split('-').map((s) => Number(s));
  return new Date(y!, m!, 1).toISOString(); // m 为 1-based 月 → Date 的 0-based 恰好是「下一月」
}

/** 从 before 反推锚定月 YYYY-MM（before 恒为「锚定月下一月」1 日本地 00:00 的 ISO，见 monthBeforeParam）。 */
export function monthFromBefore(before: string): string {
  const d = new Date(before);
  // 回退一月得锚定月（setMonth 自动处理跨年：1 月回退到上年 12 月；
  // 直接取 getMonth() 的 0-based 巧合写法在 12 月锚定时会得到 'YYYY-00'，不可用）
  d.setMonth(d.getMonth() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
