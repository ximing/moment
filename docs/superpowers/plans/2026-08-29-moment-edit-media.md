# 编辑已发布时刻图片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者能在编辑已发布时刻时全量替换图片集合：`PATCH /api/moments/:id` 增加可选 `mediaIds`（与 `tagIds` / `personIds` 同形：缺省 = 不变，提交数组 = 新集合）；server 在原 type 约束下绑定/orphan/copy tmp→final，并对新进可压图发既有 `moment.compress`；web / app 编辑态展示可叉可追加的宫格。video / 封面 / 分享页 / 路由 / 表 / 环境变量 / outbox 类型均不动。

**Architecture:** dto 把 `mediaIds` / `posterMediaId` 收进 `patchMomentInputSchema`（仍 `.strict()` 拒 `type`）；数量/mime 构成在 `MomentService.update` 事务内、`FOR UPDATE` 重读 `originalType` 之后按矩阵判定。内容行判定与 `serializeMoments` 相同（排除 poster id）。keep 只重写 `sortOrder`；incoming 复用 create 的 `copyObject` + 可压则 `derivedStatus='pending'` + `emitOutbox(OUTBOX_MOMENT_COMPRESS)`；离开集合的内容行标 `orphaned`（请求线程不删对象）。`handleMomentCompress` 终态 `UPDATE ... WHERE moment_id IS NOT NULL`，ready 路径 0 行则 best-effort `deleteFile(derivedKey)`。sweeper 内部 `destroyMediaObject` 先删 `derivedS3Key` 再删原图。客户端 dirty：未动媒体不传 `mediaIds`；编辑 submit **先串行** `compressImage` + `uploadMedia({ kind:'image' })` **再** `updateMoment`，禁止走 `createMoment`。

**Tech Stack:** zod ^3（dto，`tsx --test`）/ Express + routing-controllers + Drizzle MySQL + Jest `--runInBand`（server）/ Vite + React 19 + Vitest jsdom（web）/ Expo SDK 54 + Vitest（app）。存储测试一律 `installMockStorage()`。无新依赖、无新表、无新环境变量。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-edit-media-design.md`（唯一真相源；§0 锁定决策、§3 dto、§4 事务、§4.6 矩阵、§5 compress/sweeper、§6 web、§7 app、§8 错误码、§9 测试、§11 分期）

**Global Constraints:**

- **T1 与 T2 必须连续落地，禁止只合 dto。** T1 放行合法 uuid `mediaIds` 后，旧 `MomentService.update` 会静默忽略该键（200 且媒体不变）。T1 commit 之后同一执行会话立刻做 T2，禁止把只含 dto 的分支单独部署。
- **CONVENTIONS §3 方法名不得改名/改语义：** `emitOutbox` / `copyObject` / `generateAccessUrl` / `getObject` / `uploadFile` / `deleteFile` / `maybeEmitMomentEmbed` / `serializeMoments` / `handleMomentCompress` / `isCompressibleMime` / `derivedObjectKey` / `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED`。发现冲突停手报告，不得改 CONVENTIONS。
- **不改路由、不新表、不新环境变量、不新 outbox 类型、不扩 `resetDb()` 表清单。** 仍 `PATCH /api/moments/:id`，controller 仍 `patchMomentInputSchema.parse(body)`。
- **客户端不传 `type`、不传 `posterMediaId`。** 传 `type` → dto `.strict()` → 400 `VALIDATION_ERROR`。`posterMediaId`（含 `null`）dto 放行，server 恒 400 `MEDIA_NOT_ALLOWED`。
- **媒体 URL 用响应内预签名 GET**（CONVENTIONS §3.4 现状，`PRESIGN_GET_TTL_SECONDS` 默认 21600）。编辑宫格 `<img src={cardDisplayUrl(m)}>`（`derivedUrl || url`），不要写回「不得内嵌预签名」，不要登录态 fetch blob。
- **`originalType` 必须来自 `tx.select().from(moments).for('update')` 之后的 `locked.type`。** 禁止用事务外 `m.type` 进矩阵 / video 闸门 / 写 type。否则并发 `mediaIds:[]` 会按过期 `text` 把刚升级的 media 删空。
- **编辑/新建容量公式拆开。** 编辑只用 `edit.type` + `keptMedia`（`editImageCap` / `editOccupied`）；新建 web 仍 `this.voice ? 8 : 9`，新建 app 仍 `this.type === 'voice' ? 8 : 9`。禁止编辑读 `this.voice`（hydrate 已清空，否则 voice 编辑 cap=9）。禁止把 `audio/*` 推进 `keptMedia`。
- **PATCH incoming 不要抄 create 循环里给内容行写 `posterMediaId` 的那一枝。** 不 orphan / 不改写 poster 行。
- **`handleMomentCompress` 只改两处：** 终态 UPDATE 加 `moment_id IS NOT NULL`；ready 路径 `affectedRows===0` 时不 `maybeEmitMomentEmbed`、best-effort `deleteFile(derivedKey)`。函数签名、payload、sharp、GIF 跳过规则不动。
- **`destroyMediaObject` 保持模块内部函数，不 export、不新 sweeper 入口。**
- 客户端编辑 submit：**禁止走 `createMoment`。** web：先按宫格从左到右串行 `compressImage` + `uploadMedia({ kind:'image' })` 再 `updateMoment`。app：`pickMoreImages` 已 `compressImage`，`submitEdit` 只串行 `uploadWithRetry({ kind:'image' })` 再 `updateMoment`。已有格不重传。
- PATCH `mediaIds` 元素必须是真 uuid（`z.string().uuid()`）；create 仍接受 `'m-1'`，**create 不改**。测试夹具禁止照抄 create 的 `'m-1'`。
- server 触库：`pnpm --filter @moment/server test -- <files>`（脚本已含 `--runInBand`），`afterAll(closeDb)` + `beforeEach(resetDb)`，只打 `.env` 测试库。存储 `installMockStorage()`。不打 DashScope、不读真实像素。
- web UI 只消费已发布 token / `Button` / `IconButton` / `Field` / `Sheet` / `Banner`；禁止十六进制、一次性 `h-[…]`、负边距。存量宫格视频占位：`bg-ink` + `text-bg`「视频」。分享页 `readOnly` 不改。
- 每 Task 一个 commit（下表 message 逐字）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **无产品偏差。** dto 字段、矩阵、错误码、compress/sweeper 补丁、web/app dirty 与容量公式均按 spec §0/§3/§4/§5/§6/§7 落地。
2. **step 10 写 `type` 可以单独一次 `tx.update(moments).set({ type:'media' })`，也可并入稍后写 content 的那次 UPDATE。** 必须同一 `db.transaction`、FOR UPDATE 之后、`maybeEmitMomentEmbed` 之前。不另开事务、不先于锁写 type、不要用事务外 `m.type` 覆盖回来。
3. **`handleMomentCompress` 的 skipped / failed 在 `affectedRows===0` 时同样不 `maybeEmitMomentEmbed`**（与 spec §5.1「0 行：不 maybeEmitMomentEmbed，handler 正常返回」对齐）。skipped/failed 仍不 `uploadFile`、不 `deleteFile(derivedKey)`。
4. **app `submitEdit` 不再次 `compressImage`：** `pickMoreImages` 已把图压成 `ReadyImage`；submit 只串行 `uploadWithRetry({ kind:'image' })` 再 `updateMoment`。web submit 仍是 `compressImage` + `uploadMedia` + `updateMoment`。

---

## File map

| 路径 | 职责 |
|---|---|
| `packages/dto/src/moments.ts` | `patchMomentInputSchema` 收 `mediaIds` / `posterMediaId`，superRefine 去重/超 9 |
| `packages/dto/src/moments.test.ts` | PATCH 契约；create 矩阵不回归 |
| `packages/api-client/src/client.test.ts` | `updateMoment` JSON 带 `mediaIds` |
| `apps/server/src/moments/moment.service.ts` | `update` 媒体全量替换 |
| `apps/server/src/media/handle-moment-compress.ts` | 终态 WHERE + ready 0 行删 derivedKey |
| `apps/server/src/worker/sweeper.ts` | 内部 `destroyMediaObject` 删派生 |
| `apps/server/tests/moments/moment-update-media.test.ts` | 新建：矩阵 / 并发 / copy / orphan |
| `apps/server/tests/moments/moment-list-crud.test.ts` | 「媒体不可改」断言改为非 uuid → `VALIDATION_ERROR` |
| `apps/server/tests/moments/moment-poster.test.ts` | PATCH poster → `MEDIA_NOT_ALLOWED` |
| `apps/server/tests/moments/moment-compress-emit.test.ts` | PATCH 正文不 compress；追加 JPEG 才发 |
| `apps/server/tests/moments/moment-embed-emit.test.ts` | 删已终态图 → embed；只改正文不回归 |
| `apps/server/tests/worker/handle-moment-compress.test.ts` | orphan 窗口 0 行 |
| `apps/server/tests/worker/sweeper.test.ts` | `deletedObjects` 按每次成功 `deleteFile` +1 |
| `apps/web/src/compose/compose-panel/compose-panel.service.ts` | hydrate / cap / dirty / submit |
| `apps/web/src/compose/compose-panel/index.tsx` | 编辑宫格 + 粘贴/拖放 |
| `apps/web/src/compose/compose-panel/compose-panel.service.test.ts` | dirty / cap / 上传顺序 |
| `apps/web/src/lib/errors.ts` | `MEDIA_INVALID` / `MEDIA_NOT_ALLOWED` |
| `apps/web/src/pages/chain-home/chain-home.test.tsx` | 编辑入口文案 |
| `apps/app/src/features/compose/compose.service.ts` | `loadForEdit` / cap / `submitEdit` |
| `apps/app/src/features/compose/index.tsx` | 编辑宫格 |
| `apps/app/src/features/compose/compose.service.test.ts` | 新建 |
| `apps/app/src/components/MediaGrid.tsx` | 可选 `onRemove` |
| `apps/app/src/lib/media.ts` | `pickImages({ selectionLimit })` |
| `apps/app/src/lib/errors.ts` | 与 web 相同两句 copy |

**本计划明确不改：** `moment.controller.ts` 路由与方法名、`createMomentInputSchema`、`MomentMedia` / `MomentResponse` 形状、`outbox/types.ts`、`config.ts` / `.env*`、`resetDb()`、分享页、create 混排视频能力、`handleMomentEmbed`、转写路径、宫格拖拽 UI。

---

### Task 1: dto — PATCH 放行 `mediaIds` / `posterMediaId`，仍拒 `type`

**Files:**
- Modify: `packages/dto/src/moments.ts`
- Test: `packages/dto/src/moments.test.ts`
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: 既有 `patchMomentInputSchema`（`.strict()` + `EMPTY_PATCH` refine）、`createMomentInputSchema`、`packages/api-client` `updateMoment(momentId: string, input: PatchMomentInput): Promise<MomentResponse>`（无手写字段副本）。
- Produces（T2–T4 消费，不得改名）:
  - `PatchMomentInput.mediaIds?: string[]`
  - `PatchMomentInput.posterMediaId?: string | null`
  - `UpdateMomentInput` 仍 `= PatchMomentInput`
  - `.strict()` 仍拒绝 `type` 与其它未知键
  - `EMPTY_PATCH` refine 不变：`Object.values` 至少一项非 `undefined`；`{ mediaIds: [] }` 与 `{ posterMediaId: null }` 都是有效非空补丁
  - `mediaIds` 去重失败或 `length > 9` → superRefine issue `message === 'MEDIA_COUNT_INVALID'`、`path === ['mediaIds']`（不要 `z.array().max(9)` 的 `too_big`）

- [ ] **Step 1: 写失败测试 — dto**

`packages/dto/src/moments.test.ts` 里已有 `UUID_A` / `UUID_B`（约 L208）。把现网这两条改掉（名称与断言都改，否则 T1 落地后「未知键」语义撒谎）：

1. 原测试 `patchMomentInputSchema：仅四个字段、全 optional、.strict() 拒绝未知键（mediaIds/type）；空对象拒绝` 改为：

```ts
test('patchMomentInputSchema：.strict() 仍拒绝 type 与未知键；空对象 EMPTY_PATCH；mediaIds 非 uuid 失败', () => {
  assert.ok(patchMomentInputSchema.safeParse({ content: 'new' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({}).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'text' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ type: 'media' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ hacker: 1 }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ mediaIds: ['m-1'] }).success); // 非 uuid，不是未知键
});
```

2. 原测试 `patchMomentInputSchema：.strict() 拒绝 posterMediaId（封面发布后不可改）` **整段替换为**：

```ts
test('patchMomentInputSchema：posterMediaId uuid / null 通过 parse（server 再抛 MEDIA_NOT_ALLOWED）', () => {
  assert.ok(patchMomentInputSchema.safeParse({ posterMediaId: UUID_A }).success);
  assert.ok(patchMomentInputSchema.safeParse({ posterMediaId: null }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ posterMediaId: 'poster-1' }).success); // 非 uuid
});
```

3. 在 `UUID_A` / `UUID_B` 定义之后追加（夹具必须是真 uuid，禁止 `'m-1'`）：

```ts
const UUIDS10 = Array.from(
  { length: 10 },
  (_, i) => `123e4567-e89b-12d3-a456-4266141740${String(i).padStart(2, '0')}`,
);

test('patchMomentInputSchema：mediaIds 单 uuid / 空数组通过；仅 mediaIds 不是 EMPTY_PATCH', () => {
  assert.ok(patchMomentInputSchema.safeParse({ mediaIds: [UUID_A] }).success);
  assert.ok(patchMomentInputSchema.safeParse({ mediaIds: [] }).success);
  const emptyArr = patchMomentInputSchema.parse({ mediaIds: [] });
  assert.deepEqual(emptyArr.mediaIds, []);
});

test('patchMomentInputSchema：mediaIds 10 条 / 重复 id → 失败且 issue MEDIA_COUNT_INVALID', () => {
  const tooLong = patchMomentInputSchema.safeParse({ mediaIds: UUIDS10 });
  assert.ok(!tooLong.success);
  if (!tooLong.success) {
    assert.ok(tooLong.error.issues.some((i) => i.message === 'MEDIA_COUNT_INVALID' && i.path[0] === 'mediaIds'));
  }
  const dup = patchMomentInputSchema.safeParse({ mediaIds: [UUID_A, UUID_A] });
  assert.ok(!dup.success);
  if (!dup.success) {
    assert.ok(dup.error.issues.some((i) => i.message === 'MEDIA_COUNT_INVALID' && i.path[0] === 'mediaIds'));
  }
});

test('createMomentInputSchema：mediaIds 仍接受 m-1（create 不改）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, type: 'media', content: '', mediaIds: ['m-1'] }).success);
});
```

既有 create 用例（text 拒 mediaIds、voice 1–9、`'m-1'` 重复）不要改。既有 `patchMomentInputSchema：.strict() 拒绝 transcript / transcriptionStatus` 保留。

- [ ] **Step 2: 写失败测试 — api-client**

`packages/api-client/src/client.test.ts` 在 `moments/feed/tags 路径与查询参数` 测试之后追加：

```ts
test('updateMoment PATCH JSON 体能带 mediaIds', async () => {
  const { client, calls } = harness();
  const mediaId = '123e4567-e89b-12d3-a456-426614174000';
  await client.updateMoment('m1', { mediaIds: [mediaId] });
  assert.equal(calls[0]!.method, 'PATCH');
  assert.equal(calls[0]!.url, 'http://x/api/moments/m1');
  assert.deepEqual(calls[0]!.body, { mediaIds: [mediaId] });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/dto test`

Expected: FAIL——`mediaIds 单 uuid / 空数组通过`（未知键）、`posterMediaId uuid / null 通过 parse`（未知键）。`mediaIds 非 uuid` / `type` 拒绝在实现前因 strict 偶然为绿，属预期。

- [ ] **Step 4: 最小实现 `patchMomentInputSchema`**

`packages/dto/src/moments.ts`：把 `patchMomentInputSchema` 的 object **追加两字段**（放在 `payload` 之后），然后 `.strict()` → `.superRefine` → 既有 `.refine(EMPTY_PATCH)`。`.strict()` 注释从「未知键（含 mediaIds/type）」改为「未知键（含 type）直接 VALIDATION_ERROR」：

```ts
    /**
     * PATCH 全量替换内容媒体（与 tagIds / personIds 对齐）：
     * undefined = 不变；提交数组 = 新集合（可 []）。数量/mime 构成在 server 按原 type 判。
     * 元素必须是 uuid（比 create 的 z.string().min(1) 更严；create 不改）。
     */
    mediaIds: z.array(z.string().uuid()).optional(),
    /**
     * 封面。dto 放行（含 null）以便 server 抛 MEDIA_NOT_ALLOWED；
     * 本字段任意有值（uuid 或 null）都不改 poster 行。
     */
    posterMediaId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.mediaIds === undefined) return;
    if (new Set(val.mediaIds).size !== val.mediaIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    if (val.mediaIds.length > 9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), { message: 'EMPTY_PATCH' });
