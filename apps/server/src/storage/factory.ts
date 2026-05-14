import { config } from '../config.js';
import { S3UnifiedStorageAdapter } from './s3.adapter.js';
import type { StorageMetadata, UnifiedStorageAdapter } from './base.adapter.js';

let singleton: UnifiedStorageAdapter | null = null;
let override: UnifiedStorageAdapter | null = null;

/** 按 config 创建单例 adapter（当前仅 S3；本地 local adapter 需要时再加分支） */
export function getStorage(): UnifiedStorageAdapter {
  if (override) return override;
  if (!singleton) {
    singleton = new S3UnifiedStorageAdapter({
      bucket: config.ATTACHMENT_S3_BUCKET,
      prefix: config.ATTACHMENT_S3_PREFIX,
      region: config.ATTACHMENT_S3_REGION,
      endpoint: config.ATTACHMENT_S3_ENDPOINT,
      accessKeyId: config.ATTACHMENT_S3_ACCESS_KEY_ID,
      secretAccessKey: config.ATTACHMENT_S3_SECRET_ACCESS_KEY,
      isPublic: config.ATTACHMENT_S3_IS_PUBLIC,
    });
  }
  return singleton;
}

/** 测试注入点：替换 adapter（传 null 恢复真实单例）。严禁在业务代码中使用。 */
export function setStorageAdapter(adapter: UnifiedStorageAdapter | null): void {
  override = adapter;
}

/** 生成 media 行的 storage_meta（写入时配置快照，spec §5.3） */
export function currentStorageMeta(): StorageMetadata {
  return {
    bucket: config.ATTACHMENT_S3_BUCKET,
    prefix: config.ATTACHMENT_S3_PREFIX,
    endpoint: config.ATTACHMENT_S3_ENDPOINT,
    region: config.ATTACHMENT_S3_REGION,
    isPublicBucket: config.ATTACHMENT_S3_IS_PUBLIC ? 'true' : 'false',
  };
}
