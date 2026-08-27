import type { UploadMediaInput } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { register, resolve } from '@rabjs/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackChainColor } from '@/lib/chain-color';
import { ChainSettingsService } from './chain-settings.service';

// 链设置页的外观状态机契约（chain-appearance plan Task 8 / spec §7.1）：
// - loadChain 首载把 ChainDto 水合成三模式草稿（image > emoji > color 防御性优先级）；
//   legacy 全空链按 id 哈希色预填（首次保存即持久化明确纯色，spec §3.3）；
// - 已绑定（persisted）图片切模式不提前 DELETE——服务端替换时才 orphan；
//   新 temp 切换/删除/卸载走 best-effort DELETE；
// - saveProfile 提交互斥外观 payload（省略 null color），成功后用返回的新 ChainDto
//   重新水合草稿（temp → persisted + 稳定 URL + 服务端归一化焦点）；
// - 保存闸 canSave：name 非空、无 uploading、image 模式 avatar ready 且带 mediaId。

const api = vi.hoisted(() => ({
  getChain: vi.fn(),
  updateChain: vi.fn(),
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  listShareLinks: vi.fn(),
  listTags: vi.fn(),
  uploadMedia: vi.fn(),
  discardMedia: vi.fn(),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(ChainSettingsService);

function makeChain(partial: Partial<ChainDto> = {}): ChainDto {
  return {
    id: 'chain-1',
    name: '周末小家',
    description: '一起记录平凡日子',
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: 'mint',
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    ...partial,
  };
}

const IMAGE_CHAIN = makeChain({
  avatarMediaId: 'm-a',
  avatarUrl: '/api/media/m-a',
  avatarFocus: { x: 0.2, y: 0.8 },
  color: null,
  icon: null,
});

function file(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

function ready(mediaId: string) {
  return { mediaId, status: 'ready' as const, mime: 'image/png', size: 1 };
}

/** uploadMedia 立即成功桩：onMediaId → onProgress → resolve，mediaId 取自文件名。 */
function autoReadyUploads(): void {
  api.uploadMedia.mockImplementation((input: UploadMediaInput) => {
    const mediaId = `m-${(input.file as File).name.replace(/\.png$/, '')}`;
    input.onMediaId?.(mediaId);
    input.onProgress?.(input.size, input.size);
    return Promise.resolve(ready(mediaId));
  });
}

/** 清空外观草稿并 dispose 槽位（abort + revoke），再重置 service 公开状态。 */
function resetService(): ChainSettingsService {
  const service = resolve(ChainSettingsService);
  service.appearance = { avatarMode: 'color', color: null, icon: null, avatar: null, cover: null };
  service.disposeAppearanceDraft();
  service.chainId = '';
  service.chain = null;
  service.members = [];
  service.invites = [];
  service.shareLinks = [];
  service.formName = '';
  service.formDescription = '';
  service.formHydrated = false;
  service.tags = [];
  // 私有级联闸：本测试文件的用例各自独占首载路径
  (service as unknown as { sectionsLoaded: boolean }).sectionsLoaded = false;
  return service;
}

/** 以指定 ChainDto 完成首载（hydrate 幂等守卫绕过，直接走 loadChain）。 */
async function seedChain(chain: ChainDto): Promise<ChainSettingsService> {
  const service = resolve(ChainSettingsService);
  api.getChain.mockResolvedValue(chain);
  service.chainId = chain.id;
  await service.loadChain();
  return service;
}

beforeAll(() => {
  // jsdom 无 object URL 实现（chain-home.test.tsx 同一约定）
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((f: File) => `blob:${f.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

beforeEach(() => {
  vi.clearAllMocks();
  resetService();
  api.listMembers.mockResolvedValue([]);
  api.listInvites.mockResolvedValue([]);
  api.listShareLinks.mockResolvedValue({ items: [] });
  api.listTags.mockResolvedValue({ tags: [] });
  api.discardMedia.mockResolvedValue(undefined);
});

describe('外观草稿水合', () => {
  it('image 链：avatarMode=image，persisted + 稳定 URL + 服务端焦点', async () => {
    const service = await seedChain(IMAGE_CHAIN);

    expect(service.appearance.avatarMode).toBe('image');
    expect(service.appearance.avatar).toMatchObject({
      mediaId: 'm-a',
      src: '/api/media/m-a',
      focus: { x: 0.2, y: 0.8 },
      persisted: true,
      status: 'ready',
    });
    expect(service.appearance.icon).toBeNull();
    expect(service.appearance.color).toBeNull();
  });

  it('emoji 链：avatarMode=emoji，icon 原样水合', async () => {
    const service = await seedChain(makeChain({ icon: '👶', color: null }));

    expect(service.appearance.avatarMode).toBe('emoji');
    expect(service.appearance.icon).toBe('👶');
    expect(service.appearance.avatar).toBeNull();
  });

  it('color 链：预设色与自定义 hex 原样水合；legacy 全空按 id 哈希色预填', async () => {
    const colored = await seedChain(makeChain({ color: '#A1B2C3' }));
    expect(colored.appearance.avatarMode).toBe('color');
    expect(colored.appearance.color).toBe('#A1B2C3');

    resetService();
    const legacy = await seedChain(makeChain({ color: null, icon: null }));
    expect(legacy.appearance.avatarMode).toBe('color');
    expect(legacy.appearance.color).toBe(fallbackChainColor('chain-1'));
  });
});

describe('模式切换的媒体回收', () => {
  it('已绑定（persisted）图片切模式不提前 DELETE——服务端替换时才 orphan', async () => {
    const service = await seedChain(IMAGE_CHAIN);

    service.setAvatarMode('emoji');

    expect(api.discardMedia).not.toHaveBeenCalled();
    expect(service.appearance.avatar).toBeNull();
    expect(service.appearance.avatarMode).toBe('emoji');
  });

  it('新 temp 图片切模式会 DELETE（abort + best-effort discard）', async () => {
    autoReadyUploads();
    const service = await seedChain(makeChain());
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('t.png'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));

    service.setAvatarMode('color');

    expect(api.discardMedia).toHaveBeenCalledWith('m-t');
    expect(service.appearance.avatar).toBeNull();
  });
});

describe('saveProfile', () => {
  it('提交互斥外观 payload（省略 null color），成功后用返回的新 ChainDto 重新水合', async () => {
    autoReadyUploads();
    const updated = makeChain({
      avatarMediaId: 'm-t',
      avatarUrl: '/api/media/m-t',
      avatarFocus: { x: 0.5, y: 0.5 },
      color: null,
      icon: null,
    });
    api.updateChain.mockResolvedValue(updated);
    api.getChain.mockResolvedValue(updated); // chain:changed 扇出重拉
    const service = await seedChain(makeChain());
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('t.png'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));

    await service.saveProfile();

    const payload = api.updateChain.mock.calls[0]![1];
    expect(payload).toEqual({
      name: '周末小家',
      description: '一起记录平凡日子',
      icon: null,
      avatarMediaId: 'm-t',
      avatarFocus: { x: 0.5, y: 0.5 },
      coverMediaId: null,
    });

    // 重新水合：temp → persisted + 稳定 URL；之后再 dispose 不误删已绑定媒体
    expect(service.appearance.avatar).toMatchObject({
      mediaId: 'm-t',
      src: '/api/media/m-t',
      persisted: true,
      status: 'ready',
    });
    service.disposeAppearanceDraft();
    expect(api.discardMedia).not.toHaveBeenCalled();
  });

  it('纯色模式保存：带 color 与 icon:null；emoji 模式保存：带 icon 且省略 color', async () => {
    api.updateChain.mockImplementation(() => Promise.resolve(makeChain()));
    const service = await seedChain(makeChain({ color: 'mint' }));

    await service.saveProfile();
    expect(api.updateChain.mock.calls[0]![1]).toEqual({
      name: '周末小家',
      description: '一起记录平凡日子',
      color: 'mint',
      icon: null,
      avatarMediaId: null,
      coverMediaId: null,
    });

    service.setAvatarMode('emoji');
    service.selectEmoji('🐾');
    api.updateChain.mockClear();
    await service.saveProfile();
    expect(api.updateChain.mock.calls[0]![1]).toEqual({
      name: '周末小家',
      description: '一起记录平凡日子',
      icon: '🐾',
      avatarMediaId: null,
      coverMediaId: null,
    });
  });
});

describe('canSave 保存闸', () => {
  it('name 空 / image 模式未就绪 / 任一图片 uploading 时不可保存', async () => {
    autoReadyUploads();
    const service = await seedChain(makeChain({ color: 'mint' }));
    expect(service.canSave).toBe(true);

    service.formName = '  ';
    expect(service.canSave).toBe(false);
    service.formName = '周末小家';

    service.setAvatarMode('image');
    expect(service.canSave).toBe(false); // image 模式无图

    service.selectAppearanceImage('avatar', file('a.png'));
    expect(service.canSave).toBe(false); // uploading
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));
    expect(service.canSave).toBe(true);

    service.selectAppearanceImage('cover', file('c.png'));
    expect(service.canSave).toBe(false); // cover uploading
    await vi.waitFor(() => expect(service.appearance.cover?.status).toBe('ready'));
    expect(service.canSave).toBe(true);
  });
});

describe('卸载回收', () => {
  it('disposeAppearanceDraft 只清理未保存 temp：persisted 资源绝不 DELETE', async () => {
    autoReadyUploads();
    const service = await seedChain(IMAGE_CHAIN); // persisted avatar m-a
    service.selectAppearanceImage('cover', file('c.png')); // temp cover m-c
    await vi.waitFor(() => expect(service.appearance.cover?.status).toBe('ready'));

    service.disposeAppearanceDraft();

    expect(api.discardMedia).toHaveBeenCalledTimes(1);
    expect(api.discardMedia).toHaveBeenCalledWith('m-c');
    expect(api.discardMedia).not.toHaveBeenCalledWith('m-a');
  });
});
