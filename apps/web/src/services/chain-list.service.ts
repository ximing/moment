import { Service } from '@rabjs/react';
import type { ChainDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

/** 全局链列表（spec §3.3）：侧栏 / 首页链色表 / 发布选链共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];

  constructor() {
    super();
    // 冷启动兜底：不能只听 auth:changed——缓存登录态下 AuthService 构造不发事件、
    // me() 失败也不发，只听事件侧栏会一直空（spec §3.3）
    if (this.resolve(AuthService).user) void this.load();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) void this.load();
        else this.chains = [];
      },
      'global',
    );
    this.on('chain:changed', () => void this.load(), 'global');
  }

  async load(): Promise<void> {
    this.chains = await client.listChains();
  }
}
