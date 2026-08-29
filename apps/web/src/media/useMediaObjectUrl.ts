import { useEffect, useState } from 'react';
import { client } from '@/api/client';

// 模块级 object URL 去重缓存（chain-appearance §7.5 + fused-retrieval §6.5）：
// - 缓存键 `${mediaId}:${variant}`（variant 缺省 original），禁止 derived 与 original 共用；
// - 同一键的所有消费者共享一次 fetchMediaBlob 与一个 object URL；
// - 引用计数：最后一个消费者卸载才 revoke URL 并移除 entry；
// - original 失败：移出 entry，后续挂载可重试；
// - derived + fallbackToOriginal：失败后改打 original；
// - 分享页请用 client.mediaUrl(..., { st })，不要走这里的认证 blob 通道。

type MediaVariant = 'original' | 'derived';

interface MediaUrlEntry {
  promise: Promise<Blob>;
  url: string | null;
  refs: number;
  listeners: Set<(url: string | null, failed?: boolean) => void>;
}

const entries = new Map<string, MediaUrlEntry>();

function cacheKey(mediaId: string, variant: MediaVariant): string {
  return `${mediaId}:${variant}`;
}

function acquire(mediaId: string, variant: MediaVariant): MediaUrlEntry {
  const key = cacheKey(mediaId, variant);
  let entry = entries.get(key);
  if (entry) return entry;

  const promise =
    variant === 'derived'
      ? client.fetchMediaBlob(mediaId, { variant: 'derived' })
      : client.fetchMediaBlob(mediaId);
  entry = { promise, url: null, refs: 0, listeners: new Set() };
  entries.set(key, entry);

  promise
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      if (entries.get(key) !== entry || entry.refs <= 0) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      entry.url = objectUrl;
      for (const listener of entry.listeners) listener(objectUrl);
    })
    .catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
      for (const listener of entry.listeners) listener(null, true);
    });

  return entry;
}

function release(mediaId: string, variant: MediaVariant, entry: MediaUrlEntry): void {
  const key = cacheKey(mediaId, variant);
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.refs = 0;
  if (entries.get(key) === entry) entries.delete(key);
  if (entry.url !== null) {
    URL.revokeObjectURL(entry.url);
    entry.url = null;
  }
}

export function useMediaObjectUrl(
  mediaId: string | null,
  opts?: { variant?: MediaVariant; fallbackToOriginal?: boolean },
): string | null {
  const requested: MediaVariant = opts?.variant ?? 'original';
  const fallback = Boolean(opts?.fallbackToOriginal && requested === 'derived');
  const requestKey = `${mediaId ?? ''}:${requested}`;

  const [effective, setEffective] = useState<MediaVariant>(requested);
  const [prevKey, setPrevKey] = useState(requestKey);
  const [url, setUrl] = useState<string | null>(() =>
    mediaId ? (entries.get(cacheKey(mediaId, requested))?.url ?? null) : null,
  );

  if (prevKey !== requestKey) {
    setPrevKey(requestKey);
    setEffective(requested);
    setUrl(mediaId ? (entries.get(cacheKey(mediaId, requested))?.url ?? null) : null);
  }

  useEffect(() => {
    if (!mediaId) return;
    const variant = effective;
    const entry = acquire(mediaId, variant);
    entry.refs += 1;
    const listener = (next: string | null, failed?: boolean) => {
      if (failed && fallback && variant === 'derived') {
        setEffective('original');
        return;
      }
      setUrl(next);
    };
    entry.listeners.add(listener);
    const ready = entry.url;
    if (ready !== null) {
      queueMicrotask(() => {
        if (entry.listeners.has(listener)) listener(ready);
      });
    }
    return () => {
      entry.listeners.delete(listener);
      release(mediaId, variant, entry);
    };
  }, [mediaId, effective, fallback]);

  return url;
}
