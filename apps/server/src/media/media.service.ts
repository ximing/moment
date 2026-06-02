import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { and, eq } from 'drizzle-orm';
import { HttpError, NotFoundError, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_PART_SIZE,
  type MediaCompleteInput,
  type MediaCompleteResponse,
  type MediaPartsInput,
  type MediaPartsResponse,
  type MediaPresignInput,
  type MediaPresignResponse,
  type UserProfile,
} from '@moment/dto';
import { ChainPolicy } from '../chains/chain-policy.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, moments, type Media } from '../db/schema.js';
import { ShareLinkService } from '../share/share-link.service.js';
import { currentStorageMeta, getStorage } from '../storage/factory.js';
import { alignedGetPresign } from './presign-ttl.js';

/** 读取「存在且属于该用户」的 media；不区分不存在与非本人，避免 mediaId 探测。 */
async function getOwnedMediaOr404(userId: string, mediaId: string): Promise<Media> {
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || row.uploaderId !== userId) throw new NotFoundError('MEDIA_NOT_FOUND');
  return row;
}

@Service()
export class MediaService {
  constructor(
    private readonly policy: ChainPolicy,
    private readonly shareLinks: ShareLinkService
  ) {}

  /**
   * 预签名申请（spec §3 事务边界：先插 media(status='uploading', tmp key) 行再返 URL）。
   * 取舍声明：「插行 → initMultipart → update」非单事务——update 失败会留下已开启但 uploadId
   * 未落库的 S3 multipart 会话（泄漏）；initMultipart 失败则行停留 uploading。两者均由
   * Phase 8 lifecycle/sweeper 按「uploading 超 24h」兜底清理，本阶段不做补偿。
   */
  async presign(userId: string, input: MediaPresignInput): Promise<MediaPresignResponse> {
    if (input.kind === 'image' && input.size > MAX_IMAGE_BYTES) {
      throw new HttpError(413, 'MEDIA_TOO_LARGE');
    }
    if (input.kind === 'video' && input.size > MAX_VIDEO_BYTES) {
      throw new HttpError(413, 'MEDIA_TOO_LARGE');
    }

    const mediaId = randomUUID();
    // mime-types 的 extension() 对未知 mime 返回 false（不只是 null），必须用 || 兜底
    const ext = mime.extension(input.mime) || 'bin';
    const tmpKey = `tmp/${mediaId}.${ext}`;

    await db.insert(media).values({
      id: mediaId,
      momentId: null,
      uploaderId: userId,
      s3Key: tmpKey,
      mime: input.mime,
      size: input.size,
      width: null,
      height: null,
      duration: input.durationSeconds ?? null,
      posterMediaId: null,
      sortOrder: input.sortOrder ?? 0,
      status: 'uploading',
      storageMeta: currentStorageMeta(),
      uploadId: null,
    });

    if (input.kind === 'image') {
      const url = await getStorage().presignPut(
        tmpKey,
        { contentType: input.mime },
        config.PRESIGN_PUT_TTL_SECONDS
      );
      return { mediaId, method: 'put', url, uploadId: null, partSize: null };
    }

    const uploadId = await getStorage().initMultipart(tmpKey, { contentType: input.mime });
    await db.update(media).set({ uploadId }).where(eq(media.id, mediaId));
    return { mediaId, method: 'multipart', url: null, uploadId, partSize: VIDEO_PART_SIZE };
  }

