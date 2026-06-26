import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Banner,
  DetailSkeleton,
  EmptyState,
  FeedSkeleton,
  InlineProgress,
  SettingsSkeleton,
  TimelineSkeleton,
  ToastProvider,
  ToastRegion,
  usePending,
  useToast,
} from './index';
import type { EmptyStateProps, ToastController } from './index';

// Feedback 家族行为契约（规范：docs/superpowers/specs/2026-08-18-web-feedback-design.md）
// Toast 精确时钟：普通 3500ms、可撤销 6000ms 可见预算，预算耗尽后播 120ms 退出
// 动画（data-exiting + moment-toast-out）再卸载晋级；同 key 替换重置预算；
// hover / focus 独立暂停、恢复只计剩余毫秒；一显二候；满队列驱逐最老未展示普通确认、
// 绝不驱逐可撤销；路由切换保持 provider 状态；moment:auth-cleared 与 clear() 同一实现
// （同步清空，不播退出动画）。
// usePending：180ms 延迟 + 280ms 最短可见；reduced-motion 只停 Skeleton 动画、不改计时。

describe('Banner', () => {
  it('error tone 使用 role="alert"，warning / info 使用 role="status"', () => {
    render(
      <>
        <Banner tone="error">没能刷新大家的日子</Banner>
        <Banner tone="warning">部分照片暂未同步</Banner>
        <Banner tone="info">这条链仅自己可见</Banner>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('没能刷新大家的日子');
    const statuses = screen.getAllByRole('status');
    expect(statuses[0]).toHaveTextContent('部分照片暂未同步');
    expect(statuses[1]).toHaveTextContent('这条链仅自己可见');
  });

  it('action pending 期间不可重复提交，完成后允许重试', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onPress = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    render(
      <Banner tone="error" action={{ label: '再试一次', onPress }}>
        没能刷新大家的日子
      </Banner>,
    );
    const actionButton = screen.getByRole('button', { name: '再试一次' });

    await user.click(actionButton);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(actionButton).toHaveAttribute('aria-busy', 'true');

    // pending 中再次点击被吞掉
    await user.click(actionButton);
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => release());
    expect(actionButton).not.toHaveAttribute('aria-busy');

    await user.click(actionButton);
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('EmptyState', () => {
  it('渲染标题、说明与至多一个 action', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <EmptyState
        variant="timeline"
        scope="page"
        title="还没有记下任何一刻"
        description="第一条记忆会从这条日子线上长出来"
        action={{ label: '记下此刻', onPress, emphasis: 'primary' }}
      />,
    );
    expect(screen.getByText('还没有记下任何一刻')).toBeInTheDocument();
    expect(
      screen.getByText('第一条记忆会从这条日子线上长出来'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '记下此刻' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('无 action 时不渲染按钮，空状态不被播报为错误', () => {
    const { container } = render(
      <EmptyState
        variant="plain"
        scope="section"
        title="没找到相关记忆"
        description="换个关键词试试"
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('类型层拒绝第二个 action', () => {
    const action = {
      label: '清除筛选',
      emphasis: 'quiet',
      onPress: () => undefined,
      // @ts-expect-error —— EmptyState 至多一个 action，类型层拒绝第二操作
      secondary: { label: '返回', onPress: () => undefined },
    } satisfies NonNullable<EmptyStateProps['action']>;
    expect(action.label).toBe('清除筛选');
  });
});

describe('Toast 时钟与队列', () => {
  let toast: ToastController;

  function Probe({ route }: { route: string }) {
    toast = useToast();
    return <div data-testid="route-child">{route}</div>;
  }

  function renderApp(route = '/chains') {
    return render(
      <ToastProvider>
        <Probe route={route} />
        <ToastRegion />
      </ToastProvider>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ToastRegion 是 polite live region，不抢焦点', () => {
    renderApp();
    const region = screen.getByRole('region', { name: '通知' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('ToastRegion 暴露带可访问名称的 region landmark', () => {
    renderApp();
    const region = screen.getByRole('region', { name: '通知' });
    expect(region).toBe(screen.getByRole('region', { name: '通知' }));
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('普通 Toast 可见预算精确 3500ms，随后播 120ms 退出动画再卸载', () => {
    renderApp();
    act(() => toast.show({ key: 'saved', message: '设置已保存' }));
    expect(screen.getByText('设置已保存')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3499));
    expect(screen.getByText('设置已保存')).toBeInTheDocument();
    // 预算耗尽：进入退出阶段，Toast 仍在 DOM（规范 §5.6：120ms ease-in 淡出）
    act(() => vi.advanceTimersByTime(1));
    const exiting = screen.getByTestId('toast');
    expect(exiting).toHaveAttribute('data-exiting');
    expect(exiting.className).toContain('moment-toast-out');
    act(() => vi.advanceTimersByTime(119));
    expect(screen.getByText('设置已保存')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('设置已保存')).toBeNull();
  });

  it('进入动画使用 moment-toast-in，退出才切到 moment-toast-out', () => {
    renderApp();
    act(() => toast.show({ key: 'saved', message: '设置已保存' }));
    const item = screen.getByTestId('toast');
    expect(item.className).toContain('moment-toast-in');
    expect(item).not.toHaveAttribute('data-exiting');

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByTestId('toast').className).toContain('moment-toast-out');
    expect(screen.getByTestId('toast').className).not.toContain(
      'moment-toast-in',
    );
  });

  it('可撤销 Toast 可见预算精确 6000ms，随后 120ms 退出动画', () => {
    renderApp();
    act(() =>
      toast.show({
        key: 'hidden',
        message: '已从汇总中隐藏',
        action: { label: '撤销', onPress: () => undefined },
      }),
    );
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();
    expect(screen.getByTestId('toast')).not.toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(119));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('已从汇总中隐藏')).toBeNull();
  });

  it('相同 key 替换内容并重启精确预算', () => {
    renderApp();
    act(() => toast.show({ key: 'saved', message: '第一版' }));
    act(() => vi.advanceTimersByTime(3000));
    act(() => toast.show({ key: 'saved', message: '第二版' }));
    expect(screen.queryByText('第一版')).toBeNull();
    expect(screen.getByText('第二版')).toBeInTheDocument();

    // 预算从替换时刻重计 3500ms，而不是沿用旧的 500ms 剩余
    act(() => vi.advanceTimersByTime(3499));
    expect(screen.getByText('第二版')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByText('第二版')).toBeNull();
  });

  it('hover 暂停计时，离开后只计剩余毫秒', () => {
    renderApp();
    act(() => toast.show({ key: 'saved', message: '设置已保存' }));
    act(() => vi.advanceTimersByTime(1000));

    fireEvent.mouseOver(screen.getByTestId('toast'));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText('设置已保存')).toBeInTheDocument();

    fireEvent.mouseOut(screen.getByTestId('toast'));
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByText('设置已保存')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByText('设置已保存')).toBeNull();
  });

  it('focus 与 hover 独立暂停，全部离开后才恢复剩余时间', () => {
    renderApp();
    act(() =>
      toast.show({
        key: 'hidden',
        message: '已从汇总中隐藏',
        action: { label: '撤销', onPress: () => undefined },
      }),
    );
    act(() => vi.advanceTimersByTime(1000));
    const undo = screen.getByRole('button', { name: '撤销' });

    // focus 暂停
    fireEvent.focus(undo);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();

    // hover 也进入暂停；blur 解除 focus 后 hover 仍在暂停
    fireEvent.mouseOver(screen.getByTestId('toast'));
    fireEvent.blur(undo);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();

    // 两者都离开后只计剩余 5000ms
    fireEvent.mouseOut(screen.getByTestId('toast'));
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByText('已从汇总中隐藏')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByText('已从汇总中隐藏')).toBeNull();
  });

  it('同时只显示一个 Toast，最多等待两个，按序晋级', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
      toast.show({ key: 'c', message: '丙' });
    });
    expect(screen.getByText('甲')).toBeInTheDocument();
    expect(screen.queryByText('乙')).toBeNull();
    expect(screen.queryByText('丙')).toBeNull();

    // 甲预算耗尽 → 120ms 退出动画播完后乙才晋级（退出期间仍只显示一个）
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText('乙')).toBeNull();
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByText('甲')).toBeNull();
    expect(screen.getByText('乙')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.queryByText('乙')).toBeNull();
    expect(screen.getByText('丙')).toBeInTheDocument();
  });

  it('退出动画期间到来的新 Toast 直接上位并重启完整预算', () => {
    renderApp();
    act(() => toast.show({ key: 'a', message: '甲' }));
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');

    act(() => toast.show({ key: 'b', message: '乙' }));
    const item = screen.getByTestId('toast');
    expect(item).toHaveTextContent('乙');
    expect(item).not.toHaveAttribute('data-exiting');

    // 新条计完整 3500ms 预算，不受旧条退出计时影响
    act(() => vi.advanceTimersByTime(3499));
    expect(screen.getByText('乙')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
  });

  it('退出阶段不再响应 hover / focus 暂停', () => {
    renderApp();
    act(() => toast.show({ key: 'a', message: '甲' }));
    act(() => vi.advanceTimersByTime(3500));
    fireEvent.mouseOver(screen.getByTestId('toast'));
    act(() => vi.advanceTimersByTime(119));
    expect(screen.getByText('甲')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('甲')).toBeNull();
  });

  it('队列满时驱逐最老的未展示普通确认', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
      toast.show({ key: 'c', message: '丙' });
      // 队列已满（乙、丙），丁到来 → 驱逐最老未展示普通确认（乙）
      toast.show({ key: 'd', message: '丁' });
    });
    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.getByText('丙')).toBeInTheDocument();
    expect(screen.queryByText('乙')).toBeNull();
    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.getByText('丁')).toBeInTheDocument();
  });

  it('队列满时绝不驱逐可撤销 Toast；全可撤销时丢弃新来普通确认', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'v', message: '可见' });
      toast.show({
        key: 'x',
        message: '撤销甲',
        action: { label: '撤销', onPress: () => undefined },
      });
      toast.show({ key: 'y', message: '普通乙' });
      // 满队列 [撤销甲, 普通乙] → 驱逐最老未展示普通确认（普通乙），保留可撤销
      toast.show({ key: 'z', message: '普通丙' });
    });
    act(() => vi.advanceTimersByTime(3500 + 120)); // 可见退出 → 撤销甲晋级
    expect(screen.getByText('撤销甲')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000 + 120)); // 撤销甲退出 → 普通丙晋级
    expect(screen.getByText('普通丙')).toBeInTheDocument();
    expect(screen.queryByText('普通乙')).toBeNull();

    act(() => vi.advanceTimersByTime(3500)); // 普通丙进入退出阶段
    // 重建全可撤销队列（退出中的条视为已离场，可见二直接上位）
    act(() => {
      toast.show({ key: 'v2', message: '可见二' });
      toast.show({
        key: 'x2',
        message: '撤销二',
        action: { label: '撤销', onPress: () => undefined },
      });
      toast.show({
        key: 'y2',
        message: '撤销三',
        action: { label: '撤销', onPress: () => undefined },
      });
      // 全可撤销 → 新来普通确认被丢弃
      toast.show({ key: 'z2', message: '被丢弃' });
    });
    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.getByText('撤销二')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000 + 120));
    expect(screen.getByText('撤销三')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000 + 120));
    expect(screen.queryByText('被丢弃')).toBeNull();
  });

  it('同 key 命中等待队列时原位替换内容', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
      toast.show({ key: 'b', message: '乙改' });
    });
    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.getByText('乙改')).toBeInTheDocument();
    expect(screen.queryByText('乙')).toBeNull();
  });

  it('路由子树重渲染下 provider 状态保持', () => {
    const { rerender } = renderApp('/chains/1');
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
    });
    rerender(
      <ToastProvider>
        <Probe route="/feed" />
        <ToastRegion />
      </ToastProvider>,
    );
    expect(screen.getByTestId('route-child')).toHaveTextContent('/feed');
    expect(screen.getByText('甲')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3500 + 120));
    expect(screen.getByText('乙')).toBeInTheDocument();
  });

  it('useToast().clear() 同步清空可见与等待队列', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
    });
    act(() => toast.clear());
    expect(screen.queryByText('甲')).toBeNull();
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.queryByText('乙')).toBeNull();
  });

  it('moment:auth-cleared 与 clear() 走同一实现，同步清空全部', () => {
    renderApp();
    act(() => {
      toast.show({ key: 'a', message: '甲' });
      toast.show({ key: 'b', message: '乙' });
    });
    act(() => {
      window.dispatchEvent(new Event('moment:auth-cleared'));
    });
    expect(screen.queryByText('甲')).toBeNull();
    expect(screen.queryByText('乙')).toBeNull();
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.queryByText('乙')).toBeNull();
  });

  it('action 执行后进入退出动画且不可重复触发，120ms 后卸载', () => {
    renderApp();
    const onPress = vi.fn();
    act(() =>
      toast.show({
        key: 'hidden',
        message: '已从汇总中隐藏',
        action: { label: '撤销', onPress },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    // 关闭走同一退出路径：先播 120ms 动画再卸载
    expect(screen.getByTestId('toast')).toHaveAttribute('data-exiting');
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByText('已从汇总中隐藏')).toBeNull();
  });
});

