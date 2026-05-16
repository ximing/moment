import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { eq, inArray } from 'drizzle-orm';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import type { CreateMomentInput, MomentResponse } from '@moment/dto';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { media, moments, users, type Media } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_CREATED } from '../outbox/types.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { logger } from '../utils/logger.js';
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
}
