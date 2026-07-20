import type { RecapDto, RecapListResponse } from '@moment/dto';
import { and, desc, eq, isNull, like, type SQL } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { moments, outbox, recaps } from '../db/schema.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_RECAP_GENERATE } from '../outbox/types.js';

const RECAP_REGENERATE_DAILY_LIMIT = 3;

function toDto(row: typeof recaps.$inferSelect): RecapDto {
  return {
    id: row.id,
    chainId: row.chainId,
    period: row.period,
    status: row.status,
    content: row.content,
    highlights: row.highlights,
    model: row.model,
    promptVersion: row.promptVersion,
    tokenUsage: row.tokenUsage,
    error: row.error,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Service()
export class RecapService {
  /** 列表（period 倒序，spec §6：无分页——每链每月至多一条） */
  async list(chainId: string): Promise<RecapListResponse> {
    const rows = await db
      .select()
      .from(recaps)
      .where(eq(recaps.chainId, chainId))
      .orderBy(desc(recaps.period));
    return { recaps: rows.map(toDto) };
  }

  /** 单条详情（period 校验在 controller 层） */
  async getByPeriod(chainId: string, period: string): Promise<RecapDto> {
    const [row] = await db
      .select()
      .from(recaps)
      .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
      .limit(1);
    if (!row) throw new NotFoundError('RECAP_NOT_FOUND');
    return toDto(row);
  }

  /**
   * 重生成（spec §6）：事务内写 outbox recap.generate。
   * - period 必须该月有记录（wall_date 落 period 且未软删）否则 RECAP_PERIOD_INACTIVE
   * - 每日每链限 3 次（查 outbox 当日已派发的 recap.generate 行数）否则 RECAP_REGENERATE_LIMIT
   */
  async regenerate(chainId: string, period: string): Promise<void> {
    // period 必须该月有记录（wall_date 落 period 且未软删，spec §6）
    const [active] = await db
      .select({ id: moments.id })
      .from(moments)
      .where(
        and(
          eq(moments.chainId, chainId),
          isNull(moments.deletedAt),
          like(moments.wallDate, `${period}-%`) as SQL,
        ),
      )
      .limit(1);
    if (!active) throw new BadRequestError('RECAP_PERIOD_INACTIVE');

    // 每日每链限 3 次（spec §6）
    if (await this.countTodayDispatches(chainId) >= RECAP_REGENERATE_DAILY_LIMIT) {
      throw new BadRequestError('RECAP_REGENERATE_LIMIT');
    }

    await db.transaction(async (tx: DbTx) => {
      await emitOutbox(tx, OUTBOX_RECAP_GENERATE, { chainId, period });
    });
  }

  /**
   * 查当日该链已派发的 recap.generate outbox 行数。
   * drizzle 对 json 列不可直接 eq（与 notification.service.ts 既有 json 去重范式一致），
   * 取回应用层过滤 chainId + 当日（当日 recap.generate 行数极少，可接受）。
   */
  private async countTodayDispatches(chainId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ payload: outbox.payload, createdAt: outbox.createdAt })
      .from(outbox)
      .where(eq(outbox.type, OUTBOX_RECAP_GENERATE));
    return rows.filter((r) => {
      const p = r.payload as { chainId?: string };
      return p.chainId === chainId && r.createdAt.getTime() >= todayStart.getTime();
    }).length;
  }
}
