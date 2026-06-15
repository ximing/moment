import { useEffect, useState, type ReactNode } from 'react';

/** 无业务浮层：hover 打开；点按切换；点空白关闭。 */
export function HoverTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex" onClick={() => setOpen((v) => !v)}>
        {children}
      </span>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-48 -translate-x-1/2 rounded-[14px] border border-line bg-surface px-3 py-2 text-left elev">
            {label}
          </span>
        </>
      )}
    </span>
  );
}
