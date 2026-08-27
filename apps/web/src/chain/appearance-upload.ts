import type { MomentClient } from '@moment/api-client';
import type { ChainImageDraft } from './appearance-model';

// 链外观上传 helper（plan Task 7）：
// 只接受注入的 Pick<MomentClient,'uploadMedia'|'discardMedia'>——不 import 全局
// client，组件/测试按注入替换，不 mock 全局模块。

export type ChainImageApi = Pick<MomentClient, 'uploadMedia' | 'discardMedia'>;

export interface UploadChainImageCallbacks {
  /** presign 成功即回调（完成前也可能需要凭 id discard） */
  onMediaId?: (mediaId: string) => void;
  onProgress?: (loaded: number, total: number) => void;
}

/** 链头像/封面上传：kind 固定 image，signal 与回调原样透传。 */
export async function uploadChainImage(
  api: ChainImageApi,
  file: Blob,
  callbacks: UploadChainImageCallbacks = {},
  signal?: AbortSignal,
): Promise<{ mediaId: string }> {
  const res = await api.uploadMedia({
    file,
    mime: file.type,
    size: file.size,
    kind: 'image',
    onMediaId: callbacks.onMediaId,
    onProgress: callbacks.onProgress,
    signal,
  });
  return { mediaId: res.mediaId };
}

/**
 * 丢弃临时（未持久化）图片：best-effort，失败不抛出——关页/切模式的清理路径
 * 不能因回收失败中断；已持久化的既有资源绝不 DELETE（由服务端替换语义回收）。
 */
export async function discardDraftImage(
  api: ChainImageApi,
  image: ChainImageDraft | null,
): Promise<void> {
  if (image === null || image.persisted || image.mediaId === null) return;
  try {
    await api.discardMedia(image.mediaId);
  } catch {
    // best-effort：回收失败交给服务端 orphan sweeper
  }
}
