# Phase 3: 时刻与媒体（moments 三类型 + S3 预签名/multipart 上传 + outbox 基建）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec §3/§4/§5.3/§5.5/§5.6 的 moments 与 media 全链路：moments 三类型 CRUD + 链内时间线（`happened_at` 复合游标分页）、私有桶媒体上传管线（图片预签名 PUT / 视频 multipart + complete 校验 + 幂等）、`/api/media/:id` 302 预签名读取（TTL 整点对齐）、存储抽象层（沿用 aimo unified-storage-adapter 模式）、outbox 表与 `emitOutbox`（Phase 5 worker 的消费源）。

**Architecture:** 在 Phase 1（auth/骨架）与 Phase 2（chains/ChainPolicy/requireChainRole）之上新增三个模块：`src/storage`（adapter 接口 + S3 实现 + 可注入 factory）、`src/media`（presign/parts/complete/abort/302 读取）、`src/moments`（service/serializer/cursor/controller）。所有链权限走 Phase 2 的 `ChainPolicy` / `requireChainRole`（CONVENTIONS §3.1），controller 内不写手写角色判断。存储测试策略：单测/集成全 mock（`setStorageAdapter` 注入点），真实桶 smoke 仅 `RUN_S3_IT=1` 时跑（CONVENTIONS §3.3）。

**Tech Stack:** 既有栈 + `@aws-sdk/client-s3` ^3.700.0、`@aws-sdk/s3-request-presigner` ^3.700.0、`mime-types` ^2.1.35（`@types/mime-types`）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§3 media/moments/outbox 表、§4 Moments & Media API、§5.3 存储抽象与媒体读取、§5.5 上传管线、§5.6 时区与补发、§5.7 删除语义）

## Global Constraints（本计划新增）

- 存储接口方法名严格按 CONVENTIONS §3.3：`uploadFile / deleteFile / fileExists / headObject / copyObject / generateAccessUrl / presignPut / initMultipart / presignPart / completeMultipart / abortMultipart`，不得增删改名。
- `media.s3_key` 存**相对 key**（不含 `ATTACHMENT_S3_PREFIX`，adapter 内部拼接前缀）：上传期 `tmp/{mediaId}.{ext}`，发布时服务端 copy 到 `chains/{chainId}/{momentId}/{mediaId}.{ext}` 并删 tmp 对象。
- **偏离声明（CONVENTIONS §3.3 / spec §5.5 字面）**：tmp→final 的 copy 发生在 `POST /api/chains/:chainId/moments` 的 moment 创建事务内，**而非** CONVENTIONS §3.3 / spec §5.5 第 5 点所写的「complete 时 copy」——原因是 final key 需要 momentId，而 complete 时 moment 尚不存在；complete 仅做 HeadObject 校验与状态推进，不改 key。后果：`status='ready'` 且未绑定的 media 的 tmp 对象在 complete 后仍须保留至发布（或超时清理），Phase 8 sweeper **不得**按「complete 后即应搬走」的 spec 字面语义把它当垃圾清掉，只能按 24h 超时规则清理。
- **存储迁移限制**：`copyObject/deleteFile/generateAccessUrl` 均接受行上 `storage_meta`，读与 copy/delete 按行快照解析位置；因此换桶/换 prefix 前，所有未发布（tmp）对象必须先迁移或强制发布，否则发布事务会按新配置找源对象（NoSuchKey）。**进行中的上传会话（multipart/HeadObject 校验）不跨迁移**：`presignPut/initMultipart/presignPart/completeMultipart/abortMultipart/headObject` 均按**当前 config**（而非行快照）解析桶与前缀——若 presign 与 complete 之间换桶/换 prefix，complete 的 HeadObject/合片会按新配置找不到对象或会话（422/404）。取舍：换桶窗口期内进行中的上传允许失败，客户端重新 presign 即按新配置从头来；运维上换桶应选低峰并预告。
- **取舍声明（spec §1 media 类型语义）**：spec §1 字面为「media（图/视频宫格+文）」，本计划按字面实现**混排宫格**：`type=media` 允许 image/* 与 video/* 媒体混用（1–9 个，mime 以 dto 白名单为界），`type=video` 仍为恰好 1 条视频。不引入「宫格仅图片」的额外收紧；Task 7 的归属校验与此一致。
- **代价声明（发布事务内 S3 copy 的并发预算）**：tmp→final 的服务端 copy（视频可达 500MB，秒级）在 DB 事务内执行，期间占住一条 mysql2 池连接（`connectionLimit: 10`）与该批 media 行的 `for update` 行锁。最坏情况下 ≈10 路并发发布即可耗尽连接池——MVP 量级（链内低频发布）属可接受取舍，**显式声明**；若线上出现池耗尽，优先调大 `connectionLimit`，或后续把 copy 移到事务提交之后（失败则补偿性软删 moment 并返回 5xx），本计划不实现后者。
- `media.status` 状态机：`uploading → ready`（complete 成功）或 `uploading → orphaned`（abort / sweeper）；`ready` 终态不可回退。
- 媒体大小限制的**唯一常量来源**是 `@moment/dto`（`MAX_IMAGE_BYTES` / `MAX_VIDEO_BYTES` / `VIDEO_PART_SIZE`），server/web/app 一律引用，不得复制数字。
- 业务错误码（UPPER_SNAKE）：`MEDIA_TOO_LARGE`(413)、`MEDIA_MISMATCH`(422)、`MEDIA_INVALID_STATE`(409)、`MEDIA_INVALID`(400)、`MEDIA_NOT_FOUND`(404)、`SHARE_NOT_SUPPORTED`(403)、`MOMENT_NOT_FOUND`(404)、`MOMENT_DELETED`(410)、`NOT_MOMENT_AUTHOR`(403)、`INVALID_CURSOR`(400)、`INVALID_LIMIT`(400)。
- 预签名 GET 的整点对齐（spec §5.3）需**同时**对齐签名时刻与有效期，二者任一随当前时刻变化都会改变 URL 字符串：`signingDate = 当前小时窗起点`，`expiresIn = PRESIGN_GET_TTL_SECONDS + 3600`（常量）。这样同一小时窗内同一 media 签出的 URL 字符串**完全一致**（可缓存），且过期时刻落在下一窗内、距窗内任意时刻 ≥ TTL。302 响应带 `Cache-Control: private, max-age=300`。
- 视频 ≤5 分钟（spec §5.5）：presign 入参支持可选 `durationSeconds`（int，≤ `MAX_VIDEO_DURATION_SECONDS`=300），服务端只对上报值强制；未上报时不做服务端探测，时长上限由客户端压缩保证（Phase 6 引用共享常量）。
- moments 列表游标 = base64url(JSON)，`order=happened_at` 时 `{h: <epochMs>, i: <momentId>}`（CONVENTIONS §3.4，Phase 4 feed 复用本计划的 `src/moments/cursor.ts`）。
- `momentSerializer`（`src/moments/moment-serializer.ts`）是 moment → API 响应的**唯一出口**；media 只出稳定入口 `/api/media/:id` 相对路径，严禁内嵌预签名 URL。
- storage 单测/集成测试全部通过 `setStorageAdapter()` 注入 mock；真实桶 smoke 测试 `describe.skipIf(!process.env.RUN_S3_IT)`，默认跳过。
- 新环境变量（`ATTACHMENT_S3_*` / `PRESIGN_GET_TTL_SECONDS` / `PRESIGN_PUT_TTL_SECONDS`）同步 `src/config.ts`、`.env.example`，并保证 `apps/server/.env`（测试用）含占位值——config 在模块加载时强校验，缺失会炸掉全部测试。
- 对 Phase 2 已有代码的引用（`ChainPolicy`、`requireChainRole`、chains/chain_members/chain_invites 表、ChainsController）以 CONVENTIONS §3.1 与 spec §3 为准，本计划不改动其文件，只消费。

---

### Task 1: packages/dto — media.ts + moments.ts（TDD）

**Files:**
- Test: `packages/dto/src/media.test.ts`、`packages/dto/src/moments.test.ts`
- Create: `packages/dto/src/media.ts`、`packages/dto/src/moments.ts`
- Modify: `packages/dto/src/index.ts`（re-export）

**Interfaces:**
- Produces（本计划 Task 5/7/8 及 web/app 依赖，不得改名）:
  - `MAX_IMAGE_BYTES`（10MB）/ `MAX_VIDEO_BYTES`（500MB）/ `VIDEO_PART_SIZE`（8MB）/ `MAX_VIDEO_DURATION_SECONDS`（300，spec §5.5「视频 ≤5 分钟」，Phase 6 客户端共享引用）
  - `mediaPresignInputSchema` / `MediaPresignInput`（kind=image 时 mime 必须在 `IMAGE_MIME_TYPES` 白名单内，kind=video 时必须在 `VIDEO_MIME_TYPES` 白名单内——白名单而非前缀检查，拒绝 `image/svg+xml` 等 XSS 向量；可选 `durationSeconds` int ≤300，仅 kind=video 可携带）
  - `IMAGE_MIME_TYPES` / `VIDEO_MIME_TYPES`（mime 白名单常量，server 校验与 Phase 6 客户端共用）
  - `MediaPresignResponse = { mediaId: string; method: 'put'|'multipart'; url: string|null; uploadId: string|null; partSize: number|null }`
  - `mediaPartsInputSchema` / `MediaPartsInput`、`MediaPartUrl`、`MediaPartsResponse`
  - `mediaCompleteInputSchema` / `MediaCompleteInput`、`MediaCompleteResponse`
  - `createMomentInputSchema` / `CreateMomentInput`（superRefine：text→mediaIds 空且 content 非空；video→恰好 1 个；media→1–9 个）
  - `patchMomentInputSchema` / `PatchMomentInput`（仅 content/happenedAt/happenedTzOffset/isBackfill，全 optional）
  - `MomentMedia`、`AuthorSummary`、`MomentResponse`、`MomentListResponse`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/media.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaCompleteInputSchema,
  mediaPartsInputSchema,
  mediaPresignInputSchema,
} from './media.js';

test('媒体大小常量符合 spec §5.5', () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_VIDEO_BYTES, 500 * 1024 * 1024);
});

test('mediaPresignInputSchema：kind 与 mime 白名单必须匹配', () => {
  assert.ok(mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image' }).success);
  assert.ok(mediaPresignInputSchema.safeParse({ mime: 'video/webm', size: 1000, kind: 'video' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'application/pdf', size: 1000, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'video/x-ms-wmv', size: 1000, kind: 'video' }).success);
});

test('mediaPresignInputSchema：image/svg+xml 一律拒绝（存储型 XSS 防线）', () => {
  // SVG 可内嵌 <script>：若放行，预签名 GET 会以 image/svg+xml 原样下发，viewer 浏览器打开即执行任意 JS
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/svg+xml', size: 1000, kind: 'image' }).success);
});

test('mediaPresignInputSchema：size 必须正整数', () => {
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/png', size: 0, kind: 'image' }).success);
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'image/png', size: 1.5, kind: 'image' }).success);
});

test('mediaPresignInputSchema：durationSeconds 可选、≤300、仅 video 可携带（spec §5.5 ≤5 分钟）', () => {
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'video', durationSeconds: 300 }).success
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'video/mp4', size: 1000, kind: 'video', durationSeconds: 301 }).success
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image', durationSeconds: 60 }).success
  );
});

test('mediaPartsInputSchema：partNumbers 非空、1..10000、最多 200 个', () => {
  assert.ok(mediaPartsInputSchema.safeParse({ partNumbers: [1, 2, 3] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: [] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: [0] }).success);
  assert.ok(!mediaPartsInputSchema.safeParse({ partNumbers: Array.from({ length: 201 }, (_, i) => i + 1) }).success);
});

test('mediaCompleteInputSchema：parts 缺省为空数组（图片 PUT 复用同一 schema）', () => {
  assert.deepEqual(mediaCompleteInputSchema.parse({}), { parts: [] });
  const parsed = mediaCompleteInputSchema.parse({ parts: [{ partNumber: 1, etag: '"abc"' }] });
  assert.equal(parsed.parts[0]?.etag, '"abc"');
});
```

`packages/dto/src/moments.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMomentInputSchema, patchMomentInputSchema } from './moments.js';

const base = {
  type: 'text' as const,
  content: 'hello',
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

test('createMomentInputSchema：type=text 拒绝 mediaIds', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, mediaIds: ['m-1'] }).success);
});

test('createMomentInputSchema：type=text 拒绝空 content', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, content: '   ' }).success);
});

test('createMomentInputSchema：type=video 恰好 1 个 mediaId', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'video', content: '', mediaIds: [] }).success
  );
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'video',
      content: '',
      mediaIds: ['m-1', 'm-2'],
    }).success
  );
  assert.ok(
    createMomentInputSchema.safeParse({ ...base, type: 'video', content: '', mediaIds: ['m-1'] }).success
  );
});

test('createMomentInputSchema：type=media 1–9 个 mediaId', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: [] }).success
  );
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'media',
      content: '',
      mediaIds: Array.from({ length: 10 }, (_, i) => `m-${i}`),
    }).success
  );
  assert.ok(
    createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: ['m-1'] }).success
  );
});

test('createMomentInputSchema：mediaIds 含重复值 → 拒绝（MEDIA_COUNT_INVALID）', () => {
  const dup = {
    ...base,
    type: 'media' as const,
    content: '',
    mediaIds: ['m-1', 'm-1'],
  };
  const parsed = createMomentInputSchema.safeParse(dup);
  assert.ok(!parsed.success);
  // 重复穿透会导致发布事务对同一 tmp 对象 copy 两次（第二次 NoSuchKey），必须在 dto 层拦截
});

test('createMomentInputSchema：默认值 isBackfill=false、mediaIds=[]', () => {
  const parsed = createMomentInputSchema.parse(base);
  assert.equal(parsed.isBackfill, false);
  assert.deepEqual(parsed.mediaIds, []);
});

test('createMomentInputSchema：happenedAt 必须可解析、tzOffset 范围 ±14h（分钟）', () => {
  assert.ok(!createMomentInputSchema.safeParse({ ...base, happenedAt: 'not-a-date' }).success);
  assert.ok(!createMomentInputSchema.safeParse({ ...base, happenedTzOffset: 900 }).success);
});

test('patchMomentInputSchema：仅四个字段、全 optional、.strict() 拒绝未知键（mediaIds/type）；空对象拒绝', () => {
  assert.ok(patchMomentInputSchema.safeParse({ content: 'new' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success); // 空补丁 → EMPTY_PATCH
  assert.ok(!patchMomentInputSchema.safeParse({ mediaIds: ['m-1'] }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'text' }).success);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './media.js'` / `Cannot find module './moments.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/media.ts`：
```ts
import { z } from 'zod';

/** spec §5.5：图 ≤10MB；视频 ≤500MB。所有端共享的唯一常量来源。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** 视频 multipart 单 part 大小（spec §5.5：5–20MB，取 8MB）。 */
export const VIDEO_PART_SIZE = 8 * 1024 * 1024;
/** 视频时长上限（秒，spec §5.5「≤5 分钟」）。服务端只校验客户端上报的 durationSeconds。 */
export const MAX_VIDEO_DURATION_SECONDS = 300;

