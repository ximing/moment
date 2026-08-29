# 融合检索 P3：compress worker + variant=derived + serializer derivedUrl 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的派生图管线：`handleMomentCompress`（sharp 等比 512 WebP 75）+ create 同事务对静态可压图（含 poster 行）emit `moment.compress`；`GET /api/media/:id?variant=original|derived`（缺省 original，derived 未 ready → 404 `DERIVED_NOT_READY`）；`serializeMoments` / `momentSerializer` 填 `derivedUrl` / `posterDerivedUrl`（仅 `derived_status=ready`；不内嵌预签名）。

**Architecture:** 可压判定与派生 key 是纯函数（create 发射与 handler 共用，禁止两处各写一份 mime 清单）。压缩是 worker 独占的原图像素例外（`getObject(s3_key, storageMeta, MAX_IMAGE_BYTES)`）；请求线程只签 URL，零读像素。Handler **禁止**自写 `outbox.status`：终败把媒体行写成 `derived_status=failed` 后 throw `NonRetryableCompressError`（`error.name` 钉死该字符串），由 P1 processor 立即 `failed` + `last_error`。`handleMomentCompress` 不从 `handlers.ts` import 类型（ESM 环）；声明可选第二参以对齐 processor 双参调用。本计划 **不** emit `moment.embed`、不实现 embed handler / `computeEmbedHash` / DashScope data URI（P5 在本 handler 末尾再接）。

**Tech Stack:** `sharp`（`rotate` + `resize` fit inside 512 `withoutEnlargement` + `webp` quality 75；linuxmusl 预编译，现 alpine 镜像可跑测试）/ jest `--runInBand` + 真实 MySQL 测试库 / `installMockStorage`（P1 已含 `getObject`）/ routing-controllers `QueryParam` + dto `mediaVariantSchema` / drizzle 更新 `media.derived_*`。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§0 派生图规则与 GIF/HEIC/HEIF、§2.1 列语义与 MomentMedia URL、§2.3 handler 不改 outbox.status / NonRetryableCompressError、§4.2 compress handler、§6.5 媒体派生 GET、§6.6 `DERIVED_NOT_READY`、§8 仅 compress 读原图、§9 compress/derivedUrl 测试、§11 P3 出口）

**上游契约:** `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`（执行时假设 P1 已在本分支落地：派生六列、`OUTBOX_MOMENT_COMPRESS` + `MomentCompressPayload`、`getObject` / `ObjectTooLargeError`、processor 按 `error.name === 'NonRetryableCompressError'` 立即 failed、`MomentMedia.derivedUrl?`/`posterDerivedUrl?` 可选）。P2 标量过滤与本计划正交，不依赖。

## Global Constraints

- 冻结名逐字不得改：`handleMomentCompress` / `NonRetryableCompressError`（`error.name` 必须是该字符串）/ `isCompressibleMime` / `derivedObjectKey` / `compressToDerivedWebp` / `OUTBOX_MOMENT_COMPRESS = 'moment.compress'` / payload `{ momentId, chainId, mediaId }` / `GET /api/media/:id?variant=original|derived` / `DERIVED_NOT_READY` / `MomentMedia.derivedUrl` / `MomentMedia.posterDerivedUrl` / 派生 key `chains/{chainId}/{momentId}/{mediaId}.derived.webp` / `derived_status` 四态 `pending|ready|skipped|failed`。
- **GIF / HEIC / HEIF：不压。** `derived_status` 保持 **NULL**（不是 `skipped`）；create **不 emit** compress；handler 若误收到也不 `getObject`、不改 `derived_*`。`skipped` **只**用于「压了但输出字节 ≥ 原 `size`」。
- **可压图含 poster 行**（独立 image 行）。视频/音频行恒 NULL，不 emit。
- Handler **不得** `update outbox.status`。终败：先写 `derived_status=failed`，再 throw `NonRetryableCompressError`。可重试错误（存储/网络）原样 throw，走 P1 五档退避。
- 媒体稳定入口仍是 `/api/media/:id`（只追加 query `variant`）。Serializer **不得**内嵌预签名 URL。
- 请求线程零读像素：`GET /api/media` 与 feed/list 序列化只走 `generateAccessUrl`；**禁止** controller / serializer / extract 调 `getObject`。唯一原图 `getObject` 在 `handleMomentCompress`。
- **不**实现 `handleMomentEmbed` / `computeEmbedHash` / DashScope / `data:image` URI。compress 终态 **不** emit `moment.embed`（P5）。**不**改 Dockerfile / compose / nginx（bookworm 属 P4）。**不**写 backfill（存量 NULL 派生属 P10）。
- 无新环境变量：不改 `config.ts` / `.env` / `.env.example`。
- CONVENTIONS §3 只追加：不改 `ChainPolicy` / feed `{h,i}`/`{c,i}` / 既有存储方法名 / 既有 outbox 列。`uploadFile(key, buffer)` 现网签名无 meta（spec §4.2）。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已追加 `getObject` 与 `variant` query；本计划只实现 query 行为）。
- server 测试打 `.env` 指向的测试库：`pnpm --filter @moment/server test -- <file>`（脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)` + `beforeEach(resetDb)`。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **compress 终态不 emit `moment.embed`**：spec §4.2 步骤 7 把 embed 接在「该时刻可压图全部终态」。`computeEmbedHash` / embed handler / embedding env 属 P5；本计划若 emit embed，P1 processor 会对未注册 type 立即 `NO_HANDLER`。P5 在 `handleMomentCompress` 成功路径末尾按 spec 步骤 7 补 emit。P3 出口是 derived 列终态 + 可压图 ready，供后续嵌。
2. **Dockerfile alpine→bookworm 属 P4**（spec §11 / spec-review）。P3 用 sharp 的 linuxmusl 预编译在现镜像跑测试。
3. **`MomentMedia.derivedUrl` / `posterDerivedUrl` 本计划收口为必填 `string | null`**（兑现 P1 偏差 1）。web 测试里 typed `MomentMedia` 字面量机械补 `derivedUrl: null, posterDerivedUrl: null`。**不**改 `MediaBlock` / `useMediaObjectUrl` / 不抽 `mediaUrl` helper（P8）。
4. **`mediaVariantSchema` 放 `packages/dto/src/media.ts`**：spec 未指定文件；GET 非法 variant 必须 400 `VALIDATION_ERROR`，P8 `fetchMediaBlob` 复用同一 enum，避免再抄。
5. **派生 key 的 `chainId` 取重读的 `moments.chainId`，不消费 payload.chainId**：payload 仍按 P1 形状写入（jobs P7 滤链）；对齐 people-place geocode「坐标以行为准」。
6. **缺 `variant` query → original；`variant=` 空串或其它值 → 400 `VALIDATION_ERROR`**：spec「缺省 original / 其它值 400」。空串不是缺省。
7. **存量 `derived_status IS NULL` 的回填 compress 属 P10**，本计划只在 **create** 路径增量 emit。PATCH 不能改 `mediaIds`，update **不**发 compress（spec §4.2）。
8. **`MediaLike.derivedStatus` / `posterDerivedStatus` 可选**：省略视为非 ready（URL 出 null）。既有 `moment-serializer.test.ts` 字面量不必全改；`serializeMoments` 组装时必填这两字段。

---

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/src/media/derived.ts` | `isCompressibleMime` / `derivedObjectKey` / 非可压 mime 常量 |
| `apps/server/src/media/compress.ts` | `NonRetryableCompressError` / `compressToDerivedWebp` / 512 + WebP75 常量 |
| `apps/server/src/media/handle-moment-compress.ts` | `handleMomentCompress` |
| `apps/server/src/worker/handlers.ts` | 注册 `'moment.compress'` |
| `apps/server/src/moments/moment.service.ts` | create：可压图 `pending` + emit compress（含 poster） |
| `apps/server/tests/moments/moment-list-crud.test.ts` | JPEG create 全表 outbox 计数 2→3（含 compress） |
| `apps/server/src/media/media.controller.ts` | 解析 `variant` |
| `apps/server/src/media/media.service.ts` | `resolveAccessUrl` 第四参；derived 签 `derived_s3_key` |
| `apps/server/src/moments/moment-serializer.ts` | `derivedUrl` / `posterDerivedUrl` |
| `packages/dto/src/media.ts` | `mediaVariantSchema` |
| `packages/dto/src/moments.ts` | 两 URL 必填化 |
| `apps/server/package.json` + lockfile | `sharp` |
| web 四处 `MomentMedia` 测试夹具 | 机械补 null 字段 |

