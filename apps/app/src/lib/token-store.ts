import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, UserProfile } from '@moment/dto';
import type { TokenStore } from '@moment/api-client';

const TOKENS_KEY = 'moment.auth.tokens';
const USER_KEY = 'moment.auth.user';

async function readTokens(): Promise<AuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

/** api-client TokenStore 接口的 SecureStore 实现（spec §6「App 安全存储」）。 */
export const secureTokenStore: TokenStore = {
  async getAccessToken() {
    return (await readTokens())?.accessToken ?? null;
  },
  async getRefreshToken() {
    return (await readTokens())?.refreshToken ?? null;
  },
  async setTokens(tokens) {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined);
    notifyAuthCleared(); // 单路径：登出与 refresh 失效都从这里通知 AuthService
  },
};

type AuthClearedListener = () => void;
const authClearedListeners = new Set<AuthClearedListener>();

/** tokenStore.clear() 的唯一桥（替代 web 的 window 'moment:auth-cleared'）：
 *  api-client Http refresh 失效与 AuthService.logout 都经 clear() 收敛到 AuthService 构造里的订阅。 */
export function onAuthCleared(fn: AuthClearedListener): () => void {
  authClearedListeners.add(fn);
  return () => {
    authClearedListeners.delete(fn);
  };
}

function notifyAuthCleared(): void {
  for (const fn of [...authClearedListeners]) fn();
}

export async function loadUser(): Promise<UserProfile | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function saveUser(user: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}
