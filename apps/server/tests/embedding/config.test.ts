import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, envSchema } from '../../src/config.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

describe('config DashScope embedding env（fused-retrieval spec §4.1 / §11 P5）', () => {
  it('五字段存在；缺省与 spec 默认一致', () => {
    expect(typeof config.MULTIMODAL_EMBEDDING_ENABLED).toBe('boolean');
    expect(typeof config.MULTIMODAL_EMBEDDING_MODEL).toBe('string');
    expect(typeof config.DASHSCOPE_API_KEY).toBe('string');
    expect(typeof config.DASHSCOPE_BASE_URL).toBe('string');
    expect(typeof config.MULTIMODAL_EMBEDDING_OUTPUT_TYPE).toBe('string');

    const parsed = envSchema.parse({
      ...process.env,
      MULTIMODAL_EMBEDDING_ENABLED: undefined,
      MULTIMODAL_EMBEDDING_MODEL: undefined,
      DASHSCOPE_API_KEY: undefined,
      DASHSCOPE_BASE_URL: undefined,
      MULTIMODAL_EMBEDDING_OUTPUT_TYPE: undefined,
    });
    expect(parsed.MULTIMODAL_EMBEDDING_ENABLED).toBe(true);
    expect(parsed.MULTIMODAL_EMBEDDING_MODEL).toBe('qwen3-vl-embedding');
    expect(parsed.DASHSCOPE_API_KEY).toBe('');
    expect(parsed.DASHSCOPE_BASE_URL).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(parsed.MULTIMODAL_EMBEDDING_OUTPUT_TYPE).toBe('dense');
  });

  it('ENABLED 用 enum+transform：字符串 false 是 false（禁止 z.coerce.boolean）', () => {
    expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: 'false' }).MULTIMODAL_EMBEDDING_ENABLED).toBe(false);
    expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: 'true' }).MULTIMODAL_EMBEDDING_ENABLED).toBe(true);
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: '1' })).toThrow();
  });

  it('DASHSCOPE_BASE_URL 须是 URL；空 key 合法', () => {
    expect(() => envSchema.parse({ ...process.env, DASHSCOPE_BASE_URL: 'not-a-url' })).toThrow();
    expect(envSchema.parse({ ...process.env, DASHSCOPE_API_KEY: '' }).DASHSCOPE_API_KEY).toBe('');
  });

  it('不把 ASR_API_KEY 当成 DASHSCOPE_API_KEY', () => {
    const parsed = envSchema.parse({
      ...process.env,
      DASHSCOPE_API_KEY: '',
      ASR_API_KEY: 'sk-asr-only',
    });
    expect(parsed.DASHSCOPE_API_KEY).toBe('');
    expect(parsed.ASR_API_KEY).toBe('sk-asr-only');
  });
});

describe('.env.example DashScope 五字段（不读 apps/server/.env）', () => {
  function mustHaveKeys(rel: string) {
    const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const k of [
      'MULTIMODAL_EMBEDDING_ENABLED=',
      'MULTIMODAL_EMBEDDING_MODEL=',
      'DASHSCOPE_API_KEY=',
      'DASHSCOPE_BASE_URL=',
      'MULTIMODAL_EMBEDDING_OUTPUT_TYPE=',
    ]) {
      expect(text).toContain(k);
    }
    expect(text).not.toMatch(/DASHSCOPE_API_KEY=\$\{ASR/);
  }

  it('apps/server 与两份 deploy example 都含五字段', () => {
    mustHaveKeys('apps/server/.env.example');
    mustHaveKeys('deploy/.env.example');
    mustHaveKeys('deploy/.env.external.example');
  });
});