**本计划明确不改：** `src/feed/cursor.ts`、`chain-policy.ts`、Dockerfile、compose、nginx、`config.ts`、`.env*`、Lance/BA、`getEmbeddingProvider`、`computeEmbedHash`、handlers 里 embed、`POST /api/search`、jobs 路由、api-client、`MediaBlock.tsx` / `useMediaObjectUrl`、app、`scripts/backfill-*.ts`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: 可压判定 + 派生 key + sharp WebP + `NonRetryableCompressError`

**Files:**
- Create: `apps/server/src/media/derived.ts`
- Create: `apps/server/src/media/compress.ts`
- Test: `apps/server/tests/media/derived.test.ts`
- Test: `apps/server/tests/media/compress-webp.test.ts`
- Modify: `apps/server/package.json`（`pnpm --filter @moment/server add sharp`，会改 lockfile）

**Interfaces:**
- Consumes: 无 DB。P1 不改这些文件。`sharp` 本 Task 新增。
- Produces（Task 2–3 消费）:
  - `NON_COMPRESSIBLE_IMAGE_MIMES = ['image/gif', 'image/heic', 'image/heif'] as const`
  - `isCompressibleMime(mime: string): boolean` — `mime` 小写后以 `image/` 开头且不在上表
  - `derivedObjectKey(chainId: string, momentId: string, mediaId: string): string` — 精确 `` `chains/${chainId}/${momentId}/${mediaId}.derived.webp` ``（相对 key，无 prefix）
  - `DERIVED_MAX_EDGE = 512`
  - `DERIVED_WEBP_QUALITY = 75`
  - `DERIVED_MIME = 'image/webp'`
  - `class NonRetryableCompressError extends Error` — 构造里 `this.name = 'NonRetryableCompressError'`（P1 processor 按 **name 字符串** 认，不得只靠 instanceof）
  - `compressToDerivedWebp(buf: Buffer): Promise<{ buffer: Buffer; width: number; height: number }>` — 管道必须是 `sharp(buf).rotate().resize({ width:512, height:512, fit:'inside', withoutEnlargement:true }).webp({ quality:75 }).toBuffer({ resolveWithObject: true })`；解码失败 throw `NonRetryableCompressError`（`message === 'SHARP_DECODE_FAILED'`）

- [ ] **Step 1: 写失败测试 — derived**

Create `apps/server/tests/media/derived.test.ts`（纯单测，不触库）：
```ts
import {
  NON_COMPRESSIBLE_IMAGE_MIMES,
  derivedObjectKey,
  isCompressibleMime,
} from '../../src/media/derived.js';

describe('isCompressibleMime（spec fused-retrieval §2.1 / §0）', () => {
  it('jpeg/png/webp 可压', () => {
    expect(isCompressibleMime('image/jpeg')).toBe(true);
    expect(isCompressibleMime('image/png')).toBe(true);
    expect(isCompressibleMime('image/webp')).toBe(true);
    expect(isCompressibleMime('IMAGE/JPEG')).toBe(true);
  });

  it('GIF/HEIC/HEIF 不可压（不是 skipped）', () => {
    expect([...NON_COMPRESSIBLE_IMAGE_MIMES].sort()).toEqual(['image/gif', 'image/heic', 'image/heif']);
    expect(isCompressibleMime('image/gif')).toBe(false);
    expect(isCompressibleMime('image/heic')).toBe(false);
    expect(isCompressibleMime('image/heif')).toBe(false);
    expect(isCompressibleMime('image/GIF')).toBe(false);
  });

  it('音频/视频/非图不可压', () => {
    expect(isCompressibleMime('video/mp4')).toBe(false);
    expect(isCompressibleMime('audio/wav')).toBe(false);
    expect(isCompressibleMime('application/octet-stream')).toBe(false);
    expect(isCompressibleMime('')).toBe(false);
  });
});

describe('derivedObjectKey（spec §2.1）', () => {
  it('相对 key：chains/{chainId}/{momentId}/{mediaId}.derived.webp', () => {
    expect(derivedObjectKey('c1', 'm1', 'md1')).toBe('chains/c1/m1/md1.derived.webp');
  });
});
```

- [ ] **Step 2: 写失败测试 — compress-webp**

Create `apps/server/tests/media/compress-webp.test.ts`（纯单测，不触库；输入 JPEG 用 sharp 现造）：
```ts
import sharp from 'sharp';
import {
  DERIVED_MAX_EDGE,
  DERIVED_MIME,
  DERIVED_WEBP_QUALITY,
  NonRetryableCompressError,
  compressToDerivedWebp,
} from '../../src/media/compress.js';

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('NonRetryableCompressError', () => {
  it('name 钉死字符串（P1 processor 只认 error.name）', () => {
    const err = new NonRetryableCompressError('SHARP_DECODE_FAILED');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NonRetryableCompressError');
    expect(err.message).toBe('SHARP_DECODE_FAILED');
  });
});

describe('compressToDerivedWebp（spec §0 / §4.2：最长边 512、WebP 75、不放大）', () => {
  it('常量锁定', () => {
    expect(DERIVED_MAX_EDGE).toBe(512);
    expect(DERIVED_WEBP_QUALITY).toBe(75);
    expect(DERIVED_MIME).toBe('image/webp');
  });

  it('2000×1000 JPEG → webp，最长边 512（512×256），不读原图像素出域以外的副作用', async () => {
    const out = await compressToDerivedWebp(await jpegOf(2000, 1000));
    expect(out.width).toBe(512);
    expect(out.height).toBe(256);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(256);
  });

  it('withoutEnlargement：64×48 不放大', async () => {
    const out = await compressToDerivedWebp(await jpegOf(64, 48));
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
  });

  it('损坏字节 → NonRetryableCompressError SHARP_DECODE_FAILED', async () => {
    await expect(compressToDerivedWebp(Buffer.from('not-an-image'))).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'SHARP_DECODE_FAILED',
    });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/media/derived.test.ts`
Expected: FAIL，`Cannot find module '../../src/media/derived.js'`。

- [ ] **Step 4: 加 sharp 依赖**

Run: `pnpm --filter @moment/server add sharp`

`apps/server/package.json` `dependencies` 必须出现 `"sharp"`。接受 lockfile 解析到的 ^0.33 或 ^0.34（有 linuxmusl 预编译即可）。**不要**手改 Dockerfile。

- [ ] **Step 5: 实现 derived.ts**

Create `apps/server/src/media/derived.ts`：
```ts
/** spec fused-retrieval §2.1：这三种静态图不压，derived_status 恒 NULL。 */
export const NON_COMPRESSIBLE_IMAGE_MIMES = ['image/gif', 'image/heic', 'image/heif'] as const;

const SKIP = new Set<string>(NON_COMPRESSIBLE_IMAGE_MIMES);

/** 静态可压图 = image/* 且不是 GIF/HEIC/HEIF。音频/视频 false。 */
export function isCompressibleMime(mime: string): boolean {
  const normalized = mime.toLowerCase();
  return normalized.startsWith('image/') && !SKIP.has(normalized);
}

/** 派生对象相对 key（spec §2.1）。无 bucket prefix。 */
export function derivedObjectKey(chainId: string, momentId: string, mediaId: string): string {
  return `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
}
```

- [ ] **Step 6: 实现 compress.ts**

Create `apps/server/src/media/compress.ts`：
```ts
import sharp from 'sharp';

export const DERIVED_MAX_EDGE = 512;
export const DERIVED_WEBP_QUALITY = 75;
export const DERIVED_MIME = 'image/webp';

/**
 * compress 终败（spec §2.3）。processor 只认 error.name === 'NonRetryableCompressError'。
 * handler 禁止自写 outbox.status。
 */
export class NonRetryableCompressError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableCompressError';
  }
}

export async function compressToDerivedWebp(
  buf: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({
        width: DERIVED_MAX_EDGE,
        height: DERIVED_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: DERIVED_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof NonRetryableCompressError) throw err;
    throw new NonRetryableCompressError('SHARP_DECODE_FAILED', err);
  }
}
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/media/derived.test.ts tests/media/compress-webp.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/media/derived.ts apps/server/src/media/compress.ts \
  apps/server/tests/media/derived.test.ts apps/server/tests/media/compress-webp.test.ts \
  apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add derived mime gate, webp compress, and NonRetryableCompressError"
