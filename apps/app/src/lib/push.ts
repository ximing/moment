import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { client } from './api';

const PUSH_TOKEN_KEY = 'moment.push.token';

/**
 * 申请权限 → getExpoPushTokenAsync → POST /api/devices/push-token。
 * 登录后与 token 变化时调用；token 未变则跳过上报（幂等节流）。
 * 模拟器/未授权/无 eas projectId 静默跳过（真机验证见 Task 7 DoD，前置条件：eas init 已执行）。
 */
export async function registerForPushNotifications(): Promise<void> {
  // 推送注册失败不得影响登录主流程：整体吞错，下次冷启动重试兜底
  try {
    await registerPushTokenInner();
  } catch (err) {
    if (__DEV__) console.warn('[push] 注册失败，下次启动重试', err);
  }
}

async function registerPushTokenInner(): Promise<void> {
  if (!Device.isDevice) return;

  const projectId = Constants.easConfig?.projectId;
  if (!projectId) return; // eas init 未执行/本地 development build 未注入：跳过而非抛错

  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '默认',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4a90d9',
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const stored = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
  if (stored === token) return;

  await client.registerPushToken({
    expoToken: token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
}
