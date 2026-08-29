import {
  NON_COMPRESSIBLE_IMAGE_MIMES,
  derivedObjectKey,
  isCompressibleMime,
} from '../../src/media/derived.js';

describe('isCompressibleMime（spec fused-retrieval §2.1 / §0）', () => {
  it('jpeg/png/webp 可压', () => {
    expect(isCompressibleMime('image/jpeg')).toBe(true);
    expect(isCompressibleMime('image/png')).toBe(true);
    expect(isCompressibleMime('image/webp')).toBe(true);
    expect(isCompressibleMime('IMAGE/JPEG')).toBe(true);
  });

  it('GIF/HEIC/HEIF 不可压（不是 skipped）', () => {
    expect([...NON_COMPRESSIBLE_IMAGE_MIMES].sort()).toEqual(['image/gif', 'image/heic', 'image/heif']);
    expect(isCompressibleMime('image/gif')).toBe(false);
    expect(isCompressibleMime('image/heic')).toBe(false);
    expect(isCompressibleMime('image/heif')).toBe(false);
    expect(isCompressibleMime('image/GIF')).toBe(false);
  });

  it('音频/视频/非图不可压', () => {
    expect(isCompressibleMime('video/mp4')).toBe(false);
    expect(isCompressibleMime('audio/wav')).toBe(false);
    expect(isCompressibleMime('application/octet-stream')).toBe(false);
    expect(isCompressibleMime('')).toBe(false);
  });
});

describe('derivedObjectKey（spec §2.1）', () => {
  it('相对 key：chains/{chainId}/{momentId}/{mediaId}.derived.webp', () => {
    expect(derivedObjectKey('c1', 'm1', 'md1')).toBe('chains/c1/m1/md1.derived.webp');
  });
});
