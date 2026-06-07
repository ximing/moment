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

/** 卡片上的发生时刻：钉死的发生地墙钟，不展示时区本身。 */
export function formatHappenedClock(iso: string, tzOffsetMinutes: number): string {
  const wall = wallDate(iso, tzOffsetMinutes);
  const h = wall.getUTCHours();
  const m = String(wall.getUTCMinutes()).padStart(2, '0');
  const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const clock = `${period} ${h12}:${m}`;
  const now = new Date();
  const viewerToday = localDateKey(now.toISOString(), now.getTimezoneOffset());
  const eventDay = localDateKey(iso, tzOffsetMinutes);
  if (eventDay === viewerToday) return clock;
  const date =
    wall.getUTCFullYear() === now.getFullYear()
      ? `${wall.getUTCMonth() + 1}月${wall.getUTCDate()}日`
      : `${wall.getUTCFullYear()}年${wall.getUTCMonth() + 1}月${wall.getUTCDate()}日`;
  return `${date} ${clock}`;
}

function wallDate(iso: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(iso) - tzOffsetMinutes * 60_000);
}

export type DayHeading = {
  kind: 'today' | 'yesterday' | 'other';
  title: string;
  sub: string;
};

/** 查看者本地的今天/昨天 vs 分组 key（发生地墙钟日期）。 */
export function dayHeading(dateKey: string, now = new Date()): DayHeading {
  const viewerOffset = now.getTimezoneOffset();
  const today = localDateKey(now.toISOString(), viewerOffset);
  const yest = new Date(now.getTime() - 864e5);
  const yesterday = localDateKey(yest.toISOString(), yest.getTimezoneOffset());
  const [Y, M, D] = dateKey.split('-').map(Number);
  const weekday = '日一二三四五六'[new Date(Y!, (M ?? 1) - 1, D ?? 1).getDay()] ?? '';
  if (dateKey === today) return { kind: 'today', title: '今天', sub: `${Number(M)}月${Number(D)}日 周${weekday}` };
  if (dateKey === yesterday) return { kind: 'yesterday', title: '昨天', sub: `${Number(M)}月${Number(D)}日 周${weekday}` };
  return { kind: 'other', title: `${Number(M)}月${Number(D)}日`, sub: `周${weekday}` };
}

/** 日期分组 key：发生地墙钟日期（iso − happenedTzOffset）。 */
export function localDateKey(iso: string, tzOffsetMinutes: number): string {
  const d = wallDate(iso, tzOffsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 提交 moment 时随表单发送的时区偏移（分钟）。 */
export function currentTzOffset(): number {
  return new Date().getTimezoneOffset();
}

/** 钉死偏移下的墙钟，给发生时间输入 / 比较用（YYYY-MM-DDTHH:mm）。 */
export function toWallClockInput(iso: string, tzOffsetMinutes: number): string {
  const wall = wallDate(iso, tzOffsetMinutes);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}T${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}`;
}

/** 墙钟 YYYY-MM-DDTHH:mm + 钉死偏移 → UTC ISO。offset 语义同 getTimezoneOffset。 */
export function wallClockToIso(wall: string, tzOffsetMinutes: number): string {
  const civil = wall.length === 16 ? `${wall}:00Z` : wall.endsWith('Z') ? wall : `${wall}Z`;
  const ms = Date.parse(civil);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + tzOffsetMinutes * 60_000).toISOString();
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
