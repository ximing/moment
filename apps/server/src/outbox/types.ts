/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加。 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';
export const OUTBOX_MOMENT_TRANSCRIBE = 'moment.transcribe';
export const OUTBOX_COMMENT_CREATED = 'comment.created';
export const OUTBOX_REACTION_CREATED = 'reaction.created';
export const OUTBOX_INVITE_CREATED = 'invite.created';
export const OUTBOX_RECAP_GENERATE = 'recap.generate';
/** 逆地理编码（spec people-place §4）：payload {momentId, lat, lng}（WGS-84；P2 moments 写路径发射，P3 worker 消费） */
export const OUTBOX_MOMENT_GEOCODE = 'moment.geocode';
/** AI 文本抽取（spec people-place §5）：payload {momentId}（camelCase，P2 偏差 1 同款）；
 *  P4 moments 写路径与 transcribe 回填发射，P4 worker 消费 */
export const OUTBOX_MOMENT_EXTRACT = 'moment.extract';

/** 派生图压缩（spec fused-retrieval §2.3）：payload camelCase { momentId, chainId, mediaId }；handler 属 P3 */
export const OUTBOX_MOMENT_COMPRESS = 'moment.compress';
export interface MomentCompressPayload {
  momentId: string;
  chainId: string;
  mediaId: string;
}

/** 向量嵌入（spec fused-retrieval §2.3）：payload camelCase { momentId, chainId }；handler 属 P5 */
export const OUTBOX_MOMENT_EMBED = 'moment.embed';
export interface MomentEmbedPayload {
  momentId: string;
  chainId: string;
}

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED
  | typeof OUTBOX_MOMENT_TRANSCRIBE
  | typeof OUTBOX_COMMENT_CREATED
  | typeof OUTBOX_REACTION_CREATED
  | typeof OUTBOX_INVITE_CREATED
  | typeof OUTBOX_RECAP_GENERATE
  | typeof OUTBOX_MOMENT_GEOCODE
  | typeof OUTBOX_MOMENT_EXTRACT
  | typeof OUTBOX_MOMENT_COMPRESS
  | typeof OUTBOX_MOMENT_EMBED;
