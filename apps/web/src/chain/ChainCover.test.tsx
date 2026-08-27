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
  it('经 blob 通道渲染宽幅封面，焦点换算为 object-position', () => {
    const onError = vi.fn();
    const { container } = render(<ChainCover mediaId="cover-1" focus={{ x: 0.25, y: 0.75 }} onError={onError} />);
    const img = container.querySelector('img');
    expect(hook).toHaveBeenCalledWith('cover-1');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:mock-cover-1');
    expect(img).toHaveAttribute('alt', '');
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
});

describe('PublicChainCover（公开分享版）', () => {
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
});
