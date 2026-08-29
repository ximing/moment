import type {
  AuthorSummary,
  MomentResponse,
  PersonBrief,
  PublicShareMoment,
  ReactionSummary,
  TagBrief,
} from '@moment/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { avatarUrlsByUserIds } from '../auth/avatar.js';
import { db } from '../db/index.js';
import { comments, media, momentPersons, momentTags, persons, reactions, tags, users, type Moment } from '../db/schema.js';

/** serializer 依赖的最小形状（db 的 Moment/Media 行结构兼容，便于事务内未落库行复用） */
export interface MomentLike {
  id: string;
  chainId: string;
  authorId: string;
  type: 'text' | 'media' | 'video' | 'voice';
  kind: string;
  payload: Record<string, unknown> | null;
  content: string;
  happenedAt: Date;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: Date;
  /** ASR 原始转写（db 行自带）；仅 voice 可能非空 */
  transcript: string | null;
  /** 转写状态；仅 voice 可能非空 */
  transcriptionStatus: 'pending' | 'done' | 'failed' | null;
}

export interface MediaLike {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
  /** 视频封面媒体行 id（db 行自带该列，类型对齐即可）；无封面为 null */
  posterMediaId: string | null;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  /** 视频封面行的 derived_status；图片行 null */
  posterDerivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
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

/**
 * moment → API 响应的唯一出口（CONVENTIONS §3.4）；media 只出稳定入口相对路径。
 * 返回公开基形 PublicShareMoment（不含 persons/place）——两键是链内私有字段，由
 * serializeMoments 在 includePrivate 路径拼接（spec §6/§8：share-album 输出零
 * persons/place 键，默认偏向安全侧）。
 */
export function momentSerializer(m: MomentLike, extras: SerializerExtras): PublicShareMoment {
  return {
    id: m.id,
    chainId: m.chainId,
    author: extras.author,
    type: m.type,
    kind: m.kind,
    payload: m.payload,
    content: m.content,
    transcript: m.transcript,
    transcriptionStatus: m.transcriptionStatus,
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
        posterMediaId: x.posterMediaId,
        posterUrl: x.posterMediaId ? `/api/media/${x.posterMediaId}` : null,
        derivedUrl: x.derivedStatus === 'ready' ? `/api/media/${x.id}?variant=derived` : null,
        posterDerivedUrl:
          x.posterMediaId && x.posterDerivedStatus === 'ready'
            ? `/api/media/${x.posterMediaId}?variant=derived`
            : null,
      })),
    tags: extras.tags ?? [],
    commentCount: extras.counts?.commentCount ?? 0,
    reactions: extras.counts?.reactions ?? [],
    myReaction: extras.counts?.myReaction ?? null,
  };
}

/** persons 批取行的最小形状（moment_persons join persons） */
interface PersonBriefRow {
  momentId: string;
  id: string;
  name: string;
  userId: string | null;
  source: 'manual' | 'ai';
}

/**
 * 批量序列化：media / author / tags / 评论数 / 表情分组 / myReaction 全部一页一次
 * IN + GROUP BY 查出（spec §5.1，严禁 N+1）。viewerId 缺省时 myReaction 恒 null。
 *
 * includePrivate（默认 false，spec §6/§8 红线）：
 * - true（链内路径：feed/时间线/详情/编辑回读）：额外按 moment ids 一次 IN 查询
 *   moment_persons join persons（对齐 tags 批取范式）再内存分组，place 从 moment 行
 *   四列拼装；输出 MomentResponse——persons/place 必有。
 * - false/缺省（公开路径：share-album）：不查人物表，输出 PublicShareMoment——
 *   persons/place 两键完全不存在。默认偏向安全侧的理由是失败模式不对称：内部调用方
 *   忘了传只是 UI 缺字段（可见易修），分享路径忘了剥离就是隐私泄漏（不可见有害）。
 */
