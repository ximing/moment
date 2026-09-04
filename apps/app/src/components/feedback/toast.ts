import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import type { ToastItem } from './toast-queue';

function messageOf(err: unknown): string {
  if (err instanceof Error && !(err instanceof ApiError)) return err.message;
  return humanError(err);
}

export type ToastInput = ToastItem;

type ToastHostHandle = {
  show(item: ToastItem): void;
  clear(): void;
};

let host: ToastHostHandle | null = null;

export function bindToastHost(h: ToastHostHandle): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

export const toast = {
  show(input: ToastInput | string): void {
    const item: ToastItem = typeof input === 'string' ? { key: 'toast', message: input } : input;
    host?.show(item);
  },
  error(err: unknown, action?: string): void {
    const raw = messageOf(err);
    const message = action ? `${action}：${raw}` : raw;
    host?.show({ key: 'error', message });
  },
  clear(): void {
    host?.clear();
  },
};
