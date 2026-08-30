import { register, resolve } from '@rabjs/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto, MomentMedia, MomentResponse } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ComposePanelService } from './compose-panel.service';

// ComposePanelService 的人物/地点草稿与 dirty tracking 契约（spec people-place §6）：
// - undefined = 不变：未动人物/地点时 updateMoment 请求体不含 personIds/place 键
//   （整包回传会把 ai 行静默升级 manual、exif place 误升级 manual——spec §6 警告）；
// - 动作级判脏：任一增删动作即提交当前全集；删除后加回同一 ai person
//   （id 集合与基线相同）也提交（spec §5 升级路径）；
// - place：改过才提交；显式清空（名字清空 + 移除坐标）→ place:null（spec §6 清除语义）；
// - EXIF：仅地点草稿完全为空时自动回填坐标；逆地理成功则填「在哪里」；
//   拍摄时间在新建且用户未改过发生时间时回填表单。

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  createPerson: vi.fn(),
  createMoment: vi.fn(),
  updateMoment: vi.fn(),
  uploadMedia: vi.fn(),
  reverseGeocode: vi.fn(),
}));

const exif = vi.hoisted(() => ({ firstExif: vi.fn() }));
const compress = vi.hoisted(() => ({ compressImage: vi.fn(async (f: File) => f) }));

vi.mock('@/api/client', () => ({
  client: api,
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));
vi.mock('@/compose/exif-gps', () => ({ firstExif: exif.firstExif }));
vi.mock('@/lib/compress', () => ({ compressImage: compress.compressImage }));

register(AuthService);
register(ChainListService);
register(ComposeSessionService);
register(ComposePanelService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
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
    template: 'daily',
    payload: null,
    ownerId: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    myRole: 'owner',
  };
}

function editMoment(partial: Partial<MomentResponse> = {}): MomentResponse {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-1', nickname: '妈妈', avatarUrl: null },
    type: 'text',
    content: '在外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [],
    tags: [],
    persons: [],
    place: null,
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...partial,
  };
}

function svc(): ComposePanelService {
  return resolve(ComposePanelService);
}

