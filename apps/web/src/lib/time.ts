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