```

---

### Task 2: `handleMomentCompress` + 注册表

**Files:**
- Create: `apps/server/src/media/handle-moment-compress.ts`
- Modify: `apps/server/src/worker/handlers.ts`（import + `handlers` 登记 `'moment.compress'`）
- Test: `apps/server/tests/worker/handle-moment-compress.test.ts`
- Modify: `apps/server/tests/worker/handlers.test.ts`（九种事件 + 新键）

**Interfaces:**
- Consumes:
  - Task 1：`isCompressibleMime` / `derivedObjectKey` / `compressToDerivedWebp` / `NonRetryableCompressError` / `DERIVED_MIME`
  - P1：`getObject(key, metadata, maxBytes)`、`ObjectTooLargeError`（`name === 'ObjectTooLargeError'`）、`MAX_IMAGE_BYTES`、`installMockStorage().getObject`（默认空 Buffer）、`runOutboxBatch` 立即失败、`MomentCompressPayload`
  - `OutboxHandler` 形状（`(payload, deps: { push }) => Promise<void>`）。**禁止**从 `handlers.ts` import 该类型——`handlers.ts` 要 import 本 handler，会成 ESM 环。第二参 `_deps?` 只为与 geocode 测试/processor 双参调用对齐（**不读** push）；少写第二参也能赋给 `OutboxHandler`，但本文件测试会双参调用，`tsc` 含 `tests/`，必须声明第二参。
  - `getStorage()` / `uploadFile(key, buffer)`
  - `media` / `moments` / `outbox` schema（P1 派生列）
- Produces:
  - `handleMomentCompress(payload: Record<string, unknown>, _deps?: { push: unknown }): Promise<void>`（`apps/server/src/media/handle-moment-compress.ts`；可赋给 `OutboxHandler`）
  - `handlers['moment.compress'] === handleMomentCompress`
  - 行为（spec §4.2，**无步骤 7 embed**）：
    1. payload.mediaId 空 / media 不存在 / `momentId` 空 / moment 不存在或已软删 → return（outbox 由 processor 标 done）
    2. `!isCompressibleMime(mime)` → return，**不** `getObject`，**不改** `derived_*`
    3. `getObject(s3Key, storageMeta, MAX_IMAGE_BYTES)`。`error.name === 'ObjectTooLargeError'` → 写 `derived_status=failed`，throw `NonRetryableCompressError('OBJECT_TOO_LARGE')`
    4. `compressToDerivedWebp`；`NonRetryableCompressError` → 先 failed 再原样 throw
    5. `out.buffer.length >= row.size` → `derived_status=skipped`，其余派生列 NULL，**不** `uploadFile`
    6. 否则 `uploadFile(derivedObjectKey(moment.chainId, moment.id, media.id), buffer)`，写 ready + 五列（mime=`image/webp`）
    7. 存储等可重试错误不 catch。**任何路径不 update `outbox` 表**

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/handle-moment-compress.test.ts`：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { handleMomentCompress } from '../../src/media/handle-moment-compress.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { ObjectTooLargeError } from '../../src/storage/bounded-read.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handlers } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

let storage: MockStorage;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function seed(opts?: {
  mime?: string;
  size?: number;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  deletedAt?: Date | null;
  momentId?: string | null;
}): Promise<{ mediaId: string; momentId: string; chainId: string; s3Key: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId =
    opts?.momentId === null
      ? null
      : await insertMoment({
          chainId,
          authorId: owner.id,
          happenedAt: new Date('2026-08-29T00:00:00Z'),
          deletedAt: opts?.deletedAt ?? undefined,
        });
  const mediaId = randomUUID();
  const s3Key = momentId
    ? `chains/${chainId}/${momentId}/${mediaId}.jpeg`
    : `tmp/${mediaId}.jpeg`;
  await db.insert(media).values({
    id: mediaId,
    momentId,
    uploaderId: owner.id,
    s3Key,
    mime: opts?.mime ?? 'image/jpeg',
    size: opts?.size ?? 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts?.derivedStatus === undefined ? 'pending' : opts.derivedStatus,
  });
  return { mediaId, momentId: momentId ?? '', chainId, s3Key };
}

async function derivedCols(mediaId: string) {
  const [row] = await db
    .select({
      derivedS3Key: media.derivedS3Key,
      derivedMime: media.derivedMime,
      derivedSize: media.derivedSize,
      derivedWidth: media.derivedWidth,
      derivedHeight: media.derivedHeight,
      derivedStatus: media.derivedStatus,
    })
    .from(media)
    .where(eq(media.id, mediaId));
  return row;
}

describe('handleMomentCompress（spec fused-retrieval §4.2）', () => {
  it('JPEG fixture → ready，边 ≤512，mime webp，upload 派生 key，getObject 读原图 s3Key', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId, s3Key } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });

    expect(storage.getObject).toHaveBeenCalledWith(s3Key, TEST_META, MAX_IMAGE_BYTES);
    const key = derivedObjectKey(chainId, momentId, mediaId);
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    expect(storage.uploadFile.mock.calls[0]![0]).toBe(key);
    const uploaded = storage.uploadFile.mock.calls[0]![1] as Buffer;
    expect(uploaded.length).toBeLessThan(jpeg.length);
    const row = await derivedCols(mediaId);
    expect(row.derivedStatus).toBe('ready');
    expect(row.derivedS3Key).toBe(key);
    expect(row.derivedMime).toBe('image/webp');
    expect(row.derivedSize).toBe(uploaded.length);
    expect(row.derivedWidth).toBe(512);
    expect(row.derivedHeight).toBe(256);
  });

  it('派生 key 用重读的 moments.chainId，不消费 payload.chainId', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress(
      { momentId, chainId: 'payload-chain-mismatch', mediaId },
      { push: mockPush },
    );
    expect(storage.uploadFile.mock.calls[0]![0]).toBe(derivedObjectKey(chainId, momentId, mediaId));
  });

  it('输出 length ≥ 原 size → skipped，不 upload，派生其余列 NULL', async () => {
    const jpeg = await jpegOf(64, 48);
    const { mediaId, momentId, chainId } = await seed({ size: 1 });
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });

    expect(storage.uploadFile).not.toHaveBeenCalled();
    const row = await derivedCols(mediaId);
    expect(row.derivedStatus).toBe('skipped');
    expect(row.derivedS3Key).toBeNull();
    expect(row.derivedMime).toBeNull();
    expect(row.derivedSize).toBeNull();
    expect(row.derivedWidth).toBeNull();
    expect(row.derivedHeight).toBeNull();
  });

  it('GIF：不 getObject，derived_status 仍 NULL（不是 skipped）', async () => {
    const { mediaId, momentId, chainId } = await seed({ mime: 'image/gif', derivedStatus: null });
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
  });

  it('HEIC/HEIF：不 getObject，derived_status 仍 NULL', async () => {
    for (const mime of ['image/heic', 'image/heif'] as const) {
      const { mediaId, momentId, chainId } = await seed({ mime, derivedStatus: null });
      await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
      expect(storage.getObject).not.toHaveBeenCalled();
      expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
    }
  });

  it('视频行：不 getObject', async () => {
    const { mediaId, momentId, chainId } = await seed({ mime: 'video/mp4', derivedStatus: null });
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBeNull();
  });

  it('poster 行（独立 image）可压 → ready', async () => {
    const jpeg = await jpegOf(800, 800);
    const { mediaId, momentId, chainId, s3Key } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.getObject).toHaveBeenCalledWith(s3Key, TEST_META, MAX_IMAGE_BYTES);
    expect((await derivedCols(mediaId)).derivedStatus).toBe('ready');
  });

  it('media 不存在 / 无 moment / 时刻已软删 → 跳过，不 getObject', async () => {
    await expect(
      handleMomentCompress(
        { momentId: randomUUID(), chainId: randomUUID(), mediaId: randomUUID() },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    const unbound = await seed({ momentId: null, derivedStatus: null });
    await expect(
      handleMomentCompress(
        { momentId: unbound.momentId, chainId: unbound.chainId, mediaId: unbound.mediaId },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    const deleted = await seed({ deletedAt: new Date() });
    await expect(
      handleMomentCompress(
        { momentId: deleted.momentId, chainId: deleted.chainId, mediaId: deleted.mediaId },
        { push: mockPush },
      ),
    ).resolves.toBeUndefined();

    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('ObjectTooLargeError → derived_status=failed，throw NonRetryableCompressError OBJECT_TOO_LARGE；不改 outbox.status', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });

    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'OBJECT_TOO_LARGE',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('pending');
  });

  it('损坏图 → failed + NonRetryableCompressError SHARP_DECODE_FAILED', async () => {
    const { mediaId, momentId, chainId } = await seed();
    storage.getObject.mockResolvedValue(Buffer.from('not-an-image'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
      message: 'SHARP_DECODE_FAILED',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
  });

  it('uploadFile 抛错 → 传播，derived_status 仍 pending（可重试）', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockResolvedValue(jpeg);
    storage.uploadFile.mockRejectedValue(new Error('S3_DOWN'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toThrow('S3_DOWN');
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
  });

  it('processor + 默认 handlers：NonRetryableCompressError 立即 failed + last_error', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });
    const result = await runOutboxBatch({ push: mockPush });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('failed');
    expect(ob.attempts).toBe(1);
    expect(ob.nextRetryAt).toBeNull();
    expect(ob.lastError).toBe('OBJECT_TOO_LARGE');
    expect((await derivedCols(mediaId)).derivedStatus).toBe('failed');
  });

  it('handlers 登记 moment.compress', () => {
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
  });
});
```

Modify `apps/server/tests/worker/handlers.test.ts`：

1. 顶部 import 区追加：
```ts
import { handleMomentCompress } from '../../src/media/handle-moment-compress.js';
```

2. 「八种事件均已注册」整段替换为：
```ts
  it('九种事件均已注册（含 moment.compress）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['recap.generate']).toBe(handleRecapGenerate);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(handlers['moment.geocode']).toBe(handleMomentGeocode);
    expect(handlers['moment.extract']).toBe(handleMomentExtract);
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
    expect(Object.keys(handlers)).toHaveLength(9);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-compress.test.ts`
Expected: FAIL，`Cannot find module '../../src/media/handle-moment-compress.js'`。

- [ ] **Step 3: 实现 handle-moment-compress.ts**

Create `apps/server/src/media/handle-moment-compress.ts`：
```ts
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, moments } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { DERIVED_MIME, NonRetryableCompressError, compressToDerivedWebp } from './compress.js';
import { derivedObjectKey, isCompressibleMime } from './derived.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function markDerivedFailed(mediaId: string): Promise<void> {
  await db
    .update(media)
    .set({
      derivedStatus: 'failed',
      derivedS3Key: null,
      derivedMime: null,
      derivedSize: null,
      derivedWidth: null,
      derivedHeight: null,
    })
    .where(eq(media.id, mediaId));
}

