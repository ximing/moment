import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronRight, Calendar } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { RecapEntryService } from './recap-entry.service';

// recap 入口条（spec §7）：与那年今日入口条同视觉模式——
// 有内容才渲染（if !latest return null），点击导航到 recap 页（非同页展开）。
// 视觉只消费 token：rounded-surface-lg bg-surface、text-body/text-meta 语义字号，焦点环 ring-focus。

/** period 格式化为展示文案：「2026-07」→「7 月回顾」 */
function periodLabel(period: string): string {
  const month = period.slice(5);
  return `${Number(month)} 月回顾`;
}

export const RecapEntryContent = observer(function RecapEntryContent({
  chainId,
}: {
  chainId: string;
}) {
  const navigate = useNavigate();
  const service = useService(RecapEntryService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  const latest = service.latest;
  if (!latest) return null;

  const degraded = latest.status === 'degraded';

  return (
    <section aria-label="月度回顾" className="mb-6">
      <button
        type="button"
        onClick={() => navigate(`/chains/${chainId}/recaps/${latest.period}`)}
        className="flex w-full items-center gap-3 rounded-surface-lg bg-surface px-4 py-4 text-left transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
      >
        <Icon icon={Calendar} size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 text-body text-ink">
          {periodLabel(latest.period)}
          {degraded && <span className="ml-2 text-meta text-muted">（简版）</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </button>
    </section>
  );
});

export const RecapEntry = bindServices(RecapEntryContent, [RecapEntryService]);
