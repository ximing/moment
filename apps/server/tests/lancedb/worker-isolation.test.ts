import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(SERVER_ROOT, 'src');
const WORKER_ENTRY = path.join(SRC, 'worker/index.ts');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function stripTypeImports(src: string): string {
  return src.replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
}

function relativeSpecs(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      statSync(cand);
      return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

function walk(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = stripTypeImports(readFileSync(file, 'utf8'));
    if (/from\s+['"]@lancedb\/lancedb['"]/.test(src) || /import\s+['"]@lancedb\/lancedb['"]/.test(src)) {
      throw new Error(`${file} imports @lancedb/lancedb`);
    }
    for (const spec of relativeSpecs(src)) {
      const next = resolveSpec(file, spec);
      if (next) stack.push(next);
    }
  }
  return seen;
}

describe('worker 禁止加载 Lance（spec §0 / §1）', () => {
  it('src/worker 源码不含 @lancedb/lancedb', () => {
    for (const file of listTs(path.join(SRC, 'worker'))) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toContain('@lancedb/lancedb');
    }
  });

  it('worker/index.ts 相对 import 图不进入 src/lancedb 且不 import @lancedb/lancedb', () => {
    const files = walk(WORKER_ENTRY);
    for (const file of files) {
      expect(file.replaceAll('\\', '/')).not.toMatch(/\/lancedb\//);
      expect(readFileSync(file, 'utf8')).not.toContain('@lancedb/lancedb');
    }
    expect(files.has(WORKER_ENTRY)).toBe(true);
  });

  it('src/app.ts 不直接调用 ensureLance / connect（createApp 零 Lance I/O）', () => {
    const src = readFileSync(path.join(SRC, 'app.ts'), 'utf8');
    expect(src).not.toContain('ensureLance');
    expect(src).not.toContain('@lancedb/lancedb');
    expect(src).not.toContain('lancedb.connect');
  });
});
