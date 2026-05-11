import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('chains 域三表', () => {
  it('可写入并读回；默认值/枚举/联合主键生效', async () => {
    await db.insert(users).values({ id: 'u1', email: 'u1@t.com', passwordHash: 'x', nickname: 'u1' });
    await db.insert(chains).values({ id: 'c1', name: '链', ownerId: 'u1' });
    await db.insert(chainMembers).values({ chainId: 'c1', userId: 'u1', role: 'owner' });
    await db.insert(chainInvites).values({
      id: 'i1',
      chainId: 'c1',
      token: 'a'.repeat(64),
      role: 'editor',
      createdBy: 'u1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const [chain] = await db.select().from(chains);
    expect(chain.visibility).toBe('private'); // 默认值
    expect(chain.description).toBeNull();
    expect(chain.coverMediaId).toBeNull();

    const [invite] = await db.select().from(chainInvites);
    expect(invite.role).toBe('editor');
    expect(invite.acceptedAt).toBeNull();

    // 联合主键 (chain_id, user_id)：重复写入报错
    await expect(
      db.insert(chainMembers).values({ chainId: 'c1', userId: 'u1', role: 'viewer' })
    ).rejects.toThrow();
  });
});
