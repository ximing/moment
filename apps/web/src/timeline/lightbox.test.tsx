import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MomentMedia } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox } from './lightbox';

// Lightbox 契约：
// - 打开被点击的 index；prev/next 按钮与 ArrowLeft/ArrowRight 都环绕（wrap）；
// - Escape / 点击媒体外空白 / 具名「关闭」按钮都走 onClose；
// - 单张时隐藏前后箭头；
// - 灯箱永远用原图 url（即使 derivedUrl 非空）；https 不拼 ?st=，相对路径分享态拼 ?st=。

function image(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: `/api/media/${id}?variant=derived`, posterDerivedUrl: null };
}

function video(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'video/mp4', width: 1280, height: 720, duration: 12, sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: `/api/media/${id}?variant=derived`, posterDerivedUrl: null };
}

const ITEMS = [image('media-1'), image('media-2'), video('media-3')];

describe('打开与环绕导航', () => {
  it('打开 index 1 时可见的是第二项', () => {
    const { container } = render(<Lightbox items={ITEMS} index={1} onClose={() => undefined} onIndex={() => undefined} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-2');
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
  it('视频项渲染原生 controls，src 用原图 url', () => {
    const { container } = render(<Lightbox items={ITEMS} index={2} onClose={() => undefined} onIndex={() => undefined} />);
    const player = container.querySelector('video');
    expect(player).not.toBeNull();
    expect(player!.controls).toBe(true);
    expect(player).toHaveAttribute('src', '/api/media/media-3');
  });

  it('分享模式：相对 URL + ?st=；灯箱仍用原图 url 而非 derivedUrl', () => {
    const token = 'tok en';
    const { container, rerender } = render(
      <Lightbox items={ITEMS} index={1} shareToken={token} onClose={() => undefined} onIndex={() => undefined} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-2?st=tok%20en');

    rerender(<Lightbox items={ITEMS} index={2} shareToken={token} onClose={() => undefined} onIndex={() => undefined} />);
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/media-3?st=tok%20en');
  });

  it('https 预签名直出，分享态不拼 ?st=；即使 derivedUrl 非空也用原图 url', () => {
    const items: MomentMedia[] = [
      {
        ...image('media-2'),
        url: 'https://s3.example/orig?X-Amz-Signature=abc',
        derivedUrl: 'https://s3.example/derived?X-Amz-Signature=def',
      },
    ];
    const { container } = render(
      <Lightbox items={items} index={0} shareToken="tok en" onClose={() => undefined} onIndex={() => undefined} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://s3.example/orig?X-Amz-Signature=abc');
  });
});
