import { ApiError, type PutFn } from './types.js';

/**
 * 浏览器默认直传实现：XHR（fetch 无上传进度——spec §2「注意不挡死上传进度回调」）。
 * node 环境没有 XMLHttpRequest，测试/SSR 必须注入 putWithProgress。
 */
export const xhrPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      // 进入时 signal 已 aborted：不加监听直接拒绝（abort 事件不会再触发）
      reject(new ApiError('已取消', 0, 'ABORTED'));
      return;
    }
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiError('当前环境无 XMLHttpRequest，请注入 putWithProgress', 0, 'PUT_UNAVAILABLE'));
      return;
    }
    if (!(body instanceof Blob)) {
      // FilePart（fileUri 形态）需注入自定义 put（如 Phase 7 RN 版 rnPut）按片读盘
      reject(new ApiError('fileUri 形态需注入自定义 putWithProgress', 0, 'PUT_UNAVAILABLE'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.total);
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new ApiError(`直传失败（${xhr.status}）`, xhr.status, 'UPLOAD_FAILED'));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError('网络错误', 0, 'NETWORK_ERROR'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ApiError('已取消', 0, 'ABORTED'));
    };
    xhr.send(body);
  });
