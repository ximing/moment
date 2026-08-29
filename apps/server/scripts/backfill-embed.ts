/**
 * 一次性融合检索回填（spec fused-retrieval §11）：
 * 先给未软删时刻上 derived_status IS NULL 的静态可压图发射 moment.compress，
 * 再给 embed_hash IS NULL 且无 pending 可压图的时刻发射 moment.embed。
 * 实际压缩/嵌入由常驻 worker 的 outbox 循环完成（本脚本只发射，不调 DashScope、不读像素）。
 * 幂等：消费成功后 derived_status 不再 NULL / embed_hash 已写，二跑不重扫；
 * 未消费窗口由 sweep 内 pending outbox 去重吸收。
 * getEmbeddingProvider()===null（空 DASHSCOPE_API_KEY 或 MULTIMODAL_EMBEDDING_ENABLED=false）：直接退出。
 *
 * 运行：pnpm --filter @moment/server backfill:embed -- [--batch 100] [--interval-ms 500]
 *（pnpm 裸 --batch 会被当 pnpm 自身选项报错，参数必须经 -- 透传）
 *
 * 换模型或维度后全量重嵌（本脚本不重置 hash、不删 Lance、没有重置 hash 的命令行开关）：
 * 1. 停 server 与 worker
 * 2. 换 LANCEDB_PATH 到新子目录，或删除旧 Lance 目录/表
 *    例：LANCEDB_PATH=./lancedb_data/qwen3-vl-2560
 * 3. 在目标库执行：
 *    UPDATE moments SET embed_hash = NULL WHERE deleted_at IS NULL;
 * 4. pnpm --filter @moment/server backfill:embed -- --batch 100 --interval-ms 500
 * 5. 常驻 worker 消费 moment.compress / moment.embed
 */
import { pool } from '../src/db/index.js';
import { logger } from '../src/utils/logger.js';
import { runEmbedBackfillSweep } from '../src/worker/embed-backfill.js';

function intArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[idx + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const batchSize = intArg('batch', 100);
const pauseMs = intArg('interval-ms', 500);

try {
  const result = await runEmbedBackfillSweep({ batchSize, pauseMs });
  logger.info('embed backfill finished', { ...result, batchSize, pauseMs });
} catch (err) {
  logger.error('embed backfill crashed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
