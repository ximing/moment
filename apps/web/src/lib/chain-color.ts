export type StickerColor = 'pink' | 'blue' | 'mint' | 'purple';

const COLORS: readonly StickerColor[] = ['pink', 'blue', 'mint', 'purple'];

/**
 * 链颜色点（spec §1.4）：chains 表无 color 字段且禁止改 schema，
 * 客户端确定性推导 hash(chainId) % 4，同一链在所有页面颜色恒定。
 * FNV-1a 32bit：简单稳定，跨端/跨会话一致。
 */
export function chainColor(chainId: string): StickerColor {
  let h = 0x811c9dc5;
  for (let i = 0; i < chainId.length; i++) {
    h ^= chainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return COLORS[(h >>> 0) % 4]!;
}

/** 颜色点/贴纸底的工具类（全字面量，保证 Tailwind 扫描得到；深色描边随 token 自动切换）。 */
export const stickerClasses: Record<StickerColor, string> = {
  pink: 'bg-sticker-pink border-sticker-pink-line',
  blue: 'bg-sticker-blue border-sticker-blue-line',
  mint: 'bg-sticker-mint border-sticker-mint-line',
  purple: 'bg-sticker-purple border-sticker-purple-line',
};
