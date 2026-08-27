import { useEffect, useState } from 'react';
import { client } from '@/api/client';

// 模块级 object URL 去重缓存（chain-appearance §7.5）：
// - 同一 mediaId 的所有消费者共享一次 fetchMediaBlob 与一个 object URL（汇总时间线
//   50 条同链时刻只下载一次链头像）；
// - 引用计数：最后一个消费者卸载才 revoke URL 并移除 entry；
// - fetch 失败通知 null 并移除 entry，后续渲染自然重试；
// - 分享页请用稳定入口 + ?st=，不要走这里的认证 blob 通道。

interface MediaUrlEntry {
  promise: Promise<Blob>;
  url: string | null;
  refs: number;
  listeners: Set<(url: string | null) => void>;
}

const entries = new Map<string, MediaUrlEntry>();

function acquire(mediaId: string): MediaUrlEntry {
  let entry = entries.get(mediaId);
  if (entry) return entry;

  const promise = client.fetchMediaBlob(mediaId);
  entry = { promise, url: null, refs: 0, listeners: new Set() };
  entries.set(mediaId, entry);

  promise
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      // 落地时已无人消费（全部卸载、entry 被回收）：创建即 revoke，不泄漏 object URL
      if (entries.get(mediaId) !== entry || entry.refs <= 0) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      entry.url = objectUrl;
      for (const listener of entry.listeners) listener(objectUrl);
    })
    .catch(() => {
      // 失败：移出缓存让后续渲染重试；仍在听的消费者收到 null（组件自行兜底）
      if (entries.get(mediaId) === entry) entries.delete(mediaId);
      for (const listener of entry.listeners) listener(null);
    });

  return entry;
}

function release(mediaId: string, entry: MediaUrlEntry): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.refs = 0;
  if (entries.get(mediaId) === entry) entries.delete(mediaId);
  if (entry.url !== null) {
    URL.revokeObjectURL(entry.url);
    entry.url = null;
  }
}

/** 登录态：blob + object URL（同 id 共享一次 fetch）。分享页请用稳定入口 + ?st=，不要走这里。 */
export function useMediaObjectUrl(mediaId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (mediaId ? (entries.get(mediaId)?.url ?? null) : null));
  // mediaId 变更时渲染期重置（derived-state 模式），避免旧 URL 残留到下一个 effect
  const [prevId, setPrevId] = useState(mediaId);
  if (prevId !== mediaId) {
    setPrevId(mediaId);
    setUrl(mediaId ? (entries.get(mediaId)?.url ?? null) : null);
  }

  useEffect(() => {
    if (!mediaId) return;
    const entry = acquire(mediaId);
    entry.refs += 1;
    const listener = (next: string | null) => setUrl(next);
    entry.listeners.add(listener);
    // 竞态兜底：共享 entry 在渲染与 effect 之间恰好就绪时补发一次（promise 微任务可抢在
    // passive effect 前落地）；卸载后 listeners 已摘，has 守卫防写幽灵组件
    const ready = entry.url;
    if (ready !== null) {
      queueMicrotask(() => {
        if (entry.listeners.has(listener)) listener(ready);
      });
    }
    return () => {
      entry.listeners.delete(listener);
      release(mediaId, entry);
    };
  }, [mediaId]);

  return url;
}