export async function serializeMoments(
  rows: Moment[],
  viewerId: string | null | undefined,
  options: { includePrivate: true },
): Promise<MomentResponse[]>;
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null,
  options?: { includePrivate?: boolean },
): Promise<PublicShareMoment[]>;
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null,
  options: { includePrivate?: boolean } = {},
): Promise<(MomentResponse | PublicShareMoment)[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const includePrivate = options.includePrivate === true;

  const [mediaRows, authorRows, tagRows, commentRows, reactionRows, myRows, personRows] = await Promise.all([
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
    includePrivate
      ? db
          .select({
            momentId: momentPersons.momentId,
            id: persons.id,
            name: persons.name,
            userId: persons.userId,
            source: momentPersons.source,
          })
          .from(momentPersons)
          .innerJoin(persons, eq(persons.id, momentPersons.personId))
          .where(inArray(momentPersons.momentId, ids))
          .orderBy(asc(momentPersons.momentId), asc(momentPersons.personId))
      : Promise.resolve([] as PersonBriefRow[]),
  ]);

  // poster 行绑了同一 momentId 会被查出，必须从内容媒体中排除——否则以第 2 条媒体泄漏，
  // 破坏 type=video 恰 1 条视频媒体的契约。排除只存在于批量函数；单条出口消费组装结果。
  const posterIds = new Set(
    mediaRows.map((r) => r.posterMediaId).filter((id): id is string => id !== null)
  );
  const rowById = new Map(mediaRows.map((r) => [r.id, r]));
  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    if (posterIds.has(m.id)) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push({
      id: m.id,
      mime: m.mime,
      width: m.width,
      height: m.height,
      duration: m.duration,
      sortOrder: m.sortOrder,
      posterMediaId: m.posterMediaId,
      derivedStatus: m.derivedStatus,
      posterDerivedStatus: m.posterMediaId
        ? (rowById.get(m.posterMediaId)?.derivedStatus ?? null)
        : null,
    });
    mediaBy.set(m.momentId, list);
  }
  const avatarBy = await avatarUrlsByUserIds(authorRows.map((a) => a.id));
  const authorBy = new Map(
    authorRows.map((a) => [a.id, { id: a.id, nickname: a.nickname, avatarUrl: avatarBy.get(a.id) ?? null }])
  );
  const tagsBy = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsBy.set(t.momentId, list);
  }
  const personsBy = new Map<string, PersonBrief[]>();
  for (const p of personRows) {
    const list = personsBy.get(p.momentId) ?? [];
    list.push({ id: p.id, name: p.name, userId: p.userId, source: p.source });
    personsBy.set(p.momentId, list);
  }
  const commentCountBy = new Map(commentRows.map((c) => [c.momentId, Number(c.count)]));
  const reactionBy = new Map<string, ReactionSummary[]>();
  for (const r of reactionRows) {
    const list = reactionBy.get(r.momentId) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.count) });
    reactionBy.set(r.momentId, list);
  }
  const myBy = new Map(myRows.map((r) => [r.momentId, r.emoji]));

  return rows.map((r) => {
    const base = momentSerializer(r, {
      media: mediaBy.get(r.id) ?? [],
      author: authorBy.get(r.authorId) ?? { id: r.authorId, nickname: '', avatarUrl: null },
      tags: tagsBy.get(r.id) ?? [],
      counts: {
        commentCount: commentCountBy.get(r.id) ?? 0,
        reactions: reactionBy.get(r.id) ?? [],
        myReaction: myBy.get(r.id) ?? null,
      },
    });
    if (!includePrivate) return base;
    return {
      ...base,
      persons: personsBy.get(r.id) ?? [],
      // place 三列 + source 同生同灭（spec §2）：placeSource 为 null 即无地点，整体 null
      place:
        r.placeSource === null
          ? null
          : { lat: r.placeLat, lng: r.placeLng, name: r.placeName, source: r.placeSource },
    };
  });
}
