import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { cacheUser, cachedUser, client, tokenStore } from '@/api/client';

interface AuthContextValue {
  user: UserProfile | null;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  /** 邀请接受等流程复用：写入 tokens + user 并更新内存态 */
  applyAuth(res: AuthResponse): void;
  refreshUser(next: UserProfile): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => cachedUser());
  const queryClient = useQueryClient();

  // refresh 彻底失效 → Http 调 tokenStore.clear() → web tokenStore 派发 'moment:auth-cleared'。
  // 这里收窄内存态：setUser(null) 后受保护路由的 RequireAuth 立即重定向 /login（state.from 回跳语义保留），
  // query 缓存全部作废。logout() 显式调用时同样触发本 listener（幂等，无副作用）。
  useEffect(() => {
    const onAuthCleared = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('moment:auth-cleared', onAuthCleared);
    return () => window.removeEventListener('moment:auth-cleared', onAuthCleared);
  }, [queryClient]);

  // 每次进站重拉 /me，换发 6 天头像链接（缓存里的旧签名会过期）
  useEffect(() => {
    if (!cachedUser()) return;
    void client.me().then((next) => {
      cacheUser(next);
      setUser(next);
    }).catch(() => undefined);
  }, []);

  const applyAuth = useCallback((res: AuthResponse) => {
    tokenStore.setTokens(res.tokens);
    cacheUser(res.user);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      applyAuth(await client.login(input));
    },
    [applyAuth]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      applyAuth(await client.register(input));
    },
    [applyAuth]
  );

  const logout = useCallback(async () => {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) {
      await client.logout(refreshToken).catch(() => undefined);
    }
    tokenStore.clear();
    cacheUser(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const refreshUser = useCallback((next: UserProfile) => {
    cacheUser(next);
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({ user, login, register, logout, applyAuth, refreshUser }),
    [user, login, register, logout, applyAuth, refreshUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- brief 契约：useAuth 与 Provider 同文件导出
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
