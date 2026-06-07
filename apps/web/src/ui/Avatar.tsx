import type { ChainColor, ChainIcon } from '@moment/dto';
import { CHAIN_COLOR_CSS } from '@/lib/chain-color';

export function Avatar({
  name,
  size = 32,
  color,
  icon,
  src,
}: {
  name: string;
  size?: number;
  color?: ChainColor | null;
  icon?: ChainIcon | string | null;
  src?: string | null;
}) {
  const ch = (name.trim()[0] ?? '·').toUpperCase();
  const bg = color ? CHAIN_COLOR_CSS[color] : 'var(--select)';
  const fg = color ? '#fff' : 'var(--select-fg)';
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        fontSize: icon ? size * 0.5 : size * 0.42,
        background: bg,
        color: fg,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {icon ?? ch}
    </span>
  );
}
