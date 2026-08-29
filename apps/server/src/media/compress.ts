import sharp from 'sharp';

/** 时间线卡片派生图（入库）。 */
export const DERIVED_MAX_EDGE = 1280;
export const DERIVED_WEBP_QUALITY = 85;
export const DERIVED_MIME = 'image/webp';

/** 发给 embedding 的图：内存压，不入库。 */
export const EMBED_MAX_EDGE = 1024;
export const EMBED_WEBP_QUALITY = 80;

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

export async function compressToWebp(
  buf: Buffer,
  maxEdge: number,
  quality: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof NonRetryableCompressError) throw err;
    throw new NonRetryableCompressError('SHARP_DECODE_FAILED', err);
  }
}

export function compressToDerivedWebp(
  buf: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  return compressToWebp(buf, DERIVED_MAX_EDGE, DERIVED_WEBP_QUALITY);
}

export function compressToEmbedWebp(
  buf: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  return compressToWebp(buf, EMBED_MAX_EDGE, EMBED_WEBP_QUALITY);
}
