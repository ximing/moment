import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { Loading } from './Loading';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  return <>{children}</>;
}
