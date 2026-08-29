import { Service } from '@rabjs/react';
import { SEARCH_MAX_LIMIT, type MonthIndexEntry, type MomentResponse, type SearchParsed, type TagResponse } from '@moment/dto';
import { client } from '@/api/client';
import { currentTzOffset } from '@/lib/time';
import { feedQuery } from '@/lib/feed';
import type { RailFilter } from '@/timeline/timeline-rail';

/** 首页状态（spec §4.2）：筛选 + feed 分页 + 月份索引 + 单链标签。 */
export class FeedHomeService extends Service {
  filter: RailFilter = { order: 'happened_at' };
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  monthIndex: MonthIndexEntry[] = [];
  indexPending = false;
  tags: TagResponse[] = [];
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    void this.loadFirst();
    void this.loadMeta();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
      },
      'global',
    );
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  /** 空态分流（web-product §4 空态表）：任一筛选生效即走「没有符合条件的时刻」 */
  get filtered(): boolean {
    return Boolean(
      this.filter.tagId ||
        this.filter.chainIds?.length ||
        this.filter.order === 'created_at' ||
        this.filter.before ||
        this.filter.personId ||
        this.filter.place,
    );
  }

  setFilter(next: RailFilter): void {
    this.filter = next;
    void this.loadFirst();
    void this.loadMeta();
  }

  clearBefore(): void {
    this.setFilter({ ...this.filter, before: undefined });
  }

  clearFilters(): void {
    this.setFilter({ order: 'happened_at' });
  }

  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.filter.personId === person.id) {
      this.setFilter({ ...this.filter, personId: undefined, personName: undefined });
      return;
    }
    this.setFilter({ ...this.filter, personId: person.id, personName: person.name });
  }

  togglePlaceFilter(place: string): void {
    this.setFilter({
      ...this.filter,
      place: this.filter.place === place ? undefined : place,
    });
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

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments({
          q: this.searchQ,
          chainIds: this.filter.chainIds,
          tzOffset: currentTzOffset(),
          limit: SEARCH_MAX_LIMIT,
          personId: this.filter.personId,
          tagId: this.filter.tagId,
          place: this.filter.place,
        });
        if (gen !== this.gen) return;
        this.moments = page.moments;
        this.nextCursor = page.nextCursor ?? null;
        this.searchParsed = page.parsed;
        this.searchError = null;
        return;
      }
      const page = await client.getFeed(feedQuery(this.filter, undefined, 50));
      if (gen !== this.gen) return; // 改筛选/跳月只走 loadFirst，cursor 清掉（spec §4.1）
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
        ? await client.searchMoments({
            q: this.searchQ,
            chainIds: this.filter.chainIds,
            tzOffset: currentTzOffset(),
            cursor: this.nextCursor ?? undefined,
            limit: SEARCH_MAX_LIMIT,
            personId: this.filter.personId,
            tagId: this.filter.tagId,
            place: this.filter.place,
          })
        : await client.getFeed(feedQuery(this.filter, this.nextCursor, 50));
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** month-index（仅 happened_at 序）+ 单链标签（spec §4.2 loadMeta） */
  async loadMeta(): Promise<void> {
    this.indexPending = true;
    try {
      if (this.filter.order === 'happened_at') {
        const idx = await client.getMonthIndex({
          chainIds: this.filter.chainIds,
          tagId: this.filter.tagId,
          tzOffset: currentTzOffset(),
        });
        this.monthIndex = idx.months;
      } else {
        this.monthIndex = [];
      }
      const scopeChainId = this.filter.chainIds?.length === 1 ? this.filter.chainIds[0] : undefined;
      this.tags = scopeChainId ? (await client.listTags(scopeChainId)).tags : [];
    } finally {
      this.indexPending = false;
    }
  }
}
