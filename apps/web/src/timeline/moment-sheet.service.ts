import { Service } from '@rabjs/react';
import type { CommentDto, PublicShareMoment } from '@moment/dto';
import { client } from '@/api/client';
import type { CommentChangedPayload } from '@/lib/events';

/** 单卡状态（spec §4.8）：灯箱/评论展开/删除确认 + 评论预览（limit 20，与详情页不是同一份）。 */
export class MomentSheetService extends Service {
  lightboxIndex: number | null = null;
  showComments = false;
  confirmDel = false;
  moment: PublicShareMoment | null = null;
  preview: CommentDto[] = [];
  previewText = '';
  private loaded = false;

  hydrate(moment: PublicShareMoment): void {
    this.moment = moment;
  }

  /** 展开评论时按需拉（幂等：同卡只拉一次，后续靠 comment:changed 事件刷新） */
  async loadPreview(): Promise<void> {
    if (!this.moment || this.loaded) return;
    this.loaded = true;
    const page = await client.listComments(this.moment.id, { limit: 20 });
    this.preview = page.comments;
  }

  async refreshPreview(): Promise<void> {
    if (!this.moment || !this.loaded) return;
    const page = await client.listComments(this.moment.id, { limit: 20 });
    this.preview = page.comments;
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

  async submitPreviewComment(): Promise<void> {
    const m = this.moment!;
    const text = this.previewText.trim();
    if (!text) return;
    await client.createComment(m.id, text);
    this.previewText = '';
    this.emit('comment:changed', { momentId: m.id }, 'global');
  }

  constructor() {
    super();
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        if (this.moment && p.momentId === this.moment.id) void this.refreshPreview();
      },
      'global',
    );
  }
}
