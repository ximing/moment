import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { PNG } from 'pngjs';

import {
  BASELINE_FILES,
  loadBaselineManifest,
  REQUIRED_CONTENT_LABELS,
  ROUTE_SLUGS,
  THEMES,
  validateBaselineManifest,
  verifyBaselineFiles,
  VIEWPORTS,
} from './manifest.mjs';

/**
 * manifest.mjs 纯测试（plan Task 14）：24 条基线清单是唯一的基线生产者。
 * 文件级验证指向临时目录，不依赖真实基线 PNG 是否已生成。
 */

const tmpRoot = await mkdtemp(path.join(tmpdir(), 'moment-e2e-manifest-'));
after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const EXPECTED_VIEWPORT_PAIRS = [
  [390, 844],
  [1024, 900],
  [1440, 900],
  [1895, 900],
];

const EXPECTED_LABELS = ['大家的日子', '单链页', '纯文字时刻', '单图时刻', '跨年索引', '长Tag', '长链名'];

const EXPECTED_FILES = [
  ...['light', 'dark'].flatMap((theme) =>
    [390, 1024, 1440, 1895].map((width) => `design-lab/${theme}/${width}.png`),
  ),
  ...['light', 'dark'].flatMap((theme) =>
    [390, 1024, 1440, 1895].map((width) => `feed-home/${theme}/${width}.png`),
  ),
  ...['light', 'dark'].flatMap((theme) =>
    [390, 1024, 1440, 1895].map((width) => `chain-home/${theme}/${width}.png`),
  ),
];

function tinyPngBuffer() {
  const png = new PNG({ width: 2, height: 2 });
  return PNG.sync.write(png);
}

async function materialize(rootDir, files) {
  for (const file of files) {
    const target = path.join(rootDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, tinyPngBuffer());
  }
}

describe('the tracked baseline manifest', () => {
  test('lists exactly 3 route slugs × 2 themes × 4 viewport pairs = 24 cases', async () => {
    const cases = await loadBaselineManifest();
    assert.equal(cases.length, 24);
    assert.deepEqual([...ROUTE_SLUGS].sort(), ['chain-home', 'design-lab', 'feed-home']);
    assert.deepEqual([...THEMES].sort(), ['dark', 'light']);
    assert.deepEqual(
      VIEWPORTS.map((viewport) => [viewport.width, viewport.height]),
      EXPECTED_VIEWPORT_PAIRS,
    );
    const combos = new Set(cases.map((entry) => `${entry.routeSlug}|${entry.theme}|${entry.viewport.width}x${entry.viewport.height}`));
    assert.equal(combos.size, 24);
    for (const slug of ROUTE_SLUGS) {
      for (const theme of THEMES) {
        for (const [width, height] of EXPECTED_VIEWPORT_PAIRS) {
          assert.ok(combos.has(`${slug}|${theme}|${width}x${height}`), `missing ${slug}/${theme}/${width}x${height}`);
        }
      }
    }
  });

  test('owns exactly the 24 unique relative PNG paths declared by the plan', async () => {
    const cases = await loadBaselineManifest();
    const files = cases.map((entry) => entry.file);
    assert.deepEqual(new Set(files).size, 24);
    assert.deepEqual([...files].sort(), [...EXPECTED_FILES].sort());
    assert.deepEqual([...BASELINE_FILES].sort(), [...EXPECTED_FILES].sort());
    for (const file of files) {
      assert.ok(!path.isAbsolute(file), `${file} must be relative`);
      assert.ok(!file.split('/').includes('..'), `${file} must not traverse`);
    }
  });

  test('every closed required-content label appears in at least one baseline', async () => {
    const cases = await loadBaselineManifest();
    assert.deepEqual([...REQUIRED_CONTENT_LABELS], EXPECTED_LABELS);
    for (const label of EXPECTED_LABELS) {
      assert.ok(
        cases.some((entry) => entry.requiredContent.includes(label)),
        `no baseline requires ${label}`,
      );
    }
  });

  test('design-lab baselines carry no required content; feed and chain carry their exact label sets', async () => {
    const cases = await loadBaselineManifest();
    for (const entry of cases) {
      if (entry.routeSlug === 'design-lab') assert.deepEqual(entry.requiredContent, []);
      if (entry.routeSlug === 'feed-home')
        assert.deepEqual(entry.requiredContent, ['大家的日子', '纯文字时刻', '单图时刻', '跨年索引', '长Tag', '长链名']);
      if (entry.routeSlug === 'chain-home')
        assert.deepEqual(entry.requiredContent, ['单链页', '纯文字时刻', '单图时刻', '跨年索引', '长Tag', '长链名']);
    }
  });
});

