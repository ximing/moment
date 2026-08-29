import { and, desc, eq, gte, inArray, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { momentPersons, moments, momentTags, persons, type Moment } from '../db/schema.js';
import { decodeCursor, encodeCursor } from '../feed/cursor.js';
import { likeContains } from './like.js';

export interface SearchSqlFilter {
  chainIds: string[];
  personIdsByChain: Map<string, string[]>;
  personId?: string;
  tagId?: string;
  place?: string | null;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
  likeText?: string;
  momentIds?: string[];
}

export function hasHardFilter(resolved: {
  personIdsByChain: Map<string, string[]>;
  place: string | null;
  personId?: string;
  tagId?: string;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
}): boolean {
  for (const ids of resolved.personIdsByChain.values()) {
    if (ids.length > 0) return true;
  }
  return Boolean(
    resolved.place ||
      resolved.personId ||
      resolved.tagId ||
      resolved.happenedFrom ||
      resolved.happenedTo ||
      resolved.wallDate,
  );
}

function personSemiJoin(personId: string): SQL {
  return inArray(
    moments.id,
    db.select({ id: momentPersons.momentId }).from(momentPersons).where(eq(momentPersons.personId, personId)),
  ) as SQL;
}

function buildConditions(filter: SearchSqlFilter): SQL[] {
  const conditions: SQL[] = [isNull(moments.deletedAt)];
  const chainParts: SQL[] = [];
  for (const chainId of filter.chainIds) {
    const pids = filter.personIdsByChain.get(chainId) ?? [];
    const parts: SQL[] = [eq(moments.chainId, chainId)];
    for (const pid of pids) parts.push(personSemiJoin(pid));
    chainParts.push(and(...parts) as SQL);
  }
  if (chainParts.length === 1) conditions.push(chainParts[0]);
  else if (chainParts.length > 1) conditions.push(or(...chainParts) as SQL);

  if (filter.place) conditions.push(eq(moments.placeName, filter.place));
  if (filter.happenedFrom) conditions.push(gte(moments.happenedAt, new Date(filter.happenedFrom)));
  if (filter.happenedTo) conditions.push(lte(moments.happenedAt, new Date(filter.happenedTo)));
  if (filter.wallDate) conditions.push(eq(moments.wallDate, filter.wallDate));
  if (filter.tagId) {
    conditions.push(
      inArray(
        moments.id,
        db.select({ id: momentTags.momentId }).from(momentTags).where(eq(momentTags.tagId, filter.tagId)),
      ) as SQL,
    );
  }
  if (filter.personId) conditions.push(personSemiJoin(filter.personId));
  if (filter.momentIds) conditions.push(inArray(moments.id, filter.momentIds));
  if (filter.likeText) {
    conditions.push(
      or(
        likeContains(moments.content, filter.likeText),
        likeContains(moments.transcript, filter.likeText),
        likeContains(moments.placeName, filter.likeText),
        inArray(
          moments.id,
          db
            .select({ id: momentPersons.momentId })
            .from(momentPersons)
            .innerJoin(persons, eq(persons.id, momentPersons.personId))
            .where(likeContains(persons.name, filter.likeText)),
        ),
      ) as SQL,
    );
  }
  return conditions;
}

export async function listSearchIds(filter: SearchSqlFilter, cap: number): Promise<string[]> {
  if (filter.chainIds.length === 0) return [];
  if (filter.momentIds && filter.momentIds.length === 0) return [];
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(and(...buildConditions(filter)))
    .limit(cap);
  return rows.map((r) => r.id);
}

export async function loadSearchMoments(filter: SearchSqlFilter): Promise<Moment[]> {
  if (filter.chainIds.length === 0) return [];
  if (filter.momentIds && filter.momentIds.length === 0) return [];
  return db
    .select()
    .from(moments)
    .where(and(...buildConditions(filter)));
}

export async function querySearchTimePage(
  filter: SearchSqlFilter & { cursor?: string; limit: number },
): Promise<{ rows: Moment[]; nextCursor: string | null }> {
  const cursor = filter.cursor ? decodeCursor('happened_at', filter.cursor) : undefined;
  if (filter.chainIds.length === 0) return { rows: [], nextCursor: null };

  const conditions = buildConditions(filter);
  if (cursor) {
    const cursorTime = new Date(cursor.time);
    conditions.push(
      or(lt(moments.happenedAt, cursorTime), and(eq(moments.happenedAt, cursorTime), lt(moments.id, cursor.id))) as SQL,
    );
  }

  const rows = await db
    .select()
    .from(moments)
    .where(and(...conditions))
    .orderBy(desc(moments.happenedAt), desc(moments.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor('happened_at', last.happenedAt.getTime(), last.id) : null;
  return { rows: page, nextCursor };
}
