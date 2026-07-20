import { config } from '../config.js';
import type { LLMProvider } from './base.provider.js';
import { OpenAICompatProvider } from './openai-compat.provider.js';

// 三态语义（对齐 push/factory.ts 的 singleton + override 范式，但 null 是合法计算值，故用 undefined 区分「未求值/无注入」）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: LLMProvider | null | undefined;
let override: LLMProvider | null | undefined;

/**
 * LLM provider factory 单例（spec §3）。
 * LLM_API_KEY 为空 → 返回 null（recap 管线整体停用，扫描照常但跳过派发，spec §3/§8）。
 * 有 key → 返回 OpenAICompatProvider 单例。
 */
export function getLLMProvider(): LLMProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.LLM_API_KEY
      ? new OpenAICompatProvider({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL })
      : null;
  }
  return singleton;
}

/** 测试注入点（与 push/factory.ts 的 setPushService 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setLLMProvider(p: LLMProvider | null | undefined): void {
  override = p;
}
