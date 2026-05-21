import type { AuthorSummary, MomentMedia, MomentResponse, MomentType, TagBrief } from '@moment/dto';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, momentTags, tags, users, type Moment } from '../db/schema.js';

/** serializer 依赖的最小形状（db 的 Moment/Media 行结构兼容，便于事务内未落库行复用） */
export interface MomentLike {
  id: string;
  chainId: string;
  authorId: string;
  type: MomentType;
  content: string;
  happenedAt: Date;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: Date;
}

export interface MediaLike {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
}

function serializeMedia(m: MediaLike): MomentMedia {
  // 唯一出口约定：media 只出稳定入口相对路径，绝不内嵌预签名 URL（CONVENTIONS §3.4）
  return {
    id: m.id,
    url: `/api/media/${m.id}`,
    mime: m.mime,
    width: m.width,
    height: m.height,
    duration: m.duration,
    sortOrder: m.sortOrder,
  };
}

/** moment → API 响应的唯一出口；Phase 4/5 在此扩展批量计数等，不得另建序列化路径。 */
export function momentSerializer(
  m: MomentLike,
  extras: { tags?: TagBrief[]; media?: MediaLike[]; author?: AuthorSummary } = {},
): MomentResponse {
  return {
    id: m.id,
    chainId: m.chainId,
    author: extras.author ?? { id: m.authorId, nickname: '' },
    type: m.type,
    content: m.content,
    happenedAt: m.happenedAt.toISOString(),
    happenedTzOffset: m.happenedTzOffset,
    isBackfill: m.isBackfill,
    createdAt: m.createdAt.toISOString(),
    media: [...(extras.media ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(serializeMedia),
    tags: extras.tags ?? [],
  };
}

/** 批量序列化：一次查出所有涉及 moment 的 tag（CONVENTIONS §3.4 唯一出口，Phase 5 在此加批量计数）。 */
export async function serializeMoments(rows: Moment[]): Promise<MomentResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const tagRows = await db
    .select({ momentId: momentTags.momentId, id: tags.id, name: tags.name })
    .from(momentTags)
    .innerJoin(tags, eq(tags.id, momentTags.tagId))
    .where(inArray(momentTags.momentId, ids))
    // MySQL 不保证无 ORDER BY 的返回顺序：显式排序保证每个 moment 的 tags 顺序确定（tagId 升序）
    .orderBy(asc(momentTags.momentId), asc(momentTags.tagId));
  const byMoment = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = byMoment.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    byMoment.set(t.momentId, list);
  }

  const mediaRows = await db
    .select()
    .from(media)
    .where(inArray(media.momentId, ids));
  const mediaByMoment = new Map<string, typeof mediaRows>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    const list = mediaByMoment.get(m.momentId) ?? [];
    list.push(m);
    mediaByMoment.set(m.momentId, list);
  }

  const authorRows = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))]));
  const authorById = new Map(authorRows.map((a) => [a.id, a]));

  return rows.map((r) =>
    momentSerializer(r, {
      tags: byMoment.get(r.id) ?? [],
      media: mediaByMoment.get(r.id) ?? [],
      author: authorById.get(r.authorId) ?? { id: r.authorId, nickname: '' },
    })
  );
}
