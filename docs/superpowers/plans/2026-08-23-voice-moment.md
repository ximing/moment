# 语音时刻（voice moment）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第四种 moment 类型 `voice` = 1 段语音（必有）+ 0~8 附图（可选）+ ASR 异步转写回填：dto 加 audio 媒体契约与 voice moment 契约；server 扩 moments 表（type 枚举 + `transcript` / `transcription_status` 列）、presign audio 分支、发布事务 voice 校验与 `moment.transcribe` outbox、ASR provider + worker 转写 handler + 6h 悬挂 sweeper；web 端 MediaRecorder 录音 → 16kHz mono WAV 转码发布 + 播放条卡片；app 端 expo-audio 录音/播放 + 消费侧分支。「重新转写」入口、转写完成二次通知、波形图、media 宫格混排 audio 均不做（spec §0 搁置决策）。

**Architecture:** 数据层与 media moment 同构（都靠 media 行绑定，恰好 1 个 `audio/*` + 0~8 个 `image/*`），media 表零改动（无 kind 列，`duration` 列复用为音频时长）。转写与原文分离：`content` 存展示文本（用户可编辑），`transcript` 存 ASR 原始转写（不可改）。发布即上时间线（`transcription_status='pending'`，语音立即可播），转写走 outbox + worker 回填（成功单事务落 `transcript` + `done` + `content` 条件回填 `WHERE content=''`）。失败语义：RetryableLLMError 传播走 processor 退避；NonRetryable / 停用 / 异常态 handler 自落 `failed`；sweeper 6h cutoff 兜底悬挂 pending。ASR provider 与 recap 的 `LLM_*` 完全独立（`ASR_*` 三个新环境变量，空 key = 停用转写）。

**Tech Stack:** zod ^3（dto）/ routing-controllers + Drizzle + MySQL + Jest 触库测试（server）/ OpenAI 兼容 `/audio/transcriptions` multipart（ASR）/ React 19 + @rabjs/react + MediaRecorder + AudioContext/OfflineAudioContext（web，纯 Web API 无新依赖）/ Expo SDK 54 + expo-audio（app，新原生依赖）。

**Spec:** `docs/superpowers/specs/2026-08-23-voice-moment-design.md`（唯一真相源；本计划不超出其范围）

## Global Constraints

- **新环境变量** `ASR_BASE_URL` / `ASR_API_KEY` / `ASR_MODEL`：必须同步 `apps/server/src/config.ts`（zod）与 `apps/server/.env.example`（根 CLAUDE.md 强约定）；`apps/server/.env` 严禁提交或覆盖。
- **无新表**：`apps/server/tests/helpers/db.ts` 的 `resetDb()` 无需扩展。moments 表迁移由 `drizzle-kit generate` 产出，不手写 SQL。
- **spec 钉死决策不得推翻**：app 录音用 expo-audio（不装 expo-av）；web 浏览器内转码 16kHz mono WAV（白名单不收 `audio/webm` / `audio/ogg`）；sweeper cutoff 6h（必须大于 processor 最大累计退避 ≈5h21m，理由见 spec §4.4）；转写回填截断 5000 字符（对齐 dto `content` `max(5000)`）；`content` / `transcript` 分离；ASR 停用形态 = 「create 恒 emit `moment.transcribe` + handler 判 `getASRProvider() === null` 落 `failed`」（spec §0，不得改为条件 emit）。
- server 触库测试遵守 `.claude/rules/testing.md`：`--runInBand`（已内置在 test 脚本）、`afterAll(closeDb)`、只打 `.env` 指向的测试库；**测试库是远程共享 MySQL，严禁同时跑两个 jest 会话**；S3 走 `installMockStorage()`。
- web 端 UI 遵循根 CLAUDE.md 列出的六份 C 端设计规范与 `.claude/rules/web-ui.md`：只消费 `src/ui/` 组件与 tokens.css 语义 token，禁止写死色值/一次性尺寸。
- app 端新代码消费 `useTheme()` token；`pnpm --filter @moment/app lint` 含 `lint:tokens` 门禁（`src/` 禁 hex/rgba）。
- ESM NodeNext：server/dto/api-client 的 TS 相对 import 一律带 `.js` 后缀（web/app 的 bundler 解析不加，沿用各端现状）。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **web 录制入口是「录音」媒体按钮而非「类型选择」**：spec §5 写「类型选择与现有 text/media/video 平级」，但 web compose-panel 无类型选择控件——类型在 submit 由媒体状态推导（`compose-panel.service.ts` L329 `const type = hasVideo ? 'video' : hasImages ? 'media' : 'text'`）；类型选择 UI 只存在于 app 端 SegmentBar。web 按既有「加图片 / 加视频」媒体入口范式新增 VoiceRecorder（自带「录音」按钮），submit 推导链扩为 `hasVoice` 前置；入口与其他媒体类型平级可见，语义与 spec 一致。app 端严格按 spec：SegmentBar 新增「语音」选项。
2. **web `MediaBlock.tsx` 零改动**：spec §5 点名 MediaBlock 为「必须修改点」，但具体要求原文是「voice 卡片不该走 MediaBlock 渲 audio 行，**调用方须先拆出 audio 行**」——修改落在调用方 `moment-sheet.tsx`（voice 分支只把 `image/*` 行交给 MediaBlock），MediaBlock 本身不需要改。app 侧 `MediaGrid.tsx` 按 spec 原文加 `image/*` 显式守卫（else 分支按图渲染会吞 `audio/*`）。
3. **app 播放用 expo-audio `useAudioPlayer`**：spec §6 允许 expo-audio 与已装 expo-video 二选一；录制已引入 expo-audio，播放复用同库，不重复引依赖范式。
4. **recap input 字段表述微调**：spec §0 写 recap input「只 select content/kind/payload」——实际 `loadMomentsInPeriod` select 7 个字段（id/authorId/content/happenedAt/happenedTzOffset/kind/payload，`apps/server/src/llm/recap/input.ts` L62-73），但进入摘要文本的只有 content/kind/payload；结论（voice 空 content 参与 recap 属可接受退化、不改代码）不变。
5. **worker handler 下载音频用全局 `fetch`**：Node 20 全局 fetch 直取预签名 GET URL；测试 stub `globalThis.fetch`（与 `tests/llm/provider.test.ts` 同范式），`installMockStorage()` 的 `generateAccessUrl` 返回假 URL。
6. **spec §5/§6 行号已核实**：`moment-sheet.tsx` L69 images filter、`MediaGrid.tsx` L41 video 三元、`features/moment/index.tsx` L115 video 三元均与实际代码逐字吻合。

---

### Task 1: dto 契约 — audio 媒体常量/白名单/presign 扩展 + voice moment 类型与响应字段

**Files:**
- Modify: `packages/dto/src/media.ts`
- Modify: `packages/dto/src/moments.ts`
- Test: `packages/dto/src/media.test.ts`（扩展，同目录不触库）
- Test: `packages/dto/src/moments.test.ts`（扩展，同目录不触库）

**Interfaces:**
- Consumes: 既有 `mediaPresignInputSchema` / `IMAGE_MIME_TYPES` / `VIDEO_MIME_TYPES` / `createMomentInputSchema` / `patchMomentInputSchema` / `MomentResponse`。
- Produces（后续所有 Task 消费，不得改名）:
  - `MAX_AUDIO_BYTES = 25 * 1024 * 1024`、`MAX_AUDIO_DURATION_SECONDS = 300`、`AUDIO_MIME_TYPES`（6 项，`as const`）。
  - `mediaPresignInputSchema`：`kind` 枚举扩为 `'image' | 'video' | 'audio'`；audio 走 `AUDIO_MIME_TYPES` 白名单且 `durationSeconds` 必填 ≤300。
  - `momentTypeSchema` 扩为 `'text' | 'media' | 'video' | 'voice'`；`MomentType` 推导类型自动带出。
  - `MomentResponse.transcript: string | null` / `MomentResponse.transcriptionStatus: 'pending' | 'done' | 'failed' | null`（两个**必填**字段——必填是 web/server 夹具同步的依据，spec §8）。

- [ ] **Step 1: 写失败测试**

`packages/dto/src/media.test.ts` import 行改为：

```ts
import {
  AUDIO_MIME_TYPES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaCompleteInputSchema,
  mediaPartsInputSchema,
  mediaPresignInputSchema,
} from './media.js';
```

文件末尾追加：

```ts
test('audio 常量：25MB / 300s / 白名单 6 项（spec voice-moment §2.1）', () => {
  assert.equal(MAX_AUDIO_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_AUDIO_DURATION_SECONDS, 300);
  assert.deepEqual([...AUDIO_MIME_TYPES], [
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
  ]);
});

test('mediaPresignInputSchema：kind=audio 白名单 mime + durationSeconds 必填 ≤300', () => {
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio', durationSeconds: 60 }).success
  );
  assert.ok(
    mediaPresignInputSchema.safeParse({ mime: 'audio/mp4', size: 1000, kind: 'audio', durationSeconds: 300 }).success
  );
  // 非白名单：webm/ogg 不收（ASR 对 webm/opus 支持不稳定，web 端浏览器内转码 WAV，spec §2.1）
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/webm', size: 1000, kind: 'audio', durationSeconds: 60 }).success
  );
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/ogg', size: 1000, kind: 'audio', durationSeconds: 60 }).success
  );
  // 缺 durationSeconds / 超 300
  assert.ok(!mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio' }).success);
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'audio/wav', size: 1000, kind: 'audio', durationSeconds: 301 }).success
  );
  // kind 与 mime 类属不匹配
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'audio', durationSeconds: 60 }).success
  );
});

test('mediaPresignInputSchema：image 分支既有校验不回归（禁传 durationSeconds）', () => {
  assert.ok(
    !mediaPresignInputSchema.safeParse({ mime: 'image/jpeg', size: 1000, kind: 'image', durationSeconds: 60 }).success
  );
});
```

`packages/dto/src/moments.test.ts` 末尾追加：

```ts
test('createMomentInputSchema：type=voice mediaIds 1~9（0/10 拒绝，MEDIA_COUNT_INVALID）', () => {
  const voice = { ...base, type: 'voice' as const, content: '' };
  assert.ok(!createMomentInputSchema.safeParse({ ...voice, mediaIds: [] }).success);
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...voice,
      mediaIds: Array.from({ length: 10 }, (_, i) => `m-${i}`),
    }).success
  );
  assert.ok(createMomentInputSchema.safeParse({ ...voice, mediaIds: ['a-1'] }).success);
  assert.ok(
    createMomentInputSchema.safeParse({ ...voice, mediaIds: Array.from({ length: 9 }, (_, i) => `m-${i}`) }).success
  );
});

test('createMomentInputSchema：type=voice 重复 mediaId 拒绝（MEDIA_COUNT_INVALID）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({ ...base, type: 'voice', content: '', mediaIds: ['m-1', 'm-1'] }).success
  );
});

test('createMomentInputSchema：type=voice 空 content 通过（转写回填前无文本，spec §2.2）', () => {
  assert.ok(createMomentInputSchema.safeParse({ ...base, type: 'voice', content: '', mediaIds: ['a-1'] }).success);
});

test('createMomentInputSchema：type=voice 传 posterMediaId → MEDIA_NOT_ALLOWED（封面仅 video）', () => {
  assert.ok(
    !createMomentInputSchema.safeParse({
      ...base,
      type: 'voice',
      content: '',
      mediaIds: ['a-1'],
      posterMediaId: 'p-1',
    }).success
  );
});

test('patchMomentInputSchema：.strict() 拒绝 transcript / transcriptionStatus（转写不可经 API 改）', () => {
  assert.ok(!patchMomentInputSchema.safeParse({ transcript: 'x' }).success);
  assert.ok(!patchMomentInputSchema.safeParse({ transcriptionStatus: 'done' }).success);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL——「audio 常量」（符号不存在，tsx 运行即抛）、「1~9 边界」中两个 `.success` 断言（voice 不在枚举内，parse 全失败）、「空 content 通过」失败。

> 注：断言 `!success` 的用例（重复 id / posterMediaId / patch strict / webm/ogg）在实现前因「voice 非法」或「未知键被 strict 拒绝」而偶然为绿，属预期；真正的红灯由 `.success` 断言与符号缺失提供。

- [ ] **Step 3: 实现 `media.ts` audio 契约**

Modify `packages/dto/src/media.ts`：

1. `MAX_VIDEO_DURATION_SECONDS` 行后追加：

```ts
/** 语音 ≤25MB（对齐主流 ASR 文件上限）；≤5 分钟（与视频时长上限同值同语义，spec voice-moment §2.1）。 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 300;
/**
 * 音频 mime 白名单（同 IMAGE/VIDEO 的安全理由：不放行任意 audio/*）。
 * 不收 audio/webm / audio/ogg：百炼/硅基流动对 webm/opus 支持不稳定，web 端浏览器内转码 WAV 再上传（spec §5）。
 */
export const AUDIO_MIME_TYPES = [
  'audio/mp4', // m4a / AAC（app 端 expo-audio 录音预设产物，spec §6）
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg', // mp3
  'audio/wav', // web 端 MediaRecorder → PCM/WAV 转码产物
  'audio/x-wav',
] as const;
```

2. `kind` 枚举（L30）改为 `kind: z.enum(['image', 'video', 'audio']),`；`durationSeconds` 注释行的 `.max(MAX_VIDEO_DURATION_SECONDS)` 不动（300 同值）。

3. `superRefine` 首行改为三分支：

```ts
    const allowed =
      val.kind === 'image' ? IMAGE_MIME_TYPES : val.kind === 'video' ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
```

4. image 分支校验块之后追加：

```ts
    // audio 必填时长：voice 卡片的时长展示与 5 分钟上限强依赖它，服务端不探测实际时长（与视频同取舍，spec §2.1）
    if (val.kind === 'audio' && val.durationSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MEDIA_INVALID',
        path: ['durationSeconds'],
      });
    }
