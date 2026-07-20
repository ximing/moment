import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Period } from '@moment/dto';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { recaps } from '../../db/schema.js';
import { getLLMProvider } from '../factory.js';
import { NonRetryableLLMError, type LLMProvider } from '../base.provider.js';
import { buildRecapInput, type RecapInput } from './input.js';
import { PROMPT_VERSION, buildSystemPrompt, buildUserPrompt } from './prompt.js';

/** 解析 LLM 返回的 JSON（容错：去除可能的 markdown 代码块包裹）。 */
interface ParsedRecap {
  content: string;
  highlight_moment_ids: string[];
}

function parseRecapJson(raw: string): ParsedRecap | null {
  let text = raw.trim();
  // 容错：去除 ```json ... ``` 包裹
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.content !== 'string') return null;
    const ids = o.highlight_moment_ids;
    if (!Array.isArray(ids)) return null;
    // 全部成员必须是 string（防 number 混入）
    const strIds = ids.filter((x): x is string => typeof x === 'string');
    return { content: o.content, highlight_moment_ids: strIds };
  } catch {
    return null;
  }
}

/**
 * 预算降级规则文案（spec §5）。
 * 用结构化数据直出：「本月记录 N 条，里程碑：……」+ 标注非 AI 生成。
 * highlights 填结构化记录（milestone/metric）的 moment id，供客户端渲染高光跳转。
 */
