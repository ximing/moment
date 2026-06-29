import { Service } from '@rabjs/react';
import type { CommentDto, MomentResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
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
        void this.loadMoment().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        if (p.momentId !== this.momentId) return;
        void this.loadFirstComments().catch(() => undefined);
        void this.loadMoment().catch(() => undefined); // 刷新评论数
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
    void this.loadMoment().catch(() => undefined);
    void this.loadFirstComments().catch(() => undefined);
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

  /** 删除本条 → emit moment:changed(op:'delete')（本页构造器监听器据此置 deleted 占位；
   *  组件在成功回调里 router.back()——作者刚删的是本页目标，回退比停留占位更顺，spec §3）。
   *  重试幂等（spec §5）：首次成功但响应丢失后重试会收 404/410，按已删除处理（照常 emit），不报错。 */
  async deleteMoment(): Promise<void> {
    const chainId = this.moment?.chainId ?? '';
    try {
      await client.deleteMoment(this.momentId);
    } catch (err) {
      const gone = err instanceof ApiError && (err.code === 'MOMENT_NOT_FOUND' || err.code === 'MOMENT_DELETED');
      if (!gone) throw err;
    }
    this.emit('moment:changed', { momentId: this.momentId, chainId, op: 'delete' }, 'global');
  }

  /** emoji null = 取消自己的表情；成功 emit moment:changed(op:'react')。 */
  async setReaction(emoji: string | null): Promise<void> {
    const chainId = this.moment?.chainId ?? '';
    if (emoji === null) await client.removeReaction(this.momentId);
    else await client.setReaction(this.momentId, emoji);
    this.emit('moment:changed', { momentId: this.momentId, chainId, op: 'react' }, 'global');
    void this.loadMoment().catch(() => undefined); // 本页即时刷新计数
  }
}
