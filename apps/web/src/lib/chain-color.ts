import { CHAIN_COLORS, type ChainAppearanceColor, type ChainColor } from '@moment/dto';

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

/** @deprecated 既有消费方仍只接受预设色；新代码用 resolveChainAppearanceColor。 */
export function resolveChainColor(chainId: string, color?: ChainColor | null): ChainColor {
  return color ?? fallbackChainColor(chainId);
}

/** 链外观色解析：预设色或自定义 hex 原样透传，null 时按 chainId 哈希回退预设色。 */
export function resolveChainAppearanceColor(
  chainId: string,
  color?: ChainAppearanceColor | null,
): ChainAppearanceColor {
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

/** 是否自定义 hex 色（#RRGGBB）；预设色名返回 false。 */
export function isChainHexColor(color: ChainAppearanceColor): color is `#${string}` {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * 链外观色 → CSS 颜色值：预设色走语义 token 映射，自定义 hex 原样作为 CSS 颜色
 * （spec §7.5：自定义纯色直接渲染，不映射回预设 token）。
 */
export function chainColorCss(color: ChainAppearanceColor): string {
  if (isChainHexColor(color)) return color;
  return CHAIN_COLOR_CSS[color];
}

/**
 * 用户输入 → 规范化 #RRGGBB（大写；允许省略 # 与首尾空白）；非法返回 null。
 * 与 dto 的 chainAppearanceColorSchema 同一规则（严格六位、拒绝透明/短 hex/CSS 表达式）。
 */
export function normalizeChainHex(input: string): `#${string}` | null {
  const trimmed = input.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}` as `#${string}`;
}
