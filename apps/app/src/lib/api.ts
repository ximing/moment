import Constants from 'expo-constants';
import { createMomentClient, xhrPut, type MomentClient } from '@moment/api-client';
import { secureTokenStore } from './token-store';

export const apiUrl =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000';

/**
 * 直传 PUT 本 Task 先用 api-client 的 xhrPut（RN 自带 XMLHttpRequest，支持 upload.onprogress 与
 * Blob body——此时只有小 Blob 场景）。Task 5 交付 RN 版 rnPut 后切换：视频走 fileUri 形态按片读盘，
 * 整文件不进内存。
 */
export const client: MomentClient = createMomentClient({
  baseUrl: apiUrl,
  tokenStore: secureTokenStore,
  putWithProgress: xhrPut,
});
