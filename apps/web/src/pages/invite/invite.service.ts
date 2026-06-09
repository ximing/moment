import { Service } from '@rabjs/react';
import { client } from '@/api/client';

/** 邀请接受页（spec §4.5）：已登录才可 accept；成功 emit chain:changed，不 applyAuth（邀请不换会话）。 */
export class InviteService extends Service {
  token = '';

  hydrate(token: string): void {
    this.token = token;
  }

  async accept(): Promise<string> {
    const res = await client.acceptInvite(this.token);
    this.emit('chain:changed', { chainId: res.chainId, op: 'create' }, 'global');
    return res.chainId;
  }
}