/**
 * moment.compress（spec fused-retrieval §4.2）。
 * 终败写 derived_status=failed 后 throw NonRetryableCompressError；禁止改 outbox.status。
 * 不 emit moment.embed（P5）。
 */
export async function handleMomentCompress(
  payload: Record<string, unknown>,
  _deps?: { push: unknown },
): Promise<void> {
  const mediaId = str(payload.mediaId);
  if (!mediaId) return;

  const [row] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || !row.momentId) return;

  const [m] = await db.select().from(moments).where(eq(moments.id, row.momentId)).limit(1);
  if (!m || m.deletedAt) return;

  if (!isCompressibleMime(row.mime)) return;

  let buf: Buffer;
  try {
    buf = await getStorage().getObject(row.s3Key, row.storageMeta, MAX_IMAGE_BYTES);
  } catch (err) {
    if (err instanceof Error && err.name === 'ObjectTooLargeError') {
      await markDerivedFailed(row.id);
      throw new NonRetryableCompressError('OBJECT_TOO_LARGE', err);
    }
    throw err;
  }

  let out: { buffer: Buffer; width: number; height: number };
  try {
    out = await compressToDerivedWebp(buf);
  } catch (err) {
    if (err instanceof NonRetryableCompressError) {
      await markDerivedFailed(row.id);
    }
    throw err;
  }

  if (out.buffer.length >= row.size) {
    await db
      .update(media)
      .set({
        derivedStatus: 'skipped',
        derivedS3Key: null,
        derivedMime: null,
        derivedSize: null,
        derivedWidth: null,
        derivedHeight: null,
      })
      .where(eq(media.id, row.id));
    return;
  }

  const key = derivedObjectKey(m.chainId, m.id, row.id);
  await getStorage().uploadFile(key, out.buffer);
  await db
    .update(media)
    .set({
      derivedS3Key: key,
      derivedMime: DERIVED_MIME,
      derivedSize: out.buffer.length,
      derivedWidth: out.width,
      derivedHeight: out.height,
      derivedStatus: 'ready',
    })
    .where(eq(media.id, row.id));
}
```

- [ ] **Step 4: 注册 handlers.ts**

Modify `apps/server/src/worker/handlers.ts`：

1. import 区追加：
```ts
import { handleMomentCompress } from '../media/handle-moment-compress.js';
```

2. `export const handlers` 对象在 `'moment.extract': handleMomentExtract,` 之后追加：
```ts
  'moment.compress': handleMomentCompress,
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-compress.test.ts tests/worker/handlers.test.ts tests/media/derived.test.ts tests/media/compress-webp.test.ts`
Expected: PASS。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/media/handle-moment-compress.ts apps/server/src/worker/handlers.ts \
  apps/server/tests/worker/handle-moment-compress.test.ts apps/server/tests/worker/handlers.test.ts
git commit -m "feat(server): handle moment.compress outbox jobs"
```

---

### Task 3: create 同事务 emit `moment.compress`（含 poster；GIF/HEIC 不发）

**Files:**
- Modify: `apps/server/src/moments/moment.service.ts`（import + create 绑定后 pending + emit）
- Test: `apps/server/tests/moments/moment-compress-emit.test.ts`
- Modify: `apps/server/tests/moments/create-voice-moment.test.ts`（全表 outbox 计数：2 张可压图 → 多 2 条 compress）
- Modify: `apps/server/tests/moments/moment-list-crud.test.ts`（删链用例先 **JPEG create** 再直插 text；全表 outbox 2→3）

**Interfaces:**
- Consumes:
  - `isCompressibleMime`（Task 1）
  - P1 `OUTBOX_MOMENT_COMPRESS` / `emitOutbox(tx, type, payload)` / `MomentCompressPayload`
  - 既有 create 事务：media 行锁、tmp→final copy、poster 绑定、`OUTBOX_MOMENT_CREATED` / transcribe / extract / geocode
- Produces:
  - create：对 `mediaRows ∪ posterRow` 中 `isCompressibleMime` 的行，同事务 `derivedStatus='pending'`（其余派生列保持 NULL）+ `emitOutbox(OUTBOX_MOMENT_COMPRESS, { momentId, chainId, mediaId })`（一条媒体一行）
  - GIF/HEIC/HEIF/音视频：**不** pending、**不** emit
  - `update` / PATCH：**不** emit compress（不能改 mediaIds）
  - 无待压图（纯文字 / 仅音频 / 仅视频无封面）不发 compress

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/moment-compress-emit.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, outbox } from '../../src/db/schema.js';
import { OUTBOX_MOMENT_COMPRESS } from '../../src/outbox/types.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let alice: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function readyImage(token: string, mime = 'image/jpeg'): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size: 1024, kind: 'image' });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

