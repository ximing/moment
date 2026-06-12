import { Service } from '@rabjs/react';
import type { ChainDto, ChainRole, UserProfile } from '@moment/dto';
import { client } from '../lib/api';
import { AuthService } from './auth.service';

/** 全局链列表：链 tab / 时间线链色 chip / 发布选链 / 角色判断共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];

  constructor() {
    super();
    // 兜底：auth:changed（AuthService hydrate 完成会发）是主通道
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

  /** 当前用户在某链的角色（未拉到/非成员 undefined）——chain-home/设置页据此控权。 */
  myRoleOf(chainId: string): ChainRole | undefined {
    return this.chains.find((c) => c.id === chainId)?.myRole;
  }
}
