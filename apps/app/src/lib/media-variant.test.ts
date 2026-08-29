import { describe, expect, it } from 'vitest';
import { cardImageVariant, mediaCacheKey, posterCardVariant } from './media-variant';

describe('mediaCacheKey（spec fused-retrieval §6.5）', () => {
  it('键是 mediaId:variant，缺省策略由调用方传入 original', () => {
    expect(mediaCacheKey('m-1', 'original')).toBe('m-1:original');
    expect(mediaCacheKey('m-1', 'derived')).toBe('m-1:derived');
    expect(mediaCacheKey('m-1', 'original')).not.toBe(mediaCacheKey('m-1', 'derived'));
  });
});

describe('cardImageVariant / posterCardVariant（spec §7.3）', () => {
  it('有 derivedUrl / posterDerivedUrl → derived，否则 original；空串当无', () => {
    expect(cardImageVariant('/api/media/m-1?variant=derived')).toBe('derived');
    expect(cardImageVariant(null)).toBe('original');
    expect(cardImageVariant(undefined)).toBe('original');
    expect(cardImageVariant('')).toBe('original');
    expect(posterCardVariant('/api/media/p-1?variant=derived')).toBe('derived');
    expect(posterCardVariant(null)).toBe('original');
  });
});
