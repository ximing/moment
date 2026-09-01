import { Service } from '@rabjs/react';
import {
  SEARCH_MAX_LIMIT,
  type AggregateResponse,
  type ChainDetailDto,
  type ChainImageFocus,
  type MonthIndexEntry,
  type MomentResponse,
  type SearchParsed,
  type TagResponse,
} from '@moment/dto';
import { client } from '@/api/client';
import { CENTER_FOCUS } from '@/chain/appearance-model';
import { uploadChainImage } from '@/chain/appearance-upload';
import { humanError } from '@/lib/errors';
import { currentTzOffset } from '@/lib/time';
import { feedQuery, scrollToPageTop } from '@/lib/feed';
import {
  peekChainListSession,
  peekViewedMomentId,
  saveChainListSession,
  takeViewedMomentId,
} from '@/lib/timeline-list-session';
import type { RailFilter } from '@/timeline/timeline-rail';
import type { ChainChangedPayload, CommentChangedPayload, MomentChangedPayload } from '@/lib/events';

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
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
  /** 当前聚合视图（'timeline' = 主时间线；其余为 manifest.views 声明的 type） */
  activeView = 'timeline';
  /** 当前视图的投影数据（timeline/trips 不用端点，为 null） */
  aggregate: AggregateResponse | null = null;
  coverBusy = false;
  coverError: string | null = null;
  repositioning = false;
  repositionFocus: ChainImageFocus | null = null;
  restoredScrollY = 0;
  private gen = 0;
  private loadingMore = false;

  constructor() {
    super();
    this.adoptSession();
    this.on(
      'moment:changed',
      (p: MomentChangedPayload) => {
        if (p.op === 'react') {
          void this.refreshListedMoment(p.momentId);
          return;
        }
        void this.loadFirst();
        void this.loadMeta();
        if (this.activeView !== 'timeline' && this.activeView !== 'trips') void this.loadAggregate().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      (p: CommentChangedPayload) => {
        void this.refreshListedMoment(p.momentId);
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
    this.coverBusy = false;
    this.coverError = null;
    this.repositioning = false;
    this.repositionFocus = null;
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
    scrollToPageTop();
    void this.loadFirst().then(() => scrollToPageTop());
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

  persistSession(scrollY: number): void {
    saveChainListSession({
      chainId: this.chainId,
      chain: this.chain,
      filter: { ...this.filter },
      moments: this.moments.slice(),
      nextCursor: this.nextCursor,
      monthIndex: this.monthIndex.slice(),
      tags: this.tags.slice(),
      searching: this.searching,
      searchQ: this.searchQ,
      searchParsed: this.searchParsed,
      scrollY,
    });
  }

  adoptSession(): boolean {
    const viewed = peekViewedMomentId();
    const session = peekChainListSession();
    if (!viewed || !session?.chainId || !session.moments.length) return false;
    this.chainId = session.chainId;
    this.chain = session.chain;
    this.filter = { ...session.filter };
    this.moments = session.moments.slice();
    this.nextCursor = session.nextCursor;
    this.monthIndex = session.monthIndex.slice();
    this.tags = session.tags.slice();
    this.searching = session.searching;
    this.searchQ = session.searchQ;
    this.searchParsed = session.searchParsed;
    this.restoredScrollY = session.scrollY;
    void this.refreshListedMoment(viewed);
    queueMicrotask(() => {
      if (peekViewedMomentId() === viewed) takeViewedMomentId();
    });
    return true;
  }

  /** 点赞/评论只刷新这一条，避免 loadFirst 丢掉已翻页列表并把滚动打回顶部。 */
  async refreshListedMoment(momentId: string): Promise<void> {
    if (!momentId) return;
    const idx = this.moments.findIndex((m) => m?.id === momentId);
    if (idx === -1) return;
    try {
      const updated = await client.getMoment(momentId);
      if (!updated?.id) return;
      const next = this.moments.slice();
      if (next[idx]?.id !== momentId) return;
      next[idx] = updated;
      this.moments = next;
    } catch {
      // 单条失败不打整页；计数可能短暂旧，下次整表刷新纠正
    }
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
  }

  startReposition(): void {
    if (!this.chain?.coverMediaId && !this.chain?.coverUrl) return;
    this.repositionFocus = this.chain.coverFocus ?? CENTER_FOCUS;
    this.repositioning = true;
    this.coverError = null;
  }

  cancelReposition(): void {
    this.repositioning = false;
    this.repositionFocus = null;
  }

  setRepositionFocus(focus: ChainImageFocus): void {
    this.repositionFocus = focus;
  }

  async saveReposition(nextFocus?: ChainImageFocus): Promise<void> {
    const focus = nextFocus ?? this.repositionFocus;
    if (!focus || !this.chainId) return;
    this.coverBusy = true;
    this.coverError = null;
    try {
      await client.updateChain(this.chainId, { coverFocus: focus });
      this.repositioning = false;
      this.repositionFocus = null;
      this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
      await this.loadChain();
    } catch (err) {
      this.coverError = humanError(err);
    } finally {
      this.coverBusy = false;
    }
  }

  async replaceCover(file: File): Promise<void> {
    if (!this.chainId) return;
    this.coverBusy = true;
    this.coverError = null;
    try {
      const { mediaId } = await uploadChainImage(client, file);
      await client.updateChain(this.chainId, { coverMediaId: mediaId, coverFocus: CENTER_FOCUS });
      this.repositioning = false;
      this.repositionFocus = null;
      this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
      await this.loadChain();
    } catch (err) {
      this.coverError = humanError(err);
    } finally {
      this.coverBusy = false;
    }
  }

  async removeCover(): Promise<void> {
    if (!this.chainId) return;
    this.coverBusy = true;
    this.coverError = null;
    try {
      await client.updateChain(this.chainId, { coverMediaId: null });
      this.repositioning = false;
      this.repositionFocus = null;
      this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
      await this.loadChain();
    } catch (err) {
      this.coverError = humanError(err);
    } finally {
      this.coverBusy = false;
    }
  }

  async loadFirst(): Promise<void> {
    if (!this.chainId) return;
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments({
          q: this.searchQ,
          chainIds: [this.chainId],
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
        ? await client.searchMoments({
            q: this.searchQ,
            chainIds: [this.chainId],
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
