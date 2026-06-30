import {
  darkColors,
  lightColors,
  sharedTokens,
  type ColorTokens,
  type SharedTokens,
} from './tokens';

export type ThemeScheme = 'light' | 'dark';

/** 组件消费的主题对象：色彩（随主题）+ 共享几何/字号/动效 + 当前 scheme */
export type Theme = ColorTokens & SharedTokens & { scheme: ThemeScheme };

export const themes: Record<ThemeScheme, Theme> = {
  light: { scheme: 'light', ...lightColors, ...sharedTokens },
  dark: { scheme: 'dark', ...darkColors, ...sharedTokens },
};
