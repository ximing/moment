import type { ReactElement } from 'react';
import { Circle, Line, Path, Rect, Svg } from 'react-native-svg';
import { useTheme } from '../theme/use-theme';
import { APP_LINE_ICONS, type AppLineIconName, type AppLineIconNode } from './app-line-icons';

export type { AppLineIconName } from './app-line-icons';

function renderNode(node: AppLineIconNode, index: number): ReactElement {
  const [tag, attrs] = node;
  switch (tag) {
    case 'path':
      return <Path key={index} d={attrs.d} />;
    case 'circle':
      return <Circle key={index} cx={attrs.cx} cy={attrs.cy} r={attrs.r} />;
    case 'line':
      return <Line key={index} x1={attrs.x1} y1={attrs.y1} x2={attrs.x2} y2={attrs.y2} />;
    case 'rect':
      return (
        <Rect key={index} x={attrs.x} y={attrs.y} width={attrs.width} height={attrs.height} rx={attrs.rx} />
      );
  }
}

/**
 * 单色线性图标（spec §4.4：代码写死的装饰字符一律走这里，数据值走 AppIcon）。
 * 描边属性对齐 lucide 默认（strokeWidth 2 / round caps）；颜色经主题 token——
 * 缺省色 = muted（次级/装饰语义）；调用方需强调时显式传 token 值，禁止字面量。
 */
export function Icon({ name, size = 24, color }: { name: AppLineIconName; size?: number; color?: string }): ReactElement {
  const t = useTheme();
  const strokeColor = color ?? t.muted;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={strokeColor}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {APP_LINE_ICONS[name].map(renderNode)}
    </Svg>
  );
}
