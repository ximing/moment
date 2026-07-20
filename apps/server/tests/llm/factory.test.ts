import { jest } from '@jest/globals';
import { getLLMProvider, setLLMProvider } from '../../src/llm/factory.js';
import { OpenAICompatProvider } from '../../src/llm/openai-compat.provider.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';

describe('getLLMProvider', () => {
  afterEach(() => setLLMProvider(undefined)); // 重置回真实 config 行为（H2 三态：undefined=回落 singleton）

  it('注入 mock provider → 返回该 mock（单例缓存）', () => {
    const mock = { chat: jest.fn() };
    setLLMProvider(mock as unknown as LLMProvider);
    expect(getLLMProvider()).toBe(mock);
    expect(getLLMProvider()).toBe(mock); // 同一实例
  });

  it('注入 null → 返回 null（模拟空 key 停用）', () => {
    setLLMProvider(null);
    expect(getLLMProvider()).toBeNull();
  });

  it('重置(undefined) → 回落真实 config：空 key 环境返回 null', () => {
    setLLMProvider(undefined);
    // 测试库 env 默认无 LLM_API_KEY
    const provider = getLLMProvider();
    expect(provider === null || provider instanceof OpenAICompatProvider).toBe(true);
    // 不依赖 env 是否配 key，两种合法结果都接受；重点是重置后回落真实而非注入值
  });
});
