import { Service } from '@rabjs/react';
import { INTENT_MAX_QUERY_CHARS, type MomentResponse, type SearchParsed } from '@moment/dto';
import { client } from '../../lib/api';
import { TIMELINE_PAGE_SIZE, buildSearchInput } from '../../lib/timeline-query';
import type { CommentChangedPayload, MomentChangedPayload } from '../../lib/events';
import { ChainListService } from '../../services/chain-list.service';

/** 独立搜索页：时刻流进此页搜全部链；单链进此页只搜该 chainId。 */
export class SearchService extends Service {
  chainId: string | undefined = undefined;
  q = '';
  hasSubmitted = false;
  moments: MomentResponse[] = [];
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
  personId: string | undefined = undefined;
  personName: string | undefined = undefined;
  place: string | undefined = undefined;
  private ready = false;
  private gen = 0;
  private loadingMore = false;
  private nextCursor: string | null = null;

  constructor() {
    super();
    this.on(
      'moment:changed',
      (p: MomentChangedPayload) => {
        if (p.op === 'react') {
          void this.refreshListedMoment(p.momentId);
          return;
        }
        if (this.hasSubmitted) void this.submit(this.q).catch(() => undefined);
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
  }

  get scopeName(): string {
    if (!this.chainId) return '搜索';
    return this.resolve(ChainListService).chains.find((c) => c.id === this.chainId)?.name ?? '搜索';
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  hydrate(chainId: string | undefined): void {
    const next = chainId && chainId.length > 0 ? chainId : undefined;
    if (this.ready && this.chainId === next) return;
    this.chainId = next;
    this.ready = true;
    this.reset();
  }

  reset(): void {
    this.q = '';
    this.hasSubmitted = false;
    this.moments = [];
    this.searchParsed = null;
    this.searchError = null;
    this.personId = undefined;
    this.personName = undefined;
    this.place = undefined;
    this.nextCursor = null;
    this.gen += 1;
  }

  clearQuery(): void {
    this.q = '';
    this.hasSubmitted = false;
    this.moments = [];
    this.searchParsed = null;
    this.searchError = null;
    this.nextCursor = null;
    this.gen += 1;
  }

  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.personId === person.id) {
      this.personId = undefined;
      this.personName = undefined;
    } else {
      this.personId = person.id;
      this.personName = person.name;
    }
    if (this.hasSubmitted) void this.submit(this.q).catch(() => undefined);
  }

  togglePlaceFilter(place: string): void {
    this.place = this.place === place ? undefined : place;
    if (this.hasSubmitted) void this.submit(this.q).catch(() => undefined);
  }

  clearPersonFilter(): void {
    this.personId = undefined;
    this.personName = undefined;
    if (this.hasSubmitted) void this.submit(this.q).catch(() => undefined);
  }

  clearPlaceFilter(): void {
    this.place = undefined;
    if (this.hasSubmitted) void this.submit(this.q).catch(() => undefined);
  }

  async submit(q: string): Promise<void> {
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    this.q = trimmed;
    this.hasSubmitted = true;
    this.searchParsed = null;
    this.searchError = null;
    const gen = ++this.gen;
    try {
      const page = await client.searchMoments(
        buildSearchInput({
          q: trimmed,
          tzOffset: new Date().getTimezoneOffset(),
          chainIds: this.chainId ? [this.chainId] : undefined,
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
    } catch (err) {
      if (gen !== this.gen) return;
      this.searchError = err;
    }
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore || !this.hasSubmitted) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.searchMoments(
        buildSearchInput({
          q: this.q,
          tzOffset: new Date().getTimezoneOffset(),
          chainIds: this.chainId ? [this.chainId] : undefined,
          cursor: this.nextCursor,
          limit: TIMELINE_PAGE_SIZE,
          personId: this.personId,
          place: this.place,
        }),
      );
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
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
}
