import { Image, Tag } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { useCompose } from './ComposeContext';

/** 常驻 composer 入口：只是入口，点击显式打开 ComposePanel modal。挂在日子线上。 */
export function ComposerEntry({ chainId }: { chainId?: string }) {
  const { openCompose } = useCompose();
  return (
    <div className="relative mb-6">
      <span
        aria-hidden
        className="absolute -left-7 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-line bg-surface"
      />
      <button
        type="button"
        onClick={() => openCompose({ chainId })}
        className="flex w-full items-center gap-3 rounded-card border border-dashed border-line bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] px-4 py-4 text-left text-muted hover:bg-surface hover:text-ink"
      >
        <span className="text-[17px]">这一刻，记点什么…</span>
        <span className="ml-auto flex items-center gap-2 opacity-70" aria-hidden>
          <Icon icon={Image} size={18} />
          <Icon icon={Tag} size={18} />
        </span>
      </button>
    </div>
  );
}
