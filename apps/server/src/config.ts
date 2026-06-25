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
  /** 头像预签名 GET：默认 6 天。S3 SigV4 IAM 用户上限 7 天。 */
  AVATAR_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(6 * 24 * 3600),
  EXPO_ACCESS_TOKEN: z.string().default(''),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  // Sweeper（worker 进程；spec §5.5 防孤儿）
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  // dry-run 先行：true 时只打日志不删行/对象（生产首轮观察用）
  SWEEPER_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MEDIA_UPLOADING_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  MOMENT_SOFT_DELETE_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  // E2E 视觉回归（plan Task 14）：默认关闭；=1 时 fixture CLI/seed 才被守卫放行，
  // 且仍要求 NODE_ENV=test + MYSQL_DATABASE=moment_e2e + 私有 loopback 桶。
  MOMENT_E2E: z.enum(['0', '1']).default('0'),
  // E2E fixture 账号凭据：空串视为未配置；真实值只在 ignored 的 .env.e2e / CI 非生产 secret。
  MOMENT_E2E_OWNER_EMAIL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email().optional(),
  ),
  // 与注册（dto auth registerSchema）同一最小长度 8。
  MOMENT_E2E_OWNER_PASSWORD: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(8).max(72).optional(),
  ),
  MOMENT_E2E_VIEWER_EMAIL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email().optional(),
  ),
  MOMENT_E2E_VIEWER_PASSWORD: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(8).max(72).optional(),
  ),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
