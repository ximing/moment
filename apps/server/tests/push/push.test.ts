import { Expo } from 'expo-server-sdk';
import { ExpoPushService } from '../../src/push/expo.js';
import { getPushService, setPushService } from '../../src/push/factory.js';
import { MockPushService } from '../../src/push/mock.js';
import type { PushMessage } from '../../src/push/push-service.js';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const TOKEN_C = 'ExponentPushToken[cccccccccccccccccccccc]';

function msg(to: string, title = '时刻', body = '新动态'): PushMessage {
  return { to, title, body, data: { momentId: 'm-1' } };
}

function fakeExpo(): Expo {
  const calls = { sent: [] as PushMessage[][], receiptIds: [] as string[][] };
  const expo = {
    isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken['),
    chunkPushNotifications: (messages: PushMessage[]) => {
      const chunks: PushMessage[][] = [];
      for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
      return chunks;
    },
    sendPushNotificationsAsync: async (chunk: PushMessage[]) => {
      calls.sent.push(chunk);
      // ticket id 形如 DOSDUSD...；error ticket 直接携带 DeviceNotRegistered
      return chunk.map((m) => {
        if (m.to === TOKEN_B) {
          return { status: 'error', message: 'device not registered', details: { error: 'DeviceNotRegistered' } };
        }
        return { status: 'ok', id: `ticket-${m.to.slice(-6)}` };
      });
    },
    getPushNotificationReceiptsAsync: async (ids: string[]) => {
      calls.receiptIds.push(ids);
      return ids.map((id) => {
        if (id === `ticket-${TOKEN_C.slice(-6)}`) {
          return { id, status: 'error', message: 'device not registered', details: { error: 'DeviceNotRegistered' } };
        }
        return { id, status: 'ok' };
      });
    },
  };
  const wrapped = { ...expo, __calls: calls } as unknown as Expo & { __calls: typeof calls };
  return wrapped;
}

afterEach(() => setPushService(null));

describe('ExpoPushService', () => {
  it('批量发送：非 Expo token 静默丢弃；error ticket 的 DeviceNotRegistered 汇入 invalidTokens', async () => {
    const service = new ExpoPushService(fakeExpo());
    const outcome = await service.send([msg(TOKEN_A), msg(TOKEN_B), msg('garbage-token')]);
    expect(outcome.invalidTokens).toEqual([TOKEN_B]);
  });

  it('receipts 中的 DeviceNotRegistered 也汇入 invalidTokens', async () => {
    const service = new ExpoPushService(fakeExpo());
    const outcome = await service.send([msg(TOKEN_A), msg(TOKEN_C)]);
    expect(outcome.invalidTokens).toEqual([TOKEN_C]);
  });

  it('空消息数组直接返回空结果，不触 Expo', async () => {
    const expo = fakeExpo();
    const service = new ExpoPushService(expo);
    expect(await service.send([])).toEqual({ invalidTokens: [] });
  });
});

describe('MockPushService', () => {
  it('记录消息、返回配置的失效 token、可注入失败', async () => {
    const mock = new MockPushService();
    mock.invalidTokensToReport = [TOKEN_A];
    const outcome = await mock.send([msg(TOKEN_A), msg(TOKEN_B)]);
    expect(mock.sent).toHaveLength(2);
    expect(outcome.invalidTokens).toEqual([TOKEN_A]);

    mock.failWith = new Error('EXPO_DOWN');
    await expect(mock.send([msg(TOKEN_A)])).rejects.toThrow('EXPO_DOWN');
  });
});

describe('push factory', () => {
  it('默认单例；setPushService 注入后可替换、置 null 恢复', () => {
    const a = getPushService();
    expect(getPushService()).toBe(a);
    const mock = new MockPushService();
    setPushService(mock);
    expect(getPushService()).toBe(mock);
    setPushService(null);
    expect(getPushService()).not.toBe(mock);
  });
});
