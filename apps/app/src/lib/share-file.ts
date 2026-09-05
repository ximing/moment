import { Linking, Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';

/** 把远程或本地图片交给系统打开/保存（Android 走 VIEW + 读权限；iOS 走分享面板）。 */
export async function shareImageFile(uri: string, basename: string): Promise<void> {
  let fileUri = uri;
  let contentUri: string | undefined;
  if (/^https?:\/\//i.test(uri)) {
    const dest = new File(Paths.cache, basename);
    const downloaded = await File.downloadFileAsync(uri, dest, { idempotent: true });
    fileUri = downloaded.uri;
    contentUri = downloaded.contentUri ?? undefined;
  }
  if (Platform.OS === 'ios') {
    await Share.share({ url: fileUri });
    return;
  }
  const viewUri = contentUri ?? fileUri;
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: viewUri,
      type: 'image/jpeg',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
    return;
  } catch {
    // debug APK 可能没有 IntentLauncher：退到系统 Intent
  }
  try {
    await Linking.sendIntent('android.intent.action.VIEW', [{ key: 'android.intent.extra.STREAM', value: viewUri }]);
  } catch {
    await Share.share({ title: '保存图片', url: viewUri, message: viewUri });
  }
}
