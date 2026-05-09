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
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