describe('validateBaselineManifest', () => {
  function validEntry(overrides = {}) {
    return {
      routeSlug: 'design-lab',
      route: '/__design-lab',
      theme: 'light',
      viewport: { width: 390, height: 844 },
      requiredContent: [],
      file: 'design-lab/light/390.png',
      ...overrides,
    };
  }

  async function validCases() {
    return loadBaselineManifest();
  }

  test('rejects an unknown route slug, theme, viewport or required-content label', async () => {
    const base = await validCases();
    assert.throws(
      () => validateBaselineManifest({ cases: [validEntry({ routeSlug: 'settings' })] }),
      /routeSlug|slug/i,
    );
    assert.throws(
      () => validateBaselineManifest({ cases: [validEntry({ theme: 'sepia' })] }),
      /theme/i,
    );
    assert.throws(
      () => validateBaselineManifest({ cases: [validEntry({ viewport: { width: 800, height: 600 } })] }),
      /viewport/i,
    );
    assert.throws(
      () => validateBaselineManifest({ cases: [validEntry({ requiredContent: ['不存在的标签'] })] }),
      /requiredContent|label/i,
    );
    // 截断 / 超量都不是完整矩阵。
    assert.throws(() => validateBaselineManifest({ cases: base.slice(0, 23) }), /24/);
    assert.throws(() => validateBaselineManifest({ cases: [...base, validEntry()] }), /24|duplicate/i);
  });

  test('rejects duplicate, path-traversing, absolute or unlisted files', async () => {
    const base = await validCases();
    const duplicated = base.map((entry, index) => (index === 1 ? { ...entry, file: base[0].file } : entry));
    assert.throws(() => validateBaselineManifest({ cases: duplicated }), /duplicate/i);

    const traversing = base.map((entry, index) => (index === 0 ? { ...entry, file: '../escape.png' } : entry));
    assert.throws(() => validateBaselineManifest({ cases: traversing }), /travers|\.\.|file/i);

    const absolute = base.map((entry, index) => (index === 0 ? { ...entry, file: '/tmp/abs.png' } : entry));
    assert.throws(() => validateBaselineManifest({ cases: absolute }), /absolute|file/i);

    const unlisted = base.map((entry, index) =>
      index === 0 ? { ...entry, file: 'design-lab/light/391.png' } : entry,
    );
    assert.throws(() => validateBaselineManifest({ cases: unlisted }), /unlisted|file/i);
  });
});

describe('verifyBaselineFiles', () => {
  test('accepts a directory holding exactly the listed PNGs', async () => {
    const rootDir = await mkdtemp(path.join(tmpRoot, 'ok-'));
    await materialize(rootDir, BASELINE_FILES);
    const cases = await loadBaselineManifest();
    await assert.doesNotReject(verifyBaselineFiles({ rootDir, cases }));
  });

  test('rejects a missing listed PNG', async () => {
    const rootDir = await mkdtemp(path.join(tmpRoot, 'missing-'));
    await materialize(rootDir, BASELINE_FILES.slice(1));
    const cases = await loadBaselineManifest();
    await assert.rejects(verifyBaselineFiles({ rootDir, cases }), /missing/i);
  });

  test('rejects an extra unlisted PNG under the baseline root', async () => {
    const rootDir = await mkdtemp(path.join(tmpRoot, 'extra-'));
    await materialize(rootDir, [...BASELINE_FILES, 'feed-home/light/sneaky.png']);
    const cases = await loadBaselineManifest();
    await assert.rejects(verifyBaselineFiles({ rootDir, cases }), /unlisted|extra/i);
  });

  test('rejects an unlisted nested PNG directory tree as well', async () => {
    const rootDir = await mkdtemp(path.join(tmpRoot, 'nested-'));
    await materialize(rootDir, [...BASELINE_FILES, 'chain-home/dark/deep/hidden.png']);
    const cases = await loadBaselineManifest();
    await assert.rejects(verifyBaselineFiles({ rootDir, cases }), /unlisted|extra/i);
  });
});
