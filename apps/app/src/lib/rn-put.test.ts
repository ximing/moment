import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@moment/api-client';

const upload = vi.hoisted(() => ({
  createUploadTask: vi.fn(),
}));

vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = false;
    written: Uint8Array | null = null;
    constructor(...parts: unknown[]) {
      const first = parts[0];
      const name = String(parts[parts.length - 1]);
      this.uri = typeof first === 'string' && first.startsWith('file://') ? first : `file://cache/${name}`;
    }
    open() {
      return {
        offset: 0,
        readBytes: (n: number) => new Uint8Array(n).fill(7),
        close() {},
      };
    }
    create() {
      this.exists = true;
    }
    write(bytes: Uint8Array) {
      this.written = bytes;
    }
    delete() {
      this.exists = false;
    }
  }
  return { File, Paths: { cache: { uri: 'file://cache' } } };
});

vi.mock('expo-file-system/legacy', () => ({
  createUploadTask: upload.createUploadTask,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  FileSystemSessionType: { FOREGROUND: 1 },
}));

import { rnPut } from './rn-put';

describe('rnPut', () => {
  beforeEach(() => {
    upload.createUploadTask.mockReset();
  });

  it('文件分片走原生 PUT，不把字节包成 Blob', async () => {
    const uploadAsync = vi.fn().mockResolvedValue({
      status: 200,
      headers: { ETag: '"part-1"' },
      body: '',
      mimeType: null,
    });
    upload.createUploadTask.mockImplementation((_url: string, _uri: string, _opts: unknown, onProgress?: (data: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void) => {
      onProgress?.({ totalBytesSent: 4, totalBytesExpectedToSend: 4 });
      return { uploadAsync, cancelAsync: vi.fn() };
    });
    const seen: number[] = [];
    const result = await rnPut(
      'https://s3.example/part',
      { fileUri: 'file://clip.mp4', start: 0, end: 4, size: 4, mime: 'video/mp4' },
      'video/mp4',
      (loaded) => seen.push(loaded),
    );
    expect(result).toEqual({ etag: '"part-1"' });
    expect(seen).toEqual([4]);
    expect(upload.createUploadTask).toHaveBeenCalledTimes(1);
    const [url, fileUri, options] = upload.createUploadTask.mock.calls[0]!;
    expect(url).toBe('https://s3.example/part');
    expect(fileUri).toMatch(/^file:\/\/cache\/moment-upload-/);
    expect(options).toMatchObject({
      httpMethod: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
    });
  });

  it('已在内存的 Blob 不走原生文件上传', async () => {
    await expect(rnPut('https://s3.example/put', new Blob([new Uint8Array([1, 2])]), 'image/jpeg')).rejects.toMatchObject({
      code: 'PUT_UNAVAILABLE',
    });
    expect(upload.createUploadTask).not.toHaveBeenCalled();
  });

  it('原生 PUT 非 2xx 是 UPLOAD_FAILED', async () => {
    upload.createUploadTask.mockReturnValue({
      cancelAsync: vi.fn(),
      uploadAsync: vi.fn().mockResolvedValue({ status: 403, headers: {}, body: '', mimeType: null }),
    });
    await expect(
      rnPut('https://s3.example/part', { fileUri: 'file://clip.mp4', start: 0, end: 2, size: 2, mime: 'video/mp4' }, 'video/mp4'),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