```

不要给 `mediaIds` 加 `.max(9)`。不要改 `createMomentInputSchema`。不要改 `MomentMedia` / `MomentResponse`。

api-client **零实现**：`updateMoment` 已把 `PatchMomentInput` 原样当 JSON body。

- [ ] **Step 5: 运行确认通过**

Run:

```
pnpm --filter @moment/dto test
pnpm --filter @moment/dto build
pnpm --filter @moment/api-client test
```

Expected: PASS。`createMomentInputSchema：mediaIds 仍接受 m-1` 绿。

- [ ] **Step 6: Commit**

```
feat(dto): allow mediaIds on moment patch
```

Add: `packages/dto/src/moments.ts`、`packages/dto/src/moments.test.ts`、`packages/api-client/src/client.test.ts`（及 dto dist，若仓库把 build 产物当工作树的一部分则随现网惯例；不要提交 `apps/server/.env`）。

**本 commit 不合入可部署的 server 镜像单独上线。** 立刻执行 Task 2。

---

### Task 2: server — PATCH 全量替换内容媒体 + compress 窗口 + sweeper 派生对象

**Files:**
- Modify: `apps/server/src/moments/moment.service.ts`
- Modify: `apps/server/src/media/handle-moment-compress.ts`
- Modify: `apps/server/src/worker/sweeper.ts`
- Create: `apps/server/tests/moments/moment-update-media.test.ts`
- Modify: `apps/server/tests/moments/moment-list-crud.test.ts`
- Modify: `apps/server/tests/moments/moment-poster.test.ts`
- Modify: `apps/server/tests/moments/moment-compress-emit.test.ts`
- Modify: `apps/server/tests/moments/moment-embed-emit.test.ts`
- Modify: `apps/server/tests/worker/handle-moment-compress.test.ts`
- Modify: `apps/server/tests/worker/sweeper.test.ts`

**Interfaces:**
- Consumes:
  - T1 `PatchMomentInput.mediaIds?: string[]` / `posterMediaId?: string | null`
  - `MomentService.update(userId: string, momentId: string, input: PatchMomentInput): Promise<MomentResponse>`（签名不改）
  - `ChainPolicy.require(userId, chainId, 'viewer')`（鉴权顺序不改：成员 → 软删 410 → 作者）
  - `getStorage().copyObject(srcKey, destKey, metadata?)` / `deleteFile(key, metadata?)` / `uploadFile(key, buffer)`
  - `emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>`
  - `OUTBOX_MOMENT_COMPRESS` payload `{ momentId, chainId, mediaId }`（camelCase）
  - `maybeEmitMomentEmbed(tx: DbTx, momentId: string): Promise<void>`
  - `isCompressibleMime(mime: string): boolean` / `derivedObjectKey(chainId, momentId, mediaId): string`
  - `tx.select().from(moments).where(eq(moments.id, momentId)).limit(1).for('update')`
  - create 的 tmp→final：`ext = mime.extension(row.mime) || 'bin'`；`finalKey = \`chains/${chainId}/${momentId}/${row.id}.${ext}\``
- Produces:
  - `input.posterMediaId !== undefined`（含 `null`）→ `HttpError(400, 'MEDIA_NOT_ALLOWED')`，开事务前，不写库
  - `input.mediaIds === undefined` → 跳过整段媒体逻辑（不锁媒体、不改 type、不发 compress）；末尾仍 `maybeEmitMomentEmbed`
  - `mediaIds` 有值：`originalType = locked.type`（FOR UPDATE 后）；`originalType === 'video'` → `HttpError(400, 'MEDIA_NOT_ALLOWED')`（含 `[]`）
  - 矩阵失败：`MEDIA_COUNT_INVALID`（原 media 结果 0 条）或 `MEDIA_INVALID`（行/mime/voice 音频）；校验失败零 copy、零 orphan
  - 成功路径：keep 只改 `sortOrder`；incoming copy + 绑定 + 可压则 pending + compress outbox；离开集合 `momentId=null, status='orphaned', orphanedAt=now`；仅 `originalType==='text' && mediaIds.length>=1` 时 `type='media'`
  - `handleMomentCompress` 签名不变；ready 0 行不 embed、`deleteFile(derivedKey)`
  - `destroyMediaObject` 仍 `async function destroyMediaObject(row: Media, result: SweepResult): Promise<boolean>`（不 export）；`SweepResult.deletedObjects` 每成功一次 `deleteFile` +1

- [ ] **Step 1: 改现网断言（失败测试的一部分）**

`apps/server/tests/moments/moment-list-crud.test.ts` 用例 `作者可改 content/happenedAt/isBackfill，媒体不可改`：content 200 保留；把 `mediaIds: ['x']` 段改为显式 `VALIDATION_ERROR`（非 uuid，不再当未知键）：

```ts
    const mediaPatch = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ mediaIds: ['x'] });
    expect(mediaPatch.status).toBe(400);
    expect(mediaPatch.body.error.code).toBe('VALIDATION_ERROR');
```

标题可改为 `作者可改 content/happenedAt/isBackfill；非 uuid mediaIds → VALIDATION_ERROR`。合法 uuid 矩阵放到新建文件。

`apps/server/tests/moments/moment-poster.test.ts` 用例 `PATCH 传 posterMediaId → 400 VALIDATION_ERROR（封面发布后不可改）` **整段替换为**：

