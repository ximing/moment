import type { MomentClient } from '@moment/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardDraftImage, uploadChainImage } from './appearance-upload';
import type { ChainImageDraft } from './appearance-model';

// 上传 helper 契约（chain-appearance plan Task 7）：
// 只接受注入的 Pick<MomentClient,'uploadMedia'|'discardMedia'>（不 import 全局 client，
// 测试不 mock 模块）；kind 固定 image；AbortSignal/onMediaId/onProgress 透传；
// discardDraftImage 只丢弃未持久化的 temp 媒体，existing（persisted）媒体绝不 DELETE。

type ChainImageApi = Pick<MomentClient, 'uploadMedia' | 'discardMedia'>;

function makeApi(): {
  api: ChainImageApi;
  uploadMedia: ReturnType<typeof vi.fn>;
  discardMedia: ReturnType<typeof vi.fn>;
} {
  const uploadMedia = vi.fn();
  const discardMedia = vi.fn().mockResolvedValue(undefined);
  return { api: { uploadMedia, discardMedia }, uploadMedia, discardMedia };
}

function makeDraft(partial: Partial<ChainImageDraft> = {}): ChainImageDraft {
  return {
    mediaId: null,
    src: null,
    focus: { x: 0.5, y: 0.5 },
    persisted: false,
    status: 'ready',
    progress: 0,
    error: null,
    fileName: null,
    ...partial,
  };
}

describe('uploadChainImage', () => {
  let api: ChainImageApi;
  let uploadMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ api, uploadMedia } = makeApi());
  });

  it('kind 固定 image，mime/size/file 来自传入文件，signal 与回调透传', async () => {
    const file = new File(['x'], 'cat.png', { type: 'image/png' });
    const signal = new AbortController().signal;
    const onMediaId = vi.fn();
    const onProgress = vi.fn();
    uploadMedia.mockResolvedValue({ mediaId: 'm-1', status: 'ready', mime: 'image/png', size: 1 });

    const result = await uploadChainImage(api, file, { onMediaId, onProgress }, signal);

    expect(result).toEqual({ mediaId: 'm-1' });
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    const input = uploadMedia.mock.calls[0]![0];
    expect(input.kind).toBe('image');
    expect(input.mime).toBe('image/png');
    expect(input.size).toBe(file.size);
    expect(input.file).toBe(file);
    expect(input.signal).toBe(signal);
    expect(input.onMediaId).toBe(onMediaId);
    expect(input.onProgress).toBe(onProgress);
  });

  it('上传失败时错误原样抛出，调用方凭 onMediaId 收到的 id 自行 discard', async () => {
    const file = new File(['x'], 'cat.png', { type: 'image/png' });
    const failure = new Error('network down');
    uploadMedia.mockRejectedValue(failure);

    await expect(uploadChainImage(api, file, {})).rejects.toBe(failure);
  });

  it('不传 callbacks 时同样工作（可选参数）', async () => {
    const file = new File(['x'], 'cat.png', { type: 'image/png' });
    uploadMedia.mockResolvedValue({ mediaId: 'm-2', status: 'ready', mime: 'image/png', size: 1 });
    const result = await uploadChainImage(api, file);
    expect(result.mediaId).toBe('m-2');
    const input = uploadMedia.mock.calls[0]![0];
    expect(input.onMediaId).toBeUndefined();
    expect(input.onProgress).toBeUndefined();
    expect(input.signal).toBeUndefined();
  });
});

describe('discardDraftImage', () => {
  it('temp（未持久化）且有 mediaId 时调用 discardMedia', async () => {
    const { api, discardMedia } = makeApi();
    await discardDraftImage(api, makeDraft({ mediaId: 'm-temp', persisted: false }));
    expect(discardMedia).toHaveBeenCalledWith('m-temp');
  });

  it('existing（persisted）媒体绝不 DELETE——已绑定资源由服务端按替换语义回收', async () => {
    const { api, discardMedia } = makeApi();
    await discardDraftImage(api, makeDraft({ mediaId: 'm-bound', persisted: true }));
    expect(discardMedia).not.toHaveBeenCalled();
  });

  it('null 草稿与无 mediaId 的草稿都是 no-op', async () => {
    const { api, discardMedia } = makeApi();
    await discardDraftImage(api, null);
    await discardDraftImage(api, makeDraft({ mediaId: null }));
    expect(discardMedia).not.toHaveBeenCalled();
  });

  it('discard 失败不抛出（best-effort：关页/切模式路径不能因清理失败中断）', async () => {
    const { api, discardMedia } = makeApi();
    discardMedia.mockRejectedValue(new Error('404'));
    await expect(
      discardDraftImage(api, makeDraft({ mediaId: 'm-temp' })),
    ).resolves.toBeUndefined();
  });
});
