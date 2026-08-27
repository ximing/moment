import mime from 'mime-types';
import { eq, inArray, or } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from 'routing-controllers';
import { IMAGE_MIME_TYPES } from '@moment/dto';
import { chains, media, users, type Chain, type Media } from '../db/schema.js';
import type { DbTx } from '../outbox/outbox.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { logger } from '../utils/logger.js';
import type { ChainAppearancePatch } from './chain-appearance.js';

/** 一次绑定产生的 tmp→final copy 记录（post-commit 清 tmp / rollback 清 final 共用）。 */
export interface ChainMediaCopy {
  mediaId: string;
  tmpKey: string;
  finalKey: string;
  storageMeta: StorageMetadata;
}

export interface ChainMediaBinding {
  copies: ChainMediaCopy[];
  /** 本次被替换掉的旧 avatar/cover media id（已在事务内标 orphaned） */
  replacedIds: string[];
}

/**
 * 事务内绑定链头像/封面媒体（设计 §5）：
 * 1. 待绑定 media 行 FOR UPDATE（并发绑定串行，后到者读到已绑定状态报错）；
 * 2. 校验 uploader、status=ready、momentId 为空、raster MIME 白名单、users/chains 无其他引用；
 * 3. tmp → final copy：`chains/{chainId}/{placement}/{mediaId}.{ext}`（按行上 storageMeta 在源桶内 copy）；
 * 4. 更新 media.s3Key；update 路径随后由本函数写入链引用 patch；
 * 5. 被替换的旧 media 在新链引用写成功后才标 orphaned + orphanedAt（同事务）。
 *
 * 相同当前 id 幂等：不 copy、不标自身 orphaned（焦点更新由 patch 携带）。
 * create 路径传 current=null：链行由调用方 insert（携带 patch），本函数只负责锁/copy/media 行更新。
 *
 * `binding` 由调用方持有并逐步累积：每次 copy 成功立即入账，因此中途抛错（如第二次 copy
 * 失败导致事务回滚）时，调用方仍能拿到已产生的 final 对象做 rollback 补偿删除。
 */
export async function bindChainMedia(
  tx: DbTx,
  args: {
    chainId: string;
    userId: string;
    current: Chain | null;
    patch: ChainAppearancePatch;
    binding: ChainMediaBinding;
  },
): Promise<ChainMediaBinding> {
  const { chainId, userId, current, patch, binding } = args;
  const binds: { placement: 'avatar' | 'cover'; id: string }[] = [];
  if (typeof patch.avatarMediaId === 'string' && patch.avatarMediaId !== current?.avatarMediaId) {
    binds.push({ placement: 'avatar', id: patch.avatarMediaId });
  }
  if (typeof patch.coverMediaId === 'string' && patch.coverMediaId !== current?.coverMediaId) {
    binds.push({ placement: 'cover', id: patch.coverMediaId });
  }
  // avatar!=cover 由 normalize 层保证；此处防御（并发下 current 可能滞后）
  if (binds.length === 2 && binds[0]!.id === binds[1]!.id) {
    throw new BadRequestError('CHAIN_MEDIA_DUPLICATED');
  }

  if (binds.length > 0) {
    const rows = await tx
      .select()
      .from(media)
      .where(inArray(media.id, binds.map((b) => b.id)))
      .for('update');
    const byId = new Map<string, Media>(rows.map((r) => [r.id, r]));

    // 先全量校验再 copy：任一失败不留下半截 copy 状态
    for (const bind of binds) {
      const row = byId.get(bind.id);
      // 不存在与非本人统一 404，不泄露存在性
      if (!row || row.uploaderId !== userId) throw new NotFoundError('MEDIA_NOT_FOUND');
      if (row.status !== 'ready') throw new BadRequestError('MEDIA_INVALID');
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(row.mime)) {
        throw new BadRequestError('MEDIA_INVALID');
      }
      if (row.momentId) throw new BadRequestError('MEDIA_ALREADY_BOUND');
      const [boundUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.avatarMediaId, row.id))
        .limit(1);
      if (boundUser) throw new BadRequestError('MEDIA_ALREADY_BOUND');
      const [boundChain] = await tx
        .select({ id: chains.id })
        .from(chains)
        .where(or(eq(chains.avatarMediaId, row.id), eq(chains.coverMediaId, row.id)))
        .limit(1);
      if (boundChain) throw new BadRequestError('MEDIA_ALREADY_BOUND');
    }

    const storage = getStorage();
    for (const bind of binds) {
      const row = byId.get(bind.id)!;
      // mime-types 的 extension() 对未知 mime 返回 false，必须用 || 兜底
      const finalKey = `chains/${chainId}/${bind.placement}/${row.id}.${mime.extension(row.mime) || 'bin'}`;
      await storage.copyObject(row.s3Key, finalKey, row.storageMeta);
      binding.copies.push({ mediaId: row.id, tmpKey: row.s3Key, finalKey, storageMeta: row.storageMeta });
      await tx.update(media).set({ s3Key: finalKey }).where(eq(media.id, row.id));
    }
  }

  // update 路径：链引用 patch 由本函数写入（create 路径由调用方 insert 携带 patch）
  if (current) {
    await tx.update(chains).set(patch).where(eq(chains.id, chainId));
  }

  // 旧媒体只在新链引用写成功后标 orphaned（同事务，设计 §5 step 6）
  if (current) {
    if (
      patch.avatarMediaId !== undefined &&
      current.avatarMediaId !== null &&
      current.avatarMediaId !== patch.avatarMediaId
    ) {
      binding.replacedIds.push(current.avatarMediaId);
    }
    if (
      patch.coverMediaId !== undefined &&
      current.coverMediaId !== null &&
      current.coverMediaId !== patch.coverMediaId
    ) {
      binding.replacedIds.push(current.coverMediaId);
    }
    if (binding.replacedIds.length > 0) {
      await tx
        .update(media)
        .set({ status: 'orphaned', orphanedAt: new Date() })
        .where(inArray(media.id, binding.replacedIds));
    }
  }

  return binding;
}

/** 事务提交成功后调用：best-effort 删除 tmp 对象（失败由 tmp/ bucket lifecycle 兜底）。 */
export async function cleanupBoundMedia(binding: ChainMediaBinding): Promise<void> {
  const storage = getStorage();
  for (const copy of binding.copies) {
    await storage.deleteFile(copy.tmpKey, copy.storageMeta).catch((err: unknown) => {
      logger.warn('chain media tmp cleanup failed（tmp/ lifecycle 兜底）', {
        mediaId: copy.mediaId,
        tmpKey: copy.tmpKey,
        err: String(err),
      });
    });
  }
}

/**
 * 事务回滚后调用：best-effort 删除本次 copy 出的 final 对象。
 * 补偿失败只留下不可达对象，记录带 mediaId/finalKey 的告警，不丢当前链图片（设计 §5）。
 */
export async function rollbackBoundMedia(binding: ChainMediaBinding): Promise<void> {
  const storage = getStorage();
  for (const copy of binding.copies) {
    await storage.deleteFile(copy.finalKey, copy.storageMeta).catch((err: unknown) => {
      logger.warn('chain media rollback cleanup failed（留下不可达对象）', {
        mediaId: copy.mediaId,
        finalKey: copy.finalKey,
        err: String(err),
      });
    });
  }
}
