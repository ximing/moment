import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { eq, inArray } from 'drizzle-orm';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import type { CreateMomentInput, MomentListResponse, MomentResponse, PatchMomentInput } from '@moment/dto';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { chains, media, moments, type Media } from '../db/schema.js';
import { TemplateService } from '../templates/template.service.js';
import { validateMomentPayload } from '../templates/payload-validator.js';
import { queryMomentPage } from '../feed/moment-query.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_CREATED, OUTBOX_MOMENT_DELETED } from '../outbox/types.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { replaceMomentTags } from '../tags/replace-moment-tags.js';
import { logger } from '../utils/logger.js';
import { serializeMoments } from './moment-serializer.js';
import { wallDateOf } from './wall-date.js';

@Service()
export class MomentService {
  constructor(private readonly policy: ChainPolicy, private readonly templates: TemplateService) {}

  /** 取链模板 manifest（任意 status：archived 模板的存量链照常发布/编辑，spec §3.4）。 */
  private async manifestOf(chainId: string) {
    const [chain] = await db.select({ template: chains.template }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // policy 已保证存在，防御性兜底
    return (await this.templates.getByKey(chain.template)).manifest;
  }

  /**
   * 创建 moment（spec §3 事务边界）：校验 media 归属/状态 → tmp→final copy（按行上 storage_meta，
   * 在源对象所在桶内进行）→ 绑定 moment_id → 插 moment → 同事务 emitOutbox(moment.created)。
   * tmp 对象的删除推迟到**事务提交成功之后**：事务内先删 tmp 再回滚会让 ready 媒体永久丢失
   * （回滚后行回到 tmp key，而对象已被物理删除，lifecycle/sweeper 只能清垃圾、救不回被删对象）。
   */
  async create(userId: string, chainId: string, input: CreateMomentInput): Promise<MomentResponse> {
    await this.policy.require(userId, chainId, 'editor');
    const manifest = await this.manifestOf(chainId);
    const payload = validateMomentPayload(manifest, input.kind, input.payload ?? null);
    const momentId = randomUUID();
    const happenedAt = new Date(input.happenedAt);
    const storage = getStorage();
    const copiedTmp: { key: string; metadata: StorageMetadata }[] = [];

    const created = await db.transaction(async (tx) => {
      let mediaRows: Media[] = [];
      let posterRow: Media | null = null;
      // poster 与媒体行走同一事务行锁（并发语义一致），但 poster 行单独持有——
      // 数量校验 mediaRows.length === new Set(input.mediaIds).size 只对媒体集合做，不能被 poster 污染
      const lockIds = input.posterMediaId
        ? [...new Set([...input.mediaIds, input.posterMediaId])]
        : input.mediaIds;
      if (lockIds.length > 0) {
        // 行锁：并发两个 moment 引用同一 mediaId 时，读-改-写必须串行化——
        // 后到者在锁上排队，提交后重读到的行 moment_id 非空 → 400 MEDIA_INVALID，杜绝「双发布各 copy 一半」
        const locked = await tx
          .select()
          .from(media)
          .where(inArray(media.id, lockIds))
          .for('update');
        posterRow = locked.find((r) => r.id === input.posterMediaId) ?? null;
        mediaRows = locked.filter((r) => r.id !== input.posterMediaId);
        // 全部满足：数量一致（dto 已拒重复 id，此处防御）+ 属本人 + ready + 未绑定 + mime 类型匹配
        // （type=video → 恰好 1 条 video/*；type=media 宫格允许图/视频**混排**，spec §1「media（图/视频宫格+文）」，见 Global Constraints）
        const valid =
          mediaRows.length === new Set(input.mediaIds).size &&
          mediaRows.every(
            (r) =>
              r.uploaderId === userId &&
              r.status === 'ready' &&
              r.momentId === null &&
              (input.type === 'video'
                ? r.mime.startsWith('video/')
                : r.mime.startsWith('image/') || r.mime.startsWith('video/'))
          );
        if (!valid) throw new HttpError(400, 'MEDIA_INVALID');
        // poster 行校验（spec video-poster §2.1）：本人 + ready + 未绑定 + image/* + 不在 mediaIds 中
        if (input.posterMediaId) {
          const posterValid =
            posterRow !== null &&
            posterRow.uploaderId === userId &&
            posterRow.status === 'ready' &&
            posterRow.momentId === null &&
            posterRow.mime.startsWith('image/') &&
            !input.mediaIds.includes(input.posterMediaId);
          if (!posterValid) throw new HttpError(400, 'MEDIA_INVALID');
        }
      }

      await tx.insert(moments).values({
        id: momentId,
        chainId,
        authorId: userId,
        type: input.type,
        kind: input.kind,
        payload,
        content: input.content,
        happenedAt,
        happenedTzOffset: input.happenedTzOffset,
        // wall_date 冗余投影随 happenedAt/happenedTzOffset 一并写入（spec memories-today §1）
        wallDate: wallDateOf(happenedAt, input.happenedTzOffset),
        isBackfill: input.isBackfill,
      });

      for (const mediaId of input.mediaIds) {
        const row = mediaRows.find((r) => r.id === mediaId)!;
        // mime-types 的 extension() 对未知 mime 返回 false，必须用 || 兜底
        const ext = mime.extension(row.mime) || 'bin';
        const finalKey = `chains/${chainId}/${momentId}/${row.id}.${ext}`;
        // 同桶服务端 copy tmp→final（spec §5.5；时机偏离见 Global Constraints）。
        // 按行上 storage_meta 定位源对象：copy 后对象仍在快照桶内，storage_meta 不改写。
        await storage.copyObject(row.s3Key, finalKey, row.storageMeta);
        copiedTmp.push({ key: row.s3Key, metadata: row.storageMeta });
        const sortOrder = input.mediaIds.indexOf(mediaId);
        await tx
          .update(media)
          .set({
            s3Key: finalKey,
            momentId,
            sortOrder,
            storageMeta: row.storageMeta,
            ...(input.posterMediaId ? { posterMediaId: input.posterMediaId } : {}),
          })
          .where(eq(media.id, row.id));
      }

      // poster 绑定（copy 复用媒体循环的 copyObject 范式，update 分开——不写 sortOrder / storageMeta）：
      // poster 行只绑 momentId + 新 s3Key；sortOrder 保持上传时的值（默认 0），不参与宫格排序。
      // tmp 对象进 copiedTmp，与媒体行走同一 post-commit 清理。
      if (posterRow) {
        const ext = mime.extension(posterRow.mime) || 'bin';
        const finalKey = `chains/${chainId}/${momentId}/${posterRow.id}.${ext}`;
        await storage.copyObject(posterRow.s3Key, finalKey, posterRow.storageMeta);
        copiedTmp.push({ key: posterRow.s3Key, metadata: posterRow.storageMeta });
        await tx.update(media).set({ s3Key: finalKey, momentId }).where(eq(media.id, posterRow.id));
      }

      const [inserted] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1);
      if (!inserted) throw new NotFoundError('MOMENT_NOT_FOUND');

      await replaceMomentTags(tx, inserted.id, chainId, input.tagIds ?? []);

      await emitOutbox(
        tx,
        OUTBOX_MOMENT_CREATED,
        { momentId, chainId, authorId: userId, isBackfill: input.isBackfill }
      );

      return inserted;
    });

    // 事务已提交：此刻删 tmp 才安全。删除失败只留下 tmp 垃圾对象（tmp/ lifecycle 7 天兜底），无数据损失。
    for (const t of copiedTmp) {
      await storage.deleteFile(t.key, t.metadata).catch((err: unknown) => {
        logger.warn(`post-commit tmp cleanup failed (lifecycle will cover): ${t.key}`, err);
      });
    }
    return (await serializeMoments([created], userId))[0];
  }

