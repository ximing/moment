import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DateTimeField } from './index';

// DateTimeField 墙钟契约（Field 规范 §7.5；迁移自 HappenedAtField）：
// value/onChange 是本地 YYYY-MM-DDTHH:mm 字符串，组件内部不得构造 Date、
// 不做 UTC/浏览器时区换算；hint 通过稳定 ID 关联到触发控件；指针与键盘
// 都能打开浮层，改日期/分钟都按墙钟原样回传。

// jsdom 未实现 scrollIntoView；React Aria 日历的键盘聚焦会调用它。
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function Harness({
  initial = '2026-08-18T17:30',
  onChange,
}: {
  initial?: string;
  onChange: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimeField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      hint="按发生时间排列"
    />
  );
}

describe('DateTimeField', () => {
  it('渲染墙钟显示，hint 通过稳定 ID 关联到触发控件', () => {
    render(
      <DateTimeField
        value="2026-08-18T17:30"
        onChange={() => {}}
        hint="按发生时间排列"
      />,
    );
    const trigger = screen.getByRole('button', { name: '发生在' });
    expect(within(trigger).getByText('2026-08-18 17:30')).toBeInTheDocument();
    const hint = screen.getByText('按发生时间排列');
    expect(hint.id).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-describedby', hint.id);
  });

  it('指针点击打开日历，改日期后 onChange 原样回传墙钟字符串', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '发生在' }));
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByText('20'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next).toBe('2026-08-20T17:30');
    // 不带偏移量、不经 UTC：严格 YYYY-MM-DDTHH:mm
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('键盘打开，调整分钟与小时按墙钟回传', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '发生在' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('grid');

    // 17:30 → 下午 5:30
    expect(screen.getByRole('button', { name: '下午' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '分钟加一' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-18T17:31');
    // 受控值已进到 17:31，小时步进在此基础上叠加
    await user.click(screen.getByRole('button', { name: '小时加一' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-18T18:31');

    // Escape 关闭并复焦触发控件
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('onChange 回传值受控 rerender 后墙钟显示一致', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '发生在' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '分钟减一' }));
    expect(onChange).toHaveBeenCalledWith('2026-08-18T17:29');

    // 受控值更新后，显示同一墙钟，无分秒漂移与时区偏移
    await waitFor(() =>
      expect(within(trigger).getByText('2026-08-18 17:29')).toBeInTheDocument(),
    );
  });
});
