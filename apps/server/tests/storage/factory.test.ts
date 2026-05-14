import type { UnifiedStorageAdapter } from '../../src/storage/base.adapter.js';
import { getStorage, setStorageAdapter } from '../../src/storage/factory.js';
import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';

function fakeAdapter(): UnifiedStorageAdapter {
  return {
    uploadFile: async () => undefined,
    deleteFile: async () => undefined,
    fileExists: async () => false,
    headObject: async () => null,
    copyObject: async () => undefined,
    generateAccessUrl: async () => 'https://fake/presigned',
    presignPut: async () => 'https://fake/put',
    initMultipart: async () => 'upload-1',
    presignPart: async () => 'https://fake/part',
    completeMultipart: async () => undefined,
    abortMultipart: async () => undefined,
  };
}

afterEach(() => setStorageAdapter(null));

describe('storage factory', () => {
  it('默认按 config 创建 S3 adapter 单例', () => {
    const a = getStorage();
    const b = getStorage();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(S3UnifiedStorageAdapter);
  });

  it('setStorageAdapter 注入 mock 后 getStorage 返回 mock；置 null 恢复单例', () => {
    const mock = fakeAdapter();
    setStorageAdapter(mock);
    expect(getStorage()).toBe(mock);
    setStorageAdapter(null);
    expect(getStorage()).not.toBe(mock);
  });
});
