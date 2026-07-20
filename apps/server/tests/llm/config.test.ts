import { config, envSchema } from '../../src/config.js';

describe('config LLM 默认值（真实 config 对象）', () => {
  // config 在 import 时已 parse(process.env)（测试库 .env）。
  // 真实断言 config.ts 的字段存在与默认值正确——若 config.ts 漏加字段，访问不存在的属性会 TS 编译失败。
  it('7 个 LLM_* 字段默认值正确', () => {
    expect(config.LLM_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(config.LLM_API_KEY).toBe('');
    expect(config.LLM_MODEL).toBe('deepseek-chat');
    expect(config.LLM_MONTHLY_TOKEN_BUDGET).toBe(0);
    expect(config.LLM_RECAP_TZ).toBe('Asia/Shanghai');
    expect(config.LLM_RECAP_MAX_MOMENTS).toBe(100);
    expect(config.LLM_RECAP_MAX_CHARS).toBe(8000);
  });
});

describe('envSchema 边界拒绝（真实 zod schema 本体）', () => {
  // envSchema 含 MYSQL_* 等必填字段，parse 坏 LLM 值时需先提供全部必填 env 的合法值。
  // 测试进程的 env 已被 config.ts 的 dotenv 载入完整，故用 { ...process.env } 作基底再覆盖坏 LLM 字段。
  it('LLM_BASE_URL 非 URL 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('LLM_MONTHLY_TOKEN_BUDGET 负数被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_MONTHLY_TOKEN_BUDGET: '-1' })).toThrow();
  });

  it('LLM_RECAP_MAX_MOMENTS < 1 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_RECAP_MAX_MOMENTS: '0' })).toThrow();
  });

  it('字符串数字 coerce 成 number', () => {
    const cfg = envSchema.parse({ ...process.env, LLM_RECAP_MAX_MOMENTS: '50' });
    expect(cfg.LLM_RECAP_MAX_MOMENTS).toBe(50);
  });
});
