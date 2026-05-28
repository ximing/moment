import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import type { UserProfile } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from './api';
import { queryClient } from './query';
import { loadUser, saveUser, secureTokenStore } from './token-store';
import { registerForPushNotifications } from './push';

interface AuthContextValue {
  user: UserProfile | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; nickname: string }): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void loadUser().then(async (stored) => {
      if (cancelled) return;
      setUser(stored);
      setReady(true);
      // 冷启动：本地有 token，先校验仍有效（顺带触发 api-client 的 401 单飞 refresh）
      if (stored) {
        try {
          const me = await client.me();
          if (cancelled) return;
          setUser(me);
          await saveUser(me);
          await registerForPushNotifications();
        } catch (err) {
          if (cancelled) return;
          // 仅 401 登出（refresh 已失败且 api-client 内部 tokenStore.clear() 已清态）。
          // 网络错误（status 0）不登出：保留 stored 用户态，各页面 query 自行呈错/下拉重试，
          // 避免飞行模式冷启动把持有有效 token 的用户踢到登录页。
          if (err instanceof ApiError && err.status === 401) {
            setUser(null);
            router.replace('/login');
          }
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await client.login({ email, password });
    // 必须先 await 落盘，再触发任何需要带 token 的调用（含推送注册），避免读到旧/空 token
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    setUser(res.user);
    await registerForPushNotifications();
  }, []);

  const register = useCallback(async (input: { email: string; password: string; nickname: string }) => {
    const res = await client.register(input);
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    setUser(res.user);
    await registerForPushNotifications();
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    await secureTokenStore.clear();
    await SecureStore.deleteItemAsync('moment.push.token');
    setUser(null);
    queryClient.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
