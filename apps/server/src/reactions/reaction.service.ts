import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ReactionInput } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { moments, reactions, type Moment } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_REACTION_CREATED } from '../outbox/types.js';

@Service()
export class ReactionService {
  constructor(private readonly policy: ChainPolicy) {}

  private async requireVisibleMoment(userId: string, momentId: string): Promise<Moment> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    return m;
  }

  /**
   * 点赞/换表情（viewer+，spec §1）：upsert UNIQUE(moment_id,user_id)。
   * 一条 `INSERT ... ON DUPLICATE KEY UPDATE`（drizzle `onDuplicateKeyUpdate`，tx 上同样可用）——
   * 并发双击/双端同点时先查后写会在 REPEATABLE READ 下双双 select 不到行、先后 insert 撞唯一索引，
   * 后者事务回滚表现为 500；ON DUPLICATE KEY UPDATE 在引擎层原子完成，无此竞态。
   * 事务：upsert + emitOutbox(reaction.created)（spec §3）。
   */
  async set(userId: string, momentId: string, input: ReactionInput): Promise<void> {
    const m = await this.requireVisibleMoment(userId, momentId);
    await db.transaction(async (tx) => {
      await tx
        .insert(reactions)
        .values({ id: randomUUID(), momentId, userId, emoji: input.emoji })
        .onDuplicateKeyUpdate({ set: { emoji: input.emoji } });
      await emitOutbox(tx, OUTBOX_REACTION_CREATED, {
        momentId,
        chainId: m.chainId,
        userId,
        emoji: input.emoji,
      });
    });
  }

  /** 取消点赞：硬删除（spec §5.7 reactions 硬删）。 */
  async remove(userId: string, momentId: string): Promise<void> {
    await this.requireVisibleMoment(userId, momentId);
    const deleted = await db
      .delete(reactions)
      .where(and(eq(reactions.momentId, momentId), eq(reactions.userId, userId)));
    if (deleted[0].affectedRows === 0) throw new NotFoundError('REACTION_NOT_FOUND');
  }
}
