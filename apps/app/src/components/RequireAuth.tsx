import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { AuthService } from '../services/auth.service';
import { Loading } from './Loading';

/** ready 闸必须有：SecureStore 异步水合期间不能当未登录踢走（web 同步水合才没有这道闸）。 */
export const RequireAuth = observer(function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useService(AuthService);
  if (!auth.ready) return <Loading />;
  if (!auth.user) return <Redirect href="/login" />;
  return <>{children}</>;
});
