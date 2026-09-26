import { Platform } from 'react-native';
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
import { installAndroidApk } from '../lib/install-apk';

const SKIP_KEY = 'moment.app.update.skip';
const GITHUB_REPO = 'ximing/moment';

export type AppUpdateStatus = 'idle' | 'downloading' | 'ready' | 'installing' | 'error';

/** 全局：对照 GitHub latest release。有新版先后台下 APK，下完再提示安装。仅 Android 正式包。 */
export class AppUpdateService extends Service {
  status: AppUpdateStatus = 'idle';
  /** 安装包已在缓存、等待用户确认安装。Host 消费后置回 false。 */
  installPrompt = false;
  remote: RemoteRelease | null = null;
  error: string | null = null;
  private skipped: string | null = null;
  private skipLoaded = false;
  private downloadTask: Promise<void> | null = null;

  get currentVersion(): string {
    return localVersionName(Constants.expoConfig);
  }

  private async loadSkip(): Promise<string | null> {
    if (this.skipLoaded) return this.skipped;
    this.skipped = (await SecureStore.getItemAsync(SKIP_KEY).catch(() => null)) ?? null;
    this.skipLoaded = true;
    return this.skipped;
  }

  async check(opts?: { ignoreSkip?: boolean }): Promise<RemoteRelease | null> {
    this.error = null;
    const remote = await fetchGithubLatest(GITHUB_REPO);
    this.remote = remote;
    const offer = shouldOfferUpdate({
      platform: Platform.OS,
      isDev: __DEV__,
      localCode: localVersionCode(Constants.expoConfig),
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
    if (this.downloadTask) return this.downloadTask;
    const dest = new File(Paths.cache, updateApkFileName(remote.versionName));
    if (isApkDownloadComplete(dest.exists ? dest.size : 0, remote.apkBytes)) {
      this.status = 'ready';
      this.installPrompt = true;
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

  private async runDownload(remote: RemoteRelease, dest: File): Promise<void> {
    try {
      if (dest.exists && !isApkDownloadComplete(dest.size, remote.apkBytes)) dest.delete();
      const file = await File.downloadFileAsync(remote.apkUrl, dest, { idempotent: true });
      if (!isApkDownloadComplete(file.exists ? file.size : 0, remote.apkBytes)) {
        throw new Error('安装包没有下载完成');
      }
      this.status = 'ready';
      this.installPrompt = true;
    } catch (err) {
      this.status = 'error';
      this.installPrompt = false;
      this.error = err instanceof Error ? err.message : '下载失败';
    }
  }
}
