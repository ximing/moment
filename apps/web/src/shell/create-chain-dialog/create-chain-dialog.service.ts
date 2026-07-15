import { Service } from '@rabjs/react';
import type { ChainColor, ChainIcon, TemplateDto } from '@moment/dto';
import { client } from '@/api/client';

/** 建链对话框（spec §4.7）：表单 + submit；开关本身是 Shell 的本地 boolean。 */
export class CreateChainDialogService extends Service {
  name = '';
  description = '';
  color: ChainColor = 'coral';
  icon: ChainIcon | null = null;
  /** 官方模板候选（scope=official）；打开对话框时加载 */
  templates: TemplateDto[] = [];
  /** 选中的模板 key（spec §0：创建时选定不可改）；默认日常生活 */
  template = 'daily';

  async submit(): Promise<string> {
    const chain = await client.createChain({
      name: this.name.trim(),
      template: this.template,
      visibility: 'private',
      description: this.description.trim() || undefined,
      color: this.color,
      icon: this.icon,
    });
    this.emit('chain:changed', { chainId: chain.id, op: 'create' }, 'global');
    return chain.id;
  }

  /** 打开对话框时调用：拉官方模板（失败静默——列表为空时选择器不渲染，仍可建 daily 链） */
  async loadTemplates(): Promise<void> {
    this.templates = await client.listTemplates('official');
  }
}
