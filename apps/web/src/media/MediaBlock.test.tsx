import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MomentMedia } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaBlock } from './MediaBlock';
import { useMediaObjectUrl } from './useMediaObjectUrl';

// MediaBlock 契约（plan Task 11）：
// - 0 媒体：不渲染任何媒体 DOM；
// - 1 图：按声明宽高比（64×48 fixture 经 width/height 属性给出固有比例），点击回报 onOpen(0)；
// - 2 图：两列方形格；9 图：完整 3×3 格，每格回调回报 0–8；
// - 视频：先 16:9 播放面，点击后才出现原生 controls 的 <video>；
// - URL 语义不变：认证模式用 useMediaObjectUrl(media.id) 的 blob object URL；
//   分享模式绝不请求 blob（hook 只收到 null），用稳定相对 URL + ?st=encodeURIComponent(token)。
//
// useMediaObjectUrl 模块桩：认证 id 同步回 blob:mock-<id>，null 回 null；
// 调用参数即「是否请求过 blob」的直接证据。

vi.mock('./useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn((mediaId: string | null) => (mediaId ? `blob:mock-${mediaId}` : null)),
}));

const mockUseMediaObjectUrl = vi.mocked(useMediaObjectUrl);

function image(id: string, width = 64, height = 48, sortOrder = 0): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'image/jpeg', width, height, duration: null, sortOrder, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null };
}

function video(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'video/mp4', width: 1280, height: 720, duration: 12, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('媒体数量分支', () => {
  it('0 个媒体不渲染任何 DOM', () => {
    const { container } = render(<MediaBlock media={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('1 图按声明宽高比渲染（64×48），点击回报 onOpen(0)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(<MediaBlock media={[image('media-1')]} onOpen={onOpen} />);

    const img = container.querySelector('img')!;
    // 声明宽高经 width/height 属性给出固有比例（现代浏览器由此推导 aspect-ratio）
    expect(img).toHaveAttribute('width', '64');
    expect(img).toHaveAttribute('height', '48');
    expect(img).toHaveAttribute('src', 'blob:mock-media-1');

    await user.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it('2 图渲染两列方形格，点击第二格回报 onOpen(1)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(
      <MediaBlock media={[image('media-1', 64, 48, 0), image('media-2', 48, 64, 1)]} onOpen={onOpen} />,
    );

    expect(container.querySelector('.grid.grid-cols-2')).not.toBeNull();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.className).toContain('aspect-square');

    await user.click(screen.getAllByRole('button')[1]!);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('9 图渲染完整 3×3 格，每格回调回报 0–8', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const media = Array.from({ length: 9 }, (_, i) => image(`media-${i + 1}`, 64, 48, i));
    const { container } = render(<MediaBlock media={media} onOpen={onOpen} />);

    expect(container.querySelector('.grid.grid-cols-3')).not.toBeNull();
    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(9);

    await user.click(cells[0]!);
    expect(onOpen).toHaveBeenLastCalledWith(0);
    await user.click(cells[8]!);
    expect(onOpen).toHaveBeenLastCalledWith(8);
    await user.click(cells[4]!);
    expect(onOpen).toHaveBeenLastCalledWith(4);
  });
});

describe('视频分支', () => {
  it('先渲染 16:9 播放面（无 video 元素），点击后出现原生 controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<MediaBlock media={[video('media-v1')]} />);

    const playSurface = screen.getByRole('button', { name: '播放视频' });
    expect(playSurface.className).toContain('aspect-video');
    expect(container.querySelector('video')).toBeNull();

    await user.click(playSurface);
    const player = container.querySelector('video');
    expect(player).not.toBeNull();
    expect(player!.controls).toBe(true);
    expect(player).toHaveAttribute('src', 'blob:mock-media-v1');
  });
});

describe('URL 语义', () => {
  it('认证模式：图片与视频都经 useMediaObjectUrl(media.id) 取 blob object URL', async () => {
    const user = userEvent.setup();
    const first = render(<MediaBlock media={[image('media-1')]} />);
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-1');
    expect(first.container.querySelector('img')).toHaveAttribute('src', 'blob:mock-media-1');
    first.unmount();

    mockUseMediaObjectUrl.mockClear();
    const { container } = render(<MediaBlock media={[video('media-v1')]} />);
    // 播放面阶段不请求 blob；点击后才按 id 请求
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith(null);
    await user.click(screen.getByRole('button', { name: '播放视频' }));
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-v1');
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:mock-media-v1');
  });

  it('分享模式：绝不请求 blob（hook 只收 null），用稳定相对 URL + ?st=encodeURIComponent(token)', () => {
    const token = 'tok en';
    const { container, unmount } = render(<MediaBlock media={[image('media-1')]} shareToken={token} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-1?st=tok%20en');
    expect(mockUseMediaObjectUrl).not.toHaveBeenCalledWith('media-1');
    for (const call of mockUseMediaObjectUrl.mock.calls) expect(call[0]).toBeNull();
    unmount();

    mockUseMediaObjectUrl.mockClear();
    const shareVideo = render(<MediaBlock media={[video('media-v1')]} shareToken={token} />);
    // 分享模式视频直接给出原生 controls，不经播放面、不请求 blob
    const player = shareVideo.container.querySelector('video');
    expect(player).not.toBeNull();
    expect(player!.controls).toBe(true);
    expect(player).toHaveAttribute('src', '/api/media/media-v1?st=tok%20en');
    for (const call of mockUseMediaObjectUrl.mock.calls) expect(call[0]).toBeNull();
  });
});
