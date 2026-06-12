import { Service } from '@rabjs/react';
import type { MomentResponse, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { ChainListService } from '../../services/chain-list.service';

const PAGE_SIZE = 20;

/** 时间线（spec §4）：筛选 + feed 分页 + 单链标签；链 chip 读全局 ChainListService。 */
export class FeedService extends Service {
  chainId: string | undefined = undefined;
  tagId: string | undefined = undefined;
  order: 'happened_at' | 'created_at' = 'happened_at';
  moments: MomentResponse[] = [];
  tags: TagResponse[] = [];
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    void this.loadFirst().catch(() => undefined);
    void this.loadTags().catch(() => undefined);
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst().catch(() => undefined); // 评论数在 moment 上
      },
      'global',
    );
    // chain:changed 不听：链名/角色变化由 ChainListService 持有，feed 数据本身不受影响
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  private nextCursor: string | null = null;

  setChainFilter(id: string | undefined): void {
    this.chainId = id;
    this.tagId = undefined;
    void this.loadFirst().catch(() => undefined);
    void this.loadTags().catch(() => undefined);
  }

  setTagFilter(id: string | undefined): void {
    this.tagId = id;
    void this.loadFirst().catch(() => undefined);
  }

  toggleOrder(): void {
    this.order = this.order === 'happened_at' ? 'created_at' : 'happened_at';
    void this.loadFirst().catch(() => undefined);
  }

  get chainList(): { id: string; name: string }[] {
    return this.resolve(ChainListService).chains.map((c) => ({ id: c.id, name: c.name }));
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.getFeed({
      cursor: undefined,
      chainIds: this.chainId ? [this.chainId] : undefined,
      tagId: this.tagId,
      order: this.order,
      limit: PAGE_SIZE,
    });
    if (gen !== this.gen) return; // 改筛选只走 loadFirst，cursor 清掉
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.getFeed({
        cursor: this.nextCursor,
        chainIds: this.chainId ? [this.chainId] : undefined,
        tagId: this.tagId,
        order: this.order,
        limit: PAGE_SIZE,
      });
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** 单链筛选才拉标签（与旧页 enabled: chainId != null 同语义）。 */
  private async loadTags(): Promise<void> {
    if (!this.chainId) {
      this.tags = [];
      return;
    }
    this.tags = (await client.listTags(this.chainId)).tags;
  }
}
