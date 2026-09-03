import assert from 'node:assert/strict';
import { render, screen } from '@testing-library/react';
import { describe, it } from 'vitest';
import { AppIcon, resolveAppIcon } from './AppIcon.js';

describe('resolveAppIcon 三级解析', () => {
  it('命中注册表', () => {
    assert.deepEqual(resolveAppIcon('mood-joy'), { key: 'mood-joy', label: '开心' });
  });
  it('命中 EMOJI_TO_ICON 映射', () => {
    assert.deepEqual(resolveAppIcon('😄'), { key: 'mood-joy', label: '开心' });
  });
  it('🥰 映射到 mood-love（reaction-sweet 别名决策，spec §3.1）', () => {
    assert.deepEqual(resolveAppIcon('🥰'), { key: 'mood-love', label: '幸福' });
  });
  it('自由 emoji（含 ZWJ）与未知值落兜底', () => {
    assert.equal(resolveAppIcon('👨‍👩‍👧'), null);
    assert.equal(resolveAppIcon('whatever'), null);
  });
});

describe('AppIcon 渲染', () => {
  it('注册表值渲染 svg 且带 label 无障碍文本', () => {
    render(<AppIcon value="reaction-clap" size={24} />);
    assert.ok(screen.getByRole('img', { name: '鼓掌' }));
  });
  it('emoji 值渲染映射目标的 svg', () => {
    render(<AppIcon value="👍" size={24} />);
    assert.ok(screen.getByRole('img', { name: '点赞' }));
  });
  it('兜底渲染原文本', () => {
    render(<AppIcon value="👨‍👩‍👧" size={24} />);
    assert.ok(screen.getByText('👨‍👩‍👧'));
  });
});
