import { useCompose } from './ComposeContext';

/** 常驻 composer 入口（spec §5）：只是入口，点击显式打开 ComposePanel modal，不做内联展开。
    半透明底用 color-mix：Tailwind v3 对 var() 色值的 /60 透明度修饰静默不生成 CSS（硬约束）。 */
export function ComposerEntry({ chainId }: { chainId?: string }) {
  const { openCompose } = useCompose();
  return (
    <button
      type="button"
      onClick={() => openCompose({ chainId })}
      className="relative mb-6 flex w-full items-center gap-3 rounded-card border-2 border-dashed border-line bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-5 py-4 text-left text-muted shadow-card hover:text-ink"
    >
      {/* 挂链首：与卡片链节同视觉（16px 圆点 -left-6，中心落 x10 对齐虚线，同 MomentSheet 链节环） */}
      <span aria-hidden className="absolute -left-6 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-line bg-surface" />
      <span className="text-[17px]">这一刻,记点什么…</span>
      <span className="ml-auto flex gap-2 text-lg" aria-hidden>
        🖼️ 🏷️ 🕐
      </span>
    </button>
  );
}
