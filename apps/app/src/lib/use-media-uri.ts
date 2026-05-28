import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { client } from './api';

/** GET /api/media/:id 需 Bearer；原生 Image/video 不会带鉴权头，且 source.headers 会跟过 302 被 S3 拒。 */
export function useMediaUri(mediaId: string | undefined): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (mediaId == null || mediaId.length === 0) return;
    let cacheFile: File | null = null;
    let alive = true;

    void client
      .fetchMediaBlob(mediaId)
      .then(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        // 每次挂载独立文件，避免同 mediaId 并发格子互相删掉对方的缓存
        const dest = new File(Paths.cache, `moment-media-${mediaId}-${Date.now()}`);
        dest.write(bytes);
        cacheFile = dest;
        if (!alive) {
          dest.delete();
          return;
        }
        setUri(dest.uri);
      })
      .catch(() => undefined);

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
  }, [mediaId]);

  return uri;
}
