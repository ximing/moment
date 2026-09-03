import { and, asc, eq, inArray, isNull, like, type SQL } from 'drizzle-orm';
import { Container } from 'typedi';
import type { Period } from '@moment/dto';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { chains, comments, moments, users } from '../../db/schema.js';
import { TemplateService } from '../../templates/template.service.js';

/**
 * 单条 moment 序列化结果（spec §4.2）。
 * line = `[MM-DD HH:mm] {作者昵称}` + 正文 + kind 标记 + payload 摘要（单行）。
 */
export interface SerializedMoment {
  line: string;
  momentId: string;
  /** 精选评论：每条 ≤100 字、≤2 条（按 createdAt 升序，未软删） */
  comments: string[];
}

/**
 * LLM 输入（spec §4）。
 * mediaRefs v1 恒为 []（视觉预留，接口不变——spec §3 写 media_id: number，但 media.id 是 char36，故 string，同 highlights 偏差）。
 */
export interface RecapInput {
  moments: SerializedMoment[];
  period: Period;
  chainName: string;
  /** baby 模板注入：宝宝 birthdate 换算的 period 末月龄（如「本期末 1 岁 3 个月」） */
  babyAge?: string;
  mediaRefs: { media_id: string; kind: 'image' }[];
  truncated: { moments: boolean; chars: boolean; count: number };
}

/** 载入链信息 + 模板 manifest（milestoneCatalog 用于摘要目录 label 解析；kindLabels 用于摘要 kind 前缀） */
async function loadChainMeta(chainId: string): Promise<{
  chainName: string;
  chainPayload: Record<string, unknown> | null;
  templateKey: string;
  milestoneCatalog: Map<string, { label: string; icon: string | null }>;
  kindLabels: Map<string, string>;
}> {
  const [chain] = await db
    .select({ name: chains.name, payload: chains.payload, template: chains.template })
    .from(chains)
    .where(eq(chains.id, chainId))
    .limit(1);
  if (!chain) throw new Error(`chain not found: ${chainId}`);
  const manifest = (await Container.get(TemplateService).getByKey(chain.template)).manifest;
  const catalog = new Map(
    (manifest.milestoneCatalog ?? []).map((c) => [c.key, { label: c.label, icon: c.icon ?? null }]),
  );
  const kindLabels = new Map((manifest.kinds ?? []).map((k) => [k.key, k.label]));
  return {
    chainName: chain.name,
    chainPayload: chain.payload ?? null,
    templateKey: chain.template,
    milestoneCatalog: catalog,
    kindLabels,
  };
}

/** 取该链 wall_date 落 period 内的未软删 moments（按 happened_at 正序，spec §4.1）。 */
async function loadMomentsInPeriod(chainId: string, period: string) {
  // wall_date = 'YYYY-MM-DD'，period = 'YYYY-MM'，前缀匹配
  return db
    .select({
      id: moments.id,
      authorId: moments.authorId,
      content: moments.content,
      happenedAt: moments.happenedAt,
      /** 提交时时区偏移（分钟），如东八区 = -480（moments.happenedTzOffset，schema moments.ts L26）。
       *  formatLine 用它与 wall_date 同一墙钟系（wall_date = DATE(happened_at − INTERVAL happened_tz_offset MINUTE)，见 moments/wall-date.ts） */
      happenedTzOffset: moments.happenedTzOffset,
      kind: moments.kind,
      payload: moments.payload,
    })
    .from(moments)
    .where(
      and(
        eq(moments.chainId, chainId),
        isNull(moments.deletedAt),
        like(moments.wallDate, `${period}-%`) as SQL,
      ),
    )
    .orderBy(asc(moments.happenedAt), asc(moments.id));
}