/**
 * mime 白名单（而非 `kind + '/*'` 前缀检查）：SVG 可内嵌 `<script>`，
 * 放行即构成存储型 XSS（预签名 GET 以原始 Content-Type 下发）——与 Task 2 `getContentType`
 * 的 octet-stream 兜底构成双防线。服务端/客户端共用，不得各自复制清单。
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export const mediaPresignInputSchema = z
  .object({
    mime: z.string().min(3).max(100),
    size: z.number().int().positive(),
    kind: z.enum(['image', 'video']),
    sortOrder: z.number().int().min(0).max(8).optional(),
    /** 客户端上报的视频时长（秒）；≤300。服务端不探测实际时长（偏离取舍见 Global Constraints）。 */
    durationSeconds: z.number().int().min(1).max(MAX_VIDEO_DURATION_SECONDS).optional(),
  })
  .superRefine((val, ctx) => {
    const allowed = val.kind === 'image' ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
    if (!(allowed as readonly string[]).includes(val.mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MIME_KIND_MISMATCH',
        path: ['mime'],
      });
    }
    if (val.kind === 'image' && val.durationSeconds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MEDIA_INVALID',
        path: ['durationSeconds'],
      });
    }
  });
export type MediaPresignInput = z.infer<typeof mediaPresignInputSchema>;

export interface MediaPresignResponse {
  mediaId: string;
  method: 'put' | 'multipart';
  /** method=put 时的预签名 PUT URL；multipart 时为 null（part URL 由 /media/:id/parts 获取） */
  url: string | null;
  /** method=multipart 时的 S3 uploadId；否则 null */
  uploadId: string | null;
  /** method=multipart 时每个 part 的字节数；否则 null */
  partSize: number | null;
}

export const mediaPartsInputSchema = z.object({
  partNumbers: z
    .array(z.number().int().min(1).max(10000))
    .min(1)
    .max(200),
});
export type MediaPartsInput = z.infer<typeof mediaPartsInputSchema>;

export interface MediaPartUrl {
  partNumber: number;
  url: string;
  /** 预签名有效期（秒） */
  expiresIn: number;
}

export interface MediaPartsResponse {
  mediaId: string;
  partSize: number;
  urls: MediaPartUrl[];
}

export const mediaCompleteInputSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(255),
      })
    )
    .max(10000)
    .default([]),
});
export type MediaCompleteInput = z.infer<typeof mediaCompleteInputSchema>;

export interface MediaCompleteResponse {
  mediaId: string;
  status: 'ready';
  mime: string;
  size: number;
}
```

`packages/dto/src/moments.ts`：
```ts
import { z } from 'zod';

export const momentTypeSchema = z.enum(['text', 'media', 'video']);
export type MomentType = z.infer<typeof momentTypeSchema>;

const isoTimestampSchema = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'INVALID_TIMESTAMP' });