```

- [ ] **Step 4: 实现 `moments.ts` voice 契约**

Modify `packages/dto/src/moments.ts`：

1. L5 改为 `export const momentTypeSchema = z.enum(['text', 'media', 'video', 'voice']);`

2. `superRefine` 中 media count 检查块（`type === 'media'` 判断行）之后追加：

```ts
    // voice = 1 语音 + 0~8 附图（dto 只验数量与去重；「恰好 1 条 audio/* 且其余全 image/*」
    // 的 mime 构成校验在 server 发布事务内做，与 video/media 同分工，spec §2.2）
    if (val.type === 'voice' && (val.mediaIds.length < 1 || val.mediaIds.length > 9)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
```

   重复 id 检查（`val.type !== 'text'`）与 posterMediaId 检查（`val.type !== 'video'`）已天然覆盖 voice，不改。

3. `MomentResponse` 的 `content: string;` 行后追加：

```ts
  /** ASR 原始转写；仅 voice 可能非空，其余类型恒 null（用户不可改，PATCH .strict() 拒绝） */
  transcript: string | null;
  /** 转写状态；仅 voice 非空（pending/done/failed），其余类型恒 null */
  transcriptionStatus: 'pending' | 'done' | 'failed' | null;
```

   `patchMomentInputSchema` 不动（`.strict()` 自动拒绝两键）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build && pnpm --filter @moment/dto lint`
Expected: 全过（既有校验矩阵不回归），build/lint exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/media.ts packages/dto/src/moments.ts packages/dto/src/media.test.ts packages/dto/src/moments.test.ts
git commit -m "feat(dto): add voice moment type and audio media contracts"
```

---

### Task 2: api-client — upload 支持 audio kind 与 25MB 本地上限

**Files:**
- Modify: `packages/api-client/src/upload.ts`
- Test: `packages/api-client/src/upload.test.ts`（扩展，node:test 不触库）

**Interfaces:**
- Consumes: Task 1 的 `MAX_AUDIO_BYTES`；既有 `uploadMediaImpl(http, options, input)` / `UploadMediaInput` / mock fetch 测试基建。
- Produces:
  - `UploadMediaInput.kind: 'image' | 'video' | 'audio'`（web/app 上传语音的唯一入口签名）。
  - 上传前 size 上限三分支：audio 走 `MAX_AUDIO_BYTES`（不扩则 audio 被当 video 按 500MB 放行，spec §2.3）。

- [ ] **Step 1: 写失败测试**

`packages/api-client/src/upload.test.ts` import 行改为：

```ts
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
```

文件末尾追加：

```ts
test('音频：presign(put) → 单次 PUT → complete(parts=[])；presign 携带 kind=audio 与 durationSeconds', async () => {
  const { client, calls, putUrls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'https://s3/put', uploadId: null, partSize: null },
  });
  const blob = new Blob(['wav-bytes']);
  await client.uploadMedia({
    file: blob,
    mime: 'audio/wav',
    size: blob.size,
    kind: 'audio',
    durationSeconds: 12,
  });
  assert.deepEqual(putUrls, ['https://s3/put']);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST /api/media/presign',
    'POST /api/media/md1/complete',
  ]);
  assert.equal((calls[0]!.body as { kind?: string }).kind, 'audio');
  assert.equal((calls[0]!.body as { durationSeconds?: number }).durationSeconds, 12);
});

test('音频超 MAX_AUDIO_BYTES → 本地直接 413 MEDIA_TOO_LARGE，不发起任何请求', async () => {
  const { client, calls } = makeClient({
    presignBody: { mediaId: 'md1', method: 'put', url: 'u', uploadId: null, partSize: null },
  });
  await assert.rejects(
    () =>
      client.uploadMedia({
        file: new Blob(['x']),
        mime: 'audio/wav',
        size: MAX_AUDIO_BYTES + 1,
        kind: 'audio',
        durationSeconds: 12,
      }),
    (e: unknown) => e instanceof ApiError && e.code === 'MEDIA_TOO_LARGE' && e.status === 413
  );
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL——「超 MAX_AUDIO_BYTES」用例：audio 未入 size 分支时被当 video 按 500MB 放行，本地上限不触发、请求实际发出（`calls.length !== 0` 且 reject 不匹配）。

> 注：`tsx --test` 不做类型检查，`kind: 'audio'` 的联合类型红灯由下一步的 typecheck 命令补验；运行时红灯由 size 用例提供（spec §8：dto 测试不 import api-client，tsc 管不到运行时三元，必须靠本条单测）。

- [ ] **Step 3: 实现 upload.ts audio 分支**

Modify `packages/api-client/src/upload.ts`：

1. L1 import 改为：

```ts
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_PART_SIZE } from '@moment/dto';
```

2. `UploadMediaInput.kind`（L14）改为：

```ts
  kind: 'image' | 'video' | 'audio';
```

3. size 上限三元（L33）改为：

```ts
  const limit =
    input.kind === 'image' ? MAX_IMAGE_BYTES : input.kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client build`
Expected: 全过，typecheck/build exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/api-client/src/upload.ts packages/api-client/src/upload.test.ts
git commit -m "feat(api-client): support audio upload kind with 25MB local limit"
```

---

### Task 3: server — moments 表 voice 枚举 + transcript / transcription_status 列迁移

**Files:**
- Modify: `apps/server/src/db/schema/moments.ts`
- Create: `apps/server/drizzle/0013_<generated>.sql` + `apps/server/drizzle/meta/` 快照（drizzle-kit generate 产出，文件名以实际生成为准）
- Test: `apps/server/tests/moments/voice-columns.test.ts`（新建，触库）

**Interfaces:**
- Consumes: 既有 schema 范式（`mysqlEnum` / `text` 可空列）、`drizzle-kit generate`、`tsx src/db/migrate.ts`。
- Produces:
  - moments 表 `type` 枚举含 `'voice'`；`transcript text NULL`；`transcription_status enum('pending','done','failed') NULL`。
  - `Moment` / `NewMoment` 推导类型自动带出 `transcript` / `transcriptionStatus`（Task 5/8/9 消费）。
  - 无新表，`resetDb()` 不扩展。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/voice-columns.test.ts`：

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, moments, users } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

it('moments 表：voice 类型 + transcript/transcription_status 列 round-trip（spec voice-moment §1）', async () => {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const id = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id,
    chainId,
    authorId: userId,
    type: 'voice',
    content: '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: 'pending',
  });
  const [row] = await db.select().from(moments).where(eq(moments.id, id));
  expect(row.type).toBe('voice');
  expect(row.transcriptionStatus).toBe('pending');
  expect(row.transcript).toBeNull();

  await db.update(moments).set({ transcript: '你好', transcriptionStatus: 'done' }).where(eq(moments.id, id));
  const [done] = await db.select().from(moments).where(eq(moments.id, id));
  expect(done.transcript).toBe('你好');
  expect(done.transcriptionStatus).toBe('done');

  // 非 voice 类型两列恒 NULL（可空而非 default，spec §1）
  const textId = randomUUID();
  await db.insert(moments).values({
    id: textId,
    chainId,
    authorId: userId,
    type: 'text',
    content: 'hi',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
  });
  const [textRow] = await db.select().from(moments).where(eq(moments.id, textId));
  expect(textRow.transcript).toBeNull();
  expect(textRow.transcriptionStatus).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/voice-columns.test.ts`
Expected: FAIL——schema 尚无 `transcriptionStatus` 列（TS 编译错或 SQL 列不存在/枚举值非法）。

- [ ] **Step 3: 修改 schema 并生成迁移**

Modify `apps/server/src/db/schema/moments.ts`：

1. `type` 行（L16）改为：

```ts
    type: mysqlEnum('type', ['text', 'media', 'video', 'voice']).notNull(),
```

2. `content: text('content').notNull(),` 行后追加：

```ts
    /** ASR 原始转写（spec voice-moment §1）；仅 voice 可能非空，用户不可改（PATCH .strict() 拒绝） */
    transcript: text('transcript'),
    /** 转写状态；仅 voice 非空：创建 pending → done/failed；非 voice 恒 NULL
        （用可空而非 default，避免给 text/media/video 行赋予无意义的转写语义，spec §1） */
    transcriptionStatus: mysqlEnum('transcription_status', ['pending', 'done', 'failed']),
```

Run: `pnpm --filter @moment/server migrate:generate`
Expected: `apps/server/drizzle/` 新增 `0013_*.sql` + meta 快照。**人工核对生成的 SQL**：必须包含 `MODIFY COLUMN type` 枚举扩为四值 + `ADD COLUMN transcript text` + `ADD COLUMN transcription_status enum('pending','done','failed')`（两列可空、无 default）；不得含其他表的意外改动（若有，说明 meta 漂移，停下来排查，不要直接提交）。

- [ ] **Step 4: 应用迁移**

Run: `pnpm --filter @moment/server migrate`
Expected: exit 0（打 `.env` 指向的开发/测试库——红线：严禁生产库）。jest globalSetup 会在测试启动时自动跑迁移，此步是让 `.env` 库与测试库同步到 0013。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/voice-columns.test.ts`
Expected: PASS。再跑既有 moments 测试防回归：

Run: `pnpm --filter @moment/server test -- tests/moments/`
Expected: 全过（type 枚举加值是向后兼容改动）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/db/schema/moments.ts apps/server/drizzle/ apps/server/tests/moments/voice-columns.test.ts
git commit -m "feat(server): add voice type and transcription columns to moments"
```

---

### Task 4: server — presign 接受 audio kind（单 PUT + 25MB 上限）

**Files:**
- Modify: `apps/server/src/media/media.service.ts`（仅 `presign` 方法）
- Test: `apps/server/tests/media/presign-audio.test.ts`（新建，触库）

**Interfaces:**
- Consumes: Task 1 的 `MAX_AUDIO_BYTES` 与 `mediaPresignInputSchema` audio 分支；既有 `installMockStorage()` / `createUser` / `listenLocal`。
- Produces:
  - `MediaService.presign`：`kind === 'audio'` → size > `MAX_AUDIO_BYTES` 抛 413 `MEDIA_TOO_LARGE`；audio 与 image 同走单 PUT（`method: 'put'`），`duration` 列落 `durationSeconds`。
  - complete / abort / resolveAccessUrl 零改动（按行上 mime 与状态工作，对 audio 天然成立，spec §3.1）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/media/presign-audio.test.ts`：

```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { MAX_AUDIO_BYTES } from '@moment/dto';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';
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

async function presignAudio(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12, ...over });
}

describe('POST /api/media/presign（audio，spec voice-moment §3.1）', () => {
  it('audio：单 PUT（method=put），duration 落库，不启 multipart', async () => {
    const res = await presignAudio(alice.token);
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('put');
    expect(res.body.url).toBe('https://fake.local/presigned-put');
    expect(res.body.uploadId).toBeNull();
    expect(res.body.partSize).toBeNull();

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row).toMatchObject({ mime: 'audio/wav', status: 'uploading', duration: 12, uploadId: null });
    expect(row.s3Key).toBe(`tmp/${res.body.mediaId}.wav`);
    expect(storage.initMultipart).not.toHaveBeenCalled();
  });

  it('audio 超 25MB → 413 MEDIA_TOO_LARGE，且不插行', async () => {
    const res = await presignAudio(alice.token, { size: MAX_AUDIO_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('audio 缺 durationSeconds → 400 VALIDATION_ERROR（dto superRefine）', async () => {
    const res = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'audio/wav', size: 1024, kind: 'audio' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audio 非白名单 mime（audio/webm）→ 400 VALIDATION_ERROR', async () => {
    const res = await presignAudio(alice.token, { mime: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audio complete → ready（complete 按行工作，对 audio 零改动，spec §3.1）', async () => {
    const presigned = await presignAudio(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mediaId: presigned.body.mediaId, status: 'ready', mime: 'audio/wav', size: 1024 });
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/media/presign-audio.test.ts`
Expected: FAIL——首条用例挂在 `method` 断言（presign 返回 201 成功，但 dto 放行 `kind: 'audio'` 后服务端落入 multipart 分支：`method` 为 `multipart`、`uploadId` 非空且 `initMultipart` 被调，与期望的 `put` / `uploadId: null` 不符）；「超 25MB」用例无 413（audio 不进 size 校验，201 插行）。

> 注：Task 1 已让 dto 放行 `kind: 'audio'`，故红灯落在 service 行为而非 400 VALIDATION_ERROR；「缺 durationSeconds」「webm」两条在 dto 层已红转绿（Task 1 实现），本文件作为端到端防回归保留。

- [ ] **Step 3: 实现 presign audio 分支**

Modify `apps/server/src/media/media.service.ts`：

1. import 块（`@moment/dto` 解构）加 `MAX_AUDIO_BYTES`。

2. size 校验区（L47-52）加 audio 分支：

```ts
    if (input.kind === 'audio' && input.size > MAX_AUDIO_BYTES) {
      throw new HttpError(413, 'MEDIA_TOO_LARGE');
    }
```

3. 传输方式分支（L76）改为 `kind !== 'video'`：

```ts
    // image 与 audio 同走单 PUT（audio ≤25MB，不启 multipart，避免无谓分片复杂度，spec voice-moment §3.1）
    if (input.kind !== 'video') {
      const url = await getStorage().presignPut(
        tmpKey,
        { contentType: input.mime },
        config.PRESIGN_PUT_TTL_SECONDS
      );
      return { mediaId, method: 'put', url, uploadId: null, partSize: null };
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/media/`
Expected: 全过（既有 media.flow / media-access / presign-ttl 不回归）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/media/media.service.ts apps/server/tests/media/presign-audio.test.ts
git commit -m "feat(server): accept audio kind in media presign"
```

---

### Task 5: server — 发布事务 voice 校验 + moment.transcribe outbox + 序列化扩展

**Files:**
- Modify: `apps/server/src/outbox/types.ts`（新增 `OUTBOX_MOMENT_TRANSCRIBE`）
- Modify: `apps/server/src/moments/moment.service.ts`（`create` 方法）
- Modify: `apps/server/src/moments/moment-serializer.ts`（`MomentLike` + 出口两字段）
- Test: `apps/server/tests/moments/create-voice-moment.test.ts`（新建，触库）
- Modify: `apps/server/tests/moments/moment-serializer.test.ts`（夹具同步 + 新增断言）

**Interfaces:**
- Consumes: Task 3 的 `Moment.transcript` / `transcriptionStatus`；既有 `emitOutbox(tx, type, payload)`（CONVENTIONS §3.2）；`installMockStorage` / `createChainWithMembers` / `MockPushService` / `handleMomentDeleted`。
- Produces:
  - `OUTBOX_MOMENT_TRANSCRIBE = 'moment.transcribe'`（并入 `OutboxType` 联合；Task 8 handler 注册同名 key）。
  - `MomentService.create`：voice 的 mime 构成校验（恰好 1 `audio/*` + 其余全 `image/*`，显式拒绝 `video/*` 与多条 audio）；插入写 `transcriptionStatus: 'pending'`；同事务两行 outbox（`moment.created` + `moment.transcribe`，payload `{ momentId }`）。
  - `MomentLike.type` 联合含 `'voice'`，新增 `transcript: string | null` / `transcriptionStatus: 'pending' | 'done' | 'failed' | null`；`momentSerializer` 出口带两字段（非 voice 恒 `null`/`null`，db 行透传无分支）。
  - voice 的 audio 行**不排除**出 `media` 数组（与 video poster 相反——audio 是内容本体，spec §3.3）。

- [ ] **Step 1: 夹具同步（先修编译）**

Modify `apps/server/tests/moments/moment-serializer.test.ts`：文件头 `const moment = {...}` 字面量的 `content: '九张图',` 行后补两字段：

```ts
  content: '九张图',
  transcript: null,
  transcriptionStatus: null,
```

> 注：补字段后、`MomentLike` 扩展前，该文件因 excess property 报 TS 错，属预期（同 video-poster Task 2 的处理：Step 3 只跑新测试文件，类型错误在 Step 4 后消失）。

- [ ] **Step 2: 写失败测试**

Create `apps/server/tests/moments/create-voice-moment.test.ts`：

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
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

/** 走真实接口造一条 ready media（image 或 audio），返回 mediaId。 */
async function readyMedia(token: string, mime: string, kind: 'image' | 'audio'): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size: 1024, kind, ...(kind === 'audio' ? { durationSeconds: 12 } : {}) });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

