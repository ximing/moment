import { SEARCH_DEFAULT_LIMIT, type SearchInput, type SearchResponse } from '@moment/dto';
import { Service } from 'typedi';
import { getEmbeddingProvider } from '../embedding/factory.js';
import { decodeCursor } from '../feed/cursor.js';
import { searchMomentVectors, type VectorNeighbor } from '../lancedb/repository.js';
import { serializeMoments } from '../moments/moment-serializer.js';
import { logger } from '../utils/logger.js';
import { HARD_FILTER_PREFILTER_MAX, VECTOR_CANDIDATE_LIMIT } from './constants.js';
import { parseSearchIntent } from './intent.js';
import { resolveSearchScope, type ResolvedSearch } from './resolve-scope.js';
import { decodeDistanceCursor, encodeDistanceCursor } from './search-cursor.js';
import { hasHardFilter, listSearchIds, loadSearchMoments, querySearchTimePage, type SearchSqlFilter } from './search-query.js';

function toFilter(r: ResolvedSearch, extra: Partial<SearchSqlFilter> = {}): SearchSqlFilter {
  return {
    chainIds: r.chainIds,
    personIdsByChain: r.personIdsByChain,
    personId: r.personId,
    tagId: r.tagId,
    place: r.place,
    happenedFrom: r.happenedFrom,
    happenedTo: r.happenedTo,
    wallDate: r.wallDate,
    ...extra,
  };
}

function retrievalMode(text: string): 'time' | 'like' | 'vector' {
  if (text === '') return 'time';
  return getEmbeddingProvider() ? 'vector' : 'like';
}

@Service()
export class SearchService {
  async search(userId: string, input: SearchInput): Promise<SearchResponse> {
    const parsed = await parseSearchIntent(input.q, input.tzOffset);
    const resolved = await resolveSearchScope(userId, input, parsed);
    const limit = input.limit ?? SEARCH_DEFAULT_LIMIT;
    const mode = retrievalMode(resolved.text);

    if (input.cursor) {
      if (mode === 'vector') decodeDistanceCursor(input.cursor);
      else decodeCursor('happened_at', input.cursor);
    }

    if (resolved.chainIds.length === 0) {
      return { moments: [], nextCursor: null, parsed };
    }

    if (mode === 'vector') return this.vectorSearch(userId, input, resolved, limit);
    const page = await querySearchTimePage({
      ...toFilter(resolved, { likeText: mode === 'like' ? resolved.text : undefined }),
      cursor: input.cursor,
      limit,
    });
    return {
      moments: await serializeMoments(page.rows, userId, { includePrivate: true }),
      nextCursor: page.nextCursor,
      parsed,
    };
  }

  private async vectorSearch(
    userId: string,
    input: SearchInput,
    resolved: ResolvedSearch,
    limit: number,
  ): Promise<SearchResponse> {
    const parsed = resolved.parsed;
    const empty = { moments: [] as SearchResponse['moments'], nextCursor: null as string | null, parsed };
    const provider = getEmbeddingProvider();
    if (!provider) return empty;

    const filter = toFilter(resolved);
    let prefilterIds: string[] | undefined;
    if (hasHardFilter(resolved)) {
      const ids = await listSearchIds(filter, HARD_FILTER_PREFILTER_MAX);
      if (ids.length === 0) return empty;
      if (ids.length < HARD_FILTER_PREFILTER_MAX) prefilterIds = ids;
    }

    let vector: number[];
    try {
      vector = await provider.embed({ text: resolved.text });
    } catch (err) {
      logger.warn('search query embed failed', err);
      return empty;
    }

    let neighbors: VectorNeighbor[] = [];
    try {
      neighbors = await searchMomentVectors({
        vector,
        chainIds: resolved.chainIds,
        momentIds: prefilterIds,
        limit: VECTOR_CANDIDATE_LIMIT,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'LANCE_NOT_READY') {
        logger.warn('search lance not ready');
        return empty;
      }
      throw err;
    }

    const expected = provider.modelHash();
    const matched = neighbors.filter((n) => n.modelHash === expected);
    if (matched.length !== neighbors.length) logger.warn('search dropped modelHash mismatch');
    if (matched.length === 0) {
      logger.warn('search vector candidates empty after modelHash');
      return empty;
    }

    const best = new Map<string, VectorNeighbor>();
    for (const n of matched) {
      const prev = best.get(n.momentId);
      if (!prev || n.distance < prev.distance) best.set(n.momentId, n);
    }
    let items = [...best.values()];

    if (prefilterIds === undefined) {
      const rows = await loadSearchMoments({ ...filter, momentIds: items.map((i) => i.momentId) });
      const allowed = new Set(rows.map((r) => r.id));
      items = items.filter((i) => allowed.has(i.momentId));
    }

    items.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.momentId === b.momentId) return 0;
      return a.momentId < b.momentId ? 1 : -1;
    });

    if (input.cursor) {
      const c = decodeDistanceCursor(input.cursor);
      items = items.filter((i) => i.distance > c.d || (i.distance === c.d && i.momentId < c.i));
    }

    const pageItems = items.slice(0, limit);
    const nextCursor =
      items.length > limit && pageItems[pageItems.length - 1]
        ? encodeDistanceCursor(pageItems[pageItems.length - 1].distance, pageItems[pageItems.length - 1].momentId)
        : null;

    const rows = await loadSearchMoments({ ...filter, momentIds: pageItems.map((p) => p.momentId) });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = pageItems.map((p) => byId.get(p.momentId)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    return {
      moments: await serializeMoments(ordered, userId, { includePrivate: true }),
      nextCursor,
      parsed,
    };
  }
}
