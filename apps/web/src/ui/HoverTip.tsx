import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 无业务浮层：hover 打开、离开关闭；点按粘滞；点空白关闭。 */
export function HoverTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [sticky, setSticky] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const open = hover || sticky;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHover(false);
        setSticky(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setHover(false);
      setSticky(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="inline-flex" onClick={() => setSticky((v) => !v)}>
        {children}
      </span>
      {open && (
        <span className="absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-48 -translate-x-1/2 rounded-[14px] border border-line bg-surface px-3 py-2 text-left elev">
          {label}
        </span>
      )}
    </span>
  );
}