async function insertReadyVideo(uploaderId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.mp4`,
    mime: 'video/mp4',
    size: 1024,
    status: 'ready',
    storageMeta: {},
  });
  return id;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

async function compressRows() {
  return db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));
}

describe('create emit moment.compress（spec fused-retrieval §4.2）', () => {
  it('JPEG：derived_status=pending，outbox payload camelCase {momentId,chainId,mediaId}', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.derivedStatus).toBe('pending');
    expect(row.derivedS3Key).toBeNull();
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ momentId: res.body.id, chainId, mediaId: imageId });
    expect(jobs[0].status).toBe('pending');
  });

  it('两张 JPEG → 两行 compress；PNG 同样可压', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const a = await readyImage(alice.token, 'image/jpeg');
    const b = await readyImage(alice.token, 'image/png');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [a, b],
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => (j.payload as { mediaId: string }).mediaId).sort()).toEqual([a, b].sort());
  });

  it('GIF/HEIC/HEIF：不 emit，derived_status 仍 NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    for (const mime of ['image/gif', 'image/heic', 'image/heif'] as const) {
      const id = await readyImage(alice.token, mime);
      const res = await postMoment(alice.token, chainId, {
        type: 'media',
        content: '',
        happenedAt: '2026-08-29T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [id],
      });
      expect(res.status).toBe(201);
      const [row] = await db.select().from(media).where(eq(media.id, id));
      expect(row.derivedStatus).toBeNull();
    }
    expect(await compressRows()).toHaveLength(0);
  });

  it('JPEG+GIF 混排：只给 JPEG emit/pending', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const jpegId = await readyImage(alice.token, 'image/jpeg');
    const gifId = await readyImage(alice.token, 'image/gif');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [jpegId, gifId],
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { mediaId: string }).mediaId).toBe(jpegId);
    expect((await db.select().from(media).where(eq(media.id, jpegId)))[0].derivedStatus).toBe('pending');
    expect((await db.select().from(media).where(eq(media.id, gifId)))[0].derivedStatus).toBeNull();
  });

  it('视频+poster：只压 poster，视频行 NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    const res = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    expect(res.status).toBe(201);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { mediaId: string }).mediaId).toBe(posterId);
    expect((await db.select().from(media).where(eq(media.id, videoId)))[0].derivedStatus).toBeNull();
    expect((await db.select().from(media).where(eq(media.id, posterId)))[0].derivedStatus).toBe('pending');
  });

  it('纯文字 / 无封面视频：不 emit compress', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '第一次翻身',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(text.status).toBe(201);
    const videoId = await insertReadyVideo(alice.id);
    const video = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-29T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [videoId],
    });
    expect(video.status).toBe(201);
    expect(await compressRows()).toHaveLength(0);
  });

  it('PATCH 不 emit compress（不能改媒体）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(created.status).toBe(201);
    expect(await compressRows()).toHaveLength(1);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '改了正文' });
    expect(patched.status).toBe(200);
    expect(await compressRows()).toHaveLength(1);
  });
});
```

Modify `apps/server/tests/moments/create-voice-moment.test.ts` — 把成功用例标题改成「同事务 outbox 含 created/extract/transcribe + 每张可压图 compress」，并把 outbox 断言替换为：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.type).sort()).toEqual([
      'moment.compress',
      'moment.compress',
      'moment.created',
      'moment.extract',
      'moment.transcribe',
    ]);
    const compressMediaIds = events
      .filter((e) => e.type === 'moment.compress')
      .map((e) => (e.payload as { mediaId: string }).mediaId)
      .sort();
    expect(compressMediaIds).toEqual([img1, img2].sort());
    const transcribe = events.find((e) => e.type === 'moment.transcribe')!;
    expect(transcribe.payload).toEqual({ momentId: res.body.id });
```

Modify `apps/server/tests/moments/moment-list-crud.test.ts` — 用例「链内含 moments 时 owner 删链成功」在 JPEG `POST /moments` 之后、删链之前已经落了 `moment.created` + `moment.extract`（随后直插的 text 时刻**不**走 create、无 outbox）。把全表 outbox 断言（约 L360–362）替换为：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type).sort()).toEqual(['moment.compress', 'moment.created', 'moment.extract']);
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-compress-emit.test.ts`
Expected: FAIL，JPEG create 后 `compressRows()` 长度为 0（尚未 emit）。

- [ ] **Step 3: 实现 create 发射**

Modify `apps/server/src/moments/moment.service.ts`：

1. import 区追加：
```ts
import { isCompressibleMime } from '../media/derived.js';
```
并把 `../outbox/types.js` 那组 named import 增加 `OUTBOX_MOMENT_COMPRESS`（与 `OUTBOX_MOMENT_EXTRACT` 并列，不改 `outbox.ts` re-export）。

2. 在 `const copiedTmp: ... = [];` 之后、`const created = await db.transaction` 之前不改。在 transaction 回调开头、`let mediaRows` 旁追加：
```ts
      const compressIds: string[] = [];
```

3. 媒体循环的 `.set({...})` 在 `storageMeta: row.storageMeta,` 之后追加：
```ts
            ...(isCompressibleMime(row.mime) ? { derivedStatus: 'pending' as const } : {}),
```
并在该次 `update` **之后**（仍在 `for` 内）：
```ts
        if (isCompressibleMime(row.mime)) compressIds.push(row.id);
```

4. poster 分支 `.set({ s3Key: finalKey, momentId })` 改为：
```ts
        await tx
          .update(media)
          .set({
            s3Key: finalKey,
            momentId,
            ...(isCompressibleMime(posterRow.mime) ? { derivedStatus: 'pending' as const } : {}),
          })
          .where(eq(media.id, posterRow.id));
        if (isCompressibleMime(posterRow.mime)) compressIds.push(posterRow.id);
```

5. 在 `replaceMomentPersons(...)` 之后、geocode emit **之前**插入：
```ts
      for (const mediaId of compressIds) {
        await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId, chainId, mediaId });
      }
```

`update()` 方法 **不要**加 compress emit。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-compress-emit.test.ts tests/moments/create-voice-moment.test.ts tests/moments/create-moment.test.ts tests/moments/moment-poster.test.ts tests/moments/moment-list-crud.test.ts`
Expected: PASS。`create-moment` 的 `eq(outbox.type, 'moment.created')` 不受新增 compress 行影响。`moment-list-crud` 删链用例的 JPEG create 现为 created+extract+compress 三行；直插 text 仍无 outbox。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/moments/moment.service.ts \
  apps/server/tests/moments/moment-compress-emit.test.ts \
  apps/server/tests/moments/create-voice-moment.test.ts \
  apps/server/tests/moments/moment-list-crud.test.ts
git commit -m "feat(server): emit moment.compress on create for compressible images"
```

---

### Task 4: `GET /api/media/:id?variant=original|derived`

**Files:**
- Modify: `packages/dto/src/media.ts`（追加 `mediaVariantSchema`）
- Test: `packages/dto/src/media.test.ts`（追加 enum 用例）
- Modify: `apps/server/src/media/media.controller.ts`（`QueryParam('variant')` + parse）
- Modify: `apps/server/src/media/media.service.ts`（`resolveAccessUrl` 第四参 `variant`）
- Test: `apps/server/tests/media/media-variant.test.ts`
- Modify: `apps/server/tests/media/media-access.test.ts`（锁：无 variant 仍签 `s3_key`，且 **不**调 `getObject`）

**Interfaces:**
- Consumes:
  - 既有 `resolveAccessUrl(user, mediaId, st?)` 鉴权（链 viewer / `st=` / uploader / 链头像封面）
  - `alignedGetPresign()` + `generateAccessUrl(key, storageMeta, expiresIn, signingDate)`
  - P1 列 `derivedStatus` / `derivedS3Key`
  - `ErrorHandlerMiddleware`：`NotFoundError` 的 UPPER_SNAKE `message` → `error.code`；`ZodError` → 400 `VALIDATION_ERROR`
- Produces:
  - `mediaVariantSchema = z.enum(['original', 'derived'])`（`packages/dto/src/media.ts`）
  - `type MediaVariant = z.infer<typeof mediaVariantSchema>`
  - `MediaController.access` 增加 `@QueryParam('variant', { required: false, type: String }) variantRaw`
  - `variantRaw == null`（`undefined` 或 `null`）→ `'original'`；否则 `mediaVariantSchema.parse(variantRaw)`（非法 / 空串 → ZodError 400）
  - `MediaService.resolveAccessUrl(user, mediaId, st?, variant: MediaVariant = 'original'): Promise<string>`
  - `variant === 'derived'`：鉴权通过后，`derivedStatus !== 'ready'` 或 `derivedS3Key` 空 → `NotFoundError('DERIVED_NOT_READY')`（404，**不**回退原图）；否则签 **`derivedS3Key`**
  - `variant === 'original'`：仍签 `s3Key`（即使 derived 已 ready）
  - `Cache-Control: private, max-age=300` 不变
  - 媒体路径 **不**调用 `getObject`

- [ ] **Step 1: 写失败测试 — dto**

Modify `packages/dto/src/media.test.ts` — 现有 named import 增加 `mediaVariantSchema`，文件末尾追加：
```ts
test('mediaVariantSchema：original | derived；其它值拒绝', () => {
  assert.equal(mediaVariantSchema.parse('original'), 'original');
  assert.equal(mediaVariantSchema.parse('derived'), 'derived');
  assert.ok(!mediaVariantSchema.safeParse('thumb').success);
  assert.ok(!mediaVariantSchema.safeParse('').success);
  assert.ok(!mediaVariantSchema.safeParse('DERIVED').success);
});
```

