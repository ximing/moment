# Phase 1: Monorepo 脚手架 + Server 骨架 + Auth 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 pnpm monorepo（config 包 + dto 包 + server 骨架），实现邮箱+密码注册登录（bcrypt + access/refresh 双 token、refresh 旋转与复用检测），可用 docker-compose 起本地 MySQL，全部代码有测试。

**Architecture:** 沿用 aimo 骨架：Express + routing-controllers + TypeDI + Drizzle ORM（NodeNext ESM）。本计划只覆盖 spec §10 的阶段 1；链、moment、媒体、feed、互动、App 各自有后续计划。worker、packages/api-client、packages/logger 在需要它们的阶段再建（YAGNI）。

**Tech Stack:** pnpm 10.22 + Turbo / Express 4 + routing-controllers 0.11 + typedi / Drizzle + mysql2 / jsonwebtoken + bcrypt / zod 3 / Jest 29 (ts-jest ESM) + supertest / tsx。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§1 安全、§2 选型、§3 users/refresh_tokens 表、§4 Auth API、§6 安全、§9 部署）

## Global Constraints

- `packageManager: pnpm@10.22.0`，Node >= 20。
- 所有包 `"type": "module"`；server/dto 用 `module: NodeNext`，**相对 import 必须带 `.js` 后缀**（aimo 惯例）。
- 包命名：`@moment/server`、`@moment/dto`、`@moment/typescript-config`、`@moment/eslint-config`。
- API 统一 `routePrefix: /api`；错误响应统一 `{ error: { code, message, details? } }`。
- bcrypt cost = 10，密码无单独盐字段（bcrypt 内嵌盐）。密码长度 8–72。
- access token：JWT `{sub, type:'access'}`，900s；refresh token：48 字节随机 base64url，库存 sha256，30 天，**每次刷新旋转**，复用旧 token = 吊销该用户全部 refresh token。
- email 入库前 `trim().toLowerCase()`。
- 测试打**真实 MySQL 测试库**（`apps/server/.env` 里已配置 `moment_test_db`，严禁指向生产库）；jest globalSetup 跑迁移，`beforeEach` 清表。
- 每个 Task 结束 commit，conventional commits（如 `feat(server): ...`）。
- zod ^3.22（不要用 zod v4 API）。
- 业务错误约定：抛 `HttpError` 系错误时 `message` 承载 UPPER_SNAKE 机器码（如 `UnauthorizedError('INVALID_CREDENTIALS')`），错误中间件据此产出 `error.code`。
- refresh token 阶段 1 统一走 JSON body 传输（App 友好）；web 端 httpOnly cookie 化的取舍留到 web 阶段决策（spec §6 的备选方案之一，不算偏离）。
- `PATCH /me`（改昵称/头像）不在本计划，归属后续「用户资料」阶段，防止沉没。

---

### Task 1: Monorepo 根脚手架 + 共享 config 包

**Files:**
- Create: `package.json`、`pnpm-workspace.yaml`、`turbo.json`
- Create: `config/config-typescript/package.json`、`config/config-typescript/base.json`
- Create: `config/eslint-config/package.json`、`config/eslint-config/index.js`

**Interfaces:**
- Produces: `@moment/typescript-config`（`base.json`）、`@moment/eslint-config`（flat config 默认导出）；根脚本 `dev/build/test/lint/format`。

- [ ] **Step 1: 创建根文件**

`package.json`：
```json
{
  "name": "moment",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "prettier": "^3.5.1",
    "turbo": "^2.4.2",
    "typescript": "^5.7.3"
  },
  "packageManager": "pnpm@10.22.0",
  "engines": { "node": ">=20" }
}
```

`pnpm-workspace.yaml`：
```yaml
packages:
  - apps/*
  - packages/*
  - config/*

onlyBuiltDependencies:
  - bcrypt
  - esbuild
```

`turbo.json`：
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true, "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 2: 创建 config/config-typescript**

`config/config-typescript/package.json`：
```json
{
  "name": "@moment/typescript-config",
  "version": "0.0.0",
  "private": true
}
```

`config/config-typescript/base.json`：
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "isolatedModules": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 config/eslint-config**

`config/eslint-config/package.json`：
```json
{
  "name": "@moment/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "dependencies": {
    "@eslint/js": "^9.19.0",
    "eslint": "^9.19.0",
    "typescript-eslint": "^8.22.0"
  }
}
```

`config/eslint-config/index.js`：
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  }
);
```

- [ ] **Step 4: 安装并验证**

Run: `pnpm install`
Expected: 成功，无 peer 报错。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json config/
git commit -m "chore: monorepo 根脚手架与共享 config 包"
```

