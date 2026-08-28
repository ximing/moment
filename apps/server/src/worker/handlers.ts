import { MAX_AUDIO_BYTES } from '@moment/dto';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { Container } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains, comments, media, moments, recaps, users } from '../db/schema.js';
import { getASRProvider } from '../llm/asr/factory.js';
import { NonRetryableLLMError } from '../llm/base.provider.js';
import { getLLMProvider } from '../llm/factory.js';
import { getGeocodeProvider } from '../geocode/factory.js';
import { generateRecap } from '../llm/recap/generate.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  NOTIFICATION_COMMENT_CREATED,
  NOTIFICATION_MOMENT_CREATED,
  NOTIFICATION_REACTION_CREATED,
  NOTIFICATION_RECAP_READY,
} from '../notifications/types.js';
import type { PushService } from '../push/push-service.js';
import { getStorage } from '../storage/factory.js';

export type OutboxHandler = (payload: Record<string, unknown>, deps: { push: PushService }) => Promise<void>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** moment 文本摘要（payload 快照用，spec §3：删除后通知仍可展示） */
function summarize(content: string, max = 50): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

/** 快照三件套：链名 + 行为人昵称 + 摘要（一次 IN 查询）。 */
async function loadSnapshot(chainId: string, actorIds: string[]): Promise<{
  chainName: string;
  nicknames: Map<string, string>;
}> {
  const [chain] = await db.select({ name: chains.name }).from(chains).where(eq(chains.id, chainId)).limit(1);
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  return { chainName: chain?.name ?? '', nicknames: new Map(actorRows.map((a) => [a.id, a.nickname])) };
}

function notificationService(): NotificationService {
  return Container.get(NotificationService);
}

/** moment.created：链全体成员（除作者）。is_backfill=true 跳过 push 但仍插通知（spec §5.6/§5.4）。 */
export const handleMomentCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);
  const isBackfill = payload.isBackfill === true;

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return; // 已删：通知不补发

  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId).filter((uid) => uid !== authorId);
  if (targets.length === 0) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  // voice 发布时 content 通常为空：推送摘要用固定文案兜底（spec §3.4）；转写完成后不二次通知（spec §0 搁置）
  const emptyVoice = m.type === 'voice' && m.content.trim().length === 0;
  const summary = emptyVoice ? '[语音]' : summarize(m.content);
  const bodySummary = emptyVoice ? '[语音]' : summarize(m.content, 30);
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_MOMENT_CREATED,
    payload: {
      momentId,
      chainId,
      chainName,
      actorNickname,
      summary,
      backfill: isBackfill,
      title: chainName || '时刻',
      body: `${actorNickname} 发布了新动态：${bodySummary}`,
      data: { momentId, chainId },
    },
    push: !isBackfill,
  });
};

/** comment.created：仅 moment 作者（评论者本人不通知，spec §5.4）。 */
export const handleCommentCreated: OutboxHandler = async (payload, deps) => {
  const commentId = str(payload.commentId);
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === authorId) return;

  const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!c || c.deletedAt) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_COMMENT_CREATED,
    payload: {
      momentId,
      chainId,
      commentId,
      chainName,
      actorNickname,
      summary: summarize(c.content),
      title: chainName || '时刻',
      body: `${actorNickname} 评论了你的时刻：${summarize(c.content, 30)}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/** reaction.created：仅 moment 作者（本人不通知）。 */
export const handleReactionCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const userId = str(payload.userId);
  const emoji = str(payload.emoji);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === userId) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [userId]);
  const actorNickname = nicknames.get(userId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_REACTION_CREATED,
    payload: {
      momentId,
      chainId,
      emoji,
      chainName,
      actorNickname,
      title: chainName || '时刻',
      body: `${actorNickname} 给你的时刻点了 ${emoji}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/**
 * moment.deleted：只把该 moment 的 ready media 标记为 orphaned（幂等），不物理删——
 * 物理清理由 sweeper 按 30 天保留期执行（spec §5.5「sweeper 延迟物理清理」）。
 */
export const handleMomentDeleted: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;
  await db
    .update(media)
    .set({ status: 'orphaned', orphanedAt: new Date() })
    .where(and(eq(media.momentId, momentId), eq(media.status, 'ready')));
};

/** 转写文本截断上限：对齐 dto content max(5000)——worker 回填绕过 API 校验，
 *  不截断会落出 API 写不出的值，破坏契约对称（spec §4.3 步骤 5）。 */
const TRANSCRIPT_MAX_CHARS = 5000;

/** 地名截断上限：对齐 moments.place_name varchar(255) 与 dto place name max(255)——
 *  worker 回填绕过 API 校验，不截断会落出 API 写不出的值（同 TRANSCRIPT_MAX_CHARS 范式）。 */
const PLACE_NAME_MAX_CHARS = 255;

/** DashScope 异步拉取源文件：覆盖 5 分钟 provider 等待并留 55 分钟排队/下载余量。 */
export const ASR_SOURCE_URL_TTL_SECONDS = 3_600;

