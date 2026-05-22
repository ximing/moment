import { Expo } from 'expo-server-sdk';
import { logger } from '../utils/logger.js';
import type { PushMessage, PushSendOutcome, PushService } from './push-service.js';

interface ExpoTicketLike {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}
interface ExpoReceiptLike {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * 最小 Expo 客户端形状（测试注入 fake 用）。
 * 真实 expo-server-sdk@3.15：`isExpoPushToken` 仅为 static；receipts 为 `{ [id]: receipt }` 且无 id 字段。
 */
export interface ExpoClientLike {
  isExpoPushToken?(token: string): boolean;
  chunkPushNotifications(messages: unknown[]): unknown[][];
  sendPushNotificationsAsync(chunk: unknown[]): Promise<ExpoTicketLike[]>;
  getPushNotificationReceiptsAsync(
    ids: string[],
  ): Promise<ExpoReceiptLike[] | Record<string, ExpoReceiptLike>>;
}

function normalizeReceipts(
  raw: ExpoReceiptLike[] | Record<string, ExpoReceiptLike>,
): ExpoReceiptLike[] {
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([id, receipt]) => ({ ...receipt, id }));
}

/**
 * Expo Push 实现：批量 ≤100/chunk（SDK chunkPushNotifications 自动切），
 * 汇总 ticket 与 receipt 两级返回中的 DeviceNotRegistered → invalidTokens。
 * receipts 在发送后可能尚未就绪：best-effort 拉一次，未就绪/失败仅记日志，
 * 失效判定最终由后续批次重试收敛（token 继续报错会再次返回）。
 */
export class ExpoPushService implements PushService {
  private readonly expo: ExpoClientLike;

  /** expo：可注入的客户端（测试传 fake；默认 / factory 传真实 Expo，凭据在 factory 侧注入）。 */
  constructor(expo: ExpoClientLike | Expo = new Expo()) {
    this.expo = expo as ExpoClientLike;
  }

  private isExpoPushToken(token: string): boolean {
    if (typeof this.expo.isExpoPushToken === 'function') return this.expo.isExpoPushToken(token);
    return Expo.isExpoPushToken(token);
  }

  async send(messages: PushMessage[]): Promise<PushSendOutcome> {
    const invalidTokens = new Set<string>();
    if (messages.length === 0) return { invalidTokens: [] };

    const valid = messages.filter((m) => {
      if (this.isExpoPushToken(m.to)) return true;
      logger.warn('skip non-expo push token', { to: m.to.slice(0, 24) });
      return false;
    });
    if (valid.length === 0) return { invalidTokens: [] };

    // to → 消息映射：ticket 不回带 token，用 ticket 对应 chunk 的顺序回查
    const chunks = this.expo.chunkPushNotifications(valid);
    const ticketIds: string[] = [];
    const idToToken = new Map<string, string>();
    for (const chunk of chunks) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = (chunk as PushMessage[])[i]?.to ?? '';
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered' && token) invalidTokens.add(token);
          else logger.warn('expo push ticket error', { ticket });
        } else if (ticket.id) {
          ticketIds.push(ticket.id);
          idToToken.set(ticket.id, token);
        }
      }
    }

    if (ticketIds.length > 0) {
      try {
        const receiptsRaw = await this.expo.getPushNotificationReceiptsAsync(ticketIds);
        for (const r of normalizeReceipts(receiptsRaw)) {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' && r.id) {
            const token = idToToken.get(r.id);
            if (token) invalidTokens.add(token);
          }
        }
      } catch (err) {
        logger.warn('expo receipts fetch failed (best-effort)', err);
      }
    }
    return { invalidTokens: [...invalidTokens] };
  }
}
