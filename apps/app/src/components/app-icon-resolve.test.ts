import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { resolveAppIcon } from './app-icon-resolve';

describe('resolveAppIcon 三级解析', () => {
  it('命中注册表', () => {
    assert.deepEqual(resolveAppIcon('milestone-first-tooth'), { key: 'milestone-first-tooth', label: '第一颗牙' });
  });
  it('命中 EMOJI_TO_ICON 映射', () => {
    assert.deepEqual(resolveAppIcon('😴'), { key: 'mood-sleepy', label: '困倦' });
  });
  it('🥰 映射到 mood-love（别名决策）', () => {
    assert.deepEqual(resolveAppIcon('🥰'), { key: 'mood-love', label: '幸福' });
  });
  it('自由 emoji（含 ZWJ/肤色）与未知值落兜底', () => {
    assert.equal(resolveAppIcon('👨‍👩‍👧'), null);
    assert.equal(resolveAppIcon('👍🏽'), null);
    assert.equal(resolveAppIcon('whatever'), null);
  });
});