/**
 * 有界读取下载响应：header 可提前拒绝，但不能只信 header；无/伪造长度时仍按流累计。
 * 返回 null 表示对象超限。超限后立即 cancel，避免继续从远端拉取剩余字节。
 */
async function readAudioResponse(resp: Response): Promise<Buffer | null> {
  const contentLength = resp.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_AUDIO_BYTES) {
      await resp.body?.cancel().catch(() => undefined);
      return null;
    }
  }

  if (!resp.body) return Buffer.alloc(0);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

/** 落 failed 终态：仅当前仍 pending 才写（防与并发成功路径互相覆盖）。 */
async function markTranscriptionFailed(momentId: string): Promise<void> {
  await db
    .update(moments)
    .set({ transcriptionStatus: 'failed' })
    .where(and(eq(moments.id, momentId), eq(moments.transcriptionStatus, 'pending')));
}

/**
 * moment.transcribe（spec voice-moment §4.3）：voice moment 的 ASR 异步转写回填。
 * 失败语义：RetryableLLMError 传播给 processor 退避；NonRetryableLLMError / 停用 / 异常态自落 failed；
 * 悬挂 pending 由 sweeper 6h cutoff 兜底（§4.4）。任何失败都不影响 moment 存在与语音播放。
 * 转写完成后不扇出通知（§0 搁置决策）。
 */
export const handleMomentTranscribe: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  // 步骤 1：幂等 + 竞态防御——不存在 / 已软删 / 非 voice / 非 pending 直接返回
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt || m.type !== 'voice' || m.transcriptionStatus !== 'pending') return;

  // 步骤 2：查该 moment 的 audio/* media 行；不存在（异常态）→ failed
  const [audioRow] = await db
    .select()
    .from(media)
    .where(and(eq(media.momentId, momentId), like(media.mime, 'audio/%')))
    .limit(1);
  if (!audioRow) {
    await markTranscriptionFailed(momentId);
    return;
  }

  // 步骤 3：部署方停用转写 → failed 正常返回（不占重试额度；create 恒 emit、handler 判 null 的取舍见 spec §0）
  const provider = getASRProvider();
  if (!provider) {
    await markTranscriptionFailed(momentId);
    return;
  }

  // 步骤 4：同一 3600 秒预签名 GET URL 先做 25MB 有界下载防御，再交给 DashScope 自行拉取。
  // 网络/非 2xx 抛普通 Error（processor 对任何抛出都退避）；响应字节超限则落 failed。
  const fileUrl = await getStorage().generateAccessUrl(
    audioRow.s3Key,
    audioRow.storageMeta,
    ASR_SOURCE_URL_TTL_SECONDS,
  );
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`audio download failed: ${resp.status}`);
  const boundedAudio = await readAudioResponse(resp);
  if (!boundedAudio) {
    await markTranscriptionFailed(momentId);
    return;
  }
  // boundedAudio 仅用于 25MB 防御；DashScope 必须自行读取同一预签名 GET URL。

  // 步骤 5：转写 + 落库
  try {
    const { text } = await provider.transcribe({ fileUrl });
    const truncated = text.slice(0, TRANSCRIPT_MAX_CHARS);
    // 成功（含空文本）→ done + transcript；content 条件回填：用户可能在转写完成前已手动编辑，
    // 不覆盖用户输入（SET content WHERE content=''）。CAS 在 IO 后重新校验终态，避免迟到结果覆盖
    // 并发 failed / 软删 / 已完成；只有抢占 pending 成功后才回填 content。
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(moments)
        .set({ transcript: truncated, transcriptionStatus: 'done' })
        .where(
          and(
            eq(moments.id, momentId),
            isNull(moments.deletedAt),
            eq(moments.type, 'voice'),
            eq(moments.transcriptionStatus, 'pending'),
          ),
        );
      if (result.affectedRows === 0) return;
      await tx
        .update(moments)
        .set({ content: truncated })
        .where(and(eq(moments.id, momentId), eq(moments.content, '')));
    });
  } catch (err) {
    // NonRetryable：自落终态、不占 processor 退避额度（对齐 recap 范式）；Retryable 及其他抛出 → 传播退避
    if (err instanceof NonRetryableLLMError) {
      await markTranscriptionFailed(momentId);
      return;
    }
    throw err;
  }
};

/**
 * moment.geocode（spec people-place §4）：逆地理编码回填 place_name。
 * 流程：重读 moment（不存在/已软删 → done 跳过，对齐既有 handler 范式）→
 * provider null（AMAP_WEB_KEY 空，部署停用）→ done 跳过（坐标照存、place_name 留空，管线不阻断）→
 * 仅当 place_source 仍为 'exif' 且 place_name 为空才调 reverse（用户后续手动编辑/AI 回填不被覆盖，
 * spec §5 优先级 manual > exif > ai）→ 成功后条件 UPDATE 回填（WHERE 再校验 exif + 空名 + 未软删，
 * IO 后竞态防御，对齐 transcribe 的 CAS 范式）。
 *
 * 坐标以重读的行为准：payload.lat/lng 是发射时快照，不消费（计划偏差 4）。
 * 失败语义（计划偏差 3）：provider 抛错一律传播——processor 既有 5 档指数退避，
 * attempts>5 由 processor 记 error 日志并标 failed（终败仅记日志，不重派；outbox 行状态即唯一记录）。
 * 与 transcribe 的「NonRetryable 自落 failed」不同范式：geocode 无 moment 终态列可自落，
 * 且高德 status!=='1' 混杂永久/时变错误（配额次日重置、限流），提前 done 会静默丢可恢复行。
 */
