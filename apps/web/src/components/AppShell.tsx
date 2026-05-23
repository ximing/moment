import { NavLink, Outlet, useNavigate } from 'react-router';
import { Bell, Home, LogOut, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1 rounded px-3 py-1.5 text-sm ${
    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // 未读 badge：30s 轮询，只取第一页（limit 50 即可——服务端默认每页仅 20，badge 上限 50 可接受；
  // 「全部已读」在通知页翻页收集全部未读，见 NotificationsPage）
  const { data: notifications } = useQuery({
    queryKey: qk.notifications(false),
    queryFn: () => client.listNotifications(undefined, { limit: 50 }),
    refetchInterval: 30_000,
  });
  const unread = (notifications?.notifications ?? []).filter((n) => n.readAt === null).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-3xl items-center gap-1 px-3 py-2">
          <NavLink to="/" end className={navClass}>
            <Home size={16} />
            时光
          </NavLink>
          <NavLink to="/chains" className={navClass}>
            <Users size={16} />
            链
          </NavLink>
          <NavLink to="/notifications" className={`${navClass} relative`}>
            <Bell size={16} />
            通知
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-600">{user?.nickname}</span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            >
              <LogOut size={14} />
              退出
            </button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-3 py-4">
        <Outlet />
      </main>
    </div>
  );
}
