import { ApiError, type UploadMediaInput } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { register, resolve } from '@rabjs/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateChainDialogService } from './create-chain-dialog.service';

// 创建链对话框的外观状态机契约（chain-appearance plan Task 8 / spec §7.1）：
// - 默认纯色草稿；三模式 payload 互斥——create 省略 null color 与空媒体字段
//   （DTO create 的 color 不可为 null，服务端对全空回退 id 哈希色）；
// - 上传 race-safe：每个 placement 持 generation + AbortController；过期 onMediaId
//   立即 discardMedia、过期完成回调不写草稿；ABORTED 不落错误；
// - 保存闸 canSubmit：name 非空、avatar/cover 均非 uploading、image 模式 avatar
//   status=ready 且 mediaId 非空；
// - 切模式/删除/卸载回收 temp（abort + revoke + best-effort DELETE）；submit 成功
//   先把 temp 标 persisted，关闭（dispose）不误删已绑定媒体。

const api = vi.hoisted(() => ({
  createChain: vi.fn(),
  listTemplates: vi.fn(),
  uploadMedia: vi.fn(),
  discardMedia: vi.fn(),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(CreateChainDialogService);

function makeChain(partial: Partial<ChainDto> = {}): ChainDto {
  return {
    id: 'chain-new',
    name: '宝宝成长',
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: 'coral',
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    ...partial,
  };
}

function file(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

function ready(mediaId: string) {
  return { mediaId, status: 'ready' as const, mime: 'image/png', size: 1 };
}

interface PendingUpload {
  input: UploadMediaInput;
  resolve: (value: ReturnType<typeof ready>) => void;
  reject: (err: unknown) => void;
}

/** uploadMedia 挂起桩：每次调用登记 input（signal/onMediaId/onProgress）供用例手动推进。 */
function pendingUploads(): PendingUpload[] {
  const calls: PendingUpload[] = [];
  api.uploadMedia.mockImplementation(
    (input: UploadMediaInput) =>
      new Promise((res, rej) => {
        calls.push({ input, resolve: res, reject: rej });
      }),
  );
  return calls;
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
  const service = resolve(CreateChainDialogService);
  // 先清草稿再 dispose：回收上一用例的上传槽位（abort + revoke），不残留挂起状态
  service.appearance = { avatarMode: 'color', color: 'coral', icon: null, avatar: null, cover: null };
  service.disposeAppearanceDraft();
  service.name = '';
  service.description = '';
  service.template = 'daily';
  service.templates = [];
  api.createChain.mockImplementation(() => Promise.resolve(makeChain()));
  api.discardMedia.mockResolvedValue(undefined);
});

describe('submit 外观 payload', () => {
  it('默认纯色模式：提交 color + icon:null，省略空媒体字段（与既有调用形状一致）', async () => {
    const service = resolve(CreateChainDialogService);
    service.name = ' 宝宝成长 ';

    const id = await service.submit();

    expect(id).toBe('chain-new');
    expect(api.createChain).toHaveBeenCalledWith({
      name: '宝宝成长',
      template: 'daily',
      visibility: 'private',
      description: undefined,
      color: 'coral',
      icon: null,
    });
  });

  it('Emoji 模式：payload 带 icon、省略 color，不带媒体字段', async () => {
    const service = resolve(CreateChainDialogService);
    service.setAvatarMode('emoji');
    service.selectEmoji('🌱');
    service.name = '旅行';

    await service.submit();

    expect(api.createChain).toHaveBeenCalledWith({
      name: '旅行',
      template: 'daily',
      visibility: 'private',
      description: undefined,
      icon: '🌱',
    });
  });

  it('图片头像 + 封面：上传完成后 submit 携带 mediaId 与焦点', async () => {
    autoReadyUploads();
    const service = resolve(CreateChainDialogService);
    service.name = '宝宝成长';
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('avatar.png'));
    service.selectAppearanceImage('cover', file('cover.png'));
    await vi.waitFor(() => {
      expect(service.appearance.avatar?.status).toBe('ready');
      expect(service.appearance.cover?.status).toBe('ready');
    });
    service.setAppearanceFocus('avatar', { x: 0.25, y: 0.75 });

    await service.submit();

    expect(api.createChain).toHaveBeenCalledWith({
      name: '宝宝成长',
      template: 'daily',
      visibility: 'private',
      description: undefined,
      icon: null,
      avatarMediaId: 'm-avatar',
      avatarFocus: { x: 0.25, y: 0.75 },
      coverMediaId: 'm-cover',
      coverFocus: { x: 0.5, y: 0.5 },
    });
  });
});

describe('canSubmit 保存闸', () => {
  it('name 空 / image 模式无图 / 任一图片 uploading 时不可提交', async () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);

    expect(service.canSubmit).toBe(false); // name 空
    service.name = 'x';
    expect(service.canSubmit).toBe(true); // 纯色模式无图片

    service.setAvatarMode('image');
    expect(service.canSubmit).toBe(false); // image 模式但无图

    service.selectAppearanceImage('avatar', file('a.png'));
    expect(service.canSubmit).toBe(false); // avatar uploading

    calls[0]!.input.onMediaId?.('m-a');
    calls[0]!.resolve(ready('m-a'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));
    expect(service.canSubmit).toBe(true);

    service.selectAppearanceImage('cover', file('c.png'));
    expect(service.canSubmit).toBe(false); // cover uploading 同样闸住

    calls[1]!.input.onMediaId?.('m-c');
    calls[1]!.resolve(ready('m-c'));
    await vi.waitFor(() => expect(service.appearance.cover?.status).toBe('ready'));
    expect(service.canSubmit).toBe(true);
  });

  it('封面上传失败（error 态）不可提交——防止 coverMediaId:null 静默删除已持久化封面', async () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);
    service.name = '宝宝成长';

    service.selectAppearanceImage('cover', file('c.png'));
    calls[0]!.reject(new ApiError('直传失败（500）', 500, 'UPLOAD_FAILED'));
    await vi.waitFor(() => expect(service.appearance.cover?.status).toBe('error'));

    expect(service.canSubmit).toBe(false);
  });
});

