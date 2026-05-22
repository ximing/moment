import type { AuthorSummary, MomentResponse, ReactionSummary, TagBrief } from '@moment/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { comments, media, momentTags, reactions, tags, users, type Moment } from '../db/schema.js';

/** serializer 依赖的最小形状（db 的 Moment/Media 行结构兼容，便于事务内未落库行复用） */
export interface MomentLike {
  id: string;
  chainId: string;
  authorId: string;
  type: 'text' | 'media' | 'video';
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

/** 互动计数（spec §5.1：批量 GROUP BY 产出，禁止 N+1） */
export interface MomentInteractionCounts {
  commentCount: number;
  reactions: ReactionSummary[];
  /** 当前请求用户点的 emoji；无 viewer 上下文为 null */
  myReaction: string | null;
}

export interface SerializerExtras {
  media: MediaLike[];
  author: AuthorSummary;
  tags?: TagBrief[];
  counts?: MomentInteractionCounts;
}

/** moment → API 响应的唯一出口（CONVENTIONS §3.4）；media 只出稳定入口相对路径。 */
export function momentSerializer(m: MomentLike, extras: SerializerExtras): MomentResponse {
  return {
    id: m.id,
    chainId: m.chainId,
    author: extras.author,
    type: m.type,
    content: m.content,
    happenedAt: m.happenedAt.toISOString(),
    happenedTzOffset: m.happenedTzOffset,
    isBackfill: m.isBackfill,
    createdAt: m.createdAt.toISOString(),
    media: [...extras.media]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({
        id: x.id,
        url: `/api/media/${x.id}`,
        mime: x.mime,
        width: x.width,
        height: x.height,
        duration: x.duration,
        sortOrder: x.sortOrder,
      })),
    tags: extras.tags ?? [],
    commentCount: extras.counts?.commentCount ?? 0,
    reactions: extras.counts?.reactions ?? [],
    myReaction: extras.counts?.myReaction ?? null,
  };
}

/**
 * 批量序列化：media / author / tags / 评论数 / 表情分组 / myReaction 全部一页一次
 * IN + GROUP BY 查出（spec §5.1，严禁 N+1）。viewerId 缺省时 myReaction 恒 null。
 */
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null
): Promise<MomentResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [mediaRows, authorRows, tagRows, commentRows, reactionRows, myRows] = await Promise.all([
    db.select().from(media).where(inArray(media.momentId, ids)),
    db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))])),
    db
      .select({ momentId: momentTags.momentId, id: tags.id, name: tags.name })
      .from(momentTags)
      .innerJoin(tags, eq(tags.id, momentTags.tagId))
      .where(inArray(momentTags.momentId, ids))
      .orderBy(asc(momentTags.momentId), asc(momentTags.tagId)),
    // 软删评论不计入（spec §5.7）
    db
      .select({ momentId: comments.momentId, count: sql<number>`count(*)` })
      .from(comments)
      .where(and(inArray(comments.momentId, ids), isNull(comments.deletedAt)))
      .groupBy(comments.momentId),
    db
      .select({ momentId: reactions.momentId, emoji: reactions.emoji, count: sql<number>`count(*)` })
      .from(reactions)
      .where(inArray(reactions.momentId, ids))
      .groupBy(reactions.momentId, reactions.emoji)
      .orderBy(asc(reactions.emoji)),
    viewerId
      ? db
          .select({ momentId: reactions.momentId, emoji: reactions.emoji })
          .from(reactions)
          .where(and(inArray(reactions.momentId, ids), eq(reactions.userId, viewerId)))
      : Promise.resolve([] as { momentId: string; emoji: string }[]),
  ]);

  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push(m);
    mediaBy.set(m.momentId, list);
  }
  const authorBy = new Map(authorRows.map((a) => [a.id, a]));
  const tagsBy = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsBy.set(t.momentId, list);
  }
  const commentCountBy = new Map(commentRows.map((c) => [c.momentId, Number(c.count)]));
  const reactionBy = new Map<string, ReactionSummary[]>();
  for (const r of reactionRows) {
    const list = reactionBy.get(r.momentId) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.count) });
    reactionBy.set(r.momentId, list);
  }
  const myBy = new Map(myRows.map((r) => [r.momentId, r.emoji]));

  return rows.map((r) =>
    momentSerializer(r, {
      media: mediaBy.get(r.id) ?? [],
      author: authorBy.get(r.authorId) ?? { id: r.authorId, nickname: '' },
      tags: tagsBy.get(r.id) ?? [],
      counts: {
        commentCount: commentCountBy.get(r.id) ?? 0,
        reactions: reactionBy.get(r.id) ?? [],
        myReaction: myBy.get(r.id) ?? null,
      },
    })
  );
}
