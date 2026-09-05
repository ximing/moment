import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Service } from '@rabjs/react';
import {
  fetchGithubLatest,
  localVersionCode,
  localVersionName,
  shouldOfferUpdate,
  type RemoteRelease,
} from '../lib/app-update';
import { installAndroidApk } from '../lib/install-apk';

const SKIP_KEY = 'moment.app.update.skip';
const GITHUB_REPO = 'ximing/moment';

export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error';

/** 全局：对照 GitHub latest release 的 APK，后台下载后调起系统安装。仅 Android 正式包。 */
export class AppUpdateService extends Service {
  status: AppUpdateStatus = 'idle';
  remote: RemoteRelease | null = null;
  error: string | null = null;
  private skipped: string | null = null;
  private skipLoaded = false;

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
    this.status = offer ? 'available' : 'idle';
    return offer ? remote : null;
  }

  async skip(): Promise<void> {
    if (!this.remote) {
      this.status = 'idle';
      return;
    }
    this.skipped = this.remote.versionName;
    this.skipLoaded = true;
    await SecureStore.setItemAsync(SKIP_KEY, this.remote.versionName).catch(() => undefined);
    this.status = 'idle';
  }

  async downloadAndInstall(): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    this.status = 'downloading';
    this.error = null;
    try {
      const dest = new File(Paths.cache, `moment-${remote.versionName}.apk`);
      const file = await File.downloadFileAsync(remote.apkUrl, dest, { idempotent: true });
      this.status = 'installing';
      await installAndroidApk(file.contentUri);
      this.status = 'idle';
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : '下载或安装失败';
      throw err;
    }
  }
}
