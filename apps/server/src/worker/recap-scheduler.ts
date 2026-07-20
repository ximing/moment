import { and, eq, isNull, like, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { moments, outbox, recaps } from '../db/schema.js';
import { getLLMProvider } from '../llm/factory.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_RECAP_GENERATE } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

/** 按 LLM_RECAP_TZ 格式化 now 取「年-月-日」（spec §1：每月 1 号按此时区判定）。 */
function formatInTz(now: Date, tz: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** 上月 period（YYYY-MM）：now 在 LLM_RECAP_TZ 下的年月，取上一个月。 */
function previousPeriod(now: Date, tz: string): string {
  const { year, month } = formatInTz(now, tz);
  // 上月：month 1 → 上月 12 / year-1；其余 month-1
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/** 是否为生成窗口（LLM_RECAP_TZ 下每月 1 号，spec §1）。 */
function isGenerationWindow(now: Date, tz: string): boolean {
  return formatInTz(now, tz).day === 1;
}

/** 幂等检查：该 chainId+period 是否已有 recap 行或 pending outbox 行。 */
async function alreadyDispatched(chainId: string, period: string): Promise<boolean> {
  // 查 recaps 是否已有该 chainId+period 行
  const [recap] = await db
    .select({ id: recaps.id })
    .from(recaps)
    .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
    .limit(1);
  if (recap) return true;

  // 查 outbox 是否已有同 type+payload 的 pending 行（去重）
  const pendingRows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.type, OUTBOX_RECAP_GENERATE), eq(outbox.status, 'pending')));
  return pendingRows.some((r) => {
    const p = r.payload as { chainId?: string; period?: string };
    return p.chainId === chainId && p.period === period;
  });
}

/**
 * 定时扫描（spec §1）：每月 1 号（LLM_RECAP_TZ）扫描上月有活动的链，幂等派发 recap.generate。
 * 每小时检查一次（由 worker/index.ts 调度）。
 * @returns {dispatched} 本次派发的 outbox 行数
 */
export async function runRecapSweep(now: Date): Promise<{ dispatched: number }> {
  const tz = config.LLM_RECAP_TZ;
  if (!isGenerationWindow(now, tz)) {
    return { dispatched: 0 };
  }

  const period = previousPeriod(now, tz);
  // spec §3/§8：LLM_API_KEY 空 = recap 管线整体停用——调度照常触发、window 照常判定（上方已检查），
  // 但「跳过派发」：不查活动链、不写 outbox 行。本地开发默认不配置 key，sweep 每月 1 号空跑不产生任何 recap/推送。
  // spec 的「扫描照常」指调度/window 判定照常，非「活动链查询必须执行」；skip 提前省一次 DB 查询。
  if (getLLMProvider() === null) {
    logger.info('recap sweep skipped: LLM disabled (empty LLM_API_KEY)', { period });
    return { dispatched: 0 };
  }

  // 找出上月有活动的链（有未软删 moment 落该 period）
  const activeChainIds = await db
    .select({ chainId: moments.chainId })
    .from(moments)
    .where(
      and(
        isNull(moments.deletedAt),
        like(moments.wallDate, `${period}-%`) as SQL,
      ),
    )
    .groupBy(moments.chainId);

  let dispatched = 0;
  for (const { chainId } of activeChainIds) {
    if (await alreadyDispatched(chainId, period)) continue;
    // 幂等写 outbox 行（事务内）
    await db.transaction(async (tx: DbTx) => {
      await emitOutbox(tx, OUTBOX_RECAP_GENERATE, { chainId, period });
    });
    dispatched++;
  }

  if (dispatched > 0) {
    logger.info('recap sweep dispatched', { period, dispatched });
  }
  return { dispatched };
}
