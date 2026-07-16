import { Service } from '@rabjs/react';
import type { TemplateDto } from '@moment/dto';
import { client } from '../../lib/api';

/** 新建链：模板选择 + 表单 + createChain；schema 校验（Alert）留在组件。 */
export class ChainsNewService extends Service {
  name = '';
  description = '';
  /** 官方模板候选（scope=official）；进入页面时加载 */
  templates: TemplateDto[] = [];
  /** 选中的模板 key（spec §0：创建时选定不可改）；默认日常生活 */
  template = 'daily';

  /** 进入页面时调用：拉官方模板（失败静默——选择器不渲染，仍可建 daily 链） */
  async loadTemplates(): Promise<void> {
    this.templates = await client.listTemplates('official');
  }

  async submit(): Promise<void> {
    const c = await client.createChain({
      name: this.name,
      description: this.description || null,
      visibility: 'private',
      template: this.template,
    });
    this.emit('chain:changed', { chainId: c.id, op: 'create' }, 'global');
  }
}
