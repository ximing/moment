import { EMOJI_TO_ICON } from '@moment/dto';
import { ICON_MANIFEST, hasIconKey, type IconKey } from '@moment/icons';

/** 三级解析（spec §4.1）：注册表 → EMOJI_TO_ICON 映射 → null（调用方原文兜底）。 */
export function resolveAppIcon(value: string): { key: IconKey; label: string } | null {
  if (hasIconKey(value)) return { key: value, label: ICON_MANIFEST[value].label };
  const mapped = EMOJI_TO_ICON[value];
  if (mapped && hasIconKey(mapped)) return { key: mapped, label: ICON_MANIFEST[mapped].label };
  return null;
}
