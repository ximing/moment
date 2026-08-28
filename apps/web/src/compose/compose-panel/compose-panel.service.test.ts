import { register, resolve } from '@rabjs/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto, MomentResponse } from '@moment/dto';
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
// - EXIF：仅地点草稿完全为空时自动回填（多图第一张含 GPS），提交 {lat,lng} 无 name
//   （spec §3：落 exif 分支，name 由 geocode 异步回填）。

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  createPerson: vi.fn(),
  createMoment: vi.fn(),
  updateMoment: vi.fn(),
}));

const exif = vi.hoisted(() => ({ firstGps: vi.fn() }));

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
vi.mock('@/compose/exif-gps', () => ({ firstGps: exif.firstGps }));

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
  s.error = null;
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
  it('加图触发 firstGps：草稿为空 → 写 coords（不置 placeTouched）；提交 place = {lat,lng} 无 name（exif 分支）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
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

  it('草稿已有地点名 → EXIF 不覆盖（manual > exif，偏差 2）', () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.placeName = '外婆家';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    // ingestExif 第一行守卫同步短路（先于 firstGps），不做 waitFor——直接断言结果态：
    // firstGps 从未被调用，地点名保持原值、坐标仍为空
    expect(exif.firstGps).not.toHaveBeenCalled();
    expect(s.placeCoords).toBeNull();
    expect(s.placeName).toBe('外婆家');
  });

  it('移除 chip（exifDismissed）后再加图不自动回填（偏差 2：「删不掉」防御）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 }));
    s.removePlaceCoords();
    expect(s.placeCoords).toBeNull();
    s.addImages([new File(['y'], 'b.jpg', { type: 'image/jpeg' })]);
    // 第二次 addImages 的 ingestExif 守卫同步短路：exifDismissed 置位后不再调 firstGps，坐标不复活
    expect(exif.firstGps).toHaveBeenCalledTimes(1);
    expect(s.placeCoords).toBeNull();
  });

  it('手动名字 + EXIF 坐标 → place = {name, lat, lng}（赋值表「坐标+名字 → manual」）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
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
