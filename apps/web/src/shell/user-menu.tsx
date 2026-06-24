import { useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';
import { Avatar } from '@/ui/Avatar';
// 必须显式指向 barrel：src/ui/ 下遗留 Menu.tsx 会截获裸目录导入（见 ui/menu/index.ts）
import { MenuItem, ResponsiveMenu } from '@/ui/menu/index';

/**
 * 头像菜单：我的资料 / 通知 / 退出登录（Menu 规范 §14/§16 文案）。
 * 宽栏与窄栏共用 ResponsiveMenu（≥768px 锚定 Menu，<768px ActionSheet），
 * 侧栏 Trigger 允许等宽（Menu 规范 §5.2）；原侧栏私有浮层（手写层级、
 * window 级 Escape、透明全屏关闭层）已全部退出。
 */
export const UserMenu = observer(function UserMenu({ unread, compact }: { unread: number; compact?: boolean }) {
  const auth = useService(AuthService);
  const user = auth.user;
  const navigate = useNavigate();
  if (!user) return null;

  const trigger = (
    <button
      type="button"
      aria-label={`${user.nickname} 的菜单`}
      className={`flex items-center gap-2 rounded-menu-item px-2 py-1.5 text-left transition-colors duration-[var(--ease)] hover:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset ${
        compact ? '' : 'w-full'
      }`}
    >
      <span className="relative">
        <Avatar name={user.nickname} color={user.avatarColor} icon={user.avatarIcon} src={user.avatarUrl} size={compact ? 32 : 24} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-action ring-2 ring-bg" />
        )}
      </span>
      {!compact && <span className="truncate text-sm">{user.nickname}</span>}
    </button>
  );

  return (
    <ResponsiveMenu
      aria-label="帐户菜单"
      sheetTitle={user.nickname}
      trigger={trigger}
      onAction={(key) => {
        if (key === 'profile') navigate('/me');
        else if (key === 'notifications') navigate('/notifications');
        // 退出走 AuthService.logout 既有单路径：tokenStore.clear 派发
        // moment:auth-cleared 收敛内存态（Toast 清空由 Feedback 的监听承担）
        else if (key === 'logout') void auth.logout().then(() => navigate('/login'));
      }}
    >
      <MenuItem id="profile" textValue="我的资料">
        我的资料
      </MenuItem>
      <MenuItem
        id="notifications"
        textValue="通知"
        count={unread > 0 ? unread : undefined}
      >
        通知
      </MenuItem>
      {/* 退出登录可恢复，保持普通文字（Menu 规范 §7.3），不用 danger 色 */}
      <MenuItem id="logout" textValue="退出登录">
        退出登录
      </MenuItem>
    </ResponsiveMenu>
  );
});
