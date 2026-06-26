import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { observer, useService } from '@rabjs/react';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Icon } from '@/ui/Icon';

/**
 * 向下滚动后接力 composer 入口。chainId 由 Shell 经 useMatch 提供。滚动显隐是纯 UI，留在组件（spec §6）。
 * 视觉只消费 token：h-fab 几何、rounded-full 满圆、px-button-pill、z-floating 层级；
 * shadow-fab 是 Tailwind 语义映射里唯一的 FAB 阴影（C 端总规范 §2.4 允许悬浮 FAB 投影）。
 * 状态语言与 Button primary 对齐（hover 加深、按压 scale-button-pressed、focus-visible 环）。
 */
export const ComposeFab = observer(function ComposeFab({ chainId }: { chainId?: string }) {
  const composeSession = useService(ComposeSessionService);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 240);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;
  return (
    <button
      type="button"
      aria-label="记下此刻"
      onClick={() => composeSession.openCompose({ chainId })}
      className="fixed bottom-6 right-6 z-floating inline-flex h-fab items-center gap-button-icon rounded-full bg-action px-button-pill font-display text-base text-action-fg shadow-fab transition-[background-color,transform] duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--action)_94%,var(--ink))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg motion-safe:active:scale-button-pressed"
    >
      <Icon icon={Plus} size={20} />
      记下
    </button>
  );
});
