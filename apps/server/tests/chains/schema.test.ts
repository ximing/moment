import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers, chains, media, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('chains 域三表', () => {
  it('可写入并读回；默认值/枚举/联合主键生效', async () => {
    await db.insert(users).values({ id: 'u1', email: 'u1@t.com', passwordHash: 'x', nickname: 'u1' });
    await db.insert(chains).values({ id: 'c1', name: '链', ownerId: 'u1', template: 'daily' });
    const orphanedAt = new Date('2026-08-27T00:00:00Z');
    await db.insert(media).values({
      id: 'm1',
      uploaderId: 'u1',
      s3Key: 'tmp/m1.jpg',
      mime: 'image/jpeg',
      size: 1,
      status: 'orphaned',
      storageMeta: {
        bucket: 'moment-test-placeholder',
        prefix: 'test/attachments',
        region: 'us-east-1',
        isPublicBucket: 'false',
      },
      orphanedAt,
    });
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
    expect(chain.avatarMediaId).toBeNull();
    expect(chain.avatarFocusX).toBe(5000);
    expect(chain.avatarFocusY).toBe(5000);
    expect(chain.coverFocusX).toBe(5000);
    expect(chain.coverFocusY).toBe(5000);

    const [orphan] = await db.select().from(media);
    expect(orphan.orphanedAt?.toISOString()).toBe(orphanedAt.toISOString());

    const [invite] = await db.select().from(chainInvites);
    expect(invite.role).toBe('editor');
    expect(invite.acceptedAt).toBeNull();

    // spec chain-ordering §2：sort_order 默认 0；回填（迁移 0014）/ 新链置顶（min-1）/ reorder 全量重写另行赋值
    const [member] = await db.select().from(chainMembers);
    expect(member.sortOrder).toBe(0);

    // 联合主键 (chain_id, user_id)：重复写入报错
    await expect(
      db.insert(chainMembers).values({ chainId: 'c1', userId: 'u1', role: 'viewer' })
    ).rejects.toThrow();
  });
});
