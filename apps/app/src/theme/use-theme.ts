import { useColorScheme } from 'react-native';
import { themes, type Theme } from './theme';

/**
 * 主题 = 系统外观的纯函数：跟随 Appearance，无 Provider、无 Context。
 * theme 对象为模块级常量，切主题时引用才变化，可直接作 useMemo 依赖。
 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? themes.dark : themes.light;
}
