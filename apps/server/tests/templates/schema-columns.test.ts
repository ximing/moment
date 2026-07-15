import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, moments } from '../../src/db/schema.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';

let user: TestUser;

beforeEach(async () => {
  await resetDb();
  user = await createUser(app, 'cols');
});
afterAll(closeDb);

describe('模板加列（spec §2.2）', () => {
  it('fixtures 默认：链 template=daily、moment kind=standard/payload=null', async () => {
    const chainId = await createChain(user.id);
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId));
    expect(chain.template).toBe('daily');
    expect(chain.payload).toBeNull();

    const momentId = await insertMoment({ chainId, authorId: user.id, happenedAt: new Date() });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.kind).toBe('standard');
    expect(m.payload).toBeNull();
  });

  it('fixtures 支持结构化：kind=milestone + payload 落库可回读', async () => {
    const chainId = await createChain(user.id, '宝宝', 'baby');
    const momentId = await insertMoment({
      chainId,
      authorId: user.id,
      happenedAt: new Date(),
      kind: 'milestone',
      payload: { catalog_key: 'first-smile' },
    });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.kind).toBe('milestone');
    expect(m.payload).toEqual({ catalog_key: 'first-smile' });
  });
});
