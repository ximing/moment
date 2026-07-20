import 'reflect-metadata';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { getPushService } from '../push/factory.js';
import { logger } from '../utils/logger.js';
import { runOutboxBatch } from './processor.js';
import { runRecapSweep } from './recap-scheduler.js';
import { sweepSoftDeletedMomentMedia, sweepStaleUploadingMedia } from './sweeper.js';

/** 独立 worker 进程（spec §5.4）：与 API 同 codebase、不同进程；docker-compose service 属 Phase 8。 */

let running = true;

/** recap 扫描间隔：1 小时（spec §1：每小时检查一次生成窗口） */
const RECAP_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  let lastSweep = 0;
  let lastRecapSweep = 0;
  logger.info('worker started', {
    pollMs: config.WORKER_POLL_INTERVAL_MS,
    batchSize: config.WORKER_BATCH_SIZE,
  });
  while (running) {
    try {
      const result = await runOutboxBatch({ push: getPushService() });
      if (result.claimed > 0) {
        logger.info('outbox batch processed', result);
      }
    } catch (err) {
      // 单批意外崩溃不退出进程（spec §7：记录积压/失败指标）
      logger.error('outbox batch crashed', err);
    }
    if (Date.now() - lastSweep >= config.SWEEPER_INTERVAL_MS) {
      lastSweep = Date.now();
      try {
        await sweepStaleUploadingMedia();
        await sweepSoftDeletedMomentMedia();
      } catch (err) {
        logger.error('sweeper crashed', err);
      }
    }
    // recap 定时扫描（spec §1：每小时检查一次，每月 1 号派发上月有活动的链）
    if (Date.now() - lastRecapSweep >= RECAP_SWEEP_INTERVAL_MS) {
      lastRecapSweep = Date.now();
      try {
        const result = await runRecapSweep(new Date());
        if (result.dispatched > 0) {
          logger.info('recap sweep result', result);
        }
      } catch (err) {
        logger.error('recap sweep crashed', err);
      }
    }
    await sleep(config.WORKER_POLL_INTERVAL_MS);
  }
  await pool.end();
  logger.info('worker stopped');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`worker received ${sig}, draining...`);
    running = false;
  });
}

void main();