```ts
  it('PATCH 传 posterMediaId → 400 MEDIA_NOT_ALLOWED；视频行 / poster 行 momentId 与 s3_key 未动', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    const [beforeV] = await db.select().from(media).where(eq(media.id, videoId));
    const [beforeP] = await db.select().from(media).where(eq(media.id, posterId));
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ posterMediaId: posterId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [afterV] = await db.select().from(media).where(eq(media.id, videoId));
    const [afterP] = await db.select().from(media).where(eq(media.id, posterId));
    expect(afterV.momentId).toBe(created.body.id);
    expect(afterP.momentId).toBe(created.body.id);
    expect(afterV.s3Key).toBe(beforeV.s3Key);
    expect(afterP.s3Key).toBe(beforeP.s3Key);
  });

  it('PATCH posterMediaId: null → 400 MEDIA_NOT_ALLOWED；视频/poster 行未动', async () => {
    const { chainId, videoId, posterId } = await setup();
    const created = await postMoment(alice.token, chainId, videoBody(videoId, posterId));
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ posterMediaId: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [v] = await db.select().from(media).where(eq(media.id, videoId));
    const [p] = await db.select().from(media).where(eq(media.id, posterId));
    expect(v.momentId).toBe(created.body.id);
    expect(p.momentId).toBe(created.body.id);
  });
```

`apps/server/tests/moments/moment-compress-emit.test.ts` 原用例 `PATCH 不 emit compress（不能改媒体）` **拆成三条**（保留「只改正文」那条的意图，并补追加/keep）：

```ts
  it('PATCH 只改正文 → compress 行数不变', async () => {
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

  it('PATCH 追加 JPEG → 新 compress payload {momentId,chainId,mediaId} 且新行 derivedStatus=pending', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [oldId],
    });
    const newId = await readyImage(alice.token);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mediaIds: [oldId, newId] });
    expect(patched.status).toBe(200);
    const jobs = await compressRows();
    expect(jobs).toHaveLength(2);
    const payloads = jobs.map((j) => j.payload as { momentId: string; chainId: string; mediaId: string });
    expect(payloads).toEqual(
      expect.arrayContaining([
        { momentId: created.body.id, chainId, mediaId: oldId },
        { momentId: created.body.id, chainId, mediaId: newId },
      ]),
    );
    expect((await db.select().from(media).where(eq(media.id, newId)))[0].derivedStatus).toBe('pending');
  });

  it('PATCH keep 的旧 JPEG 不第二行 compress', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [oldId],
    });
    expect(await compressRows()).toHaveLength(1);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mediaIds: [oldId] });
    expect(patched.status).toBe(200);
    expect(await compressRows()).toHaveLength(1);
    const [row] = await db.select().from(media).where(eq(media.id, oldId));
    expect(row.momentId).toBe(created.body.id);
    expect(row.status).toBe('ready');
  });
```

`apps/server/tests/moments/moment-embed-emit.test.ts` 在文件末尾追加（既有「PATCH 正文且无 pending → 再发 embed」保留不回归）：

```ts
  it('两张已 skipped 的 media 时刻 PATCH 删一张 → 新 moment.embed', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const a = await readyImage(alice.token);
    const b = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [a, b],
    });
    expect(created.status).toBe(201);
    await db.update(media).set({ derivedStatus: 'skipped' }).where(eq(media.id, a));
    await db.update(media).set({ derivedStatus: 'skipped' }).where(eq(media.id, b));
    expect(await embedJobs()).toHaveLength(0); // create 时 pending 挡住
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mediaIds: [a] });
    expect(patched.status).toBe(200);
    expect(await embedJobs()).toHaveLength(1);
    expect((await embedJobs())[0].payload).toEqual({ momentId: created.body.id, chainId });
  });
```

- [ ] **Step 2: 写失败测试 — `moment-update-media.test.ts`（新建）**

Create `apps/server/tests/moments/moment-update-media.test.ts`。夹具对齐 `create-moment.test.ts` / `create-voice-moment.test.ts` / `moment-poster.test.ts`（`listenLocal(createApp())`、`installMockStorage`、`readyImage` / 直插 video、`afterAll(closeDb)`）。完整文件：

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EXTRACT, OUTBOX_MOMENT_TRANSCRIBE } from '../../src/outbox/types.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

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

async function readyImage(token: string, mime = 'image/jpeg', size = 1024): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size, kind: 'image' });
  storage.headObject.mockResolvedValue({ size, contentType: mime, lastModified: new Date() });
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
  return presigned.body.mediaId as string;
}

async function readyAudio(token: string): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12 });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
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

async function insertMimeRow(uploaderId: string, mime: string, status: 'ready' | 'uploading' = 'ready'): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.bin`,
    mime,
    size: 1024,
    status,
    storageMeta: {},
  });
  return id;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

function patchMoment(token: string, momentId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/moments/${momentId}`).set('Authorization', `Bearer ${token}`).send(body);
}

