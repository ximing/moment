/**
 * 基线 manifest（plan Task 14）：apps/web/e2e/baselines/manifest.json 是 24 张基线
 * PNG 的唯一生产者清单。本模块负责读取、结构校验与文件级验证；
 * 普通运行绝不写基线，只有 --update-baselines 由 suite 写其中之一。
 *
 * CLI：
 *   node apps/web/e2e/lib/manifest.mjs --verify   结构 + 文件完整性（缺/多 PNG 皆拒绝）
 *   node apps/web/e2e/lib/manifest.mjs --hashes   打印每个基线的 sha256（普通运行只读证明）
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROUTE_SLUGS = Object.freeze(['design-lab', 'feed-home', 'chain-home']);
export const THEMES = Object.freeze(['light', 'dark']);
export const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 390, height: 844 }),
  Object.freeze({ width: 1024, height: 900 }),
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1895, height: 900 }),
]);
/** requiredContent 的封闭标签集：suite 把每个标签映射到具体可见断言。 */
export const REQUIRED_CONTENT_LABELS = Object.freeze([
  '大家的日子',
  '单链页',
  '纯文字时刻',
  '单图时刻',
  '跨年索引',
  '长Tag',
  '长链名',
]);

export const BASELINE_FILES = Object.freeze(
  ['design-lab', 'feed-home', 'chain-home'].flatMap((slug) =>
    THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => `${slug}/${theme}/${viewport.width}.png`)),
  ),
);

export const baselinesRoot = fileURLToPath(new URL('../baselines/', import.meta.url));
export const manifestPath = fileURLToPath(new URL('../baselines/manifest.json', import.meta.url));

function fail(message) {
  throw new Error(`E2E_BASELINE_MANIFEST: ${message}`);
}

function assertBaselineFile(file, seen) {
  if (typeof file !== 'string' || file.length === 0) fail('each case needs a PNG file path');
  if (path.isAbsolute(file) || /^[a-zA-Z]:[\\/]/.test(file)) fail(`absolute baseline file rejected: ${file}`);
  const segments = file.split('/');
  if (segments.some((segment) => segment === '..' || segment === '' || segment === '.')) {
    fail(`path-traversing baseline file rejected: ${file}`);
  }
  if (!file.endsWith('.png')) fail(`baseline file must be a PNG: ${file}`);
  if (!BASELINE_FILES.includes(file)) fail(`unlisted baseline file rejected: ${file}`);
  if (seen.has(file)) fail(`duplicate baseline file rejected: ${file}`);
  seen.add(file);
}

/**
 * 校验 manifest 数据本身（纯函数，不触文件系统）。
 * 恰好 24 条：三路由 × 两主题 × 四视口，文件集合与 BASELINE_FILES 完全一致。
 */
export function validateBaselineManifest(data) {
  if (data === null || typeof data !== 'object' || !Array.isArray(data.cases)) {
    fail('manifest must be an object with a cases array');
  }
  const { cases } = data;
  const seenFiles = new Set();
  const seenCombos = new Set();
  for (const entry of cases) {
    if (entry === null || typeof entry !== 'object') fail('each case must be an object');
    const { routeSlug, route, theme, viewport, requiredContent, file } = entry;
    if (!ROUTE_SLUGS.includes(routeSlug)) fail(`unknown routeSlug: ${String(routeSlug)}`);
    if (typeof route !== 'string' || !route.startsWith('/')) fail(`route must be an absolute path for ${routeSlug}`);
    if (!THEMES.includes(theme)) fail(`unknown theme: ${String(theme)}`);
    if (
      viewport === null ||
      typeof viewport !== 'object' ||
      !VIEWPORTS.some((v) => v.width === viewport.width && v.height === viewport.height)
    ) {
      fail(`unknown viewport: ${JSON.stringify(viewport)}`);
    }
    if (!Array.isArray(requiredContent)) fail(`requiredContent must be an array for ${file}`);
    for (const label of requiredContent) {
      if (!REQUIRED_CONTENT_LABELS.includes(label)) fail(`unknown requiredContent label: ${String(label)}`);
    }
    assertBaselineFile(file, seenFiles);
    const combo = `${routeSlug}|${theme}|${viewport.width}x${viewport.height}`;
    if (seenCombos.has(combo)) fail(`duplicate case combo: ${combo}`);
    seenCombos.add(combo);
  }
  if (cases.length !== 24) fail(`manifest must list exactly 24 cases, got ${cases.length}`);
  for (const expected of BASELINE_FILES) {
    if (!seenFiles.has(expected)) fail(`manifest does not list baseline file: ${expected}`);
  }
  return cases.map((entry) => ({
    routeSlug: entry.routeSlug,
    route: entry.route,
    theme: entry.theme,
    viewport: { width: entry.viewport.width, height: entry.viewport.height },
    requiredContent: [...entry.requiredContent],
    file: entry.file,
  }));
}

export async function loadBaselineManifest() {
  const raw = await readFile(manifestPath, 'utf8');
  return validateBaselineManifest(JSON.parse(raw));
}

async function listPngFiles(rootDir, relative = '') {
  const found = [];
  let entries;
  try {
    entries = await readdir(path.join(rootDir, relative), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await listPngFiles(rootDir, next)));
    else if (entry.isFile() && entry.name.endsWith('.png')) found.push(next);
  }
  return found;
}

/**
 * 文件级验证：列出的 24 张 PNG 必须全部存在，基线根下不得出现未列出的 PNG。
 * rootDir 可注入（测试用临时目录）；默认是受控的 baselines/。
 */
export async function verifyBaselineFiles({ rootDir = baselinesRoot, cases } = {}) {
  const listed = cases ?? (await loadBaselineManifest());
  const missing = [];
  for (const entry of listed) {
    try {
      await readFile(path.join(rootDir, entry.file));
    } catch {
      missing.push(entry.file);
    }
  }
  if (missing.length > 0) fail(`missing baseline PNG(s): ${missing.join(', ')}`);
  const present = await listPngFiles(rootDir);
  const allowed = new Set(listed.map((entry) => entry.file));
  const unlisted = present.filter((file) => !allowed.has(file));
  if (unlisted.length > 0) fail(`unlisted PNG(s) under baseline root: ${unlisted.join(', ')}`);
  return { verified: listed.length };
}

export async function baselineHashes({ rootDir = baselinesRoot, cases } = {}) {
  const listed = cases ?? (await loadBaselineManifest());
  const lines = [];
  for (const entry of listed) {
    let content;
    try {
      content = await readFile(path.join(rootDir, entry.file));
    } catch {
      fail(`missing baseline PNG for hashing: ${entry.file}`);
    }
    const digest = createHash('sha256').update(content).digest('hex');
    lines.push(`${digest}  ${entry.file}`);
  }
  return lines.join('\n');
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const [flag] = process.argv.slice(2);
  try {
    if (flag === '--verify') {
      const cases = await loadBaselineManifest();
      const { verified } = await verifyBaselineFiles({ cases });
      const labelCoverage = REQUIRED_CONTENT_LABELS.filter((label) =>
        cases.some((entry) => entry.requiredContent.includes(label)),
      );
      process.stdout.write(
        `${JSON.stringify({ verified, labels: labelCoverage.length, complete: true })}\n`,
      );
    } else if (flag === '--hashes') {
      process.stdout.write(`${await baselineHashes()}\n`);
    } else {
      process.stderr.write('usage: node manifest.mjs --verify|--hashes\n');
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
