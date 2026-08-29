import { describe, expect, it } from 'vitest';
import { cardDisplayUrl, originalDisplayUrl, posterDisplayUrl, withShareToken } from './media-src';

describe('withShareToken', () => {
  it('https 预签名不拼 ?st=', () => {
    const signed = 'https://s3.example/obj?X-Amz-Signature=abc';
    expect(withShareToken(signed, 'tok en')).toBe(signed);
  });

  it('相对路径拼 ?st=，已有 query 用 &st=', () => {
    expect(withShareToken('/api/media/m-1', 'tok en')).toBe('/api/media/m-1?st=tok%20en');
    expect(withShareToken('/api/media/m-1?variant=derived', 'tok en')).toBe(
      '/api/media/m-1?variant=derived&st=tok%20en',
    );
  });
});

describe('display helpers', () => {
  it('卡片优先 derivedUrl，灯箱用原图 url，封面优先 posterDerivedUrl', () => {
    expect(
      cardDisplayUrl({ url: 'https://signed/orig', derivedUrl: 'https://signed/derived' }),
    ).toBe('https://signed/derived');
    expect(originalDisplayUrl({ url: 'https://signed/orig' })).toBe('https://signed/orig');
    expect(
      posterDisplayUrl({
        posterUrl: 'https://signed/poster',
        posterDerivedUrl: 'https://signed/poster-derived',
      }),
    ).toBe('https://signed/poster-derived');
  });
});
