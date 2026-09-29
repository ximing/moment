import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import type { ChainDto, MomentMedia, MomentResponse } from '@moment/dto';
import type { ReadyImage } from '../../lib/media';
import * as Location from 'expo-location';
import { ComposeService } from './compose.service';
import { ChainListService } from '../../services/chain-list.service';
import { AuthService } from '../../services/auth.service';

const api = vi.hoisted(() => ({
  getMoment: vi.fn(),
  updateMoment: vi.fn(),
  uploadMedia: vi.fn(),
  createMoment: vi.fn(),
  listTags: vi.fn(),
  getChain: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  listChains: vi.fn(),
  me: vi.fn(),
  reverseGeocode: vi.fn(),
}));

const mediaLib = vi.hoisted(() => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
  pickVideo: vi.fn(),
  validateVideo: vi.fn(),
  uriToBlob: vi.fn(),
}));

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  Accuracy: { Balanced: 1 },
}));
vi.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: vi.fn() }));
vi.mock('../../lib/media', () => ({
  pickImages: (...args: unknown[]) => mediaLib.pickImages(...args),
  compressImage: (...args: unknown[]) => mediaLib.compressImage(...args),
  pickVideo: (...args: unknown[]) => mediaLib.pickVideo(...args),
  validateVideo: (...args: unknown[]) => mediaLib.validateVideo(...args),
  uriToBlob: (...args: unknown[]) => mediaLib.uriToBlob(...args),
}));
vi.mock('../../lib/api', () => ({
  client: api,
  apiUrl: 'http://x',
  webUrl: 'http://x',
}));
vi.mock('../../lib/token-store', () => ({
  loadUser: vi.fn(async () => null),
  onAuthCleared: vi.fn(),
  saveUser: vi.fn(),
  secureTokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
}));

register(AuthService);
register(ChainListService);
register(ComposeService);

function img(id: string, mime = 'image/jpeg'): MomentMedia {
  return {
    id, url: `https://signed.example/${id}`, mime, width: 64, height: 48, duration: null,
    sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null,
  };
}

function moment(partial: Partial<MomentResponse> = {}): MomentResponse {
  return {
    id: 'm-1', chainId: 'chain-1',
    author: { id: 'u-1', nickname: '妈妈', avatarUrl: null },
    type: 'text', content: '在外婆家吃饭', transcript: null, transcriptionStatus: null,
    kind: 'standard', payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z', happenedTzOffset: -480, isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [], tags: [], persons: [], place: null, commentCount: 0, reactions: [], myReaction: null,
    ...partial,
  };
}

function svc(): ComposeService {
  return resolve(ComposeService);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue({ tags: [] });
  api.getChain.mockResolvedValue({ templateManifest: { version: 1 } });
  api.listPersons.mockResolvedValue({ persons: [] });
  api.listMembers.mockResolvedValue([]);
  api.listChains.mockResolvedValue([]);
  api.me.mockResolvedValue({ id: 'u-1', nickname: '妈妈' });
  api.updateMoment.mockResolvedValue(moment());
  api.uploadMedia.mockResolvedValue({ mediaId: 'up-1', status: 'ready', mime: 'image/jpeg', size: 1 });
  api.createMoment.mockResolvedValue({ id: 'm-new' });
  api.reverseGeocode.mockResolvedValue({ name: null });
  vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as never);
  mediaLib.compressImage.mockImplementation(async (x: { uri: string }) => ({
    ...x, blob: new Blob(['x']), size: 1, mime: 'image/jpeg',
  }));
  // ComposeService 是 register 单例。loadForEdit 若漏清草稿，后序用例会串 images/voice。
  // 与 web compose-panel.service.test.ts 同款：每个 it 先复位字段（含本 Task 新增的 kept*）。
  const s = svc();
  s.edit = null;
  s.images = [];
  s.video = null;
  s.poster = null;
  s.posterMediaId = null;
  s.voice = null;
  s.content = '';
  s.progressLabel = null;
  s.imageProgress = [];
  s.videoProgress = null;
  s.audioProgress = null;
  resolve(ChainListService).chains = [];
  s.keptMedia = [];
  s.keptAudio = null;
  s.mediaTouched = false;
  s.baselineMediaIds = [];
});

