import type { MomentResponse, TemplateManifest } from '@moment/dto';

// 模板相关的纯函数（纯逻辑下沉 lib，app CLAUDE.md 放置约束）。
// 与 web 端 lib/template.ts（P4 Task 3）同名同语义——展示层逻辑不进 dto 包
// （dto 是纯契约包），两端各持一份，口径以 P4 已测版本为准。
// 全部由 manifest/payload 数据驱动，不出现模板 key 硬编码（spec §5 词表渲染器纪律）。

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 发生地墙钟日 YYYY-MM-DD（shift 后取 UTC 字段才是提交者墙钟，同 lib/format.ts 的换算手法）。 */
function wallDateKey(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * 宝宝年龄标注（spec §4：birthdate + happened_at 计算，不落库）。
 * 按发生地墙钟日算整月差：日不足向前借一月。未满 1 岁「N 个月」，否则「N 岁 M 个月」（M=0 只显示岁）。
 */
export function babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string {
  const wall = wallDateKey(happenedAtIso, tzOffsetMinutes);
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

/** 行程定义（travel 模板链 payload.trips 的元素形状；与 dto chainPayloadSchema 对应）。 */
export interface Trip {
  name: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

export interface TripSection extends Trip {
  moments: MomentResponse[];
}

/**
 * 行程分章（travel 模板 timeline 视图 groupBy:'trips'）：按发生地墙钟日落章，
 * 含首尾日；章节按 start 倒序（新的在前，与时间线同向）；不属于任何行程的进 outside。
 */
export function groupMomentsByTrips(
  moments: MomentResponse[],
  trips: Trip[],
): { sections: TripSection[]; outside: MomentResponse[] } {
  const sections: TripSection[] = [...trips]
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .map((t) => ({ ...t, moments: [] }));
  const outside: MomentResponse[] = [];
  for (const m of moments) {
    const day = wallDateKey(m.happenedAt, m.happenedTzOffset);
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

/** metric 枚举值 → 中文摘要名（词表内已知值的展示文案；未知值用原文）。 */
export const METRIC_LABELS: Record<string, string> = { height: '身高', weight: '体重' };

/**
 * kind moment 的正文兜底摘要（Global Constraints：text 类型 content 必填，
 * 用户只填结构化字段时用它兜底）。standard / 无法摘要时返回 ''（调用方不兜底）。
 *
 * 分派按 payload 形态而非 kind 名（spec §5）：
 * - 含 catalog_key / custom_label → 里程碑目录解析（milestone 与 career-event 同路径）
 * - 含 topic → 主题摘要（reflection）
 * - metric 分支与未知 payload 返回 '' 的兜底不变
 *
 * `kind` 形参保留以稳住既有调用点签名（泛化后不再参与分派，故 `_kind`）。
 */
export function summarizePayload(
  manifest: TemplateManifest,
  _kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return '';
  if (typeof payload.catalog_key === 'string' || typeof payload.custom_label === 'string') {
    return resolveMilestoneLabel(manifest, payload).label;
  }
  if (typeof payload.topic === 'string') return payload.topic;
  const metric = typeof payload.metric === 'string' ? payload.metric : undefined;
  if (metric !== undefined && typeof payload.value === 'number') {
    const unit = typeof payload.unit === 'string' ? payload.unit : '';
    return `${METRIC_LABELS[metric] ?? metric} ${payload.value}${unit}`;
  }
  return '';
}

/**
 * 链主页时刻卡的结构化摘要行（P3-2 从 MomentCard 内联 IIFE 抽出为纯函数，便于 node vitest 钉住）：
 * 与发布兜底同一函数判重——summary 与 content 逐字相同（trim 后）不重复显示；
 * icon 取自里程碑目录（key / 存量 emoji 两种形态都可能出现，渲染层统一走 AppIcon）；
 * standard 与无法摘要的 kind 返回 null。
 */
export function resolveMomentSummary(
  manifest: TemplateManifest,
  moment: Pick<MomentResponse, 'kind' | 'content' | 'payload'>,
): { icon: string | null; text: string } | null {
  if (moment.kind === 'standard') return null;
  const payload = moment.payload ?? {};
  const text = summarizePayload(manifest, moment.kind, payload);
  if (!text || moment.content.trim() === text) return null;
  const { icon } = resolveMilestoneLabel(manifest, payload); // metric 无 catalog_key → icon 恒 null
  return { icon, text };
}
