import type { ChainDto, CreateChainInput, UpdateChainInput } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, type Chain } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';

@Service()
export class ChainService {
  constructor(private policy: ChainPolicy) {}

  /** 创建链：同事务把创建者写为 owner 成员（spec §3 事务边界）。 */
  async create(userId: string, input: CreateChainInput): Promise<ChainDto> {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(chains).values({
        id,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        ownerId: userId,
      });
      await tx.insert(chainMembers).values({ chainId: id, userId, role: 'owner' });
    });
    return this.getById(userId, id);
  }

  /** 我参与的链（含我的角色），createdAt 倒序。 */
  async listMine(userId: string): Promise<ChainDto[]> {
    const rows = await db
      .select({ chain: chains, role: chainMembers.role })
      .from(chainMembers)
      .innerJoin(chains, eq(chainMembers.chainId, chains.id))
      .where(eq(chainMembers.userId, userId))
      .orderBy(desc(chains.createdAt));
    return rows.map((r) => this.toChainDto(r.chain, r.role));
  }

  /** 详情：service 层过 ChainPolicy（读接口同样验成员身份，防 IDOR）。 */
  async getById(userId: string, chainId: string): Promise<ChainDto> {
    const role = await this.policy.require(userId, chainId, 'viewer');
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    return this.toChainDto(chain, role);
  }

  /** owner 改链设置（coverMediaId 属 Phase 3，本阶段不可改）。 */
  async update(userId: string, chainId: string, input: UpdateChainInput): Promise<ChainDto> {
    await this.policy.require(userId, chainId, 'owner');
    await db
      .update(chains)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chains.id, chainId));
    return this.getById(userId, chainId);
  }

  /**
   * owner 删链：同事务硬删 invites → members → chain。
   * 级联锚点：moments/media/tags/comments 等链内内容属 Phase 3+，
   * 届时在本事务最前面追加对应删除/软删逻辑。
   */
  async remove(userId: string, chainId: string): Promise<void> {
    await this.policy.require(userId, chainId, 'owner');
    await db.transaction(async (tx) => {
      await tx.delete(chainInvites).where(eq(chainInvites.chainId, chainId));
      await tx.delete(chainMembers).where(eq(chainMembers.chainId, chainId));
      await tx.delete(chains).where(eq(chains.id, chainId));
    });
  }

  private toChainDto(chain: Chain, myRole?: ChainRole): ChainDto {
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      coverMediaId: chain.coverMediaId,
      visibility: chain.visibility,
      ownerId: chain.ownerId,
      ...(myRole ? { myRole } : {}),
      createdAt: chain.createdAt.toISOString(),
      updatedAt: chain.updatedAt.toISOString(),
    };
  }
}
