/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加。 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';
export const OUTBOX_MOMENT_TRANSCRIBE = 'moment.transcribe';
export const OUTBOX_COMMENT_CREATED = 'comment.created';
export const OUTBOX_REACTION_CREATED = 'reaction.created';
export const OUTBOX_RECAP_GENERATE = 'recap.generate';
/** 逆地理编码（spec people-place §4）：payload {momentId, lat, lng}（WGS-84；P2 moments 写路径发射，P3 worker 消费） */
export const OUTBOX_MOMENT_GEOCODE = 'moment.geocode';

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED
  | typeof OUTBOX_MOMENT_TRANSCRIBE
  | typeof OUTBOX_COMMENT_CREATED
  | typeof OUTBOX_REACTION_CREATED
  | typeof OUTBOX_RECAP_GENERATE
  | typeof OUTBOX_MOMENT_GEOCODE;
