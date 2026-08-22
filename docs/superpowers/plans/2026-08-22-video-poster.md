# 视频封面（客户端截帧）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频 moment（`type = video`，单视频）支持客户端截帧封面：dto 契约加 `posterMediaId` / `posterUrl`，server 发布事务绑定 poster 行并在序列化中排除，web 端 `<video>` + canvas 拖动选帧、app 端 `expo-video-thumbnails` 截首帧，两端消费侧渲染封面。宫格视频、存量回填、HLS、服务端抽帧均不做（spec §0 搁置决策）。

**Architecture:** poster 就是一张 `kind: 'image'` / `image/jpeg` 的普通图片上传（复用 presign → PUT → complete 管线，不改上传语义）；关联在发布事务内完成——poster 行与媒体行同事务行锁、同 tmp→final copy，但 poster 行单独变量持有（不污染媒体数量校验），update 分支分开写（不写 `sortOrder` / `storageMeta`）；视频行写 `poster_media_id`（列已存在，本期启用）。序列化唯一出口 `moment-serializer.ts` 在批量函数中把 poster 行从 `media` 数组排除。权限读取与清理语义零改动（poster 行绑了 `momentId`，既有 `GET /media/:id` 302 鉴权与 sweeper 软删路径自然覆盖）。

**Tech Stack:** zod ^3（dto）/ routing-controllers + Drizzle + Jest 触库测试（server）/ React 19 + @rabjs/react + vitest（web）/ Expo SDK 54 + expo-video-thumbnails ~10（app）。

**Spec:** `docs/superpowers/specs/2026-08-22-video-poster-design.md`（唯一真相源；本计划不超出其范围）

## Global Constraints

- 本期**无新环境变量**：`apps/server/src/config.ts` 与 `apps/server/.env.example` 不动。
- **无新表、无迁移**：`media.poster_media_id` 列已存在（`apps/server/src/db/schema/media.ts:25`），只改其 TS 注释（注释改动不需要 `drizzle-kit generate`）；`resetDb()` 无需扩展。
- **api-client 零改动**：`createMoment` 入参类型是 `ZodInput<typeof createMomentInputSchema>` 且提交前 `createMomentInputSchema.parse(input)`（`packages/api-client/src/client.ts:61,146,179`），`posterMediaId` 随 dto schema 自动透传；`uploadMedia` 已支持 `file: Blob` 形态（`packages/api-client/src/upload.ts:9`），poster JPEG 直接用。
- server 触库测试遵守 `.claude/rules/testing.md`：`--runInBand`（已内置在 test 脚本）、`afterAll(closeDb)`、只打 `.env` 指向的测试库；S3 走 `installMockStorage()`。
- web 端 UI 遵循根 CLAUDE.md 列出的六份 C 端设计规范与 `.claude/rules/web-ui.md`：只消费 `src/ui/` 组件与 tokens.css 语义 token，禁止写死色值/一次性尺寸。
- app 端新代码消费 `useTheme()` token；`pnpm --filter @moment/app lint` 含 `lint:tokens` 门禁（`src/` 禁 hex/rgba）。
- ESM NodeNext：TS 相对 import 一律带 `.js` 后缀（web/app 的 bundler 解析不加，沿用各端现状）。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **web 截帧组件复用 `service.video.previewUrl`，不新建 object URL**：spec §3 写「`<video>` 元素加载本地 file blob（`URL.createObjectURL`）」。compose-panel service 在 `addVideo` 时已为同一 file 建好 `previewUrl` 并统一 revoke（`compose-panel.service.ts:205-206,259`），截帧组件直接复用该 URL，避免双重 object URL 生命周期。语义与 spec 一致（本地 blob，无网络请求）。
2. **app 消费侧传参 `m.posterMediaId ?? undefined`**：`useMediaUri` 签名是 `mediaId: string | undefined`（`apps/app/src/lib/use-media-uri.ts:6`，复审已确认），而 dto `posterMediaId` 是 `string | null`，传参必须 `?? undefined` 归一。
3. **web `useMediaObjectUrl` 接受 `string | null`**（`apps/web/src/media/useMediaObjectUrl.ts:5`）：`media.posterMediaId`（`string | null`）可直接传入，null 时不发请求，无需归一。
4. **联调验证不走仓内 e2e**：web 的 e2e 仅 design-system 视觉回归基线（`apps/web/e2e/`，受控基线，本特性无新设计系统组件、不加 case）；按 CONVENTIONS §4，web/app 门禁 = typecheck + lint + build + 手动验收清单（Task 5）。
5. **spec §3 行号微调**：spec 写 VideoOne 播放按钮在 `MediaBlock.tsx` 135-149 行，实际为 136-149 行（`VideoOne` 函数 131-163），落点一致。

---

### Task 1 (P1): dto 契约 — `posterMediaId` 请求字段 + `MomentMedia` 响应字段

**Files:**
- Modify: `packages/dto/src/moments.ts`
- Test: `packages/dto/src/moments.test.ts`（扩展既有文件，同目录不触库）

**Interfaces:**
- Consumes: 既有 `createMomentInputSchema` / `patchMomentInputSchema` / `MomentMedia`（`packages/dto/src/moments.ts`）。
- Produces（后续所有 Task 消费，不得改名）:
  - `createMomentInputSchema` 新增 optional 字段 `posterMediaId: z.string().min(1).optional()`；`CreateMomentInput` 推导类型自动带出。
  - `MomentMedia.posterMediaId: string | null` / `MomentMedia.posterUrl: string | null`（两个**必填**字段——必填是夹具同步的依据，spec §6）。

