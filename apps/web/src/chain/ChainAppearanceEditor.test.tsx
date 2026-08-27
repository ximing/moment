import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChainAppearanceEditor } from './ChainAppearanceEditor';
import type { ChainAppearanceDraft, ChainImageDraft } from './appearance-model';

// frimousse 走 lazy chunk + 运行时拉同源 JSON，jsdom 下不测其内部渲染；
// 用最小 stub 替换 EmojiPicker.Root（保留 onEmojiSelect 契约），验证
// ChainAppearanceEditor 的 lazy 边界与选择回调。真实 frimousse 渲染由
// build + 静态产物校验兜底（plan Task 7 Step 6）。
vi.mock('frimousse', () => {
  function Root({
    onEmojiSelect,
  }: {
    onEmojiSelect?: (emoji: { emoji: string; label: string }) => void;
  }) {
    return (
      <div data-testid="emoji-picker-root">
        <button
          type="button"
          aria-label="选择 🌱"
          onClick={() => onEmojiSelect?.({ emoji: '🌱', label: '幼苗' })}
        >
          🌱
        </button>
      </div>
    );
  }
  return {
    EmojiPicker: {
      Root,
      Search: () => null,
      Viewport: () => null,
      Loading: () => null,
      Empty: () => null,
      List: () => null,
    },
  };
});

function setSlider(slider: HTMLElement, value: number) {
  fireEvent.change(slider, { target: { value: String(value) } });
}

// ChainAppearanceEditor 行为契约（chain-appearance plan Task 7 / spec §7.1/§7.3）：
// 受控组件——draft 只读、所有变更经回调；三个 aria-pressed 互斥模式按钮；
// Emoji 面板 lazy 加载（先出现 fallback，面板加载后用户选择回传 onSelectEmoji）；
// 纯色区提供预设色 + 原生取色器 + hex 输入；图片区展示状态并提供文件选择/重试/删除；
// 独立 cover 区；FocalImageEditor 打开时内联替换内容，确认/取消回传 focus。

function makeImage(partial: Partial<ChainImageDraft> = {}): ChainImageDraft {
  return {
    mediaId: 'm-1',
    src: '/api/media/m-1',
    focus: { x: 0.5, y: 0.5 },
    persisted: true,
    status: 'ready',
    progress: 0,
    error: null,
    fileName: null,
    ...partial,
  };
}

function makeDraft(partial: Partial<ChainAppearanceDraft> = {}): ChainAppearanceDraft {
  return {
    avatarMode: 'color',
    color: 'mint',
    icon: null,
    avatar: null,
    cover: null,
    ...partial,
  };
}

function makeActions() {
  return {
    onSetAvatarMode: vi.fn(),
    onSelectEmoji: vi.fn(),
    onSelectColor: vi.fn(),
    onPickImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onRetryImage: vi.fn(),
    onSetFocus: vi.fn(),
  };
}