- [ ] **Step 2: 写失败测试 — HTTP**

Create `apps/server/tests/media/media-variant.test.ts`：
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
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

let storage: MockStorage;
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

async function insertMoment(chainId: string, authorId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(moments).values({
    id,
    chainId,
    authorId,
    type: 'media',
    content: 'with photo',
    happenedAt: new Date('2026-08-29T10:00:00Z'),
    happenedTzOffset: -480,
    wallDate: wallDateOf(new Date('2026-08-29T10:00:00Z'), -480),
  });
  return id;
}

async function insertReadyMedia(opts: {
  uploaderId: string;
  momentId: string | null;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  derivedS3Key?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/c-1/m-1/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts.derivedStatus ?? null,
    derivedS3Key: opts.derivedS3Key ?? null,
  });
  return id;
}

describe('GET /api/media/:id?variant=', () => {
  it('缺省 / original：即使 derived 已 ready 仍签 s3_key；Cache-Control 不变；不 getObject', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db
      .update(media)
      .set({ derivedStatus: 'ready', derivedS3Key: derivedKey, derivedMime: 'image/webp' })
      .where(eq(media.id, mediaId));

    const def = await request(app).get(`/api/media/${mediaId}`).set('Authorization', `Bearer ${bob.token}`);
    expect(def.status).toBe(302);
    expect(def.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      `chains/c-1/m-1/${mediaId}.jpeg`,
      TEST_META,
      expect.any(Number),
      expect.any(Date),
    );

    storage.generateAccessUrl.mockClear();
    const orig = await request(app)
      .get(`/api/media/${mediaId}?variant=original`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(orig.status).toBe(302);
    expect(storage.generateAccessUrl.mock.calls[0]![0]).toBe(`chains/c-1/m-1/${mediaId}.jpeg`);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('variant=derived 且 ready：签 derived_s3_key', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db
      .update(media)
      .set({ derivedStatus: 'ready', derivedS3Key: derivedKey, derivedMime: 'image/webp' })
      .where(eq(media.id, mediaId));

    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=derived`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://fake.local/presigned-get');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(storage.generateAccessUrl).toHaveBeenCalledWith(
      derivedKey,
      TEST_META,
      expect.any(Number),
      expect.any(Date),
    );
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('derived 非 ready / key 空 → 404 DERIVED_NOT_READY（不回退原图）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const pendingId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'pending',
    });
    const skippedId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'skipped',
    });
    const failedId = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'failed',
    });
    const nullId = await insertReadyMedia({ uploaderId: alice.id, momentId, derivedStatus: null });
    const emptyKey = await insertReadyMedia({
      uploaderId: alice.id,
      momentId,
      derivedStatus: 'ready',
      derivedS3Key: null,
    });

    for (const id of [pendingId, skippedId, failedId, nullId, emptyKey]) {
      const res = await request(app)
        .get(`/api/media/${id}?variant=derived`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DERIVED_NOT_READY');
    }
  });

  it('非法 variant → 400 VALIDATION_ERROR', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=thumb`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('variant 空串 → 400 VALIDATION_ERROR（不是缺省 original）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const res = await request(app)
      .get(`/api/media/${mediaId}?variant=`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('未登录 derived 仍 401（鉴权先于 DERIVED_NOT_READY）', async () => {
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId: null, derivedStatus: null });
    const res = await request(app).get(`/api/media/${mediaId}?variant=derived`);
    expect(res.status).toBe(401);
  });

  it('share token + derived ready：匿名 302 签派生 key', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment(chainId, alice.id);
    const mediaId = await insertReadyMedia({ uploaderId: alice.id, momentId });
    const derivedKey = `chains/${chainId}/${momentId}/${mediaId}.derived.webp`;
    await db.update(media).set({ derivedStatus: 'ready', derivedS3Key: derivedKey }).where(eq(media.id, mediaId));
    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(link.status).toBe(201);

    const res = await request(app).get(`/api/media/${mediaId}?variant=derived&st=${link.body.token}`);
    expect(res.status).toBe(302);
    expect(storage.generateAccessUrl.mock.calls[0]![0]).toBe(derivedKey);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
```

Modify `apps/server/tests/media/media-access.test.ts` — 第一个 302 用例末尾追加：
```ts
    expect(storage.getObject).not.toHaveBeenCalled();
```
（P1 mock 已有 `getObject`；实现前该断言也成立——它锁的是「不要在 access 路径误加 getObject」。红灯以 `media-variant.test.ts` 的 derived 签错 key / 未 ready 仍 302 为准。）

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL，`mediaVariantSchema` 不是 export。

（dto 绿了之后）Run: `pnpm --filter @moment/server test -- tests/media/media-variant.test.ts`
Expected: FAIL，`?variant=derived` 仍签原图 key，或忽略 query。

- [ ] **Step 4: 实现 dto schema**

Modify `packages/dto/src/media.ts` — 在 `IMAGE_MIME_TYPES` 之前追加：
```ts
/** GET /api/media/:id?variant=（spec fused-retrieval §6.5）。缺省由 server 当 original。 */
export const mediaVariantSchema = z.enum(['original', 'derived']);
export type MediaVariant = z.infer<typeof mediaVariantSchema>;
```

- [ ] **Step 5: 实现 controller + service**

Modify `apps/server/src/media/media.controller.ts`：

值 import 块（`mediaCompleteInputSchema` 那组）增加 `mediaVariantSchema`。

`access` 方法签名增加第四个 QueryParam，parse 后再调 service：
```ts
  @Get('/:id')
  async access(
    @Param('id') id: string,
    @QueryParam('st', { required: false, type: String }) st: string | undefined,
    @QueryParam('variant', { required: false, type: String }) variantRaw: string | undefined,
    @CurrentUser() user: UserProfile | null,
    @Res() res: Response
  ): Promise<Response> {
    const variant = variantRaw == null ? 'original' : mediaVariantSchema.parse(variantRaw);
    const url = await this.mediaService.resolveAccessUrl(user, id, st, variant);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.redirect(302, url);
    return res;
  }
```

Modify `apps/server/src/media/media.service.ts`：

dto import 增加 `type MediaVariant`。

`resolveAccessUrl` 改为：
```ts
  async resolveAccessUrl(
    user: UserProfile | null,
    mediaId: string,
    st?: string,
    variant: MediaVariant = 'original',
  ): Promise<string> {
```

方法体内鉴权块 **保持不动**（`assertShareAccess` / `policy.require` / uploader）。把末尾：
```ts
    const { signingDate, expiresIn } = alignedGetPresign();
    return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, expiresIn, signingDate);
```
替换为：
```ts
    const { signingDate, expiresIn } = alignedGetPresign();
    if (variant === 'derived') {
      if (row.derivedStatus !== 'ready' || !row.derivedS3Key) {
        throw new NotFoundError('DERIVED_NOT_READY');
      }
      return getStorage().generateAccessUrl(row.derivedS3Key, row.storageMeta, expiresIn, signingDate);
    }
    return getStorage().generateAccessUrl(row.s3Key, row.storageMeta, expiresIn, signingDate);
  }
```

- [ ] **Step 6: 运行确认通过**

Run:
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build
pnpm --filter @moment/server test -- tests/media/media-variant.test.ts tests/media/media-access.test.ts tests/share/share-media.test.ts
```
Expected: PASS。既有无 `variant` 的 302 矩阵不变。**必须 build dto**：server 运行时从 `packages/dto/dist` 解析 `@moment/dto`（`dist/` gitignore），不 build 则 `mediaVariantSchema` 不是 export。

- [ ] **Step 7: Commit**

```bash
git add packages/dto/src/media.ts packages/dto/src/media.test.ts \
  apps/server/src/media/media.controller.ts apps/server/src/media/media.service.ts \
  apps/server/tests/media/media-variant.test.ts apps/server/tests/media/media-access.test.ts
git commit -m "feat(server): serve GET /api/media/:id?variant=derived"
```

---

### Task 5: serializer `derivedUrl` / `posterDerivedUrl` + dto 必填化

**Files:**
- Modify: `apps/server/src/moments/moment-serializer.ts`（`MediaLike` + `momentSerializer` 两字段 + 组装 poster 派生状态）
- Test: `apps/server/tests/moments/moment-serializer.test.ts`（追加 URL 用例）
- Test: `apps/server/tests/moments/moment-derived-serialization.test.ts`（HTTP：链内 + share-album；列表不 `getObject`）
- Modify: `packages/dto/src/moments.ts`（两字段改为必填 `string | null`，删「P1 可选」注释）
- Modify: `packages/dto/src/moments.test.ts`（P1「可省略」改为必填；`legacy` 字面量带两键）
- Modify（机械补 null，**不改组件行为**）:
  - `apps/web/src/media/MediaBlock.test.tsx`（`image()` / `video()`）
  - `apps/web/src/timeline/lightbox.test.tsx`（`image()` / `video()`）
  - `apps/web/src/pages/timeline-variants.test.tsx`（`image()`）
  - `apps/web/src/pages/chain-home/chain-home.test.tsx`（inline `media-1` 字面量）

**Interfaces:**
- Consumes:
  - P1 `Media.derivedStatus`；视频 `posterMediaId`；`serializeMoments` 已排除 poster 行出 `media[]`
  - CONVENTIONS §3.4：相对路径 `/api/media/:id`
- Produces:
  - `MediaLike.derivedStatus?: 'pending'|'ready'|'skipped'|'failed'|null`
  - `MediaLike.posterDerivedStatus?:` 同上（内容行上挂封面行的 status；图片行 null）
  - `momentSerializer` 每条 media：
    - `derivedUrl = derivedStatus==='ready' ? `/api/media/${id}?variant=derived` : null`
    - `posterDerivedUrl = posterMediaId && posterDerivedStatus==='ready' ? `/api/media/${posterMediaId}?variant=derived` : null`
    - 图片行 `posterDerivedUrl` 恒 null；`url` / `posterUrl` 语义不变（永远原图入口，无 variant）
  - `serializeMoments` 从同批 `mediaRows`（含 poster）查封面 `derivedStatus`；poster 行仍不进 `media[]`
  - `MomentMedia.derivedUrl: string | null` 与 `posterDerivedUrl: string | null` **必填**
  - share-album（`includePrivate` 缺省 false）**有**这两键（图不是 persons/place）；仍无 `persons`/`place` 键
  - JSON **不含** `https://` 预签名

- [ ] **Step 1: 写失败测试 — serializer 单测**

Modify `apps/server/tests/moments/moment-serializer.test.ts` — 文件末尾追加：
```ts
describe('momentSerializer derivedUrl / posterDerivedUrl（spec fused-retrieval §2.1）', () => {
  it('仅 derivedStatus=ready 出 derivedUrl；pending/skipped/failed/缺省为 null；不内嵌预签名', () => {
    const ready = momentSerializer(moment, {
      media: [
        {
          id: 'md-1',
          mime: 'image/jpeg',
          width: 512,
          height: 256,
          duration: null,
          sortOrder: 0,
          posterMediaId: null,
          derivedStatus: 'ready',
          posterDerivedStatus: null,
        },
      ],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(ready.media[0].derivedUrl).toBe('/api/media/md-1?variant=derived');
    expect(ready.media[0].posterDerivedUrl).toBeNull();
    expect(ready.media[0].url).toBe('/api/media/md-1');
    expect(JSON.stringify(ready)).not.toContain('https://');

    for (const derivedStatus of ['pending', 'skipped', 'failed', null] as const) {
      const res = momentSerializer(moment, {
        media: [
          {
            id: 'md-1',
            mime: 'image/jpeg',
            width: 10,
            height: 10,
            duration: null,
            sortOrder: 0,
            posterMediaId: null,
            derivedStatus,
            posterDerivedStatus: null,
          },
        ],
        author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
      });
      expect(res.media[0].derivedUrl).toBeNull();
    }
  });

  it('视频行：封面 ready → posterDerivedUrl；图片行恒 null', () => {
    const video = momentSerializer(
      { ...moment, type: 'video' },
      {
        media: [
          {
            id: 'vid-1',
            mime: 'video/mp4',
            width: 1280,
            height: 720,
            duration: 12,
            sortOrder: 0,
            posterMediaId: 'poster-1',
            derivedStatus: null,
            posterDerivedStatus: 'ready',
          },
        ],
        author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
      },
    );
    expect(video.media[0].derivedUrl).toBeNull();
    expect(video.media[0].posterUrl).toBe('/api/media/poster-1');
    expect(video.media[0].posterDerivedUrl).toBe('/api/media/poster-1?variant=derived');

    const image = momentSerializer(moment, {
      media: [
        {
          id: 'md-1',
          mime: 'image/jpeg',
          width: 10,
          height: 10,
          duration: null,
          sortOrder: 0,
          posterMediaId: null,
          derivedStatus: 'ready',
          posterDerivedStatus: 'ready',
        },
      ],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect(image.media[0].posterDerivedUrl).toBeNull();
  });
});
```

- [ ] **Step 2: 写失败测试 — HTTP 双路 + 列表不 getObject**

Create `apps/server/tests/moments/moment-derived-serialization.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

let storage: MockStorage;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

async function insertBoundImage(opts: {
  momentId: string;
  uploaderId: string;
  derivedStatus: 'pending' | 'ready' | 'skipped' | 'failed' | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: opts.momentId,
    uploaderId: opts.uploaderId,
    s3Key: `chains/x/${opts.momentId}/${id}.jpeg`,
    mime: 'image/jpeg',
    size: 1024,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: opts.derivedStatus,
    derivedS3Key:
      opts.derivedStatus === 'ready' ? `chains/x/${opts.momentId}/${id}.derived.webp` : null,
    derivedMime: opts.derivedStatus === 'ready' ? 'image/webp' : null,
  });
  return id;
}

describe('serializeMoments derivedUrl（spec §2.1 / §9）', () => {
  it('链内 GET：ready 出 derivedUrl；pending 为 null；JSON 无预签名；不 getObject', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const readyMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
    });
    const pendingMoment = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-28T00:00:00Z'),
    });
    const readyId = await insertBoundImage({
      momentId: readyMoment,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });
    await insertBoundImage({
      momentId: pendingMoment,
      uploaderId: owner.id,
      derivedStatus: 'pending',
    });

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const readyItem = res.body.items.find((m: { id: string }) => m.id === readyMoment);
    const pendingItem = res.body.items.find((m: { id: string }) => m.id === pendingMoment);
    expect(readyItem.media[0].derivedUrl).toBe(`/api/media/${readyId}?variant=derived`);
    expect(readyItem.media[0].url).toBe(`/api/media/${readyId}`);
    expect(readyItem.media[0].posterDerivedUrl).toBeNull();
    expect(pendingItem.media[0].derivedUrl).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('https://');
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('视频封面 ready → posterDerivedUrl；poster 行不进 media[]', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
    });
    const posterId = await insertBoundImage({
      momentId,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });
    const videoId = randomUUID();
    await db.insert(media).values({
      id: videoId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/x/${momentId}/${videoId}.mp4`,
      mime: 'video/mp4',
      size: 2048,
      status: 'ready',
      storageMeta: TEST_META,
      posterMediaId: posterId,
      derivedStatus: null,
    });
    await db.update(moments).set({ type: 'video' }).where(eq(moments.id, momentId));

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].id).toBe(videoId);
    expect(res.body.media[0].posterMediaId).toBe(posterId);
    expect(res.body.media[0].posterUrl).toBe(`/api/media/${posterId}`);
    expect(res.body.media[0].posterDerivedUrl).toBe(`/api/media/${posterId}?variant=derived`);
    expect(res.body.media[0].derivedUrl).toBeNull();
  });

  it('share-album：有 derivedUrl，无 persons/place 键', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-29T00:00:00Z'),
      content: '有图',
    });
    const personId = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, personId, 'manual');
    const imageId = await insertBoundImage({
      momentId,
      uploaderId: owner.id,
      derivedStatus: 'ready',
    });

    const link = await request(app).post(`/api/chains/${chainId}/share-links`).set(auth(owner.token)).send({});
    expect(link.status).toBe(201);
    const res = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    expect('persons' in res.body.moments[0]).toBe(false);
    expect('place' in res.body.moments[0]).toBe(false);
    expect(res.body.moments[0].media[0].derivedUrl).toBe(`/api/media/${imageId}?variant=derived`);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
