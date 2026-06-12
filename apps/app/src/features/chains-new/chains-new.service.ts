import { Service } from '@rabjs/react';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';

/** 新建链：表单 + createChain；schema 校验（Alert）留在组件。 */
export class ChainsNewService extends Service {
  name = '';
  description = '';

  async submit(): Promise<void> {
    const c = await client.createChain({
      name: this.name,
      description: this.description || null,
      visibility: 'private',
    });
    this.emit('chain:changed', { chainId: c.id, op: 'create' }, 'global');
    void queryClient.invalidateQueries({ queryKey: qk.chains() }); // 过渡期；Task 11 删
  }
}