beforeAll(() => {
  // jsdom 无 object URL 实现（chain-home.test.tsx / create-chain-dialog 同一约定）
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((f: File) => `blob:${f.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue({ tags: [] });
  api.listPersons.mockResolvedValue({ persons: [] });
  api.listMembers.mockResolvedValue([]);
  api.createMoment.mockResolvedValue(editMoment());
  api.updateMoment.mockResolvedValue(editMoment());
  api.uploadMedia.mockResolvedValue({
    mediaId: '11111111-1111-4111-8111-111111111111',
    status: 'ready',
    mime: 'image/jpeg',
    size: 1,
  });
  compress.compressImage.mockClear();
  api.reverseGeocode.mockResolvedValue({ name: null });
  exif.firstExif.mockResolvedValue({ gps: null, dateTime: null });
  resolve(ChainListService).chains = [chain('chain-1')];
  const s = svc();
  // 单例跨用例复位（不走 hydrate，绕开 request 依赖）
  s.request = null;
  s.pickedChainId = 'chain-1';
  s.content = '';
  s.images = [];
  s.video = null;
  s.voice = null;
  s.selectedTags = [];
  s.personList = [];
  s.members = [];
  s.selectedPersons = [];
  s.personQuery = '';
  s.personsTouched = false;
  s.placeName = '';
  s.placeCoords = null;
  s.placeTouched = false;
  s.exifDismissed = false;
  s.happenedAtTouched = false;
  s.error = null;
  s.progress = null;
  s.progressValue = null;
  s.keptMedia = [];
  s.keptAudio = null;
  s.mediaTouched = false;
  s.baselineMediaIds = [];
  s.baseline = null;
});

describe('编辑模式 dirty tracking（spec §6：undefined = 不变）', () => {
  it('未动人物/地点 → updateMoment 请求体不含 personIds/place 键（ai 行不被升级、exif place 不被误升级）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }],
        place: { lat: 39.9, lng: 116.4, name: '北京市东城区', source: 'exif' },
      }),
    });
    s.content = '只改正文';
    await s.submit();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('personIds');
    expect(body).not.toHaveProperty('place');
    expect(body.content).toBe('只改正文');
  });

  it('增删过人物（动作级判脏）→ personIds 提交当前全集（含未单独触碰的行，server 写 manual）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }] }),
    });
    s.togglePerson({ id: 'p-2', name: '朵朵', userId: null, source: 'manual' });
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-1', 'p-2']);
  });

  it('删除后加回同一 ai person（id 集合与基线相同）仍提交（spec §5 升级路径）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }] }),
    });
    s.togglePerson({ id: 'p-1', name: '外婆', userId: null, source: 'ai' }); // 删
    s.togglePerson({ id: 'p-1', name: '外婆', userId: null, source: 'manual' }); // 加回
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-1']);
  });

  it('地点手动输入 → place {name}（无坐标）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment() });
    s.setPlaceName('外婆家');
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ name: '外婆家' });
  });

  it('显式清空（名字清空 + 移除坐标）→ place:null（spec §6 清除语义）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' } }),
    });
    s.setPlaceName('');
    s.removePlaceCoords();
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toBeNull();
  });

  it('编辑回读带坐标（placeTouched=false）→ 不提交 place', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ place: { lat: 39.9, lng: 116.4, name: null, source: 'exif' } }),
    });
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('place');
  });
});

describe('新建模式：EXIF 自动回填与提交形态（spec §3）', () => {
  it('加图触发 firstExif：草稿为空 → 写 coords（不置 placeTouched）；逆地理空 → 提交 {lat,lng} 无 name', async () => {
    exif.firstExif.mockResolvedValue({ gps: { lat: 39.9042, lng: 116.4074 }, dateTime: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 }));
    expect(s.placeTouched).toBe(false);
    s.images = []; // 隔离 place 断言：跳过媒体上传路径
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('草稿已有地点名 → EXIF 不覆盖坐标（manual > exif，偏差 2）', async () => {
    exif.firstExif.mockResolvedValue({ gps: { lat: 39.9042, lng: 116.4074 }, dateTime: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.placeName = '外婆家';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(exif.firstExif).toHaveBeenCalled());
    expect(s.placeCoords).toBeNull();
    expect(s.placeName).toBe('外婆家');
  });

  it('移除 chip（exifDismissed）后再加图不自动回填（偏差 2：「删不掉」防御）', async () => {
    exif.firstExif.mockResolvedValue({ gps: { lat: 39.9042, lng: 116.4074 }, dateTime: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 }));
    s.removePlaceCoords();
    expect(s.placeCoords).toBeNull();
    s.addImages([new File(['y'], 'b.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(exif.firstExif).toHaveBeenCalledTimes(2));
    expect(s.placeCoords).toBeNull();
  });

  it('逆地理成功 → 「在哪里」填地名；提交 {name,lat,lng}', async () => {
    exif.firstExif.mockResolvedValue({ gps: { lat: 39.9042, lng: 116.4074 }, dateTime: null });
    api.reverseGeocode.mockResolvedValue({ name: '北京大学人民医院' });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeName).toBe('北京大学人民医院'));
    expect(s.placeTouched).toBe(false);
    s.images = [];
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ name: '北京大学人民医院', lat: 39.9042, lng: 116.4074 });
  });

  it('EXIF 拍摄时间回填发生时间；用户改过后不再覆盖', async () => {
    exif.firstExif.mockResolvedValue({ gps: null, dateTime: '2026-05-17T11:51' });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.happenedAt).toBe('2026-05-17T11:51'));
    s.setHappenedAt('2026-08-30T12:00');
    exif.firstExif.mockResolvedValue({ gps: null, dateTime: '2026-01-01T00:00' });
    s.addImages([new File(['y'], 'b.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(exif.firstExif).toHaveBeenCalledTimes(2));
    expect(s.happenedAt).toBe('2026-08-30T12:00');
  });

  it('手动名字 + EXIF 坐标 → place = {name, lat, lng}（赋值表「坐标+名字 → manual」）', async () => {
    exif.firstExif.mockResolvedValue({ gps: { lat: 39.9042, lng: 116.4074 }, dateTime: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).not.toBeNull());
    s.setPlaceName('外婆家');
    s.images = [];
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ name: '外婆家', lat: 39.9042, lng: 116.4074 });
  });

  it('选中人物（回车新建路径）→ createMoment 带 personIds', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-9', name: '王叔叔', userId: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.personQuery = '王叔叔';
    await s.submitPersonQuery();
    expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '王叔叔' });
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-9']);
  });

  it('人物超过 20 位 → 前置错误，不发请求（dto max 20）', async () => {
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.selectedPersons = Array.from({ length: 21 }, (_, i) => ({
      id: `p-${i}`,
      name: `人${i}`,
      userId: null,
      source: 'manual' as const,
    }));
    s.personsTouched = true;
    await s.submit();
    expect(s.error).toBe('最多关联 20 位人物');
    expect(api.createMoment).not.toHaveBeenCalled();
  });
});

describe('人物词典与链成员（spec §6/§7）', () => {
  it('submitPersonQuery：词典同名命中 → 直接选，不 POST（幂等短路）', async () => {
    const s = svc();
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.personQuery = '外婆';
    await s.submitPersonQuery();
    expect(api.createPerson).not.toHaveBeenCalled();
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']);
    expect(s.personsTouched).toBe(true);
  });

  it('toggleMember：词典已有该用户的 person → 直接选，不 POST', async () => {
    const s = svc();
    s.personList = [{ id: 'p-1', name: '林晓满', userId: 'u-1' }];
    await s.toggleMember({ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    expect(api.createPerson).not.toHaveBeenCalled();
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']);
  });

  it('toggleMember：词典无 → 幂等 POST {name, userId} 并入册选中（spec §7 链接语义）', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-2', name: '林晓满', userId: 'u-1' });
    const s = svc();
    await s.toggleMember({ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '林晓满', userId: 'u-1' });
    expect(s.personList.map((p) => p.id)).toEqual(['p-2']);
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-2']);
  });

  it('pickChain：切链清空人物选择与词典（人物是链级作用域，spec §0）', () => {
    const s = svc();
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'manual' }];
    s.personsTouched = true;
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.members = [{ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }];
    s.pickChain('chain-2'); // beforeEach 已置 pickedChainId = 'chain-1'，切换生效
    expect(s.selectedPersons).toEqual([]);
    expect(s.personsTouched).toBe(false);
    expect(s.personList).toEqual([]);
    expect(s.members).toEqual([]);
  });

  it('loadPersons：并行拉词典与成员；词典失败静默只清词典，成员独立成功不受牵连', async () => {
    api.listPersons.mockRejectedValue(new Error('network'));
    api.listMembers.mockResolvedValue([
      { userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const s = svc();
    await s.loadPersons();
    expect(s.personList).toEqual([]);
    expect(s.members.map((m) => m.nickname)).toEqual(['林晓满']);
  });
});

function img(id: string, mime = 'image/jpeg'): MomentMedia {
  return {
    id,
    url: `https://signed.example/${id}`,
    mime,
    width: 64,
    height: 48,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: null,
    posterDerivedUrl: null,
  };
}

describe('编辑模式媒体 dirty / cap / submit（spec §6）', () => {
  it('未动媒体 → updateMoment 请求体无 mediaIds 键', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('m-keep')] }) });
    s.content = '只改正文';
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body).not.toHaveProperty('type');
    expect(body).not.toHaveProperty('posterMediaId');
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  it('叉一张再保存 → 先 compressImage + uploadMedia({kind:image}) 再 updateMoment；mediaIds 为剩余 id（无新图则不 upload）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep-1'), img('keep-2')] }) });
    s.removeKeptMedia('keep-2');
    const order: string[] = [];
    compress.compressImage.mockImplementation(async (f) => {
      order.push('compress');
      return f;
    });
    api.uploadMedia.mockImplementation(async () => {
      order.push('upload');
      return { mediaId: 'n1' };
    });
    api.updateMoment.mockImplementation(async () => {
      order.push('update');
      return editMoment();
    });
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled(); // 无新本地图
    expect(order).toEqual(['update']);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.mediaIds).toEqual(['keep-1']);
  });

  it('text 加图 → 串行 compress+upload 后再 PATCH，mediaIds 仅新 id', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'text', media: [], content: '' }) });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    const order: string[] = [];
    compress.compressImage.mockImplementation(async (f) => {
      order.push('compress');
      return f;
    });
    api.uploadMedia.mockImplementation(async (input: { kind: string }) => {
      order.push('upload');
      expect(input.kind).toBe('image');
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    api.updateMoment.mockImplementation(async () => {
      order.push('update');
      return editMoment();
    });
    await s.submit();
    expect(order).toEqual(['compress', 'upload', 'update']);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.mediaIds).toEqual(['new-1']);
    expect(body).not.toHaveProperty('type');
  });

  it('video 编辑不调用 upload、不带 mediaIds', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        type: 'video',
        media: [{ ...img('vid'), mime: 'video/mp4' }],
      }),
    });
    s.content = '改配文';
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
  });

  it('voice 编辑 keptMedia 已 8 张时再 addImages 第 9 张被拒，即使 this.voice === null', async () => {
    const s = svc();
    const pictures = Array.from({ length: 8 }, (_, i) => img(`p-${i}`));
    s.hydrate({
      edit: editMoment({
        type: 'voice',
        media: [{ ...img('aud'), mime: 'audio/wav' }, ...pictures],
      }),
    });
    expect(s.voice).toBeNull();
    expect(s.keptMedia).toHaveLength(8);
    expect(s.keptAudio?.id).toBe('aud');
    s.addImages([new File(['x'], 'nine.jpg', { type: 'image/jpeg' })]);
    expect(s.error).toBe('语音时刻最多 8 张附图');
    expect(s.images).toHaveLength(0);
  });

  it('media 已有 8 张再 paste 第 10 张内容被拒（最多 9 张图片）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: Array.from({ length: 8 }, (_, i) => img(`k-${i}`)) }) });
    s.addImages([new File(['a'], '9.jpg', { type: 'image/jpeg' })]);
    expect(s.images).toHaveLength(1);
    s.addImages([new File(['b'], '10.jpg', { type: 'image/jpeg' })]);
    expect(s.error).toBe('最多 9 张图片');
    expect(s.images).toHaveLength(1);
  });

  it('hydrate 清掉上一轮新建草稿（images/video），避免记下→编辑残留', async () => {
    const s = svc();
    s.images = [{ file: new File(['x'], 'old.jpg', { type: 'image/jpeg' }), previewUrl: 'blob:old' }];
    s.video = { file: new File(['v'], 'old.mp4', { type: 'video/mp4' }), previewUrl: 'blob:vid', durationSeconds: 3 };
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep')] }) });
    expect(s.images).toEqual([]);
    expect(s.voice).toBeNull();
    expect(s.video).toBeNull();
    expect(s.keptMedia.map((m) => m.id)).toEqual(['keep']);
    expect(s.mediaTouched).toBe(false);
  });

  it('原 media 空正文、只留已有图 → 不拦「先写一句此刻吧」，不 upload', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', content: '', media: [img('keep')] }) });
    await s.submit();
    expect(s.error).toBeNull();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body.content).toBe('');
  });

  it('原 media 结果 0 图 → error 至少留一张图，不打 API', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('only')] }) });
    s.removeKeptMedia('only');
    await s.submit();
    expect(s.error).toBe('至少留一张图');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });

  it('混排残留 video 且 mediaTouched → 改图片前请先移除宫格里的视频', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        type: 'media',
        media: [img('pic'), { ...img('clip'), mime: 'video/mp4' }],
      }),
    });
    s.removeKeptMedia('pic');
    await s.submit();
    expect(s.error).toBe('改图片前请先移除宫格里的视频');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });

  it('hydrate 把 dirty 基线写在 service.baseline，改草稿不冲掉快照', () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep')], content: '原文' }) });
    expect(s.baseline).toEqual({
      content: '原文',
      happenedAt: s.happenedAt,
      tagIds: [],
      mediaIds: ['keep'],
    });
    s.content = '改过了';
    s.removeKeptMedia('keep');
    expect(s.baseline).toEqual({
      content: '原文',
      happenedAt: s.happenedAt,
      tagIds: [],
      mediaIds: ['keep'],
    });
  });

  it('isDirty：改正文后不重跑 hydrate 仍为 true（模拟 fiber 重挂载跳过 hydrate）', () => {
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    expect(s.isDirty()).toBe(false);
    s.content = '今天吃了蛋糕';
    expect(s.isDirty()).toBe(true);
  });

  it('isDirty：mediaTouched 在 baseline 丢失时仍为 true（旧 fiber ref 空不得误关）', () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep')] }) });
    s.removeKeptMedia('keep');
    s.baseline = null;
    expect(s.mediaTouched).toBe(true);
    expect(s.isDirty()).toBe(true);
  });
});