```

Modify `packages/dto/src/moments.test.ts` — P1 的 `MomentMedia：derivedUrl / posterDerivedUrl 可赋值；P1 可省略` **整段替换**为：
```ts
test('MomentMedia：derivedUrl / posterDerivedUrl 必填（P1 偏差 1 由 P3 收口）', () => {
  const ready: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'image/jpeg',
    width: 64,
    height: 48,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: `/api/media/${UUID_A}?variant=derived`,
    posterDerivedUrl: null,
  };
  assert.equal(ready.derivedUrl, `/api/media/${UUID_A}?variant=derived`);
  assert.equal(ready.posterDerivedUrl, null);

  const video: import('./moments.js').MomentMedia = {
    id: UUID_A,
    url: `/api/media/${UUID_A}`,
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 12,
    sortOrder: 0,
    posterMediaId: UUID_B,
    posterUrl: `/api/media/${UUID_B}`,
    derivedUrl: null,
    posterDerivedUrl: `/api/media/${UUID_B}?variant=derived`,
  };
  assert.equal(video.posterDerivedUrl, `/api/media/${UUID_B}?variant=derived`);
});
```

（tsx 不类型检查；必填由本 Task Step 6 的 `pnpm --filter @moment/dto build` + server/web typecheck 把关。删掉 P1 `legacy` 省略两键的字面量——必填后那不再是合法 `MomentMedia`。）

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-serializer.test.ts`
Expected: FAIL，`derivedUrl` 为 `undefined`（serializer 尚未输出该键）。

