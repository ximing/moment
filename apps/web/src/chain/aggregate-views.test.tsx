import { render, screen } from '@testing-library/react';
import type { AggregateResponse } from '@moment/dto';
import { describe, expect, it } from 'vitest';
import { AggregateView } from './aggregate-views';

// 聚合视图的数据值渲染（spec 2026-09-03-svg-icon-system §4.2）：
// moodline 心情点与 milestone-axis 节点 icon 经 AppIcon 走注册表 SVG；
// 存量 emoji 数据（😄 / 😊）经 EMOJI_TO_ICON 映射命中同一批画稿。

function renderAggregate(aggregate: AggregateResponse, view: string) {
  return render(
    <AggregateView
      view={view}
      aggregate={aggregate}
      moments={[]}
      chainPayload={null}
      hasMore={false}
      isLoading={false}
      error={null}
      onRetry={() => {}}
    />,
  );
}

describe('MoodlineView', () => {
  it('心情点渲染为注册表 SVG（aria-label="开心"），不再是 emoji 文本节点', () => {
    const { container } = renderAggregate(
      { view: 'moodline', days: [{ date: '2026-09-01', mood: '😄', count: 3 }] },
      'moodline',
    );

    const dots = screen.getAllByRole('img', { name: '开心' });
    expect(dots).toHaveLength(3);
    expect(dots[0]!.tagName).toBe('svg');
    expect(container).not.toHaveTextContent('😄');
  });

  it('超过 10 次折叠为 10 个点加 ×N 文本', () => {
    renderAggregate(
      { view: 'moodline', days: [{ date: '2026-09-01', mood: '😴', count: 12 }] },
      'moodline',
    );

    expect(screen.getAllByRole('img', { name: '困倦' })).toHaveLength(10);
    expect(screen.getByText('×12')).toBeInTheDocument();
  });
});

describe('MilestoneAxisView', () => {
  it('存量 emoji 目录 icon 经映射渲染为注册表 SVG（aria-hidden 装饰位）', () => {
    const { container } = renderAggregate(
      {
        view: 'milestone-axis',
        items: [
          {
            momentId: 'm-1',
            happenedAt: '2026-08-01T02:00:00.000Z',
            label: '第一次微笑',
            icon: '😊',
            note: null,
          },
        ],
      },
      'milestone-axis',
    );

    // 节点位 aria-hidden（label 文本相邻承担语义），SVG 只能在 DOM 层断言
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container).not.toHaveTextContent('😊');
    expect(container).toHaveTextContent('第一次微笑');
  });

  it('icon 缺省渲染 · 占位，icon key 形态同样命中注册表', () => {
    const { container } = renderAggregate(
      {
        view: 'milestone-axis',
        items: [
          {
            momentId: 'm-1',
            happenedAt: '2026-08-01T02:00:00.000Z',
            label: '自定义里程碑',
            icon: null,
            note: null,
          },
          {
            momentId: 'm-2',
            happenedAt: '2026-08-02T02:00:00.000Z',
            label: '第一颗牙',
            icon: 'milestone-first-tooth',
            note: '终于冒头了',
          },
        ],
      },
      'milestone-axis',
    );

    expect(container).toHaveTextContent('·');
    // 两个节点：一个 · 占位（无 svg），一个 key 命中注册表出 svg
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