export const createMomentInputSchema = z
  .object({
    type: momentTypeSchema,
    content: z.string().max(5000).default(''),
    happenedAt: isoTimestampSchema,
    /** 提交时时区偏移（分钟，东八区为 -480，语义同 JS getTimezoneOffset），供展示（spec §5.6） */
    happenedTzOffset: z.number().int().min(-840).max(840),
    isBackfill: z.boolean().default(false),
    mediaIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'text') {
      if (val.content.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CONTENT_REQUIRED', path: ['content'] });
      }
      if (val.mediaIds.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_NOT_ALLOWED', path: ['mediaIds'] });
      }
    }
    if (val.type === 'video' && val.mediaIds.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    if (val.type === 'media' && (val.mediaIds.length < 1 || val.mediaIds.length > 9)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    // 重复 id 会导致发布事务对同一 tmp 对象 copy 两次（第二次 NoSuchKey → 500），必须拒绝
    if (val.type !== 'text' && new Set(val.mediaIds).size !== val.mediaIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
  });
export type CreateMomentInput = z.infer<typeof createMomentInputSchema>;

export const patchMomentInputSchema = z
  .object({
    content: z.string().max(5000).optional(),
    happenedAt: isoTimestampSchema.optional(),
    happenedTzOffset: z.number().int().min(-840).max(840).optional(),
    isBackfill: z.boolean().optional(),
  })
  .strict() // 未知键（含 mediaIds/type）直接 VALIDATION_ERROR，而非静默剥离
  .refine((val) => Object.values(val).some((v) => v !== undefined), { message: 'EMPTY_PATCH' });
export type PatchMomentInput = z.infer<typeof patchMomentInputSchema>;

/** moment 响应中的媒体：只出稳定入口相对路径，不内嵌预签名 URL（CONVENTIONS §3.4） */
export interface MomentMedia {
  id: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
}

export interface AuthorSummary {
  id: string;
  nickname: string;
}

export interface MomentResponse {
  id: string;
  chainId: string;
  author: AuthorSummary;
  type: MomentType;
  content: string;
  happenedAt: string;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: string;
  media: MomentMedia[];
}

export interface MomentListResponse {
  items: MomentResponse[];
  nextCursor: string | null;
}
```

`packages/dto/src/index.ts`（整体替换）：
```ts
export * from './auth.js';
export * from './media.js';
export * from './moments.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: media 7 + moments 8 个测试 PASS（auth 原有 5 个保持 PASS）；`dist/` 重新生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): media 与 moments 领域 schema 及共享类型"
```

---

### Task 2: 存储抽象层（config 扩展 + base/s3/factory，TDD）

**Files:**
- Modify: `apps/server/src/config.ts`（扩展 ATTACHMENT_S3_* 与 PRESIGN_*）
- Modify: `apps/server/.env.example`、`apps/server/.env`（测试占位值）
- Modify: `apps/server/package.json`（新增依赖）
- Create: `apps/server/src/storage/base.adapter.ts`、`apps/server/src/storage/s3.adapter.ts`、`apps/server/src/storage/factory.ts`
- Test: `apps/server/tests/storage/factory.test.ts`

**Interfaces:**
- Consumes: `config`、`logger`（Phase 1）。
- Produces（Task 5/6/7/8 及 Phase 8 依赖，方法名严格按 CONVENTIONS §3.3）:
  - `StorageMetadata = { bucket?, prefix?, endpoint?, region?, isPublicBucket?: 'true'|'false' }`（沿用 aimo 语义，按 media 行记录写入时配置）
  - `UnifiedStorageAdapter`：`uploadFile(key, buffer)` / `deleteFile(key, metadata?)` / `fileExists(key)` / `headObject(key): Promise<{size, contentType, lastModified} | null>` / `copyObject(srcKey, destKey, metadata?)` / `generateAccessUrl(key, metadata, expiresIn?, signingDate?)` / `presignPut(key, meta: PutMeta, expiresIn)` / `initMultipart(key, meta: PutMeta): Promise<string>`（返回 uploadId）/ `presignPart(key, uploadId, partNumber, expiresIn)` / `completeMultipart(key, uploadId, parts: CompletedPart[])` / `abortMultipart(key, uploadId)`
  - `BaseUnifiedStorageAdapter`（抽象基类，含 `getContentType` 安全过滤）
  - `PutMeta = { contentType: string }`、`CompletedPart = { partNumber: number; etag: string }`
  - `getStorage(): UnifiedStorageAdapter`（单例）、`setStorageAdapter(adapter | null): void`（测试注入点）、`currentStorageMeta(): StorageMetadata`（按当前 config 生成 media 行的 storage_meta）
  - config 新增字段：`ATTACHMENT_S3_BUCKET/PREFIX/ENDPOINT?/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/IS_PUBLIC`、`PRESIGN_GET_TTL_SECONDS`(3600)、`PRESIGN_PUT_TTL_SECONDS`(900)

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @moment/server add @aws-sdk/client-s3@^3.700.0 @aws-sdk/s3-request-presigner@^3.700.0 mime-types@^2.1.35
pnpm --filter @moment/server add -D @types/mime-types@^2.1.4
```
Expected: `pnpm install` 成功无 peer 报错。

- [ ] **Step 2: 扩展 config（先于测试，因模块加载期强校验）**

`apps/server/src/config.ts`：**不整体替换**。Phase 2 已在 `envSchema` 的 `REFRESH_TOKEN_TTL_DAYS` 行之后追加了 `INVITE_TTL_DAYS: z.coerce.number().default(7)`（`ChainService.createInvite` 消费）；整体替换会删掉它，导致 `config.INVITE_TTL_DAYS` 类型不存在、ts-jest 编译失败。正确做法：在既有 `envSchema`（含 Phase 2 的 `INVITE_TTL_DAYS`）的 `INVITE_TTL_DAYS` 行之后**插入**下列字段（`import`/`loadEnv`/`parse`/`export` 等其余内容一律保持现状；Phase 2 及之后新增的全部字段必须保留，仅追加不改）：
```ts
// —— envSchema 内插入（INVITE_TTL_DAYS 行之后）——
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
    .transform((v) => v === 'true'),
  // GET TTL 上限 3600：alignedGetPresign 的「过期时刻落在下一窗内」推导要求 TTL ≤ 一个窗长（3600s）
  PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(3600),
  PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
```

`apps/server/.env.example` 在末尾追加：
```dotenv

# S3 兼容对象存储（私有桶，spec §5.3）
ATTACHMENT_S3_BUCKET=change-me-bucket
ATTACHMENT_S3_PREFIX=dev/attachments
# 自建 endpoint 留空则走 AWS 默认；非阿里云 endpoint 用 path-style
ATTACHMENT_S3_ENDPOINT=
ATTACHMENT_S3_REGION=cn-beijing
ATTACHMENT_S3_ACCESS_KEY_ID=change-me
ATTACHMENT_S3_SECRET_ACCESS_KEY=change-me
ATTACHMENT_S3_IS_PUBLIC=false

# 预签名有效期（GET 按整点时间窗对齐）
PRESIGN_GET_TTL_SECONDS=3600
PRESIGN_PUT_TTL_SECONDS=900
```

`apps/server/.env`（测试/开发库，已 gitignore）追加占位值——config 在模块加载期强校验，缺失会炸掉全部测试；单测不触网（storage 全 mock），真实桶校验只在 `RUN_S3_IT=1` smoke 中发生：
```bash
grep -q '^ATTACHMENT_S3_BUCKET=' apps/server/.env || cat >> apps/server/.env <<'EOF'
ATTACHMENT_S3_BUCKET=moment-test-placeholder
ATTACHMENT_S3_PREFIX=test/attachments
ATTACHMENT_S3_REGION=us-east-1
ATTACHMENT_S3_ACCESS_KEY_ID=test-placeholder-key
ATTACHMENT_S3_SECRET_ACCESS_KEY=test-placeholder-secret
ATTACHMENT_S3_IS_PUBLIC=false
PRESIGN_GET_TTL_SECONDS=3600
PRESIGN_PUT_TTL_SECONDS=900
EOF
```
Expected: `apps/server/.env` 含上述行；`pnpm --filter @moment/server test`（health）仍 PASS。

- [ ] **Step 3: 写失败测试**

`apps/server/tests/storage/factory.test.ts`：
```ts
import type { UnifiedStorageAdapter } from '../../src/storage/base.adapter.js';
import { getStorage, setStorageAdapter } from '../../src/storage/factory.js';
import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';

function fakeAdapter(): UnifiedStorageAdapter {
  return {
    uploadFile: async () => undefined,
    deleteFile: async () => undefined,
    fileExists: async () => false,
    headObject: async () => null,
    copyObject: async () => undefined,
    generateAccessUrl: async () => 'https://fake/presigned',
    presignPut: async () => 'https://fake/put',
    initMultipart: async () => 'upload-1',
    presignPart: async () => 'https://fake/part',
    completeMultipart: async () => undefined,
    abortMultipart: async () => undefined,
  };
}

afterEach(() => setStorageAdapter(null));

describe('storage factory', () => {
  it('默认按 config 创建 S3 adapter 单例', () => {
    const a = getStorage();
    const b = getStorage();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(S3UnifiedStorageAdapter);
  });

  it('setStorageAdapter 注入 mock 后 getStorage 返回 mock；置 null 恢复单例', () => {
    const mock = fakeAdapter();
    setStorageAdapter(mock);
    expect(getStorage()).toBe(mock);
    setStorageAdapter(null);
    expect(getStorage()).not.toBe(mock);
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm --filter @moment/server test -- factory`
Expected: FAIL（`Cannot find module '../../src/storage/factory.js'`）

- [ ] **Step 5: 实现 base.adapter.ts**

`apps/server/src/storage/base.adapter.ts`：
```ts
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
```

- [ ] **Step 6: 实现 s3.adapter.ts**

`apps/server/src/storage/s3.adapter.ts`：
```ts
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
    this.client = new S3Client(clientConfig as ConstructorParameters<typeof S3Client>[0]);
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
```

- [ ] **Step 7: 实现 factory.ts**

`apps/server/src/storage/factory.ts`：
```ts
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
```

- [ ] **Step 8: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: factory 2 个测试 PASS；health/auth 全部保持 PASS。

- [ ] **Step 9: Commit**

```bash
git add apps/server/package.json apps/server/src/config.ts apps/server/src/storage apps/server/.env.example pnpm-lock.yaml
git commit -m "feat(server): 统一存储抽象层（S3 适配器 + multipart + 可注入 factory）"
```

---

### Task 3: media / moments / outbox 表 + 迁移 + resetDb 扩展

**Files:**
- Create: `apps/server/src/db/schema/media.ts`、`apps/server/src/db/schema/moments.ts`、`apps/server/src/db/schema/outbox.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 追加）
- Modify: `apps/server/src/db/schema/users.ts`（补 `avatarMediaId` 列 + FK——Phase 1 Task 4 注释「随媒体阶段迁移补列」，本计划兑现）
- Modify: `apps/server/src/db/schema/chains.ts`（`coverMediaId` 补 FK——Phase 2 Global Constraints「Phase 3 建 media 表时迁移补 FK」，本计划兑现）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 按外键逆序扩展）
- Create: `apps/server/drizzle/000X_*.sql`（`drizzle-kit generate` 产物）

**Interfaces:**
- Consumes: Phase 2 的 `chains`（`chains` 表对象，列含 id/name/description/coverMediaId/ownerId/visibility/createdAt）、`chainMembers`。
- Produces（Task 4–8 及 Phase 4/5/8 依赖）:
  - `media` 表对象（列：`id/momentId/uploaderId/s3Key/mime/size/width/height/duration/posterMediaId/sortOrder/status/storageMeta/uploadId/createdAt`）；`Media`（$inferSelect）/ `NewMedia`（$inferInsert）
  - `moments` 表对象（列：`id/chainId/authorId/type/content/happenedAt/happenedTzOffset/isBackfill/createdAt/updatedAt/deletedAt`）；`Moment` / `NewMoment`；索引 `(chain_id, happened_at, id)`
  - `outbox` 表对象（列：`id/type/payload/status/attempts/nextRetryAt/createdAt/processedAt`）；索引 `(status, next_retry_at)`
  - `users.avatarMediaId`（nullable，FK → media.id，`ON DELETE SET NULL`）；`chains.coverMediaId` 补 FK → media.id（`ON DELETE SET NULL`）——兑现 Phase 1/Phase 2 留给 Phase 3 的两项迁移承诺（仅 schema 层，头像/封面的业务 API 不在本计划范围）
  - 扩展后的 `resetDb()`（Phase 3 表按外键逆序 delete）

- [ ] **Step 1: 写表定义**

`apps/server/src/db/schema/moments.ts`：
```ts
import { index, mysqlEnum, mysqlTable, char, int, text, timestamp, boolean } from 'drizzle-orm/mysql-core';
import { chains } from './chains.js';
import { users } from './users.js';

export const moments = mysqlTable(
  'moments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    chainId: char('chain_id', { length: 36 })
      .notNull()
      .references(() => chains.id),
    authorId: char('author_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    type: mysqlEnum('type', ['text', 'media', 'video']).notNull(),
    content: text('content').notNull(),
    /** 事件发生时间（UTC 存储的时间点，spec §5.6）。fsp=3 保留毫秒：MySQL timestamp 默认 fsp=0 会截断毫秒，
        导致 create 响应（内存 Date 含 ms）与落库后读回不一致 */
    happenedAt: timestamp('happened_at', { mode: 'date', fsp: 3 }).notNull(),
    /** 提交时时区偏移（分钟，供展示），如东八区 = -480 */
    happenedTzOffset: int('happened_tz_offset').notNull(),
    isBackfill: boolean('is_backfill').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow().onUpdateNow(),
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [index('idx_moments_chain_happened').on(t.chainId, t.happenedAt, t.id)]
);

export type Moment = typeof moments.$inferSelect;
export type NewMoment = typeof moments.$inferInsert;
```

`apps/server/src/db/schema/media.ts`：
```ts
import { bigint, char, index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import type { StorageMetadata } from '../../storage/base.adapter.js';
import { moments } from './moments.js';
import { users } from './users.js';

export const media = mysqlTable(
  'media',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 上传完成绑定前为空（spec §3 media.moment_id 可空） */
    momentId: char('moment_id', { length: 36 }).references(() => moments.id),
    uploaderId: char('uploader_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** 相对 key（不含 prefix）：tmp/{mediaId}.{ext} → chains/{chainId}/{momentId}/{mediaId}.{ext} */
    s3Key: varchar('s3_key', { length: 512 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: int('width'),
    height: int('height'),
    /** 视频时长（秒），客户端元数据可后补，本阶段允许 null */
    duration: int('duration'),
    /** 视频封面（预留，服务端抽帧二期），不做 FK 以避免自引用循环 */
    posterMediaId: char('poster_media_id', { length: 36 }),
    sortOrder: int('sort_order').notNull().default(0),
    status: mysqlEnum('status', ['uploading', 'ready', 'orphaned']).notNull(),
    /** 写入时存储配置快照（按行签名，spec §5.3） */
    storageMeta: json('storage_meta').$type<StorageMetadata>().notNull(),
    /** S3 multipart uploadId；图片单 PUT 为 null */
    uploadId: varchar('upload_id', { length: 128 }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_media_moment').on(t.momentId),
    index('idx_media_uploader').on(t.uploaderId),
  ]
);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
```

`apps/server/src/db/schema/outbox.ts`：
```ts
import { char, index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const outbox = mysqlTable(
  'outbox',
  {
    id: char('id', { length: 36 }).primaryKey(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: json('payload').notNull(),
    status: mysqlEnum('status', ['pending', 'done', 'failed']).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { mode: 'date' }),
  },
  (t) => [index('idx_outbox_status_next_retry').on(t.status, t.nextRetryAt)]
);

export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;
```

`apps/server/src/db/schema.ts`（整体替换；`chains.js` 一行是 Phase 2 已有内容，保持不动）：
```ts
export * from './schema/users.js';
export * from './schema/refresh-tokens.js';
export * from './schema/chains.js';
export * from './schema/chain-members.js';
export * from './schema/chain-invites.js';
export * from './schema/moments.js';
export * from './schema/media.js';
export * from './schema/outbox.js';
```
（若 Phase 2 的 barrel 文件名与上述不同，以 Phase 2 实际文件为准，仅在末尾追加后三行。）

`apps/server/src/db/schema/users.ts` 追加列（import 区补充 `import { media } from './media.js';`）：
```ts
// —— 在既有列之后追加 ——
/** 头像媒体：Phase 1 Task 4 注释「随媒体阶段迁移补列（media 表）」，本计划兑现。
 *  与 media.ts 存在 ESM 循环引用（media.uploader_id → users），安全：references 回调惰性求值，
 *  模块求值期不触达对方绑定。业务 API（上传/绑定头像）不在本计划范围。 */
avatarMediaId: char('avatar_media_id', { length: 36 }).references(() => media.id, { onDelete: 'set null' }),
```

`apps/server/src/db/schema/chains.ts` 修改既有列（import 区补充 `import { media } from './media.js';`）：
```ts
// —— 将 Phase 2 的 `coverMediaId: char('cover_media_id', { length: 36 })` 改为 ——
/** Phase 2 Global Constraints 注释「media 表属 Phase 3，本阶段不加外键，Phase 3 迁移时补 FK」，本计划兑现。
 *  与 media → moments → chains 构成 ESM 循环引用，安全同上（references 回调惰性求值）。 */
coverMediaId: char('cover_media_id', { length: 36 }).references(() => media.id, { onDelete: 'set null' }),
```

- [ ] **Step 2: 生成迁移并跑通**

Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成新 `drizzle/000X_*.sql`（含 `media`、`moments`、`outbox` 三表与索引，**以及**对既有 `users` 的 `ADD COLUMN avatar_media_id` + FK、`chains` 的 `cover_media_id` FK 两条 ALTER——users/chains 已存在于迁移历史，drizzle-kit 以 ALTER 语句而非内联 CREATE 输出，循环 FK 不产生建表顺序问题）；输出 `migrations applied`；测试库出现三张表且 `users.avatar_media_id` 列、两处 FK 就位。

- [ ] **Step 3: 扩展 resetDb**

`apps/server/tests/helpers/db.ts`（整体替换；新增三行按外键逆序放在最前——media 依赖 moments，moments 依赖 chains）：
```ts
import { db, pool } from '../../src/db/index.js';
import {
  chainInvites,
  chainMembers,
  chains,
  media,
  moments,
  outbox,
  refreshTokens,
  users,
} from '../../src/db/schema.js';

/** 每个用例前清表：先子表后父表（外键逆序）。仅允许对测试库使用。 */
export async function resetDb(): Promise<void> {
  await db.delete(outbox);
  await db.delete(media);
  await db.delete(moments);
  await db.delete(chainInvites);
  await db.delete(chainMembers);
  await db.delete(chains);
  await db.delete(refreshTokens);
  await db.delete(users);
}

/** 测试文件收尾关闭连接池（不关闭 jest 进程会因 open handle 挂住不退出）。 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
```
（`chainInvites`/`chainMembers`/`chains` 的 import 与 delete 行是 Phase 2 已有内容；若 Phase 2 的 resetDb 还包含其它表，保留其原有顺序，本 Task 只在最前面按 `outbox → media → moments` 追加。）

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有测试全部 PASS（新表不影响既有用例；globalSetup 会把新迁移应用到测试库）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db apps/server/drizzle apps/server/tests/helpers/db.ts
git commit -m "feat(server): media/moments/outbox 表与迁移"
```

---

### Task 4: outbox 类型常量 + emitOutbox（TDD，触库）

**Files:**
- Create: `apps/server/src/outbox/types.ts`、`apps/server/src/outbox/outbox.ts`
- Test: `apps/server/tests/outbox/outbox.test.ts`

**Interfaces（严格按 CONVENTIONS §3.2，Phase 5 worker 消费）:**
- Produces:
  - `type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]`
  - `emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>`（业务事务内调用，同事务落 `status='pending'` 行）
  - `OutboxType`（当前为 `'moment.created' | 'moment.deleted'`，后续 Phase 扩展联合类型）
  - 常量 `OUTBOX_MOMENT_CREATED = 'moment.created'`、`OUTBOX_MOMENT_DELETED = 'moment.deleted'`

- [ ] **Step 1: 写失败测试**

`apps/server/tests/outbox/outbox.test.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import {
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_DELETED,
  emitOutbox,
} from '../../src/outbox/outbox.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('emitOutbox', () => {
  it('在事务内落 pending 行，payload 原样 JSON', async () => {
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_CREATED, {
        momentId: 'm-1',
        chainId: 'c-1',
        authorId: 'u-1',
        isBackfill: false,
      });
    });
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'moment.created',
      status: 'pending',
      attempts: 0,
    });
    expect(rows[0].payload).toEqual({
      momentId: 'm-1',
      chainId: 'c-1',
      authorId: 'u-1',
      isBackfill: false,
    });
  });

  it('业务事务回滚时 outbox 行随之消失（同事务原子性）', async () => {
    await expect(
      db.transaction(async (tx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_DELETED, { momentId: 'm-2', chainId: 'c-1' });
        throw new Error('business failure');
      })
    ).rejects.toThrow('business failure');
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(0);
  });

  it('type 常量与联合类型一致（编译期由 OutboxType 保证）', async () => {
    expect(OUTBOX_MOMENT_CREATED).toBe('moment.created');
    expect(OUTBOX_MOMENT_DELETED).toBe('moment.deleted');
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_DELETED, { momentId: 'm-3', chainId: 'c-1' });
    });
    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.deleted'));
    expect(row?.payload).toEqual({ momentId: 'm-3', chainId: 'c-1' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- outbox`
Expected: FAIL（`Cannot find module '../../src/outbox/outbox.js'`）

- [ ] **Step 3: 实现**

`apps/server/src/outbox/types.ts`：
```ts
/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加 'comment.created' 等 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED;
```

`apps/server/src/outbox/outbox.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { outbox } from '../db/schema.js';
import type { OutboxType } from './types.js';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 在业务事务内调用：同事务写一条 outbox 行（status='pending'）。
 * 事务回滚时本行随之消失，保证「业务写 + 异步副作用意图」原子（spec §5.4）。
 */
export async function emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void> {
  await tx.insert(outbox).values({
    id: randomUUID(),
    type,
    payload,
    status: 'pending',
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- outbox`
Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/outbox apps/server/tests/outbox
git commit -m "feat(server): outbox 基建（emitOutbox + 事件类型常量）"
```

---

### Task 5: 媒体上传管线 service + controller（presign / parts / complete / abort，TDD 集成）

**Files:**
- Create: `apps/server/src/media/media.service.ts`、`apps/server/src/media/media.controller.ts`
- Modify: `apps/server/src/app.ts`（注册 MediaController）
- Create: `apps/server/tests/helpers/auth.ts`、`apps/server/tests/helpers/chain.ts`、`apps/server/tests/helpers/storage.ts`
- Test: `apps/server/tests/media/media.flow.test.ts`

**Interfaces:**
- Consumes: Task 1 dto、Task 2 `getStorage/setStorageAdapter/currentStorageMeta`、Task 3 `media` 表、Phase 1 auth/`resetDb`、Phase 2 `chains/chainMembers` 表（仅测试 fixture 直插）。
- Produces（Task 6/7 依赖，Phase 6 app 端按 HTTP 契约消费）:
  - `class MediaService`：`presign(userId, input)` / `presignParts(userId, mediaId, input)` / `complete(userId, mediaId, input)` / `abort(userId, mediaId)`（Task 6 追加 `resolveAccessUrl`）
  - HTTP：`POST /api/media/presign`（@Authorized）、`POST /api/media/:id/parts`、`POST /api/media/:id/complete`、`POST /api/media/:id/abort`
  - 测试 helpers：`createUser(app, name)`、`createChainWithMembers(ownerId, members)`、`installMockStorage()`

- [ ] **Step 1: 测试 helpers（无独立测试，被后续所有集成测试消费）**

`apps/server/tests/helpers/auth.ts`：
```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

export interface TestUser {
  id: string;
  token: string;
  email: string;
}

/** 走真实注册接口造用户，返回 userId + access token（依赖 Phase 1 的 AuthResponse 契约：`res.body.user.id` / `res.body.tokens.accessToken`）。 */
export async function createUser(app: Express, name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: name });
  if (res.status !== 201) {
    throw new Error(`createUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.user.id, token: res.body.tokens.accessToken, email };
}
```

`apps/server/tests/helpers/chain.ts`（直插 Phase 2 的表，避免耦合 Phase 2 controller 形状）：
```ts
import { randomUUID } from 'node:crypto';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';

export type MemberRole = 'owner' | 'editor' | 'viewer';

/** 直插 chains + chain_members（owner 隐含为 owner 成员），返回 chainId。 */
export async function createChainWithMembers(
  ownerId: string,
  members: { userId: string; role: Exclude<MemberRole, 'owner'> }[] = []
): Promise<string> {
  const chainId = randomUUID();
  await db.insert(chains).values({
    id: chainId,
    name: `chain-${chainId.slice(0, 8)}`,
    description: null,
    coverMediaId: null,
    ownerId,
    visibility: 'private',
  });
  await db.insert(chainMembers).values([
    { chainId, userId: ownerId, role: 'owner', joinedAt: new Date() },
    ...members.map((m) => ({ chainId, userId: m.userId, role: m.role, joinedAt: new Date() })),
  ]);
  return chainId;
}
```

`apps/server/tests/helpers/storage.ts`：
```ts
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
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/media/media.flow.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
import { createUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function presignImage(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'image/jpeg', size: 1024, kind: 'image', ...over });
}

async function presignVideo(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'video/mp4', size: 64 * 1024 * 1024, kind: 'video', ...over });
}

describe('POST /api/media/presign', () => {
  it('未登录 401', async () => {
    expect((await request(app).post('/api/media/presign').send({})).status).toBe(401);
  });

  it('图片：插 uploading 行 + tmp key，返回预签名 PUT', async () => {
    const res = await presignImage(alice.token, { sortOrder: 2 });
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('put');
    expect(res.body.url).toBe('https://fake.local/presigned-put');
    expect(res.body.uploadId).toBeNull();
    expect(res.body.partSize).toBeNull();

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row).toMatchObject({
      uploaderId: alice.id,
      mime: 'image/jpeg',
      size: 1024,
      status: 'uploading',
      sortOrder: 2,
      uploadId: null,
    });
    expect(row.s3Key).toBe(`tmp/${res.body.mediaId}.jpeg`); // mime-types: image/jpeg → .jpeg
    expect(storage.presignPut).toHaveBeenCalledWith(row.s3Key, { contentType: 'image/jpeg' }, 900);
  });

  it('图片超 10MB → 413 MEDIA_TOO_LARGE，且不插行', async () => {
    const res = await presignImage(alice.token, { size: MAX_IMAGE_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('视频超 500MB → 413', async () => {
    const res = await presignVideo(alice.token, { size: MAX_VIDEO_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
  });

  it('kind 与 mime 不一致 → 400 VALIDATION_ERROR', async () => {
    const res = await presignImage(alice.token, { mime: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('视频：init multipart，返回 uploadId/partSize，upload_id 落库', async () => {
    const res = await presignVideo(alice.token);
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('multipart');
    expect(res.body.url).toBeNull();
    expect(res.body.uploadId).toBe('fake-upload-id');
    expect(res.body.partSize).toBe(VIDEO_PART_SIZE);

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row.status).toBe('uploading');
    expect(row.uploadId).toBe('fake-upload-id');
    expect(storage.initMultipart).toHaveBeenCalledWith(row.s3Key, { contentType: 'video/mp4' });
  });
});

describe('POST /api/media/:id/parts', () => {
  it('仅 uploader 本人：逐 part 预签名', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ partNumbers: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.partSize).toBe(VIDEO_PART_SIZE);
    expect(res.body.urls).toHaveLength(2);
    expect(res.body.urls[0]).toEqual({
      partNumber: 1,
      url: 'https://fake.local/presigned-part',
      expiresIn: 900,
    });
    expect(storage.presignPart).toHaveBeenCalledTimes(2);
  });

  it('非 uploader → 404 MEDIA_NOT_FOUND（不泄露存在性）', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ partNumbers: [1] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
  });

  it('图片（无 uploadId）→ 409 MEDIA_INVALID_STATE', async () => {
    const presigned = await presignImage(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/parts`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ partNumbers: [1] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEDIA_INVALID_STATE');
  });
});

describe('POST /api/media/:id/complete', () => {
  it('图片：HeadObject 校验通过 → ready；重复 complete 幂等返回相同结果', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });

    const first = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      mediaId: presigned.body.mediaId,
      status: 'ready',
      mime: 'image/jpeg',
      size: 1024,
    });
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');

    const second = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // 幂等：HeadObject 只在第一次 complete 时调用
    expect(storage.headObject).toHaveBeenCalledTimes(1);
  });

  it('视频：先 completeMultipart（service 层按 partNumber 升序排序后再传 adapter），再 HeadObject 校验', async () => {
    const presigned = await presignVideo(alice.token);
    storage.headObject.mockResolvedValue({
      size: 64 * 1024 * 1024,
      contentType: 'video/mp4',
      lastModified: new Date(),
    });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: '"a"' }] });
    expect(res.status).toBe(200);
    // mock 原样记录入参：断言收到的是「升序排序后」的数组——排序契约钉在 service 层
    // （S3 CompleteMultipartUpload 要求 parts 严格升序；mock adapter 不会替 service 排序）
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      `tmp/${presigned.body.mediaId}.mp4`,
      'fake-upload-id',
      [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
      ]
    );
  });

  it('视频：parts 为空 → 400 MEDIA_INVALID，不触 S3（与图片分支对称）', async () => {
    const presigned = await presignVideo(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });

  it('视频：S3 已合片但 HeadObject 校验 422 后，重试不再触合片（幂等覆盖中间态）', async () => {
    const presigned = await presignVideo(alice.token);
    // 合片成功、HeadObject size 不符 → 422，状态停留 uploading
    storage.headObject.mockResolvedValue({ size: 1, contentType: 'video/mp4', lastModified: new Date() });
    const first = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 1, etag: '"a"' }] });
    expect(first.status).toBe(422);
    expect(first.body.error.code).toBe('MEDIA_MISMATCH');
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);

    // 客户端重试（同 parts）：uploadId 已在合片成功后被置空 → 跳过 completeMultipart
    // （否则 S3 NoSuchUpload → 500），只做 HeadObject；对象一致 → ready
    storage.headObject.mockResolvedValue({
      size: 64 * 1024 * 1024,
      contentType: 'video/mp4',
      lastModified: new Date(),
    });
    const retry = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ parts: [{ partNumber: 1, etag: '"a"' }] });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('ready');
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
  });

  it('HeadObject size/mime 与申请不符 → 422 MEDIA_MISMATCH，状态仍 uploading', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 999, contentType: 'image/jpeg', lastModified: new Date() });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MEDIA_MISMATCH');
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('uploading');
  });

  it('HeadObject 不存在 → 422 MEDIA_MISMATCH', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue(null);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it('orphaned 状态 → 409 MEDIA_INVALID_STATE', async () => {
    const presigned = await presignImage(alice.token);
    await db.update(media).set({ status: 'orphaned' }).where(eq(media.id, presigned.body.mediaId));
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(409);
  });
});

describe('POST /api/media/:id/abort', () => {
  it('multipart：abortMultipart + 状态 orphaned；重复 abort 幂等 204', async () => {
    const presigned = await presignVideo(alice.token);
    const mediaId = presigned.body.mediaId;
    const res = await request(app)
      .post(`/api/media/${mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledWith(`tmp/${mediaId}.mp4`, 'fake-upload-id');
    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.status).toBe('orphaned');

    const again = await request(app)
      .post(`/api/media/${mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(again.status).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledTimes(1);
  });

  it('非 uploader → 404', async () => {
    const presigned = await presignImage(alice.token);
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/abort`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });

  it('ready 媒体 abort → 409 MEDIA_INVALID_STATE（终态保护），状态保持 ready', async () => {
    const presigned = await presignImage(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/abort`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEDIA_INVALID_STATE');
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
    expect(storage.abortMultipart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- media`
Expected: FAIL（`Cannot find module '../../src/media/media.service.js'` 或路由 404）

- [ ] **Step 4: 实现 media.service.ts**

`apps/server/src/media/media.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { and, eq } from 'drizzle-orm';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_PART_SIZE,
  type MediaCompleteInput,
  type MediaCompleteResponse,
  type MediaPartsInput,
  type MediaPartsResponse,
  type MediaPresignInput,
  type MediaPresignResponse,
} from '@moment/dto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, type Media } from '../db/schema.js';
import { currentStorageMeta, getStorage } from '../storage/factory.js';

/** 读取「存在且属于该用户」的 media；不区分不存在与非本人，避免 mediaId 探测。 */
async function getOwnedMediaOr404(userId: string, mediaId: string): Promise<Media> {
  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || row.uploaderId !== userId) throw new NotFoundError('MEDIA_NOT_FOUND');
  return row;
}

@Service()
export class MediaService {
  /**
   * 预签名申请（spec §3 事务边界：先插 media(status='uploading', tmp key) 行再返 URL）。
   * 取舍声明：「插行 → initMultipart → update」非单事务——update 失败会留下已开启但 uploadId
   * 未落库的 S3 multipart 会话（泄漏）；initMultipart 失败则行停留 uploading。两者均由
   * Phase 8 lifecycle/sweeper 按「uploading 超 24h」兜底清理，本阶段不做补偿。
   */
  async presign(userId: string, input: MediaPresignInput): Promise<MediaPresignResponse> {
    if (input.kind === 'image' && input.size > MAX_IMAGE_BYTES) {
      throw new HttpError(413, 'MEDIA_TOO_LARGE');
    }
    if (input.kind === 'video' && input.size > MAX_VIDEO_BYTES) {
      throw new HttpError(413, 'MEDIA_TOO_LARGE');
    }

    const mediaId = randomUUID();
    // mime-types 的 extension() 对未知 mime 返回 false（不只是 null），必须用 || 兜底
    const ext = mime.extension(input.mime) || 'bin';
    const tmpKey = `tmp/${mediaId}.${ext}`;

    await db.insert(media).values({
      id: mediaId,
      momentId: null,
      uploaderId: userId,
      s3Key: tmpKey,
      mime: input.mime,
      size: input.size,
      width: null,
      height: null,
      duration: input.durationSeconds ?? null,
      posterMediaId: null,
      sortOrder: input.sortOrder ?? 0,
      status: 'uploading',
      storageMeta: currentStorageMeta(),
      uploadId: null,
    });

    if (input.kind === 'image') {
      const url = await getStorage().presignPut(
        tmpKey,
        { contentType: input.mime },
        config.PRESIGN_PUT_TTL_SECONDS
      );
      return { mediaId, method: 'put', url, uploadId: null, partSize: null };
    }

    const uploadId = await getStorage().initMultipart(tmpKey, { contentType: input.mime });
    await db.update(media).set({ uploadId }).where(eq(media.id, mediaId));
    return { mediaId, method: 'multipart', url: null, uploadId, partSize: VIDEO_PART_SIZE };
  }

  /** 逐 part 预签名（仅 uploader 本人；断点续传 = 客户端按 part 重试/补签） */
  async presignParts(
    userId: string,
    mediaId: string,
    input: MediaPartsInput
  ): Promise<MediaPartsResponse> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status !== 'uploading' || !row.uploadId) {
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }
    const urls = await Promise.all(
      input.partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getStorage().presignPart(
          row.s3Key,
          row.uploadId!,
          partNumber,
          config.PRESIGN_PUT_TTL_SECONDS
        ),
        expiresIn: config.PRESIGN_PUT_TTL_SECONDS,
      }))
    );
    return { mediaId, partSize: VIDEO_PART_SIZE, urls };
  }

  /**
   * complete：multipart 先合片（parts 在 **service 层**按 partNumber 升序排序——S3
   * CompleteMultipartUpload 的硬性要求，契约钉在此处，不依赖 adapter 实现）；HeadObject
   * 校验存在 + size/mime 与申请一致；状态推进用条件更新抢占（`WHERE status='uploading'`），
   * 防与 abort/发布绑定的并发读-改-写竞态。幂等：ready 状态重复调用直接返回相同结果，
   * 不再触达 S3（spec §5.5）。「S3 已合片但 HeadObject 校验 422（状态停留 uploading）」的
   * 中间态也在幂等声明覆盖内：合片成功即置 uploadId=null 持久化，重试跳过合片只做 HeadObject
   * （否则再调 completeMultipart 会打出 S3 NoSuchUpload → 500）。
   */
  async complete(
    userId: string,
    mediaId: string,
    input: MediaCompleteInput
  ): Promise<MediaCompleteResponse> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status === 'ready') {
      return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
    }
    if (row.status !== 'uploading') {
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }

    if (row.uploadId) {
      // 空 parts 打到 S3 是 InvalidRequest（500），与图片分支对称地拒绝
      if (input.parts.length === 0) throw new HttpError(400, 'MEDIA_INVALID');
      // 请求原序可能是乱序（客户端并发上传），S3 要求严格升序；adapter 内仍保留排序作纵深防御
      const sortedParts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
      await getStorage().completeMultipart(row.s3Key, row.uploadId, sortedParts);
      // 合片成功即消费掉 S3 上传会话：立即持久化 uploadId=null。此后任何失败（HeadObject 422、
      // DB 推进失败）留下的 uploading 行重入时走「无 uploadId」路径——跳过合片只做 HeadObject。
      await db.update(media).set({ uploadId: null }).where(eq(media.id, mediaId));
    } else if (input.parts.length > 0 && !row.mime.startsWith('video/')) {
      // 图片行携带 parts → 拒绝；video 行的 uploadId 已因合片完成被置空，重试携带 parts
      // 不再视为错误（parts 被忽略，仅做 HeadObject 校验——见上方幂等声明）。
      throw new HttpError(400, 'MEDIA_INVALID');
    }

    const head = await getStorage().headObject(row.s3Key);
    if (!head || head.size !== row.size || head.contentType !== row.mime) {
      throw new HttpError(422, 'MEDIA_MISMATCH');
    }

    // 条件更新抢占：仅 uploading → ready 生效，避免与并发 abort/绑定的丢失更新。
    // drizzle mysql2 的 update 返回 [ResultSetHeader]，affectedRows 可判断是否抢到。
    const [result] = await db
      .update(media)
      .set({ status: 'ready' })
      .where(and(eq(media.id, mediaId), eq(media.status, 'uploading')));
    if (result.affectedRows === 0) {
      // 并发下已被推进：若他方已置 ready，按幂等语义返回成功；否则（orphaned/被绑定）409
      const [now] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
      if (now?.status === 'ready') {
        return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
      }
      throw new HttpError(409, 'MEDIA_INVALID_STATE');
    }
    return { mediaId: row.id, status: 'ready', mime: row.mime, size: row.size };
  }

  /**
   * abort：合片会话作废 + 状态 orphaned（幂等）。
   * 状态守卫：仅 `uploading` 可 abort。`ready` 是终态——视频的 uploadId 已完成合片，
   * abortMultipart 会打出 S3 NoSuchUpload（500）；图片无 uploadId 会被直接置 orphaned，
   * 把已上传可发布的媒体永久作废（complete 幂等分支只认 ready）。故 ready 一律 409。
   * 图片单 PUT 的 uploading 状态也允许 abort 作废记录。
   * 状态推进与 complete() 对称地用**条件更新**抢占（`WHERE status='uploading'`）：
   * 若本请求读到 stale 的 uploading 后、并发 complete() 已把行推进为 ready（甚至 create()
   * 已绑定 moment），无条件的 UPDATE 会把它覆盖回 orphaned，破坏「ready 终态不可回退」。
   * 抢不到（affectedRows=0）说明他方已推进，按幂等语义直接返回。
   */
  async abort(userId: string, mediaId: string): Promise<void> {
    const row = await getOwnedMediaOr404(userId, mediaId);
    if (row.status === 'orphaned') return;
    if (row.status !== 'uploading') throw new HttpError(409, 'MEDIA_INVALID_STATE');
    if (row.uploadId) {
      await getStorage().abortMultipart(row.s3Key, row.uploadId);
    }
    const [result] = await db
      .update(media)
      .set({ status: 'orphaned' })
      .where(and(eq(media.id, mediaId), eq(media.status, 'uploading')));
    if (result.affectedRows === 0) return;
  }
}
```

- [ ] **Step 5: 实现 media.controller.ts 并注册**

`apps/server/src/media/media.controller.ts`：
```ts
import type {
  MediaCompleteResponse,
  MediaPartsResponse,
  MediaPresignResponse,
  UserProfile,
} from '@moment/dto';
import {
  mediaCompleteInputSchema,
  mediaPartsInputSchema,
  mediaPresignInputSchema,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { MediaService } from './media.service.js';

@JsonController('/media')
@Service()
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @Post('/presign')
  @Authorized()
  @HttpCode(201)
  presign(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<MediaPresignResponse> {
    return this.mediaService.presign(user.id, mediaPresignInputSchema.parse(body));
  }

  @Post('/:id/parts')
  @Authorized()
  parts(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MediaPartsResponse> {
    return this.mediaService.presignParts(user.id, id, mediaPartsInputSchema.parse(body));
  }

  @Post('/:id/complete')
  @Authorized()
  complete(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MediaCompleteResponse> {
    return this.mediaService.complete(user.id, id, mediaCompleteInputSchema.parse(body));
  }

  @Post('/:id/abort')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  abort(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.mediaService.abort(user.id, id);
  }
}
```

`apps/server/src/app.ts` 两处修改（Phase 1/2 已注册的 AuthController/ChainsController/InvitesController 保持不动）：
1) import 区新增：
```ts
import { MediaController } from './media/media.controller.js';
```
2) `controllers: [...]` 数组追加 `MediaController`（基线为 Phase 2 收尾后的数组 `[HealthController, AuthController, ChainsController, InvitesController]`）：
```ts
    controllers: [HealthController, AuthController, ChainsController, InvitesController, MediaController],
```
（若 Phase 2 实际注册的数组与上述基线不同，保持原数组不动，仅追加 `MediaController` 一项——严禁照抄示例时丢掉既有项。）

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: media 19 个用例 PASS（presign 6 + parts 3 + complete 7 + abort 3）；既有全部保持 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/media apps/server/src/app.ts apps/server/tests
git commit -m "feat(server): 媒体上传管线（presign/multipart parts/complete 校验+幂等/abort）"
```

---

### Task 6: GET /api/media/:id —— 权限校验 + 302 预签名（TTL 整点对齐，TDD）

**Files:**
- Create: `apps/server/src/media/presign-ttl.ts`
- Modify: `apps/server/src/media/media.service.ts`（追加 `resolveAccessUrl`）、`apps/server/src/media/media.controller.ts`（追加 GET /:id）
- Test: `apps/server/tests/media/presign-ttl.test.ts`、`apps/server/tests/media/media-access.test.ts`

**Interfaces:**
- Consumes: Task 5 `MediaService`/mock helper、Phase 2 `ChainPolicy.require(userId, chainId, 'viewer')`、Task 3 `media`/`moments` 表。
- Produces:
  - `alignedGetPresign(nowMs?, ttlSeconds?): { signingDate: Date; expiresIn: number }`（signingDate=当前小时窗起点，expiresIn=`ttl + 3600` 常量；二者组合保证同一小时窗内 URL 字符串完全一致，Phase 8 share 页复用）
  - `MediaService.resolveAccessUrl(user: UserProfile, mediaId: string, st?: string): Promise<string>`（返回预签名 GET URL；st 透传点本阶段拒绝，Phase 8 实现）
  - HTTP：`GET /api/media/:id` → 302 + `Cache-Control: private, max-age=300`（Phase 6/8 客户端消费）

- [ ] **Step 1: 写失败测试（TTL 对齐单元测试）**

`apps/server/tests/media/presign-ttl.test.ts`：
```ts
import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';
import { alignedGetPresign } from '../../src/media/presign-ttl.js';

describe('alignedGetPresign（签名时刻 + TTL 双整点对齐，spec §5.3）', () => {
  it('signingDate 对齐到当前小时窗起点，expiresIn = TTL + 3600（常量）', () => {
    const { signingDate, expiresIn } = alignedGetPresign(7_200_000 + 123_456, 3600);
    expect(signingDate.getTime()).toBe(7_200_000);
    expect(expiresIn).toBe(3600 + 3600);
  });

  it('窗内任意时刻距过期 ≥ TTL（边界：整点自身与下一整点前 1 秒）', () => {
    for (const nowMs of [3_600_000, 3_600_000 + 1, 7_200_000 - 1000]) {
      const { signingDate, expiresIn } = alignedGetPresign(nowMs, 3600);
      expect(signingDate.getTime() + expiresIn * 1000 - nowMs).toBeGreaterThanOrEqual(3600 * 1000);
    }
  });

  it('跨窗后 signingDate 切换（URL 只随整点变化）', () => {
    expect(alignedGetPresign(7_200_000 - 1, 3600).signingDate.getTime()).toBe(3_600_000);
    expect(alignedGetPresign(7_200_000, 3600).signingDate.getTime()).toBe(7_200_000);
  });

  it('真 S3 adapter（mocked credentials，不起网，仅本地计算签名串）：同窗两次签出的 URL 字符串完全一致', async () => {
    const adapter = new S3UnifiedStorageAdapter({
      bucket: 'moment-test',
      prefix: 'test/attachments',
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });
    const meta = {
      bucket: 'moment-test',
      prefix: 'test/attachments',
      region: 'us-east-1',
      isPublicBucket: 'false' as const,
    };
    // 同窗不同时刻（若 expiresIn 或签名时刻随 now 变化，两串必然不等——这正是本断言防的回归）
    const a = alignedGetPresign(7_200_000 + 123_000, 3600);
    const b = alignedGetPresign(7_200_000 + 125_000, 3600);
    const u1 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, a.expiresIn, a.signingDate);
    const u2 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, b.expiresIn, b.signingDate);
    expect(u1).toBe(u2);
    // 跨窗则必然不同（signingDate 变化）
    const c = alignedGetPresign(10_800_000 + 123_000, 3600);
    const u3 = await adapter.generateAccessUrl('chains/c/m/x.jpeg', meta, c.expiresIn, c.signingDate);
    expect(u3).not.toBe(u1);
  });
});
```

- [ ] **Step 2: 写失败测试（302 读取集成）**

`apps/server/tests/media/media-access.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let carol: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
  carol = await createUser(app, 'carol');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 直插一条已 ready 的 media（绑定可选），返回 mediaId。 */
async function insertReadyMedia(opts: { uploaderId: string; momentId: string | null; status?: 'ready' | 'uploading' }): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/c-1/m-1/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: opts.status ?? 'ready',
    storageMeta: { bucket: 'moment-test-placeholder', prefix: 'test/attachments', region: 'us-east-1', isPublicBucket: 'false' },
  });
  return id;
}

async function insertMoment(chainId: string, authorId: string, deleted = false): Promise<string> {
  const id = randomUUID();
  await db.insert(moments).values({
    id,
    chainId,
    authorId,
    type: 'media',
    content: 'with photo',
    happenedAt: new Date('2026-08-15T10:00:00Z'),
    happenedTzOffset: -480,
    deletedAt: deleted ? new Date() : null,
  });
  return id;
}

describe('GET /api/media/:id', () => {
  it('绑定 moment：链内 viewer 成员 → 302 到预签名 URL，带 Cache-Control', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      `chains/c-1/m-1/${mediaId}.jpeg`,
      { bucket: 'moment-test-placeholder', prefix: 'test/attachments', region: 'us-east-1', isPublicBucket: 'false' },
      expect.any(Number),
      expect.any(Date)
    );
    const ttlArg = storage.generateAccessUrl.mock.calls[0]![2] as number;
    expect(ttlArg).toBeGreaterThan(3600);
    expect(ttlArg).toBeLessThanOrEqual(7200);
  });

  it('绑定 moment：非链成员 → 404（ChainPolicy CHAIN_NOT_FOUND）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${carol.token}`);
    expect(res.status).toBe(404);
  });

  it('绑定 moment：moment 已软删 → 404', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id, true);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(404);
  });

  it('未绑定 moment：uploader 本人 → 302；他人 → 404', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });

    const own = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(own.status).toBe(302);

    const other = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(other.status).toBe(404);
  });

  it('status=uploading → 404（未 complete 的媒体不外发）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId, status: 'uploading' });
    const res = await request(app)
      .get(`/api/media/${mediaId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(404);
  });

  it('带 ?st= share token → 403 SHARE_NOT_SUPPORTED（Phase 8 实现透传）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });

    const res = await request(app)
      .get(`/api/media/${mediaId}?st=some-token`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHARE_NOT_SUPPORTED');
  });

  it('未登录 → 401（用真实存在的 mediaId，只考察鉴权这一个维度）', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null });
    const res = await request(app).get(`/api/media/${mediaId}`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- media`
Expected: FAIL（`Cannot find module '../../src/media/presign-ttl.js'`；`/api/media/:id` 404）

- [ ] **Step 4: 实现**

`apps/server/src/media/presign-ttl.ts`：
```ts
import { config } from '../config.js';

const HOUR_MS = 3_600_000;
const HOUR_SECONDS = 3600;

export interface AlignedGetPresign {
  /** 签名时刻（= 当前小时窗起点）：SigV4 预签名 URL 的 X-Amz-Date 来源 */
  signingDate: Date;
  /** 预签名有效期（秒）：TTL + 3600 常量 */
  expiresIn: number;
}

/**
 * 预签名 GET 整点对齐（spec §5.3）：**签名时刻**与**有效期**双对齐。
 * 只对齐过期时刻（expiresIn 随当前秒变化）是不够的——X-Amz-Date 进了签名输入，
 * 签名时刻每秒不同则 URL 字符串每秒不同，「同一窗口内 URL 相同」不成立。
 * 这里 signingDate = 窗口起点（常量）、expiresIn = TTL + 3600（常量）：
 * 窗内两次签名输入完全一致 → URL 字符串完全一致；过期时刻落在下一窗内且距窗内任意时刻 ≥ TTL。
 * 前置假设：TTL ≤ 3600（一个窗长），由 config 对 PRESIGN_GET_TTL_SECONDS 的 .max(3600) 强制。
 */
export function alignedGetPresign(
  nowMs = Date.now(),
  ttlSeconds = config.PRESIGN_GET_TTL_SECONDS
): AlignedGetPresign {
  const windowStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return { signingDate: new Date(windowStart), expiresIn: ttlSeconds + HOUR_SECONDS };
}
```

`apps/server/src/media/media.service.ts` 追加（import 区补充 `ForbiddenError`（来自 routing-controllers）、`moments`（schema）、`ChainPolicy`、`alignedGetPresign`、`UserProfile`）：
```ts
// —— import 区补充（合并进文件顶部既有 import）——
import { ForbiddenError } from 'routing-controllers';
import { moments } from '../db/schema.js'; // 与 media 合并为一条 schema import
import { ChainPolicy } from '../chains/chain-policy.js';
import { alignedGetPresign } from './presign-ttl.js';
import type { UserProfile } from '@moment/dto';
```
类构造器与方法的追加（Task 5 的 `MediaService` 原无 constructor，此处新增，TypeDI 自动注入 `ChainPolicy`；既有方法保持不变）：
```ts
@Service()
export class MediaService {
  constructor(private readonly policy: ChainPolicy) {}
  // ……Task 5 既有方法保持不变……

  /**
   * 鉴权后返回预签名 GET URL（302 目标）：
   * - 已绑定 moment：moment 未软删时按所属链校验 viewer；
   * - 未绑定：仅 uploader 本人；
   * - ?st= share token 透传点：本阶段拒绝（Phase 8 实现免登录分享校验）。
   */
  async resolveAccessUrl(user: UserProfile, mediaId: string, st?: string): Promise<string> {
    if (st !== undefined) throw new ForbiddenError('SHARE_NOT_SUPPORTED');

    const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!row || row.status !== 'ready') throw new NotFoundError('MEDIA_NOT_FOUND');

    if (row.momentId) {
      const [m] = await db
        .select({ chainId: moments.chainId, deletedAt: moments.deletedAt })
        .from(moments)
        .where(eq(moments.id, row.momentId))
        .limit(1);
      if (!m || m.deletedAt) throw new NotFoundError('MEDIA_NOT_FOUND');
      await this.policy.require(user.id, m.chainId, 'viewer');
    } else if (row.uploaderId !== user.id) {
      throw new NotFoundError('MEDIA_NOT_FOUND');
    }

    const { signingDate, expiresIn } = alignedGetPresign();
    return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, expiresIn, signingDate);
  }
}
```

`apps/server/src/media/media.controller.ts` 追加（import 区补充 `Get`、`QueryParam`、`Res`、`Response`）：
```ts
// —— import 区补充（合并进文件顶部既有 import）——
import { Get, QueryParam, Res } from 'routing-controllers';
import type { Response } from 'express';

// MediaService 注入点已有（constructor 不变），类内追加：
  @Get('/:id')
  @Authorized()
  async access(
    @Param('id') id: string,
    @QueryParam('st') st: string | undefined,
    @CurrentUser() user: UserProfile,
    @Res() res: Response
  ): Promise<Response> {
    const url = await this.mediaService.resolveAccessUrl(user, id, st);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, url);
  }
```
注意：`@Res()` 下 routing-controllers 不再处理返回值，redirect 由 Express 完成；Express 4 的 `res.redirect` 签名是 `redirect([status,] path)`，状态码在前。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: presign-ttl 4 + media-access 7 个用例 PASS；Task 5 的 19 个保持 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/media apps/server/tests/media
git commit -m "feat(server): /api/media/:id 鉴权 + 302 预签名（TTL 整点对齐）"
```

---

### Task 7: moments 基建（cursor + serializer + create 事务 + POST 端点，TDD）

**Files:**
- Create: `apps/server/src/moments/cursor.ts`、`apps/server/src/moments/moment-serializer.ts`、`apps/server/src/moments/moment.service.ts`、`apps/server/src/moments/moment.controller.ts`
- Modify: `apps/server/src/app.ts`（注册 MomentController）
- Test: `apps/server/tests/moments/cursor.test.ts`、`apps/server/tests/moments/moment-serializer.test.ts`、`apps/server/tests/moments/create-moment.test.ts`

**Interfaces:**
- Consumes: Task 1 dto、Task 3 `moments/media` 表、Task 4 `emitOutbox`/`OUTBOX_MOMENT_CREATED`、Task 5 媒体上传链路（测试用）、Phase 2 `ChainPolicy` / `requireChainRole('editor')`。
- Produces（Task 8 依赖；Phase 4 feed 复用 cursor 与 serializer，CONVENTIONS §3.4）:
  - `encodeCursor(payload: {h: number; i: string} | {c: number; i: string}): string`（base64url(JSON)）
  - `decodeCursor(cursor: string): {h?: number; c?: number; i: string}`（非法抛 `BadRequestError('INVALID_CURSOR')`）
  - `momentSerializer(m: MomentLike, media: MediaLike[], author: AuthorSummary): MomentResponse`（唯一出口；media 只出 `/api/media/:id` 相对路径）
  - `class MomentService`：`create(userId, chainId, input)`（Task 8 追加 list/get/update/remove）
  - HTTP：`POST /api/chains/:chainId/moments`（@Authorized + `@UseBefore(requireChainRole('editor'))`）

- [ ] **Step 1: 写失败测试（cursor 单元）**

`apps/server/tests/moments/cursor.test.ts`：
```ts
import { BadRequestError } from 'routing-controllers';
import { decodeCursor, encodeCursor } from '../../src/moments/cursor.js';

describe('moment cursor（CONVENTIONS §3.4）', () => {
  it('happened_at 游标 roundtrip：{h: epochMs, i: momentId}', () => {
    const encoded = encodeCursor({ h: 1755242400000, i: 'm-1' });
    expect(decodeCursor(encoded)).toEqual({ h: 1755242400000, i: 'm-1' });
  });

  it('created_at 游标 roundtrip：{c: epochMs, i: momentId}', () => {
    const encoded = encodeCursor({ c: 1755242400000, i: 'm-2' });
    expect(decodeCursor(encoded)).toEqual({ c: 1755242400000, i: 'm-2' });
  });

  it('垃圾串 → INVALID_CURSOR', () => {
    expect(() => decodeCursor('!!!not-base64url-json')).toThrow(BadRequestError);
    expect(() => decodeCursor(Buffer.from('not json').toString('base64url'))).toThrow(
      new BadRequestError('INVALID_CURSOR')
    );
  });

  it('结构非法（缺 i / 同时含 h 与 c / 类型错）→ INVALID_CURSOR', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    expect(() => decodeCursor(enc({ h: 1 }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(enc({ h: 1, c: 2, i: 'm' }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(enc({ h: '1', i: 'm' }))).toThrow('INVALID_CURSOR');
  });
});
```

- [ ] **Step 2: 写失败测试（serializer 单元）**

`apps/server/tests/moments/moment-serializer.test.ts`：
```ts
import { momentSerializer } from '../../src/moments/moment-serializer.js';

const moment = {
  id: 'm-1',
  chainId: 'c-1',
  authorId: 'u-1',
  type: 'media' as const,
  content: '九张图',
  happenedAt: new Date('2026-08-15T02:00:00Z'),
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: new Date('2026-08-15T02:00:01Z'),
};

describe('momentSerializer（moment → API 响应唯一出口）', () => {
  it('media 按 sortOrder 升序，url 是稳定入口相对路径（不内嵌预签名）', () => {
    const res = momentSerializer(
      moment,
      [
        { id: 'md-2', mime: 'image/jpeg', width: 100, height: 200, duration: null, sortOrder: 1 },
        { id: 'md-1', mime: 'image/png', width: 10, height: 20, duration: null, sortOrder: 0 },
      ],
      { id: 'u-1', nickname: 'Alice' }
    );
    expect(res.media.map((m) => m.id)).toEqual(['md-1', 'md-2']);
    expect(res.media[0].url).toBe('/api/media/md-1');
    expect(JSON.stringify(res)).not.toContain('https://');
    expect(res.happenedAt).toBe('2026-08-15T02:00:00.000Z');
    expect(res.author).toEqual({ id: 'u-1', nickname: 'Alice' });
  });

  it('text 类型 media 为空数组', () => {
    const res = momentSerializer(
      { ...moment, type: 'text', content: 'hi' },
      [],
      { id: 'u-1', nickname: 'Alice' }
    );
    expect(res.media).toEqual([]);
  });
});
```

- [ ] **Step 3: 写失败测试（create 集成）**

`apps/server/tests/moments/create-moment.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 走真实接口造一条 ready 图片 media，返回 mediaId。 */
async function readyImage(token: string, mime = 'image/jpeg', size = 1024): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size, kind: 'image' });
  storage.headObject.mockResolvedValue({ size, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const baseBody = {
  type: 'text' as const,
  content: '第一次翻身',
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('POST /api/chains/:chainId/moments', () => {
  it('text moment：201，落库 + outbox(moment.created)，response 不含预签名', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const res = await postMoment(alice.token, chainId, { ...baseBody, isBackfill: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      chainId,
      type: 'text',
      content: '第一次翻身',
      happenedTzOffset: -480,
      isBackfill: true,
      author: { id: alice.id, nickname: 'alice' },
      media: [],
    });
    // 服务端把 +08:00 换算为 UTC 存储（spec §5.6）
    expect(res.body.happenedAt).toBe('2026-08-15T02:00:00.000Z');

    const [row] = await db.select().from(moments).where(eq(moments.id, res.body.id));
    expect(row.happenedAt.toISOString()).toBe('2026-08-15T02:00:00.000Z');

    const [event] = await db.select().from(outbox);
    expect(event).toMatchObject({ type: 'moment.created', status: 'pending' });
    expect(event.payload).toEqual({
      momentId: res.body.id,
      chainId,
      authorId: alice.id,
      isBackfill: true,
    });
  });

  it('viewer 角色发布 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const res = await postMoment(bob.token, chainId, { ...baseBody, content: '我只看看' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非链成员 → 404 CHAIN_NOT_FOUND', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(bob.token, chainId, { ...baseBody, content: '路人' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('media moment：tmp→final copy、绑定 moment_id、sortOrder 按 mediaIds 顺序', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const md1 = await readyImage(alice.token);
    const md2 = await readyImage(alice.token);

    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '两连拍',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [md2, md1], // 故意倒序：response 应按 mediaIds 顺序出
    });
    expect(res.status).toBe(201);
    expect(res.body.media.map((m: { id: string; url: string }) => [m.id, m.url])).toEqual([
      [md2, `/api/media/${md2}`],
      [md1, `/api/media/${md1}`],
    ]);

    const momentId = res.body.id as string;
    for (const [idx, md] of [md2, md1].entries()) {
      const [row] = await db.select().from(media).where(eq(media.id, md));
      expect(row.momentId).toBe(momentId);
      expect(row.sortOrder).toBe(idx);
      expect(row.s3Key).toBe(`chains/${chainId}/${momentId}/${md}.jpeg`);
    }
    expect(storage.copyObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('引用他人 media → 400 MEDIA_INVALID，moment 不落库', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const foreign = await readyImage(bob.token); // bob 上传的
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [foreign],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(await db.select().from(moments)).toHaveLength(0);
  });

  it('引用未 complete（uploading）的 media → 400 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [presigned.body.mediaId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('type=video 引用图片 mime → 400 MEDIA_INVALID；type=media 宫格允许图/视频混排（spec §1，见 Global Constraints）', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const imageMediaId = await readyImage(alice.token, 'image/png');
    // 直插一条 ready 的 video mime 媒体（multipart 通道造数成本高，归属校验只看行字段）
    const { randomUUID } = await import('node:crypto');
    const videoMediaId = randomUUID();
    await db.insert(media).values({
      id: videoMediaId,
      momentId: null,
      uploaderId: alice.id,
      s3Key: `tmp/${videoMediaId}.mp4`,
      mime: 'video/mp4',
      size: 1024,
      status: 'ready',
      storageMeta: {},
    });

    // type=video 恰好 1 条且必须是 video/*：引用图片 mime → 400，moment 不落库
    const bad = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageMediaId],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MEDIA_INVALID');
    expect(await db.select().from(moments)).toHaveLength(0);

    // type=media 宫格混排图+视频 → 201（spec §1 字面语义，不收紧为「仅图片」）
    const mixed = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageMediaId, videoMediaId],
    });
    expect(mixed.status).toBe(201);
    expect(mixed.body.media.map((m: { id: string }) => m.id)).toEqual([imageMediaId, videoMediaId]);
  });

  it('dto 校验：type=text 携带 mediaIds → 400 VALIDATION_ERROR', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(alice.token, chainId, {
      ...baseBody,
      mediaIds: ['whatever'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm --filter @moment/server test -- moments`
Expected: FAIL（`Cannot find module '../../src/moments/cursor.js'` 等）

- [ ] **Step 5: 实现 cursor.ts 与 moment-serializer.ts**

`apps/server/src/moments/cursor.ts`：
```ts
import { BadRequestError } from 'routing-controllers';

/** order=happened_at：{h: epochMs, i: momentId} */
export interface HappenedCursor {
  h: number;
  i: string;
}

/** order=created_at：{c: epochMs, i: momentId}（Phase 4 feed 消费） */
export interface CreatedCursor {
  c: number;
  i: string;
}

export type CursorPayload = HappenedCursor | CreatedCursor;

/** 游标 = base64url(JSON)（CONVENTIONS §3.4，客户端视角为 opaque string） */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** h 与 c 恰好其一 + 非空 i；否则 INVALID_CURSOR。 */
export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as Partial<HappenedCursor & CreatedCursor>;
  const hasH = typeof p.h === 'number';
  const hasC = typeof p.c === 'number';
  if (typeof p.i !== 'string' || p.i.length === 0 || hasH === hasC) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return p as CursorPayload;
}
```

`apps/server/src/moments/moment-serializer.ts`：
```ts
import type { AuthorSummary, MomentMedia, MomentResponse, MomentType } from '@moment/dto';

/** serializer 依赖的最小形状（db 的 Moment/Media 行结构兼容，便于事务内未落库行复用） */
export interface MomentLike {
  id: string;
  chainId: string;
  authorId: string;
  type: MomentType;
  content: string;
  happenedAt: Date;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: Date;
}

export interface MediaLike {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
}

function serializeMedia(m: MediaLike): MomentMedia {
  // 唯一出口约定：media 只出稳定入口相对路径，绝不内嵌预签名 URL（CONVENTIONS §3.4）
  return {
    id: m.id,
    url: `/api/media/${m.id}`,
    mime: m.mime,
    width: m.width,
    height: m.height,
    duration: m.duration,
    sortOrder: m.sortOrder,
  };
}

/** moment → API 响应的唯一出口；Phase 4/5 在此扩展批量计数等，不得另建序列化路径。 */
export function momentSerializer(
  m: MomentLike,
  media: MediaLike[],
  author: AuthorSummary
): MomentResponse {
  return {
    id: m.id,
    chainId: m.chainId,
    author,
    type: m.type,
    content: m.content,
    happenedAt: m.happenedAt.toISOString(),
    happenedTzOffset: m.happenedTzOffset,
    isBackfill: m.isBackfill,
    createdAt: m.createdAt.toISOString(),
    media: [...media].sort((a, b) => a.sortOrder - b.sortOrder).map(serializeMedia),
  };
}
```

- [ ] **Step 6: 实现 moment.service.ts（create 事务）+ controller + 注册**

`apps/server/src/moments/moment.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import { eq, inArray } from 'drizzle-orm';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import type { CreateMomentInput, MomentResponse } from '@moment/dto';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { media, moments, users, type Media } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_CREATED } from '../outbox/types.js';
import { getStorage } from '../storage/factory.js';
import type { StorageMetadata } from '../storage/base.adapter.js';
import { logger } from '../utils/logger.js';
import { momentSerializer } from './moment-serializer.js';

@Service()
export class MomentService {
  constructor(private readonly policy: ChainPolicy) {}

  /**
   * 创建 moment（spec §3 事务边界）：校验 media 归属/状态 → tmp→final copy（按行上 storage_meta，
   * 在源对象所在桶内进行）→ 绑定 moment_id → 插 moment → 同事务 emitOutbox(moment.created)。
   * tmp 对象的删除推迟到**事务提交成功之后**：事务内先删 tmp 再回滚会让 ready 媒体永久丢失
   * （回滚后行回到 tmp key，而对象已被物理删除，lifecycle/sweeper 只能清垃圾、救不回被删对象）。
   */
  async create(userId: string, chainId: string, input: CreateMomentInput): Promise<MomentResponse> {
    await this.policy.require(userId, chainId, 'editor');
    const momentId = randomUUID();
    const happenedAt = new Date(input.happenedAt);
    const storage = getStorage();
    const copiedTmp: { key: string; metadata: StorageMetadata }[] = [];

    const response = await db.transaction(async (tx) => {
      let mediaRows: Media[] = [];
      if (input.mediaIds.length > 0) {
        // 行锁：并发两个 moment 引用同一 mediaId 时，读-改-写必须串行化——
        // 后到者在锁上排队，提交后重读到的行 moment_id 非空 → 400 MEDIA_INVALID，杜绝「双发布各 copy 一半」
        mediaRows = await tx
          .select()
          .from(media)
          .where(inArray(media.id, input.mediaIds))
          .for('update');
        // 全部满足：数量一致（dto 已拒重复 id，此处防御）+ 属本人 + ready + 未绑定 + mime 类型匹配
        // （type=video → 恰好 1 条 video/*；type=media 宫格允许图/视频**混排**，spec §1「media（图/视频宫格+文）」，见 Global Constraints）
        const valid =
          mediaRows.length === new Set(input.mediaIds).size &&
          mediaRows.every(
            (r) =>
              r.uploaderId === userId &&
              r.status === 'ready' &&
              r.momentId === null &&
              (input.type === 'video'
                ? r.mime.startsWith('video/')
                : r.mime.startsWith('image/') || r.mime.startsWith('video/'))
          );
        if (!valid) throw new HttpError(400, 'MEDIA_INVALID');
      }

      await tx.insert(moments).values({
        id: momentId,
        chainId,
        authorId: userId,
        type: input.type,
        content: input.content,
        happenedAt,
        happenedTzOffset: input.happenedTzOffset,
        isBackfill: input.isBackfill,
      });

      const boundMedia: Media[] = [];
      for (const mediaId of input.mediaIds) {
        const row = mediaRows.find((r) => r.id === mediaId)!;
        // mime-types 的 extension() 对未知 mime 返回 false，必须用 || 兜底
        const ext = mime.extension(row.mime) || 'bin';
        const finalKey = `chains/${chainId}/${momentId}/${row.id}.${ext}`;
        // 同桶服务端 copy tmp→final（spec §5.5；时机偏离见 Global Constraints）。
        // 按行上 storage_meta 定位源对象：copy 后对象仍在快照桶内，storage_meta 不改写。
        await storage.copyObject(row.s3Key, finalKey, row.storageMeta);
        copiedTmp.push({ key: row.s3Key, metadata: row.storageMeta });
        const sortOrder = input.mediaIds.indexOf(mediaId);
        await tx
          .update(media)
          .set({ s3Key: finalKey, momentId, sortOrder, storageMeta: row.storageMeta })
          .where(eq(media.id, row.id));
        boundMedia.push({ ...row, s3Key: finalKey, momentId, sortOrder });
      }

      await emitOutbox(
        tx,
        OUTBOX_MOMENT_CREATED,
        { momentId, chainId, authorId: userId, isBackfill: input.isBackfill }
      );

      const [author] = await tx
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!author) throw new NotFoundError('USER_NOT_FOUND');

      const now = new Date();
      return momentSerializer(
        {
          id: momentId,
          chainId,
          authorId: userId,
          type: input.type,
          content: input.content,
          happenedAt,
          happenedTzOffset: input.happenedTzOffset,
          isBackfill: input.isBackfill,
          createdAt: now,
        },
        boundMedia,
        author
      );
    });

    // 事务已提交：此刻删 tmp 才安全。删除失败只留下 tmp 垃圾对象（tmp/ lifecycle 7 天兜底），无数据损失。
    for (const t of copiedTmp) {
      await storage.deleteFile(t.key, t.metadata).catch((err: unknown) => {
        logger.warn(`post-commit tmp cleanup failed (lifecycle will cover): ${t.key}`, err);
      });
    }
    return response;
  }
}
```

`apps/server/src/moments/moment.controller.ts`：
```ts
import type { MomentResponse, UserProfile } from '@moment/dto';
import { createMomentInputSchema } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  HttpCode,
  JsonController,
  Param,
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { MomentService } from './moment.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1：链内资源一律嵌套） */
@JsonController('/chains/:chainId/moments')
@Service()
export class MomentController {
  constructor(private readonly momentService: MomentService) {}

  @Post('/')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  @HttpCode(201)
  create(
    @Param('chainId') chainId: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MomentResponse> {
    return this.momentService.create(user.id, chainId, createMomentInputSchema.parse(body));
  }
}
```

（Task 8 会在同文件追加 `MomentItemController` 处理 `/moments/:id` 及 GET 列表。）

`apps/server/src/app.ts` 两处修改：
1) import 区新增：
```ts
import { MomentController } from './moments/moment.controller.js';
```
2) controllers 数组追加 `MomentController`（基线为 Task 5 收尾后的数组 `[HealthController, AuthController, ChainsController, InvitesController, MediaController]`）：
```ts
    controllers: [HealthController, AuthController, ChainsController, InvitesController, MediaController, MomentController],
```
（仅追加 `MomentController` 一项，严禁照抄示例时丢掉既有项。）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: cursor 4 + serializer 2 + create 8 个用例 PASS；既有全部保持 PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/moments apps/server/src/app.ts apps/server/tests/moments
git commit -m "feat(server): moment 创建（三类型校验、媒体绑定事务、tmp→final copy、outbox 事件）"
```

---

### Task 8: moments 列表（复合游标）/ 详情 / PATCH / DELETE（TDD 集成）

**Files:**
- Modify: `apps/server/src/moments/moment.service.ts`（追加 list/get/update/remove 与 `serializeMany`）
- Modify: `apps/server/src/moments/moment.controller.ts`（追加 GET 列表 + `MomentItemController`）
- Modify: `apps/server/src/chains/chain.service.ts`（`ChainService.remove` 补 media/moments 级联——兑现 Phase 2 Global Constraints 与事务注释锚点显式指派给 Phase 3 的承诺）
- Test: `apps/server/tests/moments/moment-list-crud.test.ts`

**Interfaces:**
- Consumes: Task 7 全部 Produces、Task 5 媒体链路（fixture）、Phase 2 `ChainPolicy`、Phase 2 `ChainService.remove`（`DELETE /api/chains/:id`，owner → 204）。
- Produces（Phase 4 feed、Phase 5 评论、Phase 6/8 客户端消费）:
  - `ChainService.remove` 的级联语义（同事务硬删 media → moments → invites → members → chain；删链不补发 outbox 事件，S3 对象交 Phase 8）——Phase 4/5 的链删除相关行为以此为准。
  - `MomentService.list(userId, chainId, query: { cursor?: string; limit?: string }): Promise<MomentListResponse>`（默认 20、上限 50；`happened_at DESC, id DESC` 复合游标）
  - `MomentService.get(userId, momentId)`（软删 → 410 MOMENT_DELETED）
  - `MomentService.update(userId, momentId, input)` / `MomentService.remove(userId, momentId)`
  - HTTP：`GET /api/chains/:chainId/moments?cursor=&limit=`、`GET|PATCH|DELETE /api/moments/:id`

- [ ] **Step 1: 写失败测试**

`apps/server/tests/moments/moment-list-crud.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chains, media, moments, outbox } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let carol: { id: string; token: string };
let chainId: string;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
  carol = await createUser(app, 'carol');
  chainId = await createChainWithMembers(alice.id, [
    { userId: bob.id, role: 'editor' },
    { userId: carol.id, role: 'viewer' },
  ]);
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 直插 N 条 moment：5 个不同时间戳 × 每个时间戳 5 条（同 happened_at 跨页场景）。 */
async function insertFlatMoments(): Promise<string[]> {
  const ids: string[] = [];
  const base = Date.UTC(2026, 7, 15, 0, 0, 0);
  const rows = [];
  for (let t = 0; t < 5; t++) {
    for (let k = 0; k < 5; k++) {
      const id = randomUUID();
      ids.push(id);
      rows.push({
        id,
        chainId,
        authorId: alice.id,
        type: 'text' as const,
        content: `m-${t}-${k}`,
        happenedAt: new Date(base - t * 3600_000),
        happenedTzOffset: -480,
      });
    }
  }
  await db.insert(moments).values(rows);
  return ids;
}

function authed(token: string) {
  return request.get(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`);
}

describe('GET /api/chains/:chainId/moments（复合游标分页）', () => {
  it('viewer 可读；默认每页 20，按 happened_at DESC, id DESC；返回 nextCursor', async () => {
    await insertFlatMoments();
    const res = await authed(carol.token);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeTruthy();

    // 顺序与 SQL 全量排序一致（防止依赖插入顺序）
    const all = await db
      .select({ id: moments.id })
      .from(moments)
      .orderBy(desc(moments.happenedAt), desc(moments.id));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(
      all.slice(0, 20).map((r) => r.id)
    );
  });

  it('同 happened_at 时间戳跨页不丢不重（limit=7 翻完整 25 条）', async () => {
    const inserted = await insertFlatMoments();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await (cursor
        ? authed(carol.token).query({ limit: 7, cursor })
        : authed(carol.token).query({ limit: 7 }));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(7);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4); // 25 条 / 7 = 3 页整 + 1 页余 4
    expect(new Set(seen).size).toBe(25);
    expect(new Set(seen)).toEqual(new Set(inserted));
  });

  it('响应含 author 摘要与 media（相对 url）；软删 moment 不出现', async () => {
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    storage.headObject.mockResolvedValue({
      size: 1024,
      contentType: 'image/jpeg',
      lastModified: new Date(),
    });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        type: 'media',
        content: '带图',
        happenedAt: '2026-08-15T12:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [presigned.body.mediaId],
      });
    expect(created.status).toBe(201);

    // 另插一条并软删
    const doomed = randomUUID();
    await db.insert(moments).values({
      id: doomed,
      chainId,
      authorId: alice.id,
      type: 'text',
      content: '将删除',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 6)),
      happenedTzOffset: -480,
      deletedAt: new Date(),
    });

    const res = await authed(carol.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(doomed);
    const withMedia = res.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(withMedia.author).toEqual({ id: alice.id, nickname: 'alice' });
    expect(withMedia.media).toHaveLength(1);
    expect(withMedia.media[0].url).toBe(`/api/media/${presigned.body.mediaId}`);
  });

  it('非法 cursor → 400 INVALID_CURSOR；limit 越界 → 400 INVALID_LIMIT；非成员 → 404', async () => {
    expect((await authed(carol.token).query({ cursor: '!!!' })).status).toBe(400);
    expect((await authed(carol.token).query({ limit: '51' })).status).toBe(400);
    expect((await authed(carol.token).query({ limit: '0' })).status).toBe(400);

    const outsider = await createUser(app, 'outsider');
    const res = await authed(outsider.token);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('GET /api/moments/:id', () => {
  it('成员 viewer 可读；非成员 404；软删 410 MOMENT_DELETED', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: alice.id,
      type: 'text',
      content: '详情',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 1)),
      happenedTzOffset: -480,
    });
    expect(
      (await request(app).get(`/api/moments/${id}`).set('Authorization', `Bearer ${carol.token}`)).status
    ).toBe(200);

    const outsider = await createUser(app, 'outsider2');
    expect(
      (await request(app).get(`/api/moments/${id}`).set('Authorization', `Bearer ${outsider.token}`)).status
    ).toBe(404);

    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, id));
    const gone = await request(app)
      .get(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${carol.token}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('PATCH /api/moments/:id', () => {
  it('作者可改 content/happenedAt/isBackfill，媒体不可改', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id, // bob 是 editor，但 PATCH 只看作者本人
      type: 'text',
      content: '原内容',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 2)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ content: '改后', happenedAt: '2026-08-14T09:30:00+08:00', isBackfill: true });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('改后');
    expect(res.body.happenedAt).toBe('2026-08-14T01:30:00.000Z');
    expect(res.body.isBackfill).toBe(true);

    const mediaPatch = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ mediaIds: ['x'] });
    expect(mediaPatch.status).toBe(400); // dto .strict() 将 mediaIds 作为未知键拒绝（VALIDATION_ERROR）
  });

  it('非作者（含 owner）→ 403 NOT_MOMENT_AUTHOR', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: 'bob 的',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 3)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${alice.token}`) // alice 是 owner 但非作者
      .send({ content: '想改别人的' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_MOMENT_AUTHOR');
  });
});

describe('DELETE /api/moments/:id', () => {
  it('作者软删：deleted_at 落库 + outbox(moment.deleted)；随后详情 410', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: '待删',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 4)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(moments).where(eq(moments.id, id));
    expect(row.deletedAt).not.toBeNull();
    const [event] = await db.select().from(outbox);
    expect(event.type).toBe('moment.deleted');
    expect(event.payload).toEqual({ momentId: id, chainId, authorId: bob.id });

    const gone = await request(app)
      .get(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(gone.status).toBe(410);
  });

  it('链 owner 可删他人 moment；非作者且非 owner → 403', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: 'bob 的',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 5)),
      happenedTzOffset: -480,
    });
    const denied = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${carol.token}`); // viewer 非作者
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${alice.token}`); // owner
    expect(ok.status).toBe(204);
  });
});

describe('DELETE /api/chains/:id（Phase 3 级联，兑现 Phase 2 事务锚点）', () => {
  it('链内含 moments 时 owner 删链成功：绑定的 media/moments 级联硬删，未绑定 media 与 outbox 不受影响', async () => {
    // 造一条带 media 的 moment（走真实 presign → complete → create 链路）
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        type: 'media',
        content: '',
        happenedAt: '2026-08-15T12:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [presigned.body.mediaId],
      });
    expect(created.status).toBe(201);
    // 无 media 的 text moment（级联必须覆盖无 media 的行）
    await db.insert(moments).values({
      id: randomUUID(),
      chainId,
      authorId: bob.id,
      type: 'text',
      content: '纯文本',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 7)),
      happenedTzOffset: -480,
    });
    // uploader 名下未绑定的 tmp media：不属任何链，不得被级联误删
    const unboundId = randomUUID();
    await db.insert(media).values({
      id: unboundId,
      momentId: null,
      uploaderId: alice.id,
      s3Key: `tmp/${unboundId}.jpeg`,
      mime: 'image/jpeg',
      size: 512,
      status: 'ready',
      storageMeta: {},
    });

    const res = await request(app)
      .delete(`/api/chains/${chainId}`)
      .set('Authorization', `Bearer ${alice.token}`); // owner
    expect(res.status).toBe(204);
    expect(await db.select().from(moments).where(eq(moments.chainId, chainId))).toHaveLength(0);
    const mediaRows = await db.select().from(media);
    expect(mediaRows.map((r) => r.id)).toEqual([unboundId]); // 绑定的已级联删，未绑定的保留
    expect(await db.select().from(chains).where(eq(chains.id, chainId))).toHaveLength(0);
    // 语义声明：删链不补发 moment.deleted、也不清理既有 outbox 行——
    // pending 的 moment.created 由 Phase 5 worker 按链不存在幂等跳过（见「留给后续 Phase 的接缝」）
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.created', status: 'pending' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- moment-list-crud`
Expected: FAIL（GET 列表 404 / `momentService.list is not a function`；删链级联用例在 `tx.delete(chains)` 处因 FK 1451 抛 500——这正是本 Task 要补的级联缺口）

- [ ] **Step 3: 实现 service 追加方法**

`apps/server/src/moments/moment.service.ts` 追加 import 与方法（import 区在 Task 7 基础上补充）：
```ts
// —— import 区补充（合并进文件顶部既有 import）——
import { and, desc, isNull, lt, or } from 'drizzle-orm'; // eq/inArray 已有，合并为一条
import { BadRequestError, ForbiddenError } from 'routing-controllers'; // HttpError/NotFoundError 已有
import type { MomentListResponse, MomentResponse, PatchMomentInput } from '@moment/dto';
import type { Moment } from '../db/schema.js'; // 与 media/moments/users 合并为一条 schema import
import { OUTBOX_MOMENT_DELETED } from '../outbox/types.js'; // 与 OUTBOX_MOMENT_CREATED 合并
import { decodeCursor, encodeCursor } from './cursor.js';
```
类内追加（`create` 保持不变）：
```ts
  /** 链内时间线：viewer+，happened_at DESC, id DESC 复合游标（同时间戳跨页不丢不重）。 */
  async list(
    userId: string,
    chainId: string,
    query: { cursor?: string; limit?: string }
  ): Promise<MomentListResponse> {
    await this.policy.require(userId, chainId, 'viewer');

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const conditions = [eq(moments.chainId, chainId), isNull(moments.deletedAt)];
    if (query.cursor !== undefined) {
      const cur = decodeCursor(query.cursor);
      if (cur.h === undefined) throw new BadRequestError('INVALID_CURSOR'); // 链内列表只认 happened_at 游标
      const anchor = new Date(cur.h);
      // (happened_at, id) < (cur.h, cur.i)：严格小于锚点，或时间相等但 id 更小
      conditions.push(
        or(lt(moments.happenedAt, anchor), and(eq(moments.happenedAt, anchor), lt(moments.id, cur.i)))!
      );
    }

    const rows = await db
      .select()
      .from(moments)
      .where(and(...conditions))
      .orderBy(desc(moments.happenedAt), desc(moments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.serializeMany(page),
      nextCursor: hasMore && last ? encodeCursor({ h: last.happenedAt.getTime(), i: last.id }) : null,
    };
  }

  /** 详情：service 层反查 chainId 后走 ChainPolicy（CONVENTIONS §3.1）；软删 410。
   * 先鉴权再判软删：非成员对已删/未删一律 404，410 只对有权者暴露（防 id 枚举探测）。 */
  async get(userId: string, momentId: string): Promise<MomentResponse> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    const [serialized] = await this.serializeMany([m]);
    return serialized;
  }

  /** 仅作者本人可改；媒体不可改（dto 层 .strict() 已拒绝 mediaIds/type 等未知键）。鉴权先于软删判断（同 get）。
   * 取舍声明（spec 未定义）：原作者被移出链后成员资格失效，ChainPolicy.require 抛 404，
   * 作者本人也无法再 update 自己的 moment——成员资格优先于作者身份，与读取侧一致。 */
  async update(userId: string, momentId: string, input: PatchMomentInput): Promise<MomentResponse> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    if (m.authorId !== userId) throw new ForbiddenError('NOT_MOMENT_AUTHOR');

    await db
      .update(moments)
      .set({
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.happenedAt !== undefined ? { happenedAt: new Date(input.happenedAt) } : {}),
        ...(input.happenedTzOffset !== undefined ? { happenedTzOffset: input.happenedTzOffset } : {}),
        ...(input.isBackfill !== undefined ? { isBackfill: input.isBackfill } : {}),
        updatedAt: new Date(),
      })
      .where(eq(moments.id, momentId));
    return this.get(userId, momentId);
  }

  /** 软删（幂等）：作者或链 owner；同事务 emitOutbox(moment.deleted)（sweeper 信号）。鉴权先于软删判断（同 get）。
   * 取舍声明（spec 未定义）：同 update——原作者退链后成员资格失效，对自己 moment 的删除亦不可用（404）。 */
  async remove(userId: string, momentId: string): Promise<void> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    const role = await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) return;
    if (role !== 'owner' && m.authorId !== userId) throw new ForbiddenError('NOT_MOMENT_AUTHOR');

    await db.transaction(async (tx) => {
      await tx.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
      await emitOutbox(
        tx,
        OUTBOX_MOMENT_DELETED,
        { momentId, chainId: m.chainId, authorId: m.authorId }
      );
    });
  }

  /** 批量序列化：media 与 author 各一次 IN 查询，禁止 N+1（spec §5.1）。 */
  private async serializeMany(rows: Moment[]): Promise<MomentResponse[]> {
    if (rows.length === 0) return [];
    const mediaRows = await db
      .select()
      .from(media)
      .where(
        inArray(
          media.momentId,
          rows.map((r) => r.id)
        )
      );
    const mediaByMoment = new Map<string, Media[]>();
    for (const m of mediaRows) {
      if (!m.momentId) continue;
      const list = mediaByMoment.get(m.momentId) ?? [];
      list.push(m);
      mediaByMoment.set(m.momentId, list);
    }
    const authorRows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(
        inArray(
          users.id,
          [...new Set(rows.map((r) => r.authorId))]
        )
      );
    const authorById = new Map(authorRows.map((a) => [a.id, a]));
    return rows.map((r) =>
      momentSerializer(
        r,
        mediaByMoment.get(r.id) ?? [],
        authorById.get(r.authorId) ?? { id: r.authorId, nickname: '' }
      )
    );
  }
```

- [ ] **Step 4: ChainService.remove 补 media/moments 级联（兑现 Phase 2 事务注释锚点）**

Phase 2 Global Constraints 与 `ChainService.remove` 的事务注释锚点均写明「Phase 3 在本事务最前面追加 moments/media 级联」。Task 3 建 `moments` 并加 FK（`moments.chain_id → chains.id`、`media.moment_id → moments.id`）后，若不补级联，链内存在 moments 时 owner 删链会在 `tx.delete(chains)` 触发 FK 1451 → 500。本步骤修改 Phase 2 落地的 `apps/server/src/chains/chain.service.ts`：

1) import 区两处补充（合并进既有行，不替换整个 import 块）：
```ts
import { and, desc, eq, inArray } from 'drizzle-orm'; // Phase 2 原为 and, desc, eq，仅追加 inArray
import { chainInvites, chainMembers, chains, media, moments, users, type Chain } from '../db/schema.js'; // Phase 2 原为 { chainInvites, chainMembers, chains, users, type Chain }（路径 ../db/schema.js），仅追加 media, moments
```
（若 Phase 2 的 schema import 写法与上述不同，保持原样、仅追加 `media` 与 `moments` 两个具名导入。）

2) `remove` 方法整体替换为——既有 `policy.require` 与 invites/members/chains 三条删除的顺序保持 Phase 2 原样，仅在**事务最前面**（即 Phase 2 注释锚点所指位置）插入 media/moments 两条删除：
```ts
  /**
   * owner 删链：同事务硬删 media → moments → invites → members → chain。
   * （Phase 3 兑现级联锚点）media.moment_id → moments、moments.chain_id → chains 的外键
   * 要求子表先清：先删绑定在该链 moments 上的 media（未绑定的 tmp media 不属任何链，保留），
   * 再删 moments。
   * 语义取舍：不为级联硬删补发 moment.deleted outbox 事件——链已整体消失，向链成员扇出
   * 「单条 moment 删除」无意义；删链前已入队的 pending moment.created 事件由 Phase 5 worker
   * 按链不存在幂等跳过（接缝声明见本计划末尾）。S3 对象（chains/{chainId}/… 前缀）不在
   * 事务内删除（不可靠且拖长事务），由 Phase 8 lifecycle 按 prefix 清理。
   */
  async remove(userId: string, chainId: string): Promise<void> {
    await this.policy.require(userId, chainId, 'owner');
    await db.transaction(async (tx) => {
      const chainMomentIds = tx
        .select({ id: moments.id })
        .from(moments)
        .where(eq(moments.chainId, chainId));
      await tx.delete(media).where(inArray(media.momentId, chainMomentIds));
      await tx.delete(moments).where(eq(moments.chainId, chainId));
      await tx.delete(chainInvites).where(eq(chainInvites.chainId, chainId));
      await tx.delete(chainMembers).where(eq(chainMembers.chainId, chainId));
      await tx.delete(chains).where(eq(chains.id, chainId));
    });
  }
```
（`tx.delete(media)` 触发 `users.avatar_media_id`/`chains.cover_media_id` 的 `ON DELETE SET NULL` 自动置空引用列，无需手工处理；drizzle 的 `inArray` 接受上述 select 子查询。）

