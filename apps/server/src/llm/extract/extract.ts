import { getLLMProvider } from '../factory.js';
import { NonRetryableLLMError, type LLMProvider } from '../base.provider.js';
import { buildExtractSystemPrompt, buildExtractUserPrompt } from './prompt.js';

/** LLM 抽取结果（spec people-place §5 输出契约）。空数组合法（没有人物/地点）。 */
export interface ExtractResult {
  persons: string[];
  places: string[];
}

/**
 * 解析 LLM 返回的 JSON（对齐 recap parseRecapJson 的防御范式）：
 * - 容错去除 ```json ... ``` 代码块包裹；
 * - persons/places 必须均为数组（缺一即 null），空数组合法；
 * - 非字符串成员与空白串过滤（防 number/boolean 混入与空名——词典名归一化前的第一道防御）；
 * - 任何畸形 → null（由调用方决定重试）。
 */
export function parseExtractJson(raw: string): ExtractResult | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.persons) || !Array.isArray(o.places)) return null;
    const clean = (arr: unknown[]): string[] =>
      arr
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return { persons: clean(o.persons), places: clean(o.places) };
  } catch {
    return null;
  }
}

/**
 * 从 content + transcript 抽取人物/地点（spec §5）。
 *
 * - 解析失败**内部重试一次**（对齐 recap generate 的防御范式）；两次均失败抛
 *   NonRetryableLLMError——按本计划偏差 5，错误传播给 outbox processor 走既有 5 档退避，
 *   终败仅记日志（extract 无 moment 级终态列，outbox 行状态即唯一记录）。
 * - provider.chat 抛错（Retryable/NonRetryable）原样传播，不做内部重试——可重试性
 *   分类由 processor 退避统一兜底（对齐 P3 geocode 的传播策略）。
 * - @param opts.provider 测试注入点（默认 getLLMProvider()）。调用方（handler）必须在
 *   provider 为 null 时先行跳过；null 到达此处视为调用方违约，抛错暴露而非静默降级。
 */
export async function extractPersonsPlaces(
  content: string,
  transcript: string | null,
  opts: { provider?: LLMProvider | null } = {},
): Promise<ExtractResult> {
  const provider = opts.provider !== undefined ? opts.provider : getLLMProvider();
  if (provider === null) {
    throw new NonRetryableLLMError('extract LLM provider disabled (caller must skip first)', 503);
  }

  const systemPrompt = buildExtractSystemPrompt();
  const userPrompt = buildExtractUserPrompt(content, transcript);

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await provider.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const parsed = parseExtractJson(resp.content);
    if (parsed !== null) return parsed;
    lastError = `LLM extract output parse failed (attempt ${attempt + 1})`;
  }
  throw new NonRetryableLLMError(lastError, 502);
}
