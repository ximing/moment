import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './index.js';
import { seedOfficialTemplates } from '../templates/official-templates.seed.js';
import { logger } from '../utils/logger.js';

await migrate(db, { migrationsFolder: './drizzle' });
await seedOfficialTemplates();
logger.info('migrations applied');
await pool.end();