- [ ] **Step 5: 实现 controller 追加**

`apps/server/src/moments/moment.controller.ts` 追加 import 与第二个 controller 类（import 区在 Task 7 基础上补充 `Get / Delete / Patch / HttpCode / OnUndefined / patchMomentInputSchema / MomentListResponse`）：
```ts
// —— import 区补充（合并进文件顶部既有 import）——
import { patchMomentInputSchema, type MomentListResponse } from '@moment/dto';
import { Delete, Get, HttpCode, OnUndefined, Patch } from 'routing-controllers';
```
`MomentController` 类内追加列表方法：
```ts
  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(
    @Param('chainId') chainId: string,
    @QueryParam('cursor') cursor: string | undefined,
    @QueryParam('limit') limit: string | undefined,
    @CurrentUser() user: UserProfile
  ): Promise<MomentListResponse> {
    return this.momentService.list(user.id, chainId, { cursor, limit });
  }
```
（`QueryParam` 同样需要补进 routing-controllers import。）
文件末尾追加按资源 id 的控制器：
```ts
/** 按资源 id 反查链的读/写接口：service 层调 ChainPolicy.require（CONVENTIONS §3.1） */
@JsonController('/moments')
@Service()
export class MomentItemController {
  constructor(private readonly momentService: MomentService) {}

  @Get('/:id')
  @Authorized()
  get(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<MomentResponse> {
    return this.momentService.get(user.id, id);
  }

  @Patch('/:id')
  @Authorized()
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MomentResponse> {
    return this.momentService.update(user.id, id, patchMomentInputSchema.parse(body));
  }

  @Delete('/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.momentService.remove(user.id, id);
  }
}
```
`apps/server/src/app.ts` 的 controllers 数组追加 `MomentItemController`（基线为 Task 7 收尾后的数组 `[HealthController, AuthController, ChainsController, InvitesController, MediaController, MomentController]`）：
```ts
    controllers: [HealthController, AuthController, ChainsController, InvitesController, MediaController, MomentController, MomentItemController],
```
（仅追加 `MomentItemController` 一项，严禁照抄示例时丢掉既有项。）
import 区相应补充：
```ts
import { MomentController, MomentItemController } from './moments/moment.controller.js';
```
（Task 7 已注册的 `MomentController` import 行改为上面这条具名双导出形式。）

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: moment-list-crud 10 个用例 PASS（列表 4 + 详情 1 + PATCH 2 + DELETE 2 + 删链级联 1）；全部既有测试保持 PASS（含 Phase 2 的 chains 套件——`remove` 级联只增删表，不改既有行为）。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/moments apps/server/src/chains apps/server/src/app.ts apps/server/tests/moments
git commit -m "feat(server): moments 列表复合游标分页与详情/PATCH/DELETE（软删+outbox）+ 删链级联"
```

---

### Task 9: S3 真实桶 smoke（RUN_S3_IT=1，默认跳过）+ 全量验证收尾

**Files:**
- Test: `apps/server/tests/storage/s3-it.test.ts`
- Modify: `apps/server/.env.example`（文档化 RUN_S3_IT）

**Interfaces:**
- Produces: 默认跳过、`RUN_S3_IT=1` 时针对真实桶的 adapter 全链路 smoke（单 PUT / presign / head / copy / 预签名 GET / multipart 合片），作为换桶/换 endpoint 后的一次性验证工具。

- [ ] **Step 1: 写 smoke 测试（默认 skip，不进 TDD 失败→实现循环——它测的是 Task 2 已实现的 adapter）**

`apps/server/tests/storage/s3-it.test.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { getStorage, currentStorageMeta } from '../../src/storage/factory.js';
import { alignedGetPresign } from '../../src/media/presign-ttl.js';

