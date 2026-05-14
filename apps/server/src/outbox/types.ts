/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加 'comment.created' 等 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED;
