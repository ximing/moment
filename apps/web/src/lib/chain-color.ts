import { CHAIN_COLORS, type ChainColor } from '@moment/dto';

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

// 直接消费语义 token，不再经 tokens.css 的过渡 alias 段中转
export const CHAIN_COLOR_CSS: Record<ChainColor, string> = {
  coral: 'var(--action)',
  orange: 'var(--action)',
  pink: 'var(--dot-pink)',
  mint: 'var(--dot-mint)',
  sky: 'var(--dot-blue)',
  purple: 'var(--dot-purple)',
  cocoa: 'var(--stroke)',
  gold: 'var(--select)',
};
