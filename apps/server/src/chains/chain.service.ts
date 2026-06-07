import {
  CHAIN_COLORS,
  CHAIN_ICONS,
  type AcceptInviteResponse,
  type ChainColor,
  type ChainDto,
  type ChainIcon,
  type ChainMemberDto,
  type CreateChainInput,
  type CreateInviteInput,
  type InviteDto,
  type InviteRole,
  type UpdateChainInput,
  type UserProfile,
} from '@moment/dto';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { avatarUrlsByUserIds } from '../auth/avatar.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, comments, media, momentTags, moments, reactions, shareLinks, tags, users, type Chain, type ChainInvite } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';

function isChainColor(v: string | null): v is ChainColor {
  return v !== null && (CHAIN_COLORS as readonly string[]).includes(v);
}

function isChainIcon(v: string | null): v is ChainIcon {
  return v !== null && (CHAIN_ICONS as readonly string[]).includes(v);
}

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
        color: input.color ?? null,
        icon: input.icon ?? null,
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
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chains.id, chainId));
    return this.getById(userId, chainId);
  }

  /**
   * owner 删链：同事务硬删 reactions → comments → moment_tags → tags → media → moments → invites → members → chain。
   * comments/reactions 对 moments 为 ON DELETE no action，必须先于 moments 硬删，否则 MySQL 1451。
   */
  async remove(userId: string, chainId: string): Promise<void> {
    await this.policy.require(userId, chainId, 'owner');
    await db.transaction(async (tx) => {
      const chainMomentIds = tx
        .select({ id: moments.id })
        .from(moments)
        .where(eq(moments.chainId, chainId));
      await tx.delete(shareLinks).where(eq(shareLinks.chainId, chainId));
      await tx.delete(reactions).where(inArray(reactions.momentId, chainMomentIds));
      await tx.delete(comments).where(inArray(comments.momentId, chainMomentIds));
      await tx.delete(momentTags).where(inArray(momentTags.momentId, chainMomentIds));
      await tx.delete(tags).where(eq(tags.chainId, chainId));
      await tx.delete(media).where(inArray(media.momentId, chainMomentIds));
      await tx.delete(moments).where(eq(moments.chainId, chainId));
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
    const avatarBy = await avatarUrlsByUserIds(rows.map((r) => r.member.userId));
    return rows.map((r) => ({
      userId: r.member.userId,
      nickname: r.nickname,
      avatarUrl: avatarBy.get(r.member.userId) ?? null,
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
    const avatarBy = await avatarUrlsByUserIds([targetUserId]);
    return {
      userId: targetUserId,
      nickname: row.nickname,
      avatarUrl: avatarBy.get(targetUserId) ?? null,
      role,
      joinedAt: row.member.joinedAt.toISOString(),
    };
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

  /** editor+ 生成邀请：token 为 48 字节随机 base64url（64 字符，不可猜测），默认 INVITE_TTL_DAYS 天过期。 */
  async createInvite(userId: string, chainId: string, input: CreateInviteInput): Promise<InviteDto> {
    await this.policy.require(userId, chainId, 'editor');
    const id = randomUUID();
    await db.insert(chainInvites).values({
      id,
      chainId,
      token: randomBytes(48).toString('base64url'),
      email: input.email ?? null,
      role: input.role,
      createdBy: userId,
      expiresAt: new Date(Date.now() + config.INVITE_TTL_DAYS * 86_400_000),
    });
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.id, id)).limit(1);
    return this.toInviteDto(invite);
  }

  /** owner 查看本链全部邀请（含 token，用于复制分享）。 */
  async listInvites(userId: string, chainId: string): Promise<InviteDto[]> {
    await this.policy.require(userId, chainId, 'owner');
    const rows = await db
      .select()
      .from(chainInvites)
      .where(eq(chainInvites.chainId, chainId))
      .orderBy(desc(chainInvites.createdAt));
    return rows.map((r) => this.toInviteDto(r));
  }

  /** owner 吊销邀请：硬删除。 */
  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.id, inviteId)).limit(1);
    if (!invite) throw new NotFoundError('INVITE_NOT_FOUND');
    await this.policy.require(userId, invite.chainId, 'owner');
    await db.delete(chainInvites).where(eq(chainInvites.id, inviteId));
  }

  /**
   * 接受邀请（登录用户）。判定顺序固定：
   * 不存在 404 → 已是成员 200 幂等 → email 不匹配 403 → 已被接受 410 → 过期 410 → 同事务写 member + accepted_at。
   */
  async acceptInvite(user: UserProfile, token: string): Promise<AcceptInviteResponse> {
    const [invite] = await db.select().from(chainInvites).where(eq(chainInvites.token, token)).limit(1);
    if (!invite) throw new NotFoundError('INVITE_NOT_FOUND');

    // 幂等：已是成员直接返回现有角色（不写库、不看邀请状态）
    const [member] = await db
      .select({ role: chainMembers.role })
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, invite.chainId), eq(chainMembers.userId, user.id)))
      .limit(1);
    if (member) return { chainId: invite.chainId, role: member.role, alreadyMember: true };

    // 两侧 email 均已小写归一化（注册与创建邀请时的 zod schema）
    if (invite.email && invite.email !== user.email) throw new ForbiddenError('INVITE_EMAIL_MISMATCH');
    if (invite.acceptedAt) throw new HttpError(410, 'INVITE_ALREADY_ACCEPTED');
    if (invite.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'INVITE_EXPIRED');

    await db.transaction(async (tx) => {
      await tx.insert(chainMembers).values({ chainId: invite.chainId, userId: user.id, role: invite.role });
      await tx.update(chainInvites).set({ acceptedAt: new Date() }).where(eq(chainInvites.id, invite.id));
      // outbox 锚点：「被邀请入链」通知扇出属 Phase 5（outbox 表 Phase 3 才建立），此处不写。
    });
    return { chainId: invite.chainId, role: invite.role, alreadyMember: false };
  }

  private toChainDto(chain: Chain, myRole?: ChainRole): ChainDto {
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      coverMediaId: chain.coverMediaId,
      color: isChainColor(chain.color) ? chain.color : null,
      icon: isChainIcon(chain.icon) ? chain.icon : null,
      visibility: chain.visibility,
      ownerId: chain.ownerId,
      ...(myRole ? { myRole } : {}),
      createdAt: chain.createdAt.toISOString(),
      updatedAt: chain.updatedAt.toISOString(),
    };
  }

  private toInviteDto(invite: ChainInvite): InviteDto {
    return {
      id: invite.id,
      chainId: invite.chainId,
      token: invite.token,
      email: invite.email,
      role: invite.role,
      createdBy: invite.createdBy,
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : null,
      createdAt: invite.createdAt.toISOString(),
    };
  }
}