const happened = {
  happenedAt: '2026-08-29T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('PATCH /api/moments/:id mediaIds（spec 2026-08-29-moment-edit-media §4 / §4.6 / §9）', () => {
  it('text + 1 张 JPEG → 200、type=media、tmp→final key、orphan 无', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const imageId = await readyImage(alice.token);
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [imageId] });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('media');
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual([imageId]);
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.momentId).toBe(text.body.id);
    expect(row.status).toBe('ready');
    expect(row.s3Key).toBe(`chains/${chainId}/${text.body.id}/${imageId}.jpeg`);
    expect(row.orphanedAt).toBeNull();
    expect(storage.copyObject).toHaveBeenCalled();
  });

  it('text + [] → 200、type=text（锁后仍是 text）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('text');
    expect(res.body.media).toEqual([]);
  });

  it('text + 非全部 image（video/pdf）→ 400 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const videoId = await insertReadyVideo(alice.id);
    const pdfId = await insertMimeRow(alice.id, 'application/pdf');
    const asVideo = await patchMoment(alice.token, text.body.id, { mediaIds: [videoId] });
    expect(asVideo.status).toBe(400);
    expect(asVideo.body.error.code).toBe('MEDIA_INVALID');
    const asPdf = await patchMoment(alice.token, text.body.id, { mediaIds: [pdfId] });
    expect(asPdf.status).toBe(400);
    expect(asPdf.body.error.code).toBe('MEDIA_INVALID');
    const [m] = await db.select().from(moments).where(eq(moments.id, text.body.id));
    expect(m.type).toBe('text');
  });

  it('media 删到 0 → 400 MEDIA_COUNT_INVALID，原行仍绑着', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [imageId] });
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_COUNT_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.momentId).toBe(created.body.id);
    expect(row.status).toBe('ready');
  });

  it('media 换图：旧行 orphaned + momentId null + orphanedAt 非空；新行绑上；响应顺序 = 提交顺序', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [oldId] });
    const newA = await readyImage(alice.token);
    const newB = await readyImage(alice.token);
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [newB, newA] });
    expect(res.status).toBe(200);
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual([newB, newA]);
    const [oldRow] = await db.select().from(media).where(eq(media.id, oldId));
    expect(oldRow.status).toBe('orphaned');
    expect(oldRow.momentId).toBeNull();
    expect(oldRow.orphanedAt).not.toBeNull();
    expect(oldRow.s3Key).toMatch(/^chains\//); // 不改 s3_key，留给 sweeper
    const [a] = await db.select().from(media).where(eq(media.id, newA));
    const [b] = await db.select().from(media).where(eq(media.id, newB));
    expect(a.momentId).toBe(created.body.id);
    expect(b.momentId).toBe(created.body.id);
    expect(b.sortOrder).toBe(0);
    expect(a.sortOrder).toBe(1);
  });

  it('拖其它 moment 的图 / 非本人 / uploading / pdf → MEDIA_INVALID，目标时刻媒体不变', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const keepId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [keepId] });
    const otherImg = await readyImage(alice.token);
    await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, happenedAt: '2026-08-29T11:00:00+08:00', mediaIds: [otherImg] });
    const bobImg = await readyImage(bob.token);
    const uploading = await insertMimeRow(alice.id, 'image/jpeg', 'uploading');
    const pdf = await insertMimeRow(alice.id, 'application/pdf');
    for (const id of [otherImg, bobImg, uploading, pdf]) {
      const res = await patchMoment(alice.token, created.body.id, { mediaIds: [id] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEDIA_INVALID');
    }
    const [keep] = await db.select().from(media).where(eq(media.id, keepId));
    expect(keep.momentId).toBe(created.body.id);
    expect(keep.status).toBe('ready');
  });

  it('voice：改附图成功且 audio id 仍在集合中；缺 audio / 换 audio / 其余项非 image → MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const audioId = await readyAudio(alice.token);
    const img1 = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'voice',
      content: '',
      ...happened,
      mediaIds: [audioId, img1],
    });
    const img2 = await readyImage(alice.token);
    const ok = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, img2] });
    expect(ok.status).toBe(200);
    expect(ok.body.type).toBe('voice');
    expect(ok.body.media.map((m: { id: string }) => m.id).sort()).toEqual([audioId, img2].sort());
    expect(ok.body.media.some((m: { id: string }) => m.id === audioId)).toBe(true);

    const missing = await patchMoment(alice.token, created.body.id, { mediaIds: [img2] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MEDIA_INVALID');

    const otherAudio = await readyAudio(alice.token);
    const swapped = await patchMoment(alice.token, created.body.id, { mediaIds: [otherAudio, img2] });
    expect(swapped.status).toBe(400);
    expect(swapped.body.error.code).toBe('MEDIA_INVALID');

    const videoId = await insertReadyVideo(alice.id);
    const withVideo = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, videoId] });
    expect(withVideo.status).toBe(400);
    expect(withVideo.body.error.code).toBe('MEDIA_INVALID');

    const empty = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_INVALID');

    const [audioRow] = await db.select().from(media).where(eq(media.id, audioId));
    expect(audioRow.momentId).toBe(created.body.id);
    expect(audioRow.status).toBe('ready');
  });

  it('video + mediaIds（含 []）→ MEDIA_NOT_ALLOWED；视频行与 poster 行未动', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      ...happened,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    const [beforeV] = await db.select().from(media).where(eq(media.id, videoId));
    const [beforeP] = await db.select().from(media).where(eq(media.id, posterId));
    const withIds = await patchMoment(alice.token, created.body.id, { mediaIds: [posterId] });
    expect(withIds.status).toBe(400);
    expect(withIds.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const empty = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [afterV] = await db.select().from(media).where(eq(media.id, videoId));
    const [afterP] = await db.select().from(media).where(eq(media.id, posterId));
    expect(afterV.momentId).toBe(created.body.id);
    expect(afterP.momentId).toBe(created.body.id);
    expect(afterV.s3Key).toBe(beforeV.s3Key);
    expect(afterP.s3Key).toBe(beforeP.s3Key);
  });

  it('提交 poster id（其它时刻的封面行）→ MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      ...happened,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    const text = await postMoment(alice.token, chainId, { type: 'text', content: 'x', ...happened, happenedAt: '2026-08-29T12:00:00+08:00' });
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [posterId] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('并发 tmp 行：同一 tmp 被两个 PATCH 抢，后到 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const a = await postMoment(alice.token, chainId, { type: 'text', content: 'A', ...happened });
    const b = await postMoment(alice.token, chainId, { type: 'text', content: 'B', ...happened, happenedAt: '2026-08-29T11:00:00+08:00' });
    const tmp = await readyImage(alice.token);
    const [r1, r2] = await Promise.all([
      patchMoment(alice.token, a.body.id, { mediaIds: [tmp] }),
      patchMoment(alice.token, b.body.id, { mediaIds: [tmp] }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);
    const failed = r1.status === 400 ? r1 : r2;
    expect(failed.body.error.code).toBe('MEDIA_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, tmp));
    expect(row.momentId === a.body.id || row.momentId === b.body.id).toBe(true);
  });

  it('并发 type：text 同时 PATCH [jpeg] 与 [] → 禁止 type=media 且 0 条内容图', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '并发', ...happened });
    const jpeg = await readyImage(alice.token);
    await Promise.all([
      patchMoment(alice.token, text.body.id, { mediaIds: [jpeg] }),
      patchMoment(alice.token, text.body.id, { mediaIds: [] }),
    ]);
    const [row] = await db.select().from(moments).where(eq(moments.id, text.body.id));
    const bound = await db.select().from(media).where(eq(media.momentId, text.body.id));
    expect(row.type === 'media' && bound.length === 0).toBe(false);
    if (row.type === 'media') {
      expect(bound.some((m) => m.id === jpeg)).toBe(true);
    }
  });

  it('顺序：先 200 升级再 PATCH [] → MEDIA_COUNT_INVALID 且 jpeg 仍绑定', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '升级', ...happened });
    const jpeg = await readyImage(alice.token);
    const up = await patchMoment(alice.token, text.body.id, { mediaIds: [jpeg] });
    expect(up.status).toBe(200);
    expect(up.body.type).toBe('media');
    const empty = await patchMoment(alice.token, text.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_COUNT_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, jpeg));
    expect(row.momentId).toBe(text.body.id);
    expect(row.status).toBe('ready');
  });

  it('GIF/HEIC/HEIF 新进：不 compress、derived_status NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const mimes = ['image/gif', 'image/heic', 'image/heif'] as const;
    for (let i = 0; i < mimes.length; i++) {
      const mime = mimes[i]!;
      const text = await postMoment(alice.token, chainId, {
        type: 'text',
        content: mime,
        ...happened,
        happenedAt: `2026-08-29T1${i}:00:00+08:00`,
      });
      const id = await readyImage(alice.token, mime);
      const res = await patchMoment(alice.token, text.body.id, { mediaIds: [id] });
      expect(res.status).toBe(200);
      expect((await db.select().from(media).where(eq(media.id, id)))[0].derivedStatus).toBeNull();
      const jobs = await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));
      expect(jobs.filter((j) => (j.payload as { mediaId: string }).mediaId === id)).toHaveLength(0);
    }
  });

  it('只改 mediaIds 不改正文 → 不因媒体变化多发 moment.extract；voice 不重发 transcribe', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const audioId = await readyAudio(alice.token);
    const img1 = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'voice',
      content: '',
      ...happened,
      mediaIds: [audioId, img1],
    });
    // 模拟 extract worker 已消费：hash 已写。create 后 hash 仍 NULL 时，现网任意成功 PATCH
    // 都会再发一行 extract（moment.service 注释「重复 PATCH 同内容在消费前会重复发射」）。
    // 不先写 hash，本断言会在正确实现上假红，误导去改 extract 发射条件。
    await db
      .update(moments)
      .set({ aiExtractHash: computeAiExtractHash('', null) })
      .where(eq(moments.id, created.body.id));
    const extractBefore = (await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EXTRACT))).length;
    const transcribeBefore = (await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_TRANSCRIBE))).length;
    const img2 = await readyImage(alice.token);
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, img2] });
    expect(res.status).toBe(200);
    expect((await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EXTRACT))).length).toBe(extractBefore);
    expect((await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_TRANSCRIBE))).length).toBe(transcribeBefore);
  });

  it('矩阵失败零 copy：media [] 不调用 copyObject', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [imageId] });
    storage.copyObject.mockClear();
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(res.status).toBe(400);
    expect(storage.copyObject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 写失败测试 — compress handler 孤儿窗口**

`apps/server/tests/worker/handle-moment-compress.test.ts` 追加（`seed` / `jpegOf` / `derivedCols` / `derivedObjectKey` 已在文件内；`storage` 是 `installMockStorage()`）：

```ts
  it('orphan 后再走完 ready：UPDATE 0 行、不发 embed、派生列不写到 orphan 行、deleteFile 收到 derivedObjectKey', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    const embedBefore = (await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).length;
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    const cols = await derivedCols(mediaId);
    expect(cols.derivedStatus).toBe('pending'); // seed 默认 pending，禁止写成 ready
    expect(cols.derivedS3Key).toBeNull();
    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.momentId).toBeNull();
    expect(row.status).toBe('orphaned');
    expect(storage.deleteFile).toHaveBeenCalledWith(derivedObjectKey(chainId, momentId, mediaId), TEST_META);
    expect((await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).length).toBe(embedBefore);
  });

  it('ready 路径 deleteFile 失败只 warn，handler 不抛', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const { mediaId, momentId, chainId } = await seed({ size: jpeg.length });
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 down'));
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).resolves.toBeUndefined();
  });

  it('skipped 路径 0 行不调用这次 deleteFile（无 upload）', async () => {
    const jpeg = await jpegOf(64, 48);
    const { mediaId, momentId, chainId } = await seed({ size: 1 }); // 压缩后必 ≥ 1 → skipped
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      return jpeg;
    });
    storage.deleteFile.mockClear();
    await handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
  });

  it('failed 路径 0 行不把 derived_status 写成 failed', async () => {
    const { mediaId, momentId, chainId, s3Key } = await seed();
    storage.getObject.mockImplementation(async () => {
      await db.update(media).set({ momentId: null, status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, mediaId));
      throw new ObjectTooLargeError(s3Key, MAX_IMAGE_BYTES);
    });
    await expect(handleMomentCompress({ momentId, chainId, mediaId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableCompressError',
    });
    expect((await derivedCols(mediaId)).derivedStatus).toBe('pending');
    expect((await db.select().from(media).where(eq(media.id, mediaId)))[0].momentId).toBeNull();
  });
```

需要 `import { media, outbox } from '../../src/db/schema.js'`（文件已 import `media, outbox`）。`ObjectTooLargeError` / `MAX_IMAGE_BYTES` 已 import。

- [ ] **Step 4: 写失败测试 — sweeper `deletedObjects`**

`apps/server/tests/worker/sweeper.test.ts`：扩展 `insertUnboundMedia` 的 opts，增加 `derivedS3Key?: string | null`，insert 时写入该列。现网无派生夹具的 `expect(result.deletedObjects).toBe(1)` **保持 1**。在 `sweepOrphanedMedia` describe 内追加：

```ts
  it('夹具带 derivedS3Key：deletedObjects = 派生 + 原图 = 2；派生 deleteFile 失败不删行', async () => {
    const now = new Date('2026-08-27T12:00:00Z');
    const expired = await insertUnboundMedia({
      status: 'orphaned',
      orphanedAt: new Date(now.getTime() - 31 * 86_400_000),
      derivedS3Key: 'chains/c/m/x.derived.webp',
    });
    const result = await sweepOrphanedMedia(now);
    expect(result.deletedObjects).toBe(2);
    expect(result.deletedRows).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalledWith('chains/c/m/x.derived.webp', TEST_META);
    expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringContaining(expired.mediaId), TEST_META);

    const expired2 = await insertUnboundMedia({
      status: 'orphaned',
      orphanedAt: new Date(now.getTime() - 31 * 86_400_000),
      derivedS3Key: 'chains/c/m/y.derived.webp',
    });
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 down'));
    const failed = await sweepOrphanedMedia(now);
    expect(failed.deletedRows).toBe(0);
    expect(failed.deletedObjects).toBe(0);
    expect(await db.select().from(media).where(eq(media.id, expired2.mediaId))).toHaveLength(1);
  });
```

`insertUnboundMedia` 的 values 增加 `derivedS3Key: opts.derivedS3Key ?? null`。

- [ ] **Step 5: 运行确认失败**

Run（先 `pnpm --filter @moment/dto build`，server 从 dto dist 读 schema）：

```
pnpm --filter @moment/server test -- tests/moments/moment-update-media.test.ts tests/moments/moment-list-crud.test.ts tests/moments/moment-poster.test.ts tests/moments/moment-compress-emit.test.ts tests/moments/moment-embed-emit.test.ts tests/worker/handle-moment-compress.test.ts tests/worker/sweeper.test.ts
```

Expected: FAIL——`text + 1 张 JPEG` 200/type=media（现网忽略 mediaIds，type 仍 text）；poster 用例 `MEDIA_NOT_ALLOWED`（现网仍 `VALIDATION_ERROR` 直到 T1 schema + T2 抛码；T1 已合入则 parse 通过、现网 update 忽略字段会 **200**，正是红灯）；追加 JPEG compress 行数；orphan ready 写回仍把 `derivedStatus` 打成 ready；sweeper 带 derived 的 `deletedObjects` 仍为 1。

- [ ] **Step 6: 实现 `MomentService.update` 媒体分支**

`apps/server/src/moments/moment.service.ts`：

1. import 保持 `eq, inArray`；`HttpError` 已有。`mime` / `getStorage` / `isCompressibleMime` / `emitOutbox` / `OUTBOX_MOMENT_COMPRESS` / `maybeEmitMomentEmbed` / `logger` 已有。
2. 删除/改写 update 的注释「媒体不可改（dto 层 .strict() 已拒绝 mediaIds/type）」，改为「媒体全量替换见 spec 2026-08-29-moment-edit-media §4；originalType 取 FOR UPDATE 后的行」。
3. 在 `const updatedRow = await db.transaction` **之前**（kind/payload 与 placeSet 计算之后）：

```ts
    if (input.posterMediaId !== undefined) {
      throw new HttpError(400, 'MEDIA_NOT_ALLOWED');
    }
```

4. `copiedTmp` **跟 `create()` 一样声明在 `db.transaction` 回调外**（`create` 现网 L61–63：`const copiedTmp = []; const created = await db.transaction(async (tx) => { ... copiedTmp.push ... })`）。不要写在事务回调开头——回调内的 const 出不了 tx，提交后删 tmp 拿不到。`mediaIds === undefined` 时整段媒体逻辑跳过（`copiedTmp` 为空，post-commit 循环 no-op）。

```ts
    const copiedTmp: { key: string; metadata: StorageMetadata }[] = [];
    const updatedRow = await db.transaction(async (tx) => {
      if (input.mediaIds !== undefined) {
        // ...§4.5，incoming copy 时 copiedTmp.push
      }
      // 现网写 content / tags / persons / geocode / extract / maybeEmitMomentEmbed
      return row;
    });
    const storage = getStorage();
    for (const t of copiedTmp) {
      await storage.deleteFile(t.key, t.metadata).catch((err: unknown) => {
        logger.warn(`post-commit tmp cleanup failed (lifecycle will cover): ${t.key}`, err);
      });
    }
```

5. `mediaIds` 有值时严格按 spec §4.5 顺序（校验失败必须 throw，零 copy 零 orphan）：

```ts
      if (input.mediaIds !== undefined) {
        const [locked] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1).for('update');
        if (!locked) throw new NotFoundError('MOMENT_NOT_FOUND');
        if (locked.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
        const originalType = locked.type; // 从此禁止再用事务外 m.type
        if (originalType === 'video') throw new HttpError(400, 'MEDIA_NOT_ALLOWED');

        const allRows = await tx.select().from(media).where(eq(media.momentId, momentId));
        const posterIds = new Set(allRows.map((r) => r.posterMediaId).filter((id): id is string => Boolean(id)));
        const contentRows = allRows.filter((r) => !posterIds.has(r.id));
        const existingContentIds = contentRows.map((r) => r.id);
        const existingAudios = contentRows.filter((r) => r.mime.startsWith('audio/'));
        if (originalType === 'voice' && existingAudios.length !== 1) {
          throw new HttpError(400, 'MEDIA_INVALID');
        }
        const originalAudioId = existingAudios[0]?.id ?? null;

        const lockIds = [...new Set([...existingContentIds, ...input.mediaIds])];
        const lockedMedia =
          lockIds.length === 0
            ? []
            : await tx.select().from(media).where(inArray(media.id, lockIds)).for('update');
        const byId = new Map(lockedMedia.map((r) => [r.id, r]));

        const keep: typeof lockedMedia = [];
        const incoming: typeof lockedMedia = [];
        for (const id of input.mediaIds) {
          const row = byId.get(id);
          if (!row) throw new HttpError(400, 'MEDIA_INVALID');
          if (posterIds.has(id)) throw new HttpError(400, 'MEDIA_INVALID');
          if (row.momentId === momentId) {
            keep.push(row);
            continue;
          }
          if (row.momentId === null && row.uploaderId === userId && row.status === 'ready') {
            incoming.push(row);
            continue;
          }
          throw new HttpError(400, 'MEDIA_INVALID');
        }
        const resultRows = input.mediaIds.map((id) => byId.get(id)!);

        // 矩阵（spec §4.6），仍零写
        if (originalType === 'text') {
          if (input.mediaIds.length > 0 && !resultRows.every((r) => r.mime.startsWith('image/'))) {
            throw new HttpError(400, 'MEDIA_INVALID');
          }
        } else if (originalType === 'media') {
          if (input.mediaIds.length === 0) throw new HttpError(400, 'MEDIA_COUNT_INVALID');
          if (!resultRows.every((r) => r.mime.startsWith('image/'))) {
            throw new HttpError(400, 'MEDIA_INVALID');
          }
        } else if (originalType === 'voice') {
          const audios = resultRows.filter((r) => r.mime.startsWith('audio/'));
          const rest = resultRows.filter((r) => !r.mime.startsWith('audio/'));
          if (audios.length !== 1 || audios[0]!.id !== originalAudioId || !rest.every((r) => r.mime.startsWith('image/'))) {
            throw new HttpError(400, 'MEDIA_INVALID');
          }
        }

        const keepIds = new Set(input.mediaIds);
        for (const id of existingContentIds) {
          if (keepIds.has(id)) continue;
          await tx
            .update(media)
            .set({ momentId: null, status: 'orphaned', orphanedAt: new Date() })
            .where(eq(media.id, id));
        }

        const storage = getStorage();
        const compressIds: string[] = [];
        const incomingIds = new Set(incoming.map((r) => r.id));
        for (const id of input.mediaIds) {
          const row = byId.get(id)!;
          const sortOrder = input.mediaIds.indexOf(id);
          if (!incomingIds.has(id)) {
            await tx.update(media).set({ sortOrder }).where(eq(media.id, id));
            continue;
          }
          const ext = mime.extension(row.mime) || 'bin';
          const finalKey = `chains/${locked.chainId}/${momentId}/${row.id}.${ext}`;
          await storage.copyObject(row.s3Key, finalKey, row.storageMeta);
          copiedTmp.push({ key: row.s3Key, metadata: row.storageMeta });
          await tx
            .update(media)
            .set({
              s3Key: finalKey,
              momentId,
              sortOrder,
              storageMeta: row.storageMeta,
              ...(isCompressibleMime(row.mime) ? { derivedStatus: 'pending' as const } : {}),
            })
            .where(eq(media.id, row.id));
          if (isCompressibleMime(row.mime)) compressIds.push(row.id);
        }

        if (originalType === 'text' && input.mediaIds.length >= 1) {
          await tx.update(moments).set({ type: 'media' }).where(eq(moments.id, momentId));
        }
        for (const mediaId of compressIds) {
          await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId, chainId: locked.chainId, mediaId });
        }
      }
```

然后走现网写 content 等列 / tags / persons / geocode / extract / `await maybeEmitMomentEmbed(tx, momentId)`。写 type 已在媒体分支内完成；后面那次 `tx.update(moments)` 不要再用事务外 `m.type` 覆盖。post-commit 删 tmp 见上面 Step 4 的外层循环（不要在回调里再声明一份 `copiedTmp`）。

**禁止：** 用事务外 `m.type`；incoming 写 `posterMediaId`；keep 把 `derivedStatus` 打回 pending；请求线程 `deleteFile` 正式对象；新 outbox 类型；`deleteVectorsByMomentId`；重发 `moment.transcribe`。

- [ ] **Step 7: 实现 compress 终态 WHERE + 0 行删 derivedKey**

`apps/server/src/media/handle-moment-compress.ts`：

1. `import { and, eq, isNotNull } from 'drizzle-orm'`；`import { logger } from '../utils/logger.js'`。
2. `markDerivedFailed` 的 UPDATE `.where` 改为 `and(eq(media.id, mediaId), isNotNull(media.momentId))`；读 `affectedRows`，`=== 0` 则 return（不 `maybeEmitMomentEmbed`）。drizzle mysql2：`const [result] = await tx.update(...)`，`result.affectedRows`。
3. skipped 分支同样加 WHERE；0 行 return，不 embed。
4. ready 分支：**先** `uploadFile(key, out.buffer)`（现网顺序保留），再 UPDATE 加 WHERE。

```ts
  const key = derivedObjectKey(m.chainId, m.id, row.id);
  await getStorage().uploadFile(key, out.buffer);
  let wrote = false;
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(media)
      .set({
        derivedS3Key: key,
        derivedMime: DERIVED_MIME,
        derivedSize: out.buffer.length,
        derivedWidth: out.width,
        derivedHeight: out.height,
        derivedStatus: 'ready',
      })
      .where(and(eq(media.id, row.id), isNotNull(media.momentId)));
    if (result.affectedRows === 0) return;
    wrote = true;
    await maybeEmitMomentEmbed(tx, m.id);
  });
  if (!wrote) {
    await getStorage()
      .deleteFile(key, row.storageMeta)
      .catch((err: unknown) => {
        logger.warn('orphan compress derived cleanup failed', err);
      });
  }
```

不要把派生列写回 orphan 行。不要改函数签名、payload、sharp、GIF 早退。

- [ ] **Step 8: 实现 sweeper `destroyMediaObject`**

`apps/server/src/worker/sweeper.ts` 内部函数，**不 export**。在 abort multipart 之后、删 `s3Key` 之前：

```ts
  if (row.derivedS3Key) {
    try {
      await storage.deleteFile(row.derivedS3Key, row.storageMeta);
      result.deletedObjects += 1;
    } catch (err) {
      logger.warn('sweeper delete derived object failed（保留行，下轮重试）', {
        mediaId: row.id,
        key: row.derivedS3Key,
        err: String(err),
      });
      return false;
    }
  }
  try {
    await storage.deleteFile(row.s3Key, row.storageMeta);
    result.deletedObjects += 1;
    return true;
  } catch (err) {
    logger.warn('sweeper delete object failed（保留行，下轮重试）', {
      mediaId: row.id,
      key: row.s3Key,
      err: String(err),
    });
    return false;
  }
```

`deleteFile` 对对象不存在视为成功（S3 `DeleteObject` 幂等；mock 默认 resolve）。不改 retention / batch。软删到期走同一函数。

- [ ] **Step 9: 运行确认通过**

同一条 server 测试命令（Step 5）。Expected: PASS。抽查：只改正文 compress 行数不变；顺序升级再 `[]` → `MEDIA_COUNT_INVALID`；poster `null` → `MEDIA_NOT_ALLOWED`；orphan ready 的 `derivedStatus` 仍 pending 且 `deleteFile` 接到 `derivedObjectKey`。

- [ ] **Step 10: Commit**

```
feat(server): replace moment media on patch
```

Add: 本 Task Files 列出的全部 Modify/Create。

---

### Task 3: web — 编辑态可改图

**Files:**
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.ts`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.test.ts`
- Modify: `apps/web/src/lib/errors.ts`
- Modify: `apps/web/src/pages/chain-home/chain-home.test.tsx`

**Interfaces:**
- Consumes: T1 `PatchMomentInput`；T2 `PATCH /api/moments/:id`；`cardDisplayUrl(media)`（`apps/web/src/lib/media-src.ts`）；`compressImage(file: File): Promise<File>`（`apps/web/src/lib/compress.ts`）；`client.uploadMedia({ kind:'image', file, mime, size })`；`client.updateMoment`；既有 `IconButton` / `Button` / `Banner` / `AudioBar` / `MediaBlock`。
- Produces:
  - `editImageCap(edit: { type: MomentType }): 8 | 9`
  - `editOccupied(keptMedia: MomentMedia[], images: { file: File }[]): number`（`keptMedia.length + images.length`）
  - `ComposePanelService.hydrate`：清草稿 + 填 `keptMedia` / `keptAudio` / `baselineMediaIds` / `mediaTouched=false`
  - `addImages`：`const cap = this.edit ? editImageCap(this.edit) : this.voice ? 8 : 9`；`const occupied = this.edit ? editOccupied(this.keptMedia, next) : next.length`；编辑禁止读 `this.voice` 当 cap
  - `submit` 编辑分支：仅 `mediaTouched` 时先串行 `compressImage` + `uploadMedia({ kind:'image' })` 再 `updateMoment`；不传 `type` / `posterMediaId`；未动不带 `mediaIds` 键

- [ ] **Step 1: 写失败测试 — service**

`compose-panel.service.test.ts`：

1. `vi.hoisted` 的 `api` 增加 `uploadMedia: vi.fn()`。`beforeEach` 里 `api.uploadMedia.mockResolvedValue({ mediaId: '11111111-1111-4111-8111-111111111111', status: 'ready', mime: 'image/jpeg', size: 1 })`。
2. mock compress：

```ts
const compress = vi.hoisted(() => ({ compressImage: vi.fn(async (f: File) => f) }));
vi.mock('@/lib/compress', () => ({ compressImage: compress.compressImage }));
```

3. `beforeEach` 复位新字段：`keptMedia = []`、`keptAudio = null`、`mediaTouched = false`、`baselineMediaIds = []`；`compress.compressImage.mockClear()`。
4. `editMoment` 夹具加一个 `mediaItem` helper（补齐 `MomentMedia` 必填字段，含 `derivedUrl: null, posterDerivedUrl: null`）。
5. 追加 describe `编辑模式媒体 dirty / cap / submit（spec §6）`：

```ts
function img(id: string, mime = 'image/jpeg'): MomentMedia {
  return {
    id, url: `https://signed.example/${id}`, mime, width: 64, height: 48, duration: null,
    sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null,
  };
}

