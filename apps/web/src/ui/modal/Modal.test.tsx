import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog, Dialog, Sheet } from './index';
import type { CloseReason } from './index';

// Modal 家族行为契约（Modal/Dialog/Sheet 规范 §9 / §10 / §11 / §14）：
// 受控 open；onRequestClose 只报告 close-button / escape / outside 意图；
// busy 抑制一切关闭请求；关闭后焦点回到触发按钮；AlertDialog 初始聚焦
// 更安全的取消操作、Escape 等价 onCancel、外部点击不关闭；Sheet 是单一
// 组件，用 768px 媒体查询类切换桌面右侧浮层与移动端底部近全高形态。
// 动效（§11）挂在 RAC data-entering / data-exiting 态上：Scrim 透明度 160ms，
// Dialog/AlertDialog 上移 8px + scale 0.98→1（180ms 进 / 120ms 出），Sheet
// 移动端底部 / 桌面右侧进出（220ms 进 / 160ms 出）；reduced-motion 取消位移
// 与缩放。RAC 经 getAnimations() 自动延迟卸载到退出动画播完；jsdom 无
// getAnimations，卸载同步发生，这里只断言动效类挂载。

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

  it('滚动区为 Field 状态环留出左右呼吸，避免 overflow-y-auto 裁切', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const { dialog } = await openDialog(user);
    const body = dialog.querySelector('.overflow-y-auto');
    expect(body).toBeTruthy();
    expect(body?.className).toContain('px-2');
    expect(body?.className).toContain('-mx-2');
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

describe('Modal 动效（规范 §11）', () => {
  it('Scrim 挂 160ms 透明度进出动画，reduced-motion 下取消', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: '开一条新的链' }));
    const scrim = screen.getByTestId('modal-scrim');
    expect(scrim.className).toContain(
      'data-[entering]:animate-[moment-scrim-in_160ms_ease-out]',
    );
    expect(scrim.className).toContain(
      'data-[exiting]:animate-[moment-scrim-out_160ms_ease-in]',
    );
    expect(scrim.className).toContain('motion-reduce:data-[entering]:animate-none');
    expect(scrim.className).toContain('motion-reduce:data-[exiting]:animate-none');
  });

  it('Dialog 挂上移 8px + scale 0.98→1 进出动画', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: '开一条新的链' }));
    const dialog = screen.getByRole('dialog', { name: '开一条新的链' });
    const modal = dialog.parentElement as HTMLElement;
    expect(modal.className).toContain(
      'data-[entering]:animate-[moment-dialog-in_180ms_ease-out]',
    );
    expect(modal.className).toContain(
      'data-[exiting]:animate-[moment-dialog-out_120ms_ease-in]',
    );
    expect(modal.className).toContain('motion-reduce:data-[entering]:animate-none');
  });

  it('AlertDialog 与 Dialog 共用同一组进出动画', () => {
    render(<AlertHarness />);
    const alert = screen.getByRole('alertdialog', { name: '放弃这次记录？' });
    const modal = alert.parentElement as HTMLElement;
    expect(modal.className).toContain('moment-dialog-in_180ms_ease-out');
    expect(modal.className).toContain('moment-dialog-out_120ms_ease-in');
  });

  it('Sheet 移动端底部、桌面右侧进出，各 220ms 进 / 160ms 出', () => {
    render(
      <Sheet open title="记下此刻" onRequestClose={() => {}}>
        <p>记录内容</p>
      </Sheet>,
    );
    const sheet = screen.getByRole('dialog', { name: '记下此刻' });
    const modal = sheet.parentElement as HTMLElement;
    // <768px 底部进出；≥768px 经 md: 切换为右侧进出（单一组件媒体查询切换）
    expect(modal.className).toContain(
      'data-[entering]:animate-[moment-sheet-in-bottom_220ms_ease-out]',
    );
    expect(modal.className).toContain(
      'md:data-[entering]:animate-[moment-sheet-in-right_220ms_ease-out]',
    );
    expect(modal.className).toContain(
      'data-[exiting]:animate-[moment-sheet-out-bottom_160ms_ease-in]',
    );
    expect(modal.className).toContain(
      'md:data-[exiting]:animate-[moment-sheet-out-right_160ms_ease-in]',
    );
    expect(modal.className).toContain('motion-reduce:data-[entering]:animate-none');
    expect(modal.className).toContain('motion-reduce:data-[exiting]:animate-none');
  });

  it('open 转 false 后 RAC 完成退出才卸载（jsdom 无 getAnimations，同步卸载）', () => {
    const { rerender } = render(
      <Dialog open title="开一条新的链" onRequestClose={() => {}}>
        <p>链名称表单</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <Dialog open={false} title="开一条新的链" onRequestClose={() => {}}>
        <p>链名称表单</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('桌面宽度链是 md:w-full + md:max-w-sheet（规范 §5.2：min(520px, 100vw-24px)）', () => {
    render(
      <Sheet open title="记下此刻" onRequestClose={() => {}}>
        <p>记录内容</p>
      </Sheet>,
    );
    const sheet = screen.getByRole('dialog', { name: '记下此刻' });
    const modal = sheet.parentElement as HTMLElement;
    // sheet-w 只发布在 maxWidth 映射上：必须经 max-w-sheet 消费；
    // 曾经写成 md:w-sheet（无对应工具类、不生成 CSS），桌面宽度退化为 shrink-to-fit
    expect(modal.className).toContain('md:w-full');
    expect(modal.className).toContain('md:max-w-sheet');
    expect(modal.className).not.toContain('md:w-sheet');
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
