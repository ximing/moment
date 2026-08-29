import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MomentMedia } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Lightbox } from './lightbox';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';

// Lightbox 契约（plan Task 11）：
// - 打开被点击的 index；prev/next 按钮与 ArrowLeft/ArrowRight 都环绕（wrap）；
// - Escape / 点击媒体外空白 / 具名「关闭」按钮都走 onClose；
// - 单张时隐藏前后箭头；
// - 图与视频同一套 URL 分流：认证模式 useMediaObjectUrl(media.id) 的 blob；
//   分享模式绝不请求 blob，用稳定相对 URL + ?st=encodeURIComponent(token)。
//
// useMediaObjectUrl 模块桩与 MediaBlock.test.tsx 同一约定。

vi.mock('@/api/client', () => ({
  client: {
    mediaUrl(id: string, opts?: { variant?: 'original' | 'derived'; st?: string }) {
      let url = `/api/media/${id}`;
      if (opts?.variant === 'derived') url += '?variant=derived';
      if (opts?.st) url += `${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(opts.st)}`;
      return url;
    },
  },
}));

vi.mock('@/media/useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

const mockUseMediaObjectUrl = vi.mocked(useMediaObjectUrl);

function image(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: `/api/media/${id}?variant=derived`, posterDerivedUrl: null };
}

function video(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'video/mp4', width: 1280, height: 720, duration: 12, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: `/api/media/${id}?variant=derived`, posterDerivedUrl: null };
}

const ITEMS = [image('media-1'), image('media-2'), video('media-3')];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('打开与环绕导航', () => {
  it('打开 index 1 时可见的是第二项', () => {
    const { container } = render(<Lightbox items={ITEMS} index={1} onClose={() => undefined} onIndex={() => undefined} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:mock-media-2');
  });

  it('上一张 / 下一张按钮环绕回报 onIndex', async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    const { rerender } = render(<Lightbox items={ITEMS} index={1} onClose={() => undefined} onIndex={onIndex} />);

    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(onIndex).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole('button', { name: '上一张' }));
    expect(onIndex).toHaveBeenLastCalledWith(0);

    // 环绕：index 0 上一张 → 2；index 2 下一张 → 0
    rerender(<Lightbox items={ITEMS} index={0} onClose={() => undefined} onIndex={onIndex} />);
    await user.click(screen.getByRole('button', { name: '上一张' }));
    expect(onIndex).toHaveBeenLastCalledWith(2);
    rerender(<Lightbox items={ITEMS} index={2} onClose={() => undefined} onIndex={onIndex} />);
    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(onIndex).toHaveBeenLastCalledWith(0);
  });

  it('ArrowLeft / ArrowRight 键盘环绕，Escape 走 onClose', () => {
    const onClose = vi.fn();
    const onIndex = vi.fn();
    render(<Lightbox items={ITEMS} index={1} onClose={onClose} onIndex={onIndex} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onIndex).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('单张时隐藏前后箭头', () => {
    render(<Lightbox items={[image('media-1')]} index={0} onClose={() => undefined} onIndex={() => undefined} />);
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });
});

describe('关闭路径', () => {
  it('具名「关闭」按钮走 onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Lightbox items={ITEMS} index={1} onClose={onClose} onIndex={() => undefined} />);

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击媒体外空白（遮罩本身）走 onClose，点击内容不关', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Lightbox items={ITEMS} index={1} onClose={onClose} onIndex={() => undefined} />);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector('img')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('媒体渲染与 URL 语义', () => {
  it('视频项渲染原生 controls', () => {
    const { container } = render(<Lightbox items={ITEMS} index={2} onClose={() => undefined} onIndex={() => undefined} />);
    const player = container.querySelector('video');
    expect(player).not.toBeNull();
    expect(player!.controls).toBe(true);
    expect(player).toHaveAttribute('src', 'blob:mock-media-3');
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-3');
  });

  it('分享模式：图与视频都用稳定相对 URL + ?st=，绝不请求 blob', () => {
    const token = 'tok en';
    const { container, rerender } = render(
      <Lightbox items={ITEMS} index={1} shareToken={token} onClose={() => undefined} onIndex={() => undefined} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-2?st=tok%20en');

    rerender(<Lightbox items={ITEMS} index={2} shareToken={token} onClose={() => undefined} onIndex={() => undefined} />);
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/media-3?st=tok%20en');

    for (const call of mockUseMediaObjectUrl.mock.calls) expect(call[0]).toBeNull();
  });

  it('认证模式：即使 derivedUrl 非空也只请求 original（Lightbox 高清档）', () => {
    render(<Lightbox items={ITEMS} index={1} onClose={() => undefined} onIndex={() => undefined} />);
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-2');
    const derivedCalls = mockUseMediaObjectUrl.mock.calls.filter(
      (c) => c[1] && (c[1] as { variant?: string }).variant === 'derived',
    );
    expect(derivedCalls).toHaveLength(0);
  });
});