- [ ] **Step 1: 写失败测试**

在 `packages/dto/src/moments.test.ts` 末尾追加：

```ts
test('createMomentInputSchema：type=video 带/不带 posterMediaId 均通过', () => {
  const video = { ...base, type: 'video' as const, content: '', mediaIds: ['m-1'] };
  assert.ok(createMomentInputSchema.safeParse(video).success);
  assert.ok(
    createMomentInputSchema.safeParse({ ...video, posterMediaId: 'poster-1' }).success
  );
});

test('createMomentInputSchema：type=text / media 传 posterMediaId → MEDIA_NOT_ALLOWED', () => {
  const text = createMomentInputSchema.safeParse({ ...base, posterMediaId: 'poster-1' });
  assert.ok(!text.success);
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'media' as const,
      content: '',
      mediaIds: ['m-1'],
      posterMediaId: 'poster-1',
    }).success
  );
});

test('createMomentInputSchema：posterMediaId 空串拒绝（min(1)）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'video' as const,
      content: '',
      mediaIds: ['m-1'],
      posterMediaId: '',
    }).success
  );
});

test('patchMomentInputSchema：.strict() 拒绝 posterMediaId（封面发布后不可改）', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ posterMediaId: 'poster-1' }).success);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL——「text/media 传 posterMediaId → MEDIA_NOT_ALLOWED」与「posterMediaId 空串拒绝（min(1)）」失败（见下注）。

> 注：zod object 默认 strip 未知键，「带 posterMediaId 通过」在实现前也会成功（未知键被剥掉），空串用例实现前 parse 同样成功（断言 `!success` 故为红灯）；第 4 个用例（patch strict 拒绝）在实现前就会通过——`.strict()` 本就拒未知键。真正的红灯由第 2、3 个用例提供（text/media 拒海报、空串 min(1) 拒绝），执行时以这两例失败为准。

- [ ] **Step 3: 实现 `moments.ts` 契约扩展**

Modify `packages/dto/src/moments.ts`：

1. `createMomentInputSchema` 的 object 内（`mediaIds` 行后）加：

```ts
    /** 视频封面媒体 id（客户端截帧的普通 image 上传）；仅 type=video 可传，见 superRefine */
    posterMediaId: z.string().min(1).optional(),
```

2. `superRefine` 内（重复 id 检查块之后）加：

```ts
    // 封面仅单视频支持（spec video-poster §1：宫格视频封面语义 YAGNI）
    if (val.type !== 'video' && val.posterMediaId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_NOT_ALLOWED', path: ['posterMediaId'] });
    }
```

3. `MomentMedia` interface（`sortOrder` 行后）加：

```ts
  /** 视频封面媒体 id：登录态经 useMediaObjectUrl / useMediaUri(posterMediaId) 取 blob；仅视频行非空，无封面为 null */
  posterMediaId: string | null;
  /** 视频封面稳定入口相对路径 /api/media/:posterId（不内嵌预签名 URL，CONVENTIONS §3.4）；分享态拼 ?st= 用；仅视频行非空，无封面为 null */
  posterUrl: string | null;
```

`patchMomentInputSchema` 不动（`.strict()` 自动拒绝 `posterMediaId`）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 全过（既有 mediaIds 校验矩阵不回归），build exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/moments.ts packages/dto/src/moments.test.ts
git commit -m "feat(dto): add posterMediaId contract for video moments"
```

---

### Task 2 (P2): server 绑定逻辑 + 序列化排除 + schema 注释 + 触库测试

**Files:**
- Modify: `apps/server/src/moments/moment.service.ts`（`create` 方法）
- Modify: `apps/server/src/moments/moment-serializer.ts`（`MediaLike` + media map + 批量排除）
- Modify: `apps/server/src/db/schema/media.ts`（仅 24 行注释，无迁移）
- Test: `apps/server/tests/moments/moment-poster.test.ts`（新建，触库）
- Modify: `apps/server/tests/moments/moment-serializer.test.ts`（夹具同步：21-22 行两个字面量补 `posterMediaId: null`）

**Interfaces:**
- Consumes: Task 1 的 `CreateMomentInput.posterMediaId`；既有 `Media` 行结构（`posterMediaId` 列自带）；`installMockStorage`（`tests/helpers/storage.ts`）；`handleMomentDeleted`（`src/worker/handlers.ts:151`）。
- Produces:
  - `MomentService.create`：接受 `posterMediaId`，发布事务内绑定 poster 行 + 写视频行 `poster_media_id`。
  - `MediaLike.posterMediaId: string | null`（必填，夹具同步的触发点）。
  - 序列化输出：`media` 数组元素含 `posterMediaId` / `posterUrl`；poster 行不作为内容媒体出现。

- [ ] **Step 1: 夹具同步（先修编译）**

Modify `apps/server/tests/moments/moment-serializer.test.ts`：21-22 行两个 `MediaLike` 字面量各补 `posterMediaId: null`（`MediaLike` 加必填字段后 tsc 才能过）：

```ts
        { id: 'md-2', mime: 'image/jpeg', width: 100, height: 200, duration: null, sortOrder: 1, posterMediaId: null },
        { id: 'md-1', mime: 'image/png', width: 10, height: 20, duration: null, sortOrder: 0, posterMediaId: null },
```

- [ ] **Step 2: 写失败测试**

Create `apps/server/tests/moments/moment-poster.test.ts`（模式复用 `create-moment.test.ts`：`listenLocal` + `installMockStorage` + `readyImage` 助手；`storageMeta: {}` 直插 ready 视频行复用 162-177 行模式）：

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentDeleted } from '../../src/worker/handlers.js';
import { MockPushService } from '../../src/push/mock.js';

