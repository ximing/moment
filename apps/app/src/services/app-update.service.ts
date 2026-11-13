import { AppState, type NativeEventSubscription, Platform } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Service } from '@rabjs/react';
import {
  fetchGithubLatest,
  isApkDownloadComplete,
  localVersionCode,
  localVersionName,
  shouldOfferUpdate,
  updateApkFileName,
  type RemoteRelease,
} from '../lib/app-update';
import {
  canInstallPackages,
  getNativeState,
  installApk,
  isApkUpdaterAvailable,
  openInstallPermissionSettings,
  startApkDownload,
  type NativeDownloadState,
} from '../lib/apk-updater';
import { installAndroidApk } from '../lib/install-apk';

const SKIP_KEY = 'moment.app.update.skip';
const GITHUB_REPO = 'ximing/moment';
const POLL_MS = 1_000;

export type AppUpdateStatus = 'idle' | 'downloading' | 'ready' | 'installing' | 'error';

/** 全局：直接对照 GitHub Releases。有新版先后台下 APK，下完再提示安装。仅 Android 正式包。 */
export class AppUpdateService extends Service {
  status: AppUpdateStatus = 'idle';
  /** 安装包已在缓存、等待用户确认安装。Host 消费后置回 false。 */
  installPrompt = false;
  remote: RemoteRelease | null = null;
  error: string | null = null;
  bytesDownloaded = 0;
  totalBytes = 0;
  pendingPermission = false;
  private skipped: string | null = null;
  private skipLoaded = false;
  private downloadTask: Promise<void> | null = null;
  private started = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private appSub: NativeEventSubscription | null = null;