describe('记下：图片 / 视频上传进度', () => {
  it('新建视频：onProgress 写入确定进度；提交结束后清掉', async () => {
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.video = {
      file: new File(['abcd'], 'a.mp4', { type: 'video/mp4' }),
      previewUrl: 'blob:v',
      durationSeconds: 2,
    };
    const seen: Array<{ progress: string | null; value: number | null }> = [];
    api.uploadMedia.mockImplementation(async (input: { onProgress?: (l: number, t: number) => void }) => {
      expect(input.onProgress).toEqual(expect.any(Function));
      input.onProgress?.(40, 100);
      seen.push({ progress: s.progress, value: s.progressValue });
      input.onProgress?.(100, 100);
      seen.push({ progress: s.progress, value: s.progressValue });
      return { mediaId: 'vid-1', status: 'ready', mime: 'video/mp4', size: 4 };
    });
    await s.submit();
    expect(seen).toEqual([
      { progress: '上传视频 40%', value: 40 },
      { progress: '上传视频 100%', value: 100 },
    ]);
    expect(s.progress).toBeNull();
    expect(s.progressValue).toBeNull();
  });

  it('新建图片：压缩后 PUT 带 onProgress', async () => {
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    const seen: number[] = [];
    api.uploadMedia.mockImplementation(async (input: { onProgress?: (l: number, t: number) => void }) => {
      input.onProgress?.(50, 100);
      seen.push(s.progressValue ?? -1);
      return { mediaId: 'img-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    await s.submit();
    expect(seen).toEqual([50]);
    expect(api.uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'image', onProgress: expect.any(Function) }),
    );
  });

  it('编辑加图：uploadMedia 同样带 onProgress', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'text', media: [], content: '' }) });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    const seen: Array<{ progress: string | null; value: number | null }> = [];
    api.uploadMedia.mockImplementation(async (input: { onProgress?: (l: number, t: number) => void }) => {
      input.onProgress?.(25, 100);
      seen.push({ progress: s.progress, value: s.progressValue });
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    await s.submit();
    expect(seen).toEqual([{ progress: '上传图片 1/1 25%', value: 25 }]);
  });
});
