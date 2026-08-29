import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { client } from './api';
import { mediaCacheKey, type MediaVariant } from './media-variant';

/** GET /api/media/:id 需 Bearer；原生 Image/video 不会带鉴权头，且 source.headers 会跟过 302 被 S3 拒。
 *  fused-retrieval §6.5：缓存键 `${mediaId}:${variant}`，禁止 derived 与 original 共用同一本地文件。
 *  original 走 fetchMediaBlob(id) 单参；derived 才传 { variant: 'derived' }（P8 偏差 17 同形）。 */

export function useMediaUri(
  mediaId: string | undefined,
  opts?: { variant?: MediaVariant; fallbackToOriginal?: boolean },
): string | null {
  const requested: MediaVariant = opts?.variant ?? 'original';
  const fallback = Boolean(opts?.fallbackToOriginal && requested === 'derived');
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (mediaId == null || mediaId.length === 0) return;
    const id = mediaId;
    let cacheFile: File | null = null;
    let alive = true;

    async function load(variant: MediaVariant): Promise<void> {
      const blob =
        variant === 'derived'
          ? await client.fetchMediaBlob(id, { variant: 'derived' })
          : await client.fetchMediaBlob(id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!alive) return;
      // 逻辑键 `${mediaId}:${variant}`（spec §6.5）；文件名把冒号换成连字符，避免 iOS 路径问题
      const dest = new File(Paths.cache, `moment-media-${mediaCacheKey(id, variant).replace(':', '-')}-${Date.now()}`);
      dest.write(bytes);
      cacheFile = dest;
      if (!alive) {
        dest.delete();
        return;
      }
      setUri(dest.uri);
    }

    void load(requested).catch(() => {
      if (!alive) return;
      if (fallback) {
        void load('original').catch(() => undefined);
        return;
      }
    });

    return () => {
      alive = false;
      if (cacheFile?.exists) {
        try {
          cacheFile.delete();
        } catch {
          // 缓存可能已被系统清掉
        }
      }
      setUri(null);
    };
  }, [mediaId, requested, fallback]);

  return uri;
}
