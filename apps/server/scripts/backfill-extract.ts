/**
 * 一次性 AI 抽取回填（spec people-place §5 存量回填）：
 * 扫描 ai_extract_hash IS NULL 且有素材（content 非空或 transcript 非空串，偏差 11）的
 * 未软删时刻，分批写 moment.extract outbox 行。实际抽取由常驻 worker 的 outbox 消费完成
 * （本脚本只发射，不调 LLM）。
 * 幂等：消费成功后 hash 已写，二跑不重扫；未消费窗口由 sweep 内 pending 去重吸收。
 * LLM_API_KEY 空：直接退出（spec §5）。
 * 运行：pnpm --filter @moment/server backfill:extract -- [--batch 100] [--interval-ms 500]
 *（pnpm 裸 --batch 会被当 pnpm 自身选项报错，参数必须经 -- 透传）
 */
import { pool } from '../src/db/index.js';
import { logger } from '../src/utils/logger.js';
import { runExtractBackfillSweep } from '../src/worker/extract-backfill.js';

function intArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[idx + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const batchSize = intArg('batch', 100);
const pauseMs = intArg('interval-ms', 500);

try {
  const result = await runExtractBackfillSweep({ batchSize, pauseMs });
  logger.info('extract backfill finished', { ...result, batchSize, pauseMs });
} catch (err) {
  logger.error('extract backfill crashed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
