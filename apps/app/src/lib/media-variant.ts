/** 媒体变体（spec fused-retrieval §6.5）：卡片 derived / 详情 original，禁止混用同一缓存键。 */
export type MediaVariant = 'original' | 'derived';

export function mediaCacheKey(mediaId: string, variant: MediaVariant): string {
  return `${mediaId}:${variant}`;
}

export function cardImageVariant(derivedUrl: string | null | undefined): MediaVariant {
  return derivedUrl ? 'derived' : 'original';
}

export function posterCardVariant(posterDerivedUrl: string | null | undefined): MediaVariant {
  return posterDerivedUrl ? 'derived' : 'original';
}
