import type { MomentMedia } from '@moment/dto';

/** 接口已签发的预签名 GET（https）。相对 `/api/media` 走旧通道。 */
export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/** https 已带 SigV4，禁止再拼 `?st=`（会破坏签名）。相对路径才附加 share token。 */
export function withShareToken(url: string, shareToken?: string): string {
  if (!shareToken || isHttpUrl(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(shareToken)}`;
}

export function cardDisplayUrl(
  media: Pick<MomentMedia, 'url' | 'derivedUrl'>,
  shareToken?: string,
): string | null {
  const url = media.derivedUrl || media.url || null;
  return url ? withShareToken(url, shareToken) : null;
}

export function originalDisplayUrl(media: Pick<MomentMedia, 'url'>, shareToken?: string): string | null {
  return media.url ? withShareToken(media.url, shareToken) : null;
}

export function posterDisplayUrl(
  media: Pick<MomentMedia, 'posterUrl' | 'posterDerivedUrl'>,
  shareToken?: string,
): string | null {
  const url = media.posterDerivedUrl || media.posterUrl || null;
  return url ? withShareToken(url, shareToken) : null;
}
