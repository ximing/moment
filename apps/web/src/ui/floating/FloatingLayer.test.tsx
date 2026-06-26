import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingLayer } from './FloatingLayer';

// FloatingLayer 行为契约（Menu/Popover/Tooltip 规范 §10、§7.1、§8.1）：
// Portal 渲染到 body、首选 bottom end、裁剪时 Flip/Shift、外部点击与
// Escape 关闭、Trigger 滚出视口关闭、关闭后焦点恢复 Trigger。
// jsdom 不做布局：Trigger / 浮面矩形与视口尺寸在这里用 mock 给出。

type RectInit = { top: number; left: number; width: number; height: number };

function toDOMRect({ top, left, width, height }: RectInit): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const ZERO_RECT: RectInit = { top: 0, left: 0, width: 0, height: 0 };

/**
 * 以可变对象给出 Trigger / 浮面矩形，方便测试中改写后派发 scroll。
 * 浮面通过 FloatingLayer 固定带有的 moment-floating 标记类识别。
 * 注意：react-aria 的碰撞计算中 Trigger 用 getBoundingClientRect，
 * 浮面自身尺寸用 offsetWidth/offsetHeight（不受缩放影响），两者都要 mock。
 */
function mockLayout(
  viewport: { width: number; height: number },
  rects: { trigger?: RectInit; overlay?: RectInit },
) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: viewport.width,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: viewport.height,
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset?.testid === 'trigger') {
        return toDOMRect(rects.trigger ?? ZERO_RECT);
      }
      return toDOMRect(ZERO_RECT);
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList?.contains('moment-floating')
        ? (rects.overlay?.width ?? 0)
        : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList?.contains('moment-floating')
        ? (rects.overlay?.height ?? 0)
        : 0;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({
  onOpenChange,
  initialOpen = true,
  nonModal = false,
}: {
  onOpenChange?: (open: boolean) => void;
  initialOpen?: boolean;
  nonModal?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div data-testid="host">
      <button
        type="button"
        data-testid="trigger"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
      >
        触发
      </button>
      <FloatingLayer
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        triggerRef={triggerRef}
        nonModal={nonModal}
        className="bg-floating-bg p-4"
      >
        <div data-testid="surface">
          浮层内容
          <button type="button">内部动作</button>
        </div>
      </FloatingLayer>
    </div>
  );
}

describe('FloatingLayer', () => {
  it('通过 Portal 渲染到 body，而不是 Trigger 所在的容器', async () => {
    render(<Harness />);
    const surface = await screen.findByTestId('surface');
    expect(document.body.contains(surface)).toBe(true);
    expect(
      within(screen.getByTestId('host')).queryByTestId('surface'),
    ).toBeNull();
  });

  it('首选 bottom end：下方有空间时位于 Trigger 下方且右缘对齐', async () => {
    // 视口 800×600；Trigger 右缘 440，浮面宽 200 → 右缘对齐即 left = 240
    mockLayout(
      { width: 800, height: 600 },
      {
        trigger: { top: 100, left: 400, width: 40, height: 40 },
        overlay: { top: 0, left: 0, width: 200, height: 150 },
      },
    );
    render(<Harness />);
    const surface = await screen.findByTestId('surface');
    const floating = surface.closest('.moment-floating') as HTMLElement;
    expect(floating).not.toBeNull();
    await waitFor(() =>
      expect(floating).toHaveAttribute('data-placement', 'bottom'),
    );
    expect(Number.parseFloat(floating.style.left)).toBeCloseTo(240, 0);
  });

  it('首选方向被视口裁剪时 Flip 到上方', async () => {
    // Trigger 底缘贴在视口底（600），下方空间不足 150 高浮面 → Flip
    mockLayout(
      { width: 800, height: 600 },
      {
        trigger: { top: 560, left: 400, width: 40, height: 40 },
        overlay: { top: 0, left: 0, width: 200, height: 150 },
      },
    );
    render(<Harness />);
    const surface = await screen.findByTestId('surface');
    const floating = surface.closest('.moment-floating') as HTMLElement;
    await waitFor(() =>
      expect(floating).toHaveAttribute('data-placement', 'top'),
    );
  });

  it('横向裁剪时 Shift 回视口内，保持与视口的最小间距', async () => {
    // bottom end 会把浮面放到 left = 10+40-300 = -250 → Shift 到视口内边距
    mockLayout(
      { width: 800, height: 600 },
      {
        trigger: { top: 100, left: 10, width: 40, height: 40 },
        overlay: { top: 0, left: 0, width: 300, height: 150 },
      },
    );
    render(<Harness />);
    const surface = await screen.findByTestId('surface');
    const floating = surface.closest('.moment-floating') as HTMLElement;
    await waitFor(() =>
      expect(floating).toHaveAttribute('data-placement', 'bottom'),
    );
    expect(Number.parseFloat(floating.style.left)).toBeCloseTo(8, 0);
  });

  it('点击浮层外关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await screen.findByTestId('surface');

    await user.click(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(screen.queryByTestId('surface')).not.toBeInTheDocument(),
    );
  });

  it('Escape 关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const surface = await screen.findByTestId('surface');
    // Escape 由浮层内的 React keydown 链处理，焦点先进浮面
    fireEvent.focus(within(surface).getByRole('button', { name: '内部动作' }));

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(screen.queryByTestId('surface')).not.toBeInTheDocument(),
    );
  });

  it('Trigger 滚出视口后关闭', async () => {
    const rects = {
      trigger: { top: 100, left: 100, width: 40, height: 40 },
      overlay: { top: 0, left: 0, width: 200, height: 150 },
    };
    mockLayout({ width: 800, height: 600 }, rects);
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await screen.findByTestId('surface');

    // Trigger 滚到视口上方之外
    rects.trigger = { top: -200, left: 100, width: 40, height: 40 };
    fireEvent.scroll(window);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(screen.queryByTestId('surface')).not.toBeInTheDocument(),
    );
  });

  it('关闭后焦点恢复 Trigger', async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen={false} />);
    const trigger = screen.getByTestId('trigger');
    await user.click(trigger);
    const surface = await screen.findByTestId('surface');
    fireEvent.focus(within(surface).getByRole('button', { name: '内部动作' }));

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('surface')).not.toBeInTheDocument(),
    );
    // FocusScope 的焦点恢复在异步回调中落地，超时未复焦即失败
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('非模态浮面不抢焦点；Trigger 上的指针按下不算外部，其余外部按下关闭', async () => {
    const onOpenChange = vi.fn();
    render(<Harness nonModal onOpenChange={onOpenChange} />);
    await screen.findByTestId('surface');
    // 非模态：焦点留在原处，不被拉进浮面
    expect(document.body).toHaveFocus();

    fireEvent.pointerDown(screen.getByTestId('trigger'));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
