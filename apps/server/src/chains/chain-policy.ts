import { and, eq } from 'drizzle-orm';
import { ForbiddenError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains } from '../db/schema.js';

export type ChainRole = 'viewer' | 'editor' | 'owner'; // 偏序 viewer < editor < owner

const ROLE_ORDER: Record<ChainRole, number> = { viewer: 0, editor: 1, owner: 2 };

@Service()
export class ChainPolicy {
  /** 不足抛 ForbiddenError('CHAIN_ROLE_INSUFFICIENT')；非成员抛 NotFoundError('CHAIN_NOT_FOUND')。返回实际角色。 */
  async require(userId: string, chainId: string, minRole: ChainRole): Promise<ChainRole> {
    const [chain] = await db.select({ id: chains.id }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND');

    const [member] = await db
      .select({ role: chainMembers.role })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)))
      .limit(1);
    // 非成员与「链不存在」同码：不对外泄露链的存在性
    if (!member) throw new NotFoundError('CHAIN_NOT_FOUND');

    if (ROLE_ORDER[member.role] < ROLE_ORDER[minRole]) {
      throw new ForbiddenError('CHAIN_ROLE_INSUFFICIENT');
    }
    return member.role;
  }
}
