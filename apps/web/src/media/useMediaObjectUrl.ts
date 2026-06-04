import { useEffect, useState } from 'react';
import { client } from '@/api/client';

/** 登录态：blob + object URL。分享页请用稳定入口 + ?st=，不要走这里。 */
export function useMediaObjectUrl(mediaId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId) return;
    let objectUrl: string | null = null;
    let alive = true;
    void client
      .fetchMediaBlob(mediaId)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [mediaId]);
  return url;
}
