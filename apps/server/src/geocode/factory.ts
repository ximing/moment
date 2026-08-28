import { config } from '../config.js';
import type { GeocodeProvider } from './base.provider.js';
import { AmapProvider } from './amap.provider.js';

// 三态语义（与 llm/factory.ts 逐字同范式，null 是合法计算值，故用 undefined 区分「未求值/无注入」）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: GeocodeProvider | null | undefined;
let override: GeocodeProvider | null | undefined;

/**
 * geocode provider factory 单例（spec people-place §4）。
 * AMAP_WEB_KEY 为空 → 返回 null（逆地理编码整体停用：坐标照存、place_name 留空、
 * outbox 消费即跳过，管线不阻断——同 recap 的 LLM_API_KEY 停用模式，spec §4/§8）。
 * 有 key → 返回 AmapProvider 单例。
 */
export function getGeocodeProvider(): GeocodeProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.AMAP_WEB_KEY ? new AmapProvider({ apiKey: config.AMAP_WEB_KEY }) : null;
  }
  return singleton;
}

/** 测试注入点（与 setLLMProvider / setASRProvider 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setGeocodeProvider(p: GeocodeProvider | null | undefined): void {
  override = p;
}
