/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加。 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';
export const OUTBOX_COMMENT_CREATED = 'comment.created';
export const OUTBOX_REACTION_CREATED = 'reaction.created';

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED
  | typeof OUTBOX_COMMENT_CREATED
  | typeof OUTBOX_REACTION_CREATED;
