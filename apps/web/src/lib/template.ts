import type { PublicShareMoment, TemplateManifest } from '@moment/dto';
import { localDateKey } from './time';

// 模板相关的纯函数（页面私有逻辑下沉 lib，web CLAUDE.md 放置约束）。
// 全部由 manifest/payload 数据驱动，不出现模板 key 硬编码（spec §5 词表渲染器纪律）。

/** 行程定义（travel 模板链 payload.trips 的元素形状；与 dto chainPayloadSchema 对应）。 */
export interface Trip {
  name: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

/**
 * 宝宝年龄标注（spec §4：birthdate + happened_at 计算，不落库）。
 * 按发生地墙钟日算整月差：日不足向前借一月。未满 1 岁「N 个月」，否则「N 岁 M 个月」（M=0 只显示岁）。
 */
export function babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string {
  const wall = localDateKey(happenedAtIso, tzOffsetMinutes);
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [wy, wm, wd] = wall.split('-').map(Number);
  if (!by || !wy) return '';
  let months = (wy - by) * 12 + (wm - bm);
  if (wd < bd) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${months} 个月`;
  return rest === 0 ? `${years} 岁` : `${years} 岁 ${rest} 个月`;
}

export interface TripSection extends Trip {
  moments: PublicShareMoment[];
}

/**
 * 行程分章（travel 模板 timeline 视图 groupBy:'trips'）：按发生地墙钟日落章，
 * 含首尾日；章节按 start 倒序（新的在前，与时间线同向）；不属于任何行程的进 outside。
 */
export function groupMomentsByTrips(
  moments: PublicShareMoment[],
  trips: Trip[],
): { sections: TripSection[]; outside: PublicShareMoment[] } {
  const sections: TripSection[] = [...trips]
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .map((t) => ({ ...t, moments: [] }));
  const outside: PublicShareMoment[] = [];
  for (const m of moments) {
    const day = localDateKey(m.happenedAt, m.happenedTzOffset);
    const section = sections.find((s) => day >= s.start && day <= s.end);
    if (section) section.moments.push(m);
    else outside.push(m);
  }
  return { sections, outside };
}

/** catalog_key → 目录 label/icon；custom_label / 未知 key 回退原文（与 server milestone-axis 投影同规则）。 */
export function resolveMilestoneLabel(
  manifest: TemplateManifest,
  payload: Record<string, unknown>,
): { label: string; icon: string | null } {
  const catalogKey = typeof payload.catalog_key === 'string' ? payload.catalog_key : undefined;
  const hit = catalogKey ? (manifest.milestoneCatalog ?? []).find((c) => c.key === catalogKey) : undefined;
  if (hit) return { label: hit.label, icon: hit.icon ?? null };
  if (typeof payload.custom_label === 'string') return { label: payload.custom_label, icon: null };
  return { label: catalogKey ?? '', icon: null };
}

/** metric 枚举值 → 中文摘要名（词表内已知值的展示文案；未知值用原文）。组件共享，避免各写一份。 */
export const METRIC_LABELS: Record<string, string> = { height: '身高', weight: '体重' };

/**
 * kind moment 的正文兜底摘要（Global Constraints：text 类型 content 必填，
 * 用户只填结构化字段时用它兜底）。standard / 无法摘要时返回 ''（调用方不兜底）。
 */
export function summarizePayload(
  manifest: TemplateManifest,
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return '';
  if (kind === 'milestone') return resolveMilestoneLabel(manifest, payload).label;
  const metric = typeof payload.metric === 'string' ? payload.metric : undefined;
  if (metric !== undefined && typeof payload.value === 'number') {
    const unit = typeof payload.unit === 'string' ? payload.unit : '';
    return `${METRIC_LABELS[metric] ?? metric} ${payload.value}${unit}`;
  }
  return '';
}
