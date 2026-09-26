import Constants from 'expo-constants';
import { createMomentClient, type MomentClient } from '@moment/api-client';
import { secureTokenStore } from './token-store';
import { rnPut } from './rn-put';

export const apiUrl =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000';

/**
 * 直传 PUT 用 RN 版 rnPut：已在内存的 Blob（压缩后图片）走 XHR；FilePart 按 [start,end)
 * 读盘后用原生文件 PUT。RN 不能用 Uint8Array 构造 Blob。
 */
export const client: MomentClient = createMomentClient({
  baseUrl: apiUrl,
  tokenStore: secureTokenStore,
  putWithProgress: rnPut,
});

/** 分享链接落 Web 端（/share/:token，web 已有匿名公开页）——长辈用浏览器打开。 */
export const webUrl =
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ??
  'http://localhost:5173';