  /** 逐 part 预签名（仅 uploader 本人；断点续传 = 客户端按 part 重试/补签） */
  async presignParts(
    userId: string,
    mediaId: string,
    input: MediaPartsInput
  ): Promise<MediaPartsResponse> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status !== 'uploading' || !row.uploadId) {
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }
    const urls = await Promise.all(
      input.partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getStorage().presignPart(
          row.s3Key,
          row.uploadId!,
          partNumber,
          config.PRESIGN_PUT_TTL_SECONDS
        ),
        expiresIn: config.PRESIGN_PUT_TTL_SECONDS,
      }))
    );
    return { mediaId, partSize: VIDEO_PART_SIZE, urls };
  }

  /**
   * complete：multipart 先合片（parts 在 **service 层**按 partNumber 升序排序——S3
   * CompleteMultipartUpload 的硬性要求，契约钉在此处，不依赖 adapter 实现）；HeadObject
   * 校验存在 + size/mime 与申请一致；状态推进用条件更新抢占（`WHERE status='uploading'`），
   * 防与 abort/发布绑定的并发读-改-写竞态。幂等：ready 状态重复调用直接返回相同结果，
   * 不再触达 S3（spec §5.5）。「S3 已合片但 HeadObject 校验 422（状态停留 uploading）」的
   * 中间态也在幂等声明覆盖内：合片成功即置 uploadId=null 持久化，重试跳过合片只做 HeadObject
   * （否则再调 completeMultipart 会打出 S3 NoSuchUpload → 500）。
   * 若持久化 uploadId=null 本身失败（crash window），重试仍带旧 uploadId，completeMultipart
   * 会打出 NoSuchUpload → 500，客户端回退重新 presign。
   */
  async complete(
    userId: string,
    mediaId: string,
    input: MediaCompleteInput
  ): Promise<MediaCompleteResponse> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status === 'ready') {
      return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
    }
    if (row.status !== 'uploading') {
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }

    if (row.uploadId) {
      // 空 parts 打到 S3 是 InvalidRequest（500），与图片分支对称地拒绝
      if (input.parts.length === 0) throw new HttpError(400, 'MEDIA_INVALID');
      // 请求原序可能是乱序（客户端并发上传），S3 要求严格升序；adapter 内仍保留排序作纵深防御
      const sortedParts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
      await getStorage().completeMultipart(row.s3Key, row.uploadId, sortedParts);
      // 合片成功即消费掉 S3 上传会话：立即持久化 uploadId=null。此后任何失败（HeadObject 422、
      // DB 推进失败）留下的 uploading 行重入时走「无 uploadId」路径——跳过合片只做 HeadObject。
      await db.update(media).set({ uploadId: null }).where(eq(media.id, mediaId));
    } else if (input.parts.length > 0 && !row.mime.startsWith('video/')) {
      // 图片行携带 parts → 拒绝；video 行的 uploadId 已因合片完成被置空，重试携带 parts
      // 不再视为错误（parts 被忽略，仅做 HeadObject 校验——见上方幂等声明）。
      throw new HttpError(400, 'MEDIA_INVALID');
    }

    const head = await getStorage().headObject(row.s3Key);
    if (!head || head.size !== row.size || head.contentType !== row.mime) {
      throw new HttpError(422, 'MEDIA_MISMATCH');
    }

    // 条件更新抢占：仅 uploading → ready 生效，避免与并发 abort/绑定的丢失更新。
    // drizzle mysql2 的 update 返回 [ResultSetHeader]，affectedRows 可判断是否抢到。
    const [result] = await db
      .update(media)
      .set({ status: 'ready' })
      .where(and(eq(media.id, mediaId), eq(media.status, 'uploading')));
    if (result.affectedRows === 0) {
      // 并发下已被推进：若他方已置 ready，按幂等语义返回成功；否则（orphaned/被绑定）409
      const [now] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
      if (now?.status === 'ready') {
        return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
      }
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }
    return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
  }

  /**
   * abort：合片会话作废 + 状态 orphaned（幂等）。
   * 状态守卫：仅 `uploading` 可 abort。`ready` 是终态——视频的 uploadId 已完成合片，
   * abortMultipart 会打出 S3 NoSuchUpload（500）；图片无 uploadId 会被直接置 orphaned，
   * 把已上传可发布的媒体永久作废（complete 幂等分支只认 ready）。故 ready 一律 409。
   * 图片单 PUT 的 uploading 状态也允许 abort 作废记录。
   * 先条件更新抢占行（`WHERE status='uploading'` → orphaned），再 abortMultipart：
   * 抢不到（affectedRows=0）说明他方已推进，按幂等语义直接返回，避免覆盖 ready 终态。
   * 竞态：并发 complete 可能已消费 uploadId（合片成功），本请求抢到 uploading 行后
   * abortMultipart 会打出 S3 NoSuchUpload → 500；客户端视 abort 失败即可。
   */
  async abort(userId: string, mediaId: string): Promise<void> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status === 'orphaned') return;
    if (row.status !== 'uploading') throw new HttpError(409, 'MEDIA_INVALID_STATE');
    const [result] = await db
      .update(media)
      .set({ status: 'orphaned' })
      .where(and(eq(media.id, mediaId), eq(media.status, 'uploading')));
    if (result.affectedRows === 0) return;
    if (row.uploadId) {
      await getStorage().abortMultipart(row.s3Key, row.uploadId);
    }
  }

  /**
   * 鉴权后返回预签名 GET URL（302 目标）：
   * - st !== undefined：share token 透传路径（spec §5.3），忽略登录态；
   * - 无 st：登录 + 成员/uploader 校验（Phase 3 原语义）；
   * - 已绑定 moment：moment 未软删时校验所属链 viewer；未绑定：仅 uploader 本人。
   */
  async resolveAccessUrl(user: UserProfile | null, mediaId: string, st?: string): Promise<string> {
    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row || row.status !== 'ready') throw new NotFoundError('MEDIA_NOT_FOUND');

    if (st !== undefined) {
      await this.assertShareAccess(st, row);
    } else {
      if (!user) throw new UnauthorizedError('UNAUTHORIZED');
      if (row.momentId) {
        const [m] = await db
          .select({ chainId: moments.chainId, deletedAt: moments.deletedAt })
          .from(moments)
          .where(eq(moments.id, row.momentId))
          .limit(1);
        if (!m || m.deletedAt) throw new NotFoundError('MEDIA_NOT_FOUND');
        await this.policy.require(user.id, m.chainId, 'viewer');
      } else if (row.uploaderId !== user.id) {
        throw new NotFoundError('MEDIA_NOT_FOUND');
      }
    }

    const { signingDate, expiresIn } = alignedGetPresign();
    return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, expiresIn, signingDate);
  }

  /** share token 透传：token 有效 + media 绑定该链未软删 moment → 放行；其余一律 404，不泄露存在性。 */
  private async assertShareAccess(token: string, row: Media): Promise<void> {
    const link = await this.shareLinks.findValidByToken(token);
    if (!link) throw new NotFoundError('SHARE_NOT_FOUND');
    if (!row.momentId) throw new NotFoundError('MEDIA_NOT_FOUND');
    const [m] = await db
      .select({ chainId: moments.chainId, deletedAt: moments.deletedAt })
      .from(moments)
      .where(eq(moments.id, row.momentId))
      .limit(1);
    if (!m || m.deletedAt || m.chainId !== link.chainId) {
      throw new NotFoundError('MEDIA_NOT_FOUND'); // 跨链媒体拒绝
    }
  }
}