export function buildDegradedContent(input: RecapInput): { content: string; highlights: string[] } {
  const lines: string[] = [];
  lines.push(`# ${input.chainName} ${input.period} 月度回顾`);
  lines.push('');
  lines.push(`本月记录 ${input.truncated.count} 条时刻。`);
  if (input.babyAge) {
    lines.push(`宝宝月龄：本期末 ${input.babyAge}。`);
  }
  lines.push('');

  // 提取里程碑（line 含【里程碑】）
  const milestones = input.moments.filter((m) => m.line.includes('【里程碑】'));
  if (milestones.length > 0) {
    lines.push('## 里程碑');
    for (const m of milestones) {
      // line 格式 [MM-DD HH:mm] 昵称 【里程碑】{label} 正文
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  // 提取记录（metric）
  const metrics = input.moments.filter((m) => m.line.includes('【记录】'));
  if (metrics.length > 0) {
    lines.push('## 成长记录');
    for (const m of metrics) {
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  // 普通时刻摘要
  const standards = input.moments.filter((m) => !m.line.includes('【'));
  if (standards.length > 0) {
    lines.push('## 时刻');
    for (const m of standards) {
      lines.push(`- ${m.line}`);
    }
    lines.push('');
  }

  lines.push('> 本文为规则模板生成，非 AI 生成（预算降级）。');

  // highlights = 里程碑 + metric 的 moment id（结构化记录优先）
  const highlights = input.moments
    .filter((m) => m.line.includes('【里程碑】') || m.line.includes('【记录】'))
    .map((m) => m.momentId);

  return { content: lines.join('\n'), highlights };
}

/**
 * 查**当前运行月**全局 token 消耗（SUM token_usage.total 按 generated_at 当月聚合，spec §5「当月」）。
 *
 * spec §5「当月全局 token 消耗…按 generated_at 月聚合」= 当前运行月，**非 period 月**：
 * sweep 在 8 月生成 7 月回顾时，应查 8 月（当前月）已消耗的 token，不是 7 月（period 月）。
 * 用 new Date() 取当前月开窗（UTC 月边界），不取 period。
 *
 * drizzle 对 json 列无原生 JSON_EXTRACT，取出应用层求和（recaps 行数有限，可接受）。
 */
async function monthlyTokenUsage(): Promise<number> {
  // 当前运行月开窗（spec §5「当月」= 当前运行月）
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await db
    .select({ tokenUsage: recaps.tokenUsage })
    .from(recaps)
    .where(
      and(
        eq(recaps.status, 'ready'),
        isNotNull(recaps.generatedAt),
        sql`${recaps.generatedAt} >= ${start}`,
        sql`${recaps.generatedAt} < ${end}`,
      ),
    );
  return rows.reduce((sum, r) => sum + (r.tokenUsage?.total ?? 0), 0);
}

/** upsert recaps 行（ON DUPLICATE KEY UPDATE，spec §2）。保留 created_at。 */
async function upsertRecap(row: {
  chainId: string;
  period: string;
  status: 'ready' | 'failed' | 'degraded';
  content: string;
  highlights: string[];
  model: string | null;
  promptVersion: number;
  tokenUsage: { prompt: number; completion: number; total: number } | null;
  error: string | null;
  generatedAt: Date;
}): Promise<void> {
  const now = new Date();
  // 先查是否存在（保留 created_at）
  const [existing] = await db
    .select({ id: recaps.id, createdAt: recaps.createdAt })
    .from(recaps)
    .where(and(eq(recaps.chainId, row.chainId), eq(recaps.period, row.period)))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.createdAt ?? now;

  await db
    .insert(recaps)
    .values({
      id,
      chainId: row.chainId,
      period: row.period,
      status: row.status,
      content: row.content,
      highlights: row.highlights,
      model: row.model,
      promptVersion: row.promptVersion,
      tokenUsage: row.tokenUsage,
      error: row.error,
      generatedAt: row.generatedAt,
      createdAt,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: row.status,
        content: row.content,
        highlights: row.highlights,
        model: row.model,
        promptVersion: row.promptVersion,
        tokenUsage: row.tokenUsage,
        error: row.error,
        generatedAt: row.generatedAt,
        updatedAt: now,
      },
    });
}

/**
 * 生成 recap（spec §5）。
 *
 * 流程：
 * 1. provider 为 null（空 key 停用）→ 降级路径（status=degraded，不调 provider，token_usage=null，model=null）。
 * 2. 查当前运行月全局 token 消耗超 budget（>0 时）→ 降级路径（spec §5「当月」= 当前运行月，非 period 月）。
 * 3. 否则 build input → provider.chat → 解析 JSON（失败重试一次，再失败 status=failed 落 error 摘要）。
 * 4. provider.chat 抛 NonRetryableLLMError → 落 failed 行后正常返回（不 rethrow；与 parse 失败同范式，
 *    generateRecap 拥有所有 recaps 行写入）。RetryableLLMError 传播给 handler 走 processor 退避。
 * 5. highlight_moment_ids 过滤掉不属于该链该月的 id（幻觉防线，spec §4.5）。
 * 6. upsert recaps 行（status=ready，落 content/highlights/model/promptVersion/tokenUsage/generatedAt）。
 *
 * @param opts.provider 测试注入点（默认 getLLMProvider()）。传 null 强制降级路径。
 * @param opts.budgetOverride 测试注入点（默认 config.LLM_MONTHLY_TOKEN_BUDGET）。config 在 import 时 parse 无法 env 覆盖，故提供注入点。
 */
export async function generateRecap(
  chainId: string,
  period: Period,
  opts: { provider?: LLMProvider | null; budgetOverride?: number } = {},
): Promise<void> {
  const input = await buildRecapInput(chainId, period);
  const provider = opts.provider !== undefined ? opts.provider : getLLMProvider();

  // 降级路径 1：provider 为 null（空 key 停用，spec §3/§8）
  if (provider === null) {
    const { content, highlights } = buildDegradedContent(input);
    await upsertRecap({
      chainId, period, status: 'degraded', content, highlights,
      model: null, promptVersion: PROMPT_VERSION, tokenUsage: null, error: null,
      generatedAt: new Date(),
    });
    return;
  }

  // 降级路径 2：超月度预算（spec §5）。budgetOverride 是测试注入点（config 在 import 时 parse
  // 无法 env 覆盖，与 opts.provider 同范式），生产路径不传回落 config.LLM_MONTHLY_TOKEN_BUDGET。
  const budget = opts.budgetOverride ?? config.LLM_MONTHLY_TOKEN_BUDGET;
  if (budget > 0) {
    // monthlyTokenUsage 按「当前运行月」开窗（spec §5「当月」= 当前运行月，非 period 月）
    const used = await monthlyTokenUsage();
    if (used >= budget) {
      const { content, highlights } = buildDegradedContent(input);
      await upsertRecap({
        chainId, period, status: 'degraded', content, highlights,
        model: null, promptVersion: PROMPT_VERSION, tokenUsage: null, error: null,
        generatedAt: new Date(),
      });
      return;
    }
  }

  // 正常路径：调 provider（解析失败重试一次，spec §4.5）
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const validMomentIds = new Set(input.moments.map((m) => m.momentId));

  let parsed: ParsedRecap | null = null;
  let usage: { prompt: number; completion: number; total: number } | null = null;
  let model: string | null = null;
  let lastError = '';
  try {
    // generateRecap 拥有所有 recaps 行写入（与 parse 失败同范式）：
    // NonRetryableLLMError（4xx 其他）在此落 failed 行后正常返回，不 rethrow（让 handler 视为
    // 正常完成，避免占 processor 5 次退避额度——见 p4 handler）。
    // RetryableLLMError 不在此 catch——让它传播给 handler → processor 退避。
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      const resp = await provider.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      const p = parseRecapJson(resp.content);
      if (p !== null) {
        parsed = p;
        usage = resp.usage; // 透传 LLM usage（T3 末尾 S5 注：shape 与 RecapTokenUsage 一致，不重发明字段名）
        model = resp.model;
      } else {
        lastError = `LLM response parse failed (attempt ${attempt + 1})`;
      }
    }
  } catch (err) {
    if (err instanceof NonRetryableLLMError) {
      // 不可重试：落 failed 行 + 正常返回（不 rethrow），与 parse 失败同范式
      await upsertRecap({
        chainId, period, status: 'failed', content: '',
        highlights: [], model: null, promptVersion: PROMPT_VERSION,
        tokenUsage: null, error: `LLM ${err.statusCode}: ${err.message}`, generatedAt: new Date(),
      });
      return;
    }
    // RetryableLLMError 或其他可重试错误：传播给 handler → processor 退避
    throw err;
  }

  if (parsed === null) {
    await upsertRecap({
      chainId, period, status: 'failed', content: '',
      highlights: [], model: null, promptVersion: PROMPT_VERSION,
      tokenUsage: null, error: lastError, generatedAt: new Date(),
    });
    return;
  }

  // 幻觉防线：过滤掉不属于该链该月的 id（spec §4.5）
  const highlights = parsed.highlight_moment_ids.filter((id) => validMomentIds.has(id));
  await upsertRecap({
    chainId, period, status: 'ready', content: parsed.content,
    highlights, model, promptVersion: PROMPT_VERSION,
    tokenUsage: usage, error: null, generatedAt: new Date(),
  });
}