  get currentVersion(): string {
    return Constants.nativeAppVersion ?? localVersionName(Constants.expoConfig);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void this.onForeground();
    });
    void this.check().catch(() => undefined);
  }

  stop(): void {
    this.started = false;
    this.stopPolling();
    this.appSub?.remove();
    this.appSub = null;
  }

  async check(opts?: { ignoreSkip?: boolean }): Promise<RemoteRelease | null> {
    this.error = null;
    const remote = await fetchGithubLatest(GITHUB_REPO);
    this.remote = remote;
    const offer = shouldOfferUpdate({
      platform: Platform.OS,
      isDev: __DEV__,
      localCode: this.installedCode(),
      remote,
      skippedVersion: opts?.ignoreSkip ? null : await this.loadSkip(),
    });
    if (!offer || !remote) {
      if (this.status !== 'downloading' && this.status !== 'installing') {
        this.status = 'idle';
        this.installPrompt = false;
      }
      return null;
    }
    void this.ensureDownloaded();
    return remote;
  }

  async skip(): Promise<void> {
    if (!this.remote) {
      this.status = 'idle';
      return;
    }
    this.skipped = this.remote.versionName;
    this.skipLoaded = true;
    this.installPrompt = false;
    await SecureStore.setItemAsync(SKIP_KEY, this.remote.versionName).catch(() => undefined);
    this.status = 'idle';
  }

  /** 缓存里已有完整 APK 则直接标记可安装，否则后台下载。同一版本不会并行下两次。 */
  async ensureDownloaded(): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    if (isApkUpdaterAvailable()) {
      await this.syncNative(remote);
      return;
    }
    if (this.downloadTask) return this.downloadTask;
    const dest = new File(Paths.cache, updateApkFileName(remote.versionName));
    if (isApkDownloadComplete(dest.exists ? dest.size : 0, remote.apkBytes)) {
      this.status = 'ready';
      this.installPrompt = true;
      this.bytesDownloaded = dest.size;
      this.totalBytes = dest.size;
      return;
    }
    this.status = 'downloading';
    this.installPrompt = false;
    this.error = null;
    const task = this.runDownload(remote, dest);
    this.downloadTask = task;
    try {
      await task;
    } finally {
      if (this.downloadTask === task) this.downloadTask = null;
    }
  }

  async install(): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    if (isApkUpdaterAvailable()) {
      await this.installNative(remote);
      return;
    }
    const dest = new File(Paths.cache, updateApkFileName(remote.versionName));
    if (!isApkDownloadComplete(dest.exists ? dest.size : 0, remote.apkBytes)) {
      await this.ensureDownloaded();
    }
    if (this.status === 'error' || !dest.exists) return;
    this.installPrompt = false;
    this.status = 'installing';
    try {
      await installAndroidApk(dest.contentUri);
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : '无法打开安装';
      throw err;
    }
  }

  private installedCode(): number {
    if (Platform.OS === 'android') {
      const native = Number.parseInt(String(Constants.nativeBuildVersion ?? ''), 10);
      if (Number.isFinite(native) && native > 0) return native;
    }
    return localVersionCode(Constants.expoConfig);
  }

  private async loadSkip(): Promise<string | null> {
    if (this.skipLoaded) return this.skipped;
    this.skipped = (await SecureStore.getItemAsync(SKIP_KEY).catch(() => null)) ?? null;
    this.skipLoaded = true;
    return this.skipped;
  }

  private async onForeground(): Promise<void> {
    if (this.pendingPermission && isApkUpdaterAvailable() && canInstallPackages()) {
      this.pendingPermission = false;
      await this.install().catch(() => undefined);
      return;
    }
    if (this.status === 'downloading' || this.status === 'installing') return;
    await this.check().catch(() => undefined);
  }

  private async syncNative(remote: RemoteRelease): Promise<void> {
    const native = getNativeState();
    if (native && native.versionCode === remote.versionCode && native.status !== 'failed') {
      this.applyNative(native, remote);
      if (this.status === 'downloading') this.startPolling();
      return;
    }
    try {
      const started = await startApkDownload({
        url: remote.apkUrl,
        versionCode: remote.versionCode,
      });
      if (started) this.applyNative(started, remote);
      else this.status = 'downloading';
      this.startPolling();
    } catch (err) {
      this.status = 'error';
      this.installPrompt = false;
      this.error = err instanceof Error ? err.message : '下载失败';
    }
  }

  private applyNative(state: NativeDownloadState, remote: RemoteRelease): void {
    this.bytesDownloaded = state.bytesDownloaded;
    this.totalBytes = state.totalBytes > 0 ? state.totalBytes : remote.apkBytes;
    if (state.status === 'ready' && state.versionCode === remote.versionCode) {
      const becameReady = this.status !== 'ready';
      this.status = 'ready';
      this.stopPolling();
      if (becameReady) this.installPrompt = true;
      return;
    }
    if (state.status === 'failed') {
      this.status = 'error';
      this.installPrompt = false;
      this.error = '下载失败';
      this.stopPolling();
      return;
    }
    this.status = 'downloading';
    this.installPrompt = false;
  }

  private async installNative(remote: RemoteRelease): Promise<void> {
    try {
      if (!canInstallPackages()) {
        this.pendingPermission = true;
        this.status = 'ready';
        await openInstallPermissionSettings();
        return;
      }
      this.installPrompt = false;
      this.pendingPermission = false;
      this.status = 'installing';
      this.error = null;
      await installApk(remote.versionCode);
      this.status = 'ready';
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('INSTALL_PERMISSION')) {
        this.pendingPermission = true;
        this.status = 'ready';
        await openInstallPermissionSettings();
        return;
      }
      this.status = 'error';
      this.error = message || '无法打开安装';
      throw err;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      const remote = this.remote;
      if (!remote) return;
      const native = getNativeState();
      if (native) this.applyNative(native, remote);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async runDownload(remote: RemoteRelease, dest: File): Promise<void> {
    try {
      if (dest.exists && !isApkDownloadComplete(dest.size, remote.apkBytes)) dest.delete();
      const file = await File.downloadFileAsync(remote.apkUrl, dest, { idempotent: true });
      if (!isApkDownloadComplete(file.exists ? file.size : 0, remote.apkBytes)) {
        throw new Error('安装包没有下载完成');
      }
      this.bytesDownloaded = file.size;
      this.totalBytes = file.size;
      this.status = 'ready';
      this.installPrompt = true;
    } catch (err) {
      this.status = 'error';
      this.installPrompt = false;
      this.error = err instanceof Error ? err.message : '下载失败';
    }
  }
}