  /** 链内时间线：与 feed 共用 queryMomentPage（order 固定 happened_at，游标同格式）。 */
  async list(
    userId: string,
    chainId: string,
    query: { cursor?: string; limit?: string; before?: string }
  ): Promise<MomentListResponse> {
    await this.policy.require(userId, chainId, 'viewer');

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const page = await queryMomentPage({
      chainIds: [chainId],
      order: 'happened_at',
      limit,
      cursor: query.cursor,
      before: query.before,
    });
    return { items: await serializeMoments(page.rows, userId), nextCursor: page.nextCursor };
  }

  /** 详情：service 层反查 chainId 后走 ChainPolicy（CONVENTIONS §3.1）；软删 410。
   * 先鉴权再判软删：非成员对已删/未删一律 404，410 只对有权者暴露（防 id 枚举探测）。 */
  async get(userId: string, momentId: string): Promise<MomentResponse> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    return (await serializeMoments([m], userId))[0];
  }

  /** 仅作者本人可改；媒体不可改（dto 层 .strict() 已拒绝 mediaIds/type 等未知键）。鉴权先于软删判断（同 get）。
   * 取舍声明（spec 未定义）：原作者被移出链后成员资格失效，ChainPolicy.require 抛 404，
   * 作者本人也无法再 update 自己的 moment——成员资格优先于作者身份，与读取侧一致。 */
  async update(userId: string, momentId: string, input: PatchMomentInput): Promise<MomentResponse> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    if (m.authorId !== userId) throw new ForbiddenError('NOT_MOMENT_AUTHOR');

    // kind/payload 合并校验（spec §3.2）：任一变更即按「合并后的有效值」整体校验——
    // 只改 payload 用既存 kind 校验，只改 kind 用既存 payload 校验。
    // 推论（评审 S4，P4/P5 继承此约束）：只改 kind 不改 payload 的 PATCH 会被拒——
    // 旧 payload 按新 kind 的 schema 校验不过；前端切 kind 时必须同时显式传 payload（新值或 null）。
    let kindPayloadSet: { kind?: string; payload?: Record<string, unknown> | null } = {};
    if (input.kind !== undefined || input.payload !== undefined) {
      const manifest = await this.manifestOf(m.chainId);
      const effectiveKind = input.kind ?? m.kind;
      const effectivePayload = input.payload !== undefined ? input.payload : m.payload;
      const payload = validateMomentPayload(manifest, effectiveKind, effectivePayload);
      kindPayloadSet = {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        payload,
      };
    }

    const updatedRow = await db.transaction(async (tx) => {
      // happenedAt 或 happenedTzOffset 任一变更即按全量新值重算 wall_date（spec memories-today §1；
      // 单独改 tzOffset 不改时间点也会改墙钟归日，必须重算）
      const recomputeWallDate = input.happenedAt !== undefined || input.happenedTzOffset !== undefined;
      const nextHappenedAt = input.happenedAt !== undefined ? new Date(input.happenedAt) : m.happenedAt;
      const nextTzOffset = input.happenedTzOffset ?? m.happenedTzOffset;
      await tx
        .update(moments)
        .set({
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.happenedAt !== undefined ? { happenedAt: nextHappenedAt } : {}),
          ...(input.happenedTzOffset !== undefined ? { happenedTzOffset: input.happenedTzOffset } : {}),
          ...(recomputeWallDate ? { wallDate: wallDateOf(nextHappenedAt, nextTzOffset) } : {}),
          ...(input.isBackfill !== undefined ? { isBackfill: input.isBackfill } : {}),
          ...kindPayloadSet,
          updatedAt: new Date(),
        })
        .where(eq(moments.id, momentId));
      const [row] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1);
      if (!row) throw new NotFoundError('MOMENT_NOT_FOUND');
      if (input.tagIds !== undefined) {
        await replaceMomentTags(tx, row.id, row.chainId, input.tagIds);
      }
      return row;
    });
    return (await serializeMoments([updatedRow], userId))[0];
  }

  /** 软删（幂等）：作者或链 owner；同事务 emitOutbox(moment.deleted)（sweeper 信号）。鉴权先于软删判断（同 get）。
   * 取舍声明（spec 未定义）：同 update——原作者退链后成员资格失效，对自己 moment 的删除亦不可用（404）。 */
  async remove(userId: string, momentId: string): Promise<void> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    const role = await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) return;
    if (role !== 'owner' && m.authorId !== userId) throw new ForbiddenError('NOT_MOMENT_AUTHOR');

    await db.transaction(async (tx) => {
      await tx.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
      await emitOutbox(
        tx,
        OUTBOX_MOMENT_DELETED,
        { momentId, chainId: m.chainId, authorId: m.authorId }
      );
    });
  }
}
