import { and, eq, inArray } from 'drizzle-orm';
import { Container } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains, comments, media, moments, recaps, users } from '../db/schema.js';
import { getLLMProvider } from '../llm/factory.js';
import { generateRecap } from '../llm/recap/generate.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  NOTIFICATION_COMMENT_CREATED,
  NOTIFICATION_MOMENT_CREATED,
  NOTIFICATION_REACTION_CREATED,
  NOTIFICATION_RECAP_READY,
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

/**
 * recap.generate（spec §1）：调 generateRecap 生成回顾，成功后扇出 recap.ready 通知。
 *
 * 重试分类现由 generateRecap 内部处理（p3）：
 * - NonRetryableLLMError：generateRecap 自己落 failed 行后正常返回（不 rethrow，让 outbox 标 done，
 *   避免占 processor 5 次退避额度——见 p3 generate.ts，与 parse 失败同范式）。
 * - RetryableLLMError：generateRecap 不 catch，传播给 handler → processor 退避。
 * 故 handler 不再 try/catch，只负责 fanout。
 *
 * provider 为 null（空 key 停用）时**不再 no-op 跳过**：自动 sweep 已在空 key 时 skip 派发
 * （recap-scheduler.ts，spec §3「扫描照常但跳过派发」），故 handler 正常不会收到 null provider。
 * null 到达 handler 的唯一场景：手动 regenerate API（POST .../regenerate）在空 key 部署触发 outbox。
 * 此时 generateRecap 走降级路径（规则文案，不调 LLM，无内容出域，spec §5）+ 扇出——用户显式请求回顾时
 * 给降级版是合理 UX。retryable 传播给 processor 退避。
 *
 * handler 内直接 fanoutNotifications（对齐 handleMomentCreated 范式，非 spec §1 的「第二条 outbox」——
 * spec §1 是抽象层描述，codebase 既有范式是 handler 内直接 fanout，注明偏差）。
 */
export const handleRecapGenerate: OutboxHandler = async (payload, deps) => {
  const chainId = str(payload.chainId);
  const period = str(payload.period);
  if (!chainId || !period) return;

  // provider 可能为 null（空 key 停用）→ generateRecap 内部走降级路径（status=degraded）。
  // generateRecap 拥有所有 recaps 行写入与重试分类；handler 只负责 fanout。
  const provider = getLLMProvider();
  // RetryableLLMError 传播给 processor 退避（不 try/catch，传播即可）
  await generateRecap(chainId, period, { provider });

  // 成功后查 status，仅 ready/degraded 扇出（spec §5：failed 不推送；generating 不应出现）
  const [recap] = await db
    .select({ status: recaps.status })
    .from(recaps)
    .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
    .limit(1);
  if (!recap || (recap.status !== 'ready' && recap.status !== 'degraded')) return;

  // 链全体成员（复用 handleMomentCreated 的成员查询范式）
  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId);
  if (targets.length === 0) return;

  const { chainName } = await loadSnapshot(chainId, []);
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_RECAP_READY,
    payload: {
      chainId,
      period,
      chainName,
      // recap_ready 无 momentId → fanoutNotifications 跳过去重直接插行（既有语义）
      title: chainName || '时刻',
      body: `${chainName} 的 ${period} 回顾出炉了`,
      data: { chainId, period },
    },
    push: true,
  });
};

/** 注册表：processor 按 outbox.type 分发。 */
export const handlers: Record<string, OutboxHandler> = {
  'moment.created': handleMomentCreated,
  'comment.created': handleCommentCreated,
  'reaction.created': handleReactionCreated,
  'moment.deleted': handleMomentDeleted,
  'recap.generate': handleRecapGenerate,
};
