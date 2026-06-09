import { Service } from '@rabjs/react';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { cacheUser, cachedUser, client, tokenStore } from '@/api/client';

/** 全局认证态（spec §3.1）。localStorage 水合在字段初始化，事件单路径收敛在 onAuthCleared。 */
export class AuthService extends Service {
  user: UserProfile | null = cachedUser();

  constructor() {
    super();
    // refresh 彻底失效 → Http 调 tokenStore.clear() → web tokenStore 派发 'moment:auth-cleared'。
    // 登出（logout）也走这条路径收敛内存态：单一路径，不双发 auth:changed（spec §3.1）。
    window.addEventListener('moment:auth-cleared', () => {
      this.user = null;
      this.emit('auth:changed', null, 'global');
    });
    // 每次进站重拉 /me，换发 6 天头像链接（缓存里的旧签名会过期）；失败保持缓存态
    if (this.user) {
      void client.me().then((next) => this.refreshUser(next)).catch(() => undefined);
    }
  }

  applyAuth(res: AuthResponse): void {
    tokenStore.setTokens(res.tokens);
    cacheUser(res.user);
    this.user = res.user;
    this.emit('auth:changed', res.user, 'global');
  }

  async login(input: LoginInput): Promise<void> {
    this.applyAuth(await client.login(input));
  }

  async register(input: RegisterInput): Promise<void> {
    this.applyAuth(await client.register(input));
  }

  async logout(): Promise<void> {
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    tokenStore.clear(); // 派发 moment:auth-cleared → 上面的 listener 置空 + emit
  }

  refreshUser(next: UserProfile): void {
    cacheUser(next);
    this.user = next;
    this.emit('auth:changed', next, 'global');
  }
}
