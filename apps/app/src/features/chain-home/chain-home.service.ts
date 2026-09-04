import { Service } from '@rabjs/react';
import type { AggregateResponse, ChainDetailDto, MomentResponse, SearchParsed, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildSearchInput } from '../../lib/timeline-query';
import { ChainListService } from '../../services/chain-list.service';
import type { ChainChangedPayload, CommentChangedPayload, MomentChangedPayload } from '../../lib/events';

/** 链首页段：'timeline' 主时间线 / 'tags' 标签 / 'trips' 行程分章 / 其余为 manifest.views 声明的视图 type */
export type ChainSegment = string;

/** 链首页（时间线 + 标签两段；成员/邀请/设置已挪进设置页 Task 9）。 */
export class ChainHomeService extends Service {
  chainId = '';
  chain: ChainDetailDto | null = null;
  moments: MomentResponse[] = [];
  tags: TagResponse[] = [];
  /** 当前聚合视图的投影数据（timeline/tags/trips 不用端点，为 null） */
  aggregate: AggregateResponse | null = null;
  /** 组件段切换时同步写入（段 state 留在组件 useState，加载逻辑在 service） */
  activeView = 'timeline';
  personId: string | undefined = undefined;
  personName: string | undefined = undefined;
  place: string | undefined = undefined;
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
  private nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private sectionsLoaded = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      (p: MomentChangedPayload) => {
        if (p.op === 'react') {
          void this.refreshListedMoment(p.momentId);
          return;
        }
        void this.loadFirst().catch(() => undefined);
        if (this.activeView !== 'timeline' && this.activeView !== 'tags' && this.activeView !== 'trips') {
          void this.loadAggregate().catch(() => undefined);
        }
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
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后由用户导航离开
        void this.loadChain().catch(() => undefined);
      },
      'global',
    );
  }

  /** 发布按钮角色门（spec §4）：editor 及以上可发布；角色实时读全局链列表（转让后经 chain:changed 刷新）。 */
  get canCompose(): boolean {
    const role = this.resolve(ChainListService).myRoleOf(this.chainId);
    return role === 'owner' || role === 'editor';
  }

  get filtered(): boolean {
    return Boolean(this.personId || this.place);
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.chain = null;
    this.moments = [];
    this.tags = [];
    this.aggregate = null;
    this.activeView = 'timeline';
    this.personId = undefined;
    this.personName = undefined;
    this.place = undefined;
    this.searching = false;
    this.searchQ = '';
    this.searchParsed = null;
    this.searchError = null;
    this.sectionsLoaded = false;
    void this.loadChain().catch(() => undefined);
    void this.loadFirst().catch(() => undefined);
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      this.sectionsLoaded = true;
      void this.loadTags().catch(() => undefined);
    }
  }

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
      // 单条失败不打整页
    }
  }

  async loadFirst(): Promise<void> {
    if (!this.chainId) return;
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments(
          buildSearchInput({
            q: this.searchQ,
            tzOffset: new Date().getTimezoneOffset(),
            chainIds: [this.chainId],
            limit: TIMELINE_PAGE_SIZE,
            personId: this.personId,
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
      const page = await client.listChainMoments(
        this.chainId,
        buildChainMomentsQuery({
          cursor: undefined,
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
              chainIds: [this.chainId],
              cursor: this.nextCursor,
              limit: TIMELINE_PAGE_SIZE,
              personId: this.personId,
              place: this.place,
            }),
          )
        : await client.listChainMoments(
            this.chainId,
            buildChainMomentsQuery({
              cursor: this.nextCursor,
              personId: this.personId,
              place: this.place,
              limit: TIMELINE_PAGE_SIZE,
            }),
          );
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
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

  /** 空状态「清除筛选」：去掉人物/地点。 */
  clearFilters(): void {
    this.personId = undefined;
    this.personName = undefined;
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

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
  }

  /** 时间线是否还有未加载页（trips 视图统计范围提示用，P4 H2） */
  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async addTag(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await client.createTag(this.chainId, trimmed);
    await this.loadTags();
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
  }

  /** 段切换（组件 SegmentBar onChange 时调用）：记录当前段；聚合段触发加载。 */
  setActiveView(view: string): void {
    this.activeView = view;
    this.aggregate = null;
    if (view !== 'timeline' && view !== 'tags' && view !== 'trips') {
      void this.loadAggregate().catch(() => undefined);
    }
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