describe('ComposeService 编辑媒体（spec §7）', () => {
  it('未动媒体 → updateMoment JSON 无 mediaIds', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.content = '只改正文';
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body).not.toHaveProperty('type');
    expect(body).not.toHaveProperty('chainId');
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  it('叉后提交剩余 id（无新图不 upload）', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('a'), img('b')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.removeKeptMedia('b');
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect((api.updateMoment.mock.calls[0]![1] as { mediaIds: string[] }).mediaIds).toEqual(['a']);
  });

  it('text 加图（空正文）：先 uploadMedia({kind:image}) 再 updateMoment，mediaIds 仅新 id', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'text', media: [], content: '' }));
    const s = svc();
    await s.loadForEdit('m-1');
    expect(s.content).toBe('');
    const order: string[] = [];
    mediaLib.pickImages.mockResolvedValue([{ uri: 'file://a.jpg', width: 10, height: 10 }]);
    mediaLib.compressImage.mockImplementation(async (x) => { order.push('compress'); return { ...x, blob: new Blob(['x']), size: 1, mime: 'image/jpeg' }; });
    api.uploadMedia.mockImplementation(async (input: { kind: string }) => {
      order.push('upload');
      expect(input.kind).toBe('image');
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    api.updateMoment.mockImplementation(async () => { order.push('update'); return moment(); });
    await s.pickMoreImages();
    await s.submit();
    expect(order).toEqual(['compress', 'upload', 'update']);
    expect((api.updateMoment.mock.calls[0]![1] as { mediaIds: string[] }).mediaIds).toEqual(['new-1']);
  });

  it('原 media 空正文、只留已有图 → 不抛文字类型需要内容，不 upload', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', content: '', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    expect((api.updateMoment.mock.calls[0]![1] as Record<string, unknown>)).not.toHaveProperty('mediaIds');
  });

  it('video 编辑不 upload、不带 mediaIds', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'video', media: [{ ...img('v'), mime: 'video/mp4' }] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.content = '配文';
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect((api.updateMoment.mock.calls[0]![1] as Record<string, unknown>)).not.toHaveProperty('mediaIds');
  });

  it('voice 编辑 8 张附图时 pickMoreImages 抛错且 pickImages 不被调用；即使 voice===null', async () => {
    api.getMoment.mockResolvedValue(
      moment({
        type: 'voice',
        media: [{ ...img('aud'), mime: 'audio/wav' }, ...Array.from({ length: 8 }, (_, i) => img(`p-${i}`))],
      }),
    );
    const s = svc();
    await s.loadForEdit('m-1');
    expect(s.voice).toBeNull();
    expect(s.keptMedia).toHaveLength(8);
    await expect(s.pickMoreImages()).rejects.toThrow('语音时刻最多 8 张附图');
    expect(mediaLib.pickImages).not.toHaveBeenCalled();
  });

  it('编辑态 pickImages 传 selectionLimit=remain，禁止写死 9 再 slice', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: Array.from({ length: 7 }, (_, i) => img(`k-${i}`)) }));
    const s = svc();
    await s.loadForEdit('m-1');
    mediaLib.pickImages.mockResolvedValue([]);
    await s.pickMoreImages();
    expect(mediaLib.pickImages).toHaveBeenCalledWith({ selectionLimit: 2, source: 'library' });
  });

  it('source=camera 透传给 pickImages，不打开相册', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    mediaLib.pickImages.mockResolvedValue([]);
    await s.pickMoreImages('camera');
    expect(mediaLib.pickImages).toHaveBeenCalledWith({ selectionLimit: 8, source: 'camera' });
  });

  it('source=camera 透传给 pickVideo 并写入草稿', async () => {
    const s = svc();
    s.edit = null;
    mediaLib.pickVideo.mockResolvedValue({
      uri: 'file://v.mp4', mime: 'video/mp4', size: 1000, durationSeconds: 5,
    });
    mediaLib.validateVideo.mockReturnValue(null);
    const problem = await s.chooseVideo('camera');
    expect(problem).toBeNull();
    expect(mediaLib.pickVideo).toHaveBeenCalledWith({ source: 'camera' });
    expect(s.video?.uri).toBe('file://v.mp4');
  });

  it('无 keptAudio → 录音不能换，不打 API', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'voice', media: [img('pic')] })); // 损坏：无 audio
    const s = svc();
    await s.loadForEdit('m-1');
    s.mediaTouched = true;
    await expect(s.submit()).rejects.toThrow('录音不能换');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });
});

