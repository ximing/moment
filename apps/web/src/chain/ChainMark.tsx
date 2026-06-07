import type { ChainColor, ChainIcon } from '@moment/dto';
import { CHAIN_COLOR_CSS, resolveChainColor } from '@/lib/chain-color';

/** 链标记：选了图标就画在色底圆上，否则只画色点。 */
export function ChainMark({
  chainId,
  color,
  icon,
  size = 16,
}: {
  chainId: string;
  color?: ChainColor | null;
  icon?: ChainIcon | string | null;
  size?: number;
}) {
  const resolved = resolveChainColor(chainId, color);
  const bg = CHAIN_COLOR_CSS[resolved];
  if (icon) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size, background: bg, fontSize: size * 0.58, lineHeight: 1 }}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: bg }}
    />
  );
}
