import { Platform } from 'react-native';

/** Android 用 content:// 调起系统安装器（需 REQUEST_INSTALL_PACKAGES）。
 *  动态 import：debug APK 若尚未编入原生模块，启动时不崩，安装时再失败。 */
export async function installAndroidApk(contentUri: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await import('expo-intent-launcher');
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1 | 268435456, // GRANT_READ_URI_PERMISSION | ACTIVITY_NEW_TASK
    type: 'application/vnd.android.package-archive',
  });
}
