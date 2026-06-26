import { act, fireEvent, render, screen } from '@testing-library/react';
import { CalendarDays } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '../button/index';
import { Tooltip } from './index';

// Tooltip 行为契约（Menu/Popover/Tooltip 规范 §9）：
// label 只收纯文本；Trigger（IconButton）保留独立可访问名称；Trigger 与浮面
// 都不写原生 title；fine pointer hover/focus 精确 600ms 打开、离开/blur
// 精确 100ms 关闭；Escape 关闭；点击不固定；coarse pointer 永不渲染；
// 默认在 Trigger 上方，上方裁剪时 Flip。

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

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function Harness() {
  return (
    <Tooltip label="查看时间索引">
      <IconButton icon={CalendarDays} label="查看时间索引" />
    </Tooltip>
  );
}

function getTrigger() {
  return screen.getByRole('button', { name: '查看时间索引' });
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubPointer(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Trigger 保留独立可访问名称，Trigger 与浮面都不写原生 title', () => {
    render(<Harness />);
    const trigger = getTrigger();
    expect(trigger).not.toHaveAttribute('title');

    fireEvent.mouseOver(trigger);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('查看时间索引');
    expect(tip).not.toHaveAttribute('title');
  });

  it('hover 精确 600ms 打开，离开精确 100ms 关闭', () => {
    render(<Harness />);
    const trigger = getTrigger();

    fireEvent.mouseOver(trigger);
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toBeInTheDocument();
    // 打开期间通过描述关系呈现
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);

    fireEvent.mouseOut(trigger);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('focus 精确 600ms 打开，blur 精确 100ms 关闭', () => {
    render(<Harness />);
    const trigger = getTrigger();

    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Escape 立即关闭', () => {
    render(<Harness />);
    const trigger = getTrigger();
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('点击不固定：pointerdown 立即关闭', () => {
    render(<Harness />);
    const trigger = getTrigger();
    fireEvent.mouseOver(trigger);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerDown(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('coarse pointer 环境永不渲染', () => {
    stubPointer(true);
    render(<Harness />);
    const trigger = getTrigger();

    fireEvent.mouseOver(trigger);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('上方摆放被视口裁剪时 Flip 到下方', () => {
    // 视口 800×600；Trigger 贴在视口顶（top 0），上方放不下 30 高浮面 → Flip
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        // 定位锚点是 Tooltip 内部的包裹 span
        if (this.tagName === 'SPAN') {
          return toDOMRect({ top: 0, left: 400, width: 40, height: 40 });
        }
        return toDOMRect({ top: 0, left: 0, width: 0, height: 0 });
      },
    );
    // react-aria 的碰撞计算中浮面自身尺寸用 offsetWidth/offsetHeight
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList?.contains('moment-floating') ? 120 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList?.contains('moment-floating') ? 30 : 0;
      },
    );
    render(<Harness />);
    const trigger = getTrigger();
    fireEvent.mouseOver(trigger);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const tip = screen.getByRole('tooltip');
    const floating = tip.closest('[data-placement]');
    expect(floating).not.toBeNull();
    expect(floating).toHaveAttribute('data-placement', 'bottom');
  });
});
