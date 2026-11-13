import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type NativeDownloadState = {
  status: 'idle' | 'downloading' | 'ready' | 'failed';
  versionCode: number | null;
  bytesDownloaded: number;
  totalBytes: number;
  path: string | null;
  message: string | null;
};

type NativeApkUpdater = {
  getState(): NativeDownloadState;
  canInstall(): boolean;
  startDownload(
    url: string,
    versionCode: number,
    sha256: string | null,
  ): Promise<NativeDownloadState>;
  cancelDownload(): Promise<void>;
  openInstallPermissionSettings(): Promise<void>;
  install(versionCode: number): Promise<void>;
};

const native: NativeApkUpdater | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeApkUpdater>('ApkUpdater') : null;

export function isApkUpdaterAvailable(): boolean {
  return native !== null;
}

export function getNativeState(): NativeDownloadState | null {
  if (!native) return null;
  try {
    return native.getState();
  } catch {
    return null;
  }
}

export function canInstallPackages(): boolean {
  if (!native) return false;
  try {
    return native.canInstall();
  } catch {
    return false;
  }
}

/** url 是 GitHub Release 资源的 browser_download_url。系统 DownloadManager 跟着跳转把 APK 下完。 */
export async function startApkDownload(input: {
  url: string;
  versionCode: number;
  sha256?: string;
}): Promise<NativeDownloadState | null> {
  if (!native) return null;
  return native.startDownload(input.url, input.versionCode, input.sha256 ?? null);
}

export async function openInstallPermissionSettings(): Promise<void> {
  await native?.openInstallPermissionSettings();
}

export async function installApk(versionCode: number): Promise<void> {
  if (!native) throw new Error('UNSUPPORTED');
  await native.install(versionCode);
}
