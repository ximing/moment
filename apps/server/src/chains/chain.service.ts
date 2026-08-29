import {
  chainAppearanceColorSchema,
  type AcceptInviteResponse,
  type ChainAppearanceColor,
  type ChainDto,
  type ChainDetailDto,
  type ChainMemberDto,
  type ChainMemberPreview,
  type CreateChainInput,
  type CreateInviteInput,
  type InviteDto,
  type InviteRole,
  type ReorderChainsInput,
  type UpdateChainInput,
  type UserProfile,
} from '@moment/dto';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, min } from 'drizzle-orm';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { avatarUrlsByUserIds } from '../auth/avatar.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { chainInvites, chainMembers, chains, comments, media, momentPersons, momentTags, moments, persons, reactions, shareLinks, tags, users, type Chain, type ChainInvite } from '../db/schema.js';
import { ChainPolicy, type ChainRole } from './chain-policy.js';
import { deleteVectorsByChainId } from '../lancedb/repository.js';
import { logger } from '../utils/logger.js';
import type { DbTx } from '../outbox/outbox.js';
import { TemplateService } from '../templates/template.service.js';
import { validateChainPayload } from '../templates/payload-validator.js';
import {
  focusFromDb,
  normalizeCreateAppearance,
  normalizeUpdateAppearance,
} from './chain-appearance.js';
import {
  bindChainMedia,
  cleanupBoundMedia,
  rollbackBoundMedia,
  type ChainMediaBinding,
} from './chain-media.js';