- [ ] **Step 4: 实现 serializer**

Modify `apps/server/src/moments/moment-serializer.ts`：

`MediaLike` 在 `posterMediaId` 之后追加：
```ts
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  /** 视频封面行的 derived_status；图片行 null */
  posterDerivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
```

`momentSerializer` 的 media `.map` 对象在 `posterUrl: ...` 之后追加：
```ts
        derivedUrl: x.derivedStatus === 'ready' ? `/api/media/${x.id}?variant=derived` : null,
        posterDerivedUrl:
          x.posterMediaId && x.posterDerivedStatus === 'ready'
            ? `/api/media/${x.posterMediaId}?variant=derived`
            : null,
```

`serializeMoments` 里构造 `posterIds` 之后、`mediaBy` 循环改为（用全量 `mediaRows` 查封面状态，poster 行仍 `continue`）：
```ts
  const rowById = new Map(mediaRows.map((r) => [r.id, r]));
  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    if (posterIds.has(m.id)) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push({
      id: m.id,
      mime: m.mime,
      width: m.width,
      height: m.height,
      duration: m.duration,
      sortOrder: m.sortOrder,
      posterMediaId: m.posterMediaId,
      derivedStatus: m.derivedStatus,
      posterDerivedStatus: m.posterMediaId
        ? (rowById.get(m.posterMediaId)?.derivedStatus ?? null)
        : null,
    });
    mediaBy.set(m.momentId, list);
  }
```
删掉旧的 `list.push(m)` 循环体。

- [ ] **Step 5: dto 必填化 + web 夹具**

Modify `packages/dto/src/moments.ts` — `MomentMedia` 两字段改为（去掉 `?` 与「P1 可选」句）：
```ts
  /**
   * 派生图稳定入口 `/api/media/:id?variant=derived`；仅 derived_status=ready 非空。
   * 不内嵌预签名（CONVENTIONS §3.4）。
   */
  derivedUrl: string | null;
  /**
   * 视频封面派生入口 `/api/media/:posterId?variant=derived`；仅视频行且封面 derived_status=ready 非空，否则 null。
   * 图片行恒 null。
   */
  posterDerivedUrl: string | null;
```

四处 web 夹具：每个 `MomentMedia` 字面量在 `posterUrl: null` 之后追加 `derivedUrl: null, posterDerivedUrl: null`。

- `apps/web/src/media/MediaBlock.test.tsx` 的 `image()` / `video()`
- `apps/web/src/timeline/lightbox.test.tsx` 的 `image()` / `video()`
- `apps/web/src/pages/timeline-variants.test.tsx` 的 `image()`
- `apps/web/src/pages/chain-home/chain-home.test.tsx` 的 `{ id: 'media-1', ... posterUrl: null }`

**不要**改 `MediaBlock.tsx` / `lightbox.tsx` 的取图逻辑（仍用 `url` / `posterUrl`）。

- [ ] **Step 6: 运行确认通过**

Run:
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build
pnpm --filter @moment/server test -- tests/moments/moment-serializer.test.ts tests/moments/moment-derived-serialization.test.ts tests/moments/moment-private-serialization.test.ts tests/moments/moment-poster.test.ts tests/share/public-share.test.ts tests/feed/feed.test.ts
pnpm --filter @moment/server typecheck
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web test -- src/media/MediaBlock.test.tsx src/timeline/lightbox.test.tsx
pnpm --filter @moment/app typecheck
```
Expected: 全绿。share-album 仍无 `persons`/`place` 键，但 ready 图有 `derivedUrl`。web 夹具 typecheck 通过。app 无 `MomentMedia` 字面量，typecheck 应过。

若 web typecheck 还报其它 `MomentMedia` 缺字段，只补 `derivedUrl: null, posterDerivedUrl: null`，不改运行时行为，并把文件列入本 Task commit。

- [ ] **Step 7: lint**

Run: `pnpm --filter @moment/server lint && pnpm --filter @moment/dto lint && pnpm --filter @moment/web lint`
Expected: exit 0。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/moments/moment-serializer.ts \
  apps/server/tests/moments/moment-serializer.test.ts \
  apps/server/tests/moments/moment-derived-serialization.test.ts \
  packages/dto/src/moments.ts packages/dto/src/moments.test.ts \
  apps/web/src/media/MediaBlock.test.tsx apps/web/src/timeline/lightbox.test.tsx \
  apps/web/src/pages/timeline-variants.test.tsx apps/web/src/pages/chain-home/chain-home.test.tsx
git commit -m "feat(server): serialize derivedUrl and posterDerivedUrl"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test -- tests/media/derived.test.ts tests/media/compress-webp.test.ts tests/worker/handle-moment-compress.test.ts tests/worker/handlers.test.ts tests/moments/moment-compress-emit.test.ts tests/moments/create-voice-moment.test.ts tests/moments/moment-list-crud.test.ts tests/media/media-variant.test.ts tests/media/media-access.test.ts tests/moments/moment-serializer.test.ts tests/moments/moment-derived-serialization.test.ts tests/moments/moment-private-serialization.test.ts tests/moments/moment-poster.test.ts tests/share/share-media.test.ts` 全绿
- [ ] `pnpm --filter @moment/dto test` / `build` 绿；`pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] `pnpm --filter @moment/web typecheck` exit 0
- [ ] JPEG fixture → `derived_status=ready`，最长边 ≤512，mime webp；`skipped` 仅当输出 ≥ `size` 且不 upload
- [ ] GIF/HEIC/HEIF：**不 emit**、`derived_status` 仍 **NULL**、handler 误收到也不 `getObject`
- [ ] poster 行可压；视频/音频不压
- [ ] Handler 不写 `outbox.status`；`NonRetryableCompressError.name === 'NonRetryableCompressError'` → processor 立即 failed + `last_error`
- [ ] `GET /api/media/:id` 缺省 original；`variant=derived` 未 ready → 404 `DERIVED_NOT_READY`；非法 variant → 400 `VALIDATION_ERROR`；不回退原图；不 `getObject`
- [ ] serializer：`derivedUrl` / `posterDerivedUrl` 仅 ready；稳定入口无预签名；share-album 有 derived 无 persons/place
- [ ] **未**泄漏 P4–P10：无 Lance/BA/bookworm、无 `handleMomentEmbed` / `computeEmbedHash` / data URI、无 compress 终态 emit embed、无 search/jobs HTTP、无 `mediaUrl` helper、无 backfill、无新 env

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P3）**：§4.2 步骤 1–6（步骤 7 embed 偏差 1）+ create emit + GIF/HEIC NULL + skipped 语义 + poster；§6.5 variant GET + `DERIVED_NOT_READY`；§2.1 serializer URL；§2.3 不改 outbox.status + `NonRetryableCompressError`；§8 仅 worker 读原图；§9 compress / derivedUrl / 列表不 getObject；§11 P3 出口。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：Task 1 `isCompressibleMime` / `derivedObjectKey` / `NonRetryableCompressError` 被 Task 2–3 逐字消费；P1 `getObject` / `OUTBOX_MOMENT_COMPRESS` / 派生列 / processor name 集合未改写；Task 4 `mediaVariantSchema` 与 Task 5 URL `?variant=derived` 同一字面量；P1 可选 URL 由 Task 5 必填化。JPEG create 的全表 outbox 副作用（voice 3→5、list-crud 删链 2→3）已列入 Files。
