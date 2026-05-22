import { z } from 'zod';

export const pushPlatformSchema = z.enum(['ios', 'android', 'web']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const registerPushTokenSchema = z.object({
  /** Expo push token，形如 ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]，≤128 字符（spec §3） */
  expoToken: z.string().min(16).max(128),
  platform: pushPlatformSchema,
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export interface NotificationDto {
  id: string;
  /** 通知类型（'moment.created' | 'comment.created' | 'reaction.created'，可扩展） */
  type: string;
  /** 标题快照（链名/行为人昵称/摘要等，spec §3：moment 删除后仍可展示） */
  payload: Record<string, unknown>;
  /** ISO 8601，未读为 null */
  readAt: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationDto[];
  nextCursor: string | null;
}