describe('上传 race 与回收', () => {
  it('切模式：进行中的上传被 abort，已分配的 temp mediaId 被 discard，草稿只保留新模式值', () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    calls[0]!.input.onMediaId?.('m-temp');
    expect(service.appearance.avatar?.mediaId).toBe('m-temp');

    service.setAvatarMode('color');

    expect(calls[0]!.input.signal?.aborted).toBe(true);
    expect(api.discardMedia).toHaveBeenCalledWith('m-temp');
    expect(service.appearance.avatar).toBeNull();
    expect(service.appearance.avatarMode).toBe('color');
    expect(service.appearance.icon).toBeNull();
    expect(service.appearance.color).toBe('coral'); // 无记忆值时回默认色
  });

  it('race：过期 generation 的 onMediaId 立即 discard，过期完成回调不写草稿', async () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    service.selectAppearanceImage('avatar', file('b.png')); // 替换：A 的 generation 过期

    // A 的 presign 迟到：立即回收该 id，不写入草稿
    calls[0]!.input.onMediaId?.('m-a');
    expect(api.discardMedia).toHaveBeenCalledWith('m-a');
    expect(service.appearance.avatar?.mediaId).toBeNull();

    // B 正常完成
    calls[1]!.input.onMediaId?.('m-b');
    calls[1]!.resolve(ready('m-b'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));
    expect(service.appearance.avatar?.mediaId).toBe('m-b');

    // A 迟到的完成不改变草稿
    calls[0]!.resolve(ready('m-a'));
    await Promise.resolve();
    expect(service.appearance.avatar?.mediaId).toBe('m-b');
    expect(service.appearance.avatar?.status).toBe('ready');
  });

  it('abort 后迟到的 ABORTED 静默落地，不置错误态', async () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    service.setAvatarMode('emoji'); // abort + 草稿清空

    calls[0]!.reject(new ApiError('已取消', 0, 'ABORTED'));
    await Promise.resolve();

    expect(service.appearance.avatarMode).toBe('emoji');
    expect(service.appearance.avatar).toBeNull();
  });

  it('上传失败：置 error 不写死；重试重新发起上传并回收失败 temp', async () => {
    const calls = pendingUploads();
    const service = resolve(CreateChainDialogService);
    service.name = '宝宝成长';
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    calls[0]!.input.onMediaId?.('m-a');

    calls[0]!.reject(new ApiError('直传失败（500）', 500, 'UPLOAD_FAILED'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('error'));
    expect(service.appearance.avatar?.error).toBeTruthy();
    expect(service.canSubmit).toBe(false);

    service.retryAppearanceImage('avatar');
    expect(api.uploadMedia).toHaveBeenCalledTimes(2);
    expect(service.appearance.avatar?.status).toBe('uploading');
    expect(api.discardMedia).toHaveBeenCalledWith('m-a'); // 失败 temp 回收

    calls[1]!.input.onMediaId?.('m-a2');
    calls[1]!.resolve(ready('m-a2'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));
    expect(service.appearance.avatar?.mediaId).toBe('m-a2');
    expect(service.canSubmit).toBe(true);
  });

  it('删除图片：abort + discard temp，草稿清空回到选择入口', async () => {
    autoReadyUploads();
    const service = resolve(CreateChainDialogService);
    service.selectAppearanceImage('cover', file('c.png'));
    await vi.waitFor(() => expect(service.appearance.cover?.status).toBe('ready'));

    service.discardAppearanceImage('cover');

    expect(service.appearance.cover).toBeNull();
    expect(api.discardMedia).toHaveBeenCalledWith('m-c');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:c.png');
  });
});

describe('persisted 生命周期', () => {
  it('submit 成功后 temp 标 persisted：dispose（关闭/卸载）不再 DELETE', async () => {
    autoReadyUploads();
    const service = resolve(CreateChainDialogService);
    service.name = '宝宝成长';
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));

    await service.submit();

    expect(service.appearance.avatar?.persisted).toBe(true);
    service.disposeAppearanceDraft();
    expect(api.discardMedia).not.toHaveBeenCalled();
  });

  it('未保存就关闭（dispose）：未持久化的 temp 被 best-effort discard', async () => {
    autoReadyUploads();
    const service = resolve(CreateChainDialogService);
    service.setAvatarMode('image');
    service.selectAppearanceImage('avatar', file('a.png'));
    await vi.waitFor(() => expect(service.appearance.avatar?.status).toBe('ready'));

    service.disposeAppearanceDraft();

    expect(api.discardMedia).toHaveBeenCalledWith('m-a');
  });
});
