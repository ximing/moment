import type { LucideIcon, LucideProps } from 'lucide-react';

/** 统一描边图标。业务面只走这一层，不要在页面里直接摊 lucide 的 size/stroke。 */
export function Icon({
  icon: Cmp,
  size = 16,
  strokeWidth = 1.75,
  className = '',
  ...rest
}: { icon: LucideIcon } & LucideProps) {
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} aria-hidden {...rest} />;
}