describe('设备定位预填地点', () => {
  it('授权后写入坐标与逆地理名，不置 placeTouched', async () => {
    vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as never);
    vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 39.9042, longitude: 116.4074 },
    } as never);
    api.reverseGeocode.mockResolvedValue({ name: '公园悦府公园' });
    const s = svc();
    s.edit = null;
    s.placeName = '';
    s.placeCoords = null;
    s.placeTouched = false;
    s.exifDismissed = false;
    s.placeFromDevice = false;
    expect(await s.prefillDevicePlace()).toBeNull();
    expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 });
    expect(s.placeName).toBe('公园悦府公园');
    expect(s.placeFromDevice).toBe(true);
    expect(s.placeTouched).toBe(false);
  });

  it('权限拒绝：不写草稿；force 返回文案', async () => {
    const s = svc();
    s.edit = null;
    s.placeName = '';
    s.placeCoords = null;
    s.placeTouched = false;
    expect(await s.prefillDevicePlace()).toBeNull();
    expect(s.placeCoords).toBeNull();
    expect(await s.prefillDevicePlace({ force: true })).toMatch(/权限/);
  });

  it('已有手改地点则跳过定位', async () => {
    const s = svc();
    s.edit = null;
    s.setPlaceName('家里');
    await s.prefillDevicePlace();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(s.placeName).toBe('家里');
  });

  it('编辑态不自动预填', async () => {
    const s = svc();
    s.edit = moment();
    await s.prefillDevicePlace();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

function ready(uri: string, size: number): ReadyImage {
  return { uri: `file://${uri}`, width: 8, height: 8, blob: new Blob(['x']), size, mime: 'image/jpeg' };
}

function attachChain(s: ComposeService): void {
  s.edit = null;
  s.chainId = 'chain-1';
  s.kind = 'standard';
  s.content = '';
  resolve(ChainListService).chains = [{ id: 'chain-1', name: '家', myRole: 'owner' } as ChainDto];
}

describe('发布上传进度', () => {
  it('多张图按各自字节推进，下一条开始前上一张记满，结束后清空', async () => {
    const s = svc();
    attachChain(s);
    s.type = 'media';
    s.images = [ready('a', 100), ready('b', 100)];
    api.uploadMedia.mockImplementation(async (input: {
      sortOrder?: number;
      size: number;
      onProgress?: (loaded: number, total: number) => void;
    }) => {
      if (input.sortOrder === 1) {
        expect(s.imageProgress[0]).toBe(1);
        expect(s.imageProgress[1]).toBe(0);
      }
      input.onProgress?.(input.size / 2, input.size);
      if (input.sortOrder === 0) {
        expect(s.imageProgress[0]).toBeCloseTo(0.5);
        expect(s.imageProgress[1]).toBe(0);
        expect(s.progressLabel).toBe('上传中 25%');
      }
      if (input.sortOrder === 1) {
        expect(s.imageProgress[1]).toBeCloseTo(0.5);
        expect(s.progressLabel).toBe('上传中 75%');
      }
      return { mediaId: `up-${input.sortOrder}`, status: 'ready', mime: 'image/jpeg', size: input.size };
    });
    api.createMoment.mockImplementation(async () => {
      expect(s.imageProgress).toEqual([1, 1]);
      expect(s.progressLabel).toBe('发布中…');
      return { id: 'm-new' };
    });
    await s.submit();
    expect(s.imageProgress).toEqual([]);
    expect(s.videoProgress).toBeNull();
    expect(s.audioProgress).toBeNull();
    expect(s.progressLabel).toBeNull();
    expect(s.mediaUploadActive).toBe(false);
  });

  it('视频只推进 videoProgress', async () => {
    const s = svc();
    attachChain(s);
    s.type = 'video';
    s.video = { uri: 'file://v.mp4', mime: 'video/mp4', size: 1000, durationSeconds: 4 };
    api.uploadMedia.mockImplementation(async (input: {
      kind: string;
      size: number;
      onProgress?: (loaded: number, total: number) => void;
    }) => {
      expect(input.kind).toBe('video');
      input.onProgress?.(250, 1000);
      expect(s.videoProgress).toBeCloseTo(0.25);
      expect(s.progressLabel).toBe('上传中 25%');
      expect(s.imageProgress).toEqual([]);
      expect(s.audioProgress).toBeNull();
      return { mediaId: 'vid', status: 'ready', mime: 'video/mp4', size: input.size };
    });
    api.createMoment.mockImplementation(async () => {
      expect(s.videoProgress).toBe(1);
      return { id: 'm-new' };
    });
    await s.submit();
    expect(s.videoProgress).toBeNull();
    expect(s.mediaUploadActive).toBe(false);
  });

  it('录音先传，附图进度保持 0，直到轮到它', async () => {
    const s = svc();
    attachChain(s);
    s.type = 'voice';
    s.voice = { uri: 'file://a.m4a', mime: 'audio/mp4', size: 200, durationSeconds: 3 };
    s.images = [ready('p', 100)];
    api.uploadMedia.mockImplementation(async (input: {
      kind: string;
      size: number;
      mime: string;
      onProgress?: (loaded: number, total: number) => void;
    }) => {
      if (input.kind === 'audio') {
        input.onProgress?.(100, 200);
        expect(s.audioProgress).toBeCloseTo(0.5);
        expect(s.imageProgress).toEqual([0]);
        expect(s.progressLabel).toBe('上传中 33%');
      } else {
        expect(s.audioProgress).toBe(1);
        input.onProgress?.(50, 100);
        expect(s.imageProgress[0]).toBeCloseTo(0.5);
        expect(s.progressLabel).toBe('上传中 83%');
      }
      return { mediaId: input.kind, status: 'ready', mime: input.mime, size: input.size };
    });
    api.createMoment.mockImplementation(async () => {
      expect(s.audioProgress).toBe(1);
      expect(s.imageProgress).toEqual([1]);
      return { id: 'm-new' };
    });
    await s.submit();
    expect(s.audioProgress).toBeNull();
    expect(s.imageProgress).toEqual([]);
  });

  it('上传失败后清掉每条进度', async () => {
    const s = svc();
    attachChain(s);
    s.type = 'media';
    s.images = [ready('a', 100)];
    let mid = 0;
    api.uploadMedia.mockImplementation(async (input: { onProgress?: (loaded: number, total: number) => void }) => {
      input.onProgress?.(40, 100);
      mid = s.imageProgress[0] ?? -1;
      throw new Error('offline');
    });
    await expect(s.submit()).rejects.toThrow('offline');
    expect(mid).toBeCloseTo(0.4);
    expect(s.imageProgress).toEqual([]);
    expect(s.progressLabel).toBeNull();
    expect(s.mediaUploadActive).toBe(false);
    expect(api.createMoment).not.toHaveBeenCalled();
  });

  it('编辑新图按图片下标记进度，保存前记满', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.images = [ready('n', 80)];
    s.mediaTouched = true;
    api.uploadMedia.mockImplementation(async (input: { onProgress?: (loaded: number, total: number) => void; size: number }) => {
      input.onProgress?.(40, 80);
      expect(s.imageProgress).toEqual([0.5]);
      expect(s.progressLabel).toBe('上传中 50%');
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: input.size };
    });
    api.updateMoment.mockImplementation(async () => {
      expect(s.imageProgress).toEqual([1]);
      expect(s.progressLabel).toBe('保存中…');
      return moment();
    });
    await s.submit();
    expect(s.imageProgress).toEqual([]);
    expect((api.updateMoment.mock.calls[0]![1] as { mediaIds: string[] }).mediaIds).toEqual(['keep', 'new-1']);
  });

  it('上传中忽略删图和再选', async () => {
    const s = svc();
    s.images = [ready('a', 10)];
    s.imageProgress = [0.2];
    s.removeImage(0);
    expect(s.images).toHaveLength(1);
    await expect(s.pickMoreImages()).resolves.toBe(0);
    expect(mediaLib.pickImages).not.toHaveBeenCalled();
    expect(await s.chooseVideo()).toBeNull();
    expect(mediaLib.pickVideo).not.toHaveBeenCalled();
  });
});

