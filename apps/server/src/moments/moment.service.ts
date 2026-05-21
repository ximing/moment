import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import type { CreateMomentInput, MomentListResponse, MomentResponse, PatchMomentInput } from '@moment/dto';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { media, moments, users, type Media, type Moment } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_CREATED, OUTBOX_MOMENT_DELETED } from '../outbox/types.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { logger } from '../utils/logger.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { momentSerializer } from './moment-serializer.js';

@Service()
export class MomentService {
  constructor(private readonly policy: ChainPolicy) {}

  /**
   * 创建 moment（spec §3 事务边界）：校验 media 归属/状态 → tmp→final copy（按行上 storage_meta，
   * 在源对象所在桶内进行）→ 绑定 moment_id → 插 moment → 同事务 emitOutbox(moment.created)。
   * tmp 对象的删除推迟到**事务提交成功之后**：事务内先删 tmp 再回滚会让 ready 媒体永久丢失
   * （回滚后行回到 tmp key，而对象已被物理删除，lifecycle/sweeper 只能清垃圾、救不回被删对象）。
   */
  async create(userId: string, chainId: string, input: CreateMomentInput): Promise<MomentResponse> {
    await this.policy.require(userId, chainId, 'editor');
    const momentId = randomUUID();
    const happenedAt = new Date(input.happenedAt);
    const storage = getStorage();
    const copiedTmp: { key: string; metadata: StorageMetadata }[] = [];

    const response = await db.transaction(async (tx) => {
      let mediaRows: Media[] = [];
      if (input.mediaIds.length > 0) {
        // 行锁：并发两个 moment 引用同一 mediaId 时，读-改-写必须串行化——
        // 后到者在锁上排队，提交后重读到的行 moment_id 非空 → 400 MEDIA_INVALID，杜绝「双发布各 copy 一半」
        mediaRows = await tx
          .select()
          .from(media)
          .where(inArray(media.id, input.mediaIds))
          .for('update');
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
      }

      await tx.insert(moments).values({
        id: momentId,
        chainId,
        authorId: userId,
        type: input.type,
        content: input.content,
        happenedAt,
        happenedTzOffset: input.happenedTzOffset,
        isBackfill: input.isBackfill,
      });

      const boundMedia: Media[] = [];
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
          .set({ s3Key: finalKey, momentId, sortOrder, storageMeta: row.storageMeta })
          .where(eq(media.id, row.id));
        boundMedia.push({ ...row, s3Key: finalKey, momentId, sortOrder });
      }

      await emitOutbox(
        tx,
        OUTBOX_MOMENT_CREATED,
        { momentId, chainId, authorId: userId, isBackfill: input.isBackfill }
      );

      const [author] = await tx
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!author) throw new NotFoundError('USER_NOT_FOUND');

      const now = new Date();
      return momentSerializer(
        {
          id: momentId,
          chainId,
          authorId: userId,
          type: input.type,
          content: input.content,
          happenedAt,
          happenedTzOffset: input.happenedTzOffset,
          isBackfill: input.isBackfill,
          createdAt: now,
        },
        boundMedia,
        author
      );
    });

    // 事务已提交：此刻删 tmp 才安全。删除失败只留下 tmp 垃圾对象（tmp/ lifecycle 7 天兜底），无数据损失。
    for (const t of copiedTmp) {
      await storage.deleteFile(t.key, t.metadata).catch((err: unknown) => {
        logger.warn(`post-commit tmp cleanup failed (lifecycle will cover): ${t.key}`, err);
      });
    }
    return response;
  }

  /** 链内时间线：viewer+，happened_at DESC, id DESC 复合游标（同时间戳跨页不丢不重）。 */
  async list(
    userId: string,
    chainId: string,
    query: { cursor?: string; limit?: string }
  ): Promise<MomentListResponse> {
    await this.policy.require(userId, chainId, 'viewer');

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const conditions = [eq(moments.chainId, chainId), isNull(moments.deletedAt)];
    if (query.cursor !== undefined) {
      const cur = decodeCursor(query.cursor);
      if (!('h' in cur)) throw new BadRequestError('INVALID_CURSOR'); // 链内列表只认 happened_at 游标
      const anchor = new Date(cur.h);
      // (happened_at, id) < (cur.h, cur.i)：严格小于锚点，或时间相等但 id 更小
      conditions.push(
        or(lt(moments.happenedAt, anchor), and(eq(moments.happenedAt, anchor), lt(moments.id, cur.i)))!
      );
    }

    const rows = await db
      .select()
      .from(moments)
      .where(and(...conditions))
      .orderBy(desc(moments.happenedAt), desc(moments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.serializeMany(page),
      nextCursor: hasMore && last ? encodeCursor({ h: last.happenedAt.getTime(), i: last.id }) : null,
    };
  }

  /** 详情：service 层反查 chainId 后走 ChainPolicy（CONVENTIONS §3.1）；软删 410。
   * 先鉴权再判软删：非成员对已删/未删一律 404，410 只对有权者暴露（防 id 枚举探测）。 */
  async get(userId: string, momentId: string): Promise<MomentResponse> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    const [serialized] = await this.serializeMany([m]);
    return serialized;
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

    await db
      .update(moments)
      .set({
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.happenedAt !== undefined ? { happenedAt: new Date(input.happenedAt) } : {}),
        ...(input.happenedTzOffset !== undefined ? { happenedTzOffset: input.happenedTzOffset } : {}),
        ...(input.isBackfill !== undefined ? { isBackfill: input.isBackfill } : {}),
        updatedAt: new Date(),
      })
      .where(eq(moments.id, momentId));
    return this.get(userId, momentId);
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

  /** 批量序列化：media 与 author 各一次 IN 查询，禁止 N+1（spec §5.1）。 */
  private async serializeMany(rows: Moment[]): Promise<MomentResponse[]> {
    if (rows.length === 0) return [];
    const mediaRows = await db
      .select()
      .from(media)
      .where(
        inArray(
          media.momentId,
          rows.map((r) => r.id)
        )
      );
    const mediaByMoment = new Map<string, Media[]>();
    for (const m of mediaRows) {
      if (!m.momentId) continue;
      const list = mediaByMoment.get(m.momentId) ?? [];
      list.push(m);
      mediaByMoment.set(m.momentId, list);
    }
    const authorRows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(
        inArray(
          users.id,
          [...new Set(rows.map((r) => r.authorId))]
        )
      );
    const authorById = new Map(authorRows.map((a) => [a.id, a]));
    return rows.map((r) =>
      momentSerializer(
        r,
        mediaByMoment.get(r.id) ?? [],
        authorById.get(r.authorId) ?? { id: r.authorId, nickname: '' }
      )
    );
  }
}
