/** spec fused-retrieval §2.1：这三种静态图不压，derived_status 恒 NULL。 */
export const NON_COMPRESSIBLE_IMAGE_MIMES = ['image/gif', 'image/heic', 'image/heif'] as const;

const SKIP = new Set<string>(NON_COMPRESSIBLE_IMAGE_MIMES);

/** 静态可压图 = image/* 且不是 GIF/HEIC/HEIF。音频/视频 false。 */
export function isCompressibleMime(mime: string): boolean {
  const normalized = mime.toLowerCase();
  return normalized.startsWith('image/') && !SKIP.has(normalized);
}

/** 派生对象相对 key（spec §2.1）。无 bucket prefix。 */
export function derivedObjectKey(chainId: string, momentId: string, mediaId: string): string {
  return `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
}