---

### Task 2: packages/dto — auth zod schema（TDD）

**Files:**
- Create: `packages/dto/package.json`、`packages/dto/tsconfig.json`
- Test: `packages/dto/src/auth.test.ts`
- Create: `packages/dto/src/auth.ts`、`packages/dto/src/index.ts`

**Interfaces:**
- Produces（后续 Task 全部依赖这些名字，不得改名）:
  - `registerInputSchema` / `RegisterInput`（email 已 trim+lowercase，password 8–72，nickname 1–50）
  - `loginInputSchema` / `LoginInput`
  - `refreshInputSchema` / `RefreshInput`
  - `AuthTokens = { accessToken: string; refreshToken: string; expiresIn: number }`
  - `UserProfile = { id: string; email: string; nickname: string; createdAt: string }`
  - `AuthResponse = { user: UserProfile; tokens: AuthTokens }`

- [ ] **Step 1: 包骨架**

`packages/dto/package.json`：
```json
{
  "name": "@moment/dto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsx --test src/*.test.ts",
    "lint": "eslint src/",
    "clean": "rm -rf dist"
  },
  "dependencies": { "zod": "^3.22.0" },
  "devDependencies": {
    "@moment/eslint-config": "workspace:*",
    "@moment/typescript-config": "workspace:*",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

`packages/dto/tsconfig.json`：
```json
{
  "extends": "@moment/typescript-config/base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/dto/eslint.config.js`：
```js
export { default } from '@moment/eslint-config';
```

- [ ] **Step 2: 写失败测试**

`packages/dto/src/auth.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginInputSchema, registerInputSchema } from './auth.js';

test('registerInputSchema 归一化 email（trim + lowercase）', () => {
  const input = registerInputSchema.parse({
    email: '  Alice@Example.COM ',
    password: 'secret123',
    nickname: 'Alice',
  });
  assert.equal(input.email, 'alice@example.com');
});

test('registerInputSchema 拒绝非法 email', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'not-an-email', password: 'secret123', nickname: 'A' })
  );
});

test('registerInputSchema 拒绝过短密码（<8）', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'a@b.com', password: 'short', nickname: 'A' })
  );
});

test('registerInputSchema 拒绝空 nickname', () => {
  assert.throws(() =>
    registerInputSchema.parse({ email: 'a@b.com', password: 'secret123', nickname: '' })
  );
});

test('loginInputSchema 同样归一化 email', () => {
  const input = loginInputSchema.parse({ email: 'Bob@Example.com', password: 'x' });
  assert.equal(input.email, 'bob@example.com');
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './auth.js'`）

- [ ] **Step 4: 实现**

`packages/dto/src/auth.ts`：
```ts
import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const registerInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(72),
  nickname: z.string().min(1).max(50),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 有效期（秒） */
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  /** ISO 8601 */
  createdAt: string;
}

export interface AuthResponse {
  user: UserProfile;
  tokens: AuthTokens;
}
```

`packages/dto/src/index.ts`：
```ts
export * from './auth.js';
```

- [ ] **Step 5: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 5 个测试 PASS；`dist/index.js` 与 `dist/index.d.ts` 生成。

- [ ] **Step 6: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): auth zod schema 与共享类型"
```

---

### Task 3: apps/server 骨架（config / logger / db / health / 错误中间件）

**Files:**
- Create: `apps/server/package.json`、`apps/server/tsconfig.json`、`apps/server/tsconfig.build.json`、`apps/server/jest.config.mjs`、`apps/server/eslint.config.js`、`apps/server/drizzle.config.ts`
- Create: `apps/server/src/config.ts`、`apps/server/src/utils/logger.ts`、`apps/server/src/db/index.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/app.ts`、`apps/server/src/index.ts`、`apps/server/src/controllers/health.controller.ts`、`apps/server/src/middlewares/error-handler.ts`
- Test: `apps/server/tests/health.test.ts`

**Interfaces:**
- Consumes: `@moment/dto`（本任务未用，但依赖已挂）。
- Produces:
  - `config`（zod 校验后的环境对象，含 `PORT/NODE_ENV/JWT_SECRET/ACCESS_TOKEN_TTL_SECONDS/REFRESH_TOKEN_TTL_DAYS/MYSQL_*`）
  - `logger`（`debug/info/warn/error(msg, meta?)`，JSON 行）
  - `db`（drizzle mysql2 实例）、`pool`
  - `createApp(): express.Express`（helmet + cors + json + routing-controllers，`routePrefix:'/api'`，defaultErrorHandler:false，after 错误中间件）
  - `ErrorHandlerMiddleware`：ZodError（instanceof 或 name 匹配）→400 `VALIDATION_ERROR`；HttpError→透传 status，message 为 UPPER_SNAKE 机器码时作 `code`、否则退回 `error.name`；其余→500 `INTERNAL_ERROR`

- [ ] **Step 1: 包与工具配置**

`apps/server/package.json`：
```json
{
  "name": "@moment/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "test": "cross-env NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules jest --runInBand",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ tests/",
    "migrate": "tsx src/db/migrate.ts",
    "migrate:generate": "drizzle-kit generate",
    "migrate:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@moment/dto": "workspace:*",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.45.1",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "mysql2": "^3.18.2",
    "reflect-metadata": "^0.2.2",
    "routing-controllers": "^0.11.1",
    "typedi": "^0.10.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@moment/eslint-config": "workspace:*",
    "@moment/typescript-config": "workspace:*",
    "@types/bcrypt": "^5.0.0",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.14",
    "@types/jsonwebtoken": "^9.0.9",
    "@types/node": "^22.13.4",
    "@types/supertest": "^6.0.2",
    "cross-env": "^7.0.0",
    "drizzle-kit": "^0.31.9",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.4.6",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3"
  }
}
```

`apps/server/tsconfig.json`：
```json
{
  "extends": "@moment/typescript-config/base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node", "jest"]
  },
  "include": ["src", "tests"]
}
```

`apps/server/tsconfig.build.json`：
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`apps/server/jest.config.mjs`：
```js
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  testTimeout: 30000,
};
```

`apps/server/eslint.config.js`：
```js
export { default } from '@moment/eslint-config';
```

`apps/server/drizzle.config.ts`：
```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.MYSQL_HOST!,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
  },
});
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/health.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('返回 200 {status:"ok"}', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('未知路由返回统一错误结构', async () => {
    const app = createApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.code).toBe('string');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`Cannot find module '../src/app.js'`）

- [ ] **Step 4: 实现骨架**

`apps/server/src/config.ts`：
```ts
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
```

`apps/server/src/utils/logger.ts`：
```ts
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, msg: string, meta?: unknown): void {
  if (LEVELS[level] < minLevel) return;
  const entry = { time: new Date().toISOString(), level, msg, ...(meta !== undefined ? { meta } : {}) };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
```

`apps/server/src/db/schema.ts`（本任务为空 barrel，Task 4 填表）：
```ts
// Drizzle schema barrel. Tables are added in later tasks/phases.
export {};
```

`apps/server/src/db/index.ts`：
```ts
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = mysql.createPool({
  host: config.MYSQL_HOST,
  port: config.MYSQL_PORT,
  user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD,
  database: config.MYSQL_DATABASE,
  connectionLimit: 10,
});

export const db = drizzle(pool, { schema, mode: 'default' });
```

`apps/server/src/middlewares/error-handler.ts`：
```ts
import type { NextFunction, Request, Response } from 'express';
import { HttpError, Middleware } from 'routing-controllers';
import type { ExpressErrorMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

@Middleware({ type: 'after' })
@Service()
export class ErrorHandlerMiddleware implements ExpressErrorMiddlewareInterface {
  error(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
    // instanceof + name 双保险：dto 包与 server 的 zod 若发生版本漂移，instanceof 会失效
    if (error instanceof ZodError || (error as Error)?.name === 'ZodError') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '请求参数不合法', details: (error as ZodError).issues },
      });
      return;
    }
    if (error instanceof HttpError) {
      // 约定：业务代码抛 HttpError 系错误时，message 承载 UPPER_SNAKE 机器码；
      // 框架自带错误（如 AuthorizationRequiredError）message 是自然语言，退回用 name 做 code。
      const isMachineCode = /^[A-Z0-9_]+$/.test(error.message);
      res.status(error.httpCode).json({
        error: { code: isMachineCode ? error.message : error.name, message: error.message },
      });
      return;
    }
    logger.error('unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
}
```

`apps/server/src/controllers/health.controller.ts`：
```ts
import { Get, JsonController } from 'routing-controllers';
import { Service } from 'typedi';

@JsonController('/health')
@Service()
export class HealthController {
  @Get('/')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
```

`apps/server/src/app.ts`：
```ts
import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { HealthController } from './controllers/health.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
```

`apps/server/src/index.ts`：
```ts
import 'reflect-metadata';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const app = createApp();
app.listen(config.PORT, () => {
  logger.info(`server listening on :${config.PORT}`, { env: config.NODE_ENV });
});
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm install && pnpm --filter @moment/server test`
Expected: 2 个测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): 骨架（config/logger/db/health/错误中间件）"
```

---

### Task 4: users + refresh_tokens 表与迁移

**Files:**
- Create: `apps/server/src/db/schema/users.ts`、`apps/server/src/db/schema/refresh-tokens.ts`
- Modify: `apps/server/src/db/schema.ts`（改为 barrel re-export）
- Create: `apps/server/src/db/migrate.ts`、`apps/server/tests/global-setup.ts`、`apps/server/tests/helpers/db.ts`
- Modify: `apps/server/jest.config.mjs`（加 globalSetup）
- Create: `apps/server/drizzle/0000_*.sql`（`drizzle-kit generate` 产物）

**Interfaces:**
- Produces（Task 5/6 依赖）:
  - `users` 表对象（列：`id/email/passwordHash/nickname/passwordChangedAt/createdAt`）
  - `refreshTokens` 表对象（列：`id/userId/tokenHash/deviceInfo/expiresAt/revokedAt/createdAt`）
  - `resetDb(): Promise<void>`（tests/helpers/db.ts，先清 refresh_tokens 再清 users）

- [ ] **Step 1: 写表定义**

`apps/server/src/db/schema/users.ts`（注：spec §3 的 `avatar_media_id` 本阶段不建——它引用尚不存在的 media 表，随媒体阶段迁移补列）：
```ts
import { char, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: char('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  nickname: varchar('nickname', { length: 50 }).notNull(),
  passwordChangedAt: timestamp('password_changed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

`apps/server/src/db/schema/refresh-tokens.ts`：
```ts
import { bigint, char, index, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    deviceInfo: varchar('device_info', { length: 255 }),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_refresh_tokens_user').on(t.userId)]
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
```

`apps/server/src/db/schema.ts`（整体替换）：
```ts
export * from './schema/users.js';
export * from './schema/refresh-tokens.js';
```

- [ ] **Step 1.5: 确认 .env 含 JWT_SECRET（阻塞前置）**

`src/config.ts` 在模块加载时强校验 `JWT_SECRET`（≥32 字符），`migrate`/测试/dev 全部经过它。检查 `apps/server/.env`：

```bash
grep -q '^JWT_SECRET=.\{32,\}' apps/server/.env || echo "JWT_SECRET=$(openssl rand -base64 48)" >> apps/server/.env
```

Expected: 执行后 `apps/server/.env` 含有效 `JWT_SECRET` 行。

- [ ] **Step 2: 生成迁移并跑通**

`apps/server/src/db/migrate.ts`：
```ts
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './index.js';
import { logger } from '../utils/logger.js';

await migrate(db, { migrationsFolder: './drizzle' });
logger.info('migrations applied');
await pool.end();
```

确认 `apps/server/.env` 指向测试库后：
Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成 `drizzle/0000_*.sql`；输出 `migrations applied`；数据库中出现 `users`、`refresh_tokens` 两表。

- [ ] **Step 3: 测试基建（globalSetup + resetDb）**

`apps/server/tests/global-setup.ts`：
```ts
export default async function globalSetup(): Promise<void> {
  // 动态 import，保证 NODE_ENV=test 生效后再加载 config/db
  const { db, pool } = await import('../src/db/index.js');
  const { migrate } = await import('drizzle-orm/mysql2/migrator');
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();
}
```

`apps/server/tests/helpers/db.ts`：
```ts
import { db, pool } from '../../src/db/index.js';
import { refreshTokens, users } from '../../src/db/schema.js';

/** 每个用例前清表：先子表后父表。仅允许对测试库使用。 */
export async function resetDb(): Promise<void> {
  await db.delete(refreshTokens);
  await db.delete(users);
}

/** 测试文件收尾关闭连接池（不关闭 jest 进程会因 open handle 挂住不退出）。 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
```

`apps/server/jest.config.mjs` 增加一行（替换整个文件）：
```js
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/tests/global-setup.ts',
  testTimeout: 30000,
};
```

- [ ] **Step 4: 验证现有测试仍通过**

Run: `pnpm --filter @moment/server test`
Expected: health 2 个测试 PASS（globalSetup 成功连库跑迁移）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): users 与 refresh_tokens 表、迁移与测试基建"
```

---

### Task 5: password + token 服务（TDD）

**Files:**
- Test: `apps/server/tests/auth/password.test.ts`、`apps/server/tests/auth/token.service.test.ts`
- Create: `apps/server/src/auth/password.ts`、`apps/server/src/auth/token.service.ts`

**Interfaces:**
- Consumes: `users`/`refreshTokens`（Task 4）、`config`、`db`、`resetDb`。
- Produces（Task 6 依赖，不得改名）:
  - `hashPassword(plain: string): Promise<string>`、`verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `class TokenService`（typedi `@Service()`）：
    - `signAccessToken(userId: string): string`
    - `verifyAccessToken(token: string): { userId: string; iat: number }`（失败抛 `UnauthorizedError`）
    - `issueRefreshToken(userId: string, deviceInfo?: string): Promise<string>`（返回原始 token）
    - `rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string }>`（未知→`UnauthorizedError('INVALID_REFRESH_TOKEN')`；已吊销→吊销该用户全部并抛 `UnauthorizedError('REFRESH_TOKEN_REUSED')`；过期→`UnauthorizedError('REFRESH_TOKEN_EXPIRED')`）
    - `revokeRefreshToken(raw: string): Promise<void>`（幂等）
    - `revokeAllForUser(userId: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

`apps/server/tests/auth/password.test.ts`：
```ts
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password', () => {
  it('hash 后可校验通过', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('同一密码两次 hash 不同（内嵌随机盐）', async () => {
    const [h1, h2] = await Promise.all([hashPassword('secret123'), hashPassword('secret123')]);
    expect(h1).not.toBe(h2);
  });
});
```

`apps/server/tests/auth/token.service.test.ts`：
```ts
import { UnauthorizedError } from 'routing-controllers';
import { Container } from 'typedi';
import { TokenService } from '../../src/auth/token.service.js';
import { db } from '../../src/db/index.js';
import { refreshTokens, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

const service = () => Container.get(TokenService);

async function insertUser(id = 'user-1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, passwordHash: 'x', nickname: id });
  return id;
}

beforeEach(resetDb);
afterAll(closeDb);

describe('TokenService access token', () => {
  it('签发并可验证，返回 userId 与 iat', () => {
    const token = service().signAccessToken('user-1');
    const payload = service().verifyAccessToken(token);
    expect(payload.userId).toBe('user-1');
    expect(typeof payload.iat).toBe('number');
  });

  it('篡改的 token 抛 UnauthorizedError', () => {
    expect(() => service().verifyAccessToken('bad.token.here')).toThrow(UnauthorizedError);
  });
});

describe('TokenService refresh token', () => {
  it('旋转：旧 token 换新 token，旧 token 再次使用判复用并吊销全部', async () => {
    const userId = await insertUser();
    const raw1 = await service().issueRefreshToken(userId);
    const rotated = await service().rotateRefreshToken(raw1);
    expect(rotated.userId).toBe(userId);
    expect(rotated.refreshToken).not.toBe(raw1);

    // 旧 token 重放 → REFRESH_TOKEN_REUSED，且该用户所有 refresh token 被吊销
    await expect(service().rotateRefreshToken(raw1)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
    // 连带吊销后，新 token 同样命中「已吊销」分支
    await expect(service().rotateRefreshToken(rotated.refreshToken)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('未知 token 抛 INVALID_REFRESH_TOKEN', async () => {
    await expect(service().rotateRefreshToken('nope')).rejects.toMatchObject({
      message: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('过期 token 抛 REFRESH_TOKEN_EXPIRED', async () => {
    const userId = await insertUser();
    const raw = await service().issueRefreshToken(userId);
    // 直接把过期时间改到过去
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');
    const { eq } = await import('drizzle-orm');
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hash));
    await expect(service().rotateRefreshToken(raw)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_EXPIRED',
    });
  });

  it('revokeRefreshToken 幂等；revokeAllForUser 吊销全部', async () => {
    const userId = await insertUser();
    const raw = await service().issueRefreshToken(userId);
    await service().revokeRefreshToken(raw);
    await service().revokeRefreshToken(raw); // 不抛
    await expect(service().rotateRefreshToken(raw)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`Cannot find module '../../src/auth/password.js'`）

- [ ] **Step 3: 实现**

`apps/server/src/auth/password.ts`：
```ts
import bcrypt from 'bcrypt';

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

`apps/server/src/auth/token.service.ts`：
```ts
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { refreshTokens } from '../db/schema.js';

const ACCESS_TYPE = 'access';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Service()
export class TokenService {
  signAccessToken(userId: string): string {
    return jwt.sign({ sub: userId, type: ACCESS_TYPE }, config.JWT_SECRET, {
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  verifyAccessToken(token: string): { userId: string; iat: number } {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
      if (payload.type !== ACCESS_TYPE || typeof payload.sub !== 'string' || !payload.iat) {
        throw new Error('bad payload');
      }
      return { userId: payload.sub, iat: payload.iat };
    } catch {
      throw new UnauthorizedError('INVALID_TOKEN');
    }
  }

  /** 返回原始 refresh token（只给客户端这一次，库里只存 sha256）。 */
  async issueRefreshToken(userId: string, deviceInfo?: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await db.insert(refreshTokens).values({
      userId,
      tokenHash: sha256(raw),
      deviceInfo: deviceInfo ?? null,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    return raw;
  }

  /**
   * 旋转 refresh token：旧 token 立即吊销并签发新 token。
   * 已吊销 token 被重放 = 泄露信号 → 吊销该用户全部 refresh token。
   */
  async rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string }> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)))
      .limit(1);

    if (!row) throw new UnauthorizedError('INVALID_REFRESH_TOKEN');
    if (row.revokedAt) {
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedError('REFRESH_TOKEN_REUSED');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('REFRESH_TOKEN_EXPIRED');
    }

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const refreshToken = await this.issueRefreshToken(row.userId, row.deviceInfo ?? undefined);
    return { userId: row.userId, refreshToken };
  }

  /** 幂等：未知 token 直接返回。 */
  async revokeRefreshToken(raw: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, sha256(raw)), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: password 3 个 + token 6 个 PASS（health 保持 PASS）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): bcrypt 密码服务与双 token 服务（旋转+复用检测）"
```

---

### Task 6: auth service + controller + 鉴权装配（TDD，端到端流程）

**Files:**
- Test: `apps/server/tests/auth/auth.flow.test.ts`
- Create: `apps/server/src/auth/auth.service.ts`、`apps/server/src/auth/auth.controller.ts`、`apps/server/src/auth/authorization.ts`
- Modify: `apps/server/src/app.ts`（注册 AuthController + authorizationChecker/currentUserChecker）

**Interfaces:**
- Consumes: Task 2 的 dto、Task 5 的 `TokenService`/`hashPassword`/`verifyPassword`。
- Produces:
  - `class AuthService`：`register(input: RegisterInput): Promise<AuthResponse>`、`login(input: LoginInput): Promise<AuthResponse>`、`refresh(raw: string): Promise<AuthResponse>`、`logout(raw: string): Promise<void>`、`getUserEntity(userId: string): Promise<User>`、`toProfile(user: User): UserProfile`
  - `authorizationChecker(action, roles): Promise<boolean>`（校验 Bearer access token + `passwordChangedAt` 不晚于 `iat`，把 `UserProfile` 挂到 `request.user`）
  - `currentUserChecker(action): Promise<UserProfile | null>`
  - HTTP：`POST /api/auth/register|login|refresh|logout`、`GET /api/auth/me`（`@Authorized()`）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/auth/auth.flow.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

const alice = { email: 'Alice@Example.com', password: 'secret123', nickname: 'Alice' };

beforeEach(resetDb);
afterAll(closeDb);

describe('auth 全流程', () => {
  it('register → me → refresh → logout', async () => {
    // 注册：email 归一化为小写
    const reg = await request(app).post('/api/auth/register').send(alice);
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('alice@example.com');
    expect(reg.body.user.nickname).toBe('Alice');
    expect(reg.body.tokens.accessToken).toBeTruthy();
    expect(reg.body.tokens.refreshToken).toBeTruthy();
    expect(reg.body.tokens.expiresIn).toBe(900);
    // 响应不泄露敏感字段
    expect(reg.body.user.passwordHash).toBeUndefined();

    // me：带 access token
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('alice@example.com');

    // refresh：换新对，旧 refresh 不可复用
    const ref = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.tokens.refreshToken });
    expect(ref.status).toBe(200);
    expect(ref.body.tokens.refreshToken).not.toBe(reg.body.tokens.refreshToken);

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.body.tokens.refreshToken });
    expect(reuse.status).toBe(401);

    // logout：吊销新 refresh
    const out = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: ref.body.tokens.refreshToken });
    expect(out.status).toBe(204);
    const afterLogout = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: ref.body.tokens.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  it('重复注册同 email（大小写不同）返回 409', async () => {
    await request(app).post('/api/auth/register').send(alice);
    const dup = await request(app)
      .post('/api/auth/register')
      .send({ ...alice, email: 'ALICE@example.com' });
    expect(dup.status).toBe(409);
  });

  it('login：密码错误 401；成功后可用 token 访问 me', async () => {
    await request(app).post('/api/auth/register').send(alice);

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'wrong-pass' });
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: alice.password });
    expect(ok.status).toBe(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ok.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('校验失败 400 统一错误结构；无 token 访问 me 返回 401', async () => {
    const invalid = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad', password: 'short', nickname: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test`
Expected: FAIL（`/api/auth/register` 404）

- [ ] **Step 3: 实现**

`apps/server/src/auth/auth.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { HttpError, NotFoundError, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

@Service()
export class AuthService {
  constructor(private tokens: TokenService) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED');

    const user: User = {
      id: randomUUID(),
      email: input.email,
      passwordHash: await hashPassword(input.password),
      nickname: input.nickname,
      passwordChangedAt: null,
      createdAt: new Date(),
    };
    await db.insert(users).values(user);
    return this.buildAuthResponse(user);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedError('INVALID_CREDENTIALS');
    }
    return this.buildAuthResponse(user);
  }

  async refresh(raw: string): Promise<AuthResponse> {
    const { userId, refreshToken } = await this.tokens.rotateRefreshToken(raw);
    const user = await this.getUserEntity(userId);
    return {
      user: this.toProfile(user),
      tokens: {
        accessToken: this.tokens.signAccessToken(user.id),
        refreshToken,
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  async logout(raw: string): Promise<void> {
    await this.tokens.revokeRefreshToken(raw);
  }

  async getUserEntity(userId: string): Promise<User> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError('USER_NOT_FOUND');
    return user;
  }

  toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    return {
      user: this.toProfile(user),
      tokens: {
        accessToken: this.tokens.signAccessToken(user.id),
        refreshToken: await this.tokens.issueRefreshToken(user.id),
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }
}
```

`apps/server/src/auth/authorization.ts`：
```ts
import type { UserProfile } from '@moment/dto';
import type { Action } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * routing-controllers 鉴权钩子：校验 Bearer access token，
 * 并拒绝签发时间早于 passwordChangedAt 的旧 token（改密即全端下线）。
 */
export async function authorizationChecker(action: Action, _roles: string[]): Promise<boolean> {
  const header: string | undefined = action.request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const { userId, iat } = Container.get(TokenService).verifyAccessToken(header.slice(7));
    const auth = Container.get(AuthService);
    const user = await auth.getUserEntity(userId);
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000) return false;
    (action.request as unknown as { user: UserProfile }).user = auth.toProfile(user);
    return true;
  } catch {
    return false;
  }
}

export async function currentUserChecker(action: Action): Promise<UserProfile | null> {
  return (action.request as unknown as { user?: UserProfile }).user ?? null;
}
```

`apps/server/src/auth/auth.controller.ts`：
```ts
import {
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  type AuthResponse,
  type UserProfile,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { AuthService } from './auth.service.js';

@JsonController('/auth')
@Service()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('/register')
  @HttpCode(201)
  register(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.register(registerInputSchema.parse(body));
  }

  @Post('/login')
  login(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.login(loginInputSchema.parse(body));
  }

  @Post('/refresh')
  refresh(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.refresh(refreshInputSchema.parse(body).refreshToken);
  }

  @Post('/logout')
  @HttpCode(204)
  @OnUndefined(204)
  logout(@Body() body: unknown): Promise<void> {
    return this.auth.logout(refreshInputSchema.parse(body).refreshToken);
  }

  @Get('/me')
  @Authorized()
  me(@CurrentUser() user: UserProfile): UserProfile {
    return user;
  }
}
```

`apps/server/src/app.ts`（整体替换）：
```ts
import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker } from './auth/authorization.js';
import { HealthController } from './controllers/health.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
    authorizationChecker,
    currentUserChecker,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）——Task 3 已引入，替换时必须保留
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: 全部 PASS（health 2 + password 3 + token 6 + flow 4）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): auth 注册/登录/刷新/登出/me 端到端流程"
```

---

### Task 7: 限流 + docker-compose + 环境模板 + README + 全量验证

**Files:**
- Create: `apps/server/src/middlewares/rate-limit.ts`
- Modify: `apps/server/src/app.ts`（挂限流）
- Test: `apps/server/tests/rate-limit.test.ts`
- Create: `docker-compose.yml`、`apps/server/.env.example`、根 `README.md`

**Interfaces:**
- Produces: `authRateLimiter`（注册用，IP 维度，60s/10 次）与 `loginRateLimiter`（登录用，IP+email 双维度，60s/5 次；test 环境均放宽到 1000 次）；本地依赖一键 `docker compose up -d mysql`。

- [ ] **Step 1: 写失败测试**

`apps/server/tests/rate-limit.test.ts`：
```ts
import rateLimit from 'express-rate-limit';
import express from 'express';
import request from 'supertest';

// 不依赖 NODE_ENV 的单元级验证：限流中间件本身在超限后返回 429。
describe('rate limit 行为', () => {
  it('超过 limit 后返回 429', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    app.get('/x', (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
  });
});
```

- [ ] **Step 2: 运行验证测试本身**

Run: `pnpm --filter @moment/server test -- rate-limit`
Expected: PASS（该用例直接验证第三方中间件行为，属「特性测试」；真正的接线验证在 Step 5 全量回归中体现——`authRateLimiter` 挂载后 test 环境 limit=1000 不影响既有用例）

- [ ] **Step 3: 实现限流并挂载**

`apps/server/src/middlewares/rate-limit.ts`：
```ts
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const isTest = config.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };

/** 注册等敏感端点：IP 维度，60s/10 次。测试环境放宽避免用例互踩。 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** 登录：IP + 账号双维度（spec §4/§6），60s/5 次，防分布式 IP 爆破同一账号。 */
export const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
  message,
});
```

`apps/server/src/app.ts` 中 `useExpressServer(...)` 之前插入（注意必须在 `express.json()` 之后，`loginRateLimiter` 的 keyGenerator 要读 `req.body`）：
```ts
  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/register', authRateLimiter);
```
并在文件顶部 import：
```ts
import { authRateLimiter, loginRateLimiter } from './middlewares/rate-limit.js';
```

- [ ] **Step 4: docker-compose 与环境模板**

`docker-compose.yml`（开发依赖；server 本体开发期跑在宿主机 `pnpm dev`，生产编排属阶段 8）：
```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: moment_root_dev
      MYSQL_DATABASE: moment_dev
      MYSQL_USER: moment
      MYSQL_PASSWORD: moment_dev
    ports:
      - '3306:3306'
    volumes:
      - moment-mysql:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-umoment', '-pmoment_dev']
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  moment-mysql: {}
```

`apps/server/.env.example`：
```dotenv
NODE_ENV=development
PORT=3000

# MySQL —— 本地开发用 docker compose 的 mysql；测试务必用独立测试库
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=moment
MYSQL_PASSWORD=moment_dev
MYSQL_DATABASE=moment_dev

# 32+ 字符随机串
JWT_SECRET=change-me-to-a-random-string-of-at-least-32-chars

ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
```

根 `README.md`（注意：本计划在 markdown 中用四反引号包裹以保留内层代码块；写入文件时去掉最外层围栏）：

````markdown
# 时刻 Moment

多用户时光链记录应用。Spec: docs/superpowers/specs/2026-08-15-moment-design.md

## 快速开始

```bash
pnpm install
# 若 apps/server/.env 已存在（含真实凭据）请跳过本步，切勿覆盖
[ -f apps/server/.env ] || cp apps/server/.env.example apps/server/.env
# 确保 .env 含 JWT_SECRET（≥32 字符），缺失则：
# echo "JWT_SECRET=$(openssl rand -base64 48)" >> apps/server/.env
pnpm build                                      # 先构建 dto 等依赖包
pnpm --filter @moment/server migrate            # 跑数据库迁移
pnpm dev                                        # 启动全部 dev 服务
```

## 数据库说明

- 当前团队的测试库是远程 MySQL（已配置在 `apps/server/.env`，测试/开发都用它）。
- `docker compose up -d mysql` 起的是**本地开发库**（`moment_dev`），供无远程库访问权时使用；
  使用时把 `.env` 的 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 改为 `.env.example` 中的本地值。

## 测试

```bash
pnpm --filter @moment/server test   # 打 .env 指向的库（必须是测试库，严禁生产库！）
```

- 测试配置隔离：可建 `apps/server/.env.test`（已 gitignore），优先级高于 `.env`。

## 结构

- apps/server — Express API（routing-controllers + TypeDI + Drizzle）
- packages/dto — 共享 zod schema 与类型
- config/ — 共享 tsconfig / eslint
````

- [ ] **Step 5: 全量验证**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、全部测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/server/.env.example apps/server/src/middlewares/rate-limit.ts apps/server/src/app.ts apps/server/tests/rate-limit.test.ts README.md
git commit -m "feat(server): auth 限流、docker-compose mysql、环境模板与 README"
```

---

## 完成标准（Phase 1 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿。
- 手动 curl 验证：`POST /api/auth/register` → `GET /api/auth/me` → `POST /api/auth/refresh` → `POST /api/auth/logout` 全流程通。
- `users`、`refresh_tokens` 表存在于测试库；refresh token 在库中仅存 sha256。
- .env（真实凭据）不在 git 中；`.env.example` 在。