/** 直插 ready 视频行（multipart 造数成本高，同 moment-poster.test.ts 模式）。 */
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
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const voiceBody = (mediaIds: string[], extra: Record<string, unknown> = {}) => ({
  type: 'voice' as const,
  content: '',
  happenedAt: '2026-08-23T10:00:00+08:00',
  happenedTzOffset: -480,
  mediaIds,
  ...extra,
});

async function setup() {
  const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
  return { chainId };
}

describe('POST moments type=voice（spec voice-moment §3.2/§3.3）', () => {
  it('成功：1 audio + 2 图，空 content；transcriptionStatus=pending；同事务两行 outbox', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const img1 = await readyMedia(alice.token, 'image/jpeg', 'image');
    const img2 = await readyMedia(alice.token, 'image/png', 'image');
    const res = await postMoment(alice.token, chainId, voiceBody([audioId, img1, img2]));
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('voice');
    expect(res.body.transcript).toBeNull();
    expect(res.body.transcriptionStatus).toBe('pending');
    // audio 行在 media 数组中（内容本体，不排除）；sortOrder 按 mediaIds 入参序
    expect(res.body.media).toHaveLength(3);
    expect(res.body.media[0]).toMatchObject({ id: audioId, mime: 'audio/wav', duration: 12, sortOrder: 0 });

    const [row] = await db.select().from(moments).where(eq(moments.id, res.body.id));
    expect(row.transcriptionStatus).toBe('pending');
    expect(row.transcript).toBeNull();

    const events = await db.select().from(outbox);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['moment.created', 'moment.transcribe']);
    const transcribe = events.find((e) => e.type === 'moment.transcribe')!;
    expect(transcribe.payload).toEqual({ momentId: res.body.id });

    // audio 行走同一 tmp→final copy 与 post-commit 清理
    expect(storage.copyObject).toHaveBeenCalledWith(
      `tmp/${audioId}.wav`,
      `chains/${chainId}/${res.body.id}/${audioId}.wav`,
      expect.anything()
    );
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${audioId}.wav`, expect.anything());
  });

  it('成功：仅 audio 无附图（0~8 图的下界）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/mp4', 'audio');
    const res = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(res.status).toBe(201);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].mime).toBe('audio/mp4');
  });

  it('2 条 audio → 400 MEDIA_INVALID（恰好 1 条 audio/*）', async () => {
    const { chainId } = await setup();
    const a1 = await readyMedia(alice.token, 'audio/wav', 'audio');
    const a2 = await readyMedia(alice.token, 'audio/wav', 'audio');
    const res = await postMoment(alice.token, chainId, voiceBody([a1, a2]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('纯图无 audio → 400 MEDIA_INVALID', async () => {
    const { chainId } = await setup();
    const img = await readyMedia(alice.token, 'image/jpeg', 'image');
    const res = await postMoment(alice.token, chainId, voiceBody([img]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('audio + video 附图 → 400 MEDIA_INVALID（voice 显式拒绝 video/*，spec §3.2）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const videoId = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, voiceBody([audioId, videoId]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('media 宫格夹带 audio → 400 MEDIA_INVALID（else 分支不放行 audio/*）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-23T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [audioId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('dto：voice mediaIds 空 → 400 VALIDATION_ERROR；传 posterMediaId → 400 VALIDATION_ERROR', async () => {
    const { chainId } = await setup();
    const empty = await postMoment(alice.token, chainId, voiceBody([]));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const poster = await postMoment(alice.token, chainId, voiceBody([audioId], { posterMediaId: audioId }));
    expect(poster.status).toBe(400);
    expect(poster.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH 传 transcript → 400 VALIDATION_ERROR（.strict()，转写不可经 API 改）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const created = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(created.status).toBe(201);
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ transcript: '手动改原文' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('非 voice 序列化：text moment 的 transcript / transcriptionStatus 恒 null', async () => {
    const { chainId } = await setup();
    const res = await postMoment(alice.token, chainId, {
      type: 'text',
      content: 'hi',
      happenedAt: '2026-08-23T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(res.status).toBe(201);
    expect(res.body.transcript).toBeNull();
    expect(res.body.transcriptionStatus).toBeNull();
  });

  it('软删带 audio 的 voice moment：handleMomentDeleted 后 audio 行 orphaned（既有路径覆盖，spec §3.5）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const created = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(created.status).toBe(201);
    await request(app)
      .delete(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    await handleMomentDeleted(
      { momentId: created.body.id, chainId, authorId: alice.id },
      { push: new MockPushService() }
    );
    const [audioRow] = await db.select().from(media).where(eq(media.id, audioId));
    expect(audioRow.status).toBe('orphaned');
  });
});
```

`apps/server/tests/moments/moment-serializer.test.ts` 末尾追加一个纯单测（出口透传）：

```ts
  it('voice：transcript / transcriptionStatus 透传出口；非 voice 恒 null（spec §3.3）', () => {
    const res = momentSerializer(
      { ...moment, type: 'voice', content: '', transcript: 'ASR 原文', transcriptionStatus: 'done' },
      { media: [], author: { id: 'u-1', nickname: 'Alice', avatarUrl: null } }
    );
    expect(res.transcript).toBe('ASR 原文');
    expect(res.transcriptionStatus).toBe('done');
    const plain = momentSerializer(moment, { media: [], author: { id: 'u-1', nickname: 'A', avatarUrl: null } });
    expect(plain.transcript).toBeNull();
    expect(plain.transcriptionStatus).toBeNull();
  });
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/create-voice-moment.test.ts`
Expected: FAIL——成功路径 400（voice 的 mime 校验不存在，`audio/*` 落 else 分支被拒）；outbox 仅 1 行；响应无 `transcriptionStatus`。

- [ ] **Step 4: 实现 outbox 类型 + create voice 分支**

1. Modify `apps/server/src/outbox/types.ts`：

```ts
export const OUTBOX_MOMENT_TRANSCRIBE = 'moment.transcribe';
```

   `OutboxType` 联合末尾加 `| typeof OUTBOX_MOMENT_TRANSCRIBE;`。

2. Modify `apps/server/src/moments/moment.service.ts`：

   a. import 行加常量：`import { OUTBOX_MOMENT_CREATED, OUTBOX_MOMENT_DELETED, OUTBOX_MOMENT_TRANSCRIBE } from '../outbox/types.js';`

   b. mime 校验块（L66-79）改为三分支（voice 前置独立——else 分支服务 media 宫格放行 `video/*`，voice 误走该分支会把 `video/*` 当合法附图放行，spec §3.2）：

```ts
        // 全部满足：数量一致（dto 已拒重复 id，此处防御）+ 属本人 + ready + 未绑定 + mime 构成匹配。
        // mime 构成三分支：voice 前置独立（恰好 1 条 audio/* 且其余全 image/*，显式拒绝 video/* 与多条 audio）；
        // video → 全 video/*；media 宫格允许 image/* 与 video/* 混排（不放行 audio/*，天然拒绝夹带）。
        const mimeOk =
          input.type === 'voice'
            ? mediaRows.filter((r) => r.mime.startsWith('audio/')).length === 1 &&
              mediaRows.every((r) => r.mime.startsWith('audio/') || r.mime.startsWith('image/'))
            : mediaRows.every((r) =>
                input.type === 'video'
                  ? r.mime.startsWith('video/')
                  : r.mime.startsWith('image/') || r.mime.startsWith('video/')
              );
        const valid =
          mediaRows.length === new Set(input.mediaIds).size &&
          mediaRows.every((r) => r.uploaderId === userId && r.status === 'ready' && r.momentId === null) &&
          mimeOk;
        if (!valid) throw new HttpError(400, 'MEDIA_INVALID');
```

   c. `tx.insert(moments).values({...})` 的 `isBackfill: input.isBackfill,` 行后加：

```ts
        // voice 创建即进入转写管线（spec §1：仅 voice 非空，其余类型恒 NULL；transcript 留 NULL）
        ...(input.type === 'voice' ? { transcriptionStatus: 'pending' as const } : {}),
```

   d. `emitOutbox(tx, OUTBOX_MOMENT_CREATED, ...)` 块之后加：

```ts
      // ASR 异步转写（spec §4.3）：create 恒 emit moment.transcribe；
      // 停用部署由 handler 判 getASRProvider()===null 落 failed，create 路径不读 ASR config（spec §0）
      if (input.type === 'voice') {
        await emitOutbox(tx, OUTBOX_MOMENT_TRANSCRIBE, { momentId });
      }
```

   tmp→final copy、行锁、tag 替换、`moment.created` 扇出全部沿用现有路径，无 voice 特判。

- [ ] **Step 5: 实现序列化扩展**

Modify `apps/server/src/moments/moment-serializer.ts`：

1. `MomentLike`（L8-20）：`type` 行改为 `type: 'text' | 'media' | 'video' | 'voice';`，`createdAt: Date;` 行后加：

```ts
  /** ASR 原始转写（db 行自带）；仅 voice 可能非空 */
  transcript: string | null;
  /** 转写状态；仅 voice 非空 */
  transcriptionStatus: 'pending' | 'done' | 'failed' | null;
```

2. `momentSerializer` 返回对象的 `content: m.content,` 行后加：

```ts
    transcript: m.transcript,
    transcriptionStatus: m.transcriptionStatus,
```

   `MediaLike` 与 media map 不动；批量函数不加 join、无 N+1（两列 db 行自带）。voice 的 audio 行不排除（poster 排除逻辑只作用于 posterIds 集合，audio 行不在其中，天然保留）。

- [ ] **Step 6: 运行确认通过**

Run:

```bash
pnpm --filter @moment/server test -- tests/moments/ tests/worker/handlers.test.ts
```

Expected: 全过。再跑 typecheck + lint：

```bash
pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```

Expected: 均 exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/outbox/types.ts apps/server/src/moments/moment.service.ts apps/server/src/moments/moment-serializer.ts apps/server/tests/moments/create-voice-moment.test.ts apps/server/tests/moments/moment-serializer.test.ts
git commit -m "feat(server): publish voice moments with transcription outbox and serialization"
```

---

### Task 6: server — 通知摘要 voice 空 content 兜底「[语音]」

**Files:**
- Modify: `apps/server/src/worker/handlers.ts`（仅 `handleMomentCreated`）
- Test: `apps/server/tests/worker/handlers.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 3 的 `type: 'voice'` 行；既有 `summarize(content, max)`（handlers.ts L23-25）、`setupChainMoment` 测试助手、`MockPushService`。
- Produces: voice 且 `content` 空白时通知 `summary` 与 `body` 摘要用固定文案 `[语音]`；其余类型零改动；转写完成后不二次通知（spec §0 搁置）。

- [ ] **Step 1: 写失败测试**

Modify `apps/server/tests/worker/handlers.test.ts`：

1. import 区：`import { chainMembers, comments, notifications, pushTokens } from '../../src/db/schema.js';` 改为加 `moments`：

```ts
import { chainMembers, comments, moments, notifications, pushTokens } from '../../src/db/schema.js';
```

   并追加两行 import：

```ts
import { randomUUID } from 'node:crypto';
import { wallDateOf } from '../../src/moments/wall-date.js';
```

2. `describe('handleMomentCreated（链内新 moment，spec §5.4）', ...)` 块内追加：

```ts
  it('voice 空 content：summary 与 body 摘要用 [语音] 兜底（spec §3.4）', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const chainId = await createChain(owner.id);
    await db.insert(chainMembers).values({ chainId, userId: member.id, role: 'viewer', joinedAt: new Date() });
    // insertMoment 夹具 type 恒 text，voice 直插（content 空 + transcriptionStatus pending）
    const momentId = randomUUID();
    const happenedAt = new Date('2026-08-23T02:00:00Z');
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: owner.id,
      type: 'voice',
      content: '',
      happenedAt,
      happenedTzOffset: 0,
      wallDate: wallDateOf(happenedAt, 0),
      transcriptionStatus: 'pending',
    });
    const push = new MockPushService();

    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.summary).toBe('[语音]');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handlers.test.ts`
Expected: FAIL——`summary` 为 `''`（空串）而非 `[语音]`。

- [ ] **Step 3: 实现兜底**

Modify `apps/server/src/worker/handlers.ts` 的 `handleMomentCreated`：`const actorNickname = nicknames.get(authorId) ?? '';` 行后加：

```ts
  // voice 发布时 content 通常为空：推送摘要用固定文案兜底（spec §3.4）；转写完成后不二次通知（spec §0 搁置）
  const emptyVoice = m.type === 'voice' && m.content.trim().length === 0;
  const summary = emptyVoice ? '[语音]' : summarize(m.content);
  const bodySummary = emptyVoice ? '[语音]' : summarize(m.content, 30);
```

   `summary: summarize(m.content),`（L73）改为 `summary,`；`body` 模板（L76）改为 `` body: `${actorNickname} 发布了新动态：${bodySummary}`, ``。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/handlers.test.ts`
Expected: 全过（既有扇出/快照用例不回归）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/handlers.ts apps/server/tests/worker/handlers.test.ts
git commit -m "feat(server): fallback push summary for empty-content voice moments"
```

---

### Task 7: server — ASR provider 子模块 + ASR_* 配置

**Files:**
- Create: `apps/server/src/llm/asr/base.provider.ts`
- Create: `apps/server/src/llm/asr/openai-compat.provider.ts`
- Create: `apps/server/src/llm/asr/factory.ts`
- Modify: `apps/server/src/config.ts`（LLM 块后新增 ASR 三变量）
- Modify: `apps/server/.env.example`（LLM 段后同步）
- Test: `apps/server/tests/llm/asr-provider.test.ts`（新建，不触库）

**Interfaces:**
- Consumes: `RetryableLLMError` / `NonRetryableLLMError`（`src/llm/base.provider.ts`——分类语义与 outbox 退避契约完全一致，类名里的 LLM 是历史命名，spec §4.1）；`llm/factory.ts` 三态单例范式；`llm/openai-compat.provider.ts` 错误分类范式。
- Produces（Task 8 消费，不得改名）:

```ts
// src/llm/asr/base.provider.ts
export interface ASRTranscribeRequest {
  /** 音频字节（worker 从 S3 下载）；≤25MB，内存可控 */
  audio: Buffer;
  /** 行上 mime（白名单内），provider 据此定 multipart filename 扩展名 */
  mime: string;
}
export interface ASRProvider {
  transcribe(req: ASRTranscribeRequest): Promise<{ text: string }>;
}
// src/llm/asr/factory.ts
export function getASRProvider(): ASRProvider | null; // ASR_API_KEY 空 → null（停用转写）
export function setASRProvider(p: ASRProvider | null | undefined): void; // 测试注入点，严禁业务代码使用
// src/llm/asr/openai-compat.provider.ts
export class OpenAICompatASRProvider implements ASRProvider {
  constructor(opts: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number });
}
```

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/asr-provider.test.ts`：

```ts
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { getASRProvider, setASRProvider } from '../../src/llm/asr/factory.js';
import { OpenAICompatASRProvider } from '../../src/llm/asr/openai-compat.provider.js';

/** mock fetch 工厂：返回指定 status + JSON body（与 tests/llm/provider.test.ts 同范式） */
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function mockFetchNetworkError(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed: ECONNREFUSED');
  }) as typeof fetch;
}

