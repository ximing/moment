import { CHAIN_COLORS, type ChainColor } from '@moment/dto';

export type StickerColor = 'pink' | 'blue' | 'mint' | 'purple';

const LEGACY: readonly StickerColor[] = ['pink', 'blue', 'mint', 'purple'];

function fnv(chainId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chainId.length; i++) {
    h ^= chainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 未选色时按 chainId 哈希回退，同一链颜色恒定。 */
export function fallbackChainColor(chainId: string): ChainColor {
  return CHAIN_COLORS[fnv(chainId) % CHAIN_COLORS.length]!;
}

export function resolveChainColor(chainId: string, color?: ChainColor | null): ChainColor {
  return color ?? fallbackChainColor(chainId);
}

/** @deprecated 仅贴纸底仍用四色盘 */
export function chainColor(chainId: string): StickerColor {
  return LEGACY[fnv(chainId) % LEGACY.length]!;
}

export const stickerClasses: Record<StickerColor, string> = {
  pink: 'bg-sticker-pink border-sticker-pink-line',
  blue: 'bg-sticker-blue border-sticker-blue-line',
  mint: 'bg-sticker-mint border-sticker-mint-line',
  purple: 'bg-sticker-purple border-sticker-purple-line',
};

export const CHAIN_COLOR_CSS: Record<ChainColor, string> = {
  coral: 'var(--action)',
  orange: 'var(--today)',
  pink: 'var(--dot-pink)',
  mint: 'var(--dot-mint)',
  sky: 'var(--dot-blue)',
  purple: 'var(--dot-purple)',
  cocoa: 'var(--knot-older)',
  gold: 'var(--dot-gold)',
};
