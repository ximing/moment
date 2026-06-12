import { Service } from '@rabjs/react';
import type { AcceptInviteResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';

/** 邀请接受页：terminal = 邀请失效类错误（不可重试）；成功 emit chain:changed(create)。 */
export class InviteService extends Service {
  token = '';
  result: AcceptInviteResponse | null = null;
  terminal = false;

  hydrate(token: string): void {
    this.token = token;
  }

  async submit(): Promise<void> {
    try {
      const res = await client.acceptInvite(this.token);
      this.result = res;
      this.terminal = false;
      this.emit('chain:changed', { chainId: res.chainId, op: 'create' }, 'global');
      void queryClient.invalidateQueries({ queryKey: qk.chains() }); // 过渡期；Task 11 删
    } catch (err) {
      if (err instanceof ApiError) {
        this.terminal = new Set(['INVITE_EXPIRED', 'INVITE_ALREADY_ACCEPTED', 'INVITE_EMAIL_MISMATCH']).has(err.code);
      } else {
        this.terminal = false;
      }
      throw err; // 文案留给组件 humanError
    }
  }
}
