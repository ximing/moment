import { z } from 'zod';

/**
 * 表情白名单（spec §3 reactions.emoji varchar(16)）：所有端共享的唯一常量来源，
 * 白名单外 emoji 在 dto 层即被拒绝（VALIDATION_ERROR）。
 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🥰', '👏', '💪', '🙏'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const reactionInputSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});
export type ReactionInput = z.infer<typeof reactionInputSchema>;

export const createCommentInputSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export interface CommentDto {
  id: string;
  momentId: string;
  author: { id: string; nickname: string; avatarUrl: string | null };
  content: string;
  /** ISO 8601；软删评论不出现在列表，无 deletedAt 字段 */
  createdAt: string;
}

/** 评论列表分页（升序旧→新，游标 {t,i} 语义见 server 端 comment-cursor.ts） */
export interface CommentListResponse {
  comments: CommentDto[];
  nextCursor: string | null;
}

/** moment 上按 emoji 分组的表情计数（serializeMoments 批量产出） */
export interface ReactionSummary {
  emoji: string;
  count: number;
}