// CONVENTIONS §3.3：默认跳过，严禁默认测试依赖外部桶状态。
// 运行方式：在 .env 配好真实桶凭据后 `RUN_S3_IT=1 pnpm --filter @moment/server test -- s3-it`
const d = process.env.RUN_S3_IT === '1' ? describe : describe.skip;

d('S3 真实桶 smoke（RUN_S3_IT=1）', () => {
  const storage = getStorage();

  it('单 PUT：presignPut → 直传 → head 校验 → copy → 预签名 GET 可读 → 清理', async () => {
    const src = `tmp/smoke-${randomUUID()}.png`;
    const dest = `chains/smoke-chain/smoke-moment/${randomUUID()}.png`;
    const png = Buffer.from('moment-s3-smoke-fake-png-bytes', 'utf8');

    const putUrl = await storage.presignPut(src, { contentType: 'image/png' }, 900);
    const put = await fetch(putUrl, {
      method: 'PUT',
      body: new Uint8Array(png),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status).toBe(200);

    const head = await storage.headObject(src);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(png.length);
    expect(head!.contentType).toBe('image/png');

    await storage.copyObject(src, dest);
    expect(await storage.fileExists(dest)).toBe(true);

    // 与生产路径（resolveAccessUrl）同参：整点对齐的 signingDate + TTL+3600，而非裸 60s
    const { signingDate, expiresIn } = alignedGetPresign();
    const access = await storage.generateAccessUrl(dest, currentStorageMeta(), expiresIn, signingDate);
    const got = await fetch(access);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).length).toBe(png.length);

    await storage.deleteFile(src);
    await storage.deleteFile(dest);
    expect(await storage.fileExists(dest)).toBe(false);
  });

  it('multipart：init → part 预签名直传 → complete → head → abort 不残留', async () => {
    const key = `tmp/smoke-mp-${randomUUID()}.bin`;
    const body = Buffer.from('moment-s3-smoke-part-1', 'utf8');

    const uploadId = await storage.initMultipart(key, { contentType: 'application/octet-stream' });
    const partUrl = await storage.presignPart(key, uploadId, 1, 900);
    const put = await fetch(partUrl, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();

    await storage.completeMultipart(key, uploadId, [{ partNumber: 1, etag: etag! }]);
    const head = await storage.headObject(key);
    expect(head?.size).toBe(body.length);

    await storage.deleteFile(key);
  });

  it('abort 路径：init 后直接 abort，不产生对象', async () => {
    const key = `tmp/smoke-abort-${randomUUID()}.bin`;
    const uploadId = await storage.initMultipart(key, { contentType: 'application/octet-stream' });
    await storage.abortMultipart(key, uploadId);
    expect(await storage.fileExists(key)).toBe(false);
  });
});
```

`apps/server/.env.example` 末尾追加说明：
```dotenv

