import type { Express } from 'express';
import { createApp as createAppImpl } from './app.js';
import { config } from './config.js';
import { ensureLance as ensureLanceImpl } from './lancedb/factory.js';
import { logger as loggerImpl } from './utils/logger.js';

export type StartServerDeps = {
  createApp: () => Express;
  ensureLance: () => Promise<void>;
  listen: (app: Express) => void;
  exit: (code: number) => void;
  nodeEnv: 'development' | 'test' | 'production';
  logger: Pick<typeof loggerImpl, 'error' | 'info'>;
};

export async function startServer(deps?: Partial<StartServerDeps>): Promise<void> {
  const createApp = deps?.createApp ?? createAppImpl;
  const ensureLance = deps?.ensureLance ?? ensureLanceImpl;
  const logger = deps?.logger ?? loggerImpl;
  const nodeEnv = deps?.nodeEnv ?? config.NODE_ENV;
  const exit = deps?.exit ?? ((code: number) => {
    process.exit(code);
  });
  const listen =
    deps?.listen ??
    ((app: Express) => {
      app.listen(config.PORT, () => {
        logger.info(`server listening on :${config.PORT}`, { env: config.NODE_ENV });
      });
    });

  const app = createApp();
  try {
    await ensureLance();
  } catch (err) {
    logger.error('lancedb ensure failed', err);
    if (nodeEnv === 'production') {
      exit(1);
      return;
    }
    throw err;
  }
  listen(app);
}