/** 取这些 moments 的精选评论（每 moment ≤2 条、≤100 字、未软删、createdAt 升序）。 */
async function loadTopComments(momentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (momentIds.length === 0) return map;
  const rows = await db
    .select({ momentId: comments.momentId, content: comments.content })
    .from(comments)
    .where(and(inArray(comments.momentId, momentIds), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  for (const r of rows) {
    const arr = map.get(r.momentId) ?? [];
    if (arr.length < 2) {
      arr.push(r.content.length > 100 ? `${r.content.slice(0, 100)}…` : r.content);
    }
    map.set(r.momentId, arr);
  }
  return map;
}

/** payload 摘要（spec §4.2 + 2026-09-03 §5 泛化：按 payload 形态分派，前缀取 kind 在 manifest 中的 label）。 */
function summarizePayload(
  kind: string,
  payload: Record<string, unknown> | null,
  milestoneCatalog: Map<string, { label: string; icon: string | null }>,
  kindLabels: Map<string, string>,
): string {
  if (!payload) return '';
  // 含 catalog_key / custom_label → 目录解析（milestone →【里程碑】、career-event →【职业事件】）
  if (typeof payload.catalog_key === 'string' || typeof payload.custom_label === 'string') {
    const catalogKey = payload.catalog_key as string | undefined;
    const hit = catalogKey ? milestoneCatalog.get(catalogKey) : undefined;
    const label = hit?.label ?? (payload.custom_label as string | undefined) ?? catalogKey ?? '';
    return `【${kindLabels.get(kind) ?? kind}】${label}`;
  }
  // 含 topic → 主题摘要（reflection →【思考】）
  if (typeof payload.topic === 'string') {
    return `【${kindLabels.get(kind) ?? kind}】${payload.topic}`;
  }
  switch (kind) {
    case 'metric': {
      const metric = String(payload.metric ?? '');
      const value = payload.value;
      const unit = String(payload.unit ?? '');
      return `【记录】${metric} ${value}${unit}`;
    }
    case 'standard': {
      // daily 的 mood、travel 的 geo 在 standard payload 内
      const mood = payload.mood;
      if (typeof mood === 'string') return `【心情】${mood}`;
      const geo = payload.geo as { place_name?: string; lat?: number; lng?: number } | undefined;
      if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
        return `【位置】${geo.place_name ?? ''}`;
      }
      return '';
    }
    default:
      return '';
  }
}

/** 作者昵称查询（一次 IN 查询，复用 handler loadSnapshot 思路）。 */
async function loadNicknames(authorIds: string[]): Promise<Map<string, string>> {
  if (authorIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(inArray(users.id, authorIds));
  return new Map(rows.map((r) => [r.id, r.nickname]));
}

/**
 * 序列化单行（spec §4.2）：`[MM-DD HH:mm] {昵称}` + 正文 + payload 摘要。
 *
 * 时间显示按**本地时区**（与 wall_date 同一墙钟系），非 UTC——否则非零 tzOffset 的家庭
 * （如东八区 -480）会看到 wall_date 落 7 月但 `[06-30 ...]` 的 UTC 时间，日期与归属月不一致。
 *
 * 墙钟偏移与 wall_date 同公式（moments/wall-date.ts）：
 *   wall_date = DATE(happened_at − INTERVAL happened_tz_offset MINUTE)
 *   localMs   = happenedAt.getTime() − happenedTzOffset * 60_000
 * （happenedTzOffset 语义同 JS getTimezoneOffset：东八区 = -480，减去 -480 = +480min 即东移到本地）
 * 偏移后用 UTC 历法读法取 MM/DD/HH/mm，得到的就是本地墙钟时间，日期与 wall_date 一致。
 */
function formatLine(
  happenedAt: Date,
  happenedTzOffset: number,
  nickname: string,
  content: string,
  payloadSummary: string,
): string {
  const localMs = happenedAt.getTime() - happenedTzOffset * 60_000;
  const local = new Date(localMs);
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const min = String(local.getUTCMinutes()).padStart(2, '0');
  const summary = payloadSummary ? ` ${payloadSummary}` : '';
  return `[${mm}-${dd} ${hh}:${min}] ${nickname}${summary} ${content}`.trim();
}

/** baby 模板：birthdate 换算 period 末月龄（spec §4 末）。 */
function computeBabyAge(birthdate: string, period: string): string {
  // period = 'YYYY-MM'，period 末 = 下月 1 号
  const [y, m] = period.split('-').map(Number);
  const periodEnd = new Date(Date.UTC(y, m, 1)); // 下月 1 号（m 已是 1-12，Date.UTC month 0-based 故直接用）
  const birth = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return '';
  let years = periodEnd.getUTCFullYear() - birth.getUTCFullYear();
  let months = periodEnd.getUTCMonth() - birth.getUTCMonth();
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years <= 0 && months <= 0) return '';
  const yPart = years > 0 ? `${years} 岁 ` : '';
  return `${yPart}${months} 个月`;
}

/**
 * 组装 recap 输入（spec §4）。
 * @param opts.maxMoments / maxChars 测试注入点（默认读 config）；生产路径由 generateRecap 调用不传。
 */
export async function buildRecapInput(
  chainId: string,
  period: Period,
  opts: { maxMoments?: number; maxChars?: number } = {},
): Promise<RecapInput> {
  const maxMoments = opts.maxMoments ?? config.LLM_RECAP_MAX_MOMENTS;
  const maxChars = opts.maxChars ?? config.LLM_RECAP_MAX_CHARS;

  const meta = await loadChainMeta(chainId);
  const rows = await loadMomentsInPeriod(chainId, period);
  const momentIds = rows.map((r) => r.id);
  const commentMap = await loadTopComments(momentIds);
  const nicknameMap = await loadNicknames(rows.map((r) => r.authorId));

  // 序列化每条 moment（含 payload 摘要 + 评论）
  const serialized: Array<SerializedMoment & { hasPayload: boolean; commentCount: number; happenedAt: Date }> =
    rows.map((r) => {
      const payloadSummary = summarizePayload(r.kind, r.payload, meta.milestoneCatalog, meta.kindLabels);
      const nickname = nicknameMap.get(r.authorId) ?? '';
      const cms = commentMap.get(r.id) ?? [];
      return {
        line: formatLine(r.happenedAt, r.happenedTzOffset, nickname, r.content, payloadSummary),
        momentId: r.id,
        comments: cms,
        hasPayload: payloadSummary !== '',
        commentCount: cms.length,
        happenedAt: r.happenedAt,
      };
    });

  // 截断护栏 1：超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取（spec §4.4）
  let truncatedMoments = false;
  let kept = serialized;
  if (serialized.length > maxMoments) {
    truncatedMoments = true;
    kept = [...serialized]
      .sort((a, b) => {
        // hasPayload 降序、commentCount 降序、happenedAt 正序（稳定）
        if (a.hasPayload !== b.hasPayload) return a.hasPayload ? -1 : 1;
        if (a.commentCount !== b.commentCount) return b.commentCount - a.commentCount;
        return a.happenedAt.getTime() - b.happenedAt.getTime();
      })
      .slice(0, maxMoments);
  }

  // 截断护栏 2：总字符超 MAX_CHARS 二次截断（spec §4.4）
  let truncatedChars = false;
  const totalChars = kept.reduce((sum, m) => sum + m.line.length + m.comments.join('').length, 0);
  if (totalChars > maxChars) {
    truncatedChars = true;
    let acc = 0;
    const trimmed: typeof kept = [];
    for (const m of kept) {
      const size = m.line.length + m.comments.join('').length;
      if (acc + size > maxChars && trimmed.length > 0) break;
      trimmed.push(m);
      acc += size;
    }
    kept = trimmed;
  }

  // baby 模板注入月龄
  let babyAge: string | undefined;
  if (meta.templateKey === 'baby' && meta.chainPayload) {
    const birthdate = meta.chainPayload.birthdate as string | undefined;
    if (birthdate) babyAge = computeBabyAge(birthdate, period);
  }

  return {
    moments: kept.map(({ line, momentId, comments }) => ({ line, momentId, comments })),
    period,
    chainName: meta.chainName,
    babyAge,
    mediaRefs: [], // v1 恒为空（视觉预留，spec §3）
    truncated: { moments: truncatedMoments, chars: truncatedChars, count: kept.length },
  };
}
