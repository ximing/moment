import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedSizeList, Float32, Utf8 } from 'apache-arrow';
import { config } from '../../src/config.js';
import {
  closeLanceForTests,
  ensureLance,
  getLanceTable,
  isLanceReady,
  resetLanceForTests,
} from '../../src/lancedb/factory.js';
import { LANCE_UUID_RE, lanceEqUuid, vectorRowId } from '../../src/lancedb/ids.js';
import { MOMENT_VECTORS_TABLE, momentVectorsSchema } from '../../src/lancedb/schema.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

afterAll(async () => {
  await closeLanceForTests();
});

describe('moment_vectors schema（spec §2.5）', () => {
  it('表名与字段顺序/类型锁定', () => {
    expect(MOMENT_VECTORS_TABLE).toBe('moment_vectors');
    const schema = momentVectorsSchema(2560);
    expect(schema.fields.map((f) => f.name)).toEqual([
      'id',
      'momentId',
      'chainId',
      'kind',
      'mediaId',
      'vector',
      'modelHash',
    ]);
    expect(schema.fields[0].type).toBeInstanceOf(Utf8);
    expect(schema.fields[5].type).toBeInstanceOf(FixedSizeList);
    const list = schema.fields[5].type as FixedSizeList;
    expect(list.listSize).toBe(2560);
    expect(list.children[0].name).toBe('item');
    expect(list.children[0].type).toBeInstanceOf(Float32);
    expect(momentVectorsSchema().fields[5].type).toBeInstanceOf(FixedSizeList);
    expect((momentVectorsSchema().fields[5].type as FixedSizeList).listSize).toBe(config.MULTIMODAL_EMBEDDING_DIMENSION);
  });
});

describe('LANCE_UUID_RE / vectorRowId（spec §2.5 防拼接注入）', () => {
  it('uuid 正则与 id 派生', () => {
    expect(LANCE_UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(LANCE_UUID_RE.test("x'; DROP TABLE")).toBe(false);
    expect(lanceEqUuid('momentId', '123e4567-e89b-12d3-a456-426614174000')).toBe(
      "momentId = '123e4567-e89b-12d3-a456-426614174000'",
    );
    expect(lanceEqUuid('momentId', "x' OR 1=1")).toBeNull();
    expect(vectorRowId('moment', 'm-1')).toBe('moment:m-1');
    expect(vectorRowId('image', 'm-1', 'media-9')).toBe('media:media-9');
  });
});

describe('ensureLance / resetLanceForTests', () => {
  it('未 ensure 时 getLanceTable 抛 LANCE_NOT_READY；isLanceReady=false', async () => {
    await closeLanceForTests();
    expect(isLanceReady()).toBe(false);
    expect(() => getLanceTable()).toThrow(/LANCE_NOT_READY/);
  });

  it('ensureLance 幂等；reset 后表存在且可打开', async () => {
    await ensureLance();
    expect(isLanceReady()).toBe(true);
    const t1 = getLanceTable();
    await ensureLance();
    expect(getLanceTable()).toBe(t1);
    await resetLanceForTests();
    expect(isLanceReady()).toBe(true);
    expect(() => getLanceTable()).not.toThrow();
  });
});

describe('lancedb packaging（Docker linux gnu + arrow peer）', () => {
  it('apache-arrow 主版本 ∈ 15–18；workspace 钉 linux/glibc 且忽略 transformers/openai', () => {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@lancedb/lancedb']).toBeTruthy();
    const arrow = String(pkg.dependencies?.['apache-arrow'] ?? '');
    expect(arrow).toMatch(/^\^?1[5-8]/);

    const ws = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(ws).toMatch(/supportedArchitectures/);
    expect(ws).toMatch(/linux/);
    expect(ws).toMatch(/glibc/);
    expect(ws).toMatch(/ignoredOptionalDependencies/);
    expect(ws).toMatch(/openai/);
    expect(ws).toMatch(/@huggingface\/transformers/);

    const lock = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/@lancedb\/lancedb-linux-(x64|arm64)-gnu/);
  });
});
