import { File, Paths } from 'expo-file-system';
import {
  createUploadTask,
  FileSystemSessionType,
  FileSystemUploadType,
} from 'expo-file-system/legacy';
import { ApiError, type FilePart, type PutFn } from '@moment/api-client';

/** 按 [start, end) 区间从文件读字节（不整文件读入）。 */
function readPartBytes(part: FilePart): Uint8Array<ArrayBuffer> {
  // SDK 54 File.open() 无 mode 参数（brief 的 open('r') 类型不存在）
  const handle = new File(part.fileUri).open();
  try {
    handle.offset = part.start; // FileHandle 游标可定位（seek）
    return handle.readBytes(part.end - part.start) as Uint8Array<ArrayBuffer>;
  } finally {
    handle.close();
  }
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return null;
}

function removeTemp(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // 临时分片删不掉不影响上传结果
  }
}

/**
 * React Native 的 Blob 只接受字符串或其他 Blob，传入 Uint8Array 会抛
 * "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"。
 * 分片先落临时文件，再由原生 PUT 把文件当请求体发出（带进度和 ETag）。
 */
function putFileBytes(
  url: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ etag: string | null }> {
  const tmp = new File(Paths.cache, `moment-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  tmp.create();
  try {
    tmp.write(bytes);
  } catch (err) {
    removeTemp(tmp);
    throw err;
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      removeTemp(tmp);
      reject(new ApiError('已取消', 0, 'ABORTED'));
      return;
    }
    const task = createUploadTask(
      url,
      tmp.uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystemSessionType.FOREGROUND,
        headers: { 'Content-Type': contentType },
      },
      (data) => onProgress?.(data.totalBytesSent, data.totalBytesExpectedToSend),
    );
    const onAbort = () => {
      void task.cancelAsync();
    };
    signal?.addEventListener('abort', onAbort);
    task
      .uploadAsync()
      .then((result) => {
        signal?.removeEventListener('abort', onAbort);
        removeTemp(tmp);
        if (!result) {
          reject(new ApiError('已取消', 0, 'ABORTED'));
          return;
        }
        if (result.status >= 200 && result.status < 300) {
          resolve({ etag: headerValue(result.headers, 'etag') });
          return;
        }
        reject(new ApiError(`PUT 失败（${result.status}）`, result.status, 'UPLOAD_FAILED'));
      })
      .catch((err: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        removeTemp(tmp);
        reject(err instanceof ApiError ? err : new ApiError('网络错误', 0, 'NETWORK_ERROR'));
      });
  });
}

function putBlob(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('已取消', 0, 'ABORTED'));
      return;
    }
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiError('当前环境无 XMLHttpRequest', 0, 'PUT_UNAVAILABLE'));
      return;
    }
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
  });
}

export const rnPut: PutFn = (url, body, contentType, onProgress, signal) => {
  if (signal?.aborted) return Promise.reject(new ApiError('已取消', 0, 'ABORTED'));
  try {
    if (body instanceof Blob) return putBlob(url, body, contentType, onProgress, signal);
    return putFileBytes(url, readPartBytes(body), contentType, onProgress, signal);
  } catch (err) {
    return Promise.reject(err instanceof ApiError ? err : new ApiError('分片读取失败', 0, 'UPLOAD_FAILED'));
  }
};
