import sharp from 'sharp';
import {
  DERIVED_MAX_EDGE,
  DERIVED_MIME,
  DERIVED_WEBP_QUALITY,
  EMBED_MAX_EDGE,
  EMBED_WEBP_QUALITY,
  NonRetryableCompressError,
  compressToDerivedWebp,
  compressToEmbedWebp,
} from '../../src/media/compress.js';

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('NonRetryableCompressError', () => {
  it('name 钉死字符串（P1 processor 只认 error.name）', () => {
    const err = new NonRetryableCompressError('SHARP_DECODE_FAILED');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NonRetryableCompressError');
    expect(err.message).toBe('SHARP_DECODE_FAILED');
  });
});

describe('compressToDerivedWebp（展示：最长边 1280、WebP 85、不放大）', () => {
  it('常量锁定', () => {
    expect(DERIVED_MAX_EDGE).toBe(1280);
    expect(DERIVED_WEBP_QUALITY).toBe(85);
    expect(EMBED_MAX_EDGE).toBe(1024);
    expect(EMBED_WEBP_QUALITY).toBe(80);
    expect(DERIVED_MIME).toBe('image/webp');
  });

  it('2000×1000 JPEG → 展示 webp 最长边 1280（1280×640）', async () => {
    const out = await compressToDerivedWebp(await jpegOf(2000, 1000));
    expect(out.width).toBe(1280);
    expect(out.height).toBe(640);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(640);
  });

  it('2000×1000 JPEG → embedding webp 最长边 1024（1024×512），不入库由调用方保证', async () => {
    const out = await compressToEmbedWebp(await jpegOf(2000, 1000));
    expect(out.width).toBe(1024);
    expect(out.height).toBe(512);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('withoutEnlargement：64×48 不放大', async () => {
    const out = await compressToDerivedWebp(await jpegOf(64, 48));
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
  });

  it('损坏字节 → NonRetryableCompressError SHARP_DECODE_FAILED', async () => {
    await expect(compressToDerivedWebp(Buffer.from('not-an-image'))).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'SHARP_DECODE_FAILED',
    });
  });
});
