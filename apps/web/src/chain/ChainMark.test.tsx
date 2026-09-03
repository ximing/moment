import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_COLOR_CSS, fallbackChainColor } from '@/lib/chain-color';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';
import { ChainMark } from './ChainMark';

// ChainMark 渲染优先级（spec §7.5）：image > emoji > color > id 哈希色。
// - 图片走圆形 object-cover + 保存的 object-position；加载失败当次回退，不无限重试；
// - emoji 背景固定 var(--surface)，不叠加自定义纯色；自定义 hex 原样渲染，预设色走 token 映射；
// - 登录态经 useMediaObjectUrl 认证 blob（这里桩成确定性 URL）；avatarSrc（公开分享
//   的 tokenized 稳定 URL）在场时绝不进 blob 通道（hook 收 null，不发 fetch）。
//
// P3-1 起 icon 位包 AppIcon（spec 2026-09-03-svg-icon-system §4.2 末条）：
// 命中注册表/映射表的值（如旧官方模板 👶）渲染 SVG；自由 emoji（含 ZWJ 组合
// 👨‍👩‍👧）落第 3 分支原文兜底，视觉与现状一致。

vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

const hook = vi.mocked(useMediaObjectUrl);

function renderMark(props: Parameters<typeof ChainMark>[0]) {
  const utils = render(<ChainMark {...props} />);
  return { ...utils, root: utils.container.firstElementChild as HTMLElement };
}

beforeEach(() => {
  hook.mockReset();
  hook.mockImplementation((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null));
});

describe('ChainMark 图片模式', () => {
  it('avatarMediaId 时经 blob 通道渲染圆形 cover 图，优先级高于 emoji 与颜色', () => {
    const { container } = renderMark({ chainId: 'c1', avatarMediaId: 'm-1', icon: '👶', color: 'mint' });
    const img = container.querySelector('img');
    expect(hook).toHaveBeenCalledWith('m-1');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-m-1');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('rounded-full', 'object-cover');
    expect(container).not.toHaveTextContent('👶');
  });

  it('avatarSrc 在场时直接渲染，hook 收 null 不发 blob 请求（公开分享路径）', () => {
    const { container } = renderMark({ chainId: 'c1', avatarMediaId: 'm-1', avatarSrc: '/api/media/m-1?st=tok%20en' });
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/media/m-1?st=tok%20en');
    expect(hook).not.toHaveBeenCalledWith('m-1');
    expect(hook).toHaveBeenCalledWith(null);
  });

  it('avatarFocus 换算为 object-position', () => {
    const { container } = renderMark({ chainId: 'c1', avatarMediaId: 'm-1', avatarFocus: { x: 0.25, y: 0.75 } });
    expect(container.querySelector('img')).toHaveStyle({ objectPosition: '25% 75%' });
  });

  it('blob URL 未就绪（loading）时先按 emoji/color 兜底', () => {
    hook.mockReturnValue(null);
    const { root } = renderMark({ chainId: 'c1', avatarMediaId: 'm-1', icon: '👨‍👩‍👧' });
    expect(root.tagName).toBe('SPAN');
    expect(root).toHaveTextContent('👨‍👩‍👧');
  });

  it('图片 onError 当次回退到 emoji/color 兜底，不无限重试', () => {
    const { container } = renderMark({ chainId: 'c1', avatarSrc: '/api/media/m-1?st=tok', icon: '👨‍👩‍👧', size: 24 });
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    // 同 src 不再重试渲染 img；兜底为 emoji
    expect(container.querySelector('img')).toBeNull();
    expect(container.firstElementChild).toHaveTextContent('👨‍👩‍👧');
  });

  it('onError 后 src 变化重置 broken 态，重新渲染新图', () => {
    const utils = renderMark({ chainId: 'c1', avatarSrc: '/api/media/a?st=tok' });
    fireEvent.error(utils.container.querySelector('img')!);
    expect(utils.container.querySelector('img')).toBeNull();

    utils.rerender(<ChainMark chainId="c1" avatarSrc="/api/media/b?st=tok" />);
    expect(utils.container.querySelector('img')).toHaveAttribute('src', '/api/media/b?st=tok');

    // 回到已失败的旧 src 仍当次回退（记住的是坏 src，不是开关）
    utils.rerender(<ChainMark chainId="c1" avatarSrc="/api/media/a?st=tok" />);
    expect(utils.container.querySelector('img')).toBeNull();
  });
});

describe('ChainMark emoji 模式', () => {
  it('emoji 背景固定 var(--surface)，不叠加自定义纯色', () => {
    const { root } = renderMark({ chainId: 'c1', icon: '👨‍👩‍👧', color: '#A1B2C3' });
    expect(root).toHaveTextContent('👨‍👩‍👧');
    expect(root).toHaveStyle({ background: 'var(--surface)' });
    expect(root.style.background).not.toContain('#A1B2C3');
  });

  it('自由 emoji（含 ZWJ 组合）仍渲染原文本节点（AppIcon 兜底回归）', () => {
    const { root } = renderMark({ chainId: 'c1', icon: '👨‍👩‍👧', size: 24 });
    expect(root.querySelector('svg')).toBeNull();
    expect(root).toHaveTextContent('👨‍👩‍👧');
  });

  it('命中映射表的存量 emoji（👶→tpl-baby）改渲染注册表 SVG', () => {
    const { root } = renderMark({ chainId: 'c1', icon: '👶', size: 24 });
    // 节点位 aria-hidden，SVG 只能在 DOM 层断言
    expect(root.querySelector('svg')).not.toBeNull();
    expect(root).not.toHaveTextContent('👶');
  });
});

describe('ChainMark 纯色与回退', () => {
  it('自定义 hex 原样作为 CSS 颜色', () => {
    const { root } = renderMark({ chainId: 'c1', color: '#A1B2C3' });
    expect(root).toHaveStyle({ background: '#A1B2C3' });
  });

  it('预设色走 token 映射', () => {
    const { root } = renderMark({ chainId: 'c1', color: 'mint' });
    expect(root).toHaveStyle({ background: CHAIN_COLOR_CSS.mint });
  });

  it('未选色时按 chainId 哈希回退，同一链颜色恒定', () => {
    const { root } = renderMark({ chainId: 'chain-x' });
    expect(root).toHaveStyle({ background: CHAIN_COLOR_CSS[fallbackChainColor('chain-x')] });
    const again = render(<ChainMark chainId="chain-x" />);
    expect((again.container.firstElementChild as HTMLElement).style.background).toBe(root.style.background);
  });
});
