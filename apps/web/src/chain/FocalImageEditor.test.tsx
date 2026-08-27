import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FocalImageEditor } from './FocalImageEditor';

// FocalImageEditor 行为契约（chain-appearance plan Task 7 / spec §7.4）：
// 两个 label 明确的 range（0–100）是键盘可访问的等价操作；range 实时更新预览的
// object-position；取消恢复进入前的初值且不回调；确认把当前焦点回传给调用方。
// 拖动走 pointer capture（jsdom 无布局，拖动路径由几何单测覆盖）。

const SRC = 'blob:mock-image';

/** jsdom 下 user-event 不驱动原生 range 的 value，用 fireEvent.change 等价键盘路径。 */
function setSlider(slider: HTMLElement, value: number) {
  fireEvent.change(slider, { target: { value: String(value) } });
}

describe('FocalImageEditor', () => {
  it('渲染两个 label 明确的 range（0–100），初值来自 focus', () => {
    render(
      <FocalImageEditor
        src={SRC}
        focus={{ x: 0.25, y: 0.75 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const x = screen.getByRole('slider', { name: '水平位置' });
    const y = screen.getByRole('slider', { name: '垂直位置' });
    expect(x).toHaveValue('25');
    expect(y).toHaveValue('75');
    expect(x).toHaveAttribute('min', '0');
    expect(x).toHaveAttribute('max', '100');
  });

  it('拖动预览使用 focus → object-position，并随 range 实时更新', () => {
    render(
      <FocalImageEditor
        src={SRC}
        focus={{ x: 0.5, y: 0.5 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const img = screen.getByRole('img', { name: '位置预览' });
    expect(img).toHaveStyle({ objectPosition: '50% 50%' });

    setSlider(screen.getByRole('slider', { name: '水平位置' }), 49);
    expect(img).toHaveStyle({ objectPosition: '49% 50%' });
  });

  it('确认把当前焦点回传（0–100 → 0..1）', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <FocalImageEditor
        src={SRC}
        focus={{ x: 0.5, y: 0.5 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    setSlider(screen.getByRole('slider', { name: '水平位置' }), 49);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 0.49, y: 0.5 });
  });

  it('取消恢复初值、不回调 onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <FocalImageEditor
        src={SRC}
        focus={{ x: 0.5, y: 0.5 }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    setSlider(screen.getByRole('slider', { name: '水平位置' }), 49);
    const img = screen.getByRole('img', { name: '位置预览' });
    expect(img).toHaveStyle({ objectPosition: '49% 50%' });

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    // 取消后预览恢复进入编辑器前的坐标
    expect(img).toHaveStyle({ objectPosition: '50% 50%' });
    expect(screen.getByRole('slider', { name: '水平位置' })).toHaveValue('50');
  });

  it('容器可访问名称区分头像/封面场景', () => {
    render(
      <FocalImageEditor
        src={SRC}
        label="封面"
        focus={{ x: 0.5, y: 0.5 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: '调整封面位置' })).toBeInTheDocument();
  });
});
