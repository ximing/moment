import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimelineSearchField } from './search-field';

describe('TimelineSearchField（Field type=search，不是 SearchBar）', () => {
  it('可见 Label「搜索时刻」+ placeholder；提交 trim 后的 q', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TimelineSearchField onSubmit={onSubmit} onClear={() => undefined} />);
    expect(screen.getByLabelText('搜索时刻')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索时刻，例如 去年今天和外婆')).toBeInTheDocument();
    await user.type(screen.getByLabelText('搜索时刻'), '  外婆  ');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('外婆');
  });

  it('isClearable 清空调用 onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<TimelineSearchField onSubmit={() => undefined} onClear={onClear} />);
    await user.type(screen.getByLabelText('搜索时刻'), '外婆');
    await user.click(screen.getByRole('button', { name: '清除' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('提交时截断到 INTENT_MAX_QUERY_CHARS（不设 maxLength，避免 0/500 计数）', () => {
    const onSubmit = vi.fn();
    render(<TimelineSearchField onSubmit={onSubmit} onClear={() => undefined} />);
    const input = screen.getByLabelText('搜索时刻');
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } });
    fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('x'.repeat(500));
  });
});
