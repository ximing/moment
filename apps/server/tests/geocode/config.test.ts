import { config, envSchema } from '../../src/config.js';

describe('config AMAP_WEB_KEY（spec people-place §4）', () => {
  // 与 tests/llm/config.test.ts 的 LLM_API_KEY 断言同款前提：测试库 .env 未配置 AMAP_WEB_KEY
  // （字段为 P3 新增，.env.example 默认留空）。若未来测试 .env 配置了真实 key，此断言需同步调整。
  it('默认空串（未配置 = geocode 停用）', () => {
    expect(config.AMAP_WEB_KEY).toBe('');
  });

  it('envSchema 接受任意非空字符串 key', () => {
    const cfg = envSchema.parse({ ...process.env, AMAP_WEB_KEY: 'amap-test-key-32bytes' });
    expect(cfg.AMAP_WEB_KEY).toBe('amap-test-key-32bytes');
  });

  it('缺省（undefined）回落空串', () => {
    const cfg = envSchema.parse({ ...process.env, AMAP_WEB_KEY: undefined });
    expect(cfg.AMAP_WEB_KEY).toBe('');
  });
});
