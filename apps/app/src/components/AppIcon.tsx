import { Text } from 'react-native';
import { resolveAppIcon } from './app-icon-resolve';
import { APP_ICON_COMPONENTS } from './app-icon-components';

export { resolveAppIcon } from './app-icon-resolve';

/** 渲染一个字符串值：词表 icon key / 存量 emoji → 彩色面性 SVG；其余 <Text> 原文兜底。 */
export function AppIcon({ value, size = 20 }: { value: string; size?: number }) {
  const hit = resolveAppIcon(value);
  if (!hit) {
    return <Text style={{ fontSize: size, lineHeight: size * 1.2 }}>{value}</Text>;
  }
  const Component = APP_ICON_COMPONENTS[hit.key];
  return <Component width={size} height={size} accessibilityLabel={hit.label} />;
}
