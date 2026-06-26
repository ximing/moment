import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '../button/index';
import { MemberPopover, Popover, ReactionPopover } from './index';

// Popover 行为契约（Menu/Popover/Tooltip 规范 §8）：
// ReactionPopover 是可访问网格（aria-label、当前/首个表情初始聚焦、
// 二维方向键、Enter 选择后立即关闭并复焦入口）；MemberPopover 桌面
// hover/focus 300ms 打开、指针跨入浮面保持、点击/触摸立即打开、
// 焦点留在 Trigger 上并以描述关系对读屏可达、外部/Escape 关闭。

describe('ReactionPopover', () => {
  function Harness({
    value = null,
    onChange,
  }: {
    value?: string | null;
    onChange?: (emoji: string) => void;
  }) {
    return (
      <ReactionPopover
        trigger={<IconButton icon={Plus} label="加个表情" />}
        value={value}
        onChange={onChange ?? (() => {})}
      />
    );
  }

  it('打开后呈现带可访问名称的表情网格，初始聚焦当前表情', async () => {
    const user = userEvent.setup();
    render(<Harness value="😂" />);
    await user.click(screen.getByRole('button', { name: '加个表情' }));

    expect(
      await screen.findByRole('grid', { name: '选择表情' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(10);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '😂' })).toHaveFocus(),
    );
  });

  it('表情按钮声明触控最小点击区类（spec §8.2：≥44px）', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '加个表情' }));
    await screen.findByRole('grid', { name: '选择表情' });

    const emojiButton = screen.getByRole('button', { name: '👍' });
    expect(emojiButton.className).toContain('min-h-touch-control');
    expect(emojiButton.className).toContain('min-w-[var(--touch-control-min)]');
  });

  it('没有当前表情时初始聚焦第一个表情', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '加个表情' }));
    await screen.findByRole('grid', { name: '选择表情' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '👍' })).toHaveFocus(),
    );
  });

  it('方向键按二维网格移动，Home/End 跳首尾', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '加个表情' }));
    await screen.findByRole('grid', { name: '选择表情' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '👍' })).toHaveFocus(),
    );

    // 网格 5 列：👍 ❤️ 😂 😮 😢 / 🎉 🥰 👏 💪 🙏
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '❤️' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '🥰' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: '❤️' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: '👍' })).toHaveFocus();
    // 边界不越界
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: '👍' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: '🙏' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '🙏' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: '👍' })).toHaveFocus();
  });

  it('Enter 选择后立即关闭并将焦点返回表情入口', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness value="😂" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '加个表情' });
    await user.click(trigger);
    await screen.findByRole('grid', { name: '选择表情' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '😂' })).toHaveFocus(),
    );

    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('😮');
    await waitFor(() =>
      expect(screen.queryByRole('grid')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('点击表情选择并关闭', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '加个表情' }));
    await screen.findByRole('grid', { name: '选择表情' });

    await user.click(screen.getByRole('button', { name: '🎉' }));
    expect(onChange).toHaveBeenCalledWith('🎉');
    await waitFor(() =>
      expect(screen.queryByRole('grid')).not.toBeInTheDocument(),
    );
  });

  it('Escape 关闭并复焦入口', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '加个表情' });
    await user.click(trigger);
    await screen.findByRole('grid', { name: '选择表情' });

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('grid')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('MemberPopover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function Harness() {
    return (
      <MemberPopover member={{ nickname: 'simon', role: '创建者' }}>
        <button type="button">simon 的头像</button>
      </MemberPopover>
    );
  }

  function openByHover() {
    // React 的 onMouseEnter 由 mouseover 合成
    fireEvent.mouseOver(screen.getByRole('button', { name: 'simon 的头像' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
  }

  it('桌面 hover 约 300ms 后打开，提前不打开', () => {
    render(<Harness />);
    fireEvent.mouseOver(screen.getByRole('button', { name: 'simon 的头像' }));
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText('创建者')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('simon')).toBeInTheDocument();
    expect(screen.getByText('创建者')).toBeInTheDocument();
  });

  it('focus 约 300ms 后打开，blur 关闭', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'simon 的头像' });
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByText('创建者')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('创建者')).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByText('创建者')).toBeNull();
  });

  it('指针从 Trigger 跨入浮面时保持打开，离开浮面后关闭', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'simon 的头像' });
    openByHover();
    const card = screen.getByTestId('member-card');

    fireEvent.mouseOut(trigger);
    // 指针在关闭缓冲期内进入浮面 → 保持
    fireEvent.mouseOver(card);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('member-card')).toBeInTheDocument();

    fireEvent.mouseOut(card);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId('member-card')).toBeNull();
  });

  it('点击立即打开，不需要等待 hover 延迟', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'simon 的头像' }));
    expect(screen.getByText('创建者')).toBeInTheDocument();
  });

  it('焦点保持在外部 Trigger 上，浮面通过描述关系对读屏可达', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'simon 的头像' });
    trigger.focus();
    fireEvent.click(trigger);

    const card = screen.getByTestId('member-card');
    // 非模态信息浮面：焦点不进入浮面
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-describedby', card.id);
  });

  it('外部指针按下关闭', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'simon 的头像' }));
    expect(screen.getByTestId('member-card')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('member-card')).toBeNull();
  });

  it('Escape 关闭且焦点留在 Trigger 上', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'simon 的头像' });
    trigger.focus();
    openByHover();
    expect(screen.getByTestId('member-card')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByTestId('member-card')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('Popover', () => {
  it('点击 Trigger 打开锚定内容、焦点进入首个逻辑控件，Escape 关闭并复焦', async () => {
    const user = userEvent.setup();
    render(
      <Popover
        aria-label="日期详情"
        trigger={<button type="button">查看日期</button>}
      >
        <button type="button">内部控件</button>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: '查看日期' });
    await user.click(trigger);

    await screen.findByRole('dialog', { name: '日期详情' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '内部控件' })).toHaveFocus(),
    );

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