describe('Skeleton 模板', () => {
  const originalMatchMedia = window.matchMedia;

  function stubReducedMotion(reduced: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const templates = [
    ['TimelineSkeleton', TimelineSkeleton],
    ['FeedSkeleton', FeedSkeleton],
    ['DetailSkeleton', DetailSkeleton],
    ['SettingsSkeleton', SettingsSkeleton],
  ] as const;

  it.each(templates)('%s 整体 aria-hidden', (_name, Template) => {
    const { container } = render(<Template />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(templates)('%s 在 reduced-motion 下保持静态', (_name, Template) => {
    stubReducedMotion(true);
    const { container } = render(<Template />);
    expect(container.firstElementChild?.className ?? '').not.toContain(
      'animate-',
    );
  });

  it.each(templates)('%s 默认带低对比呼吸动画', (_name, Template) => {
    stubReducedMotion(false);
    const { container } = render(<Template />);
    expect(container.firstElementChild?.className ?? '').toContain('animate-');
  });

  it('reduced-motion 不改变 usePending 的 180/280 计时', () => {
    stubReducedMotion(true);
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({ loading }: { loading: boolean }) => usePending(loading),
        { initialProps: { loading: false } },
      );
      rerender({ loading: true });
      act(() => vi.advanceTimersByTime(179));
      expect(result.current).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current).toBe(true);
      rerender({ loading: false });
      act(() => vi.advanceTimersByTime(279));
      expect(result.current).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('usePending', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('false → true 后 180ms 内保持 false，180ms 变 true', () => {
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => usePending(loading),
      { initialProps: { loading: false } },
    );
    expect(result.current).toBe(false);
    rerender({ loading: true });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(179));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('180ms 延迟内完成的请求不显示 pending', () => {
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => usePending(loading),
      { initialProps: { loading: false } },
    );
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(100));
    rerender({ loading: false });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('loading 变 false 后保持 true 直到 280ms 最短可见预算结束', () => {
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => usePending(loading),
      { initialProps: { loading: false } },
    );
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(180));
    expect(result.current).toBe(true);

    // 已展示 100ms 时 loading 结束 → 还需再保持 180ms
    act(() => vi.advanceTimersByTime(100));
    rerender({ loading: false });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(179));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('已展示超过 280ms 后 loading 结束立即隐藏', () => {
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) => usePending(loading),
      { initialProps: { loading: false } },
    );
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(false);
  });
});

describe('InlineProgress', () => {
  it('determinate 暴露 role="progressbar" 与 aria-valuenow', () => {
    render(
      <InlineProgress variant="determinate" label="正在上传照片" value={64} />,
    );
    const bar = screen.getByRole('progressbar', { name: '正在上传照片' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '64');
  });

  it('indeterminate 提供可访问名称，不伪造百分比', () => {
    render(<InlineProgress variant="indeterminate" label="正在加载更多" />);
    expect(screen.getByText('正在加载更多')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
