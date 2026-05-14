import mime from 'mime-types';

/**
 * 按行记录写入时的存储配置（spec §5.3）：
 * 日后换桶/换 endpoint，旧 media 仍按行上 meta 签名访问。
 */
export interface StorageMetadata {
  bucket?: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
  isPublicBucket?: 'true' | 'false';
}

/** 预签名 PUT / 初始化 multipart 时需要的内容类型（签进 URL，强制客户端带一致 Content-Type） */
export interface PutMeta {
  contentType: string;
}

/** completeMultipart 所需的 part 信息（客户端从 S3 PUT 响应的 ETag 原样回传） */
export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface HeadObjectResult {
  size: number;
  contentType: string | undefined;
  lastModified: Date;
}

/** 统一存储适配器（CONVENTIONS §3.3，方法名不得改） */
export interface UnifiedStorageAdapter {
  uploadFile(key: string, buffer: Buffer): Promise<void>;
  deleteFile(key: string, metadata?: StorageMetadata): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void>;
  generateAccessUrl(key: string, metadata: StorageMetadata, expiresIn?: number, signingDate?: Date): Promise<string>;
  presignPut(key: string, meta: PutMeta, expiresIn: number): Promise<string>;
  /** 返回 S3 multipart uploadId */
  initMultipart(key: string, meta: PutMeta): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, expiresIn: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

/** 抽象基类：key 均为相对 key（不含 prefix），子类负责拼前缀 */
export abstract class BaseUnifiedStorageAdapter implements UnifiedStorageAdapter {
  abstract uploadFile(key: string, buffer: Buffer): Promise<void>;
  abstract deleteFile(key: string, metadata?: StorageMetadata): Promise<void>;
  abstract fileExists(key: string): Promise<boolean>;
  abstract headObject(key: string): Promise<HeadObjectResult | null>;
  abstract copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void>;
  abstract generateAccessUrl(
    key: string,
    metadata: StorageMetadata,
    expiresIn?: number,
    signingDate?: Date
  ): Promise<string>;
  abstract presignPut(key: string, meta: PutMeta, expiresIn: number): Promise<string>;
  abstract initMultipart(key: string, meta: PutMeta): Promise<string>;
  abstract presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number
  ): Promise<string>;
  abstract completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abstract abortMultipart(key: string, uploadId: string): Promise<void>;

  /**
   * Content-Type 安全过滤（沿用 aimo）：危险类型一律 octet-stream，
   * 防私有桶被滥用为静态站托管（spec §5.3）。
   */
  protected getContentType(key: string): string {
    const filename = key.split('/').pop() || key;
    const mimeType = mime.lookup(filename) as string | false;
    if (
      !mimeType ||
      mimeType === 'text/html' ||
      mimeType === 'text/plain' ||
      mimeType === 'application/javascript' ||
      mimeType === 'text/javascript' ||
      // SVG 可内嵌 <script>，以原始 Content-Type 经预签名 GET 下发即存储型 XSS——强制 octet-stream
      // （与 dto 层 mime 白名单构成双防线，防绕过 presign 的旧数据/直传对象）
      mimeType === 'image/svg+xml'
    ) {
      return 'application/octet-stream';
    }
    return mimeType;
  }
}
