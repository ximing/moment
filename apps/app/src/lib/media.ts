import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';

/** 图片压缩目标：最长边（spec §2 App 选型「客户端压缩」，2048px 足够 1080p 屏两倍图） */
export const MAX_IMAGE_DIM = 2048;

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

/** 压缩完成、可直接进 uploadMedia 的图片 */
export interface ReadyImage extends PickedImage {
  blob: Blob;
  size: number;
  mime: string;
}

export interface PickedVideo {
  uri: string;
  mime: string;
  size: number;
  /** 秒 */
  durationSeconds: number;
}

/** 仅用于压缩后的图片（百 KB 级）整读入内存；视频严禁走此路径（见 rn-put.ts 按片读盘）。 */
export async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

export async function pickImages(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 9,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

export async function pickVideo(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
  if (result.canceled) return null;
  const a = result.assets[0];
  if (!a) return null;
  return {
    uri: a.uri,
    mime: a.mimeType ?? 'video/mp4',
    size: a.fileSize ?? 0,
    durationSeconds: Math.round((a.duration ?? 0) / 1000),
  };
}

/** spec §5.5：客户端压到最长边 ≤2048px、JPEG 0.85；压缩后仍超 MAX_IMAGE_BYTES 由调用方拒绝。 */
export async function compressImage(img: PickedImage): Promise<ReadyImage> {
  let result = await ImageManipulator.manipulateAsync(img.uri, [], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  const maxDim = Math.max(result.width, result.height);
  if (maxDim > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / maxDim;
    result = await ImageManipulator.manipulateAsync(
      result.uri,
      [{ resize: { width: Math.round(result.width * scale), height: Math.round(result.height * scale) } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
  }
  const blob = await uriToBlob(result.uri);
  return { uri: result.uri, width: result.width, height: result.height, blob, size: blob.size, mime: 'image/jpeg' };
}

/** spec §5.5 视频限制的本地预校验：超限返回提示文案（引导用户先在系统相册压缩），通过返回 null。 */
export function validateVideo(v: PickedVideo): string | null {
  if (v.size > MAX_VIDEO_BYTES) {
    return `视频 ${Math.round(v.size / 1024 / 1024)}MB 超过 ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB 上限，请先在系统相册压缩后重选`;
  }
  if (v.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return `视频时长 ${Math.floor(v.durationSeconds / 60)} 分钟超过 ${Math.floor(MAX_VIDEO_DURATION_SECONDS / 60)} 分钟上限，请先在系统相册裁剪后重选`;
  }
  return null;
}
