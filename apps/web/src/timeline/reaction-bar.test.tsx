import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicShareMoment } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { ReactionBar } from './reaction-bar';

// 表情条（spec 2026-09-03-svg-icon-system §4.2）：数据里的 reaction emoji 经 AppIcon
// 渲染为注册表 SVG（role="img" + label），不再是 emoji 文本节点；计数文本保留；
// 点选回传的仍是 emoji 原文（REACTION_EMOJIS 契约零改动，P3-3 验证）。

function moment(over: Partial<PublicShareMoment> = {}): PublicShareMoment {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-2', nickname: '妈妈', avatarUrl: null },
    type: 'text',
    content: '粥洒了一圈',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...over,
  };
}

describe('ReactionBar', () => {
  it('已有计数的表情渲染为注册表 SVG（role="img" name="点赞"），计数文本保留', () => {
    render(
      <ReactionBar
        moment={moment({ reactions: [{ emoji: '👍', count: 2 }], myReaction: '👍' })}
        onReact={() => {}}
      />,
    );

    const chip = screen.getByRole('button', { name: /点赞/ });
    const icon = within(chip).getByRole('img', { name: '点赞' });
    expect(icon.tagName).toBe('svg');
    expect(chip).not.toHaveTextContent('👍');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击表情 chip 回传 emoji 原文（值契约不变）', async () => {
    const user = userEvent.setup();
    const onReact = vi.fn();
    render(
      <ReactionBar
        moment={moment({ reactions: [{ emoji: '👍', count: 1 }], myReaction: null })}
        onReact={onReact}
      />,
    );

    await user.click(screen.getByRole('button', { name: /点赞/ }));
    expect(onReact).toHaveBeenCalledWith('👍');
  });

  it('无计数时只留「加个表情」入口', () => {
    render(<ReactionBar moment={moment()} onReact={() => {}} />);
    expect(screen.getByRole('button', { name: '加个表情' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
