import { createMomentClient, type MomentClient, type TokenStore } from '@moment/api-client';
import type { AuthTokens, UserProfile } from '@moment/dto';

const TOKENS_KEY = 'moment.auth.tokens';
const USER_KEY = 'moment.auth.user';

function readTokens(): AuthTokens | null {
  const raw = window.localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

/** web 端 TokenStore：localStorage（app 端用 expo-secure-store 实现同一接口，属 Phase 7）。 */
export const tokenStore: TokenStore = {
  getAccessToken: () => readTokens()?.accessToken ?? null,
  getRefreshToken: () => readTokens()?.refreshToken ?? null,
  setTokens: (tokens) => window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)),
  clear: () => {
    window.localStorage.removeItem(TOKENS_KEY);
    window.localStorage.removeItem(USER_KEY);
    // Http 的 refresh 失效路径只调 tokenStore.clear()（api-client 不感知 React）——
    // 派发事件通知 AuthProvider 收窄内存态（setUser(null) → RequireAuth 踢到 /login），
    // 否则 RequireAuth 仍按内存 user 判定已登录、页面永不跳转（DoD 第 11 条右半句的机制）。
    window.dispatchEvent(new Event('moment:auth-cleared'));
  },
};

export function cachedUser(): UserProfile | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function cacheUser(user: UserProfile | null): void {
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

/** 全 app 唯一 API 入口。组件里禁止裸 fetch。 */
export const client: MomentClient = createMomentClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  tokenStore,
});