/** mock fetch 永不 resolve，signal abort 时 reject AbortError（触发 provider 超时路径） */
function mockFetchHang(): typeof fetch {
  return ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        },
        { once: true }
      );
    })) as typeof fetch;
}

const baseOpts = {
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: 'sk-test',
  model: 'FunAudioLLM/SenseVoiceSmall',
  timeoutMs: 100,
};
const audioReq = { audio: Buffer.from('fake-wav'), mime: 'audio/wav' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('OpenAICompatASRProvider.transcribe（spec voice-moment §4.1）', () => {
  it('成功：multipart POST {baseUrl}/audio/transcriptions，file + model 字段，解析 text', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    let seenAuth = '';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seenUrl = String(input);
      seenBody = init?.body;
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
      return new Response(JSON.stringify({ text: '宝宝第一次叫奶奶' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const res = await new OpenAICompatASRProvider(baseOpts).transcribe(audioReq);

    expect(res.text).toBe('宝宝第一次叫奶奶');
    expect(seenUrl).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(seenBody).toBeInstanceOf(FormData);
    const form = seenBody as FormData;
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('audio.wav'); // mime → filename 扩展名
  });

  it('空文本是合法转写结果（笑声/环境音），返回空串', async () => {
    globalThis.fetch = mockFetch(200, { text: '' });
    const res = await new OpenAICompatASRProvider(baseOpts).transcribe(audioReq);
    expect(res.text).toBe('');
  });

  it('429 / 5xx → RetryableLLMError', async () => {
    globalThis.fetch = mockFetch(429, { error: { message: 'rate limited' } });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError
    );
    globalThis.fetch = mockFetch(500, {});
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError
    );
  });

  it('其他 4xx → NonRetryableLLMError', async () => {
    globalThis.fetch = mockFetch(400, { error: { message: 'bad file' } });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      NonRetryableLLMError
    );
  });

  it('网络错误 → RetryableLLMError', async () => {
    globalThis.fetch = mockFetchNetworkError();
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError
    );
  });

  it('超时（AbortError）→ RetryableLLMError', async () => {
    globalThis.fetch = mockFetchHang();
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError
    );
  });

  it('200 但缺 text → NonRetryableLLMError（畸形响应不重试）', async () => {
    globalThis.fetch = mockFetch(200, { nope: 1 });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      NonRetryableLLMError
    );
  });
});

describe('getASRProvider / setASRProvider（三态，与 llm/factory.ts 同范式）', () => {
  afterEach(() => setASRProvider(undefined));

  it('注入 mock → 返回该 mock（单例缓存）', () => {
    const mock: ASRProvider = { transcribe: async () => ({ text: 'x' }) };
    setASRProvider(mock);
    expect(getASRProvider()).toBe(mock);
    expect(getASRProvider()).toBe(mock);
  });

  it('注入 null → 返回 null（模拟空 key 停用转写）', () => {
    setASRProvider(null);
    expect(getASRProvider()).toBeNull();
  });

  it('重置（undefined）→ 回落真实 config：测试 env 无 ASR_API_KEY → null', () => {
    setASRProvider(undefined);
    expect(getASRProvider()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/asr-provider.test.ts`
Expected: FAIL——模块 `../../src/llm/asr/*` 不存在（模块解析错）。

- [ ] **Step 3: 实现 ASR 子模块**

1. Create `apps/server/src/llm/asr/base.provider.ts`：

```ts
/**
 * ASR Provider 接口（spec voice-moment §4.1）。
 * 与 LLMProvider 同范式：接口 + 默认实现 + factory 单例 + 测试注入点。
 * 错误分类复用 ../base.provider.js 的 RetryableLLMError / NonRetryableLLMError——
 * 分类语义与 outbox 退避契约完全一致（429/5xx/网络/超时 vs 其他 4xx），类名里的 LLM 是历史命名。
 */
export interface ASRTranscribeRequest {
  /** 音频字节（worker 从 S3 下载）；≤25MB，内存可控 */
  audio: Buffer;
  /** 行上 mime（白名单内），provider 据此定 multipart filename 扩展名 */
  mime: string;
}

export interface ASRProvider {
  transcribe(req: ASRTranscribeRequest): Promise<{ text: string }>;
}
```

2. Create `apps/server/src/llm/asr/openai-compat.provider.ts`：

```ts
import { NonRetryableLLMError, RetryableLLMError } from '../base.provider.js';
import type { ASRProvider, ASRTranscribeRequest } from './base.provider.js';

export interface OpenAICompatASRProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒，默认 60000（对齐 LLM provider） */
  timeoutMs?: number;
}

/** 白名单 mime → multipart filename 扩展名（ASR 端据此嗅探格式；dto AUDIO_MIME_TYPES 之外的 mime 不会到达这里） */
const EXT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/**
 * OpenAI 兼容 /audio/transcriptions 实现（spec voice-moment §4.1）。
 * 硅基流动 SenseVoice、百炼 OpenAI 兼容模式均吃这个端点形态。
 * 错误分类与 OpenAICompatProvider（chat）一致：429/5xx/网络/超时 → Retryable；其他 4xx → NonRetryable。
 */
export class OpenAICompatASRProvider implements ASRProvider {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAICompatASRProviderOptions) {
    const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
    this.url = `${base}/audio/transcriptions`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async transcribe(req: ASRTranscribeRequest): Promise<{ text: string }> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(req.audio)], { type: req.mime }),
      `audio.${EXT_BY_MIME[req.mime] ?? 'bin'}`
    );
    form.append('model', this.opts.model);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `ASR request timed out after ${this.timeoutMs}ms`
          : `ASR network error: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableLLMError(`ASR ${resp.status}: ${resp.statusText}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableLLMError(`ASR ${resp.status}: ${resp.statusText}`, resp.status);
    }

    const data = (await resp.json().catch(() => null)) as { text?: unknown } | null;
    if (!data || typeof data.text !== 'string') {
      throw new NonRetryableLLMError('ASR response missing text', resp.status);
    }
    return { text: data.text };
  }
}
```

3. Create `apps/server/src/llm/asr/factory.ts`：

```ts
import { config } from '../../config.js';
import type { ASRProvider } from './base.provider.js';
import { OpenAICompatASRProvider } from './openai-compat.provider.js';

// 三态语义（与 llm/factory.ts 逐字同范式）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: ASRProvider | null | undefined;
let override: ASRProvider | null | undefined;

/**
 * ASR provider factory 单例（spec voice-moment §4.1）。
 * ASR_API_KEY 为空 → 返回 null（转写整体停用；语音录制/播放不受影响，handler 落 failed）。
 * 与 LLM_* 完全独立——允许 ASR 和 chat 用不同服务商、单独停用。
 */
export function getASRProvider(): ASRProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.ASR_API_KEY
      ? new OpenAICompatASRProvider({ baseUrl: config.ASR_BASE_URL, apiKey: config.ASR_API_KEY, model: config.ASR_MODEL })
      : null;
  }
  return singleton;
}

/** 测试注入点（与 setLLMProvider 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setASRProvider(p: ASRProvider | null | undefined): void {
  override = p;
}
```

- [ ] **Step 4: 配置同步**

1. Modify `apps/server/src/config.ts`：LLM 块末行（`LLM_RECAP_MAX_CHARS` 行）之后、`});` 之前追加：

```ts
  // ---------- 语音转写 ASR（spec voice-moment §4.2；与 LLM_* 完全独立，可单独停用） ----------
  // OpenAI 兼容 /audio/transcriptions 端点（硅基流动 SenseVoice / 百炼 OpenAI 兼容模式）
  ASR_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
  // 凭据；空串 = 转写整体停用（语音录制/播放不受影响，停用期发布的 voice 由 handler 落 failed）
  ASR_API_KEY: z.string().default(''),
  // 模型名
  ASR_MODEL: z.string().default('FunAudioLLM/SenseVoiceSmall'),
```

2. Modify `apps/server/.env.example`：LLM 段（`LLM_RECAP_MAX_CHARS=8000` 行）之后追加：

```env

# ---------- 语音转写 ASR（与 LLM_* 完全独立，可单独停用） ----------
ASR_BASE_URL=https://api.siliconflow.cn/v1
# 注意：语音内容会出域到第三方 ASR（功能固有代价，无降级路径）；留空 = 转写整体停用（录音/播放不受影响）
ASR_API_KEY=
ASR_MODEL=FunAudioLLM/SenseVoiceSmall
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/llm/`
Expected: 全过（既有 config/factory/provider/recap 测试不回归——config 新增带默认值的环境变量不改变既有断言）。再跑 `pnpm --filter @moment/server typecheck`，exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/asr/ apps/server/src/config.ts apps/server/.env.example apps/server/tests/llm/asr-provider.test.ts
git commit -m "feat(server): add ASR provider with OpenAI-compatible transcriptions endpoint"
```

---

### Task 8: server — worker handleMomentTranscribe + 注册

**Files:**
- Modify: `apps/server/src/worker/handlers.ts`（新增 `handleMomentTranscribe` + 注册表）
- Test: `apps/server/tests/worker/handle-moment-transcribe.test.ts`（新建，触库）
- Modify: `apps/server/tests/worker/handlers.test.ts`（注册表断言 5 → 6）

**Interfaces:**
- Consumes: Task 5 的 `OUTBOX_MOMENT_TRANSCRIBE`；Task 7 的 `getASRProvider()` / `setASRProvider()` / `ASRProvider`；`RetryableLLMError` / `NonRetryableLLMError`；`getStorage().generateAccessUrl(key, metadata, expiresIn)`；Task 1 的 `MAX_AUDIO_BYTES`；`installMockStorage()`。
- Produces:
  - `handleMomentTranscribe: OutboxHandler`，注册到 `handlers['moment.transcribe']`。
  - 流程（spec §4.3）：幂等守卫（不存在/已软删/非 voice/非 pending → 返回）→ 查 `audio/*` 行（无 → failed）→ provider null → failed → 预签名 GET 下载（> `MAX_AUDIO_BYTES` → failed）→ `transcribe()`：成功单事务落 `transcript` + `done` + `content` 条件回填（`WHERE content=''`），统一截断 5000；Retryable 传播走退避；NonRetryable 自落 failed。不扇出任何通知。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/handle-moment-transcribe.test.ts`：

```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { MAX_AUDIO_BYTES } from '@moment/dto';
import { db } from '../../src/db/index.js';
import { chains, media, moments, users } from '../../src/db/schema.js';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  installMockStorage(); // generateAccessUrl 返回假 URL；真实下载由 stubAudioDownload 接管
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

/** 下载桩：fetch 返回指定字节数的音频对象。 */
function stubAudioDownload(bytes: number): void {
  globalThis.fetch = (async () => new Response(new Uint8Array(bytes))) as typeof fetch;
}

function asrReturning(text: string): ASRProvider {
  return { transcribe: async () => ({ text }) };
}

/** 直插 voice moment（默认 pending + 1 条 ready audio 行）。 */
async function insertVoice(opts?: {
  content?: string;
  status?: 'pending' | 'done' | 'failed' | null;
  type?: 'voice' | 'text';
  deletedAt?: Date | null;
  withAudio?: boolean;
}): Promise<{ momentId: string; audioId: string | null }> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: opts?.type ?? 'voice',
    content: opts?.content ?? '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: opts?.status === undefined ? 'pending' : opts.status,
    deletedAt: opts?.deletedAt ?? null,
  });
  let audioId: string | null = null;
  if (opts?.withAudio !== false) {
    audioId = randomUUID();
    await db.insert(media).values({
      id: audioId,
      momentId,
      uploaderId: userId,
      s3Key: `chains/${chainId}/${momentId}/${audioId}.wav`,
      mime: 'audio/wav',
      size: 1024,
      duration: 12,
      status: 'ready',
      storageMeta: {},
    });
  }
  return { momentId, audioId };
}