# 设为 1 时跑 S3 真实桶 smoke 测试（tests/storage/s3-it.test.ts）；默认跳过
RUN_S3_IT=0
```
（注意：`RUN_S3_IT` 不进 `config.ts`——它只被测试读取，不是运行时配置。）

- [ ] **Step 2: 默认运行确认跳过**

Run: `pnpm --filter @moment/server test -- s3-it`
Expected: 输出 3 个 skipped；不触网、不失败。

- [ ] **Step 3:（可选，需真实桶凭据）真实桶验证**

Run: `RUN_S3_IT=1 pnpm --filter @moment/server test -- s3-it`
Expected: 3 个 smoke PASS。若当前环境无真实桶凭据则跳过本步，在 PR 描述注明「待有桶环境补跑」。

- [ ] **Step 4: 全量验证**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、全部测试 PASS（s3-it skipped）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/storage/s3-it.test.ts apps/server/.env.example
git commit -m "test(server): S3 真实桶 smoke（RUN_S3_IT=1 门控）"
```

---

## 完成标准（Phase 3 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿（s3-it 默认 skipped）。
- 手动 curl 验证（dev 环境 + 真实桶）：
  1. `POST /api/media/presign`（image）→ 用返回 URL `curl -X PUT --data-binary @a.jpg -H 'Content-Type: image/jpeg' '<url>'` → `POST /api/media/:id/complete` → 200 ready；
  2. `POST /api/chains/:chainId/moments`（type=media, mediaIds=[...]）→ 201，媒体 s3_key 已变为 `chains/{chainId}/{momentId}/...`；
  3. `GET /api/media/:id` → 302 且 `curl -L` 能取回图片字节；同一小时窗内重复请求 302 目标一致；
  4. `GET /api/chains/:chainId/moments?limit=5` 翻页至 nextCursor=null，无丢失。
