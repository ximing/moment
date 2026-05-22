import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type {
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationListResponse,
} from '@moment/dto';
import { BadRequestError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { notifications, pushTokens, type Notification } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { PushService } from '../push/push-service.js';
import { NOTIFICATION_REACTION_CREATED, type NotificationType } from './types.js';

/** 通知游标：base64url(JSON {t: <createdAt epochMs>, i: <notificationId>})，降序「严格早于」语义 */
function encodeCursor(t: number, i: string): string {
  return Buffer.from(JSON.stringify({ t, i }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { t: number; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as { t?: unknown; i?: unknown };
  if (typeof p.t !== 'number' || !Number.isSafeInteger(p.t) || typeof p.i !== 'string' || p.i.length === 0) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { t: p.t, i: p.i };
}

@Service()
export class NotificationService {
  /** 通知列表（仅本人，降序新→旧；unread=true 只看未读）。 */
  async list(
    userId: string,
    query: { unread?: string; cursor?: string; limit?: string }
  ): Promise<NotificationListResponse> {
    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const conditions: SQL[] = [eq(notifications.userId, userId)];
    if (query.unread === 'true') conditions.push(isNull(notifications.readAt));
    if (query.cursor !== undefined && query.cursor !== '') {
      const cur = decodeCursor(query.cursor);
      const before = new Date(cur.t);
      conditions.push(
        or(lt(notifications.createdAt, before), and(eq(notifications.createdAt, before), lt(notifications.id, cur.i))) as SQL,
      );
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      notifications: page.map((n) => this.toDto(n)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.getTime(), last.id) : null,
    };
  }

  /** 标已读：仅本人的行生效，混入他人 id 静默忽略（不报错、不泄露他人通知存在性）。 */
  async markRead(userId: string, input: MarkNotificationsReadInput): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, input.ids), isNull(notifications.readAt)));
  }

  /**
   * 扇出（仅 worker 调用，请求路径禁用——spec §5.4）：
   * 1) 批量插 notifications 行——幂等防御：已存在同去重键行的用户跳过插行（防 worker 崩溃租约重投导致重复通知）。
   *    去重键按类型区分（Global Constraints）：`reaction.created` = (userId, type, momentId, emoji)
   *    （换表情 = 新通知），其余 = (userId, type, momentId)；payload 无 momentId 时跳过去重直接插行
   *    （drizzle 的 json 列不可直接做 eq 条件，取出后应用层比对；type 为 varchar，
   *    已在 SQL 层 `eq(notifications.type, args.type)` 收窄，长链/老用户下不取回全量历史通知）；
   * 2) push=true 时对**全量** userIds（而非仅新插行用户）查有效 push_tokens 批量推送
   *    ——插行成功但 push 失败的整单重试时，补的是上轮漏掉的 push；
   * 3) send 返回的 invalidTokens 置 invalidated_at（spec §3 push_tokens）。
   */
  async fanoutNotifications(
    deps: { push: PushService },
    args: { userIds: string[]; type: NotificationType; payload: Record<string, unknown>; push: boolean }
  ): Promise<void> {
    if (args.userIds.length === 0) return;
    const momentId = typeof args.payload.momentId === 'string' ? args.payload.momentId : null;
    const emoji = typeof args.payload.emoji === 'string' ? args.payload.emoji : null;

    const existingRows = await db
      .select({ userId: notifications.userId, type: notifications.type, payload: notifications.payload })
      .from(notifications)
      .where(and(inArray(notifications.userId, args.userIds), eq(notifications.type, args.type)));
    // 无 momentId 的类型不做去重（避免与所有历史无 momentId 通知误判）
    const alreadyNotified =
      momentId === null
        ? new Set<string>()
        : new Set(
            existingRows
              .filter((r) => {
                const p = r.payload as { momentId?: unknown; emoji?: unknown };
                if (r.type !== args.type || p.momentId !== momentId) return false;
                // reaction.created 去重键含 emoji：换表情 = 新通知（Global Constraints）
                if (args.type === NOTIFICATION_REACTION_CREATED) return p.emoji === emoji;
                return true;
              })
              .map((r) => r.userId)
          );

    const insertTargets = args.userIds.filter((uid) => !alreadyNotified.has(uid));
    if (insertTargets.length > 0) {
      await db.insert(notifications).values(
        insertTargets.map((uid) => ({
          id: randomUUID(),
          userId: uid,
          type: args.type,
          payload: args.payload,
        }))
      );
    }

    if (!args.push) return;
    const tokenRows = await db
      .select()
      .from(pushTokens)
      .where(and(inArray(pushTokens.userId, args.userIds), isNull(pushTokens.invalidatedAt)));
    if (tokenRows.length === 0) return;

    const title = typeof args.payload.title === 'string' ? args.payload.title : '时刻';
    const body = typeof args.payload.body === 'string' ? args.payload.body : '你有新的动态';
    try {
      const outcome = await deps.push.send(
        tokenRows.map((t) => ({
          to: t.expoToken,
          title,
          body,
          data: { type: args.type, ...(args.payload.data as Record<string, unknown> | undefined) },
        }))
      );
      if (outcome.invalidTokens.length > 0) {
        await db
          .update(pushTokens)
          .set({ invalidatedAt: new Date() })
          .where(inArray(pushTokens.expoToken, outcome.invalidTokens));
      }
    } catch (err) {
      logger.error('push send failed; will retry via outbox', err);
      throw err;
    }
  }

  private toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
