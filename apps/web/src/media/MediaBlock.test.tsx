import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MomentMedia } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { MediaBlock } from './MediaBlock';

// MediaBlock 契约：
// - 0 媒体：不渲染任何媒体 DOM；
// - 1 图：按声明宽高比（64×48 fixture 经 width/height 属性给出固有比例），点击回报 onOpen(0)；
// - 2 图：两列方形格；9 图：完整 3×3 格，每格回调回报 0–8；
// - 视频：先 16:9 播放面，点击后才出现原生 controls 的 <video>；
// - URL：直出接口字段。https 预签名不拼 ?st=；相对 `/api/media` 分享态才拼 ?st=。

function image(
  id: string,
  width = 64,
  height = 48,
  sortOrder = 0,
  derivedUrl: string | null = null,
): MomentMedia {
  return {
    id,
    url: `/api/media/${id}`,
    mime: 'image/jpeg',
    width,
    height,
    duration: null,
    sortOrder,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl,
    posterDerivedUrl: null,
  };
}

function video(
  id: string,
  poster?: { posterMediaId: string; posterUrl: string; posterDerivedUrl: string | null },
): MomentMedia {
  return {
    id,
    url: `/api/media/${id}`,
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 12,
    sortOrder: 0,
    posterMediaId: poster?.posterMediaId ?? null,
    posterUrl: poster?.posterUrl ?? null,
    derivedUrl: null,
    posterDerivedUrl: poster?.posterDerivedUrl ?? null,
  };
}

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
    expect(img).toHaveAttribute('src', '/api/media/media-1');
    // 窄于内容列时用固有宽，最大不超过列宽（不要 w-full 拉满）
    expect(img.className.split(/\s+/)).toEqual(expect.arrayContaining(['max-w-full', 'h-auto']));
    expect(img.className.split(/\s+/)).not.toContain('w-full');

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
    expect(player).toHaveAttribute('src', '/api/media/media-v1');
  });
});

describe('URL 语义', () => {
  it('直出 url；有 derivedUrl 时卡片用 derivedUrl', () => {
    const first = render(<MediaBlock media={[image('media-1')]} />);
    expect(first.container.querySelector('img')).toHaveAttribute('src', '/api/media/media-1');
    first.unmount();

    const { container } = render(
      <MediaBlock media={[image('media-1', 64, 48, 0, '/api/media/media-1?variant=derived')]} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-1?variant=derived');
    expect(container.textContent).not.toMatch(/优化中/);
  });

  it('https 预签名直出，分享态不拼 ?st=', () => {
    const signed: MomentMedia = {
      ...image('media-1'),
      url: 'https://s3.example/orig?X-Amz-Signature=abc',
      derivedUrl: 'https://s3.example/derived?X-Amz-Signature=def',
    };
    const { container } = render(<MediaBlock media={[signed]} shareToken="tok en" />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://s3.example/derived?X-Amz-Signature=def',
    );
  });

  it('分享模式：相对 URL 拼 ?st=；已有 query 用 &st=', () => {
    const token = 'tok en';
    const { container, unmount } = render(<MediaBlock media={[image('media-1')]} shareToken={token} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-1?st=tok%20en');
    unmount();

    const shareVideo = render(<MediaBlock media={[video('media-v1')]} shareToken={token} />);
    const player = shareVideo.container.querySelector('video');
    expect(player).not.toBeNull();
    expect(player!.controls).toBe(true);
    expect(player).toHaveAttribute('src', '/api/media/media-v1?st=tok%20en');

    const derived = render(
      <MediaBlock
        media={[image('media-1', 64, 48, 0, '/api/media/media-1?variant=derived')]}
        shareToken={token}
      />,
    );
    const src = derived.container.querySelector('img')!.getAttribute('src');
    expect(src).toBe('/api/media/media-1?variant=derived&st=tok%20en');
    expect(src).not.toContain('?variant=derived?st=');
  });

  it('视频封面优先 posterDerivedUrl；分享相对路径拼 &st=', () => {
    const { container } = render(
      <MediaBlock
        media={[
          video('media-v1', {
            posterMediaId: 'poster-1',
            posterUrl: '/api/media/poster-1',
            posterDerivedUrl: '/api/media/poster-1?variant=derived',
          }),
        ]}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/poster-1?variant=derived');

    const share = render(
      <MediaBlock
        media={[
          video('media-v1', {
            posterMediaId: 'poster-1',
            posterUrl: '/api/media/poster-1',
            posterDerivedUrl: '/api/media/poster-1?variant=derived',
          }),
        ]}
        shareToken={'tok en'}
      />,
    );
    const player = share.container.querySelector('video')!;
    expect(player.getAttribute('poster')).toBe('/api/media/poster-1?variant=derived&st=tok%20en');
    expect(player.getAttribute('poster')).not.toContain('?variant=derived?st=');
  });
});
