import { Service } from '@rabjs/react';
import { client } from '../../lib/api';

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
  }
}
