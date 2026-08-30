import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';
import { ChainCover } from './ChainCover';
import { PublicChainCover } from './ChainCover';

// 链封面（spec §7.5，只出现在链首页与公开分享页）：
// - 登录版 ChainCover 经 useMediaObjectUrl 认证 blob；公开版 PublicChainCover 直接
//   用稳定 URL + ?st=encodeURIComponent(token)，绝不进 blob 通道；
// - 焦点 → object-position，图片 object-fit:cover；未就绪时只有 token 容器没有 img；
// - 加载失败当次隐藏（img 不再渲染，不无限重试）并回调页面回普通页眉。

vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

const hook = vi.mocked(useMediaObjectUrl);

beforeEach(() => {
  hook.mockReset();
  hook.mockImplementation((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null));
});

describe('ChainCover（登录版）', () => {
  it('已签发 https src 直出，不走 blob', () => {
    const { container } = render(
      <ChainCover mediaId="cover-1" src="https://s3.example/cover?X-Amz-Signature=abc" focus={{ x: 0.25, y: 0.75 }} />,
    );
    expect(hook).toHaveBeenCalledWith(null);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://s3.example/cover?X-Amz-Signature=abc');
    expect(container.querySelector('img')).toHaveStyle({ objectPosition: '25% 75%' });
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className.split(/\s+/)).not.toContain('rounded-surface-lg');
    expect(frame.className.split(/\s+/)).toContain('h-[30vh]');
    expect(frame.className.split(/\s+/)).not.toContain('aspect-[3/1]');
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('经 blob 通道渲染宽幅封面，焦点换算为 object-position', () => {
    const onError = vi.fn();
    const { container } = render(<ChainCover mediaId="cover-1" focus={{ x: 0.25, y: 0.75 }} onError={onError} />);
    const img = container.querySelector('img');
    expect(hook).toHaveBeenCalledWith('cover-1');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-cover-1');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveStyle({ objectPosition: '25% 75%' });
  });

  it('blob URL 未就绪时只有容器没有 img', () => {
    hook.mockReturnValue(null);
    const { container } = render(<ChainCover mediaId="cover-1" focus={null} onError={() => undefined} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.firstElementChild).not.toBeNull(); // token 容器在，等待图片
  });

  it('图片 onError 当次隐藏并回调，不无限重试', () => {
    const onError = vi.fn();
    const { container } = render(<ChainCover mediaId="cover-1" focus={null} onError={onError} />);
    fireEvent.error(container.querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')).toBeNull();
  });

  it('onError 后 mediaId 变化重置回退态，新封面正常渲染（与 ChainMark brokenSrc 同语义）', () => {
    const onError = vi.fn();
    const { container, rerender } = render(<ChainCover mediaId="cover-a" focus={null} onError={onError} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    // 换链/换封面：新的 src 不受旧失败态影响
    rerender(<ChainCover mediaId="cover-b" focus={null} onError={onError} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:mock-cover-b');
    expect(onError).toHaveBeenCalledTimes(1);

    // 回到已失败的 src 仍当次回退（记的是坏 URL，不是永久开关）
    rerender(<ChainCover mediaId="cover-a" focus={null} onError={onError} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('PublicChainCover（公开分享版）', () => {
  it('https 预签名直出，不拼 ?st=，不走 blob', () => {
    const { container } = render(
      <PublicChainCover src="https://s3.example/cover?X-Amz-Signature=abc" shareToken="tok en" focus={null} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://s3.example/cover?X-Amz-Signature=abc');
    expect(hook).not.toHaveBeenCalled();
  });

  it('稳定 URL 追加 ?st=encodeURIComponent(token)，不走 blob 通道', () => {
    const onError = vi.fn();
    const { container } = render(
      <PublicChainCover src="/api/media/cover-1" shareToken="tok en" focus={{ x: 0.5, y: 0.5 }} onError={onError} />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/media/cover-1?st=tok%20en');
    expect(img).toHaveStyle({ objectPosition: '50% 50%' });
    expect(hook).not.toHaveBeenCalled();
  });

  it('图片 onError 当次隐藏并回调', () => {
    const onError = vi.fn();
    const { container } = render(
      <PublicChainCover src="/api/media/cover-1" shareToken="tok" focus={null} onError={onError} />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')).toBeNull();
  });

  it('onError 后 src 变化重置回退态，新封面正常渲染', () => {
    const onError = vi.fn();
    const { container, rerender } = render(
      <PublicChainCover src="/api/media/cover-a" shareToken="tok" focus={null} onError={onError} />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<PublicChainCover src="/api/media/cover-b" shareToken="tok" focus={null} onError={onError} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/cover-b?st=tok');
    expect(onError).toHaveBeenCalledTimes(1);

    // 回到已失败的 src 仍当次回退
    rerender(<PublicChainCover src="/api/media/cover-a" shareToken="tok" focus={null} onError={onError} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
