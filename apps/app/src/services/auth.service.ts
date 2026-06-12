import { Service } from '@rabjs/react';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../lib/api';
import { queryClient } from '../lib/query';
import { loadUser, onAuthCleared, saveUser, secureTokenStore } from '../lib/token-store';

/** 全局认证态（spec §3）。SecureStore 异步水合 → ready 闸；事件单路径收敛在 onAuthCleared。 */
export class AuthService extends Service {
  user: UserProfile | null = null;
  ready = false;

  constructor() {
    super();
    // refresh 彻底失效（Http→tokenStore.clear()）与 logout 都走这条路径收敛内存态：
    // 单一路径，不双发 auth:changed。
    onAuthCleared(() => {
      this.user = null;
      this.ready = true;
      queryClient.clear(); // 过渡期：RQ 缓存随会话作废；Task 11 删
      this.emit('auth:changed', null, 'global');
    });
    void this.hydrate();
  }

  /** 冷启动：SecureStore 读缓存 → ready；有缓存再校验 /me 换发头像签名链接。 */
  private async hydrate(): Promise<void> {
    const stored = await loadUser();
    this.user = stored;
    this.ready = true;
    // 与 web 相反，这里必须发：ChainList/Notification 构造时 user 还是 null（异步水合未完成），
    // 不发事件它们永远不开拉（web 靠同步 localStorage 才能省这一次）
    this.emit('auth:changed', stored, 'global');
    if (!stored) return;
    try {
      const me = await client.me();
      this.refreshUser(me);
    } catch (err) {
      // 仅 401 清会话（api-client 内部 refresh 已失败并 clear() → 上面的 onAuthCleared 已置空）。
      // 网络错误（status 0）不登出：保留缓存态，飞行模式冷启动不把持有效 token 的用户踢到登录页。
      if (err instanceof ApiError && err.status === 401 && this.user) {
        await secureTokenStore.clear();
      }
    }
  }

  async applyAuth(res: AuthResponse): Promise<void> {
    // 必须先 await 落盘（SecureStore 异步），再触发任何带 token 的调用，避免读到旧/空 token
    await secureTokenStore.setTokens(res.tokens);
    await saveUser(res.user);
    queryClient.clear(); // 换会话即换缓存（过渡期；Task 11 删）
    this.user = res.user;
    this.emit('auth:changed', res.user, 'global');
  }

  async login(input: LoginInput): Promise<void> {
    await this.applyAuth(await client.login(input));
  }

  async register(input: RegisterInput): Promise<void> {
    await this.applyAuth(await client.register(input));
  }

  /** revoke 吞错；内存态收敛只走 secureTokenStore.clear() → onAuthCleared，不双发。 */
  async logout(): Promise<void> {
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) await client.logout(refreshToken).catch(() => undefined);
    await secureTokenStore.clear();
  }

  refreshUser(next: UserProfile): void {
    void saveUser(next);
    this.user = next;
    this.emit('auth:changed', next, 'global');
  }
}
