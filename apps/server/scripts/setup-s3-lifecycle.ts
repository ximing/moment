/**
 * 一次性配置 bucket lifecycle（spec §5.5 防孤儿）：
 * - {prefix}/tmp/ 前缀 7 天未 complete 自动删（孤儿上传兜底）；
 * - AbortIncompleteMultipartUpload 7 天（中止未完成分片，隐藏账单）。
 * 幂等：PutBucketLifecycleConfiguration 为全量覆盖式配置。
 * 运行：pnpm --filter @moment/server setup:s3-lifecycle（读 apps/server/.env 的真实凭据）。
 */
import { PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

const endpoint = config.ATTACHMENT_S3_ENDPOINT || undefined;
// 与 src/storage/s3.adapter.ts 同一判定：阿里云 OSS 走 virtual-hosted-style（path-style 会被拒），
// 其余自建 endpoint 走 path-style；无 endpoint（AWS 官方）不设 forcePathStyle。
const isAliyunOSS = endpoint?.includes(config.ATTACHMENT_S3_REGION) || endpoint?.includes('aliyuncs');
const client = new S3Client({
  region: config.ATTACHMENT_S3_REGION,
  endpoint,
  ...(endpoint ? { forcePathStyle: !isAliyunOSS } : {}),
  credentials: {
    accessKeyId: config.ATTACHMENT_S3_ACCESS_KEY_ID,
    secretAccessKey: config.ATTACHMENT_S3_SECRET_ACCESS_KEY,
  },
});

const tmpPrefix = `${config.ATTACHMENT_S3_PREFIX}/tmp/`;

await client.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: config.ATTACHMENT_S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'moment-tmp-expire-7d',
          Status: 'Enabled',
          Filter: { Prefix: tmpPrefix },
          Expiration: { Days: 7 },
        },
        {
          ID: 'moment-abort-incomplete-multipart-7d',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  })
);

logger.info('bucket lifecycle configured', { bucket: config.ATTACHMENT_S3_BUCKET, tmpPrefix });
