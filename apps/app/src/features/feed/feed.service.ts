import { Service } from '@rabjs/react';
import type { MomentResponse, SearchParsed, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { TIMELINE_PAGE_SIZE, buildFeedQuery, buildSearchInput } from '../../lib/timeline-query';
import { ChainListService } from '../../services/chain-list.service';

/** 时间线（spec §4）：筛选 + feed 分页 + 单链标签；链 chip 读全局 ChainListService。 */
export class FeedService extends Service {
  chainId: string | undefined = undefined;
  tagId: string | undefined = undefined;
  order: 'happened_at' | 'created_at' = 'happened_at';
  moments: MomentResponse[] = [];
  tags: TagResponse[] = [];
  /** RailFilter.personId 投影（spec §7.1）；单选。personName 仅清除 chip 展示，不进 HTTP */
  personId: string | undefined = undefined;
  personName: string | undefined = undefined;
  /** RailFilter.place 投影；整串等值 */
  place: string | undefined = undefined;
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
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

  get filtered(): boolean {
    return Boolean(
      this.chainId || this.tagId || this.order === 'created_at' || this.personId || this.place,
    );
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  private nextCursor: string | null = null;

  setChainFilter(id: string | undefined): void {
    this.chainId = id;
    this.tagId = undefined;
    this.personId = undefined;
    this.personName = undefined;
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

  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.personId === person.id) {
      this.personId = undefined;
      this.personName = undefined;
    } else {
      this.personId = person.id;
      this.personName = person.name;
    }
    void this.loadFirst().catch(() => undefined);
  }

  togglePlaceFilter(place: string): void {
    this.place = this.place === place ? undefined : place;
    void this.loadFirst().catch(() => undefined);
  }

  clearPersonFilter(): void {
    this.personId = undefined;
    this.personName = undefined;
    void this.loadFirst().catch(() => undefined);
  }

  clearPlaceFilter(): void {
    this.place = undefined;
    void this.loadFirst().catch(() => undefined);
  }

  async submitSearch(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    this.searchQ = trimmed;
    this.searching = true;
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }

  async exitSearch(): Promise<void> {
    this.searching = false;
    this.searchQ = '';
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }

  get chainList(): { id: string; name: string }[] {
    return this.resolve(ChainListService).chains.map((c) => ({ id: c.id, name: c.name }));
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments(
          buildSearchInput({
            q: this.searchQ,
            tzOffset: new Date().getTimezoneOffset(),
            chainIds: this.chainId ? [this.chainId] : undefined,
            limit: TIMELINE_PAGE_SIZE,
            personId: this.personId,
            tagId: this.tagId,
            place: this.place,
          }),
        );
        if (gen !== this.gen) return;
        this.moments = page.moments;
        this.nextCursor = page.nextCursor ?? null;
        this.searchParsed = page.parsed;
        this.searchError = null;
        return;
      }
      const page = await client.getFeed(
        buildFeedQuery({
          cursor: undefined,
          chainId: this.chainId,
          tagId: this.tagId,
          order: this.order,
          personId: this.personId,
          place: this.place,
          limit: TIMELINE_PAGE_SIZE,
        }),
      );
      if (gen !== this.gen) return;
      this.moments = page.moments;
      this.nextCursor = page.nextCursor ?? null;
    } catch (err) {
      if (gen !== this.gen) return;
      if (this.searching) this.searchError = err;
      else throw err;
    }
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = this.searching
        ? await client.searchMoments(
            buildSearchInput({
              q: this.searchQ,
              tzOffset: new Date().getTimezoneOffset(),
              chainIds: this.chainId ? [this.chainId] : undefined,
              cursor: this.nextCursor,
              limit: TIMELINE_PAGE_SIZE,
              personId: this.personId,
              tagId: this.tagId,
              place: this.place,
            }),
          )
        : await client.getFeed(
            buildFeedQuery({
              cursor: this.nextCursor,
              chainId: this.chainId,
              tagId: this.tagId,
              order: this.order,
              personId: this.personId,
              place: this.place,
              limit: TIMELINE_PAGE_SIZE,
            }),
          );
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
      // 搜索翻页不覆盖首页 searchParsed（后一页 parsed 可能漂移）
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
