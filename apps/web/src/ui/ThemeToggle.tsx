import { useState } from 'react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅' },
  { value: 'dark', label: '深' },
];

/** 三态分段主题开关：受控于 getThemeChoice()，点击写入并立即应用。 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice());
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="主题">
      {OPTIONS.map((o) => {
        const active = choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setThemeChoice(o.value);
              setChoice(o.value);
            }}
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
}