describe('编辑模式媒体 dirty / cap / submit（spec §6）', () => {
  it('未动媒体 → updateMoment 请求体无 mediaIds 键', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('m-keep')] }) });
    s.content = '只改正文';
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body).not.toHaveProperty('type');
    expect(body).not.toHaveProperty('posterMediaId');
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  it('叉一张再保存 → 先 compressImage + uploadMedia({kind:image}) 再 updateMoment；mediaIds 为剩余 id（无新图则不 upload）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep-1'), img('keep-2')] }) });
    s.removeKeptMedia('keep-2');
    const order: string[] = [];
    compress.compressImage.mockImplementation(async (f) => { order.push('compress'); return f; });
    api.uploadMedia.mockImplementation(async () => { order.push('upload'); return { mediaId: 'n1' }; });
    api.updateMoment.mockImplementation(async () => { order.push('update'); return editMoment(); });
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled(); // 无新本地图
    expect(order).toEqual(['update']);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.mediaIds).toEqual(['keep-1']);
  });

  it('text 加图 → 串行 compress+upload 后再 PATCH，mediaIds 仅新 id', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'text', media: [], content: '' }) });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    const order: string[] = [];
    compress.compressImage.mockImplementation(async (f) => { order.push('compress'); return f; });
    api.uploadMedia.mockImplementation(async (input: { kind: string }) => {
      order.push('upload');
      expect(input.kind).toBe('image');
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    api.updateMoment.mockImplementation(async () => { order.push('update'); return editMoment(); });
    await s.submit();
    expect(order).toEqual(['compress', 'upload', 'update']);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.mediaIds).toEqual(['new-1']);
    expect(body).not.toHaveProperty('type');
  });

  it('video 编辑不调用 upload、不带 mediaIds', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        type: 'video',
        media: [{ ...img('vid'), mime: 'video/mp4' }],
      }),
    });
    s.content = '改配文';
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
  });

  it('voice 编辑 keptMedia 已 8 张时再 addImages 第 9 张被拒，即使 this.voice === null', async () => {
    const s = svc();
    const pictures = Array.from({ length: 8 }, (_, i) => img(`p-${i}`));
    s.hydrate({
      edit: editMoment({
        type: 'voice',
        media: [{ ...img('aud'), mime: 'audio/wav' }, ...pictures],
      }),
    });
    expect(s.voice).toBeNull();
    expect(s.keptMedia).toHaveLength(8);
    expect(s.keptAudio?.id).toBe('aud');
    s.addImages([new File(['x'], 'nine.jpg', { type: 'image/jpeg' })]);
    expect(s.error).toBe('语音时刻最多 8 张附图');
    expect(s.images).toHaveLength(0);
  });

  it('media 已有 8 张再 paste 第 10 张内容被拒（最多 9 张图片）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: Array.from({ length: 8 }, (_, i) => img(`k-${i}`)) }) });
    s.addImages([new File(['a'], '9.jpg', { type: 'image/jpeg' })]);
    expect(s.images).toHaveLength(1);
    s.addImages([new File(['b'], '10.jpg', { type: 'image/jpeg' })]);
    expect(s.error).toBe('最多 9 张图片');
    expect(s.images).toHaveLength(1);
  });

  it('hydrate 清掉上一轮新建草稿（images/video），避免记下→编辑残留', async () => {
    const s = svc();
    s.images = [{ file: new File(['x'], 'old.jpg', { type: 'image/jpeg' }), previewUrl: 'blob:old' }];
    s.video = { file: new File(['v'], 'old.mp4', { type: 'video/mp4' }), previewUrl: 'blob:vid', durationSeconds: 3 };
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('keep')] }) });
    expect(s.images).toEqual([]);
    expect(s.voice).toBeNull();
    expect(s.video).toBeNull();
    expect(s.keptMedia.map((m) => m.id)).toEqual(['keep']);
    expect(s.mediaTouched).toBe(false);
  });

  it('原 media 空正文、只留已有图 → 不拦「先写一句此刻吧」，不 upload', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', content: '', media: [img('keep')] }) });
    await s.submit();
    expect(s.error).toBeNull();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body.content).toBe('');
  });

  it('原 media 结果 0 图 → error 至少留一张图，不打 API', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment({ type: 'media', media: [img('only')] }) });
    s.removeKeptMedia('only');
    await s.submit();
    expect(s.error).toBe('至少留一张图');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });

  it('混排残留 video 且 mediaTouched → 改图片前请先移除宫格里的视频', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        type: 'media',
        media: [img('pic'), { ...img('clip'), mime: 'video/mp4' }],
      }),
    });
    s.removeKeptMedia('pic');
    await s.submit();
    expect(s.error).toBe('改图片前请先移除宫格里的视频');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });
});
```

`removeKeptMedia` 实现前测试会因方法不存在失败（红灯）。

- [ ] **Step 2: 写失败测试 — chain-home**

`apps/web/src/pages/chain-home/chain-home.test.tsx`：把 `编辑已有媒体时刻只读展示媒体，不出现加图入口` **删掉**，换成 **4 个独立 `it`**（`apps/web/src/test/setup.ts` 已 `afterEach(cleanup)`，用例之间会卸树）。**禁止**在同一 `it` 里连续 `render(<ComposePanel />)` 还不 `unmount`：Testing Library 16 每次 `render()` 往 `document.body` 追加一棵树，第二次起 `getByRole('加图片')` 会 Multiple elements，video 段 `queryByRole(..., '加图片')` 被前几次按钮挡住、`toBeNull()` 恒失败。

```ts
  function renderEdit(edit: MomentResponse) {
    resolve(ComposeSessionService).request = { chainId: 'chain-1', edit };
    return render(
      <RSRoot>
        <ComposePanel />
      </RSRoot>,
    );
  }

  it('编辑 media 出现加图片且可叉已有格', () => {
    renderEdit(IMAGE_MOMENT);
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
    expect(screen.queryByText('已发布的媒体不能更换')).toBeNull();
    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
  });

  it('编辑 text 出现加图片', () => {
    renderEdit({ ...IMAGE_MOMENT, id: 'moment-text-edit', type: 'text', media: [] });
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
  });

  it('编辑 voice 出现加图片且可叉附图', () => {
    renderEdit({
      ...IMAGE_MOMENT,
      id: 'moment-voice-edit',
      type: 'voice',
      media: [
        { ...IMAGE_MOMENT.media[0]!, id: 'aud', mime: 'audio/wav', url: 'https://signed.example/aud' },
        IMAGE_MOMENT.media[0]!,
      ],
    });
    expect(screen.getByRole('button', { name: '加图片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除这张图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加视频' })).toBeNull();
  });

  it('编辑 video 只读文案，无加图按钮', () => {
    renderEdit({
      ...IMAGE_MOMENT,
      id: 'moment-video-edit',
      type: 'video',
      media: [{ ...IMAGE_MOMENT.media[0]!, id: 'vid', mime: 'video/mp4' }],
    });
    expect(screen.getByText('视频发布后不能更换')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加图片' })).toBeNull();
  });
```

voice 只断言「加图片」+ 附图叉，不测 AudioBar 播放。`ComposePanelService` 仍是 `bindServices` 长寿命实例：每个 `it` 改 `request` 后 `hydrate` 会跑；`cleanup()` 卸的是 DOM，不是 Service。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web exec vitest run src/compose/compose-panel/compose-panel.service.test.ts src/pages/chain-home/chain-home.test.tsx`

Expected: FAIL——`removeKeptMedia` 不存在；未动媒体或许仍无 `mediaIds`（偶然绿）；加图 submit 不会 upload；chain-home 仍看得到「已发布的媒体不能更换」。

- [ ] **Step 4: 实现 service**

`compose-panel.service.ts`：

1. import `type { MomentMedia, MomentType, MomentResponse, ... }`（`MomentType` / `MomentMedia` 现网未从 dto 引入则补上）。
2. 文件级导出（index 与测试共用）：

```ts
export function editImageCap(edit: { type: MomentType }): 8 | 9 {
  return edit.type === 'voice' ? 8 : 9;
}
export function editOccupied(keptMedia: MomentMedia[], images: { file: File }[]): number {
  return keptMedia.length + images.length;
}
```

3. 类上新增字段：`keptMedia: MomentMedia[] = []`；`keptAudio: MomentMedia | null = null`；`mediaTouched = false`；`baselineMediaIds: string[] = []`。
4. `hydrate` **每次**先清草稿（面板是 `bindServices` 长寿命实例）：revoke `images` previewUrl；`images=[]`；`video=null`；`resetPoster()`；`resetVoice()`；`replaceConfirm=null`；`pendingFiles=[]`。再按 spec §6.2 填 kept：
   - 新建 / 无 edit / `text` / `video`：`keptMedia=[]`（video 不进宫格）
   - `media`：`keptMedia = edit.media` 全部（含存量 `video/*`）
   - `voice`：`keptAudio = edit.media.find(m => m.mime.startsWith('audio/')) ?? null`；`keptMedia = edit.media.filter(m => m.mime.startsWith('image/'))`——**禁止**把 audio 推进 `keptMedia`
   - `keptAudio`：仅 `edit.type==='voice'` 时赋值，否则 `null`
   - `mediaTouched = false`
   - `baselineMediaIds`：voice = `keptAudio ? [keptAudio.id, ...keptMedia.map(m => m.id)] : []`；text/media = `keptMedia.map(m => m.id)`；video / 新建 = `[]`
5. `addImages` **内部必须分支**（spec 原文，编辑禁止 `this.voice` 当 cap）：

```ts
  addImages(files: File[]): void {
    this.error = null;
    void this.ingestExif(files).catch(() => undefined);
    const next = [...this.images];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        this.error = `「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}）`;
        continue;
      }
      const cap = this.edit ? editImageCap(this.edit) : this.voice ? 8 : 9;
      const occupied = this.edit ? editOccupied(this.keptMedia, next) : next.length;
      if (occupied >= cap) {
        this.error = this.edit?.type === 'voice' || this.voice ? '语音时刻最多 8 张附图' : '最多 9 张图片';
        break;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    this.images = next;
    if (this.edit) this.mediaTouched = true;
  }
```

