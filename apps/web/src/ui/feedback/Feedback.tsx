import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
// 注意：必须显式指向 barrel 文件。src/ui/ 下同时存在遗留的 Button.tsx 等
// 同名文件，大小写不敏感文件系统上裸目录导入可能解析到遗留文件。
import { Button } from '../button/index';

// Feedback 家族（规范：docs/superpowers/specs/2026-08-18-web-feedback-design.md）
// 视觉只消费 styles/tokens.css 经 Tailwind 语义映射发布的 feedback token：
// 色面 bg-feedback-error-bg / bg-feedback-warning-bg / bg-feedback-info-bg /
// bg-feedback-skeleton / bg-feedback-toast-bg，几何 rounded-banner / px-banner-x /
// py-banner-y / gap-banner / rounded-toast / px-toast / min-h-toast / max-w-toast /
// gap-toast / max-w-empty / py-empty-page(-mobile) / py-empty-section / gap-empty-action /
// min-h-inline-progress / h-inline-progress-track / rounded-inline-progress /
// h|w-inline-progress-spinner，阴影只有 shadow-toast（规范 §3.1：内容反馈无阴影），
// 层级 z-toast（65，Overlay 之上、嵌套 AlertDialog 之下）。
// 计时集中在 ToastProvider（3500/6000ms 可见预算 + 120ms 退出动画）与
// usePending（180/280ms），页面不复制定时器。
// 动效（规范 §5.6）：进入 animate-[moment-toast-in_160ms_ease-out]（Opacity +
// 4px 位移，reduced-motion 下 keyframes 仅透明度）、退出
// animate-[moment-toast-out_120ms_ease-in]（仅透明度），keyframes 在 tokens.css。

/* ---------------------------------------------------------------------------
 * 私有动效样式：Skeleton 低对比呼吸（--skeleton-cycle），由 JS matchMedia
 * 门控，keyframes 以内联 <style> 随组件自携。Toast 进入/退出 keyframes
 * （moment-toast-in / moment-toast-out）在 tokens.css 全局发布（规范 §5.6）。
 * ------------------------------------------------------------------------- */
