import { Expo } from 'expo-server-sdk';
import { config } from '../config.js';
import { ExpoPushService } from './expo.js';
import type { PushService } from './push-service.js';

let singleton: PushService | null = null;
let override: PushService | null = null;

export function getPushService(): PushService {
  if (override) return override;
  if (!singleton) {
    const expo = config.EXPO_ACCESS_TOKEN
      ? new Expo({ accessToken: config.EXPO_ACCESS_TOKEN })
      : new Expo();
    singleton = new ExpoPushService(expo);
  }
  return singleton;
}

/** 测试注入点（传 null 恢复单例）。严禁业务代码使用。 */
export function setPushService(p: PushService | null): void {
  override = p;
}