6. `removeKeptMedia(id: string)`：从 `keptMedia` 滤掉，`mediaTouched = true`。
7. `removeImage`：现网 revoke + 滤数组；若 `this.edit` 再 `mediaTouched = true`。
8. `submit` 编辑分支 **整段重写媒体部分**（其余 content/time/tags/persons/place/kind 现网不变）。**不得**走新建 `createMoment`。
   **空正文闸必须按结果图数，禁止沿用现网写在 `if (edit)` 之前、只看 `this.images` / `this.video` / `this.voice` 的那段。** `hydrate` 已把这三项清掉，`keptMedia` 不算占用：图文空配文（已有图、无新本地图）和文字补图都会被误伤成「先写一句此刻吧」。编辑分支用 `const resultCount = this.keptMedia.length + this.images.length`（audio 不在 `keptMedia`）：
   - 原 `text` 且 `resultCount === 0` 且 standard 且正文空 → `'先写一句此刻吧'`（沿用现网那句）
   - 原 `text` 且 `resultCount` 1–9：允许空正文
   - 原 `media` 且 `resultCount === 0` → `'至少留一张图'`（与正文是否为空无关）
   - 原 `media` 且 `resultCount >= 1`：允许空正文
   - `mediaTouched && keptMedia.some(m => m.mime.startsWith('video/'))` → `'改图片前请先移除宫格里的视频'`
   - 原 `voice` 且 `!keptAudio` → `'录音不能换'`；voice **不**因空正文拦截
   新建分支保留现网 `this.images` / `this.video` / `this.voice` 闸，本 spec 不改新建。
   - **仅当 `mediaTouched`**：按宫格从左到右串行 `const file = await compressImage(img.file)` → `await client.uploadMedia({ file, mime: file.type, size: file.size, kind: 'image' })`；`mediaIds = [...keptMedia.map(m => m.id), ...新id]`；voice 时 **客户端**把 `keptAudio.id` 放在数组首位：`[keptAudio.id, ...图id]`。已有格不重传。
   - 未动：请求体不含 `mediaIds` 键。
   - 不传 `type`、不传 `posterMediaId`。
   - 上传失败：`humanError`，面板不关、稿保留。
   - 成功：`moment:changed { op:'update' }`，`clearPreviews`，关面板。

