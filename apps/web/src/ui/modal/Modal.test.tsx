import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog, Dialog, Sheet } from './index';
import type { CloseReason } from './index';

// Modal 家族行为契约（Modal/Dialog/Sheet 规范 §9 / §10 / §14）：
// 受控 open；onRequestClose 只报告 close-button / escape / outside 意图；
// busy 抑制一切关闭请求；关闭后焦点回到触发按钮；AlertDialog 初始聚焦
// 更安全的取消操作、Escape 等价 onCancel、外部点击不关闭；Sheet 是单一
// 组件，用 768px 媒体查询类切换桌面右侧浮层与移动端底部近全高形态。

type HarnessProps = {
  busy?: boolean;
  onRequestClose?: (reason: CloseReason) => void;
};

function DialogHarness({ busy = false, onRequestClose }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        开一条新的链
      </button>
      <Dialog
        open={open}
        title="开一条新的链"
        busy={busy}
        footer={<button type="button">创建</button>}
        onRequestClose={(reason) => {
          onRequestClose?.(reason);
          setOpen(false);
        }}
      >
        <p>链名称表单</p>
      </Dialog>
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: '开一条新的链' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '开一条新的链' });
  return { trigger, dialog };
}

function AlertHarness({
  busy = false,
  onCancel,
  onConfirm,
}: {
  busy?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <AlertDialog
      open={open}
      title="放弃这次记录？"
      body="已经写下的内容和选择的照片不会保留。"
      confirmLabel="放弃记录"
      cancelLabel="继续记录"
      danger
      busy={busy}
      onConfirm={() => onConfirm?.()}
      onCancel={() => {
        onCancel?.();
        setOpen(false);
      }}
    />
  );
}

describe('Dialog', () => {
  it('Escape 以 escape 原因请求关闭', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(<DialogHarness onRequestClose={onRequestClose} />);
    await openDialog(user);

    await user.keyboard('{Escape}');
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledWith('escape');
  });

  it('点击遮罩以 outside 原因请求关闭', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(<DialogHarness onRequestClose={onRequestClose} />);
    await openDialog(user);

    await user.click(screen.getByTestId('modal-scrim'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledWith('outside');
  });

  it('右上角关闭按钮以 close-button 原因请求关闭，且名称可读', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(<DialogHarness onRequestClose={onRequestClose} />);
    await openDialog(user);

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledWith('close-button');
  });

  it('关闭后焦点回到触发按钮', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const { trigger } = await openDialog(user);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // react-aria FocusScope 的焦点恢复在 requestAnimationFrame 中完成，用 waitFor 等待落地
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('busy 抑制 Close / Escape / Outside 全部关闭请求并标记 aria-busy', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(<DialogHarness busy onRequestClose={onRequestClose} />);
    const { dialog } = await openDialog(user);
    expect(dialog).toHaveAttribute('aria-busy', 'true');

    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('modal-scrim'));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Sheet', () => {
  it('以单一组件渲染，通过 768px 媒体查询类切换形态', () => {
    render(
      <Sheet
        open
        title="记下此刻"
        footer={<button type="button">记下</button>}
        onRequestClose={() => {}}
      >
        <p>记录内容</p>
      </Sheet>,
    );
    const sheets = screen.getAllByRole('dialog', { name: '记下此刻' });
    expect(sheets).toHaveLength(1);
    // <768px 底部近全高（只保留顶部圆角）与 ≥768px 右侧浮层（24px 圆角）
    // 由同一份 class 里的媒体查询前缀切换，而不是两个组件或 JS 断点
    expect(sheets[0].className).toContain('rounded-sheet-mobile');
    expect(sheets[0].className).toContain('md:rounded-overlay');
  });
});

describe('AlertDialog', () => {
  it('使用 alertdialog 语义且没有右上角关闭按钮', () => {
    render(<AlertHarness />);
    expect(
      screen.getByRole('alertdialog', { name: '放弃这次记录？' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '关闭' }),
    ).not.toBeInTheDocument();
  });

  it('初始聚焦更安全的取消操作，而不是危险确认', async () => {
    render(<AlertHarness />);
    const cancel = await screen.findByRole('button', { name: '继续记录' });
    expect(cancel).toHaveFocus();
  });

  it('Escape 等价于取消操作 onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<AlertHarness onCancel={onCancel} onConfirm={onConfirm} />);
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('外部点击不关闭', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<AlertHarness onCancel={onCancel} />);
    await screen.findByRole('alertdialog');

    await user.click(screen.getByTestId('modal-scrim'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('busy 时 Escape 与取消都被抑制，确认进入 loading 且不可重复提交', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<AlertHarness busy onCancel={onCancel} onConfirm={onConfirm} />);
    const confirm = await screen.findByRole('button', { name: '放弃记录' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');

    await user.keyboard('{Escape}');
    await user.click(confirm);
    await user.click(screen.getByRole('button', { name: '继续记录' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