/** 读取防御：color 列只接受预设色或 #RRGGBB（历史异常值 → null，由客户端哈希回退）。 */
function asAppearanceColor(v: string | null): ChainAppearanceColor | null {
  if (v === null) return null;
  const parsed = chainAppearanceColorSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

@Service()
export class ChainService {
  constructor(private policy: ChainPolicy, private templates: TemplateService) {}

  /** 创建链：同事务完成媒体绑定（锁/copy）+ 插链 + 把创建者写为 owner 成员（spec §3 事务边界）。 */
  async create(userId: string, input: CreateChainInput): Promise<ChainDto> {
    // 模板必须存在且 active（archived 阻止新建链选用，spec §3.4）；payload 按 chainPayloadSchema 校验
    const template = await this.templates.getActiveByKey(input.template);
    const payload = validateChainPayload(template.manifest, input.payload ?? null);
    const id = randomUUID();
    const appearance = normalizeCreateAppearance(id, input);
    // binding 由调用方持有、bindChainMedia 逐步累积：中途失败也能补偿已 copy 的 final
    const binding: ChainMediaBinding = { copies: [], replacedIds: [] };
    try {
      await db.transaction(async (tx) => {
        await bindChainMedia(tx, { chainId: id, userId, current: null, patch: appearance, binding });
        await tx.insert(chains).values({
          id,
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          ...appearance,
          ownerId: userId,
          template: input.template,
          payload,
        });
        // 新链置顶（spec §4）：min-1；首条链（无现存 membership）取 1
        const sortOrder = await this.nextTopSortOrder(tx, userId);
        await tx.insert(chainMembers).values({ chainId: id, userId, role: 'owner', sortOrder });
      });
    } catch (err) {
      // 事务回滚：删除本次 copy 出的 final 对象（原 media 行仍指向 tmp，可重试）
      await rollbackBoundMedia(binding);
      throw err;
    }
    // 提交成功后才删 tmp：事务内先删再回滚会让 ready 媒体永久丢失
    await cleanupBoundMedia(binding);
    return this.getById(userId, id);
  }

  /** 我参与的链（含我的角色）：sortOrder 升序，createdAt 倒序兜底（spec chain-ordering §3）。 */
  async listMine(userId: string): Promise<ChainDto[]> {
    const rows = await db
      .select({ chain: chains, role: chainMembers.role })
      .from(chainMembers)
      .innerJoin(chains, eq(chainMembers.chainId, chains.id))
      .where(eq(chainMembers.userId, userId))
      .orderBy(asc(chainMembers.sortOrder), desc(chains.createdAt));
    return this.attachPreviews(rows.map((r) => ({ chain: r.chain, role: r.role })));
  }

  /** 详情：service 层过 ChainPolicy（读接口同样验成员身份，防 IDOR）。 */
  async getById(userId: string, chainId: string): Promise<ChainDetailDto> {
    const role = await this.policy.require(userId, chainId, 'viewer');
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    const [dto] = await this.attachPreviews([{ chain, role }]);
    // 详情内嵌模板 manifest（spec §3.2）；getByKey 任意 status 可读——archived 模板的存量链照常展示
    const template = await this.templates.getByKey(chain.template);
    return { ...dto, templateManifest: template.manifest };
  }

  /** owner 改链设置：事务内锁 chain 行与待绑定 media，归一化外观 patch 后一次性写入。 */
  async update(userId: string, chainId: string, input: UpdateChainInput): Promise<ChainDto> {
    await this.policy.require(userId, chainId, 'owner');
    const binding: ChainMediaBinding = { copies: [], replacedIds: [] };
    try {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(chains)
          .where(eq(chains.id, chainId))
          .limit(1)
          .for('update');
        if (!current) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
        // payload 显式出现在输入里才校验/写入（undefined = 不动；null = 清空，validateChainPayload 放行 null）
        let payloadSet: { payload?: Record<string, unknown> | null } = {};
        if (input.payload !== undefined) {
          const template = await this.templates.getByKey(current.template);
          payloadSet = { payload: validateChainPayload(template.manifest, input.payload) };
        }
        const appearance = normalizeUpdateAppearance(chainId, current, input);
        if (Object.keys(appearance).length > 0) {
          // 锁/copy 媒体、写外观 patch、旧媒体标 orphaned（顺序见 chain-media.ts）
          await bindChainMedia(tx, { chainId, userId, current, patch: appearance, binding });
        }
        const rest = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...payloadSet,
        };
        await tx
          .update(chains)
          .set({ ...rest, updatedAt: new Date() })
          .where(eq(chains.id, chainId));
      });
    } catch (err) {
      await rollbackBoundMedia(binding);
      throw err;
    }
    await cleanupBoundMedia(binding);
    return this.getById(userId, chainId);
  }

  /**
   * owner 删链：同事务硬删 reactions → comments → moment_tags → tags → media → moments → invites → members → chain。
   * comments/reactions 对 moments 为 ON DELETE no action，必须先于 moments 硬删，否则 MySQL 1451。
   * 删 chain 前把 avatar/cover media 标 orphaned（写 orphanedAt，交 generic orphan sweeper 按保留期物理清理）。
   */
  async remove(userId: string, chainId: string): Promise<void> {
    await this.policy.require(userId, chainId, 'owner');
    await db.transaction(async (tx) => {
      const [chain] = await tx
        .select({ avatarMediaId: chains.avatarMediaId, coverMediaId: chains.coverMediaId })
        .from(chains)
        .where(eq(chains.id, chainId))
        .limit(1);
      const appearanceMediaIds = [chain?.avatarMediaId, chain?.coverMediaId].filter(
        (id): id is string => typeof id === 'string',
      );
      if (appearanceMediaIds.length > 0) {
        await tx
          .update(media)
          .set({ status: 'orphaned', orphanedAt: new Date() })
          .where(inArray(media.id, appearanceMediaIds));
      }
      const chainMomentIds = tx
        .select({ id: moments.id })
        .from(moments)
        .where(eq(moments.chainId, chainId));
      await tx.delete(shareLinks).where(eq(shareLinks.chainId, chainId));
      await tx.delete(reactions).where(inArray(reactions.momentId, chainMomentIds));
      await tx.delete(comments).where(inArray(comments.momentId, chainMomentIds));
      await tx.delete(momentTags).where(inArray(momentTags.momentId, chainMomentIds));
      await tx.delete(momentPersons).where(inArray(momentPersons.momentId, chainMomentIds));
      await tx.delete(tags).where(eq(tags.chainId, chainId));
      await tx.delete(persons).where(eq(persons.chainId, chainId));
      await tx.delete(media).where(inArray(media.momentId, chainMomentIds));
      await tx.delete(moments).where(eq(moments.chainId, chainId));
      await tx.delete(chainInvites).where(eq(chainInvites.chainId, chainId));
      await tx.delete(chainMembers).where(eq(chainMembers.chainId, chainId));
      await tx.delete(chains).where(eq(chains.id, chainId));
    });
    try {
      await deleteVectorsByChainId(chainId);
    } catch (err) {
      logger.warn('lancedb delete after chain delete failed', err);
    }
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
      // 新加入的链同样置顶（spec §4）；幂等分支已在上方提前返回，不写库
      const sortOrder = await this.nextTopSortOrder(tx, user.id);
      await tx.insert(chainMembers).values({ chainId: invite.chainId, userId: user.id, role: invite.role, sortOrder });
      await tx.update(chainInvites).set({ acceptedAt: new Date() }).where(eq(chainInvites.id, invite.id));
      // outbox 锚点：「被邀请入链」通知扇出属 Phase 5（outbox 表 Phase 3 才建立），此处不写。
    });
    return { chainId: invite.chainId, role: invite.role, alreadyMember: false };
  }

  /**
   * 测试专用钩子（spec §7「并发入链不被改写」的顺序模拟）：
   * 非空时在 reorder 事务校验通过后、重写执行前 await。生产代码不得赋值。
   */
  reorderAfterValidateHook: ((userId: string) => Promise<void>) | null = null;

  /**
   * 全量重写「我 × 链」展示顺序（spec §5）：
   * 去重后的集合必须恰好等于我的全部链 id（防漏/防越权/防半截）；校验与重写同事务；
   * 重写按 chain_id 逐行 UPDATE（天然限定在提交集合内）——校验后并发入链的置顶新行
   * 不参与本次重写，容忍交错，下次 reorder 收敛。响应固定 204（controller 声明）。
   */
  async reorder(userId: string, input: ReorderChainsInput): Promise<void> {
    const ordered = [...new Set(input.chainIds)];
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ chainId: chainMembers.chainId })
        .from(chainMembers)
        .where(eq(chainMembers.userId, userId));
      const mine = new Set(rows.map((r) => r.chainId));
      if (ordered.length !== mine.size || ordered.some((id) => !mine.has(id))) {
        throw new BadRequestError('CHAIN_ORDER_MISMATCH');
      }
      if (this.reorderAfterValidateHook) await this.reorderAfterValidateHook(userId);
      for (let i = 0; i < ordered.length; i++) {
        await tx
          .update(chainMembers)
          .set({ sortOrder: i + 1 })
          .where(and(eq(chainMembers.userId, userId), eq(chainMembers.chainId, ordered[i] as string)));
      }
    });
  }

  /** 新 membership 置顶（spec §4）：当前用户最小 sortOrder - 1；无现存 membership（首条链）取 1。 */
  private async nextTopSortOrder(tx: DbTx, userId: string): Promise<number> {
    const [row] = await tx
      .select({ value: min(chainMembers.sortOrder) })
      .from(chainMembers)
      .where(eq(chainMembers.userId, userId));
    return row?.value == null ? 1 : Number(row.value) - 1;
  }

  private toChainDto(
    chain: Chain,
    myRole: ChainRole | undefined,
    extras: { membersPreview: ChainMemberPreview[]; memberCount: number },
    readyMedia: ReadonlySet<string>,
  ): ChainDto {
    // 每个图片 placement 只在关联 media 存在且 ready 时返回成组的 mediaId/稳定 URL/focus；
    // 关联缺失或非 ready 时三者全部 null（设计 §4.3），客户端按防御性优先级回退。
    const avatarReady = chain.avatarMediaId !== null && readyMedia.has(chain.avatarMediaId);
    const coverReady = chain.coverMediaId !== null && readyMedia.has(chain.coverMediaId);
    // 读取防御性优先级 avatarMediaId > icon > color（设计 §3.1 历史异常数据）
    const icon = avatarReady ? null : chain.icon;
    const color = avatarReady || icon !== null ? null : asAppearanceColor(chain.color);
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      avatarMediaId: avatarReady ? chain.avatarMediaId : null,
      avatarUrl: avatarReady ? `/api/media/${chain.avatarMediaId}` : null,
      avatarFocus: avatarReady ? focusFromDb(chain.avatarFocusX, chain.avatarFocusY) : null,
      coverMediaId: coverReady ? chain.coverMediaId : null,
      coverUrl: coverReady ? `/api/media/${chain.coverMediaId}` : null,
      coverFocus: coverReady ? focusFromDb(chain.coverFocusX, chain.coverFocusY) : null,
      color,
      icon,
      visibility: chain.visibility,
      template: chain.template,
      payload: chain.payload,
      ownerId: chain.ownerId,
      ...(myRole ? { myRole } : {}),
      createdAt: chain.createdAt.toISOString(),
      updatedAt: chain.updatedAt.toISOString(),
      membersPreview: extras.membersPreview,
      memberCount: extras.memberCount,
    };
  }

  private async attachPreviews(items: { chain: Chain; role?: ChainRole }[]): Promise<ChainDto[]> {
    if (items.length === 0) return [];
    const chainIds = items.map((i) => i.chain.id);
    // 批量收集全部 avatar/cover id，一次查询 ready media 集合（不逐链查 media）
    const appearanceMediaIds = [
      ...new Set(
        items.flatMap((i) =>
          [i.chain.avatarMediaId, i.chain.coverMediaId].filter((id): id is string => typeof id === 'string'),
        ),
      ),
    ];
    const readyMedia = new Set<string>();
    if (appearanceMediaIds.length > 0) {
      const readyRows = await db
        .select({ id: media.id })
        .from(media)
        .where(and(inArray(media.id, appearanceMediaIds), eq(media.status, 'ready')));
      for (const r of readyRows) readyMedia.add(r.id);
    }
    const rows = await db
      .select({
        chainId: chainMembers.chainId,
        userId: chainMembers.userId,
        role: chainMembers.role,
        joinedAt: chainMembers.joinedAt,
        nickname: users.nickname,
      })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(inArray(chainMembers.chainId, chainIds));

    const byChain = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byChain.get(row.chainId) ?? [];
      list.push(row);
      byChain.set(row.chainId, list);
    }

    const previewUserIds: string[] = [];
    const prepared = new Map<string, { preview: typeof rows; count: number }>();
    for (const id of chainIds) {
      const list = [...(byChain.get(id) ?? [])].sort((a, b) => {
        const dt = a.joinedAt.getTime() - b.joinedAt.getTime();
        if (dt !== 0) return dt;
        if (a.userId < b.userId) return -1;
        if (a.userId > b.userId) return 1;
        return 0;
      });
      const preview = list.slice(0, 5);
      prepared.set(id, { preview, count: list.length });
      for (const p of preview) previewUserIds.push(p.userId);
    }

    const avatarBy = await avatarUrlsByUserIds(previewUserIds);
    return items.map(({ chain, role }) => {
      const extra = prepared.get(chain.id) ?? { preview: [], count: 0 };
      return this.toChainDto(chain, role, {
        memberCount: extra.count,
        membersPreview: extra.preview.map((p) => ({
          userId: p.userId,
          nickname: p.nickname,
          avatarUrl: avatarBy.get(p.userId) ?? null,
          role: p.role,
        })),
      }, readyMedia);
    });
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
