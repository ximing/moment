import { Image, Tag } from 'lucide-react';
import { observer, useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Icon } from '@/ui/Icon';

/**
 * 常驻 composer 入口：只是入口，点击显式打开 ComposePanel modal。挂在日子线上。
 * 视觉只消费 token：rounded-surface-lg 内容色面圆角、border-line 虚线、
 * text-body 语义字号；左侧 -left-7 圆点是日子线对齐钩子，归 Task 10 的日子线所有。
 */
export const ComposerEntry = observer(function ComposerEntry({ chainId }: { chainId?: string }) {
  const composeSession = useService(ComposeSessionService);
  return (
    <div className="relative mb-6">
      <span
        aria-hidden
        className="absolute -left-7 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-line bg-surface"
      />
      <button
        type="button"
        onClick={() => composeSession.openCompose({ chainId })}
        className="flex w-full items-center gap-3 rounded-surface-lg border border-dashed border-line bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] px-4 py-4 text-left text-muted transition-colors duration-[var(--ease)] hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
      >
        <span className="text-body">这一刻，记点什么…</span>
        <span className="ml-auto flex items-center gap-2 opacity-70" aria-hidden>
          <Icon icon={Image} size={18} />
          <Icon icon={Tag} size={18} />
        </span>
      </button>
    </div>
  );
});
