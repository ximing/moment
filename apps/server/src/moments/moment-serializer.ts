import type { AuthorSummary, MomentMedia, MomentResponse, MomentType } from '@moment/dto';

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
  media: MediaLike[],
  author: AuthorSummary
): MomentResponse {
  return {
    id: m.id,
    chainId: m.chainId,
    author,
    type: m.type,
    content: m.content,
    happenedAt: m.happenedAt.toISOString(),
    happenedTzOffset: m.happenedTzOffset,
    isBackfill: m.isBackfill,
    createdAt: m.createdAt.toISOString(),
    media: [...media].sort((a, b) => a.sortOrder - b.sortOrder).map(serializeMedia),
  };
}
