import { Service } from '@rabjs/react';
import type { ChainColor, ChainIcon } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { queryClient } from '@/api/query-client';

/** 建链对话框（spec §4.7）：表单 + submit；开关本身是 Shell 的本地 boolean。 */
export class CreateChainDialogService extends Service {
  name = '';
  description = '';
  color: ChainColor = 'coral';
  icon: ChainIcon | null = null;

  async submit(): Promise<string> {
    const chain = await client.createChain({
      name: this.name.trim(),
      visibility: 'private',
      description: this.description.trim() || undefined,
      color: this.color,
      icon: this.icon,
    });
    queryClient.invalidateQueries({ queryKey: qk.chains }); // 过渡期（Task 14 摘）
    this.emit('chain:changed', { chainId: chain.id, op: 'create' }, 'global');
    return chain.id;
  }
}
