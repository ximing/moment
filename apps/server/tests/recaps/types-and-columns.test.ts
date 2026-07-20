import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains } from '../../src/db/schema.js';
import { OUTBOX_RECAP_GENERATE } from '../../src/outbox/types.js';
import { NOTIFICATION_RECAP_READY } from '../../src/notifications/types.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain } from '../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('recap 类型常量', () => {
  it('OUTBOX_RECAP_GENERATE = recap.generate', () => {
    expect(OUTBOX_RECAP_GENERATE).toBe('recap.generate');
  });

  it('NOTIFICATION_RECAP_READY = recap.ready', () => {
    expect(NOTIFICATION_RECAP_READY).toBe('recap.ready');
  });
});

describe('chains.share_recaps_enabled 列（spec §2）', () => {
  it('默认 true（长辈收到本月回顾是最强回访钩子）', async () => {
    const chainId = await createChain(owner.id);
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId));
    expect(chain.shareRecapsEnabled).toBe(true);
  });
});
