import { config } from '../../config.js';
import type { ASRProvider } from './base.provider.js';
import { OpenAICompatASRProvider } from './openai-compat.provider.js';

// 三态语义（与 llm/factory.ts 逐字同范式）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: ASRProvider | null | undefined;
let override: ASRProvider | null | undefined;

/**
 * ASR provider factory 单例（spec voice-moment §4.1）。
 * ASR_API_KEY 为空 → 返回 null（转写整体停用；语音录制/播放不受影响，handler 落 failed）。
 * 与 LLM_* 完全独立——允许 ASR 和 chat 用不同服务商、单独停用。
 */
export function getASRProvider(): ASRProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.ASR_API_KEY
      ? new OpenAICompatASRProvider({ baseUrl: config.ASR_BASE_URL, apiKey: config.ASR_API_KEY, model: config.ASR_MODEL })
      : null;
  }
  return singleton;
}

/** 测试注入点（与 setLLMProvider 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setASRProvider(p: ASRProvider | null | undefined): void {
  override = p;
}
