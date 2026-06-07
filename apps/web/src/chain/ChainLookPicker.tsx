import { CHAIN_COLORS, CHAIN_ICONS, type ChainColor, type ChainIcon } from '@moment/dto';
import { CHAIN_COLOR_CSS } from '@/lib/chain-color';

export function ChainLookPicker({
  color,
  icon,
  onColor,
  onIcon,
}: {
  color: ChainColor;
  icon: ChainIcon | null;
  onColor: (c: ChainColor) => void;
  onIcon: (i: ChainIcon | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-sm text-muted">颜色</p>
        <div className="flex flex-wrap gap-2">
          {CHAIN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => onColor(c)}
              className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''}`}
              style={{ background: CHAIN_COLOR_CSS[c] }}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-sm text-muted">图标</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-label="只用色点"
            aria-pressed={icon === null}
            onClick={() => onIcon(null)}
            className={`h-8 w-8 rounded-full text-sm ${icon === null ? 'bg-select' : 'bg-surface elev-sm'}`}
          >
            ·
          </button>
          {CHAIN_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={i}
              aria-pressed={icon === i}
              onClick={() => onIcon(i)}
              className={`h-8 w-8 rounded-full text-base ${icon === i ? 'bg-select' : 'bg-surface elev-sm'}`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
