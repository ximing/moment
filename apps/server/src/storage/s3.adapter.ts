import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../utils/logger.js';
import {
  BaseUnifiedStorageAdapter,
  type CompletedPart,
  type HeadObjectResult,
  type PutMeta,
  type StorageMetadata,
} from './base.adapter.js';
import { ObjectTooLargeError, abortS3Body, readBodyWithLimit } from './bounded-read.js';

export interface S3UnifiedStorageAdapterConfig {
  bucket: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  isPublic?: boolean;
}

/** S3（及一切 S3 兼容服务：MinIO/R2/Spaces/阿里云 OSS S3 网关…）适配器，沿用 aimo 模式 */
export class S3UnifiedStorageAdapter extends BaseUnifiedStorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly endpoint?: string;
  private readonly region: string;
  private readonly isPublic: boolean;

  constructor(cfg: S3UnifiedStorageAdapterConfig) {
    super();
    if (!cfg.bucket) throw new Error('S3 bucket name is required');
    this.bucket = cfg.bucket;
    this.prefix = cfg.prefix || 'uploads';
    this.endpoint = cfg.endpoint || undefined;
    this.region = cfg.region || 'us-east-1';
    this.isPublic = cfg.isPublic || false;

    // 阿里云 OSS 走 virtual-hosted-style，其余自建 endpoint 走 path-style（沿用 aimo）
    const isAliyunOSS = this.endpoint?.includes(this.region) || this.endpoint?.includes('aliyuncs');
    const clientConfig: Record<string, unknown> = { region: this.region };
    if (this.endpoint) {
      clientConfig.endpoint = this.endpoint;
      clientConfig.forcePathStyle = !isAliyunOSS;
    }
    if (cfg.accessKeyId && cfg.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      };
    }
    this.client = new S3Client(clientConfig as import('@aws-sdk/client-s3').S3ClientConfig);
    logger.info(
      `S3 adapter initialized: bucket=${this.bucket} prefix=${this.prefix} endpoint=${this.endpoint ?? 'AWS'} isPublic=${this.isPublic}`
    );
  }

  /** db 里的 s3_key 是相对 key，adapter 统一拼前缀 */
  private full(key: string): string {
    return `${this.prefix}/${key}`.replaceAll(/\/+/g, '/');
  }

  /** 按行上 storage_meta 解析前缀（换桶/换 prefix 后旧对象仍在旧位置，spec §5.3） */
  private fullFor(key: string, metadata?: StorageMetadata): string {
    return `${this.prefixFrom(metadata)}/${key}`.replaceAll(/\/+/g, '/');
  }

  private bucketFrom(metadata?: StorageMetadata): string {
    return metadata?.bucket || this.bucket;
  }

  private prefixFrom(metadata?: StorageMetadata): string {
    return metadata?.prefix || this.prefix;
  }

  /** S3 兼容服务对 HeadObject 404 的错误形状不一：NotFound 与 $metadata.httpStatusCode 404 都算不存在 */
  private is404(error: unknown): boolean {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
  }

  async uploadFile(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.full(key), Body: buffer })
    );
  }

  /** metadata 传入行上 storage_meta：旧媒体按快照位置删除（spec §5.3） */
  async deleteFile(key: string, metadata?: StorageMetadata): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketFrom(metadata),
        Key: this.fullFor(key, metadata),
      })
    );
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.full(key) }));
      return true;
    } catch (error) {
      if (this.is404(error)) return false;
      throw error;
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.full(key) })
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified ?? new Date(),
      };
    } catch (error) {
      if (this.is404(error)) return null;
      throw error;
    }
  }

  /**
   * 同桶服务端 copy（发布 moment 时 tmp → final，不经客户端，spec §5.5；时机偏离见 Global Constraints）。
   * metadata 传入 media 行的 storage_meta：copy 在源对象所在的（快照）桶内进行。
   */
  async copyObject(srcKey: string, destKey: string, metadata?: StorageMetadata): Promise<void> {
    const bucket = this.bucketFrom(metadata);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${this.fullFor(srcKey, metadata)}`,
        Key: this.fullFor(destKey, metadata),
      })
    );
  }

  /**
   * 有界 GetObject（spec §2.4）。桶/prefix 来自行上 metadata，client/endpoint 与 generateAccessUrl 同（MVP 单桶）。
   * ContentLength 已知且超限时不把 body 读入内存。
   */
  async getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketFrom(metadata),
        Key: this.fullFor(key, metadata),
      }),
    );
    if (typeof res.ContentLength === 'number' && res.ContentLength > maxBytes) {
      abortS3Body(res.Body);
      throw new ObjectTooLargeError(key, maxBytes);
    }
    if (!res.Body) {
      throw new Error('S3 GetObject returned empty Body');
    }
    return readBodyWithLimit(res.Body as AsyncIterable<Uint8Array>, maxBytes, key);
  }

  async generateAccessUrl(
    key: string,
    metadata: StorageMetadata,
    expiresIn = 3600,
    signingDate?: Date
  ): Promise<string> {
    const isPublic = metadata.isPublicBucket === 'true' ? true : this.isPublic;
    const fullKey = `${this.prefixFrom(metadata)}/${key}`.replaceAll(/\/+/g, '/');
    const bucket = this.bucketFrom(metadata);
    // MVP 死代码路径：config 已校验 ATTACHMENT_S3_IS_PUBLIC 必须 false（Task 2），此公有桶分支
    // 仅为保留 aimo 模式完整性，当前不可达（metadata 行快照也由同一 config 写入）。
    if (isPublic) {
      const domain = (metadata.endpoint || this.endpoint || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (domain) return `https://${bucket}.${domain}/${fullKey}`;
      return `https://${bucket}.s3.${metadata.region || this.region}.amazonaws.com/${fullKey}`;
    }
    // signingDate：整点对齐的签名时刻（spec §5.3）。SigV4 的 X-Amz-Date 取自签名时刻，
    // 不对齐它则 URL 每秒都变，「同一时间窗内 URL 相同」无从谈起——必须与 expiresIn 一起由调用方对齐。
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: fullKey,
        ResponseContentType: this.getContentType(fullKey),
      }),
      signingDate ? { expiresIn, signingDate } : { expiresIn }
    );
  }

  async presignPut(key: string, meta: PutMeta, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        ContentType: meta.contentType,
      }),
      { expiresIn }
    );
  }

  async initMultipart(key: string, meta: PutMeta): Promise<string> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        ContentType: meta.contentType,
      })
    );
    if (!res.UploadId) throw new Error('S3 CreateMultipartUpload returned no UploadId');
    return res.UploadId;
  }

  async presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn }
    );
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      })
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.full(key),
        UploadId: uploadId,
      })
    );
  }
}
