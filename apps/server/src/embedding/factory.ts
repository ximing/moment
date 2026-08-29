import { config, type Config } from '../config.js';
import type { EmbeddingProvider } from './base.provider.js';
import { DashScopeMultimodalProvider } from './dashscope-multimodal.provider.js';

let singleton: EmbeddingProvider | null | undefined;
let override: EmbeddingProvider | null | undefined;

export function isMultimodalEmbeddingConfigured(cfg: Config = config): boolean {
  return cfg.MULTIMODAL_EMBEDDING_ENABLED && cfg.DASHSCOPE_API_KEY !== '';
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = isMultimodalEmbeddingConfigured()
      ? new DashScopeMultimodalProvider({
          baseUrl: config.DASHSCOPE_BASE_URL,
          apiKey: config.DASHSCOPE_API_KEY,
          model: config.MULTIMODAL_EMBEDDING_MODEL,
          dimension: config.MULTIMODAL_EMBEDDING_DIMENSION,
          outputType: config.MULTIMODAL_EMBEDDING_OUTPUT_TYPE,
        })
      : null;
  }
  return singleton;
}

/** 测试注入。undefined = 回落真实 config。严禁业务代码使用。 */
export function setEmbeddingProvider(p: EmbeddingProvider | null | undefined): void {
  override = p;
}
