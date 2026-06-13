import { Service } from '@rabjs/react';
import type { CommentDto, MomentResponse } from '@moment/dto';
import { client } from '../../lib/api';
import type { CommentChangedPayload, MomentChangedPayload } from '../../lib/events';

/** 详情页状态：moment + 评论分页 + 草稿。写成功 emit，不直接拉别人的缓存。 */
export class MomentPageService extends Service {
  momentId = '';
  moment: MomentResponse | null = null;
  deleted = false; // 收到本条 delete 事件：页面显示「没有这条」（区别于加载失败）
  comments: CommentDto[] = [];
  nextCursor: string | null = null;
  draft = '';
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      (p: MomentChangedPayload) => {
        if (p.momentId !== this.momentId) return;
        if (p.op === 'delete') {
          this.moment = null;
          this.deleted = true;
          return;
        }
        void this.loadMoment();
      },
      'global',
    );
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        if (p.momentId !== this.momentId) return;
        void this.loadFirstComments();
        void this.loadMoment(); // 刷新评论数
      },
      'global',
    );
  }

  /** 路由 param 进来；幂等挡双调用 */
  hydrate(momentId: string): void {
    if (this.momentId === momentId) return;
    this.momentId = momentId;
    this.moment = null;
    this.deleted = false;
    this.comments = [];
    this.nextCursor = null;
    void this.loadMoment();
    void this.loadFirstComments();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadMoment(): Promise<void> {
    const m = await client.getMoment(this.momentId);
    this.moment = m;
  }

  async loadFirstComments(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listComments(this.momentId, { cursor: undefined, limit: 50 });
    if (gen !== this.gen) return; // 过期响应丢弃
    this.comments = page.comments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMoreComments(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listComments(this.momentId, { cursor: this.nextCursor, limit: 50 });
      if (gen !== this.gen) return;
      this.comments = [...this.comments, ...page.comments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async submitComment(): Promise<void> {
    const text = this.draft.trim();
    if (!text) return;
    await client.createComment(this.momentId, text);
    this.draft = '';
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
  }

  async deleteComment(id: string): Promise<void> {
    await client.deleteComment(id);
    this.emit('comment:changed', { momentId: this.momentId }, 'global');
  }

  /** emoji null = 取消自己的表情；成功 emit moment:changed(op:'react')。 */
  async setReaction(emoji: string | null): Promise<void> {
    const chainId = this.moment?.chainId ?? '';
    if (emoji === null) await client.removeReaction(this.momentId);
    else await client.setReaction(this.momentId, emoji);
    this.emit('moment:changed', { momentId: this.momentId, chainId, op: 'react' }, 'global');
    void this.loadMoment(); // 本页即时刷新计数
  }
}