describe('handleMomentTranscribe（spec voice-moment §4.3）', () => {
  it('成功：单事务落 transcript + done，空 content 条件回填', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning('宝宝第一次叫奶奶'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBe('宝宝第一次叫奶奶');
    expect(m.transcriptionStatus).toBe('done');
    expect(m.content).toBe('宝宝第一次叫奶奶');
  });

  it('用户已编辑 content → 不覆盖（WHERE content=\'\' 条件回填），transcript 仍落原文', async () => {
    const { momentId } = await insertVoice({ content: '手动修正' });
    stubAudioDownload(100);
    setASRProvider(asrReturning('ASR 原文'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.content).toBe('手动修正');
    expect(m.transcript).toBe('ASR 原文');
    expect(m.transcriptionStatus).toBe('done');
  });

  it('空文本（笑声/环境音）→ done，transcript 存空串', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning(''));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('done');
    expect(m.transcript).toBe('');
    expect(m.content).toBe('');
  });

  it('超长转写截断到 5000 字符（对齐 dto content max(5000)，worker 回填绕过 API 校验）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(asrReturning('x'.repeat(6000)));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toHaveLength(5000);
    expect(m.content).toHaveLength(5000);
    expect(m.transcriptionStatus).toBe('done');
  });

  it('RetryableLLMError → 传播（processor 退避），状态保持 pending', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider({
      transcribe: async () => {
        throw new RetryableLLMError('ASR 429');
      },
    });
    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('pending');
  });

  it('NonRetryableLLMError → 自落 failed 后正常返回（不占退避额度）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider({
      transcribe: async () => {
        throw new NonRetryableLLMError('ASR 400', 400);
      },
    });
    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).resolves.toBeUndefined();
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('getASRProvider() === null（部署方停用）→ 落 failed 正常返回（spec §0 停用形态）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(100);
    setASRProvider(null);
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('无 audio 行（异常态）→ 落 failed', async () => {
    const { momentId } = await insertVoice({ withAudio: false });
    setASRProvider(asrReturning('不应被调用'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('下载字节超 MAX_AUDIO_BYTES → 落 failed（行 size 与对象不符的防御，spec §4.3 步骤 4）', async () => {
    const { momentId } = await insertVoice();
    stubAudioDownload(MAX_AUDIO_BYTES + 1);
    setASRProvider(asrReturning('不应被调用'));
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('failed');
  });

  it('幂等守卫：已软删 / 非 pending / 非 voice 直接返回，不写任何状态（spec §4.3 步骤 1）', async () => {
    const deleted = await insertVoice({ deletedAt: new Date() });
    const done = await insertVoice({ status: 'done', content: 'x' });
    const text = await insertVoice({ type: 'text', status: null, content: 'hi' });
    setASRProvider(asrReturning('不应被调用'));
    await handleMomentTranscribe({ momentId: deleted.momentId }, { push: mockPush });
    await handleMomentTranscribe({ momentId: done.momentId }, { push: mockPush });
    await handleMomentTranscribe({ momentId: text.momentId }, { push: mockPush });
    const rows = await db.select().from(moments);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(deleted.momentId).transcriptionStatus).toBe('pending');
    expect(by(done.momentId).transcriptionStatus).toBe('done');
    expect(by(text.momentId).transcriptionStatus).toBeNull();
  });
});
```

Modify `apps/server/tests/worker/handlers.test.ts` 注册表断言块（`describe('handlers 注册表', ...)` 第一个 it）：

```ts
  it('六种事件均已注册（moment.deleted 为 orphaned 标记实现）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['recap.generate']).toBe(handleRecapGenerate);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(Object.keys(handlers)).toHaveLength(6);
  });
```

import 区 `from '../../src/worker/handlers.js'` 解构加 `handleMomentTranscribe`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-transcribe.test.ts`
Expected: FAIL——`handleMomentTranscribe` 未导出（模块编译错）。

- [ ] **Step 3: 实现 handler + 注册**

Modify `apps/server/src/worker/handlers.ts`：

1. import 区调整：
   - drizzle-orm 行加 `like`：`import { and, eq, inArray, like } from 'drizzle-orm';`
   - 追加：

```ts
import { MAX_AUDIO_BYTES } from '@moment/dto';
import { NonRetryableLLMError } from '../llm/base.provider.js';
import { getASRProvider } from '../llm/asr/factory.js';
import { getStorage } from '../storage/factory.js';
```

2. `handleMomentDeleted` 之后追加：

```ts
/** 转写文本截断上限：对齐 dto content max(5000)——worker 回填绕过 API 校验，
 *  不截断会落出 API 写不出的值，破坏契约对称（spec §4.3 步骤 5）。 */
const TRANSCRIPT_MAX_CHARS = 5000;

/** 落 failed 终态：仅当前仍 pending 才写（防与并发成功路径互相覆盖）。 */
async function markTranscriptionFailed(momentId: string): Promise<void> {
  await db
    .update(moments)
    .set({ transcriptionStatus: 'failed' })
    .where(and(eq(moments.id, momentId), eq(moments.transcriptionStatus, 'pending')));
}

/**
 * moment.transcribe（spec voice-moment §4.3）：voice moment 的 ASR 异步转写回填。
 * 失败语义：RetryableLLMError 传播给 processor 退避；NonRetryableLLMError / 停用 / 异常态自落 failed；
 * 悬挂 pending 由 sweeper 6h cutoff 兜底（§4.4）。任何失败都不影响 moment 存在与语音播放。
 * 转写完成后不扇出通知（§0 搁置决策）。
 */
export const handleMomentTranscribe: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  // 步骤 1：幂等 + 竞态防御——不存在 / 已软删 / 非 voice / 非 pending 直接返回
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt || m.type !== 'voice' || m.transcriptionStatus !== 'pending') return;

  // 步骤 2：查该 moment 的 audio/* media 行；不存在（异常态）→ failed
  const [audioRow] = await db
    .select()
    .from(media)
    .where(and(eq(media.momentId, momentId), like(media.mime, 'audio/%')))
    .limit(1);
  if (!audioRow) {
    await markTranscriptionFailed(momentId);
    return;
  }

  // 步骤 3：部署方停用转写 → failed 正常返回（不占重试额度；create 恒 emit、handler 判 null 的取舍见 spec §0）
  const provider = getASRProvider();
  if (!provider) {
    await markTranscriptionFailed(momentId);
    return;
  }

  // 步骤 4：内部预签名 GET（短 TTL）→ 下载字节；网络/非 2xx 抛普通 Error（processor 对任何抛出都退避，
  // S3 瞬时故障可重试）。响应字节超 MAX_AUDIO_BYTES → failed（防御行上 size 与对象不符）。
  const url = await getStorage().generateAccessUrl(audioRow.s3Key, audioRow.storageMeta, 300);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`audio download failed: ${resp.status}`);
  const audio = Buffer.from(await resp.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    await markTranscriptionFailed(momentId);
    return;
  }

  // 步骤 5：转写 + 落库
  try {
    const { text } = await provider.transcribe({ audio, mime: audioRow.mime });
    const truncated = text.slice(0, TRANSCRIPT_MAX_CHARS);
    // 成功（含空文本）→ done + transcript；content 条件回填：用户可能在转写完成前已手动编辑，
    // 不覆盖用户输入（SET content WHERE content=''）。回填与状态更新同事务，避免中间态。
    await db.transaction(async (tx) => {
      await tx
        .update(moments)
        .set({ transcript: truncated, transcriptionStatus: 'done' })
        .where(eq(moments.id, momentId));
      await tx
        .update(moments)
        .set({ content: truncated })
        .where(and(eq(moments.id, momentId), eq(moments.content, '')));
    });
  } catch (err) {
    // NonRetryable：自落终态、不占 processor 退避额度（对齐 recap 范式）；Retryable 及其他抛出 → 传播退避
    if (err instanceof NonRetryableLLMError) {
      await markTranscriptionFailed(momentId);
      return;
    }
    throw err;
  }
};
```

3. 注册表（`handlers` 对象）加一行：

```ts
  'moment.transcribe': handleMomentTranscribe,
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/`
Expected: 全过（注册表计数 6、recap/processor/sweeper 既有用例不回归）。再跑 `pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`，均 exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/handlers.ts apps/server/tests/worker/handle-moment-transcribe.test.ts apps/server/tests/worker/handlers.test.ts
git commit -m "feat(server): transcribe voice moments in worker with retry classification"
```

---

### Task 9: server — sweeper 转写悬挂兜底（6h cutoff）+ worker 接线

**Files:**
- Modify: `apps/server/src/worker/sweeper.ts`（新增 `sweepStaleVoiceTranscriptions`）
- Modify: `apps/server/src/worker/index.ts`（sweeper 块接线）
- Test: `apps/server/tests/worker/sweeper.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 3 的 `transcriptionStatus` 列；既有 sweeper 范式（`BATCH_LIMIT` / FIFO asc / `config.SWEEPER_DRY_RUN` / logger）；`worker/index.ts` 的 `SWEEPER_INTERVAL_MS` 调度块。
- Produces:
  - `VOICE_TRANSCRIPTION_STALE_HOURS = 6`（常量导出，注释钉死 cutoff 理由：必须大于 processor 最大累计退避 ≈5h21m）。
  - `sweepStaleVoiceTranscriptions(now?, opts?): Promise<{ scanned: number; markedFailed: number; dryRun: boolean }>`：voice + pending + `createdAt < now - 6h` → 置 `failed`（仍 pending 条件更新，不覆盖并发完成态）。

- [ ] **Step 1: 写失败测试**

Modify `apps/server/tests/worker/sweeper.test.ts`：

1. import 区 `from '../../src/worker/sweeper.js'` 解构加 `sweepStaleVoiceTranscriptions`。

2. 文件末尾追加：

```ts
describe('sweepStaleVoiceTranscriptions（spec voice-moment §4.4：6h cutoff 兜底悬挂 pending）', () => {
  /** 直插 moment（voice 默认带 transcriptionStatus；text 恒 null）。 */
  async function insertMomentWithTranscription(opts: {
    createdAt: Date;
    status?: 'pending' | 'done' | 'failed';
    type?: 'voice' | 'text';
  }): Promise<string> {
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@test.com`, passwordHash: 'x', nickname: 'u' });
    const chainId = randomUUID();
    const { chains } = await import('../../src/db/schema.js');
    await db
      .insert(chains)
      .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
    const momentId = randomUUID();
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: userId,
      type: opts.type ?? 'voice',
      content: '',
      happenedAt: opts.createdAt,
      happenedTzOffset: 0,
      wallDate: wallDateOf(opts.createdAt, 0),
      createdAt: opts.createdAt,
      transcriptionStatus: (opts.type ?? 'voice') === 'voice' ? (opts.status ?? 'pending') : null,
    });
    return momentId;
  }

  it('pending 超 6h → failed；未超 6h（合法重试窗口内）不动；done / 非 voice 不动', async () => {
    const now = new Date('2026-08-23T12:00:00Z');
    const stale = await insertMomentWithTranscription({ createdAt: new Date(now.getTime() - 7 * 3_600_000) });
    const fresh = await insertMomentWithTranscription({ createdAt: new Date(now.getTime() - 1 * 3_600_000) });
    const doneM = await insertMomentWithTranscription({
      createdAt: new Date(now.getTime() - 7 * 3_600_000),
      status: 'done',
    });
    const textM = await insertMomentWithTranscription({
      createdAt: new Date(now.getTime() - 7 * 3_600_000),
      type: 'text',
    });

    const result = await sweepStaleVoiceTranscriptions(now);

    expect(result.scanned).toBe(1);
    expect(result.markedFailed).toBe(1);
    const rows = await db.select().from(moments);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(stale).transcriptionStatus).toBe('failed');
    expect(by(fresh).transcriptionStatus).toBe('pending'); // 合法重试窗口内不被抢置（spec §4.4 cutoff 理由）
    expect(by(doneM).transcriptionStatus).toBe('done');
    expect(by(textM).transcriptionStatus).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/sweeper.test.ts`
Expected: FAIL——`sweepStaleVoiceTranscriptions` 未导出（模块编译错）。

- [ ] **Step 3: 实现 sweep 任务 + 接线**

1. Modify `apps/server/src/worker/sweeper.ts`：
   - drizzle-orm import 行加 `inArray` 与 `isNull`（现状已 import `isNotNull`，无 `isNull`）：`import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';`
   - 文件末尾追加：

```ts
/**
 * 转写悬挂兜底 cutoff（spec voice-moment §4.4）：必须**大于** processor 最大累计退避窗口——
 * RETRY_DELAYS_MS 五档（1min → 5min → 15min → 1h → 4h）累计约 5h21m，取 6h 留约 40 分钟余量
 * 覆盖调度抖动；cutoff 过小会在合法重试期间抢置 failed，后续重试成功又被幂等守卫丢弃。
 */
export const VOICE_TRANSCRIPTION_STALE_HOURS = 6;

export interface TranscriptionSweepResult {
  scanned: number;
  markedFailed: number;
  dryRun: boolean;
}

/**
 * voice 转写悬挂兜底（spec §4.4）：outbox 5 次退避耗尽标 failed 后 moment 仍挂 pending 的，
 * 以及 outbox 行丢失 / worker 长期宕机的极端场景，createdAt 超 6h 的 pending 一律置 failed。
 * 与现有 sweep 任务同周期执行（worker/index.ts 的 SWEEPER_INTERVAL_MS 块）。
 */
export async function sweepStaleVoiceTranscriptions(
  now = new Date(),
  opts?: { dryRun?: boolean }
): Promise<TranscriptionSweepResult> {
  const result: TranscriptionSweepResult = {
    scanned: 0,
    markedFailed: 0,
    dryRun: opts?.dryRun ?? config.SWEEPER_DRY_RUN,
  };
  const cutoff = new Date(now.getTime() - VOICE_TRANSCRIPTION_STALE_HOURS * 3_600_000);
  const rows = await db
    .select({ id: moments.id })
    .from(moments)
    .where(
      and(
        eq(moments.type, 'voice'),
        eq(moments.transcriptionStatus, 'pending'),
        lt(moments.createdAt, cutoff),
        isNull(moments.deletedAt) // 软删不扫置 failed：与 transcribe handler「软删不写状态」对称
      )
    )
    .orderBy(asc(moments.createdAt)) // FIFO：与现有 sweep 任务同一理由
    .limit(BATCH_LIMIT);
  result.scanned = rows.length;
  if (result.dryRun) {
    for (const r of rows) {
      logger.info('sweeper dry-run: would fail stale voice transcription', { momentId: r.id });
    }
    return result;
  }
  if (rows.length > 0) {
    // 条件更新（仍 pending 才写）：不覆盖扫描后恰好完成的 done
    await db
      .update(moments)
      .set({ transcriptionStatus: 'failed' })
      .where(and(inArray(moments.id, rows.map((r) => r.id)), eq(moments.transcriptionStatus, 'pending')));
    result.markedFailed = rows.length;
  }
  logger.info('sweeper stale voice transcriptions done', { ...result });
  return result;
}
```

2. Modify `apps/server/src/worker/index.ts`：sweeper 块（L41-42）加一行：

```ts
        await sweepStaleUploadingMedia();
        await sweepSoftDeletedMomentMedia();
        await sweepStaleVoiceTranscriptions();
```

   import 行同步加 `sweepStaleVoiceTranscriptions`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/sweeper.test.ts`
Expected: 全过（既有 uploading/软删媒体 sweep 用例不回归）。再跑 `pnpm --filter @moment/server typecheck`，exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/sweeper.ts apps/server/src/worker/index.ts apps/server/tests/worker/sweeper.test.ts
git commit -m "feat(server): sweep stale voice transcriptions after 6h"
```

---

### Task 10: web — 录音/转码/发布 + MomentResponse 夹具同步

**Files:**
- Create: `apps/web/src/lib/audio-wav.ts`（MediaRecorder 产物 → 16kHz mono PCM16 WAV）
- Create: `apps/web/src/compose/compose-panel/voice-recorder.tsx`（录音组件）
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.ts`（voice 草稿 + submit 上传）
- Modify: `apps/web/src/compose/compose-panel/index.tsx`（挂载录音组件 + 互斥）
- Test（夹具同步，均补 `transcript: null, transcriptionStatus: null`）:
  - `apps/web/src/lib/memories.test.ts`（L7 `moment` 工厂）
  - `apps/web/src/lib/template.test.ts`（L7 `momentAt` 工厂）
  - `apps/web/src/pages/timeline-variants.test.tsx`（L134 `TEXT_MOMENT` 字面量）
  - `apps/web/src/pages/chain-home/chain-home.test.tsx`（L122 `TEXT_MOMENT` 与 L144 `IMAGE_MOMENT` 字面量）
  - `apps/web/src/memories/memories-entry.test.tsx`（L46 `moment` 工厂）
  - `apps/web/src/memories/memories.service.test.ts`（L19 `moment` 工厂）

**Interfaces:**
- Consumes: Task 1 的 `MAX_AUDIO_DURATION_SECONDS` 与 `CreateMomentInput`（voice）；Task 2 的 `client.uploadMedia({ kind: 'audio' })`；既有 compose-panel service 的 `images` / `video` / `addVideo` / `clearPreviews` / `resetAndClose` / `submit`；`Button` / `Banner`（`@/ui/button`、`@/ui/feedback/index`）。
- Produces:
  - `encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob`；`recorderBlobToWav(raw: Blob): Promise<{ blob: Blob; durationSeconds: number }>`；`WAV_SAMPLE_RATE = 16000`。
  - `VoiceDraft = { blob: Blob; durationSeconds: number; previewUrl: string }`；`<VoiceRecorder onChange(draft | null) />`。
  - `ComposePanelService.voice: VoiceDraft | null` / `setVoice(draft)` / 私有 `resetVoice()`；submit 类型推导 `hasVoice → 'voice'` 前置，语音先于图片上传（mediaIds[0] = audio）。

- [ ] **Step 1: 先确认红灯（夹具编译失败）**

Run: `pnpm --filter @moment/dto build && pnpm --filter @moment/web typecheck`
Expected: FAIL——dto 重建后 `MomentResponse` 多出两个必填字段，上述 6 个测试文件的 moment 字面量/工厂报缺 `transcript` / `transcriptionStatus`。

- [ ] **Step 2: 夹具同步**

六个文件的 moment 构造点各补 `transcript: null, transcriptionStatus: null`（值恒 `null`，voice 场景在 Task 11 手测覆盖）。补全手段：grep `: MomentResponse` 外加以 `type: 'text'` / `type: 'media'` 搜索字面量构造点，**tsc 报错是主要判据**（新字段必填，漏补即编译失败）——例外：`apps/web/src/lib/template.test.ts` L8 的 `momentAt` 工厂是 `as MomentResponse` 强转，新增必填字段不产生 tsc 错误，tsc 安全网对该文件失效，以本清单为准必须人工补。

Run: `pnpm --filter @moment/web typecheck`
Expected: exit 0。

- [ ] **Step 3: WAV 转码库**

Create `apps/web/src/lib/audio-wav.ts`：

```ts
// 录音产物转码（spec voice-moment §5）：MediaRecorder 采集的 webm/opus 不在 ASR 白名单
// （dto AUDIO_MIME_TYPES 不收 audio/webm|ogg），浏览器内解码 → 重采样 16kHz mono → PCM16 WAV。
// 纯 Web API 无依赖；5 分钟 ≈ 9.6MB，远低于 25MB 上限。

/** 目标采样率：16kHz mono（ASR 通用输入规格） */
export const WAV_SAMPLE_RATE = 16000;

/** Float32 PCM → 16bit PCM WAV（RIFF 头 + 数据块）。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * bytesPerSample, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** MediaRecorder 产物（任意浏览器可解码容器）→ 16kHz mono WAV + 时长（秒，≥1 整数，供 presign durationSeconds）。 */
export async function recorderBlobToWav(raw: Blob): Promise<{ blob: Blob; durationSeconds: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await raw.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
    // OfflineAudioContext 一并完成重采样与 down-mix 单声道（channelCount=1）
    const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return {
      blob: encodeWavPcm16(rendered.getChannelData(0), WAV_SAMPLE_RATE),
      durationSeconds: Math.max(1, Math.round(rendered.duration)),
    };
  } finally {
    void ctx.close();
  }
}
```

- [ ] **Step 4: 录音组件**

Create `apps/web/src/compose/compose-panel/voice-recorder.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { MAX_AUDIO_DURATION_SECONDS } from '@moment/dto';
import { Mic, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/feedback/index';
import { recorderBlobToWav } from '@/lib/audio-wav';

// 语音录制（spec voice-moment §5）：MediaRecorder 采集 → 停止后转 16kHz mono WAV（audio-wav.ts），
// 300s 自动停止；回听用转码后 WAV 的 object URL（与实际上传产物一致）。
// previewUrl 所有权随 onChange 转移给 service（resetVoice/clearPreviews 统一 revoke）；
// 重录（reset）由组件先 revoke 自己创建的 URL，service.setVoice(null) 的再次 revoke 是无害 no-op。

export interface VoiceDraft {
  blob: Blob;
  durationSeconds: number;
  previewUrl: string;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function VoiceRecorder({ onChange }: { onChange: (draft: VoiceDraft | null) => void }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const previewRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimer();
        const raw = new Blob(chunksRef.current, { type: recorder.mimeType });
        void recorderBlobToWav(raw)
          .then(({ blob, durationSeconds }) => {
            const url = URL.createObjectURL(blob);
            previewRef.current = url;
            setPreviewUrl(url);
            setPhase('done');
            onChange({ blob, durationSeconds, previewUrl: url });
          })
          .catch(() => {
            setError('无法处理录音，请重试');
            setPhase('idle');
            onChange(null);
          });
      };
      recorder.start();
      setElapsed(0);
      setPhase('recording');
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(sec);
        if (sec >= MAX_AUDIO_DURATION_SECONDS) stop(); // 300s 自动停止（spec §5）
      }, 250);
    } catch {
      setError('麦克风不可用或权限被拒绝');
      onChange(null);
    }
  };

  const reset = () => {
    // 重录：丢弃未上传草稿；已上传未绑定的 audio 行按既有 ready-unbound gap 处理（spec §5，本期不新增清理）
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setElapsed(0);
    setPhase('idle');
    onChange(null);
  };

  // 卸载清理：停录音、清计时器；previewUrl 已随 onChange 转移给 service，不在此 revoke
  useEffect(
    () => () => {
      clearTimer();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    },
    []
  );

  return (
    <div className="flex flex-col gap-2">
      {error && <Banner tone="error">{error}</Banner>}
      {phase === 'idle' && (
        <div>
          <Button variant="secondary" leadingIcon={Mic} onClick={() => void start()}>
            录音
          </Button>
        </div>
      )}
      {phase === 'recording' && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" leadingIcon={Square} onClick={stop}>
            停止
          </Button>
          <span className="text-meta text-muted">
            {formatRecordTime(elapsed)} / {formatRecordTime(MAX_AUDIO_DURATION_SECONDS)}
          </span>
        </div>
      )}
      {phase === 'done' && previewUrl && (
        <div className="flex flex-col gap-2">
          <audio src={previewUrl} controls className="w-full" />
          <div>
            <Button variant="quiet" leadingIcon={RotateCcw} onClick={reset}>
              重录
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: service voice 草稿 + submit**

Modify `apps/web/src/compose/compose-panel/compose-panel.service.ts`：

1. import 区加：`import type { VoiceDraft } from './voice-recorder';`

2. 字段区（`posterMediaId` 行后）加：

```ts
  /** 语音草稿（spec voice-moment §5）：与视频互斥；与图片可共存（voice = 1 语音 + ≤8 附图） */
  voice: VoiceDraft | null = null;
```

3. 方法区（`resetPoster` 后）加：

```ts
  /** 录音组件回调；draft 为 null = 重录/清空。语音与视频互斥；已有图片截断到 8 张（voice 附图上限） */
  setVoice(draft: VoiceDraft | null): void {
    if (this.voice && this.voice.previewUrl !== draft?.previewUrl) {
      URL.revokeObjectURL(this.voice.previewUrl);
    }
    this.voice = draft;
    if (draft) {
      if (this.video) {
        URL.revokeObjectURL(this.video.previewUrl);
        this.video = null;
        this.resetPoster();
      }
      if (this.images.length > 8) {
        const dropped = this.images.splice(8);
        dropped.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      }
    }
  }

  /** 语音重置统一入口：revoke previewUrl 并清空草稿 */
  private resetVoice(): void {
    if (this.voice) URL.revokeObjectURL(this.voice.previewUrl);
    this.voice = null;
  }
```

4. `addImages` 的满员判断改为按 voice 分档：

```ts
      const cap = this.voice ? 8 : 9; // voice 附图 ≤8（1 audio + ≤8 图 ≤ 9 mediaIds，spec §2.2）
      if (next.length >= cap) {
        this.error = this.voice ? '语音时刻最多 8 张附图' : '最多 9 张图片';
        break;
      }
```

5. `addVideo` 的 `this.resetPoster();` 行后加 `this.resetVoice();`（语音与视频互斥的防御；UI 侧已隐藏入口）。

6. `resetAndClose` 与 `clearPreviews` 的 `this.resetPoster();` 行后各加 `this.resetVoice();`。

7. `submit` 新建分支：
   - `const hasVideo = Boolean(this.video);` 行后加 `const hasVoice = Boolean(this.voice);`
   - 空内容守卫（`if (!hasImages && !hasVideo && ...)`)加 `&& !hasVoice`：
     `if (!hasImages && !hasVideo && !hasVoice && this.content.trim().length === 0 && !structuredOnly) {`
   - kind 空摘要守卫（L377）同步加 `&& !hasVoice`：
     `if (this.kind !== 'standard' && this.content.trim().length === 0 && !summary && !hasImages && !hasVideo && !hasVoice) {`
     ——voice + 非 standard kind + 空 content + 空摘要时 voice 本身即有效载荷，不应被「选一项或写一句」误拦。
   - 类型推导（L329）改为：`const type = hasVoice ? 'voice' : hasVideo ? 'video' : hasImages ? 'media' : 'text';`
   - 图片上传循环**之前**插入语音上传（mediaIds[0] = audio）：

```ts
        if (this.voice) {
          this.progress = '上传语音…';
          const res = await client.uploadMedia({
            file: this.voice.blob,
            mime: 'audio/wav',
            size: this.voice.blob.size,
            kind: 'audio',
            durationSeconds: this.voice.durationSeconds,
            onProgress: (l, t) => (this.progress = `上传语音 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
```

   `createMoment` 调用体不改（`type` / `mediaIds` / `content` 透传；voice 空 content 由 dto 放行）。

- [ ] **Step 6: 面板组件挂载**

Modify `apps/web/src/compose/compose-panel/index.tsx`：

1. import 区加：`import { VoiceRecorder } from './voice-recorder';`

2. 组件内加支持度常量（组件顶部、return 之前）：

```ts
  // 老 Safari 无 MediaRecorder → 录音入口不渲染并提示（spec §5：置灰提示，不影响其他类型）
  const voiceSupported = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
```

3. 媒体按钮行（「加视频」Button，约 L170-172）改为 voice 互斥隐藏：

```tsx
                {!service.voice && (
                  <Button variant="secondary" leadingIcon={VideoIcon} onClick={() => vidRef.current?.click()}>
                    加视频
                  </Button>
                )}
```

4. 按钮行 `</div>` 之后追加录音区块：

```tsx
              {!service.video &&
                (voiceSupported ? (
                  <VoiceRecorder onChange={(draft) => service.setVoice(draft)} />
                ) : (
                  <p className="text-meta text-muted">当前浏览器不支持录音，可继续发文字、图片或视频。</p>
                ))}
```

- [ ] **Step 7: 运行确认**

Run:

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```

Expected: 均 exit 0（vitest 含被同步的 6 个夹具文件，不回归）。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/lib/audio-wav.ts apps/web/src/compose/compose-panel/ apps/web/src/lib/memories.test.ts apps/web/src/lib/template.test.ts apps/web/src/pages/timeline-variants.test.tsx apps/web/src/pages/chain-home/chain-home.test.tsx apps/web/src/memories/memories-entry.test.tsx apps/web/src/memories/memories.service.test.ts
git commit -m "feat(web): record, transcode and publish voice moments"
```

---

### Task 11: web — 消费侧播放条 + voice 卡片分支 + mime 过滤修正

**Files:**
- Create: `apps/web/src/media/AudioBar.tsx`（播放/暂停 + 进度条 + 时长）
- Modify: `apps/web/src/timeline/moment-sheet.tsx`（voice 分支 + L69 显式 `image/*` 过滤）

**Interfaces:**
- Consumes: Task 1 的 `MomentResponse.transcriptionStatus`；既有 `useMediaObjectUrl(mediaId: string | null)`（`@/media/useMediaObjectUrl`）；`MediaBlock`（`@/media/MediaBlock`）；`Icon`（`@/ui/Icon`）；lucide `Play` / `Pause`。
- Produces:
  - `<AudioBar media: MomentMedia shareToken?: string />`：登录态 blob object URL、分享态稳定入口 + `?st=`（与 MediaBlock 同 URL 语义）；v1 无波形（spec §0 搁置）。
  - `MomentSheetContent` voice 分支：播放条 + `pending` → 「转写中…」弱化提示 + 文本区（`done` 显示 content；`failed` 或 `done` 空 content 不显示文本区）+ 附图宫格（只传 `image/*` 行）。
  - lightbox items 永不包含 `audio/*` 行。

- [ ] **Step 1: AudioBar 组件**

Create `apps/web/src/media/AudioBar.tsx`：

```tsx
import { useRef, useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Pause, Play } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { useMediaObjectUrl } from './useMediaObjectUrl';

// 语音播放条（spec voice-moment §5）：播放/暂停 + 进度条 + 时长；v1 不渲染波形（spec §0 搁置决策）。
// URL 语义与 MediaBlock 一致：登录态经 useMediaObjectUrl 取 blob object URL；
// 分享态绝不请求 blob，用稳定相对 URL + ?st=encodeURIComponent(token)。
// 视觉只消费 token：rounded-surface-md / bg-surface / bg-action / text-action-fg / text-meta / text-muted。

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function AudioBar({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id);
  const url = shareToken ? `${media.url}?st=${encodeURIComponent(shareToken)}` : blobUrl;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // 初始时长用行上 duration（presign 上报值），loadedmetadata 后换真实值
  const [duration, setDuration] = useState(media.duration ?? 0);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      void el.play();
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-surface-md bg-surface px-3 py-2">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}
      <button
        type="button"
        aria-label={playing ? '暂停语音' : '播放语音'}
        disabled={!url}
        onClick={toggle}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-action text-action-fg focus-visible:outline-none focus-visible:ring-focus disabled:opacity-50"
      >
        <Icon icon={playing ? Pause : Play} size={16} className={playing ? '' : 'ml-0.5 fill-current'} />
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        value={Math.min(position, duration || 0)}
        aria-label="语音进度"
        onChange={(e) => {
          const t = Number(e.target.value);
          if (audioRef.current) audioRef.current.currentTime = t;
          setPosition(t);
        }}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 text-meta text-muted">
        {formatDuration(position)} / {formatDuration(duration)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: moment-sheet voice 分支 + 过滤修正**

Modify `apps/web/src/timeline/moment-sheet.tsx`：

1. import 区加：`import { AudioBar } from '@/media/AudioBar';`

2. L69-70 的 images/lightboxItems 改为显式过滤（原「非 video 即图」会把 `audio/*` 当图，spec §5 点名的必须修改点）：

```tsx
  // 显式 image/* 过滤：voice 的 audio/* 行不能进附图宫格与 lightbox（mime 是 string，tsc 不报警）
  const images = moment.media.filter((m) => m.mime.startsWith('image/'));
  const lightboxItems: MomentMedia[] =
    images.length > 0 ? images : moment.media.filter((m) => m.mime.startsWith('video/'));
  const isVoice = moment.type === 'voice';
  const audioMedia = isVoice ? moment.media.find((m) => m.mime.startsWith('audio/')) : undefined;
```

3. 主体渲染块（L162-172）改为 voice 前置三分支：

```tsx
        {isVoice ? (
          <>
            {audioMedia && <AudioBar media={audioMedia} shareToken={shareToken} />}
            {moment.transcriptionStatus === 'pending' && (
              <p className="mt-1 text-meta text-muted">转写中…</p>
            )}
            {copy && <div className="my-2">{copy}</div>}
            {images.length > 0 && (
              <MediaBlock media={images} shareToken={shareToken} onOpen={(i) => (service.lightboxIndex = i)} />
            )}
          </>
        ) : hasMedia ? (
          <>
            {copy && <div className="mb-2">{copy}</div>}
            <MediaBlock media={moment.media} shareToken={shareToken} onOpen={(i) => (service.lightboxIndex = i)} />
          </>
        ) : (
          copy && (
            // 纯文字用 --surface 色面：无边框、无阴影（spec §6.1）
            <div className="rounded-surface-md bg-surface px-4 py-3">{copy}</div>
          )
        )}
```

   三态文案规则（spec §5）：`pending` → 「转写中…」；`done` → copy 显示 content（content 空则 copy 为空不渲染，空转写无文本区）；`failed` → 不显示任何转写相关 UI（语音可播即是完整内容，不渲染负面状态）。`copy` 既有的「content 非空才渲染」语义天然覆盖后两条。

- [ ] **Step 3: 运行确认**

Run:

```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```

Expected: 均 exit 0。

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/media/AudioBar.tsx apps/web/src/timeline/moment-sheet.tsx
git commit -m "feat(web): render voice moment playback bar on timeline"
```

---

### Task 12: app — expo-audio 录音/发布 + SegmentBar voice 类型

**Files:**
- Modify: `apps/app/package.json`（新增依赖 `expo-audio`，版本由 expo install 按 SDK 54 钉版）
- Modify: `apps/app/app.config.ts`（plugins 加 expo-audio 麦克风权限文案）
- Create: `apps/app/src/features/compose/voice-recorder.tsx`（录音组件）
- Modify: `apps/app/src/features/compose/compose.service.ts`（VoiceDraft + submit 上传 + 附图 8 张分档）
- Modify: `apps/app/src/features/compose/index.tsx`（SegmentBar 加「语音」+ 挂载录音组件 + 图片区 voice 可用）

**Interfaces:**
- Consumes: Task 1 的 `MAX_AUDIO_DURATION_SECONDS` / `MomentType`（含 voice）；Task 2 的 `client.uploadMedia({ kind: 'audio' })`；既有 `uploadWithRetry`（compose.service.ts L15-29）、`SegmentBar` / `Button` / `Screen` 组件、`useTheme()` token；`expo-file-system` 的 `File`。
- Produces:

```ts
// compose.service.ts
export interface VoiceDraft {
  uri: string;
  mime: string; // 'audio/mp4'（expo-audio HIGH_QUALITY 预设 m4a/AAC）
  size: number;
  durationSeconds: number;
}
// ComposeService 新字段/方法：
voice: VoiceDraft | null;
setVoice(draft: VoiceDraft | null): void;
clearVoice(): void;
// voice-recorder.tsx
export function VoiceRecorder({ voice, onChange }: { voice: VoiceDraft | null; onChange: (draft: VoiceDraft | null) => void }): JSX.Element;
```

- [ ] **Step 1: 安装依赖 + 权限声明**

Run: `pnpm --filter @moment/app exec expo install expo-audio`
Expected: `apps/app/package.json` dependencies 新增 `expo-audio`（版本由 expo install 按 SDK 54 的 bundledNativeModules 钉版，不要手钉）；`pnpm --filter @moment/app typecheck` exit 0。

> **原生模块与开发构建（真机验收前置）**：`expo-audio` 是原生模块，`apps/app/eas.json` 的 development profile 是 `developmentClient: true`——装完依赖后**必须重新构建开发客户端**（`eas build --profile development` 或 `npx expo run:ios`），否则运行时 `useAudioRecorder` 抛 "Cannot find native module"（同 video-poster Task 4 的 expo-video-thumbnails 教训）。

Modify `apps/app/app.config.ts`：plugins 数组（expo-location 条目后）加：

```ts
    // 语音时刻录音的麦克风权限用途文案（spec voice-moment §6；Android RECORD_AUDIO 由插件自动声明）
    ['expo-audio', { microphonePermission: '录制语音时刻，记录宝宝的声音' }],
```

- [ ] **Step 2: 录音组件**

Create `apps/app/src/features/compose/voice-recorder.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { MAX_AUDIO_DURATION_SECONDS } from '@moment/dto';
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import type { VoiceDraft } from './compose.service';

// 语音录制（spec voice-moment §6）：expo-audio useAudioRecorder（HIGH_QUALITY 预设 m4a/AAC，
// audio/mp4 在 dto 白名单内）；300s 自动停止；回听用 useAudioPlayer 播录音本地 uri。
// 权限拒绝走 Alert，不阻塞其他类型发布。

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

/** 回听：独立组件挂 useAudioPlayer（hook 不能条件调用） */
function ReplayButton({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  return (
    <Button
      variant="secondary"
      onPress={() => {
        void player.seekTo(0);
        player.play();
      }}
    >
      回听
    </Button>
  );
}

export function VoiceRecorder({
  voice,
  onChange,
}: {
  voice: VoiceDraft | null;
  onChange: (draft: VoiceDraft | null) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [busy, setBusy] = useState(false);

  const elapsedSeconds = Math.floor((state.durationMillis ?? 0) / 1000);

  const stopRecording = async () => {
    if (!state.isRecording) return;
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri; // AudioRecorder 实例属性是 uri: string | null（url 在 RecorderState 上，实例无此属性）
      if (!uri) {
        onChange(null);
        return;
      }
      const file = new File(uri);
      onChange({
        uri,
        mime: 'audio/mp4',
        size: file.size ?? 0,
        durationSeconds: Math.max(1, Math.round((state.durationMillis ?? 0) / 1000)),
      });
    } finally {
      setBusy(false);
    }
  };

  // 300s 自动停止（spec §6，与 web 对齐）
  useEffect(() => {
    if (state.isRecording && (state.durationMillis ?? 0) >= MAX_AUDIO_DURATION_SECONDS * 1000) {
      void stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.durationMillis, state.isRecording]);

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('无法录音', '麦克风权限被拒绝，请在系统设置中开启后再试');
      return;
    }
    setBusy(true);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert('无法录音', '录音启动失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      {state.isRecording ? (
        <View style={styles.row}>
          <Button variant="secondary" loading={busy} onPress={() => void stopRecording()}>
            停止
          </Button>
          <Text style={styles.time}>
            {formatDuration(elapsedSeconds)} / {formatDuration(MAX_AUDIO_DURATION_SECONDS)}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <Button variant="secondary" loading={busy} onPress={() => void startRecording()}>
            {voice ? '重新录音' : '录音'}
          </Button>
          {voice ? <ReplayButton uri={voice.uri} /> : null}
          {voice ? (
            <Button variant="quiet" onPress={() => onChange(null)}>
              移除
            </Button>
          ) : null}
        </View>
      )}
      {voice && !state.isRecording ? (
        <Text style={styles.hint}>已录 {formatDuration(voice.durationSeconds)} · 发布后可修改转写文本</Text>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    box: { gap: t.space1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    time: { color: t.muted, fontSize: t.fontCaption },
    hint: { color: t.muted, fontSize: t.fontCaption },
  });
```

- [ ] **Step 3: compose service voice 草稿 + submit**

Modify `apps/app/src/features/compose/compose.service.ts`：

1. 类型区（`ComposeService` 类之前）加：

```ts
/** 录音完成的语音草稿（fileUri 形态：uploadWithRetry 经 rn-put 按 FilePart 读盘，整文件不进内存） */
export interface VoiceDraft {
  uri: string;
  mime: string;
  size: number;
  durationSeconds: number;
}
```

2. 字段区（`posterMediaId` 行后）加：

```ts
  /** 语音草稿（spec voice-moment §6）：type=voice 时必有；与图片可共存（≤8 附图） */
  voice: VoiceDraft | null = null;
```

3. 方法区（`resetPoster` 后）加：

```ts
  /** 录音组件回调；draft 为 null = 移除重录 */
  setVoice(draft: VoiceDraft | null): void {
    this.voice = draft;
  }

  /** 组件侧清空语音（类型切换 SegmentBar 统一入口，与 clearVideo 同范式） */
  clearVoice(): void {
    this.voice = null;
  }
```

4. `pickMoreImages` 的 9 张上限改分档（L208-209 与 L225）：

```ts
    const cap = this.type === 'voice' ? 8 : 9; // voice 附图 ≤8（1 audio + ≤8 图 ≤ 9 mediaIds，spec §2.2）
    const remain = cap - this.images.length;
    if (remain <= 0) throw new Error(this.type === 'voice' ? '语音时刻最多 8 张附图' : '图片最多 9 张');
```

   `this.images = [...this.images, ...ready].slice(0, 9);` 改为 `.slice(0, cap);`。

5. `submit` 前置校验（`type === 'video'` 检查行后）加：

```ts
    if (this.type === 'voice' && !this.voice) throw new Error('语音类型需要先录音');
```

6. `UploadFile` 联合与 files 组装（L306-314）：联合加 audio 形态，并加 voice 分支：

```ts
    type UploadFile =
      | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'audio'; durationSeconds: number; sortOrder: number };
    let files: UploadFile[] = [];
    if (this.type === 'media') {
      files = this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
    } else if (this.type === 'video' && this.video) {
      files = [{ fileUri: this.video.uri, mime: this.video.mime, size: this.video.size, kind: 'video' as const, durationSeconds: this.video.durationSeconds, sortOrder: 0 }];
    } else if (this.type === 'voice' && this.voice) {
      // 语音在前（mediaIds[0] = audio），附图随后；fileUri 形态按 FilePart 读盘，整文件不进内存
      files = [
        { fileUri: this.voice.uri, mime: this.voice.mime, size: this.voice.size, kind: 'audio' as const, durationSeconds: this.voice.durationSeconds, sortOrder: 0 },
        ...this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i + 1 })),
      ];
    }
