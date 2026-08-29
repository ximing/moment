import sharp from 'sharp';

export const DERIVED_MAX_EDGE = 512;
export const DERIVED_WEBP_QUALITY = 75;
export const DERIVED_MIME = 'image/webp';

/**
 * compress 终败（spec §2.3）。processor 只认 error.name === 'NonRetryableCompressError'。
 * handler 禁止自写 outbox.status。
 */
export class NonRetryableCompressError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableCompressError';
  }
}

export async function compressToDerivedWebp(
  buf: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({
        width: DERIVED_MAX_EDGE,
        height: DERIVED_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: DERIVED_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof NonRetryableCompressError) throw err;
    throw new NonRetryableCompressError('SHARP_DECODE_FAILED', err);
  }
}
