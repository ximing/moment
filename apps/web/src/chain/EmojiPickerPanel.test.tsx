import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChainAppearanceEditor } from './ChainAppearanceEditor';
import type { ChainAppearanceDraft } from './appearance-model';

// 真实 EmojiPickerPanel 渲染 smoke（chain-appearance Task 8 ruling）：不打 frimousse 桩，
// 验证真实 Root/Search 在 jsdom 下能挂载（单 React 经 vitest deps.optimizer 统一，
// 见 vitest.config.ts 注释）；emojibase 数据拉取在 jsdom 下失败只影响列表内容，
// 不影响选择器壳。列表交互由 Task 10 真实浏览器验收兜底。

function makeDraft(): ChainAppearanceDraft {
  return { avatarMode: 'emoji', color: null, icon: null, avatar: null, cover: null };
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

beforeAll(() => {
  // jsdom 无 ResizeObserver；frimousse Viewport 的虚拟列表需要它（最小桩，不触发回调）
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe('EmojiPickerPanel 真实渲染 smoke', () => {
  it('打开面板后真实 frimousse Root + Search 挂载（无 mock）', async () => {
    const user = userEvent.setup();
    render(<ChainAppearanceEditor draft={makeDraft()} actions={makeActions()} />);

    await user.click(screen.getByRole('button', { name: '选择 Emoji' }));

    // 真实 frimousse 的搜索输入（placeholder 来自 EmojiPickerPanel 的 props）
    await waitFor(
      () => expect(screen.getByPlaceholderText('搜索 Emoji')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});
