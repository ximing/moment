import { useEffect, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Icon } from '@/ui/Icon';

/** 通用弹出小菜单：trigger 始终渲染；children 拿 close() 渲染菜单项。 */
export function Menu({
  trigger,
  children,
  align = 'right',
  placement = 'bottom',
  fullWidth,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  /** top：向上弹出（侧栏底头像） */
  placement?: 'bottom' | 'top';
  /** 侧栏底栏：占满父级宽度，hover 才能通栏 */
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className={`relative ${fullWidth ? 'block w-full' : 'inline-block'}`}>
      <span className={fullWidth ? 'block w-full' : undefined} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </span>
      {open && (
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-40 cursor-default" onClick={close} />
          <span
            className={`absolute z-50 rounded-[14px] border border-line bg-surface p-1 elev ${
              fullWidth
                ? 'left-0 right-0 w-full min-w-0'
                : `min-w-36 ${align === 'right' ? 'right-0' : 'left-0'}`
            } ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-1.5'}`}
          >
            {children(close)}
          </span>
        </>
      )}
    </span>
  );
}

export function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] ${
        danger ? 'text-danger' : 'text-ink'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 三点按钮：始终有 hover 底。 */
export function KebabButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
    >
      <Icon icon={MoreHorizontal} />
    </button>
  );
}

/** 右键浮层，坐标相对视口。 */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div
        className="fixed z-50 min-w-36 rounded-[14px] border border-line bg-surface p-1 elev"
        style={{ left: x, top: y }}
      >
        {children(onClose)}
      </div>
    </>
  );
}
