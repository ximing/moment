import { observer, useService } from '@rabjs/react';
import { ThemeService } from '@/services/theme.service';
import type { ThemeChoice } from '@/lib/theme';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

/** 三态分段主题开关：受控于全局 ThemeService（spec §3.2）。 */
export const ThemeToggle = observer(function ThemeToggle() {
  const theme = useService(ThemeService);
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="主题">
      {OPTIONS.map((o) => {
        const active = theme.choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => theme.setChoice(o.value)}
            className={`rounded-sticker px-3 py-1.5 text-sm ${
              active ? 'bg-select text-select-fg' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
});
