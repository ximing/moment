import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '../button/index';
import {
  ContextMenu,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  ResponsiveMenu,
  type ContextMenuHandle,
} from './index';

// Menu 行为契约（Menu/Popover/Tooltip 规范 §3 / §6 / §7）：
// 调用方不读视口宽度；≥768px 是锚定 Menu（role="menu"、方向键、字母导航、
// Home/End、Escape 复焦），<768px 是模态 ActionSheet（Scrim、独立“取消”、
// 初始聚焦首个非危险操作）；打开期间跨越 767/768 边界直接关闭并复焦。
// ContextMenu 只在桌面提供右键 / Shift+F10 快捷入口，复用同一命令集合。

type ViewportController = { setDesktop(desktop: boolean): void };

function stubViewport(desktop: boolean): ViewportController {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mql = {
    media: '(min-width: 768px)',
    matches: desktop,
    onchange: null,
    addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) =>
      listeners.add(cb),
    removeEventListener: (
      _type: string,
      cb: (event: { matches: boolean }) => void,
    ) => listeners.delete(cb),
    addListener: (cb: (event: { matches: boolean }) => void) =>
      listeners.add(cb),
    removeListener: (cb: (event: { matches: boolean }) => void) =>
      listeners.delete(cb),
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', (query: string) =>
    query === '(min-width: 768px)'
      ? mql
      : { ...mql, media: query, matches: false },
  );
  return {
    setDesktop(next: boolean) {
      (mql as { matches: boolean }).matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type HarnessProps = {
  onAction?: (key: string | number) => void;
  /** 把首项设为禁用，验证跳过禁用项的聚焦 */
  disabledFirst?: boolean;
  /** 把危险项放在首位，验证 ActionSheet 不自动聚焦危险项 */
  dangerFirst?: boolean;
};

function MenuHarness({
  onAction,
  disabledFirst = false,
  dangerFirst = false,
}: HarnessProps) {
  const edit = (
    <MenuItem
      key="edit"
      id="edit"
      icon={Pencil}
      textValue="编辑时刻"
      isDisabled={disabledFirst}
      disabledReason={disabledFirst ? '仅创建者可编辑' : undefined}
    >
      编辑时刻
    </MenuItem>
  );
  const share = (
    <MenuItem key="share" id="share" textValue="分享时刻">
      分享时刻
    </MenuItem>
  );
  const del = (
    <MenuItem key="delete" id="delete" icon={Trash2} textValue="删除时刻" tone="danger">
      删除时刻
    </MenuItem>
  );
  return (
    <ResponsiveMenu
      aria-label="这条时刻的操作"
      sheetTitle="这条时刻"
      sheetContext="周末小家 · simon"
      trigger={<IconButton icon={MoreHorizontal} label="更多操作" />}
      onAction={onAction}
    >
      {dangerFirst ? [del, edit, share] : [edit, share, del]}
    </ResponsiveMenu>
  );
}

describe('ResponsiveMenu（桌面 ≥768px 锚定 Menu）', () => {
  it('Trigger 具有 menu 语义，打开后标记 expanded 并与浮层关联', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    // react-aria 对菜单触发点按 WAI-ARIA 1.1 输出 aria-haspopup="true"，
    // 读屏仍宣告为 menu；展开状态与关联关系由库统一维护
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // 菜单由 Trigger 命名，建立稳定关联
    expect(menu).toHaveAttribute('aria-labelledby', trigger.id);
  });

  it('ArrowDown 从 Trigger 打开并聚焦首个启用项（跳过禁用项）', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness disabledFirst />);
    screen.getByRole('button', { name: '更多操作' }).focus();

    await user.keyboard('{ArrowDown}');
    await screen.findByRole('menu');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: '分享时刻' }),
      ).toHaveFocus(),
    );
  });

  it('ArrowUp 从 Trigger 打开并聚焦最后一个启用项', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    screen.getByRole('button', { name: '更多操作' }).focus();

    await user.keyboard('{ArrowUp}');
    await screen.findByRole('menu');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: '删除时刻' }),
      ).toHaveFocus(),
    );
  });

  it('支持按文字定位，Home/End 跳到首尾', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await screen.findByRole('menu');

    await user.keyboard('分');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '分享时刻' })).toHaveFocus(),
    );
    await user.keyboard('{End}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '删除时刻' })).toHaveFocus(),
    );
    await user.keyboard('{Home}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '编辑时刻' })).toHaveFocus(),
    );
  });

  it('Enter 执行命令、关闭并复焦 Trigger', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MenuHarness onAction={onAction} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('menu');

    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('edit');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Escape 关闭并复焦 Trigger', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    await screen.findByRole('menu');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('点击浮层外关闭', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await screen.findByRole('menu');

    await user.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('MenuLinkItem 使用链接语义而不是按钮模拟导航', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(
      <ResponsiveMenu
        aria-label="链操作"
        trigger={<IconButton icon={MoreHorizontal} label="链操作" />}
        onAction={() => {}}
      >
        <MenuLinkItem id="settings" textValue="链设置" href="/chains/1/settings">
          链设置
        </MenuLinkItem>
      </ResponsiveMenu>,
    );
    await user.click(screen.getByRole('button', { name: '链操作' }));

    const item = await screen.findByRole('menuitem', { name: '链设置' });
    expect(item.tagName).toBe('A');
    expect(item).toHaveAttribute('href', '/chains/1/settings');
  });

  it('MenuGroup 以分组与可选短标题组织命令', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(
      <ResponsiveMenu
        aria-label="时刻操作"
        trigger={<IconButton icon={MoreHorizontal} label="时刻操作" />}
        onAction={() => {}}
      >
        <MenuItem id="edit" textValue="编辑时刻">
          编辑时刻
        </MenuItem>
        <MenuGroup label="危险区">
          <MenuItem id="delete" textValue="删除时刻" tone="danger">
            删除时刻
          </MenuItem>
        </MenuGroup>
      </ResponsiveMenu>,
    );
    await user.click(screen.getByRole('button', { name: '时刻操作' }));

    const group = await screen.findByRole('group', { name: '危险区' });
    expect(
      within(group).getByRole('menuitem', { name: '删除时刻' }),
    ).toBeInTheDocument();
  });

  it('禁用项不执行命令，并用简短尾部文本说明原因', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MenuHarness disabledFirst onAction={onAction} />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    const item = await screen.findByRole('menuitem', { name: /编辑时刻/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).getByText('仅创建者可编辑')).toBeInTheDocument();

    await user.click(item);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('ResponsiveMenu（<768px 模态 ActionSheet）', () => {
  it('打开为带可访问标题的模态 ActionSheet，含对象上下文与独立“取消”', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));

    const sheet = await screen.findByRole('dialog', { name: '这条时刻' });
    expect(within(sheet).getByText('周末小家 · simon')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('menuitem', { name: '编辑时刻' }),
    ).toBeInTheDocument();
    // “取消”是独立的最后点击区，不与命令混排
    expect(
      within(sheet).getByRole('button', { name: '取消' }),
    ).toBeInTheDocument();
    // 桌面锚定形态不出现（命令列表在 ActionSheet 内仍保持 menu 语义）
    expect(document.querySelector('.moment-floating')).toBeNull();
  });

  it('“取消”关闭并复焦 Trigger', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: '这条时刻' });

    await user.click(within(sheet).getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Escape 关闭并复焦 Trigger', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: '这条时刻' });

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('点击 Scrim 关闭', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await screen.findByRole('dialog', { name: '这条时刻' });

    await user.click(screen.getByTestId('action-sheet-scrim'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('初始聚焦首个非危险操作，不自动聚焦危险项', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness dangerFirst />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await screen.findByRole('dialog', { name: '这条时刻' });

    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: '编辑时刻' }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole('menuitem', { name: '删除时刻' }),
    ).not.toHaveFocus();
  });

  it('选择命令后关闭并回调 onAction', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MenuHarness onAction={onAction} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: '这条时刻' });

    await user.click(within(sheet).getByRole('menuitem', { name: '分享时刻' }));
    expect(onAction).toHaveBeenCalledWith('share');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('断点跨越（767/768）', () => {
  it('桌面 Menu 打开期间跨越到 <768px 时直接关闭并复焦，不变形', async () => {
    const ctl = stubViewport(true);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    await screen.findByRole('menu');

    act(() => ctl.setDesktop(false));
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    // 没有变成屏幕中间的另一种形态
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('移动 ActionSheet 打开期间跨越到 ≥768px 时直接关闭并复焦', async () => {
    const ctl = stubViewport(false);
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: '这条时刻' });

    act(() => ctl.setDesktop(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('ContextMenu', () => {
  it('右键打开命令菜单，复用 Menu 键盘模型', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ContextMenu
        aria-label="链导航操作"
        onAction={onAction}
        items={
          <>
            <MenuItem id="open" textValue="打开链">
              打开链
            </MenuItem>
            <MenuItem id="pin" textValue="置顶链">
              置顶链
            </MenuItem>
          </>
        }
      >
        <div>链导航项</div>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText('链导航项'), {
      clientX: 120,
      clientY: 80,
    });
    await screen.findByRole('menu');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '打开链' })).toHaveFocus(),
    );
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '置顶链' })).toHaveFocus(),
    );
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('pin');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('Shift+F10 打开同一命令集合', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(
      <ContextMenu
        aria-label="链导航操作"
        onAction={() => {}}
        items={
          <MenuItem id="open" textValue="打开链">
            打开链
          </MenuItem>
        }
      >
        <button type="button">链导航项</button>
      </ContextMenu>,
    );
    screen.getByRole('button', { name: '链导航项' }).focus();

    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('Escape 关闭并把焦点还给之前聚焦的元素', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(
      <ContextMenu
        aria-label="链导航操作"
        onAction={() => {}}
        items={
          <MenuItem id="open" textValue="打开链">
            打开链
          </MenuItem>
        }
      >
        <button type="button">链导航项</button>
      </ContextMenu>,
    );
    const area = screen.getByRole('button', { name: '链导航项' });
    area.focus();
    fireEvent.contextMenu(area, { clientX: 120, clientY: 80 });
    await screen.findByRole('menu');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(area).toHaveFocus());
  });

  it('ref 句柄：程序化关闭已打开的菜单（拖拽激活先关菜单，spec chain-ordering §6.2c）', async () => {
    const ref = createRef<ContextMenuHandle>();
    render(
      <ContextMenu
        ref={ref}
        aria-label="链操作"
        items={
          <MenuItem id="settings" textValue="链设置">
            链设置
          </MenuItem>
        }
      >
        <button type="button">链</button>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '链' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    act(() => ref.current?.close());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