const app = listenLocal(createApp());

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

/** 直插 ready 视频行（multipart 通道造数成本高，归属校验只看行字段，同 create-moment.test.ts）。 */
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

async function setup() {
  const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
  const videoId = await insertReadyVideo(alice.id);
  const posterId = await readyImage(alice.token);
  return { chainId, videoId, posterId };
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const videoBody = (videoId: string, posterMediaId?: string) => ({
  type: 'video' as const,
  content: '',
  happenedAt: '2026-08-22T10:00:00+08:00',
  happenedTzOffset: -480,
  mediaIds: [videoId],
  ...(posterMediaId ? { posterMediaId } : {}),
});

describe('POST moments with posterMediaId（视频封面绑定）', () => {
  it('成功路径：poster 行绑 momentId + s3_key copy 到 final，视频行写 poster_media_id，响应 media 恰 1 条', async () => {
    const { chainId, videoId, posterId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    expect(res.status).toBe(201);
    // poster 不泄漏为第 2 条媒体；视频行出 posterMediaId / posterUrl
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].id).toBe(videoId);
    expect(res.body.media[0].posterMediaId).toBe(posterId);
    expect(res.body.media[0].posterUrl).toBe(`/api/media/${posterId}`);

    const [posterRow] = await db.select().from(media).where(eq(media.id, posterId));
    expect(posterRow.momentId).toBe(res.body.id);
    expect(posterRow.s3Key).toBe(`chains/${chainId}/${res.body.id}/${posterId}.jpeg`);
    expect(posterRow.sortOrder).toBe(0); // 不参与宫格排序，保持上传时的默认值
    const [videoRow] = await db.select().from(media).where(eq(media.id, videoId));
    expect(videoRow.posterMediaId).toBe(posterId);
    // poster 的 tmp 对象与媒体行走同一 post-commit 清理
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${posterId}.jpeg`, expect.anything());
  });

  it('无封面视频：posterMediaId / posterUrl 均 null；图片行两字段恒 null', async () => {
    const { chainId, videoId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId));
    expect(res.status).toBe(201);
    expect(res.body.media[0].posterMediaId).toBeNull();
    expect(res.body.media[0].posterUrl).toBeNull();

    const imageId = await readyImage(alice.token);
    const grid = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(grid.status).toBe(201);
    expect(grid.body.media[0].posterMediaId).toBeNull();
    expect(grid.body.media[0].posterUrl).toBeNull();
  });

  it('poster 非本人上传 → 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const bobPoster = await readyImage(bob.token);
    const res = await postMoment(alice.token, chainId, videoBody(videoId, bobPoster));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster 非 ready（presign 未 complete）→ 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    const res = await postMoment(alice.token, chainId, videoBody(videoId, presigned.body.mediaId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster 已绑定其他 moment → 400 MEDIA_INVALID', async () => {
    const { chainId, posterId } = await setup();
    const video2 = await insertReadyVideo(alice.id);
    const first = await postMoment(alice.token, chainId, videoBody(video2, posterId));
    expect(first.status).toBe(201);
    const video3 = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, videoBody(video3, posterId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('poster mime 为 video/* → 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const otherVideo = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, videoBody(videoId, otherVideo));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('posterMediaId 同时是内容媒体（mediaIds[0]）→ 400 MEDIA_INVALID', async () => {
    const { chainId, videoId } = await setup();
    const res = await postMoment(alice.token, chainId, videoBody(videoId, videoId));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('dto 层：type=media / text 传 posterMediaId → 400 VALIDATION_ERROR', async () => {
    const { chainId } = await setup();
    const imageId = await readyImage(alice.token);
    const asMedia = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
      posterMediaId: imageId,
    });
    expect(asMedia.status).toBe(400);
    expect(asMedia.body.error.code).toBe('VALIDATION_ERROR');
    const asText = await postMoment(alice.token, chainId, {
      type: 'text',
      content: 'hi',
      happenedAt: '2026-08-22T11:00:00+08:00',
      happenedTzOffset: -480,
      posterMediaId: imageId,
    });
    expect(asText.status).toBe(400);
    expect(asText.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH 传 posterMediaId → 400 VALIDATION_ERROR（封面发布后不可改）', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ posterMediaId: posterId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('软删带 poster 的 video moment：handleMomentDeleted 后 poster 行随视频行同标 orphaned', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    await request(app)
      .delete(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    await handleMomentDeleted(
      { momentId: created.body.id, chainId, authorId: alice.id },
      { push: new MockPushService() }
    );
    const [posterRow] = await db.select().from(media).where(eq(media.id, posterId));
    const [videoRow] = await db.select().from(media).where(eq(media.id, videoId));
    expect(posterRow.status).toBe('orphaned');
    expect(videoRow.status).toBe('orphaned');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-poster.test.ts`
Expected: FAIL——成功路径 400（`posterMediaId` 被 dto 剥离后 server 不绑定 / 或 `media[0].posterMediaId` undefined）。注意：Step 1 给 moment-serializer.test.ts 补 `posterMediaId: null` 后，该文件在 MediaLike 加字段前会因 excess property 报 TS 错，属预期，Step 5 后消失；`apps/server/jest.config.mjs` 的 ts-jest 未开 isolatedModules，diagnostics 默认开启，带上旧文件会因类型错误直接失败，故本步只跑新文件 moment-poster.test.ts（行为失败为准）。

- [ ] **Step 4: 实现 `moment.service.ts` create 扩展**

Modify `apps/server/src/moments/moment.service.ts`，仅 `create` 方法内的事务块（48-117 行）：

1. 行锁 id 集合扩展 + poster 行单独变量持有（替换 49-72 行块）：

```ts
      let mediaRows: Media[] = [];
      let posterRow: Media | null = null;
      // poster 与媒体行走同一事务行锁（并发语义一致），但 poster 行单独持有——
      // 数量校验 mediaRows.length === new Set(input.mediaIds).size 只对媒体集合做，不能被 poster 污染
      const lockIds = input.posterMediaId
        ? [...new Set([...input.mediaIds, input.posterMediaId])]
        : input.mediaIds;
      if (lockIds.length > 0) {
        const locked = await tx
          .select()
          .from(media)
          .where(inArray(media.id, lockIds))
          .for('update');
        posterRow = locked.find((r) => r.id === input.posterMediaId) ?? null;
        mediaRows = locked.filter((r) => r.id !== input.posterMediaId);
        // （既有媒体校验块原样保留：数量一致 + 属本人 + ready + 未绑定 + mime 匹配）
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
        // poster 行校验（spec video-poster §2.1）：本人 + ready + 未绑定 + image/* + 不在 mediaIds 中
        if (input.posterMediaId) {
          const posterValid =
            posterRow !== null &&
            posterRow.uploaderId === userId &&
            posterRow.status === 'ready' &&
            posterRow.momentId === null &&
            posterRow.mime.startsWith('image/') &&
            !input.mediaIds.includes(input.posterMediaId);
          if (!posterValid) throw new HttpError(400, 'MEDIA_INVALID');
        }
      }
```

2. 既有媒体 copy 循环（89-103 行）：视频行 update 另写 `posterMediaId`（dto 保证仅 type=video 可传，此时循环恰 1 行）：

```ts
        await tx
          .update(media)
          .set({
            s3Key: finalKey,
            momentId,
            sortOrder,
            storageMeta: row.storageMeta,
            ...(input.posterMediaId ? { posterMediaId: input.posterMediaId } : {}),
          })
          .where(eq(media.id, row.id));
```

3. 媒体循环之后、`select moments` 之前，poster 绑定分支（copy 复用、update 分开——**不写 sortOrder / storageMeta**）：

```ts
      if (posterRow) {
        const ext = mime.extension(posterRow.mime) || 'bin';
        const finalKey = `chains/${chainId}/${momentId}/${posterRow.id}.${ext}`;
        await storage.copyObject(posterRow.s3Key, finalKey, posterRow.storageMeta);
        copiedTmp.push({ key: posterRow.s3Key, metadata: posterRow.storageMeta });
        // poster 行只绑 momentId + 新 s3Key；sortOrder 保持上传时的值（默认 0），不参与宫格排序
        await tx.update(media).set({ s3Key: finalKey, momentId }).where(eq(media.id, posterRow.id));
      }
```

post-commit tmp 清理循环（120-124 行）不动——poster 的 tmp key 已进 `copiedTmp`。

- [ ] **Step 5: 实现序列化扩展 + poster 行排除**

Modify `apps/server/src/moments/moment-serializer.ts`：

1. `MediaLike`（22-29 行）加字段：

```ts
  /** 视频封面媒体行 id（db 行自带该列，类型对齐即可）；无封面为 null */
  posterMediaId: string | null;
```

2. `momentSerializer` 的 media map（62-70 行）每个元素加：

```ts
        posterMediaId: x.posterMediaId,
        posterUrl: x.posterMediaId ? `/api/media/${x.posterMediaId}` : null,
```

3. `serializeMoments` 组装 `mediaBy` 前构建本页 poster id 集合并在循环中跳过（121-127 行块改为）：

```ts
  // poster 行绑了同一 momentId 会被查出，必须从内容媒体中排除——否则以第 2 条媒体泄漏，
  // 破坏 type=video 恰 1 条视频媒体的契约。排除只存在于批量函数；单条出口消费组装结果。
  const posterIds = new Set(
    mediaRows.map((r) => r.posterMediaId).filter((id): id is string => id !== null)
  );
  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    if (posterIds.has(m.id)) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push(m);
    mediaBy.set(m.momentId, list);
  }
```

- [ ] **Step 6: schema 注释更新**

Modify `apps/server/src/db/schema/media.ts` 24 行注释（不改列定义、不生成迁移）：

```ts
    /** 视频封面（客户端截帧，spec 2026-08-22-video-poster §1）：关联同 moment 的 poster 媒体行；不做 FK 以避免自引用循环 */
    posterMediaId: char('poster_media_id', { length: 36 }),
```

- [ ] **Step 7: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/moments/moment-poster.test.ts tests/moments/moment-serializer.test.ts
```
Expected: 全过。再跑全量防回归：
```bash
pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```
Expected: 均 exit 0（`--runInBand` 串行，远程测试库不并行第二个 jest 会话）。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/moments/moment.service.ts apps/server/src/moments/moment-serializer.ts apps/server/src/db/schema/media.ts apps/server/tests/moments/moment-poster.test.ts apps/server/tests/moments/moment-serializer.test.ts
git commit -m "feat(server): bind poster media in moment create and serialize poster fields"
```

---

### Task 3 (P3): web 截帧组件 + 发布流程 + 消费侧 + 夹具同步

**Files:**
- Create: `apps/web/src/compose/compose-panel/video-poster.tsx`（截帧组件）
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.ts`（poster 草稿状态 + 重置挂载点 + submit 上传）
- Modify: `apps/web/src/compose/compose-panel/index.tsx`（视频预览下挂截帧组件）
- Modify: `apps/web/src/media/MediaBlock.tsx`（`VideoOne` 封面渲染，登录态 + 分享态）
- Test（夹具同步，均补 `posterMediaId: null, posterUrl: null`）:
  - `apps/web/src/timeline/lightbox.test.tsx`（23-27 行 image/video 工厂）
  - `apps/web/src/media/MediaBlock.test.tsx`（25-29 行 image/video 工厂）
  - `apps/web/src/pages/timeline-variants.test.tsx`（153 行 image 工厂）
  - `apps/web/src/pages/chain-home/chain-home.test.tsx`（157 行内联 `MomentMedia` 字面量，非工厂函数，grep `: MomentMedia` 抓不到）

**Interfaces:**
- Consumes: Task 1 的 `MomentMedia.posterMediaId/posterUrl` 与 `CreateMomentInput.posterMediaId`；既有 `client.uploadMedia`（`file: Blob` 形态）；`useMediaObjectUrl(mediaId: string | null)`；compose-panel service 的 `PickedVideo` / `addVideo` / `confirmReplace` / `clearPreviews` / `resetAndClose`。
- Produces:
  - `<VideoPosterPicker previewUrl durationSeconds onChange />`：本地截帧 + 拖动选帧，产出 JPEG Blob；失败静默 `onChange(null)`。
  - `ComposePanelService` 新字段 `posterBlob: Blob | null` / `posterMediaId: string | null`（私有重置贯穿视频重置路径）。

- [ ] **Step 1: 夹具同步（先修编译）**

四个测试文件的 `MomentMedia` 工厂/字面量各补两个字段（值给 `null`）：

- `apps/web/src/timeline/lightbox.test.tsx`（23-27 行）：

```ts
function image(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'image/jpeg', width: 64, height: 48, duration: null, sortOrder: 0, posterMediaId: null, posterUrl: null };
}

function video(id: string): MomentMedia {
  return { id, url: `/api/media/${id}`, mime: 'video/mp4', width: 1280, height: 720, duration: 12, sortOrder: 0, posterMediaId: null, posterUrl: null };
}
```

- `apps/web/src/media/MediaBlock.test.tsx`（25-29 行）：两个工厂同样补 `posterMediaId: null, posterUrl: null`。
- `apps/web/src/pages/timeline-variants.test.tsx`（153 行 image 工厂）：补同两字段。
- `apps/web/src/pages/chain-home/chain-home.test.tsx`（157 行内联字面量）：补同两字段。

Run: `pnpm --filter @moment/web typecheck`
Expected: exit 0（dto 已构建出带新字段的类型；此步前 typecheck 应挂在这 4 个文件，修后通过）。

- [ ] **Step 2: 截帧组件 `video-poster.tsx`**

Create `apps/web/src/compose/compose-panel/video-poster.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';

// 视频封面截帧（spec 2026-08-22-video-poster §3）：复用 service 持有的 previewUrl
// （同一 file 的 object URL，service 统一 revoke），本地 <video> seek + canvas 导出
// JPEG；拖动选帧，默认首帧。截帧失败静默 onChange(null) → 降级为无封面发布，
// 不阻塞发布流程、不出错误弹窗——封面是增强不是门槛。
// 默认首帧在 loadeddata 时直接 capture（不用 loadedmetadata + seek(0)）：视频本就
// 停在 0 时 currentTime=0 是无位移 seek，Safari 系不派发 seeked，且 loadedmetadata
// 时首帧未必已解码可 drawImage——默认缩略图会静默不出现（目标设备是平板/Safari 系）。
// 视觉只消费 token：rounded-surface-md 预览圆角、text-meta/text-muted 文案档。

export function VideoPosterPicker({
  previewUrl,
  durationSeconds,
  onChange,
}: {
  previewUrl: string;
  durationSeconds: number;
  onChange: (blob: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const thumbUrlRef = useRef<string | null>(null);

  const replaceThumb = (url: string | null) => {
    if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    thumbUrlRef.current = url;
    setThumbUrl(url);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('capture unavailable');
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onChange(null);
            replaceThumb(null);
            return;
          }
          onChange(blob);
          replaceThumb(URL.createObjectURL(blob));
        },
        'image/jpeg',
        0.85
      );
    } catch {
      onChange(null); // 解码/导出失败（如 HEVC 本地不可解）→ 静默降级
      replaceThumb(null);
    }
  };

  const seekAndCapture = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      capture();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  };

  // 卸载时回收缩略图 object URL
  useEffect(
    () => () => {
      if (thumbUrlRef.current) URL.revokeObjectURL(thumbUrlRef.current);
    },
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        src={previewUrl}
        muted
        playsInline
        preload="auto"
        className="hidden"
        onLoadedData={() => capture()} // 默认首帧：loadeddata 时首帧已解码可直接 drawImage（原因见文件头注释）
      />
      {thumbUrl && (
        <img src={thumbUrl} alt="视频封面预览" className="max-h-40 w-full rounded-surface-md object-cover" />
      )}
      <label className="flex items-center gap-2 text-meta text-muted">
        封面
        <input
          type="range"
          min={0}
          max={Math.max(durationSeconds, 0.1)}
          step={0.1}
          defaultValue={0}
          aria-label="选择封面帧"
          onChange={(e) => seekAndCapture(Number(e.target.value))}
          className="min-w-0 flex-1"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: service poster 草稿状态 + 重置挂载点**

Modify `apps/web/src/compose/compose-panel/compose-panel.service.ts`：

1. 字段区（`video` 行后）加：

```ts
  /** 封面草稿（spec video-poster §3：与视频选择同生同灭）；截帧失败保持 null = 无封面发布 */
  posterBlob: Blob | null = null;
  posterMediaId: string | null = null;
```

2. 方法（`addVideo` 前）加：

```ts
  /** 截帧组件回调；blob 为 null = 截帧失败降级（静默无封面） */
  setPoster(blob: Blob | null): void {
    this.posterBlob = blob;
    this.posterMediaId = null; // 换帧后已上传的 id 作废（重传；旧行按 §2.4 ready-unbound gap 处理）
  }

  /** 视频重置路径统一调用：丢弃已截帧/已上传的封面草稿（位图与 posterMediaId 一并清空） */
  private resetPoster(): void {
    this.posterBlob = null;
    this.posterMediaId = null;
  }
```

3. 三个挂载点接入 `resetPoster()`：
   - `addVideo`（205-206 行 revoke + 重赋值之间）：`if (this.video) URL.revokeObjectURL(this.video.previewUrl);` 行后加 `this.resetPoster();`
   - `confirmReplace` 的 image 分支（238-239 行）：`this.video = null;` 行后加 `this.resetPoster();`
   - `clearPreviews`（266-267 行）：`this.video = null;` 行后加 `this.resetPoster();`
   - `resetAndClose`（259 行 revoke video 行后）：加 `this.resetPoster();`

4. `submit` 新建分支：视频上传块（327-338 行）之后、`this.progress = '记下…'` 之前插入封面上传（失败降级不阻塞）：

```ts
        if (this.video && this.posterBlob && !this.posterMediaId) {
          try {
            this.progress = '上传封面…';
            const res = await client.uploadMedia({
              file: this.posterBlob,
              mime: 'image/jpeg',
              size: this.posterBlob.size,
              kind: 'image',
            });
            this.posterMediaId = res.mediaId;
          } catch {
            this.posterMediaId = null; // 封面上传失败降级为无封面发布（spec §3）
          }
        }
```

   `createMoment` 调用体（351-361 行）加：

```ts
          ...(this.posterMediaId ? { posterMediaId: this.posterMediaId } : {}),
```

- [ ] **Step 4: 面板组件挂截帧组件**

Modify `apps/web/src/compose/compose-panel/index.tsx`：
- import 区加 `import { VideoPosterPicker } from './video-poster';`
- 视频预览块（152-153 行 `{service.video && (<video ... controls />)}`）之后加：

```tsx
              {service.video && (
                // key 绑 previewUrl：换视频即整体重挂载，避免旧缩略图与滑杆位置残留
                // （滑杆是 uncontrolled defaultValue={0}，不重挂载不会复位）
                <VideoPosterPicker
                  key={service.video.previewUrl}
                  previewUrl={service.video.previewUrl}
                  durationSeconds={service.video.durationSeconds}
                  onChange={(blob) => service.setPoster(blob)}
                />
              )}
```

- [ ] **Step 5: 消费侧 `MediaBlock.tsx` VideoOne 封面**

Modify `apps/web/src/media/MediaBlock.tsx` 的 `VideoOne`（131-163 行）：

1. hook 区加封面 blob（hook 接受 `string | null`，null 不发请求）：

```tsx
  const posterBlobUrl = useMediaObjectUrl(!shareToken && !on ? media.posterMediaId : null);
```

2. 登录态播放按钮（136-149 行）：播放图标层之下加封面 `<img>`（DOM 顺序在 `<span>` 图标层之前）：

```tsx
        {posterBlobUrl && (
          <img src={posterBlobUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
```

3. 分享态 `<video>`（162 行）加原生 poster（`posterUrl` 为 null 时不传属性）：

```tsx
  return (
    <video
      controls
      src={url}
      poster={
        shareToken && media.posterUrl
          ? `${media.posterUrl}?st=${encodeURIComponent(shareToken)}`
          : undefined
      }
      className="aspect-video w-full rounded-surface-lg bg-ink"
    />
  );
```

lightbox 不改（spec §3：autoPlay 直接起播，poster 无意义）。

- [ ] **Step 6: 运行确认**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```
Expected: 均 exit 0（vitest 含 MediaBlock/lightbox/timeline-variants/chain-home 四个被同步的夹具文件，不回归）。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/compose/compose-panel/ apps/web/src/media/MediaBlock.tsx apps/web/src/timeline/lightbox.test.tsx apps/web/src/media/MediaBlock.test.tsx apps/web/src/pages/timeline-variants.test.tsx apps/web/src/pages/chain-home/chain-home.test.tsx
git commit -m "feat(web): capture and render video poster"
```

---

### Task 4 (P4): app 截帧 + 发布流程 + 消费侧

**Files:**
- Modify: `apps/app/package.json`（新增依赖 `expo-video-thumbnails` ~10，SDK 54 兼容线）
- Modify: `apps/app/src/features/compose/compose.service.ts`（poster 草稿 + 截帧 + submit 上传）
- Modify: `apps/app/src/features/compose/index.tsx`（SegmentBar `onChange` 与「移除」按钮改走 `service.clearVideo()`）
- Modify: `apps/app/src/components/MediaGrid.tsx`（视频占位 cell 渲染封面底图）

**Interfaces:**
- Consumes: Task 1 dto 字段；`expo-video-thumbnails` 的 `getThumbnailAsync(uri, { time })`；既有 `uriToBlob`（`apps/app/src/lib/media.ts:30`）；私有 `uploadWithRetry`（`compose.service.ts:14`）；`useMediaUri(mediaId: string | undefined)`（`apps/app/src/lib/use-media-uri.ts:6`——**传参必须 `m.posterMediaId ?? undefined`**）。
- Produces:
  - `ComposeService.poster: { uri: string } | null` / `posterMediaId: string | null` / `clearVideo()`。
  - `MediaGrid` 视频 cell：`posterMediaId` 非空时渲染封面 `<Image>` 底图 + ▶/时长文案层。

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @moment/app exec expo install expo-video-thumbnails`
Expected: `apps/app/package.json` dependencies 新增一行，版本由 expo install 按 SDK 54 的 bundledNativeModules 钉版（不要手钉 `~10.0.8`——与 SDK 54 钉的 `~10.0.7` 有 patch 漂移，expo-doctor 会报依赖不齐）；`pnpm --filter @moment/app typecheck` exit 0。

> **原生模块与开发构建（真机验收前置）**：`expo-video-thumbnails` 是原生模块，而 `apps/app/eas.json` 的 development profile 是 `developmentClient: true`（EAS 开发构建而非 Expo Go），装完依赖后**必须重新构建开发客户端**（`eas build --profile development` 或 `npx expo run:ios`）真机才有该模块；否则运行时 `getThumbnailAsync` 抛 "Cannot find native module"，且该异常会被 capturePoster 的 try/catch 静默吞掉，表现为宫格永远无封面、无任何报错。

- [ ] **Step 2: compose service 截帧 + 重置 + 上传**

Modify `apps/app/src/features/compose/compose.service.ts`：

1. import 区加：

```ts
import * as VideoThumbnails from 'expo-video-thumbnails';
import { compressImage, pickImages, pickVideo, uriToBlob, validateVideo, type PickedVideo, type ReadyImage } from '../../lib/media';
```

（`uriToBlob` 并入既有 `../../lib/media` import 行，不新增一行 import。）

2. 字段区（`video` 行后）加：

```ts
  /** 封面草稿（spec video-poster §4：v1 固定首帧，无选帧 UI；与视频选择同生同灭） */
  poster: { uri: string } | null = null;
  posterMediaId: string | null = null;
```

3. `chooseVideo`（226-233 行）改为覆盖时丢弃旧草稿并对新视频截帧：

```ts
  /** 选视频 + 校验；返回问题文案（null = 成功）。覆盖选择即丢弃上一支视频的封面草稿并重新截帧。 */
  async chooseVideo(): Promise<string | null> {
    const picked = await pickVideo();
    if (!picked) return null;
    const problem = validateVideo(picked);
    if (problem) return problem;
    this.video = picked;
    this.resetPoster();
    void this.capturePoster(picked.uri);
    return null;
  }

  /** 首帧截帧；失败静默降级为无封面发布（spec §4：封面是增强不是门槛） */
  private async capturePoster(videoUri: string): Promise<void> {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
      // 异步返回时视频已更换则丢弃（防串视频）
      if (this.video?.uri === videoUri) this.poster = { uri };
    } catch {
      // 保持 poster = null → 无封面发布
    }
  }

  /** 组件侧置空视频（类型切换 SegmentBar / 「移除」按钮）统一入口：同时丢弃封面草稿 */
  clearVideo(): void {
    this.video = null;
    this.resetPoster();
  }

  private resetPoster(): void {
    this.poster = null;
    this.posterMediaId = null;
  }
```

4. `submit`：媒体上传循环之后、`this.progressLabel = '发布中…'` 之前插入封面上传（复用 `uploadWithRetry`，失败降级）：

```ts
      if (this.type === 'video' && this.poster && !this.posterMediaId) {
        try {
          const blob = await uriToBlob(this.poster.uri);
          const res = await uploadWithRetry({ file: blob, mime: 'image/jpeg', size: blob.size, kind: 'image' });
          this.posterMediaId = res.mediaId;
        } catch {
          this.posterMediaId = null; // 封面上传失败降级为无封面发布
        }
      }
```

   `createMoment` 调用体（303-317 行）加：

```ts
        ...(this.posterMediaId ? { posterMediaId: this.posterMediaId } : {}),
```

- [ ] **Step 3: 组件侧两个置空入口改走 `clearVideo()`**

Modify `apps/app/src/features/compose/index.tsx`：
- SegmentBar `onChange`（93-97 行）：`service.video = null;` 改为 `service.clearVideo();`
- 「移除」按钮（138 行）：`onPress={() => (service.video = null)}` 改为 `onPress={() => service.clearVideo()}`

- [ ] **Step 4: 消费侧 `MediaGrid.tsx` 视频 cell 封面**

Modify `apps/app/src/components/MediaGrid.tsx`：

```tsx
function VideoCell({ m, cellStyle, styles }: { m: MomentMedia; cellStyle: object; styles: ReturnType<typeof createStyles> }) {
  // useMediaUri 签名是 string | undefined（use-media-uri.ts:6）：posterMediaId 为 null 时归一为 undefined，不发请求
  const uri = useMediaUri(m.posterMediaId ?? undefined);
  return (
    <View style={[cellStyle, styles.videoCell]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <Text style={styles.play}>▶</Text>
      {m.duration != null && m.duration > 0 ? <Text style={styles.duration}>{formatDuration(m.duration)}</Text> : null}
      <Text style={styles.videoHint}>视频 · 进详情播放</Text>
    </View>
  );
}
```

`MediaGrid` 的视频分支（28-33 行）改为 `<VideoCell key={m.id} m={m} cellStyle={styles.cell} styles={styles} />`；`videoCell` 样式加 `overflow: 'hidden'`（absoluteFill 封面图裁圆角，颜色仍只消费 `t.ink` 等 token）。**不能用 `posterUrl` 直渲**：原生 Image 不带鉴权头且 headers 会跟过 302 被 S3 拒（`use-media-uri.ts` 注释）。moment 详情页 `VideoView` 不处理（spec §4：进入详情即起播，expo-video 无 poster 语义）。

- [ ] **Step 5: 运行确认**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（lint 含 lint:tokens——新代码禁 hex/rgba）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/package.json apps/app/src/features/compose/ apps/app/src/components/MediaGrid.tsx pnpm-lock.yaml
git commit -m "feat(app): capture first frame as video poster"
```

---

### Task 5 (P5): 全量门禁 + 联调手动验收

**Files:** 无改动（验证批）。

- [ ] **Step 1: 全量构建 + 测试 + lint**

Run（串行执行，server 测试期间不起第二个 jest 会话——远程共享测试库）:
```bash
pnpm build && pnpm test && pnpm lint
```
Expected: 全部 exit 0。`pnpm test` 覆盖 dto（`tsx --test`）、server（jest `--runInBand` 触库）、web（vitest）。

- [ ] **Step 2: web 手动验收清单**（`pnpm dev` 起 server + web）

1. 发布视频 moment：选视频 → 封面滑杆出现、默认首帧缩略图 → 拖到中段松手 → 缩略图更新 → 发布成功 → 时间线该卡播放面显示所选帧封面（深色面 + 封面图 + 播放图标）。
2. 替换视频：选视频 A → 截帧 → 改选视频 B → 缩略图变为 B 首帧 → 发布 → 封面是 B 的帧（不是 A 的）；移除视频改发图文 → 再选视频 → 截帧流程重来。
3. 降级：用本地不可解码的视频（如 HEVC，视测试机而定）或 DevTools 断网让封面上传失败 → 发布仍成功，时间线保持纯深色播放面（无封面、无错误弹窗）。
4. 无封面存量视频：播放面与现状一致（纯深色）。
5. 分享态：建分享链接 → 无痕窗口打开 → 视频直接挂载 `<video>`，首帧画面为 poster（有封面时）；无封面视频行为与现状一致。
6. 宫格（type=media）混排视频：无封面 UI 变化（本期不支持）。

- [ ] **Step 3: app 手动验收清单**（重新构建的开发构建连本地 server）

前置：开发客户端必须已含 `expo-video-thumbnails`（见 Task 4 Step 1 的原生模块说明）——本特性新增原生依赖，需重出 development build，用旧客户端跑下面的清单会看到宫格永远无封面且无任何报错。

1. 发布视频 moment：选视频 → 发布成功 → 链时间线宫格视频 cell 显示首帧封面底图 + ▶/时长文案。
2. 重选视频：选视频 A → 重选视频 B → 发布 → 封面是 B 首帧；类型切到「文字」再切回「视频」→ 旧封面草稿已丢弃。
3. 无封面存量视频：宫格保持 ink 深色占位。
4. moment 详情页：进入即起播，无 poster 行为变化。

- [ ] **Step 4: Commit（如有验证期修补）**

> 本步骤由编排主 Agent 在验收后执行。

```bash
git commit -m "test: verify video poster end to end"
```

---

## DoD（计划级验收）

- [ ] `pnpm build && pnpm test && pnpm lint` 全部 exit 0
- [ ] dto：`type=video` 带/不带 `posterMediaId` 通过；`text`/`media` 传 → `MEDIA_NOT_ALLOWED`；PATCH 传 → `.strict()` 拒绝
- [ ] server：成功路径 poster 行 `momentId` 绑定 + s3_key final 布局 + 视频行 `poster_media_id` 写入 + tmp 清理入队；五个 400 分支（非本人/非 ready/已绑定/video mime/同 id 在 mediaIds）；序列化 media 恰 1 条且 poster 行不泄漏；软删后 poster 行 orphaned
- [ ] web：截帧选帧 → 上传 → 发布时间线封面展示；替换/移除视频丢弃草稿；截帧失败静默降级；分享态 `<video poster>` 带 `?st=`
- [ ] app：首帧截帧 → 上传 → 宫格封面底图；重选/切类型/移除丢弃草稿；`useMediaUri` 传参 `m.posterMediaId ?? undefined`
- [ ] spec §6 夹具同步清单全部落地（web 4 个文件 + server 1 个文件，见下表）
- [ ] 零改动面确认：`packages/api-client`、`apps/server/src/config.ts`、`apps/server/.env.example`、`resetDb()`、`apps/web/src/timeline/lightbox.tsx`、`apps/app/src/features/moment/index.tsx`（详情页 VideoView）均未改

### spec §6 测试夹具同步清单（执行时逐项核对）

| 文件 | 位置 | 补法 |
|---|---|---|
| `apps/web/src/timeline/lightbox.test.tsx` | 23-27 行 image/video 工厂 | `posterMediaId: null, posterUrl: null` |
| `apps/web/src/media/MediaBlock.test.tsx` | 25-29 行 image/video 工厂 | 同上 |
| `apps/web/src/pages/timeline-variants.test.tsx` | 153 行 image 工厂 | 同上 |
| `apps/web/src/pages/chain-home/chain-home.test.tsx` | 157 行内联 `MomentMedia` 字面量（非工厂函数，grep `: MomentMedia` 抓不到） | 同上 |
| `apps/server/tests/moments/moment-serializer.test.ts` | 21-22 行 `MediaLike` 字面量 | `posterMediaId: null` |

补全手段：grep `: MomentMedia` 外加搜索 `sortOrder:` 字面量构造点，tsc 报错是最终判据（`MomentMedia` / `MediaLike` 新字段为必填，漏补即编译失败）。
