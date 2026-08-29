import type { MomentMedia } from '@moment/dto';

export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function cardDisplayUrl(media: Pick<MomentMedia, 'url' | 'derivedUrl'>): string | null {
  return media.derivedUrl || media.url || null;
}

export function originalDisplayUrl(media: Pick<MomentMedia, 'url'>): string | null {
  return media.url || null;
}

export function posterDisplayUrl(
  media: Pick<MomentMedia, 'posterUrl' | 'posterDerivedUrl'>,
): string | null {
  return media.posterDerivedUrl || media.posterUrl || null;
}
