import type { SearchInput, SearchParsed, SearchTime } from '@moment/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, persons } from '../db/schema.js';
import { getMyChains } from '../feed/membership.js';
import { normalizePersonName } from '../persons/person.service.js';

export interface ResolvedSearch {
  parsed: SearchParsed;
  chainIds: string[];
  personIdsByChain: Map<string, string[]>;
  place: string | null;
  text: string;
  happenedFrom?: string;
  happenedTo?: string;
  wallDate?: string;
  personId?: string;
  tagId?: string;
}

function padWall(t: Extract<SearchTime, { kind: 'wall_date' }>): string {
  const m = String(t.month).padStart(2, '0');
  const d = String(t.day).padStart(2, '0');
  return `${t.year}-${m}-${d}`;
}

function laterIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earlierIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

async function placeExistsInScope(scope: string[], place: string): Promise<boolean> {
  if (scope.length === 0) return false;
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(and(inArray(moments.chainId, scope), isNull(moments.deletedAt), eq(moments.placeName, place)))
    .limit(1);
  return rows.length > 0;
}

export async function resolveSearchScope(
  userId: string,
  input: SearchInput,
  parsed: SearchParsed,
): Promise<ResolvedSearch> {
  const mine = await getMyChains(userId);
  let scope = [...mine.keys()];
  if (input.chainIds) scope = input.chainIds.filter((id) => mine.has(id));

  const names = parsed.personNames.map(normalizePersonName).filter((n) => n.length > 0);

  let workText = parsed.text;
  let hardPlace: string | null = input.place ?? null;
  if (parsed.place) {
    const trimmed = parsed.place.trim().slice(0, 255);
    if (trimmed.length > 0) {
      const hit = await placeExistsInScope(scope, trimmed);
      if (hit) {
        hardPlace = input.place ?? trimmed;
      } else if (!input.place) {
        workText = workText.trim().length === 0 ? trimmed : `${workText} ${trimmed}`;
      }
    }
  }

  let happenedFrom = input.happenedFrom;
  let happenedTo = input.happenedTo;
  let wallDate: string | undefined;
  if (parsed.time?.kind === 'range') {
    happenedFrom = laterIso(happenedFrom, parsed.time.from);
    happenedTo = earlierIso(happenedTo, parsed.time.to);
  } else if (parsed.time?.kind === 'wall_date') {
    wallDate = padWall(parsed.time);
  }

  const hasOther =
    parsed.time !== null ||
    hardPlace !== null ||
    workText.trim().length > 0 ||
    Boolean(input.personId || input.tagId || input.place || input.happenedFrom || input.happenedTo);

  const personIdsByChain = new Map<string, string[]>();
  const kept: string[] = [];

  if (names.length === 0) {
    for (const id of scope) {
      kept.push(id);
      personIdsByChain.set(id, []);
    }
  } else {
    for (const chainId of scope) {
      const ids: string[] = [];
      for (const name of names) {
        const rows = await db
          .select({ id: persons.id })
          .from(persons)
          .where(and(eq(persons.chainId, chainId), eq(persons.name, name)));
        for (const row of rows) {
          if (!ids.includes(row.id)) ids.push(row.id);
        }
      }
      if (ids.length === 0 && !hasOther) continue;
      kept.push(chainId);
      personIdsByChain.set(chainId, ids);
    }
  }

  return {
    parsed,
    chainIds: kept,
    personIdsByChain,
    place: hardPlace,
    text: workText,
    happenedFrom,
    happenedTo,
    wallDate,
    personId: input.personId,
    tagId: input.tagId,
  };
}
