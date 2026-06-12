import Constants from 'expo-constants';
import { createMomentClient, type MomentClient } from '@moment/api-client';
import { secureTokenStore } from './token-store';
import { rnPut } from './rn-put';

export const apiUrl =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000';

/**
 * 直传 PUT 用 RN 版 rnPut：Blob（压缩后图片）直接 XHR；FilePart（视频分片）按 [start,end)
 * 从 fileUri 读盘再 PUT，整文件不进内存。
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
