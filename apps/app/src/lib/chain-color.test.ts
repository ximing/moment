import { describe, expect, it } from 'vitest';
import { themes } from '../theme/theme';
import { chainColorToken, fallbackChainColor, resolveChainAppearanceColor } from './chain-color';

describe('fallbackChainColor', () => {
  it('同一 chainId 颜色恒定，不同 id 可不同', () => {
    expect(fallbackChainColor('abc')).toBe(fallbackChainColor('abc'));
    expect(typeof fallbackChainColor('abc')).toBe('string');
  });
});

describe('resolveChainAppearanceColor', () => {
  it('有色用传入值，null 回退哈希', () => {
    expect(resolveChainAppearanceColor('abc', 'pink')).toBe('pink');
    expect(resolveChainAppearanceColor('abc', null)).toBe(fallbackChainColor('abc'));
  });
});

describe('chainColorToken', () => {
  it('预设色映射到语义 token', () => {
    const t = themes.light;
    expect(chainColorToken(t, 'coral')).toBe(t.action);
    expect(chainColorToken(t, 'orange')).toBe(t.action);
    expect(chainColorToken(t, 'pink')).toBe(t.dotPink);
    expect(chainColorToken(t, 'mint')).toBe(t.dotMint);
    expect(chainColorToken(t, 'sky')).toBe(t.dotBlue);
    expect(chainColorToken(t, 'purple')).toBe(t.dotPurple);
    expect(chainColorToken(t, 'cocoa')).toBe(t.stroke);
    expect(chainColorToken(t, 'gold')).toBe(t.select);
  });
});
