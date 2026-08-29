import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ChainLook } from '@/chain/ChainMark';
import { memoriesBarText } from '@/lib/memories';
import { MomentSheet } from '@/timeline/moment-sheet';
import { Icon } from '@/ui/Icon';
import { MemoriesService } from './memories.service';

// 那年今日入口条 + 同页内嵌面板（spec memories-today §4）：
// 有周年内容才渲染（无内容不打扰）；点击展开按年份分组的面板，复用 MomentSheet。
// 视觉只消费 token：rounded-surface-lg 内容色面圆角、bg-surface、text-body/text-meta
// 语义字号，焦点环 ring-focus；不加阴影，与日子线上的内容层同一克制。
// 面板是内容流的一部分（同页展开），不是浮层，不走 z-index 层级。

// 具名导出是测试 seam：测试在全局容器注册 MemoriesService 后直接渲染本组件。
export const MemoriesEntryContent = observer(function MemoriesEntryContent({
  chainLookById,
}: {
  chainLookById?: Map<string, ChainLook>;
}) {
  const service = useService(MemoriesService);
  const summary = service.summary;
  // 无周年内容（含首拉失败降级）整条不渲染
  if (!summary) return null;

  return (
    <section aria-label="往年今日" className="mb-6">
      <button
        type="button"
        aria-expanded={service.open}
        aria-controls="memories-today-panel"
        onClick={() => service.toggle()}
        className="flex w-full items-center gap-3 rounded-surface-lg bg-surface px-4 py-4 text-left transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
      >
        <span aria-hidden className="text-body">
          📅
        </span>
        <span className="min-w-0 flex-1 text-body text-ink">{memoriesBarText(summary)}</span>
        <Icon icon={service.open ? ChevronUp : ChevronDown} size={16} className="shrink-0 text-muted" />
      </button>
      {service.open && (
        <div id="memories-today-panel" className="mt-4 flex flex-col gap-6">
          {service.years.map((g) => (
            <section key={g.year} aria-label={`${g.year} 年`}>
              <h2 className="mb-4 text-body font-medium text-ink">
                {g.year} 年 · <span className="text-meta font-normal text-muted">{g.moments.length} 条</span>
              </h2>
              <div className="flex flex-col gap-6">
                {g.moments.map((m) => (
                  <MomentSheet
                    key={m.id}
                    moment={m}
                    chainName={chainLookById?.get(m.chainId)?.name}
                    chainColor={chainLookById?.get(m.chainId)?.color}
                    chainIcon={chainLookById?.get(m.chainId)?.icon}
                    chainAvatarMediaId={chainLookById?.get(m.chainId)?.avatarMediaId}
                    chainAvatarUrl={chainLookById?.get(m.chainId)?.avatarUrl}
                    chainAvatarFocus={chainLookById?.get(m.chainId)?.avatarFocus}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
});

export const MemoriesEntry = bindServices(MemoriesEntryContent, [MemoriesService]);
