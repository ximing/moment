import { EMOJI_TO_ICON } from '@moment/dto';
import { ICON_MANIFEST, hasIconKey, type IconKey } from '@moment/icons';
import { APP_ICON_COMPONENTS } from './app-icon-components.js';

/** 三级解析（spec §4.1）：注册表 → EMOJI_TO_ICON 映射 → null（调用方原文兜底）。 */
// eslint-disable-next-line react-refresh/only-export-components -- spec §4.1 固定 API：纯解析函数与 AppIcon 同一文件，测试与 P2/P3 替换点共用
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null {
  if (hasIconKey(value)) return { key: value, label: ICON_MANIFEST[value].label };
  const mapped = EMOJI_TO_ICON[value];
  if (mapped && hasIconKey(mapped)) return { key: mapped, label: ICON_MANIFEST[mapped].label };
  return null;
}

/** 渲染一个字符串值：词表 icon key / 存量 emoji → 彩色面性 SVG；其余原文兜底。不吞未知值、不报错。 */
export function AppIcon({
  value,
  size = 20,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const hit = resolveAppIcon(value);
  if (!hit) {
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {value}
      </span>
    );
  }
  const Component = APP_ICON_COMPONENTS[hit.key];
  return (
    <Component width={size} height={size} role="img" aria-label={hit.label} className={className} />
  );
}
