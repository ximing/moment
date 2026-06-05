import { useEffect, useState } from 'react';
import { useCompose } from './ComposeContext';

/** 向下滚动后接力 composer 入口的橙色 FAB（spec §5）。滚动监听是事件源，非 effect 链式 setState。
    chainId 由 Shell 经 useMatch 提供——path-less 布局路由里 useParams 拿不到子路由参数（审查修正）。 */
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
      className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full border-2 border-line bg-action text-2xl text-action-fg shadow-card"
    >
      ＋
    </button>
  );
}