```

   `createMoment` 调用体不改（`type` / `mediaIds` / `content` 透传；voice 空 content 由 dto 放行——`text` 类型的空内容校验不涉及 voice）。

- [ ] **Step 4: 组件侧 SegmentBar + 挂载**

Modify `apps/app/src/features/compose/index.tsx`：

1. import 区加：`import { VoiceRecorder } from './voice-recorder';`

2. SegmentBar options（L87-91）加一项：

```tsx
          options={[
            { value: 'text', label: '文字' },
            { value: 'media', label: '图文' },
            { value: 'video', label: '视频' },
            { value: 'voice', label: '语音' },
          ]}
```

3. SegmentBar `onChange`（L93-97）加 `service.clearVoice();`：

```tsx
          onChange={(t) => {
            service.type = t as typeof service.type;
            service.images = [];
            service.clearVideo();
            service.clearVoice();
          }}
```

4. 图片选择区两处 `service.type === 'media'` 条件（mediaBar 约 L122 与 mediaHint 约 L130）改为 voice 也可用；mediaBar 按钮文案（约 L124）随 cap 分档：

```tsx
      {!service.isEdit && (service.type === 'media' || service.type === 'voice') ? (
```

```tsx
          <Button variant="secondary" onPress={() => void onPickImages()}>
            选图（{service.images.length}/{service.type === 'voice' ? 8 : 9}）
          </Button>
```

   （现状硬编码 `/9`，voice 附图 cap 为 8（Step 3.4），不分档会在 voice 下误导。）

5. 视频选择区（约 L134-141）之后追加语音区：

```tsx
      {!service.isEdit && service.type === 'voice' ? (
        <VoiceRecorder voice={service.voice} onChange={(v) => service.setVoice(v)} />
      ) : null}
```

- [ ] **Step 5: 运行确认**

Run:

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

Expected: 均 exit 0（lint 含 lint:tokens——新代码禁 hex/rgba）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/package.json apps/app/app.config.ts apps/app/src/features/compose/ pnpm-lock.yaml
git commit -m "feat(app): record and publish voice moments with expo-audio"
```

---

### Task 13: app — 消费侧播放条 + voice 卡片/详情分支 + MediaGrid 守卫

**Files:**
- Create: `apps/app/src/components/AudioBar.tsx`（expo-audio 播放条）
- Modify: `apps/app/src/components/MomentCard.tsx`（voice 分支）
- Modify: `apps/app/src/components/MediaGrid.tsx`（L41 else 分支加 `image/*` 显式守卫）
- Modify: `apps/app/src/features/moment/index.tsx`（详情页 voice 分支，L115 三元前拆出 audio 行）

**Interfaces:**
- Consumes: Task 1 的 `MomentResponse.transcriptionStatus`；既有 `useMediaUri(mediaId: string | undefined)`（`apps/app/src/lib/use-media-uri.ts`）；`expo-audio` 的 `useAudioPlayer` / `useAudioPlayerStatus`；`useTheme()` token。
- Produces:
  - `<AudioBar media: MomentMedia />`：经 `useMediaUri` 拿本地缓存 uri 播放（**不用裸 url 直渲**——原生播放器不带鉴权头，与 video-poster §4 同约束）；v1 无波形。
  - MomentCard / 详情页 voice 分支：播放条 + `pending` → 「转写中…」+ 文本区 + 附图（只 `image/*` 行进宫格）。

- [ ] **Step 1: AudioBar 组件**

Create `apps/app/src/components/AudioBar.tsx`：

```tsx
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { MomentMedia } from '@moment/dto';
import { useMediaUri } from '../lib/use-media-uri';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

// 语音播放条（spec voice-moment §6）：播放/暂停 + 进度/时长；v1 无波形（spec §0 搁置）。
// 必须经 useMediaUri 拿本地缓存 uri 再播——原生播放器不带鉴权头，且 headers 会跟过 302 被 S3 拒
// （use-media-uri.ts 头注释，与 video-poster §4 同约束）。

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

/** 播放器：独立组件挂 useAudioPlayer（uri 未到时不挂 hook） */
function Player({ media, uri }: { media: MomentMedia; uri: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  // 行上 duration（presign 上报值）兜底：播放器元数据未就绪时进度分母不为 0
  const duration = status.duration > 0 ? status.duration : (media.duration ?? 0);
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel={status.playing ? '暂停语音' : '播放语音'}
        hitSlop={8}
        onPress={() => {
          if (status.playing) {
            player.pause();
          } else {
            if (status.didJustFinish) void player.seekTo(0);
            player.play();
          }
        }}
        style={styles.playBtn}
      >
        <Text style={styles.playIcon}>{status.playing ? '⏸' : '▶'}</Text>
      </Pressable>
      <Text style={styles.time}>
        {formatDuration(status.currentTime)} / {formatDuration(duration)}
      </Text>
    </View>
  );
}

export function AudioBar({ media }: { media: MomentMedia }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const uri = useMediaUri(media.id);
  if (!uri) return <View style={styles.bar} />;
  return <Player media={media} uri={uri} />;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      borderRadius: 8,
      padding: t.space2,
      marginTop: t.space2,
    },
    playBtn: { minWidth: t.touchMin, minHeight: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    playIcon: { color: t.ink, fontSize: t.fontBody },
    time: { color: t.muted, fontSize: t.fontCaption },
  });
```

- [ ] **Step 2: MomentCard voice 分支**

Modify `apps/app/src/components/MomentCard.tsx`：

1. import 区加：`import { AudioBar } from './AudioBar';`

2. 组件体（`const styles = ...` 行后）加拆分：

```tsx
  const isVoice = moment.type === 'voice';
  const audioMedia = isVoice ? moment.media.find((m) => m.mime.startsWith('audio/')) : undefined;
  // voice 附图只传 image/* 行：audio/* 是内容本体进播放条，不能进宫格（spec §6）
  const gridMedia = isVoice ? moment.media.filter((m) => m.mime.startsWith('image/')) : moment.media;
```

3. 渲染区 L38-39 改为 voice 前置分支：

```tsx
      {audioMedia ? <AudioBar media={audioMedia} /> : null}
      {isVoice && moment.transcriptionStatus === 'pending' ? (
        <Text style={styles.transcribing}>转写中…</Text>
      ) : null}
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={gridMedia} />
```

4. `createStyles` 加：

```ts
    transcribing: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space1 },
```

   三态规则同 web：`done` → content 行（空 content 不渲染）；`failed` → 不显示任何转写相关 UI。

- [ ] **Step 3: MediaGrid 显式 image 守卫**

Modify `apps/app/src/components/MediaGrid.tsx`：媒体 map（L40-46）改为：

```tsx
      {media.map((m) =>
        m.mime.startsWith('video/') ? (
          <VideoCell key={m.id} m={m} cellStyle={styles.cell} styles={styles} />
        ) : m.mime.startsWith('image/') ? (
          <MediaImage key={m.id} mediaId={m.id} cellStyle={styles.cell} />
        ) : null // audio/* 不进宫格（voice 由 MomentCard 拆出交给 AudioBar；防御其它调用方漏拆，spec §6）
      )}
```

- [ ] **Step 4: 详情页 voice 分支**

Modify `apps/app/src/features/moment/index.tsx`：

1. import 区加：`import { AudioBar } from '../../components/AudioBar';`

2. 媒体渲染区（L113-120）改为：

```tsx
        {m.type === 'voice' && m.transcriptionStatus === 'pending' ? (
          <Text style={styles.transcribing}>转写中…</Text>
        ) : null}
        {m.content.length > 0 ? <Text style={styles.content}>{m.content}</Text> : null}
        {m.media
          .filter((media) => !media.mime.startsWith('audio/'))
          .map((media) =>
            media.mime.startsWith('video/') ? (
              <VideoBlock key={media.id} media={media} />
            ) : (
              <MomentImage key={media.id} media={media} />
            )
          )}
        {m.type === 'voice'
          ? m.media
              .filter((media) => media.mime.startsWith('audio/'))
              .map((media) => <AudioBar key={media.id} media={media} />)
          : null}
```

   （`m.content` 行原位保留，只是把 L114-120 的 `m.media.map` 换成过滤后版本，并在其后追加 audio 渲染；播放条置于媒体区末尾，附图在上——与卡片「播放条 + 文本 + 附图」的信息序一致，详情页大图优先。）

3. `createStyles` 加：

```ts
    transcribing: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space1 },
```

- [ ] **Step 5: 运行确认**

Run:

```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```

Expected: 均 exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/components/AudioBar.tsx apps/app/src/components/MomentCard.tsx apps/app/src/components/MediaGrid.tsx apps/app/src/features/moment/index.tsx
git commit -m "feat(app): render voice moment playback on card and detail"
```

---

### Task 14: 全量门禁 + 联调手动验收

**Files:** 无改动（验证批）。

- [ ] **Step 1: 全量构建 + 测试 + lint**

Run（串行执行，server 测试期间不起第二个 jest 会话——远程共享测试库）:

```bash
pnpm build && pnpm test && pnpm lint
```

Expected: 全部 exit 0。`pnpm test` 覆盖 dto（`tsx --test`）、api-client（`tsx --test`）、server（jest `--runInBand` 触库）、web（vitest）。

- [ ] **Step 2: server + worker 手动验收**（`pnpm dev` 起 server + web，`.env` 配好 `ASR_API_KEY`）

1. 发布 voice moment（web 录音）→ 时间线 pending 卡片可播 → worker 日志消费 `moment.transcribe` → 几秒后刷新：`transcriptionStatus=done`，卡片显示转写文本。
2. 停用形态：`.env` 删掉 `ASR_API_KEY` 重启 → 再发一条 voice → 约一个 outbox 轮询周期后 `transcription_status=failed`，卡片无任何转写 UI、语音可播。
3. 转写完成前手动编辑 content（PATCH）→ 转写回填不覆盖编辑值，`transcript` 仍落 ASR 原文。

- [ ] **Step 3: web 手动验收清单**

1. 录音：开始 → 实时时长 → 停止 → 回听（WAV）→ 重录 → 发布成功；到 300s 自动停止。
2. 语音 + 3 张附图发布：卡片 = 播放条 + 附图宫格；宫格无破图；点图进 lightbox 正常；附图满 8 张后「加图片」报「语音时刻最多 8 张附图」。
3. 互斥：已选视频时不出现录音入口；录音后「加视频」隐藏。
4. 三态：pending →「转写中…」；done → 转写文本；failed → 无转写 UI（模拟 ASR 失败，见 Step 2.2）。
5. 降级：DevTools 禁用 `MediaRecorder`（或老 Safari）→ 录音入口换成提示文案，其他类型发布不受影响。
6. 分享态：建分享链接 → 无痕窗口打开 → voice 卡片播放条走 `?st=` 稳定入口可播；附图正常。
7. 编辑已发布 voice 的 content（修正转写）→ 保存成功，`transcript` 不变（刷新后原文仍在）。

- [ ] **Step 4: app 手动验收清单**（重新构建的开发构建连本地 server）

前置：开发客户端必须已含 `expo-audio`（见 Task 12 Step 1 的原生模块说明）——用旧客户端跑下面的清单会在录音时抛 "Cannot find native module"。

1. 发布：SegmentBar 切「语音」→ 录音（权限弹窗允许）→ 时长显示 → 停止 → 回听 → 可加 ≤8 张附图 → 发布成功。
2. 权限拒绝态：系统设置关掉麦克风权限 → 录音 → Alert「麦克风权限被拒绝」，不崩、可改发文字。
3. 消费侧：链时间线 voice 卡片 = 播放条（可播）+ pending 文案/转写文本 + 附图宫格（无破图）；进详情页播放条可播。
4. 宫格防御：feed / 链主页 / 详情三处的 video 卡片与图片宫格无回归（MediaGrid 守卫未误伤）。
5. 重录/移除：录后「移除」→ 再录；切类型到「文字」再切回「语音」→ 旧草稿已清空。

- [ ] **Step 5: Commit（如有验证期修补）**

> 本步骤由编排主 Agent 在验收后执行。

```bash
git commit -m "test: verify voice moment end to end"
```

---

## DoD（计划级验收）

- [ ] `pnpm build && pnpm test && pnpm lint` 全部 exit 0
- [ ] dto：audio presign 白名单 / durationSeconds 必填 ≤300；voice create 数量边界（0/1/9/10）、重复 id、空 content 通过、`posterMediaId` 拒绝；PATCH `.strict()` 拒绝 `transcript` / `transcriptionStatus`；text/media/video 既有矩阵不回归
- [ ] api-client：audio 单 PUT 直通 + presign 携带 durationSeconds；超 25MB 本地 413 不发请求
- [ ] server：moments 表 voice 枚举 + 两列迁移（drizzle-kit generate 产出，SQL 人工核对）；presign audio 单 PUT + 413；create voice 成功（audio 绑定 + pending + 两行 outbox）与四个 MEDIA_INVALID 分支（2 audio / 纯图 / 夹 video / 宫格夹 audio）；序列化两字段（voice 非空、非 voice 恒 null、audio 行在 media 数组）；通知摘要 `[语音]`；软删 audio 行 orphaned
- [ ] worker：转写成功回填（含「用户已编辑不覆盖」条件更新）、空文本 done、5000 截断、Retryable 传播、NonRetryable failed、provider null failed、无 audio 行 failed、超 25MB 下载 failed、幂等守卫；sweeper 6h cutoff（未超不动、done/非 voice 不动）
- [ ] web：录音 → WAV 转码 → 上传 → 发布（附图 ≤8、视频互斥）；卡片播放条 + 三态文案 + 附图宫格/lightbox 无 audio 破图；分享态 `?st=` 可播；6 个 `MomentResponse` 夹具同步
- [ ] app：expo-audio 录音（权限拒绝态）→ 发布；SegmentBar「语音」；卡片/详情播放条 + 三态；MediaGrid `image/*` 守卫；lint:tokens 过
- [ ] 零改动面确认：`apps/server/src/llm/recap/`、`apps/server/src/worker/processor.ts`、`resetDb()`、`apps/web/src/media/MediaBlock.tsx`、`packages/api-client/src/client.ts` 均未改（processor 对任何抛出退避的既有语义即所需，不加 ASR 特判）

### spec §8 测试夹具同步清单（执行时逐项核对）

| 文件 | 位置 | 补法 |
|---|---|---|
| `apps/server/tests/moments/moment-serializer.test.ts` | 文件头 `moment` 字面量 | `transcript: null, transcriptionStatus: null` |
| `apps/server/tests/worker/handlers.test.ts` | 注册表断言 | 5 → 6 + `moment.transcribe` 断言（Task 8） |
| `apps/web/src/lib/memories.test.ts` | L7 `moment` 工厂 | `transcript: null, transcriptionStatus: null` |
| `apps/web/src/lib/template.test.ts` | L7 `momentAt` 工厂 | 同上 |
| `apps/web/src/pages/timeline-variants.test.tsx` | L134 `TEXT_MOMENT` | 同上 |
| `apps/web/src/pages/chain-home/chain-home.test.tsx` | L122 `TEXT_MOMENT` + L144 `IMAGE_MOMENT` | 同上（两处，若非 spread 关系） |
| `apps/web/src/memories/memories-entry.test.tsx` | L46 `moment` 工厂 | 同上 |
| `apps/web/src/memories/memories.service.test.ts` | L19 `moment` 工厂 | 同上 |

补全手段：grep `: MomentResponse` 外加搜索 `type: 'text'` / `type: 'media'` 字面量构造点，tsc 报错是主要判据（`MomentResponse` / `MomentLike` 新字段为必填，漏补即编译失败）——例外：`apps/web/src/lib/template.test.ts` 的 `momentAt` 工厂用 `as MomentResponse` 强转，tsc 安全网对该文件失效，以本表清单为准人工核对。
