import { describe, expect, it } from 'vitest';
import { themes } from '../theme/theme';
import { chainColorToken, fallbackChainColor, resolveChainAppearanceColor } from './chain-color';

describe('fallbackChainColor', () => {
  it('同一 chainId 颜色恒定，不同 id 可不同', () => {
    expect(fallbackChainColor('abc')).toBe(fallbackChainColor('abc'));
    expect(typeof fallbackChainColor('abc')).toBe('string');
  });

  it('与服务端 FNV 黄金向量一致', () => {
    expect(fallbackChainColor('00000000-0000-4000-8000-000000000014')).toBe('coral');
    expect(fallbackChainColor('11111111-1111-4111-8111-111111111111')).toBe('mint');
    expect(fallbackChainColor('abcdefab-1234-4567-89ab-cdef01234567')).toBe('orange');
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
