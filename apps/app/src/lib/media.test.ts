import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';

const picker = vi.hoisted(() => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
}));

vi.mock('expo-image-picker', () => picker);
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { pickImages, pickVideo } from './media';

const photoAsset = {
  uri: 'file://cam.jpg',
  width: 100,
  height: 80,
  exif: { GPSLatitude: 39.9 },
};
const videoAsset = {
  uri: 'file://clip.mp4',
  mimeType: 'video/mp4',
  fileSize: 4_000_000,
  duration: 12_000,
};

describe('pickImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  });

  it('默认走相册多选，exif:true', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [photoAsset] });
    const got = await pickImages({ selectionLimit: 3 });
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 3,
      quality: 1,
      exif: true,
    });
    expect(got).toEqual([{ uri: photoAsset.uri, width: 100, height: 80, exif: photoAsset.exif }]);
  });

  it('相册权限拒绝 → 空数组且不打开选择器', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await pickImages()).toEqual([]);
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('source=camera 唤起系统相机拍照', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [photoAsset] });
    const got = await pickImages({ source: 'camera' });
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
    });
    expect(got).toHaveLength(1);
    expect(got[0]?.uri).toBe(photoAsset.uri);
  });

  it('相机权限拒绝抛中文提示', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickImages({ source: 'camera' })).rejects.toThrow('没拿到相机权限，去系统设置里开一下');
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('相机取消 → 空数组', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: [] });
    expect(await pickImages({ source: 'camera' })).toEqual([]);
  });
});

describe('pickVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  });

  it('默认走相册选一支视频', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [videoAsset] });
    const got = await pickVideo();
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['videos'], quality: 1 });
    expect(got).toEqual({
      uri: videoAsset.uri,
      mime: 'video/mp4',
      size: 4_000_000,
      durationSeconds: 12,
    });
  });

  it('source=camera 唤起系统相机拍视频，带时长上限', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [videoAsset] });
    const got = await pickVideo({ source: 'camera' });
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({
      mediaTypes: ['videos'],
      quality: 1,
      videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
    });
    expect(got?.durationSeconds).toBe(12);
  });

  it('拍视频相机权限拒绝抛中文提示', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickVideo({ source: 'camera' })).rejects.toThrow('没拿到相机权限，去系统设置里开一下');
  });
});
