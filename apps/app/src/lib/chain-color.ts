import { CHAIN_COLORS, type ChainAppearanceColor, type ChainColor } from '@moment/dto';
import type { ColorTokens } from '../theme/tokens';
import type { Theme } from '../theme/theme';

function fnv(chainId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chainId.length; i++) {
    h ^= chainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 未选色时按 chainId 哈希回退，同一链颜色恒定（与 web fallbackChainColor 同算法）。 */
export function fallbackChainColor(chainId: string): ChainColor {
  return CHAIN_COLORS[fnv(chainId) % CHAIN_COLORS.length]!;
}

export function resolveChainAppearanceColor(
  chainId: string,
  color?: ChainAppearanceColor | null,
): ChainAppearanceColor {
  return color ?? fallbackChainColor(chainId);
}

const NAMED: Record<ChainColor, keyof ColorTokens> = {
  coral: 'action',
  orange: 'action',
  pink: 'dotPink',
  mint: 'dotMint',
  sky: 'dotBlue',
  purple: 'dotPurple',
  cocoa: 'stroke',
  gold: 'select',
};

/** 运行时自定义纯色（API 下发），源码不写 hex 字面量。 */
function isHexColor(value: string): boolean {
  if (value.length !== 7 || value.charCodeAt(0) !== 35) return false;
  for (let i = 1; i < 7; i++) {
    const c = value.charCodeAt(i);
    const digit = c >= 48 && c <= 57;
    const upper = c >= 65 && c <= 70;
    const lower = c >= 97 && c <= 102;
    if (!digit && !upper && !lower) return false;
  }
  return true;
}

/** 链外观色 → 主题 token（自定义纯色原样透传）。 */
export function chainColorToken(t: Theme, color: ChainAppearanceColor): string {
  if (isHexColor(color)) return color;
  const key = NAMED[color as ChainColor];
  return key ? t[key] : t.action;
}
