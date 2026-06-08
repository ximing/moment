import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 未登录跳 /login，登录后回跳原地址（state.from）。 */
export const RequireAuth = observer(function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  const location = useLocation();
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
});