`errors.ts` 在 `MEDIA_COUNT_INVALID` 旁增加：

```
  MEDIA_INVALID: '这些图片不能用，请重新选择',
  MEDIA_NOT_ALLOWED: '这种时刻不能改媒体',
```

`MEDIA_COUNT_INVALID: '图片或视频数量不对'` 保留。

- [ ] **Step 5: 实现面板 UI**

`index.tsx`：

1. `DraftBaseline` 增 `mediaIds: string[]`。hydrate 时 `mediaIds: [...service.baselineMediaIds]`。
2. `isDirty`：`service.mediaTouched`；或当前提交序 id（voice 含 `keptAudio.id` 首位）与 `base.mediaIds` 不等；或 `service.images.length > 0`。其它字段现网不变。
3. 去掉「`edit && edit.media.length > 0` → 只读 MediaBlock + 已发布的媒体不能更换」和「选图区 `!edit` 才渲染」互斥。
4. 按 `edit.type`：
   - `text` / `media`：可编辑宫格（`keptMedia` 已有格 + 本地 `images`）+「加图片」；**不**渲染「加视频」、**不**渲染 `VoiceRecorder`。`image/*`：`<img src={cardDisplayUrl(m)!}>`（import `@/lib/media-src`）。存量 `video/*`：`bg-ink` + `text-bg` 文案「视频」+ 叉，不挂播放器、不写 hex、不新 `h-[…]`。叉按钮：现网那颗 `IconButton`（Lucide `X`，`variant="secondary"`，`className="absolute -right-1 -top-1"`），label 图片用「移除这张图片」、视频格用「移除这段视频」。本地图叉走 `removeImage`。
   - `voice`：`keptAudio` 用既有 `AudioBar` 只读（无叉）；附图进同一套宫格；「加图片」；无录音器、无加视频。
   - `video`：既有 `MediaBlock` 只读 + `<p className="text-meta text-muted">视频发布后不能更换</p>`；无加图片/视频。
5. 「加图片」`disabled`：编辑 `editOccupied(service.keptMedia, service.images) >= editImageCap(edit)`；新建仍 `images.length >= (voice ? 8 : 9)`。disabled 挡不住粘贴，所以 `addImages` 必须拒第 N+1 张。
6. **编辑态选图不得走 `onPickImages` / `onPickVideo`（会进 `replaceConfirm`，编辑态危险）。** 只改 `handlePaste` 的 `if (edit || busy)` 不够：`addMediaFiles` 与「加图片」文件框 `onChange` 现网都调 `onPickImages`。重写：

```ts
  const addMediaFiles = (files: File[]): boolean => {
    if (files.length === 0) return false;
    if (edit) {
      if (edit.type === 'video') return false;
      const images = files.filter((file) => file.type.startsWith('image/'));
      const videos = files.filter((file) => file.type.startsWith('video/'));
      if (videos.length > 0) {
        service.error = '编辑时不能换成视频';
        return true;
      }
      if (images.length !== files.length) {
        service.error = '这里只能添加图片或视频';
        return true;
      }
      service.addImages(images); // 不走 onPickImages
      return true;
    }
    // 新建：现网分流（可进 onPickImages / onPickVideo / replaceConfirm），本 spec 不改
    const images = files.filter((file) => file.type.startsWith('image/'));
    const videos = files.filter((file) => file.type.startsWith('video/'));
    if (images.length + videos.length !== files.length) {
      service.error = '这里只能添加图片或视频';
      return true;
    }
    if (images.length > 0 && videos.length > 0) {
      service.error = '图片和视频不能一起添加';
      return true;
    }
    if (videos.length > 1) {
      service.error = '一次只能添加一个视频';
      return true;
    }
    if (images.length > 0) service.onPickImages(images);
    else if (videos[0]) service.onPickVideo(videos[0]);
    return true;
  };
```

   编辑态「加图片」`<input type="file" accept="image/*" multiple>` 的 `onChange`：**`service.addImages(Array.from(e.target.files ?? []))`**，禁止 `onPickImages`。不渲染视频 file input。
7. `handlePaste`：`if (busy || edit?.type === 'video') return`（去掉 `if (edit || busy)` 对一切 edit 的短路），然后 `addMediaFiles`。`handleDrop` 现网本来就不短路 `edit`，必须同样：`if (busy || edit?.type === 'video') return` 再 `addMediaFiles`——漏改会让拖入视频进编辑草稿。
8. 宫格顺序：先留下的已有内容格（原相对顺序），后追加的本地图。不做拖拽。

- [ ] **Step 6: 运行确认通过**

同一 vitest 命令。Expected: PASS。

- [ ] **Step 7: Commit**

```
feat(web): edit published moment images
```

**手测清单（DoD，不自动化）：** 编辑图文叉/加；文字补图（空正文可发）；voice 改附图且不能换录音；视频只读文案；满 9 禁用加图；未动媒体保存不上传。

---

### Task 4: app — 编辑态可改图

**Files:**
- Modify: `apps/app/src/features/compose/compose.service.ts`
- Modify: `apps/app/src/features/compose/index.tsx`
- Create: `apps/app/src/features/compose/compose.service.test.ts`
- Modify: `apps/app/src/components/MediaGrid.tsx`
- Modify: `apps/app/src/lib/media.ts`
- Modify: `apps/app/src/lib/errors.ts`

**Interfaces:**
- Consumes: 与 T3 相同的 `PatchMomentInput` / T2 API；`uploadWithRetry` / `client.updateMoment` / `client.getMoment` / `client.uploadMedia`；`AudioBar`；`useTheme()` token（`ink` / `bg`，不写 hex）。
- Produces:
  - `pickImages(opts?: { selectionLimit?: number }): Promise<PickedImage[]>`，默认 `selectionLimit: 9`；create 调用点不传
  - `MediaGrid({ media, onRemove?: (mediaId: string) => void })`
  - `editImageCap` / `editOccupied` 与 web **同形但独立实现**（不要从 web import；不要抄 web 的 `this.voice` 新建公式）
  - 新建 cap 仍 `this.type === 'voice' ? 8 : 9`（禁止 `Boolean(this.voice)`）
  - `submitEdit`：仅 `mediaTouched` 时先串行 `uploadWithRetry({ kind:'image' })` 再 `updateMoment`；不传 `type` / `posterMediaId`
- 不新增 `apps/app/package.json` scripts。

- [ ] **Step 1: 写失败测试**

Create `apps/app/src/features/compose/compose.service.test.ts`。文件顶部 **必须** `vi.mock` 这四组（spec §7.4）：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import type { MomentMedia, MomentResponse } from '@moment/dto';
import { ComposeService } from './compose.service';
import { ChainListService } from '../../services/chain-list.service';
import { AuthService } from '../../services/auth.service';

const api = vi.hoisted(() => ({
  getMoment: vi.fn(),
  updateMoment: vi.fn(),
  uploadMedia: vi.fn(),
  listTags: vi.fn(),
  getChain: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  listChains: vi.fn(),
  me: vi.fn(),
}));

const mediaLib = vi.hoisted(() => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
  pickVideo: vi.fn(),
  validateVideo: vi.fn(),
  uriToBlob: vi.fn(),
}));

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  Accuracy: { Balanced: 1 },
}));
vi.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: vi.fn() }));
vi.mock('../../lib/media', () => ({
  pickImages: (...args: unknown[]) => mediaLib.pickImages(...args),
  compressImage: (...args: unknown[]) => mediaLib.compressImage(...args),
  pickVideo: (...args: unknown[]) => mediaLib.pickVideo(...args),
  validateVideo: (...args: unknown[]) => mediaLib.validateVideo(...args),
  uriToBlob: (...args: unknown[]) => mediaLib.uriToBlob(...args),
}));
vi.mock('../../lib/api', () => ({
  client: api,
  apiUrl: 'http://x',
  webUrl: 'http://x',
}));
vi.mock('../../lib/token-store', () => ({
  loadUser: vi.fn(async () => null),
  onAuthCleared: vi.fn(),
  saveUser: vi.fn(),
  secureTokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
}));

register(AuthService);
register(ChainListService);
register(ComposeService);

function img(id: string, mime = 'image/jpeg'): MomentMedia {
  return {
    id, url: `https://signed.example/${id}`, mime, width: 64, height: 48, duration: null,
    sortOrder: 0, posterMediaId: null, posterUrl: null, derivedUrl: null, posterDerivedUrl: null,
  };
}

function moment(partial: Partial<MomentResponse> = {}): MomentResponse {
  return {
    id: 'm-1', chainId: 'chain-1',
    author: { id: 'u-1', nickname: '妈妈', avatarUrl: null },
    type: 'text', content: '在外婆家吃饭', transcript: null, transcriptionStatus: null,
    kind: 'standard', payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z', happenedTzOffset: -480, isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [], tags: [], persons: [], place: null, commentCount: 0, reactions: [], myReaction: null,
    ...partial,
  };
}

