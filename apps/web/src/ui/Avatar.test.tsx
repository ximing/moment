import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

// Avatar icon 位包 AppIcon（spec 2026-09-03-svg-icon-system §4.2 末条）：
// 命中注册表/映射表的值渲染 SVG；自由 emoji（含 ZWJ 组合）落兜底分支
// 原文渲染，视觉与现状一致。icon 位整体 aria-hidden（装饰，语义由相邻名字承担）。

describe('Avatar icon 位', () => {
  it('自由 emoji（含 ZWJ）仍渲染原文本节点（AppIcon 兜底回归）', () => {
    const { container } = render(<Avatar name="全家" icon="👨‍👩‍👧" size={32} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.querySelector('svg')).toBeNull();
    expect(root).toHaveTextContent('👨‍👩‍👧');
  });

  it('命中映射表的存量 emoji（👶→tpl-baby）改渲染注册表 SVG', () => {
    const { container } = render(<Avatar name="宝宝" icon="👶" size={32} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.querySelector('svg')).not.toBeNull();
    expect(root).not.toHaveTextContent('👶');
  });

  it('无 icon 时仍渲染名字首字（回归）', () => {
    const { container } = render(<Avatar name="妈妈" size={32} />);
    expect(container.firstElementChild).toHaveTextContent('妈');
    expect(container.querySelector('svg')).toBeNull();
  });
});
