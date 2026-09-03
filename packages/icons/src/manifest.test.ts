import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ICON_MANIFEST, hasIconKey } from './manifest.js';

const svgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svg');

test('每个注册表项的 file 指向的 svg 文件存在（别名形态允许多 key 同文件）', () => {
  for (const [key, entry] of Object.entries(ICON_MANIFEST)) {
    assert.match(key, /^[a-z][a-z0-9-]{0,49}$/, `key 不合 slug 规范: ${key}`);
    assert.ok(existsSync(path.join(svgDir, entry.file)), `svg 缺失: ${entry.file} (${key})`);
    assert.ok(entry.label.length > 0, `label 为空: ${key}`);
  }
});

test('hasIconKey 命中与拒绝', () => {
  assert.equal(hasIconKey('mood-joy'), true);
  assert.equal(hasIconKey('reaction-sweet'), true);
  assert.equal(hasIconKey('😄'), false);
  assert.equal(hasIconKey('not-a-key'), false);
});
