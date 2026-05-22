import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'] });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  MYSQL_HOST: z.string(),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_USER: z.string(),
  MYSQL_PASSWORD: z.string(),
  MYSQL_DATABASE: z.string(),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  INVITE_TTL_DAYS: z.coerce.number().default(7),
  ATTACHMENT_S3_BUCKET: z.string().min(1),
  ATTACHMENT_S3_PREFIX: z.string().default('dev/attachments'),
  ATTACHMENT_S3_ENDPOINT: z.string().optional(),
  ATTACHMENT_S3_REGION: z.string().default('us-east-1'),
  ATTACHMENT_S3_ACCESS_KEY_ID: z.string().min(1),
  ATTACHMENT_S3_SECRET_ACCESS_KEY: z.string().min(1),
  // 注意：z.coerce.boolean() 会把字符串 'false' 判为 true，必须用 enum + transform。
  // MVP 仅支持私有桶（spec §5.3）：公有桶分支是保留的死代码路径，config 层直接拒绝开启。
  ATTACHMENT_S3_IS_PUBLIC: z
    .enum(['true', 'false'])
    .default('false')
    .refine((v) => v === 'false', { message: 'PUBLIC_BUCKET_UNSUPPORTED: MVP 仅支持私有桶（spec §5.3）' })
    .transform((v) => (v as string) === 'true'),
  // GET TTL 上限 3600：alignedGetPresign 的「过期时刻落在下一窗内」推导要求 TTL ≤ 一个窗长（3600s）
  PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(3600),
  PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  EXPO_ACCESS_TOKEN: z.string().default(''),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
