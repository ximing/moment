import { jest } from '@jest/globals';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { AmapProvider } from '../../src/geocode/amap.provider.js';
import { getGeocodeProvider, setGeocodeProvider } from '../../src/geocode/factory.js';

describe('getGeocodeProvider（三态单例，逐字复刻 llm/factory.ts 范式）', () => {
  afterEach(() => setGeocodeProvider(undefined)); // 重置回真实 config 行为（undefined = 回落 singleton）

  it('注入 mock provider → 返回该 mock（override 生效，单例语义）', () => {
    const mock = { reverse: jest.fn() };
    setGeocodeProvider(mock as unknown as GeocodeProvider);
    expect(getGeocodeProvider()).toBe(mock);
    expect(getGeocodeProvider()).toBe(mock); // 同一实例
  });

  it('注入 null → 返回 null（空 key 停用形态的注入模拟）', () => {
    setGeocodeProvider(null);
    expect(getGeocodeProvider()).toBeNull();
  });

  it('重置(undefined) → 回落真实 config 行为（不残留注入值）', () => {
    setGeocodeProvider(undefined);
    // 测试库 .env 未配置 AMAP_WEB_KEY（config.test.ts 已断言默认空串）→ null；
    // 与 tests/llm/factory.test.ts 同款容忍式：不把测试环境是否配 key 写死进断言
    const provider = getGeocodeProvider();
    expect(provider === null || provider instanceof AmapProvider).toBe(true);
    // 重点是重置后回落真实而非注入值
    const mock: GeocodeProvider = { reverse: jest.fn() as unknown as GeocodeProvider['reverse'] };
    setGeocodeProvider(mock);
    setGeocodeProvider(undefined);
    expect(getGeocodeProvider()).toBe(provider);
  });
});
