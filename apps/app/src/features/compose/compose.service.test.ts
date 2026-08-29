import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import type { MomentMedia, MomentResponse } from '@moment/dto';
import { ComposeService } from './compose.service';
import { ChainListService } from '../../services/chain-list.service';
import { AuthService } from '../../services/auth.service';

const api = vi.hoisted(() => ({
  getMoment: vi.fn(),
  updateMoment: vi.fn(),
  uploadMedia: vi.fn(),
  listTags: vi.fn(),
  getChain: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  listChains: vi.fn(),
  me: vi.fn(),
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
    expect(mediaLib.pickImages).toHaveBeenCalledWith({ selectionLimit: 2 });
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