- 数据库存在 `media`、`moments`、`outbox` 三表，且 `users.avatar_media_id` 列与两处 media FK（users/chains）就位（兑现 Phase 1/Phase 2 的迁移承诺）；moment 创建/软删在 outbox 各留一条 pending 事件（Phase 5 worker 消费）。
- 视频 multipart 手动验证（可选，真实桶）：presign(kind=video) → parts → 逐 part PUT → complete 200。

## 留给后续 Phase 的接缝（不在本计划实现）

- Phase 4：feed 聚合复用 `decodeCursor/encodeCursor` 与 `momentSerializer`（`order=created_at` 的 `{c,i}` 游标已预留）。注意：CONVENTIONS §3.4 标注的「（Phase 4 建立，Phase 5 扩展）」实际提前至 Phase 3——cursor 与 serializer 均在本计划建立，Phase 4 只消费与扩展，不重复建设。
- Phase 5：outbox worker 消费 `moment.created/moment.deleted`；serializer 上加批量计数。**容错要求（Phase 3 Task 8 删链级联的接缝）**：链被硬删后，其已入队的 pending `moment.created` 事件不会被动过（删链不清理 outbox、不补发 `moment.deleted`）——worker 处理时必须按「链/成员已不存在」幂等跳过而非报错重试。
- 头像/封面的**业务 API**（上传头像、owner 改链封面）：本计划只落了 `users.avatar_media_id` 列与 `chains.cover_media_id` 的 FK（schema 层兑现 Phase 1/Phase 2 迁移承诺），读写端点未建——由首个需要该功能的 Phase（客户端头像/链封面设置）补，消费 `POST /api/media/presign` + complete + 绑定更新即可。
- Phase 8：`GET /api/media/:id?st=` 的 share token 免登录校验（当前 403 SHARE_NOT_SUPPORTED）；`tmp/` lifecycle 与 uploading 超 24h 的 sweeper——sweeper 注意：`status='ready'` 且未绑定的 media 的 tmp 对象是合法中间态（copy 推迟到发布事务，见 Global Constraints 偏离声明），只能按 24h 超时清理，不得按「complete 后即应已搬走」清掉；`media.width/height/duration` 的客户端元数据回填若需要，走 PATCH 扩展。**另**：删链级联（Task 8）只删 DB 行，`chains/{chainId}/…` 前缀的 S3 对象成为无主孤儿，由 Phase 8 lifecycle 按 prefix 兜底清理（本计划不做事务内 S3 删除，见 Task 8 Step 4 的取舍声明）。