function FeedbackMotionStyles() {
  return (
    <style>{`
@keyframes moment-skeleton-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
`}</style>
  );
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 只读 prefers-reduced-motion（规范 §7.3：Skeleton 静态化；不影响任何 JS 计时）。 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ---------------------------------------------------------------------------
 * Banner：内容流中的持续反馈（规范 §4）。柔色语义面，无边框、无阴影；
 * error 用 role="alert"，其余 role="status"；action 至多一个，pending 防重复。
 * ------------------------------------------------------------------------- */

export type BannerProps = {
  tone: 'error' | 'warning' | 'info';
  /** 至多一个轻操作；组件负责 Quiet Button 外观与 pending 防重复提交 */
  action?: { label: string; onPress(): void | Promise<void> };
  /** 只接受可读消息文案 */
  children: string;
};

const BANNER_TONE_CLASSES: Record<BannerProps['tone'], string> = {
  error: 'bg-feedback-error-bg text-danger',
  warning: 'bg-feedback-warning-bg text-ink',
  info: 'bg-feedback-info-bg text-ink',
};

export function Banner({ tone, action, children }: BannerProps) {
  const [pending, setPending] = useState(false);

  const runAction = async () => {
    if (!action || pending) return;
    setPending(true);
    try {
      await action.onPress();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-banner rounded-banner px-banner-x py-banner-y text-sm ${BANNER_TONE_CLASSES[tone]}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action ? (
        <Button
          variant="quiet"
          loading={pending}
          onClick={() => void runAction()}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * EmptyState（规范 §6）：timeline / plain 两种布局 × page / section 留白。
 * 结构化 props，至多一个 action；空状态不是错误，不用 role="alert"。
 * ------------------------------------------------------------------------- */

export type EmptyStateProps = {
  variant: 'timeline' | 'plain';
  scope: 'page' | 'section';
  title: string;
  description: string;
  /** 至多一个；emphasis 决定 Primary / Quiet Button */
  action?: {
    label: string;
    onPress(): void;
    emphasis: 'primary' | 'quiet';
  };
};

export function EmptyState({
  variant,
  scope,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center text-center ${
        scope === 'page'
          ? 'py-empty-page-mobile md:py-empty-page'
          : 'py-empty-section'
      }`}
    >
      {variant === 'timeline' ? (
        // 日子线签名：8px 珊瑚节点 + 短日子线，内容从线上生长（规范 §6.3）
        <span aria-hidden className="mb-4 flex flex-col items-center">
          <span className="h-2 w-2 rounded-full bg-action" />
          <span className="h-6 w-px bg-stroke" />
        </span>
      ) : null}
      <div className="flex max-w-empty flex-col items-center">
        <p className="text-[length:var(--empty-title-size)] leading-[var(--empty-title-lh)] font-semibold text-ink">
          {title}
        </p>
        <p className="mt-2 text-[length:var(--empty-body-size)] leading-[var(--empty-body-lh)] text-muted">
          {description}
        </p>
        {action ? (
          // 文案到操作 16px（--empty-action-gap，落在 4/8/12/16 网格）
          <span className="mt-4">
            <Button
              variant={action.emphasis === 'primary' ? 'primary' : 'quiet'}
              onClick={action.onPress}
            >
              {action.label}
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Toast（规范 §5）：真实浮层，全家族唯一带阴影的反馈。
 * 计时与队列集中在 ToastProvider：
 * - 普通 3500ms / 可撤销 6000ms 精确可见预算，同 key 替换重置预算；
 * - hover / focus 各自独立暂停，恢复时只计剩余毫秒；
 * - 一显二候；队列满时驱逐最老的未展示普通确认，绝不驱逐可撤销 Toast；
 * - 路由切换保持 provider 状态；moment:auth-cleared 与 clear() 同一实现。
 * ------------------------------------------------------------------------- */

const TOAST_NORMAL_MS = 3500;
const TOAST_ACTIONABLE_MS = 6000;
const TOAST_MAX_QUEUED = 2;
// 规范 §5.6：退出 = Opacity 120ms ease-in。可见预算（3500/6000ms）结束后先播
// 退出动画，再延迟卸载并晋级下一条；clear()（auth-cleared）不在此列，同步清空。
const TOAST_EXIT_MS = 120;
// 与 apps/web/src/api/client.ts tokenStore.clear() 派发的事件同名（规范 §5.4：退出登录清空队列）
const AUTH_CLEARED_EVENT = 'moment:auth-cleared';

export type ToastAction = {
  label: string;
  onPress(): void | Promise<void>;
};

export type ToastInput = {
  key: string;
  message: string;
  action?: ToastAction;
};

export type ToastController = {
  show(input: ToastInput): void;
  clear(): void;
};

type ToastItem = ToastInput;

type ToastState = {
  visible: ToastItem | null;
  queue: ToastItem[];
  /** 退出动画播放中：Toast 仍在 DOM，预算已耗尽，只等 120ms 动画收尾 */
  leaving: boolean;
};

/** 剩余时间时钟：paused 时 remaining 已折入流逝毫秒，恢复后只计剩余。 */
type ToastClock = {
  timer: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  hovering: boolean;
  focused: boolean;
  /** 退出阶段不再响应 hover/focus 暂停 */
  exiting: boolean;
};

type ToastInternal = {
  visible: ToastItem | null;
  leaving: boolean;
  setPaused(kind: 'hover' | 'focus', paused: boolean): void;
  dismiss(): void;
};

const ToastControllerContext = createContext<ToastController | null>(null);
const ToastInternalContext = createContext<ToastInternal | null>(null);

// eslint-disable-next-line react-refresh/only-export-components -- 规范固定 API：hook 与同族基元同一文件、经 barrel 统一导出，fast refresh 边界在 index.ts
export function useToast(): ToastController {
  const controller = useContext(ToastControllerContext);
  if (!controller) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return controller;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState>({
    visible: null,
    queue: [],
    leaving: false,
  });
  const clockRef = useRef<ToastClock>({
    timer: null,
    remaining: 0,
    startedAt: 0,
    hovering: false,
    focused: false,
    exiting: false,
  });
  const visibleRef = useRef<ToastItem | null>(null);

  const stopTimer = useCallback(() => {
    const clock = clockRef.current;
    if (clock.timer !== null) {
      clearTimeout(clock.timer);
      clock.timer = null;
    }
  }, []);

  // 退出动画播完：卸载当前条并晋级下一条等待项（没有则清空可见槽）
  const removeAndPromote = useCallback(() => {
    stopTimer();
    setState((s) => ({
      visible: s.queue[0] ?? null,
      queue: s.queue.slice(1),
      leaving: false,
    }));
  }, [stopTimer]);

  // 可见预算到期或被动作关闭：先播 120ms 退出动画（规范 §5.6），再卸载晋级
  const beginExit = useCallback(() => {
    stopTimer();
    const clock = clockRef.current;
    clock.exiting = true;
    clock.hovering = false;
    clock.focused = false;
    setState((s) => (s.visible ? { ...s, leaving: true } : s));
    clock.timer = setTimeout(removeAndPromote, TOAST_EXIT_MS);
  }, [removeAndPromote, stopTimer]);

  const { visible } = state;
  useEffect(() => {
    visibleRef.current = visible;
    const clock = clockRef.current;
    clock.exiting = false;
    if (!visible) return;
    stopTimer();
    clock.remaining = visible.action ? TOAST_ACTIONABLE_MS : TOAST_NORMAL_MS;
    clock.startedAt = Date.now();
    if (!clock.hovering && !clock.focused) {
      clock.timer = setTimeout(beginExit, clock.remaining);
    }
    return stopTimer;
  }, [visible, beginExit, stopTimer]);

  const setPaused = useCallback(
    (kind: 'hover' | 'focus', paused: boolean) => {
      const clock = clockRef.current;
      if (clock.exiting) return;
      const wasPaused = clock.hovering || clock.focused;
      if (kind === 'hover') clock.hovering = paused;
      else clock.focused = paused;
      const nowPaused = clock.hovering || clock.focused;
      if (!visibleRef.current || wasPaused === nowPaused) return;
      if (nowPaused) {
        // 暂停：把已流逝的时间折入 remaining
        stopTimer();
        clock.remaining = Math.max(
          0,
          clock.remaining - (Date.now() - clock.startedAt),
        );
      } else {
        // 恢复：只计剩余毫秒
        clock.startedAt = Date.now();
        clock.timer = setTimeout(beginExit, clock.remaining);
      }
    },
    [beginExit, stopTimer],
  );

  const show = useCallback((input: ToastInput) => {
    const item: ToastItem = {
      key: input.key,
      message: input.message,
      action: input.action,
    };
    setState((s) => {
      // 正在退出的条视为已离场（120ms 动画不阻塞新反馈）：同 key 命中等待
      // 队列仍原位替换；否则新条直接上位，重启完整预算（退出计时由 visible
      // 身份变化时的时钟 effect 清理）。
      if (s.leaving) {
        const queuedIndex = s.queue.findIndex((t) => t.key === item.key);
        if (queuedIndex !== -1) {
          const queue = [...s.queue];
          queue[queuedIndex] = item;
          return { ...s, queue };
        }
        return { visible: item, queue: s.queue, leaving: false };
      }
      // 相同 key 命中可见条：替换内容（条目身份变化 → 时钟 effect 重启精确预算）
      if (s.visible && s.visible.key === item.key) {
        return { ...s, visible: item };
      }
      // 相同 key 命中等待队列：原位替换，不连续堆叠
      const queuedIndex = s.queue.findIndex((t) => t.key === item.key);
      if (queuedIndex !== -1) {
        const queue = [...s.queue];
        queue[queuedIndex] = item;
        return { ...s, queue };
      }
      if (!s.visible) return { ...s, visible: item };
      if (s.queue.length < TOAST_MAX_QUEUED) {
        return { ...s, queue: [...s.queue, item] };
      }
      // 队列满：驱逐最老的未展示普通确认，绝不驱逐可撤销 Toast
      const evictIndex = s.queue.findIndex((t) => !t.action);
      if (evictIndex === -1) return s;
      return { ...s, queue: [...s.queue.filter((_, i) => i !== evictIndex), item] };
    });
  }, []);

  // clear() 与 moment:auth-cleared 共用的同一实现：同步清可见 + 队列，
  // 不播退出动画（应用级拆除，规范 §5.4）
  const clear = useCallback(() => {
    const clock = clockRef.current;
    stopTimer();
    clock.hovering = false;
    clock.focused = false;
    clock.exiting = false;
    setState({ visible: null, queue: [], leaving: false });
  }, [stopTimer]);

  useEffect(() => {
    window.addEventListener(AUTH_CLEARED_EVENT, clear);
    return () => window.removeEventListener(AUTH_CLEARED_EVENT, clear);
  }, [clear]);

  return (
    <ToastControllerContext.Provider value={{ show, clear }}>
      <ToastInternalContext.Provider
        value={{ visible, leaving: state.leaving, setPaused, dismiss: beginExit }}
      >
        {children}
      </ToastInternalContext.Provider>
    </ToastControllerContext.Provider>
  );
}

function ToastView({ item, leaving }: { item: ToastItem; leaving: boolean }) {
  const internal = useContext(ToastInternalContext);
  const [pending, setPending] = useState(false);
  if (!internal) return null;

  // 动作执行期间防重复；无论成败都关闭 Toast（失败由原任务区域 Banner 表达，规范 §5.5）。
  // 同步 onPress 立即进入退出；Promise 在 pending 期间由 Button loading 吞掉重复点击。
  const runAction = () => {
    if (!item.action || pending) return;
    try {
      const result = item.action.onPress();
      if (result instanceof Promise) {
        setPending(true);
        void result.finally(() => internal.dismiss());
      } else {
        internal.dismiss();
      }
    } catch {
      internal.dismiss();
    }
  };

  return (
    <div
      data-toast-item
      data-testid="toast"
      data-exiting={leaving || undefined}
      onMouseEnter={() => internal.setPaused('hover', true)}
      onMouseLeave={() => internal.setPaused('hover', false)}
      onFocus={() => internal.setPaused('focus', true)}
      onBlur={() => internal.setPaused('focus', false)}
      className={`pointer-events-auto flex min-h-toast w-full max-w-toast items-center gap-toast rounded-toast bg-feedback-toast-bg px-toast py-2 text-sm text-ink shadow-toast ${
        leaving
          ? // 规范 §5.6：退出 Opacity 120ms ease-in（仅透明度，天然满足 reduced-motion）
            'animate-[moment-toast-out_120ms_ease-in]'
          : 'animate-[moment-toast-in_160ms_ease-out]'
      }`}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action ? (
        <Button
          variant="quiet"
          loading={pending}
          onClick={runAction}
          className="shrink-0"
        >
          {item.action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Shell 级唯一 Toast 出口（规范 §5.3）：桌面内容区底部居中（距视口 24px），
 * 移动 Safe Area 下方顶部居中；polite live region，不抢焦点。
 * 本目录只导出基元；挂载到 App 由 Task 8 完成。
 */
export function ToastRegion() {
  const internal = useContext(ToastInternalContext);
  if (!internal) {
    throw new Error('ToastRegion 必须挂在 ToastProvider 内');
  }
  return (
    <div
      data-toast-region
      role="region"
      aria-label="通知"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 top-[max(var(--space-3),env(safe-area-inset-top))] z-toast flex justify-center md:inset-x-0 md:top-auto md:bottom-6"
    >
      {internal.visible ? (
        <ToastView
          key={internal.visible.key}
          item={internal.visible}
          leaving={internal.leaving}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Skeleton（规范 §7）：四个结构化模板，整体 aria-hidden，色块只消费
 * --feedback-skeleton；低对比呼吸动画在 reduced-motion 下静态化。
 * 180ms 延迟与 280ms 最短可见由 usePending 统一管理，模板本身不含计时。
 * ------------------------------------------------------------------------- */

function skeletonClass(reduced: boolean, layout: string): string {
  return reduced
    ? layout
    : `${layout} animate-[moment-skeleton-breathe_var(--skeleton-cycle)_ease-in-out_infinite]`;
}

/** 私有 Skeleton 色块：只供四个模板内部组合，不从公共入口导出（规范 §7.1）。 */
function Block({ className }: { className: string }) {
  return <div className={`rounded-surface-md bg-feedback-skeleton ${className}`} />;
}

/** 链详情、个人时间线的首次加载结构：节点 + 纵向日子线 + 内容区域。 */
export function TimelineSkeleton() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className={skeletonClass(reduced, 'flex flex-col gap-6')}
    >
      <FeedbackMotionStyles />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <span className="mt-2 flex shrink-0 flex-col items-center">
            <span className="h-2 w-2 rounded-full bg-feedback-skeleton" />
            <span className="mt-2 w-px flex-1 bg-feedback-skeleton" />
          </span>
          <div className="flex flex-1 flex-col gap-2">
            <Block className="h-4 w-24" />
            <Block className="h-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 汇总流和普通内容列表的首次加载结构。 */
export function FeedSkeleton() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className={skeletonClass(reduced, 'flex flex-col gap-4')}
    >
      <FeedbackMotionStyles />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Block className="h-4 w-32" />
          <Block className="h-16" />
        </div>
      ))}
    </div>
  );
}

/** 详情与 Sheet 的首次加载结构：标题 + 已知比例媒体 + 内容行。 */
export function DetailSkeleton() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className={skeletonClass(reduced, 'flex flex-col gap-4')}
    >
      <FeedbackMotionStyles />
      <Block className="h-6 w-40" />
      <Block className="aspect-[4/3]" />
      <Block className="h-4 w-full" />
      <Block className="h-4 w-2/3" />
    </div>
  );
}

/** 设置页分组结构的首次加载。 */
export function SettingsSkeleton() {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className={skeletonClass(reduced, 'flex flex-col gap-8')}
    >
      <FeedbackMotionStyles />
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <Block className="h-4 w-24" />
          <Block className="h-11" />
          <Block className="h-11" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * InlineProgress（规范 §8）：已有内容后的继续加载。
 * indeterminate = 16px spinner + 文案；determinate = 细轨道 + progressbar 语义。
 * ------------------------------------------------------------------------- */

export type InlineProgressProps = { label: string } & (
  | { variant: 'indeterminate'; value?: never }
  | { variant: 'determinate'; value?: number }
);

export function InlineProgress(props: InlineProgressProps) {
  if (props.variant === 'determinate') {
    const value = Math.min(100, Math.max(0, props.value ?? 0));
    return (
      <div className="flex min-h-inline-progress items-center gap-3">
        <div
          role="progressbar"
          aria-label={props.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          className="h-inline-progress-track flex-1 overflow-hidden rounded-inline-progress bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
        >
          <div
            className="h-full rounded-inline-progress bg-action"
            style={{ width: `${value}%` }}
          />
        </div>
        <span className="shrink-0 text-meta text-muted">{props.label}</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-inline-progress items-center gap-3">
      <span
        aria-hidden
        className="h-inline-progress-spinner w-inline-progress-spinner animate-spin rounded-full border-2 border-current border-t-transparent text-muted"
      />
      <span className="text-meta text-muted">{props.label}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * usePending（规范 §7.3）：布局稳定计时的唯一实现。
 * loading false → true：180ms（--skeleton-delay）内保持 false；
 * loading → false：已出现后至少维持 280ms（--skeleton-min-visible）。
 * 纯 JS 计时，reduced-motion 不改变这两个预算（只停 Skeleton 动画）。
 * ------------------------------------------------------------------------- */

const PENDING_DELAY_MS = 180;
const PENDING_MIN_VISIBLE_MS = 280;

// eslint-disable-next-line react-refresh/only-export-components -- 规范固定 API：布局稳定计时 hook 与 Skeleton 模板同一文件、经 barrel 统一导出
export function usePending(loading: boolean): boolean {
  const [pending, setPending] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      // 重新进入 loading：取消最短可见收尾，已显示则直接保持
      if (minTimerRef.current !== null) {
        clearTimeout(minTimerRef.current);
        minTimerRef.current = null;
      }
      if (shownAtRef.current !== null) {
        setPending(true);
        return;
      }
      if (delayTimerRef.current === null) {
        delayTimerRef.current = setTimeout(() => {
          delayTimerRef.current = null;
          shownAtRef.current = Date.now();
          setPending(true);
        }, PENDING_DELAY_MS);
      }
      return;
    }
    // loading 结束：延迟内的快速请求直接不显示
    if (delayTimerRef.current !== null) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    if (shownAtRef.current === null) {
      setPending(false);
      return;
    }
    // 已出现：补足 280ms 最短可见预算后再隐藏
    const remaining =
      PENDING_MIN_VISIBLE_MS - (Date.now() - shownAtRef.current);
    if (remaining <= 0) {
      shownAtRef.current = null;
      setPending(false);
      return;
    }
    minTimerRef.current = setTimeout(() => {
      minTimerRef.current = null;
      shownAtRef.current = null;
      setPending(false);
    }, remaining);
  }, [loading]);

  useEffect(
    () => () => {
      if (delayTimerRef.current !== null) clearTimeout(delayTimerRef.current);
      if (minTimerRef.current !== null) clearTimeout(minTimerRef.current);
    },
    [],
  );

  return pending;
}
