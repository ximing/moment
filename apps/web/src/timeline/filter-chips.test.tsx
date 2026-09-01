import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterChips } from './filter-chips';

describe('FilterChips（spec §7.1 列表顶清除 chip）', () => {
  it('无人/地/before 不渲染', () => {
    const { container } = render(
      <FilterChips
        filter={{ order: 'happened_at' }}
        onClearPerson={() => undefined}
        onClearPlace={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('渲染「外婆 ×」「📍 朝阳公园 ×」，点击清除', async () => {
    const user = userEvent.setup();
    const onClearPerson = vi.fn();
    const onClearPlace = vi.fn();
    render(
      <FilterChips
        filter={{
          order: 'happened_at',
          personId: 'p-1',
          personName: '外婆',
          place: '朝阳公园',
        }}
        onClearPerson={onClearPerson}
        onClearPlace={onClearPlace}
      />,
    );
    await user.click(screen.getByRole('button', { name: '清除人物筛选 外婆' }));
    expect(onClearPerson).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '清除地点筛选 朝阳公园' }));
    expect(onClearPlace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('外婆 ×')).toBeInTheDocument();
    expect(screen.getByText('📍 朝阳公园 ×')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除人物筛选 外婆' }).className).not.toMatch(/\bborder-line\b/);
  });

  it('before 时渲染「回到今天」', async () => {
    const user = userEvent.setup();
    const onClearBefore = vi.fn();
    render(
      <FilterChips
        filter={{ order: 'happened_at', before: '2026-09-01T00:00:00.000Z' }}
        onClearPerson={() => undefined}
        onClearPlace={() => undefined}
        onClearBefore={onClearBefore}
      />,
    );
    await user.click(screen.getByRole('button', { name: '回到今天' }));
    expect(onClearBefore).toHaveBeenCalledTimes(1);
  });
});
