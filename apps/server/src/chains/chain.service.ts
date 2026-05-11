import type { ChainDto, ChainMemberDto, CreateChainInput, InviteRole, UpdateChainInput } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { BadRequestError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, users, type Chain } from '../db/schema.js';
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

  /** 成员列表（viewer+），joinedAt 升序（owner 通常在最前）。 */
  async listMembers(userId: string, chainId: string): Promise<ChainMemberDto[]> {
    await this.policy.require(userId, chainId, 'viewer');
    const rows = await db
      .select({ member: chainMembers, nickname: users.nickname })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(eq(chainMembers.chainId, chainId))
      .orderBy(chainMembers.joinedAt);
    return rows.map((r) => ({
      userId: r.member.userId,
      nickname: r.nickname,
      role: r.member.role,
      joinedAt: r.member.joinedAt.toISOString(),
    }));
  }

  /** owner 改他人角色（仅 editor/viewer——role=owner 已被 dto schema 拒绝；转让走 transfer）。 */
  async updateMemberRole(
    actorId: string,
    chainId: string,
    targetUserId: string,
    role: InviteRole
  ): Promise<ChainMemberDto> {
    if (targetUserId === actorId) throw new BadRequestError('CANNOT_CHANGE_OWN_ROLE');
    await this.policy.require(actorId, chainId, 'owner');
    const [row] = await db
      .select({ member: chainMembers, nickname: users.nickname })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!row) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db
      .update(chainMembers)
      .set({ role })
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
    return { userId: targetUserId, nickname: row.nickname, role, joinedAt: row.member.joinedAt.toISOString() };
  }

  /**
   * 移除成员：owner 可移除他人；editor/viewer 可移除自己（退链）。
   * owner 退链被拒——必须先 transfer 或删链（spec §5.7）。
   */
  async removeMember(actorId: string, chainId: string, targetUserId: string): Promise<void> {
    const actorRole = await this.policy.require(actorId, chainId, 'viewer');
    if (targetUserId === actorId) {
      if (actorRole === 'owner') throw new HttpError(409, 'OWNER_MUST_TRANSFER');
    } else {
      await this.policy.require(actorId, chainId, 'owner');
    }
    const [target] = await db
      .select({ userId: chainMembers.userId })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!target) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db
      .delete(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
  }

  /** owner 转让：同事务改 chains.owner_id 与两边 members 角色（spec §3 事务边界）。 */
  async transfer(actorId: string, chainId: string, targetUserId: string): Promise<ChainDto> {
    if (targetUserId === actorId) throw new BadRequestError('CANNOT_TRANSFER_TO_SELF');
    await this.policy.require(actorId, chainId, 'owner');
    const [target] = await db
      .select({ userId: chainMembers.userId })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)))
      .limit(1);
    if (!target) throw new NotFoundError('MEMBER_NOT_FOUND');
    await db.transaction(async (tx) => {
      await tx
        .update(chainMembers)
        .set({ role: 'editor' })
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, actorId)));
      await tx
        .update(chainMembers)
        .set({ role: 'owner' })
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, targetUserId)));
      await tx.update(chains).set({ ownerId: targetUserId, updatedAt: new Date() }).where(eq(chains.id, chainId));
    });
    return this.getById(actorId, chainId);
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
