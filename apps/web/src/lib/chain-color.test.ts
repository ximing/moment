import { CHAIN_COLORS } from '@moment/dto';
import { describe, expect, it } from 'vitest';
import {
  chainColorCss,
  fallbackChainColor,
  isChainHexColor,
  normalizeChainHex,
  resolveChainAppearanceColor,
  resolveChainColor,
} from './chain-color';

// 链外观色纯逻辑（chain-appearance plan Task 7）：FNV 回退确定性、预设色走 token、
// hex 原样作为 CSS、hex 输入规范化（大写 / 可省略 #）与非法值拒绝。

describe('fallbackChainColor', () => {
  it('同一 chainId 颜色恒定且来自预设色板', () => {
    const a = fallbackChainColor('chain-abc');
    const b = fallbackChainColor('chain-abc');
    expect(a).toBe(b);
    expect(CHAIN_COLORS).toContain(a);
  });

  it('不同 chainId 的哈希结果覆盖色板（不塌缩到同一色）', () => {
    const seen = new Set(
      Array.from({ length: 64 }, (_, i) => fallbackChainColor(`chain-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('resolveChainColor', () => {
  it('null/undefined 回退到 id 哈希色', () => {
    expect(resolveChainColor('chain-abc', null)).toBe(fallbackChainColor('chain-abc'));
    expect(resolveChainColor('chain-abc')).toBe(fallbackChainColor('chain-abc'));
  });
});

describe('resolveChainAppearanceColor', () => {
  it('null/undefined 回退到 id 哈希色', () => {
    expect(resolveChainAppearanceColor('chain-abc', null)).toBe(fallbackChainColor('chain-abc'));
    expect(resolveChainAppearanceColor('chain-abc')).toBe(fallbackChainColor('chain-abc'));
  });

  it('预设色与自定义 hex 原样透传', () => {
    expect(resolveChainAppearanceColor('chain-abc', 'mint')).toBe('mint');
    expect(resolveChainAppearanceColor('chain-abc', '#A1B2C3')).toBe('#A1B2C3');
  });
});

describe('chainColorCss', () => {
  it('预设色映射到语义 token', () => {
    expect(chainColorCss('mint')).toBe('var(--dot-mint)');
    expect(chainColorCss('sky')).toBe('var(--dot-blue)');
    expect(chainColorCss('coral')).toBe('var(--action)');
  });

  it('hex 直接作为 CSS 颜色值（不经过 token）', () => {
    expect(chainColorCss('#A1B2C3')).toBe('#A1B2C3');
    expect(chainColorCss('#a1b2c3')).toBe('#a1b2c3');
  });
});

describe('isChainHexColor', () => {
  it('只接受 #RRGGBB', () => {
    expect(isChainHexColor('#A1B2C3')).toBe(true);
    expect(isChainHexColor('#a1b2c3')).toBe(true);
    expect(isChainHexColor('mint')).toBe(false);
    expect(isChainHexColor('#A1B2C3FF')).toBe(false);
    expect(isChainHexColor('#abc')).toBe(false);
  });
});

describe('normalizeChainHex', () => {
  it('合法输入统一为大写 #RRGGBB，允许省略 # 与首尾空白', () => {
    expect(normalizeChainHex('#a1b2c3')).toBe('#A1B2C3');
    expect(normalizeChainHex('a1b2c3')).toBe('#A1B2C3');
    expect(normalizeChainHex('  #A1B2C3 ')).toBe('#A1B2C3');
    expect(normalizeChainHex('#A1B2C3')).toBe('#A1B2C3');
  });

  it('非法输入返回 null（短 hex、透明色、CSS 表达式、空串）', () => {
    expect(normalizeChainHex('#12345')).toBeNull();
    expect(normalizeChainHex('#1234567')).toBeNull();
    expect(normalizeChainHex('red')).toBeNull();
    expect(normalizeChainHex('rgb(1,2,3)')).toBeNull();
    expect(normalizeChainHex('')).toBeNull();
    expect(normalizeChainHex('#')).toBeNull();
  });
});
