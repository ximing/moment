import { Service } from '@rabjs/react';
import type { AggregateResponse, ChainDetailDto, MonthIndexEntry, MomentResponse, TagResponse } from '@moment/dto';
import { client } from '@/api/client';
import { currentTzOffset } from '@/lib/time';
import { feedQuery } from '@/lib/feed';
import type { RailFilter } from '@/timeline/timeline-rail';
import type { ChainChangedPayload } from '@/lib/events';

/** 链页状态（spec §4.3）：getFeed 恒带 chainIds:[chainId]；hydrate 由路由 param 驱动。 */
export class ChainHomeService extends Service {
  chainId = '';
  chain: ChainDetailDto | null = null;
  filter: RailFilter = { order: 'happened_at' };
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  monthIndex: MonthIndexEntry[] = [];
  indexPending = false;
  tags: TagResponse[] = [];
  /** 当前聚合视图（'timeline' = 主时间线；其余为 manifest.views 声明的 type） */
  activeView = 'timeline';
  /** 当前视图的投影数据（timeline/trips 不用端点，为 null） */
  aggregate: AggregateResponse | null = null;
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst();
        void this.loadMeta();
        if (this.activeView !== 'timeline' && this.activeView !== 'trips') void this.loadAggregate().catch(() => undefined);
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
    this.on('chain:changed', (p: ChainChangedPayload) => {
      if (p.chainId !== this.chainId) return;
      if (p.op === 'delete') return; // 删除后由用户导航离开
      void this.loadChain();
    }, 'global');
  }

  /** 路由 param 进来（spec §4.3）：强制 filter 不含其它 chainIds；幂等挡 StrictMode */
  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.chain = null;
    this.filter = { order: 'happened_at', chainIds: [chainId] };
    this.moments = [];
    this.activeView = 'timeline';
    this.aggregate = null;
    void this.loadChain();
    void this.loadFirst();
    void this.loadMeta();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  get filtered(): boolean {
    return Boolean(
      this.filter.tagId || this.filter.order === 'created_at' || this.filter.before || this.filter.personId || this.filter.place,
    );
  }

  setFilter(next: RailFilter): void {
    this.filter = { ...next, chainIds: [this.chainId] }; // 恒定本链
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

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
  }

  async loadFirst(): Promise<void> {
    if (!this.chainId) return;
    const gen = ++this.gen;
    const page = await client.getFeed(feedQuery(this.filter, undefined, 50));
    if (gen !== this.gen) return;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.getFeed(feedQuery(this.filter, this.nextCursor, 50));
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async loadMeta(): Promise<void> {
    if (!this.chainId) return;
    this.indexPending = true;
    try {
      if (this.filter.order === 'happened_at') {
        const idx = await client.getMonthIndex({
          chainIds: [this.chainId],
          tagId: this.filter.tagId,
          tzOffset: currentTzOffset(),
        });
        this.monthIndex = idx.months;
      } else {
        this.monthIndex = [];
      }
      this.tags = (await client.listTags(this.chainId)).tags;
    } finally {
      this.indexPending = false;
    }
  }

  /** 切视图（链眉下 tab）。tab id 约定见 Produces：'timeline' 主时间线 / 'trips' 行程分章 / 其余为视图 type。 */
  setActiveView(view: string): void {
    this.activeView = view;
    this.aggregate = null;
    if (view !== 'timeline' && view !== 'trips') void this.loadAggregate().catch(() => undefined);
  }

  async loadAggregate(): Promise<void> {
    const manifest = this.chain?.templateManifest;
    const viewDef = (manifest?.views ?? []).find((v) => v.type === this.activeView);
    if (!this.chainId || !viewDef) return;
    if (viewDef.type === 'timeline') return; // groupBy 分章走已加载 moments，不打端点
    this.aggregate = await client.getAggregate(this.chainId, {
      view: viewDef.type,
      kind: viewDef.source?.kind,
      field: viewDef.source?.field,
    });
  }
}
