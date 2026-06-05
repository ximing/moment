import { useState, type ReactNode } from 'react';

/** 通用弹出小菜单：trigger 始终渲染；children 拿 close() 渲染菜单项。纯 UI，无业务。 */
export function Menu({
  trigger,
  children,
  align = 'right',
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <span className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-30 cursor-default" onClick={close} />
          <span
            className={`absolute z-40 mt-1 min-w-32 rounded-card border-2 border-line bg-surface p-1 shadow-card ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {children(close)}
          </span>
        </>
      )}
    </span>
  );
}
