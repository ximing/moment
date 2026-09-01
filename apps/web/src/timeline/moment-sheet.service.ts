import { Service } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';
import { client } from '@/api/client';

/** 单卡状态：灯箱 / 删除确认。网格不展开评论、不拉预览。 */
export class MomentSheetService extends Service {
  lightboxIndex: number | null = null;
  confirmDel = false;
  moment: PublicShareMoment | null = null;

  hydrate(moment: PublicShareMoment): void {
    this.moment = moment;
  }

  async react(emoji: string): Promise<void> {
    const m = this.moment!;
    if (m.myReaction === emoji) await client.removeReaction(m.id);
    else await client.setReaction(m.id, emoji);
    this.emit('moment:changed', { momentId: m.id, chainId: m.chainId, op: 'react' }, 'global');
  }

  async remove(): Promise<void> {
    const m = this.moment!;
    await client.deleteMoment(m.id);
    this.confirmDel = false;
    this.emit('moment:changed', { momentId: m.id, chainId: m.chainId, op: 'delete' }, 'global');
  }
}