function svc(): ComposeService {
  return resolve(ComposeService);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue({ tags: [] });
  api.getChain.mockResolvedValue({ templateManifest: { version: 1 } });
  api.listPersons.mockResolvedValue({ persons: [] });
  api.listMembers.mockResolvedValue([]);
  api.listChains.mockResolvedValue([]);
  api.me.mockResolvedValue({ id: 'u-1', nickname: '妈妈' });
  api.updateMoment.mockResolvedValue(moment());
  api.uploadMedia.mockResolvedValue({ mediaId: 'up-1', status: 'ready', mime: 'image/jpeg', size: 1 });
  mediaLib.compressImage.mockImplementation(async (x: { uri: string }) => ({
    ...x, blob: new Blob(['x']), size: 1, mime: 'image/jpeg',
  }));
  // ComposeService 是 register 单例。loadForEdit 若漏清草稿，后序用例会串 images/voice。
  // 与 web compose-panel.service.test.ts 同款：每个 it 先复位字段（含本 Task 新增的 kept*）。
  const s = svc();
  s.edit = null;
  s.images = [];
  s.video = null;
  s.poster = null;
  s.posterMediaId = null;
  s.voice = null;
  s.content = '';
  s.progressLabel = null;
  s.keptMedia = [];
  s.keptAudio = null;
  s.mediaTouched = false;
  s.baselineMediaIds = [];
});
```

用例（与 web 同一组 dirty/submit + cap）：

```ts
describe('ComposeService 编辑媒体（spec §7）', () => {
  it('未动媒体 → updateMoment JSON 无 mediaIds', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.content = '只改正文';
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('mediaIds');
    expect(body).not.toHaveProperty('type');
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  it('叉后提交剩余 id（无新图不 upload）', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: [img('a'), img('b')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.removeKeptMedia('b');
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect((api.updateMoment.mock.calls[0]![1] as { mediaIds: string[] }).mediaIds).toEqual(['a']);
  });

  it('text 加图（空正文）：先 uploadMedia({kind:image}) 再 updateMoment，mediaIds 仅新 id', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'text', media: [], content: '' }));
    const s = svc();
    await s.loadForEdit('m-1');
    expect(s.content).toBe('');
    const order: string[] = [];
    mediaLib.pickImages.mockResolvedValue([{ uri: 'file://a.jpg', width: 10, height: 10 }]);
    mediaLib.compressImage.mockImplementation(async (x) => { order.push('compress'); return { ...x, blob: new Blob(['x']), size: 1, mime: 'image/jpeg' }; });
    api.uploadMedia.mockImplementation(async (input: { kind: string }) => {
      order.push('upload');
      expect(input.kind).toBe('image');
      return { mediaId: 'new-1', status: 'ready', mime: 'image/jpeg', size: 1 };
    });
    api.updateMoment.mockImplementation(async () => { order.push('update'); return moment(); });
    await s.pickMoreImages();
    await s.submit();
    expect(order).toEqual(['compress', 'upload', 'update']);
    expect((api.updateMoment.mock.calls[0]![1] as { mediaIds: string[] }).mediaIds).toEqual(['new-1']);
  });

  it('原 media 空正文、只留已有图 → 不抛文字类型需要内容，不 upload', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', content: '', media: [img('keep')] }));
    const s = svc();
    await s.loadForEdit('m-1');
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    expect((api.updateMoment.mock.calls[0]![1] as Record<string, unknown>)).not.toHaveProperty('mediaIds');
  });

  it('video 编辑不 upload、不带 mediaIds', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'video', media: [{ ...img('v'), mime: 'video/mp4' }] }));
    const s = svc();
    await s.loadForEdit('m-1');
    s.content = '配文';
    await s.submit();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect((api.updateMoment.mock.calls[0]![1] as Record<string, unknown>)).not.toHaveProperty('mediaIds');
  });

  it('voice 编辑 8 张附图时 pickMoreImages 抛错且 pickImages 不被调用；即使 voice===null', async () => {
    api.getMoment.mockResolvedValue(
      moment({
        type: 'voice',
        media: [{ ...img('aud'), mime: 'audio/wav' }, ...Array.from({ length: 8 }, (_, i) => img(`p-${i}`))],
      }),
    );
    const s = svc();
    await s.loadForEdit('m-1');
    expect(s.voice).toBeNull();
    expect(s.keptMedia).toHaveLength(8);
    await expect(s.pickMoreImages()).rejects.toThrow('语音时刻最多 8 张附图');
    expect(mediaLib.pickImages).not.toHaveBeenCalled();
  });

  it('编辑态 pickImages 传 selectionLimit=remain，禁止写死 9 再 slice', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'media', media: Array.from({ length: 7 }, (_, i) => img(`k-${i}`)) }));
    const s = svc();
    await s.loadForEdit('m-1');
    mediaLib.pickImages.mockResolvedValue([]);
    await s.pickMoreImages();
    expect(mediaLib.pickImages).toHaveBeenCalledWith({ selectionLimit: 2 });
  });

  it('无 keptAudio → 录音不能换，不打 API', async () => {
    api.getMoment.mockResolvedValue(moment({ type: 'voice', media: [img('pic')] })); // 损坏：无 audio
    const s = svc();
    await s.loadForEdit('m-1');
    s.mediaTouched = true;
    await expect(s.submit()).rejects.toThrow('录音不能换');
    expect(api.updateMoment).not.toHaveBeenCalled();
  });
});
```

`register(AuthService)` 必须在 `ChainListService` 之前（`ChainListService` 构造 `resolve(AuthService)`）。`token-store` 与 `lib/api` 的 mock 挡住 SecureStore / 真网络。`loadForEdit` 用到的 `getMoment` / `listTags` / `getChain` / `listPersons` / `listMembers` 均在 `beforeEach` mockResolvedValue。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/app test -- src/features/compose/compose.service.test.ts`

Expected: FAIL——`removeKeptMedia` / `keptMedia` 不存在；`pickImages` 仍无 `{ selectionLimit }` 入参。

- [ ] **Step 3: 实现 `pickImages` + `MediaGrid` + service + UI + errors**

`apps/app/src/lib/media.ts`：

```ts
export async function pickImages(opts?: { selectionLimit?: number }): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: opts?.selectionLimit ?? 9,
    quality: 1,
    exif: true,
  });
  // ...现网 assets map 不变
}
```

create 调用点 `pickImages()` 不传参。

`MediaGrid.tsx`：props 增 `onRemove?: (mediaId: string) => void`。
- **不传**：现网 `VideoCell` 零变化。
- **传入**：`image/*` 与 `video/*` 都显示移除。video 格 **不要** 用可点 `VideoCell`；改成 `backgroundColor: t.ink`、`color: t.bg` 文案「视频」+ 叉（不写 hex）。`audio/*` 仍不渲染。移除控件 `Pressable` + `hitSlop`，`accessibilityLabel`「移除这张图片」/「移除这段视频」。

`compose.service.ts`：
1. 同文件导出 `editImageCap` / `editOccupied`（签名与 spec §7.2 逐字相同；`ReadyImage[]`）。
2. 字段：`keptMedia` / `keptAudio` / `mediaTouched` / `baselineMediaIds`。
3. `loadForEdit` 在赋值 `edit` 的同时复位：`images=[]`；`clearVideo()`（经 `resetPoster`）；`voice=null`；`mediaTouched=false`。然后按 web **kept 分类**填（不是容量公式相同）：voice 的 audio 不进 `keptMedia`。无 audio 的 voice → `keptAudio=null`（提交前置失败）。
4. `pickMoreImages` **编辑态**：`remain = editImageCap(this.edit) - editOccupied(this.keptMedia, this.images)`；`remain <= 0` 抛 `'语音时刻最多 8 张附图'` 或 `'图片最多 9 张'`（与现网中文一致）；`pickImages({ selectionLimit: remain })`；成功后 `mediaTouched=true`。禁止写死 `selectionLimit: 9` 再 slice。
5. `pickMoreImages` **新建态**（口径不改）：`const cap = this.type === 'voice' ? 8 : 9`；`remain = cap - this.images.length`；可把 `remain` 传给 `pickImages`。禁止 `Boolean(this.voice)`。
6. `removeKeptMedia` / 清空本地图：`mediaTouched=true`。
7. `chooseVideo` / `setVoice`：若 `this.edit` 直接 return（禁止编辑态换视频/重录）。
8. `submitEdit`：前置对齐 §6.3。**现网首行 `edit.type === 'text' && this.content.trim().length === 0 && edit.kind === 'standard'` 无条件抛「文字类型需要内容」必须改掉**——文字补图空正文会被这道旧闸误伤。用结果图数 `resultCount = this.keptMedia.length + this.images.length`：
   - 原 `text` 且 `resultCount === 0` 且 standard 且正文空 → 抛 `'文字类型需要内容'`（现网中文）
   - 原 `text` 且 `resultCount >= 1`：允许空正文
   - 原 `media` 且 `resultCount === 0` → 抛 `'至少留一张图'`
   - 原 `media` 且 `resultCount >= 1`：允许空正文
   - `mediaTouched && keptMedia` 仍含 `video/*` → `'改图片前请先移除宫格里的视频'`
   - 原 `voice` 且 `!keptAudio` → `'录音不能换'`；voice 不因空正文拦截
   仅 `mediaTouched` 时：voice 数组首位 `keptAudio.id`；再跟 `keptMedia` id；再 **串行** `uploadWithRetry({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' })`；然后 `client.updateMoment`。未动不传 `mediaIds`。不传 `type` / `posterMediaId`。成功 `moment:changed { op:'update' }`。
   `loadForEdit` **必须**先清草稿再填 kept（与 `beforeEach` 双保险）：漏清则单例会把上一例的 `images`/`voice` 带进下一例。

`index.tsx`：不要再 `isEdit && edit.media` 整包只读 `MediaGrid`。
- `text` / `media`：`MediaGrid media={keptMedia} onRemove={id => service.removeKeptMedia(id)}`；其下本地 `images` 用 `Image` + 叉；按钮「选图（n/9）」达 cap 禁用；无选视频、无类型条。
- `voice`：只读 `AudioBar`（`apps/app/src/components/AudioBar.tsx`）+ 附图「选图（n/8）」；无重录。
- `video`：只读 `MediaGrid`（不传 `onRemove`）+ `Text`「视频发布后不能更换」。

`errors.ts` 与 web 相同两句 copy。

- [ ] **Step 4: 运行确认通过**

```
pnpm --filter @moment/app test -- src/features/compose/compose.service.test.ts
pnpm --filter @moment/app typecheck
```

Expected: PASS。`lint:tokens` 不新增 hex（`pnpm --filter @moment/app lint` 若改了 `src/` 建议跑一下）。

- [ ] **Step 5: Commit**

```
feat(app): edit published moment images
```

**手测清单：** 编辑图文叉/加；文字补图；voice 改附图且不能换录音；视频只读文案；满 9 禁用；系统相册 `selectionLimit` 与 remain 一致（不会选中后被丢掉）。

---

## 执行顺序

T1 → T2 → T3 → T4。T3 在 T2 API 可用后即可；T4 镜像 T3 不互相阻塞代码，但 **不要在 T2 前对生产发带 `mediaIds` 的客户端**（旧 server 会 `VALIDATION_ERROR`）。T1 禁止单独上线。

---

## 自检

### spec §0 锁定决策 → Task

| # | 决策 | Task |
|---|---|---|
| 1 | PATCH 可选 `mediaIds` 全量替换；未动不传 | T1 schema + T3/T4 dirty |
| 2 | 客户端不传 `type`；server 按原 type 推导 | T1 `.strict()` + T2 矩阵 |
| 3 | `media` 结果必须 1–9 张 image，不能删光 | T2 `MEDIA_COUNT_INVALID` + T3/T4 前置 |
| 4 | `text` 可加 1–9 图升级 `media` | T2 + T3/T4 |
| 5 | `voice` 锁原 audio，附图 0–8 | T2 矩阵 + T3/T4 cap=8 |
| 6 | `video` / poster 不做 → `MEDIA_NOT_ALLOWED` | T1 放行 poster 键 + T2 |
| 7 | 不能 media/voice/video 互转（除 text→media） | T2 矩阵 |
| 8 | 权限/软删不变 | T2 不改鉴权顺序；现网用例保留 |
| 9 | web+app 编辑态可改图 | T3 + T4 |
| 10 | 不改路由 | Global Constraints |
| 11 | CONVENTIONS §3 名不动；宫格用预签名 GET | Global + T3 `cardDisplayUrl` |

§3 dto、§4 事务步骤、§4.6 矩阵、§5 compress/sweeper、§6 web、§7 app、§8 错误码、§9 点名测试文件、§11 分期均有对应 Task。无覆盖缺口。

### 跨 Task 类型名

- `mediaIds?: string[]`
- `posterMediaId?: string | null`
- `editImageCap(edit: { type: MomentType }): 8 | 9`
- `editOccupied(keptMedia: MomentMedia[], images): number`
- compress payload `{ momentId, chainId, mediaId }`

### 占位符扫描

无 TBD / TODO / 「适当处理」/「类似 Task N」。
