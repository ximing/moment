import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SelectField } from './index';

// SelectField 契约（Field 规范 §2.2/§5/§6/§9）：可见 Label、Description/Error
// 与触发按钮关联；Error 替换 Description；React Aria 键盘模型
// （ArrowDown/ArrowUp 打开与移动、Enter 选择、Escape 关闭复焦），
// 复用 listbox/option 语义，不复用 Menu 的 menu/menuitem 语义。

// jsdom 未实现 scrollIntoView；React Aria 集合的键盘导航会调用它。
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const OPTIONS = [
  { value: 'family', label: '仅家人' },
  { value: 'public', label: '公开' },
  { value: 'private', label: '仅自己' },
];

function Harness({ onChange }: { onChange: (next: string) => void }) {
  const [value, setValue] = useState('family');
  return (
    <SelectField
      label="可见范围"
      name="audience"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={OPTIONS}
    />
  );
}

describe('SelectField', () => {
  it('Label、Description 与触发按钮关联，控件高 44px 并显示当前值', () => {
    render(
      <SelectField
        label="可见范围"
        name="audience"
        description="决定谁能在时间线上看到"
        value="family"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    const trigger = screen.getByRole('button', { name: /可见范围/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger.className).toContain('h-field');
    const description = screen.getByText('决定谁能在时间线上看到');
    expect(description.id).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-describedby', description.id);
    expect(within(trigger).getByText('仅家人')).toBeInTheDocument();
  });

  it('Error 替换 Description 并进入触发按钮的 aria-describedby', () => {
    render(
      <SelectField
        label="可见范围"
        name="audience"
        description="决定谁能在时间线上看到"
        isInvalid
        errorMessage="请选择可见范围"
        value="family"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    const trigger = screen.getByRole('button', { name: /可见范围/ });
    expect(screen.queryByText('决定谁能在时间线上看到')).toBeNull();
    const error = screen.getByText('请选择可见范围');
    expect(trigger).toHaveAttribute('aria-describedby', error.id);
  });

  it('键盘模型：ArrowDown 打开、方向键移动、Enter 选择并复焦触发按钮', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /可见范围/ });
    trigger.focus();

    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    // listbox/option 语义，不是 menu/menuitem
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: '仅家人' })).toHaveFocus(),
    );

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: '公开' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: '仅家人' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('public');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Escape 关闭且不改变选中值，焦点返回触发按钮', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /可见范围/ });

    await user.click(trigger);
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
    expect(within(trigger).getByText('仅家人')).toBeInTheDocument();
  });

  it('指针打开并点选选项', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /可见范围/ }));
    await user.click(await screen.findByRole('option', { name: '公开' }));
    expect(onChange).toHaveBeenCalledWith('public');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
