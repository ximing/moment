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
  },
};

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
