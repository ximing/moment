/** Toast 队列纯逻辑（对齐 web feedback §5：一显二候、同 key 替换、满员驱逐普通确认）。 */

export const TOAST_NORMAL_MS = 3500;
export const TOAST_ACTIONABLE_MS = 6000;
export const TOAST_EXIT_MS = 120;
export const TOAST_MAX_QUEUED = 2;

export type ToastAction = {
  label: string;
  onPress(): void | Promise<void>;
};

export type ToastItem = {
  key: string;
  message: string;
  action?: ToastAction;
};

export type ToastQueueState = {
  visible: ToastItem | null;
  queue: ToastItem[];
};

export function emptyToastState(): ToastQueueState {
  return { visible: null, queue: [] };
}

export function toastDuration(item: ToastItem): number {
  return item.action ? TOAST_ACTIONABLE_MS : TOAST_NORMAL_MS;
}

export function reduceToastShow(s: ToastQueueState, item: ToastItem): ToastQueueState {
  if (s.visible && s.visible.key === item.key) return { ...s, visible: item };
  const queuedIndex = s.queue.findIndex((t) => t.key === item.key);
  if (queuedIndex !== -1) {
    const queue = [...s.queue];
    queue[queuedIndex] = item;
    return { ...s, queue };
  }
  if (!s.visible) return { ...s, visible: item };
  if (s.queue.length < TOAST_MAX_QUEUED) return { ...s, queue: [...s.queue, item] };
  const evictIndex = s.queue.findIndex((t) => !t.action);
  if (evictIndex === -1) return s;
  return { ...s, queue: [...s.queue.filter((_, i) => i !== evictIndex), item] };
}

export function reduceToastPromote(s: ToastQueueState): ToastQueueState {
  return { visible: s.queue[0] ?? null, queue: s.queue.slice(1) };
}

export function reduceToastClear(): ToastQueueState {
  return emptyToastState();
}
