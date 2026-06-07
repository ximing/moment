import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { useCompose } from './ComposeContext';

/** 向下滚动后接力 composer 入口。chainId 由 Shell 经 useMatch 提供。 */
export function ComposeFab({ chainId }: { chainId?: string }) {
  const { openCompose } = useCompose();
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
      onClick={() => openCompose({ chainId })}
      className="fixed bottom-6 right-6 z-30 inline-flex h-12 items-center gap-2 rounded-sticker bg-action px-5 font-display text-base text-action-fg shadow-fab"
    >
      <Icon icon={Plus} size={20} />
      记下
    </button>
  );
}
