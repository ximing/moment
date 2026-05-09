import 'reflect-metadata';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const app = createApp();
app.listen(config.PORT, () => {
  logger.info(`server listening on :${config.PORT}`, { env: config.NODE_ENV });
});
