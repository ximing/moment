import { jest } from '@jest/globals';
import { config } from '../../src/config.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { DashScopeMultimodalProvider } from '../../src/embedding/dashscope-multimodal.provider.js';
import {
  getEmbeddingProvider,
  isMultimodalEmbeddingConfigured,
  setEmbeddingProvider,
} from '../../src/embedding/factory.js';

describe('getEmbeddingProvider 三态（对齐 getLLMProvider）', () => {
  afterEach(() => setEmbeddingProvider(undefined));

  it('注入 mock → 返回该 mock（单例缓存）', () => {
    const mock = { embed: jest.fn(), modelHash: () => 'a', dimensions: () => 2560 };
    setEmbeddingProvider(mock as unknown as EmbeddingProvider);
    expect(getEmbeddingProvider()).toBe(mock);
    expect(getEmbeddingProvider()).toBe(mock);
  });

  it('注入 null → null（空 key / ENABLED=false）', () => {
    setEmbeddingProvider(null);
    expect(getEmbeddingProvider()).toBeNull();
  });

  it('重置 undefined → 回落真实 config：未配置则 null，已配置则 DashScopeMultimodalProvider', () => {
    setEmbeddingProvider(undefined);
    const provider = getEmbeddingProvider();
    if (isMultimodalEmbeddingConfigured()) {
      expect(provider).toBeInstanceOf(DashScopeMultimodalProvider);
    } else {
      expect(provider).toBeNull();
    }
  });
});

describe('isMultimodalEmbeddingConfigured', () => {
  it('空 key 或 ENABLED=false → false', () => {
    expect(isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: '', MULTIMODAL_EMBEDDING_ENABLED: true })).toBe(false);
    expect(
      isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: 'sk', MULTIMODAL_EMBEDDING_ENABLED: false }),
    ).toBe(false);
    expect(
      isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: 'sk', MULTIMODAL_EMBEDDING_ENABLED: true }),
    ).toBe(true);
  });
});
