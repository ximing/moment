import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, recaps } from '../../src/db/schema.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertRecap } from '../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('recaps 表（spec §2）', () => {
  it('insertRecap 默认值：status=generating、highlights=[]、model/tokenUsage/generatedAt/error null', async () => {
    const chainId = await createChain(owner.id);
    const id = await insertRecap({ chainId, period: '2026-07' });
    const [row] = await db.select().from(recaps).where(eq(recaps.id, id));
    expect(row.chainId).toBe(chainId);
    expect(row.period).toBe('2026-07');
    expect(row.status).toBe('generating');
    expect(row.highlights).toEqual([]);
    expect(row.content).toBe('');
    expect(row.model).toBeNull();
    expect(row.promptVersion).toBe(1);
    expect(row.tokenUsage).toBeNull();
    expect(row.error).toBeNull();
    expect(row.generatedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('UNIQUE(chain_id, period)：同链同期重插触发冲突；跨链/跨期不冲突', async () => {
    const c1 = await createChain(owner.id);
    const c2 = await createChain(owner.id);
    await insertRecap({ chainId: c1, period: '2026-07' });
    await expect(insertRecap({ chainId: c1, period: '2026-07' })).rejects.toThrow();
    // 跨链同期 / 同链跨期 OK
    await insertRecap({ chainId: c2, period: '2026-07' });
    await insertRecap({ chainId: c1, period: '2026-08' });
  });

  it('FK ON DELETE CASCADE：删链级联删 recaps', async () => {
    const chainId = await createChain(owner.id);
    await insertRecap({ chainId, period: '2026-07' });
    // chain_members.chain_id FK 无 CASCADE（RESTRICT），需先删成员行才能删链
    await db.delete(chainMembers).where(eq(chainMembers.chainId, chainId));
    await db.delete(chains).where(eq(chains.id, chainId));
    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0);
  });
});