function chainDto(id: string, template: string, role: 'owner' | 'editor' | 'viewer' = 'owner'): ChainDto {
  return {
    id,
    name: id,
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template,
    payload: null,
    ownerId: 'u-1',
    myRole: role,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
  };
}

describe('编辑换链', () => {
  it('换到同模板的链：清空标签和人物，保留结构化内容，提交带 chainId 和空 personIds', async () => {
    api.getMoment.mockResolvedValue(moment({
      kind: 'milestone',
      payload: { custom_label: '走' },
      tags: [{ id: 't-1', name: '家' }],
      persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'manual' }],
    }));
    resolve(ChainListService).chains = [chainDto('chain-1', 'baby'), chainDto('chain-2', 'baby')];
    const s = svc();
    await s.loadForEdit('m-1');
    s.setChain('chain-2');
    expect(s.activeChainId).toBe('chain-2');
    expect(s.tagIds).toEqual([]);
    expect(s.selectedPersons).toEqual([]);
    expect(s.kind).toBe('milestone');
    expect(s.payloadDraft).toEqual({ custom_label: '走' });
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.chainId).toBe('chain-2');
    expect(body.tagIds).toEqual([]);
    expect(body.personIds).toEqual([]);
    expect(body.kind).toBe('milestone');
    expect(body.payload).toEqual({ custom_label: '走' });
  });

  it('模板不同就收成 standard；再换到同模板的第三条链时结构化内容回来', async () => {
    api.getMoment.mockResolvedValue(moment({
      kind: 'standard',
      payload: { mood: '😄' },
      tags: [{ id: 't-1', name: '家' }],
    }));
    resolve(ChainListService).chains = [
      chainDto('chain-1', 'daily'),
      chainDto('chain-2', 'baby'),
      chainDto('chain-3', 'daily'),
    ];
    const s = svc();
    await s.loadForEdit('m-1');
    s.setChain('chain-2');
    expect(s.kind).toBe('standard');
    expect(s.payloadDraft).toEqual({});
    expect(s.tagIds).toEqual([]);
    s.setChain('chain-3');
    expect(s.kind).toBe('standard');
    expect(s.payloadDraft).toEqual({ mood: '😄' });
    expect(s.tagIds).toEqual([]);
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.chainId).toBe('chain-3');
    expect(body.payload).toEqual({ mood: '😄' });
    expect(body.personIds).toEqual([]);
  });

  it('点回原链还原离开前的选择，保存不再带 chainId', async () => {
    api.getMoment.mockResolvedValue(moment({
      tags: [{ id: 't-1', name: '家' }],
      persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }],
    }));
    resolve(ChainListService).chains = [chainDto('chain-1', 'daily'), chainDto('chain-2', 'daily')];
    const s = svc();
    await s.loadForEdit('m-1');
    s.setChain('chain-2');
    s.setChain('chain-1');
    expect(s.tagIds).toEqual(['t-1']);
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']);
    expect(s.personsTouched).toBe(false);
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('chainId');
    expect(body).not.toHaveProperty('personIds');
    expect(body.tagIds).toEqual(['t-1']);
  });

  it('原链只是「只看」时仍出现在选项里，旁边是可编辑的链', async () => {
    api.getMoment.mockResolvedValue(moment());
    resolve(ChainListService).chains = [
      chainDto('chain-1', 'daily', 'viewer'),
      chainDto('chain-2', 'daily', 'editor'),
    ];
    const s = svc();
    await s.loadForEdit('m-1');
    expect(s.chainChoices.map((c) => c.id)).toEqual(['chain-1', 'chain-2']);
  });

  it('上传中不换链', async () => {
    api.getMoment.mockResolvedValue(moment());
    resolve(ChainListService).chains = [chainDto('chain-1', 'daily'), chainDto('chain-2', 'daily')];
    const s = svc();
    await s.loadForEdit('m-1');
    s.imageProgress = [0.2];
    s.setChain('chain-2');
    expect(s.activeChainId).toBe('chain-1');
    expect(s.tagIds).toEqual([]);
  });
});
