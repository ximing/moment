import sharp from 'sharp';
import {
  DERIVED_MAX_EDGE,
  DERIVED_MIME,
  DERIVED_WEBP_QUALITY,
  NonRetryableCompressError,
  compressToDerivedWebp,
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

describe('compressToDerivedWebp（spec §0 / §4.2：最长边 512、WebP 75、不放大）', () => {
  it('常量锁定', () => {
    expect(DERIVED_MAX_EDGE).toBe(512);
    expect(DERIVED_WEBP_QUALITY).toBe(75);
    expect(DERIVED_MIME).toBe('image/webp');
  });

  it('2000×1000 JPEG → webp，最长边 512（512×256），不读原图像素出域以外的副作用', async () => {
    const out = await compressToDerivedWebp(await jpegOf(2000, 1000));
    expect(out.width).toBe(512);
    expect(out.height).toBe(256);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(256);
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
