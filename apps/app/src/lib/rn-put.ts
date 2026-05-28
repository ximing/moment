import { File } from 'expo-file-system';
import { ApiError, type FilePart, type PutFn } from '@moment/api-client';

/** 按 [start, end) 区间从文件读字节（不整文件读入）。 */
function readPartBytes(part: FilePart): Uint8Array<ArrayBuffer> {
  // SDK 54 File.open() 无 mode 参数（brief 的 open('r') 类型不存在）
  const handle = new File(part.fileUri).open();
  try {
    handle.offset = part.start; // FileHandle 游标可定位（seek）
    // SDK 54 FileHandle.readBytes 标成 Uint8Array<ArrayBufferLike>，BlobPart 要 ArrayBuffer
    return handle.readBytes(part.end - part.start) as Uint8Array<ArrayBuffer>;
  } finally {
    handle.close();
  }
}

export const rnPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ApiError('已取消', 0, 'ABORTED')); return; }
    try {
      // Blob（图片等已在内存的小对象）直接发送；FilePart（视频分片）读盘构造
      const blob = body instanceof Blob ? body : new Blob([readPartBytes(body)], { type: contentType });
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onerror = () => reject(new ApiError('网络错误', 0, 'NETWORK_ERROR'));
      xhr.onabort = () => reject(new ApiError('已取消', 0, 'ABORTED'));
      xhr.onload = () => {
        const etag = xhr.getResponseHeader('ETag');
        if (xhr.status >= 200 && xhr.status < 300) resolve({ etag });
        else reject(new ApiError(`PUT 失败（${xhr.status}）`, xhr.status, 'UPLOAD_FAILED'));
      };
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(blob);
    } catch (err) {
      reject(err instanceof ApiError ? err : new ApiError('分片读取失败', 0, 'UPLOAD_FAILED'));
    }
  });
