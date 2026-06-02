import { and, eq, inArray } from 'drizzle-orm';
import { Container } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains, comments, media, moments, users } from '../db/schema.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  NOTIFICATION_COMMENT_CREATED,
  NOTIFICATION_MOMENT_CREATED,
  NOTIFICATION_REACTION_CREATED,
} from '../notifications/types.js';
import type { PushService } from '../push/push-service.js';

export type OutboxHandler = (payload: Record<string, unknown>, deps: { push: PushService }) => Promise<void>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** moment 文本摘要（payload 快照用，spec §3：删除后通知仍可展示） */
function summarize(content: string, max = 50): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

/** 快照三件套：链名 + 行为人昵称 + 摘要（一次 IN 查询）。 */
async function loadSnapshot(chainId: string, actorIds: string[]): Promise<{
  chainName: string;
  nicknames: Map<string, string>;
}> {
  const [chain] = await db.select({ name: chains.name }).from(chains).where(eq(chains.id, chainId)).limit(1);
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  return { chainName: chain?.name ?? '', nicknames: new Map(actorRows.map((a) => [a.id, a.nickname])) };
}

function notificationService(): NotificationService {
  return Container.get(NotificationService);
}

/** moment.created：链全体成员（除作者）。is_backfill=true 跳过 push 但仍插通知（spec §5.6/§5.4）。 */
export const handleMomentCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);
  const isBackfill = payload.isBackfill === true;

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return; // 已删：通知不补发

  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId).filter((uid) => uid !== authorId);
  if (targets.length === 0) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_MOMENT_CREATED,
    payload: {
      momentId,
      chainId,
      chainName,
      actorNickname,
      summary: summarize(m.content),
      backfill: isBackfill,
      title: chainName || '时刻',
      body: `${actorNickname} 发布了新动态：${summarize(m.content, 30)}`,
      data: { momentId, chainId },
    },
    push: !isBackfill,
  });
};

/** comment.created：仅 moment 作者（评论者本人不通知，spec §5.4）。 */
export const handleCommentCreated: OutboxHandler = async (payload, deps) => {
  const commentId = str(payload.commentId);
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === authorId) return;

  const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!c || c.deletedAt) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_COMMENT_CREATED,
    payload: {
      momentId,
      chainId,
      commentId,
      chainName,
      actorNickname,
      summary: summarize(c.content),
      title: chainName || '时刻',
      body: `${actorNickname} 评论了你的时刻：${summarize(c.content, 30)}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/** reaction.created：仅 moment 作者（本人不通知）。 */
export const handleReactionCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const userId = str(payload.userId);
  const emoji = str(payload.emoji);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === userId) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [userId]);
  const actorNickname = nicknames.get(userId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_REACTION_CREATED,
    payload: {
      momentId,
      chainId,
      emoji,
      chainName,
      actorNickname,
      title: chainName || '时刻',
      body: `${actorNickname} 给你的时刻点了 ${emoji}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/**
 * moment.deleted：只把该 moment 的 ready media 标记为 orphaned（幂等），不物理删——
 * 物理清理由 sweeper 按 30 天保留期执行（spec §5.5「sweeper 延迟物理清理」）。
 */
export const handleMomentDeleted: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;
  await db
    .update(media)
    .set({ status: 'orphaned' })
    .where(and(eq(media.momentId, momentId), eq(media.status, 'ready')));
};

/** 注册表：processor 按 outbox.type 分发。 */
export const handlers: Record<string, OutboxHandler> = {
  'moment.created': handleMomentCreated,
  'comment.created': handleCommentCreated,
  'reaction.created': handleReactionCreated,
  'moment.deleted': handleMomentDeleted,
};
