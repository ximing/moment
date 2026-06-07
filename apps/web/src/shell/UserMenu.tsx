import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/ui/Avatar';
import { Menu, MenuItem } from '@/ui/Menu';

/** 头像菜单：我 / 通知 / 退出。宽栏贴侧栏向上弹；窄栏用通用 Menu。 */
export function UserMenu({ unread, compact }: { unread: number; compact?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const trigger = (onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={
        compact
          ? 'flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
          : 'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
      }
    >
      <span className="relative">
        <Avatar name={user.nickname} color={user.avatarColor} icon={user.avatarIcon} src={user.avatarUrl} size={compact ? 32 : 24} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-action shadow-[0_0_0_2px_var(--bg)]" />
        )}
      </span>
      {!compact && <span className="truncate text-sm">{user.nickname}</span>}
    </button>
  );

  if (compact) {
    return (
      <Menu align="right" placement="bottom" trigger={trigger()}>
        {(close) => <UserMenuItems unread={unread} close={close} navigate={navigate} logout={logout} />}
      </Menu>
    );
  }

  return <SidebarUserMenu unread={unread} user={user} navigate={navigate} logout={logout} />;
}

function SidebarUserMenu({
  unread,
  user,
  navigate,
  logout,
}: {
  unread: number;
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  navigate: ReturnType<typeof useNavigate>;
  logout: () => Promise<unknown>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [boxPos, setBoxPos] = useState<{ left: number; width: number; bottom: number } | null>(null);
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
    <div ref={box} className="w-full">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
        onClick={() => {
          const el = box.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          setBoxPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 8 });
          setOpen((v) => !v);
        }}
      >
        <span className="relative">
          <Avatar name={user.nickname} color={user.avatarColor} icon={user.avatarIcon} src={user.avatarUrl} size={24} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-action shadow-[0_0_0_2px_var(--bg)]" />
          )}
        </span>
        <span className="truncate text-sm">{user.nickname}</span>
      </button>
      {open && boxPos && (
        <>
          <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-40 cursor-default" onClick={close} />
          <div
            className="fixed z-50 rounded-[14px] border border-line bg-bg p-1 shadow-sticker"
            style={{ left: boxPos.left, width: boxPos.width, bottom: boxPos.bottom }}
          >
            <UserMenuItems unread={unread} close={close} navigate={navigate} logout={logout} />
          </div>
        </>
      )}
    </div>
  );
}

function UserMenuItems({
  unread,
  close,
  navigate,
  logout,
}: {
  unread: number;
  close: () => void;
  navigate: ReturnType<typeof useNavigate>;
  logout: () => Promise<unknown>;
}) {
  return (
    <>
      <MenuItem
        onClick={() => {
          close();
          navigate('/me');
        }}
      >
        我
      </MenuItem>
      <MenuItem
        onClick={() => {
          close();
          navigate('/notifications');
        }}
      >
        通知{unread > 0 ? ` · ${unread > 99 ? '99+' : unread}` : ''}
      </MenuItem>
      <MenuItem
        onClick={() => {
          close();
          void logout().then(() => navigate('/login'));
        }}
      >
        退出
      </MenuItem>
    </>
  );
}
