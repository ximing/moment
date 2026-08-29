import { jest } from '@jest/globals';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { UnifiedStorageAdapter } from '../../src/storage/base.adapter.js';

/**
 * installMockStorage 的返回类型：每个方法都是带正确签名的 jest mock。
 * 不能用裸 jest.Mock / Record<string, jest.Mock>——@jest/globals 的 Mock 默认泛型
 * UnknownFunction 不是 async 函数，会让 .mockResolvedValue(...) 的参数塌成 never。
 */
export type MockStorage = jest.Mocked<UnifiedStorageAdapter>;

/**
 * 安装全 mock 存储适配器并返回按方法名索引的 jest mock 集合。
 * 用法：const storage = installMockStorage(); afterEach(() => setStorageAdapter(null));
 */
export function installMockStorage(): MockStorage {
  const mock: MockStorage = {
    uploadFile: jest.fn<UnifiedStorageAdapter['uploadFile']>().mockResolvedValue(undefined),
    deleteFile: jest.fn<UnifiedStorageAdapter['deleteFile']>().mockResolvedValue(undefined),
    fileExists: jest.fn<UnifiedStorageAdapter['fileExists']>().mockResolvedValue(false),
    headObject: jest.fn<UnifiedStorageAdapter['headObject']>().mockResolvedValue(null),
    copyObject: jest.fn<UnifiedStorageAdapter['copyObject']>().mockResolvedValue(undefined),
    generateAccessUrl: jest
      .fn<UnifiedStorageAdapter['generateAccessUrl']>()
      .mockResolvedValue('https://fake.local/presigned-get'),
    presignPut: jest
      .fn<UnifiedStorageAdapter['presignPut']>()
      .mockResolvedValue('https://fake.local/presigned-put'),
    initMultipart: jest.fn<UnifiedStorageAdapter['initMultipart']>().mockResolvedValue('fake-upload-id'),
    presignPart: jest
      .fn<UnifiedStorageAdapter['presignPart']>()
      .mockResolvedValue('https://fake.local/presigned-part'),
    completeMultipart: jest.fn<UnifiedStorageAdapter['completeMultipart']>().mockResolvedValue(undefined),
    abortMultipart: jest.fn<UnifiedStorageAdapter['abortMultipart']>().mockResolvedValue(undefined),
    getObject: jest.fn<UnifiedStorageAdapter['getObject']>().mockResolvedValue(Buffer.alloc(0)),
  };
  setStorageAdapter(mock);
  return mock;
}
