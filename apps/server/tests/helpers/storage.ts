import { jest } from '@jest/globals';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { UnifiedStorageAdapter } from '../../src/storage/base.adapter.js';

/**
 * 安装全 mock 存储适配器并返回按方法名索引的 jest.Mock 集合。
 * 用法：const storage = installMockStorage(); afterEach(() => setStorageAdapter(null));
 */
export function installMockStorage(): Record<string, jest.Mock> {
  const impl: Record<string, unknown> = {
    uploadFile: async () => undefined,
    deleteFile: async () => undefined,
    fileExists: async () => false,
    headObject: async () => null,
    copyObject: async () => undefined,
    generateAccessUrl: async () => 'https://fake.local/presigned-get',
    presignPut: async () => 'https://fake.local/presigned-put',
    initMultipart: async () => 'fake-upload-id',
    presignPart: async () => 'https://fake.local/presigned-part',
    completeMultipart: async () => undefined,
    abortMultipart: async () => undefined,
  };
  const mock: UnifiedStorageAdapter = Object.fromEntries(
    Object.entries(impl).map(([k, v]) => [k, jest.fn(v)])
  ) as unknown as UnifiedStorageAdapter;
  setStorageAdapter(mock);
  return mock as unknown as Record<string, jest.Mock>;
}
