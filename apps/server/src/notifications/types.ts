/** 通知类型（spec §5.4：维度可扩展，为链免打扰预留；不与 outbox 类型耦合） */
export const NOTIFICATION_MOMENT_CREATED = 'moment.created';
export const NOTIFICATION_COMMENT_CREATED = 'comment.created';
export const NOTIFICATION_REACTION_CREATED = 'reaction.created';
export const NOTIFICATION_RECAP_READY = 'recap.ready';

export type NotificationType =
  | typeof NOTIFICATION_MOMENT_CREATED
  | typeof NOTIFICATION_COMMENT_CREATED
  | typeof NOTIFICATION_REACTION_CREATED
  | typeof NOTIFICATION_RECAP_READY;
