import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function serviceBlock(yaml: string, name: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) throw new Error(`missing service ${name}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || lines[i] === 'volumes:') {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function assertNginxInternalBeforeApi(conf: string, label: string): void {
  const internal = conf.search(/location\s+\/api\/internal\//);
  // 必须用 `/api/ {`：裸 `/location\s+\/api\//` 会先命中 `location /api/internal/`，实现后测试永远红。
  const api = conf.search(/location\s+\/api\/\s*\{/);
  if (internal < 0 || api <= internal) {
    throw new Error(`${label}: location /api/internal/ must appear before location /api/ { (internal=${internal}, api=${api})`);
  }
  const slice = conf.slice(internal, api);
  expect(slice).toMatch(/return\s+404\s*;/);
}

describe('Dockerfile bookworm-slim（spec §0 / §11 P4）', () => {
  it('server 镜像 base 是 node:22-bookworm-slim，不再 alpine', () => {
    const df = readFileSync(path.join(SERVER_ROOT, 'Dockerfile'), 'utf8');
    expect(df).toMatch(/^FROM node:22-bookworm-slim AS base\s*$/m);
    expect(df).not.toMatch(/node:22-alpine/);
  });

  it('web Dockerfile 仍 alpine（本计划不改）', () => {
    const df = readFileSync(path.join(REPO_ROOT, 'apps/web/Dockerfile'), 'utf8');
    expect(df).toMatch(/FROM node:22-alpine AS base/);
  });

  it('web pnpm install filters to @moment/web so alpine 不装 @lancedb/lancedb native', () => {
    const df = readFileSync(path.join(REPO_ROOT, 'apps/web/Dockerfile'), 'utf8');
    expect(df).toMatch(/pnpm install --frozen-lockfile --filter=@moment\/web\.\.\./);
    expect(df).not.toMatch(/^RUN pnpm install --frozen-lockfile\s*$/m);
  });
});

describe('compose Lance volume 只挂 server（spec §1）', () => {
  const files = ['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.prod.external.yml'] as const;

  it.each(files)('%s：server 挂 /data/lancedb，worker 不挂，worker INTERNAL_API_BASE_URL=http://server:3000', (file) => {
    const yml = read(file);
    const server = serviceBlock(yml, 'server');
    const worker = serviceBlock(yml, 'worker');
    expect(server).toContain('moment-lancedb:/data/lancedb');
    expect(server).toMatch(/LANCEDB_PATH:\s*\/data\/lancedb/);
    expect(worker).not.toContain('moment-lancedb:/data/lancedb');
    expect(worker).toMatch(/INTERNAL_API_BASE_URL:\s*http:\/\/server:3000/);
    for (const name of ['migrate', 'backup', 'web'] as const) {
      const start = yml.split('\n').findIndex((l) => l === `  ${name}:`);
      if (start < 0) continue;
      expect(serviceBlock(yml, name)).not.toContain('moment-lancedb:/data/lancedb');
    }
    expect(yml).toMatch(/^ {2}moment-lancedb:\s*\{\}\s*$/m);
  });

  it('prod compose worker depends_on server service_healthy', () => {
    for (const file of ['docker-compose.prod.yml', 'docker-compose.prod.external.yml'] as const) {
      const worker = serviceBlock(read(file), 'worker');
      expect(worker).toMatch(/server:\s*\n\s*condition:\s*service_healthy/);
    }
  });
});

describe('nginx 公网拒绝 /api/internal/（spec §1 / §8）', () => {
  it('两份 conf 都在 location /api/ 之前 return 404', () => {
    assertNginxInternalBeforeApi(read('deploy/nginx.conf'), 'nginx.conf');
    assertNginxInternalBeforeApi(read('deploy/nginx.external.conf'), 'nginx.external.conf');
  });
});
