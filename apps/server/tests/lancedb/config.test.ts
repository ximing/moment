import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, envSchema } from '../../src/config.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

const DIMS = [2560, 2048, 1536, 1024, 768, 512, 256];

describe('config Lance/BA env（fused-retrieval spec §4.1 / §11 P4）', () => {
  it('四字段存在；缺省与 spec 默认一致（测试 .env 未覆盖时）', () => {
    expect(typeof config.LANCEDB_PATH).toBe('string');
    expect(config.LANCEDB_PATH.length).toBeGreaterThan(0);
    expect(typeof config.BA_AUTH_TOKEN).toBe('string');
    expect(typeof config.INTERNAL_API_BASE_URL).toBe('string');
    expect(typeof config.MULTIMODAL_EMBEDDING_DIMENSION).toBe('number');

    const parsed = envSchema.parse({
      ...process.env,
      LANCEDB_PATH: undefined,
      BA_AUTH_TOKEN: undefined,
      INTERNAL_API_BASE_URL: undefined,
      MULTIMODAL_EMBEDDING_DIMENSION: undefined,
    });
    expect(parsed.LANCEDB_PATH).toBe('./lancedb_data');
    expect(parsed.BA_AUTH_TOKEN).toBe('');
    expect(parsed.INTERNAL_API_BASE_URL).toBe('http://127.0.0.1:3000');
    expect(parsed.MULTIMODAL_EMBEDDING_DIMENSION).toBe(2560);
  });

  it('INTERNAL_API_BASE_URL 接受 docker DNS 名 http://server:3000', () => {
    const cfg = envSchema.parse({ ...process.env, INTERNAL_API_BASE_URL: 'http://server:3000' });
    expect(cfg.INTERNAL_API_BASE_URL).toBe('http://server:3000');
  });

  it('INTERNAL_API_BASE_URL 非 URL 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, INTERNAL_API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('MULTIMODAL_EMBEDDING_DIMENSION 合法集合；字符串数字 coerce；非法拒绝', () => {
    for (const d of DIMS) {
      expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: String(d) }).MULTIMODAL_EMBEDDING_DIMENSION).toBe(d);
    }
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '128' })).toThrow();
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '3000' })).toThrow();
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '2560.5' })).toThrow();
  });

  it('空串 BA_AUTH_TOKEN 是合法配置（内部口将 401 BA_NOT_CONFIGURED）', () => {
    expect(envSchema.parse({ ...process.env, BA_AUTH_TOKEN: '' }).BA_AUTH_TOKEN).toBe('');
  });
});

describe('gitignore lancedb_data（spec §2.6）', () => {
  it('根 gitignore 含 apps/server/lancedb_data/ 与仓库根 lancedb_data/', () => {
    const gi = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gi).toMatch(/(^|\n)apps\/server\/lancedb_data\/(\n|$)/);
    expect(gi).toMatch(/(^|\n)lancedb_data\/(\n|$)/);
  });
});

describe('.env.example 四字段（spec §4.1；不读 apps/server/.env）', () => {
  function mustHaveKeys(rel: string) {
    const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const k of [
      'LANCEDB_PATH=',
      'BA_AUTH_TOKEN=',
      'INTERNAL_API_BASE_URL=',
      'MULTIMODAL_EMBEDDING_DIMENSION=',
    ]) {
      expect(text).toContain(k);
    }
  }

  it('apps/server 与两份 deploy example 都含四字段赋值', () => {
    mustHaveKeys('apps/server/.env.example');
    mustHaveKeys('deploy/.env.example');
    mustHaveKeys('deploy/.env.external.example');
  });
});
