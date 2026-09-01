import type { PublicShareMoment } from '@moment/dto';
import { localDateKey } from '@/lib/time';

export interface MonthGroup {
  month: string;
  moments: PublicShareMoment[];
}

export function groupMomentsByMonth(
  moments: PublicShareMoment[],
  order: 'happened_at' | 'created_at' = 'happened_at',
): MonthGroup[] {
  const byMonth = new Map<string, PublicShareMoment[]>();
  for (const moment of moments) {
    const day =
      order === 'created_at'
        ? localDateKey(moment.createdAt, moment.happenedTzOffset)
        : localDateKey(moment.happenedAt, moment.happenedTzOffset);
    const month = day.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(moment);
    else byMonth.set(month, [moment]);
  }
  return [...byMonth.entries()].map(([month, list]) => ({ month, moments: list }));
}

export function monthHeading(month: string): string {
  const [year, mm] = month.split('-');
  return `${year} · ${Number(mm)} 月`;
}
