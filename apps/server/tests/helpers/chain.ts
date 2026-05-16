import { randomUUID } from 'node:crypto';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';

export type MemberRole = 'owner' | 'editor' | 'viewer';

/** 直插 chains + chain_members（owner 隐含为 owner 成员），返回 chainId。 */
export async function createChainWithMembers(
  ownerId: string,
  members: { userId: string; role: Exclude<MemberRole, 'owner'> }[] = []
): Promise<string> {
  const chainId = randomUUID();
  await db.insert(chains).values({
    id: chainId,
    name: `chain-${chainId.slice(0, 8)}`,
    description: null,
    coverMediaId: null,
    ownerId,
    visibility: 'private',
  });
  await db.insert(chainMembers).values([
    { chainId, userId: ownerId, role: 'owner', joinedAt: new Date() },
    ...members.map((m) => ({ chainId, userId: m.userId, role: m.role, joinedAt: new Date() })),
  ]);
  return chainId;
}
