import type { JSX } from 'react';
import { EmptyState } from '@/ui/feedback/index';

/**
 * 认证通配符落点（plan Task 8）：纯 EmptyState「没有这个页面」。
 * 空状态不是错误——不渲染 Banner / Toast / 操作；未认证访问由 RequireAuth 在
 * 到达本组件前重定向 /login（见 App.tsx 路由树与 app-toast.test.tsx）。
 */
export function NotFound(): JSX.Element {
  return (
    <EmptyState
      variant="plain"
      scope="page"
      title="没有这个页面"
      description="链接可能已失效，回到大家的日子继续看看。"
    />
  );
}