describe('ChainAppearanceEditor', () => {
  it('三个 aria-pressed 互斥模式按钮，点击经 onSetAvatarMode 回调', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<ChainAppearanceEditor draft={makeDraft({ avatarMode: 'emoji' })} actions={actions} />);

    const emoji = screen.getByRole('button', { name: 'Emoji' });
    const image = screen.getByRole('button', { name: '图片' });
    const color = screen.getByRole('button', { name: '纯色' });
    expect(emoji).toHaveAttribute('aria-pressed', 'true');
    expect(image).toHaveAttribute('aria-pressed', 'false');
    expect(color).toHaveAttribute('aria-pressed', 'false');

    await user.click(image);
    expect(actions.onSetAvatarMode).toHaveBeenCalledWith('image');
    await user.click(color);
    expect(actions.onSetAvatarMode).toHaveBeenCalledWith('color');
  });

  it('Emoji 模式：选择按钮打开 lazy 面板（先 fallback），选择后回传 onSelectEmoji', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<ChainAppearanceEditor draft={makeDraft({ avatarMode: 'emoji' })} actions={actions} />);

    await user.click(screen.getByRole('button', { name: '选择 Emoji' }));
    // lazy 加载中先渲染 fallback 文案
    expect(screen.getByText('正在载入 Emoji…')).toBeInTheDocument();
    // 面板加载完成后出现可交互的 Emoji 选项
    const option = await screen.findByRole('button', { name: '选择 🌱' });
    await user.click(option);
    expect(actions.onSelectEmoji).toHaveBeenCalledWith('🌱');
  });

  it('Emoji 模式已有选择时预览当前 emoji', () => {
    const actions = makeActions();
    render(
      <ChainAppearanceEditor
        draft={makeDraft({ avatarMode: 'emoji', icon: '🐾' })}
        actions={actions}
      />,
    );
    expect(screen.getByRole('button', { name: /🐾/ })).toBeInTheDocument();
  });

  it('纯色模式：预设色 aria-pressed、原生取色器与 hex 输入都经 onSelectColor', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(
      <ChainAppearanceEditor
        draft={makeDraft({ avatarMode: 'color', color: 'mint' })}
        actions={actions}
      />,
    );

    const mint = screen.getByRole('button', { name: 'mint' });
    expect(mint).toHaveAttribute('aria-pressed', 'true');
    const coral = screen.getByRole('button', { name: 'coral' });
    expect(coral).toHaveAttribute('aria-pressed', 'false');
    await user.click(coral);
    expect(actions.onSelectColor).toHaveBeenCalledWith('coral');

    // 原生取色器（type=color 没有隐式 role，用 label 查询）
    const picker = screen.getByLabelText('自定义颜色');
    expect(picker).toHaveAttribute('type', 'color');
    // hex 输入：失焦后合法值回传大写形式
    const hex = screen.getByLabelText('颜色代码');
    await user.clear(hex);
    await user.type(hex, '#a1b2c3');
    await user.tab();
    expect(actions.onSelectColor).toHaveBeenCalledWith('#A1B2C3');
  });

  it('hex 非法输入显示错误且不冒充成功回调', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(
      <ChainAppearanceEditor
        draft={makeDraft({ avatarMode: 'color', color: 'mint' })}
        actions={actions}
      />,
    );
    const hex = screen.getByLabelText('颜色代码');
    await user.clear(hex);
    await user.type(hex, 'not-a-color');
    await user.tab();
    expect(screen.getByText('颜色格式不正确')).toBeInTheDocument();
    expect(actions.onSelectColor).not.toHaveBeenCalledWith('not-a-color');
  });

  it('图片模式：ready 图片展示预览与文件名，提供重新选择/调整位置/删除', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(
      <ChainAppearanceEditor
        draft={makeDraft({ avatarMode: 'image', avatar: makeImage({ fileName: 'cat.png' }) })}
        actions={actions}
      />,
    );

    expect(screen.getByRole('img', { name: '头像预览' })).toHaveAttribute(
      'src',
      '/api/media/m-1',
    );
    expect(screen.getByText('cat.png')).toBeInTheDocument();

    // 重新选择触发隐藏 file input 的 change 路径（经按钮点击打开文件对话框，
    // jsdom 中直接向 input 注入文件）
    const fileInput = screen.getByLabelText('选择头像图片');
    const file = new File(['x'], 'dog.png', { type: 'image/png' });
    await user.upload(fileInput, file);
    expect(actions.onPickImage).toHaveBeenCalledWith('avatar', file);

    await user.click(screen.getByRole('button', { name: '删除头像' }));
    expect(actions.onRemoveImage).toHaveBeenCalledWith('avatar');
  });

  it('上传中展示进度、隐藏删除以外的编辑动作；失败展示错误与重试', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const { rerender } = render(
      <ChainAppearanceEditor
        draft={makeDraft({
          avatarMode: 'image',
          avatar: makeImage({ persisted: false, status: 'uploading', progress: 42, src: 'blob:x' }),
        })}
        actions={actions}
      />,
    );
    expect(screen.getByRole('progressbar', { name: '上传头像 42%' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '调整头像位置' })).not.toBeInTheDocument();

    rerender(
      <ChainAppearanceEditor
        draft={makeDraft({
          avatarMode: 'image',
          avatar: makeImage({ persisted: false, status: 'error', error: '网络错误', src: 'blob:x' }),
        })}
        actions={actions}
      />,
    );
    expect(screen.getByText('网络错误')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试上传头像' }));
    expect(actions.onRetryImage).toHaveBeenCalledWith('avatar');
  });

  it('调整位置打开 FocalImageEditor，确认经 onSetFocus 回传并回到预览', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(
      <ChainAppearanceEditor
        draft={makeDraft({ avatarMode: 'image', avatar: makeImage() })}
        actions={actions}
      />,
    );

    await user.click(screen.getByRole('button', { name: '调整头像位置' }));
    // 编辑器内联出现：range + 确认/取消
    setSlider(screen.getByRole('slider', { name: '水平位置' }), 51);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(actions.onSetFocus).toHaveBeenCalledWith('avatar', { x: 0.51, y: 0.5 });
    // 关闭后回到预览
    expect(screen.getByRole('img', { name: '头像预览' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: '水平位置' })).not.toBeInTheDocument();
  });

  it('封面区独立：无封面时提供选择入口，有封面时展示宽幅预览与删除', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const { rerender } = render(
      <ChainAppearanceEditor draft={makeDraft()} actions={actions} />,
    );
    expect(screen.getByText('封面')).toBeInTheDocument();
    const coverInput = screen.getByLabelText('选择封面图片');
    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    await user.upload(coverInput, file);
    expect(actions.onPickImage).toHaveBeenCalledWith('cover', file);

    rerender(
      <ChainAppearanceEditor
        draft={makeDraft({ cover: makeImage({ mediaId: 'm-9', src: '/api/media/m-9' }) })}
        actions={actions}
      />,
    );
    expect(screen.getByRole('img', { name: '封面预览' })).toHaveAttribute('src', '/api/media/m-9');
    await user.click(screen.getByRole('button', { name: '删除封面' }));
    expect(actions.onRemoveImage).toHaveBeenCalledWith('cover');
  });

  it('受控：组件不直接修改 draft——回调后仍渲染旧值，直到收到新 draft', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const { rerender } = render(
      <ChainAppearanceEditor draft={makeDraft({ color: 'mint' })} actions={actions} />,
    );
    await user.click(screen.getByRole('button', { name: 'coral' }));
    // 未收到新 draft：aria-pressed 不切换（受控语义）
    expect(screen.getByRole('button', { name: 'coral' })).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <ChainAppearanceEditor draft={makeDraft({ color: 'coral' })} actions={actions} />,
    );
    expect(screen.getByRole('button', { name: 'coral' })).toHaveAttribute('aria-pressed', 'true');
  });
});
