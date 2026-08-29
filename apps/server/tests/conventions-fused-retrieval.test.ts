import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('CONVENTIONS §3 fused-retrieval additive（spec-review：只追加 getObject / last_error / 新路由）', () => {
  const text = readFileSync(path.join(REPO_ROOT, 'docs/superpowers/plans/CONVENTIONS.md'), 'utf8');

  it('§3.2 追加 last_error，不改既有列名', () => {
    expect(text).toMatch(/last_error varchar\(512\) null/);
    expect(text).toMatch(/status enum\('pending','done','failed'\)/);
    expect(text).toContain("'moment.compress'");
    expect(text).toContain("'moment.embed'");
  });

  it('§3.3 追加 getObject，既有方法名仍在', () => {
    expect(text).toMatch(/getObject\(key, metadata, maxBytes\)/);
    expect(text).toContain('uploadFile / deleteFile');
    expect(text).toContain('abortMultipart');
  });

  it('§3.6 融合检索路由行；ChainPolicy / 媒体稳定入口句未改', () => {
    expect(text).toContain('融合检索（2026-08-29-fused-retrieval）');
    expect(text).toContain('POST /api/search');
    expect(text).toContain('GET /api/chains/:chainId/jobs');
    expect(text).toContain('POST /api/internal/embeddings');
    expect(text).toContain('DELETE /api/internal/embeddings/:momentId');
    expect(text).toContain('person_id');
    expect(text).toContain('variant=original|derived');
    expect(text).toContain("export function requireChainRole(minRole: ChainRole): RequestHandler;");
    expect(text).toContain('媒体 URL：响应中 media 只出稳定入口 `/api/media/:id`（相对路径），**不得**内嵌预签名 URL。');
    expect(text).toContain('`order=happened_at` 时 `{h: <epochMs>, i: <momentId>}`');
  });
});