export const handleMomentGeocode: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  // 步骤 1：幂等 + 软删竞态防御——不存在 / 已软删直接返回（spec §4/§5）
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  // 步骤 2：部署方停用（AMAP_WEB_KEY 空）→ 消费即跳过（坐标照存、place_name 留空）
  const provider = getGeocodeProvider();
  if (!provider) return;

  // 步骤 3：前置形态守卫——非 exif / 名已非空 / 坐标列异常 → 跳过（不浪费远端调用）
  if (m.placeSource !== 'exif' || m.placeName !== null || m.placeLat === null || m.placeLng === null) {
    return;
  }

  // 步骤 4：逆地理（入参 WGS-84，GCJ-02 换算是 provider 内部细节）
  const raw = await provider.reverse(m.placeLat, m.placeLng);
  if (raw === null) return; // 确定无地址：done，place_name 留空

  // 步骤 5：截断 + 条件回填（IO 后再校验 exif + 空名 + 未软删，防迟到结果覆盖并发手动编辑）
  const name = raw.slice(0, PLACE_NAME_MAX_CHARS);
  await db
    .update(moments)
    .set({ placeName: name })
    .where(
      and(
        eq(moments.id, momentId),
        isNull(moments.deletedAt),
        eq(moments.placeSource, 'exif'),
        isNull(moments.placeName),
      ),
    );
};

/**
 * recap.generate（spec §1）：调 generateRecap 生成回顾，成功后扇出 recap.ready 通知。
 *
 * 重试分类现由 generateRecap 内部处理（p3）：
 * - NonRetryableLLMError：generateRecap 自己落 failed 行后正常返回（不 rethrow，让 outbox 标 done，
 *   避免占 processor 5 次退避额度——见 p3 generate.ts，与 parse 失败同范式）。
 * - RetryableLLMError：generateRecap 不 catch，传播给 handler → processor 退避。
 * 故 handler 不再 try/catch，只负责 fanout。
 *
 * provider 为 null（空 key 停用）时**不再 no-op 跳过**：自动 sweep 已在空 key 时 skip 派发
 * （recap-scheduler.ts，spec §3「扫描照常但跳过派发」），故 handler 正常不会收到 null provider。
 * null 到达 handler 的唯一场景：手动 regenerate API（POST .../regenerate）在空 key 部署触发 outbox。
 * 此时 generateRecap 走降级路径（规则文案，不调 LLM，无内容出域，spec §5）+ 扇出——用户显式请求回顾时
 * 给降级版是合理 UX。retryable 传播给 processor 退避。
 *
 * handler 内直接 fanoutNotifications（对齐 handleMomentCreated 范式，非 spec §1 的「第二条 outbox」——
 * spec §1 是抽象层描述，codebase 既有范式是 handler 内直接 fanout，注明偏差）。
 */
export const handleRecapGenerate: OutboxHandler = async (payload, deps) => {
  const chainId = str(payload.chainId);
  const period = str(payload.period);
  if (!chainId || !period) return;

  // provider 可能为 null（空 key 停用）→ generateRecap 内部走降级路径（status=degraded）。
  // generateRecap 拥有所有 recaps 行写入与重试分类；handler 只负责 fanout。
  const provider = getLLMProvider();
  // RetryableLLMError 传播给 processor 退避（不 try/catch，传播即可）
  await generateRecap(chainId, period, { provider });

  // 成功后查 status，仅 ready/degraded 扇出（spec §5：failed 不推送；generating 不应出现）
  const [recap] = await db
    .select({ status: recaps.status })
    .from(recaps)
    .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
    .limit(1);
  if (!recap || (recap.status !== 'ready' && recap.status !== 'degraded')) return;

  // 链全体成员（复用 handleMomentCreated 的成员查询范式）
  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId);
  if (targets.length === 0) return;

  const { chainName } = await loadSnapshot(chainId, []);
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_RECAP_READY,
    payload: {
      chainId,
      period,
      chainName,
      // recap_ready 无 momentId → fanoutNotifications 跳过去重直接插行（既有语义）
      title: chainName || '时刻',
      body: `${chainName} 的 ${period} 回顾出炉了`,
      data: { chainId, period },
    },
    push: true,
  });
};

/** 注册表：processor 按 outbox.type 分发。 */
export const handlers: Record<string, OutboxHandler> = {
  'moment.created': handleMomentCreated,
  'comment.created': handleCommentCreated,
  'reaction.created': handleReactionCreated,
  'moment.deleted': handleMomentDeleted,
  'recap.generate': handleRecapGenerate,
  'moment.transcribe': handleMomentTranscribe,
  'moment.geocode': handleMomentGeocode,
};
