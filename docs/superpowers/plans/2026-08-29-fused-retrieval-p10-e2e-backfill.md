# 融合检索 P10：server search e2e + `backfill:embed` 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用全链路 server 测试钉死融合检索（M2）的验收闭环（spec §9 e2e：HTTP 建时刻（人+地点+图）→ compress mock → embed mock → GET `person_id` → `POST /api/search` → share-album 仍无 persons/place），并落地 `pnpm --filter @moment/server backfill:embed`（先 compress `derived_status IS NULL` 的静态可压图，再 embed `embed_hash IS NULL`；空 provider 退出 0；二跑幂等）。

**Architecture:** e2e 沿 **people-place P7 / recap P7** 先例：Jest + supertest + 真实测试库，落 `apps/server/tests/search/search-e2e.test.ts`（jest `roots: ['<rootDir>/tests']` 自动纳入；`src/e2e/` 是设计系统 fixture CLI，本计划零文件）。HTTP 打 `tests/helpers/fixtures.ts` 的模块级 `app`（`listenLocal` 绑 127.0.0.1）。outbox **不起 worker 进程**，`drainOutbox()` 循环 `runOutboxBatch({ push: mockPush })` 直到 `claimed===0`（compress 终态同事务再插 embed，必须第二批）。存储用 `installMockStorage()` + 内存 Map 承接 tmp→final copy 与派生 `uploadFile`，使 compress 读原图 JPEG、embed 读 derived WebP。LLM / DashScope **不打真网**：`setLLMProvider` + `setEmbeddingProvider` mock（spec §9 行为源），再加 `nock.disableNetConnect()` + `nock.enableNetConnect(/127\.0\.0\.1/)`（出域保险丝；listenLocal / BA 都是 127.0.0.1，host 可能带端口）。worker BA 的 `INTERNAL_API_BASE_URL` 不是 listenLocal 的 ephemeral 端口——nock 拦 BA HTTP，回调内调 P4 `upsertMomentVector` / `deleteVectorsByMomentId`，让 Lance 真正有向量、搜索能走分层 C。回填是一次性 CLI（镜像 `backfill:extract`）：`src/worker/embed-backfill.ts` 只发射不消费；`src/worker/index.ts` 零 diff。

**Tech Stack:** Jest 29 + supertest 7（真实 MySQL 测试库，`--runInBand`、`afterAll(closeDb)`、`beforeEach(resetDb)`）/ `nock@^14`（P5 已加，拦 BA，不拦 127.0.0.1 测试 HTTP）/ `sharp`（P3，e2e 现造 JPEG）/ `@lancedb/lancedb`（P4 `ensureLance` / `resetLanceForTests`）/ tsx（`backfill:embed` CLI）。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§4.2/§4.3 管线、§8 隐私、§9 e2e 条目、§11 P10 出口与回填四步）

**上游契约（P1–P9 已评审定稿，Consumes 逐字引用；执行时假设 P3–P7 已在本分支落地）：**
- P1：`OUTBOX_MOMENT_COMPRESS` payload `{ momentId, chainId, mediaId }`；`OUTBOX_MOMENT_EMBED` payload `{ momentId, chainId }`；`getObject`；`moments.embedHash`；`media.derived_*`；`installMockStorage().getObject`
- P2：GET `/api/feed` / `/api/chains/:chainId/moments` query `person_id`（他链/不存在 → 200 空页）；feed body `moments`，链列表 body `items`
- P3：`handleMomentCompress`；`isCompressibleMime` / `derivedObjectKey`；create 对静态可压图 pending+emit compress；GIF/HEIC/HEIF 不压、`derived_status` 保持 NULL；`GET /api/media/:id?variant=derived` 未 ready → 404 `DERIVED_NOT_READY`；serializer `derivedUrl` 仅 ready
- P4：`ensureLance` / `resetLanceForTests` / `closeLanceForTests`；`upsertMomentVector` / `deleteVectorsByMomentId` / `listVectorsByMomentId`；`config.INTERNAL_API_BASE_URL` / `LANCEDB_PATH`；`setBaAuthTokenForTests`；`createApp()` 不 connect Lance；`tests/helpers/lance.ts` 的 `denseVector` / `HEX64_A`
- P5：`getEmbeddingProvider` / `setEmbeddingProvider`；`handleMomentEmbed`；`computeEmbedHash` / `assembleEmbedText` / `derivedFingerprintOf`；`maybeEmitMomentEmbed`（有 pending 可压图不发）；compress 终态 emit embed；worker **禁止** import `src/lancedb/`
- P6：`POST /api/search`；`SearchService.search`；空 LLM `parsed.text===q`；丢链规则；`VECTOR_CANDIDATE_LIMIT=200`；search **零** `getObject`；`tests/search/helpers.ts` 的 `auth`
- P7：`GET /api/chains/:chainId/jobs` owner；默认 `pending,failed`；只投影 compress/embed
- P8/P9：本计划 **不触** api-client / web / app
- 冻结名：`.superpowers/orchestration/fused-retrieval/spec-review.md`
- 金样：`docs/superpowers/plans/2026-08-28-people-place-p7-e2e.md`、`docs/superpowers/plans/2026-08-20-ai-recap-p7-e2e.md`、live `apps/server/scripts/backfill-extract.ts` + `src/worker/extract-backfill.ts`

## Global Constraints（只写本计划新增；通用约束继承 Phase 1 / fused P1）

- **e2e 落 `apps/server/tests/search/`，不落 `src/e2e/`。** `pnpm --filter @moment/server test -- tests/search/search-e2e.test.ts`（脚本已含 `--runInBand`）。不新增、不修改 `apps/web/package.json` scripts。
- **只给 `apps/server/package.json` 加 `backfill:embed`。** 无新环境变量，不改 `config.ts` / `apps/server/.env` / `.env.example` / `deploy/.env*.example`。
- **禁止打真网：** 触库测试 `beforeEach` 注入 `setLLMProvider` + `setEmbeddingProvider`（mock 或 `null`）；`afterEach` 全部 `setXxxProvider(undefined)`。nock 拦 `INTERNAL_API_BASE_URL` 的 BA（回调写 Lance）。**必须** `nock.disableNetConnect()` + `nock.enableNetConnect(/127\.0\.0\.1/)`：DashScope / LLM / 其它公网出域立即 `NetConnectNotAllowed`；listenLocal 与 BA 都是 127.0.0.1（host 常带 `:port`，禁止用裸字符串 `'127.0.0.1'`——nock 按完整 host 匹配会打挂 supertest）。**禁止**裸 `disableNetConnect()`（不放行 loopback）。`afterEach` 必须 `nock.enableNetConnect()` 恢复，避免 `--runInBand` 污染后续文件。测试库若配了 `DASHSCOPE_API_KEY` / `LLM_API_KEY`，未注入 mock 就会出域——本计划每个触库文件必须注入。
- **回填只发射不消费。** 不改 `src/worker/index.ts`。换模型 **不是** CLI 开关：文档化 SQL + `LANCEDB_PATH`（见偏差 3）。
- **无新表：** 不改 `resetDb()` 删除顺序。Lance 不进 `resetDb()`；向量测 `beforeAll(ensureLance)` + `beforeEach(resetLanceForTests)` + `afterAll(closeLanceForTests)`。
- CONVENTIONS §3 零改：不改 `ChainPolicy` / feed `{h,i}` / 既有存储方法名 / 既有 outbox 列。search 请求线程 **零** `getObject`（compress 读原图、embed 读 derived 只发生在 worker handler）。
- 测试打 `.env` 指向的 **测试库**，严禁生产库。触库文件 `afterAll(closeDb)`。瞬时 ECONNRESET 重跑同一命令。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **BA nock 委托 P4 repository（不改 listen 端口、不改 `ba-client`）。** spec / P5：worker 经 `INTERNAL_API_BASE_URL` 写 Lance。测试 `app` 是 `listenLocal` 随机端口，`config.INTERNAL_API_BASE_URL` 在 import 时钉死（默认 `http://127.0.0.1:3000`）。P4 HTTP 已覆盖真实 `InternalEmbeddingsController`。P10 e2e 用 nock 拦 worker 的 DELETE/POST，回调 `await deleteVectorsByMomentId` / `upsertMomentVector`（与 controller 同一入口），使向量真进 Lance、搜索能走距离序。不把 `createApp()` 改成 connect Lance。
2. **LLM / DashScope 行为用 factory mock；nock `disableNetConnect` 是出域保险丝，不钉模型 JSON。** spec §9 字面「compress mock → embed mock」。P6/P5 单测已 nock 意图 / DashScope JSON。e2e 要双用途 `chat`（extract JSON vs 意图 JSON），mock 按 system prompt 分支。`setEmbeddingProvider(mock)` 返回 `denseVector(0.1)` + `HEX64_A`。`disableNetConnect()` + `enableNetConnect(/127\.0\.0\.1/)`：未注入 mock 时出域立即失败；正则匹配带端口的 host，不打挂 listenLocal。
3. **换模型不是 CLI flag。** spec §11：「删 Lance 表或换 `LANCEDB_PATH` 子目录，并把未软删时刻 `embed_hash` 置 NULL 后再跑本脚本」。本计划 **不** 加 `--reset-hash`（误对目标库跑会清空存量 hash）。精确操作写进 `scripts/backfill-embed.ts` 文件头，并用测试锁注释字符串。
4. **phase 1 在同一事务置 `derived_status=pending` 再 emit compress。** spec 回填步骤 2 只写 emit；create 路径（P3）emit 时置 pending。不置 pending 则同一次 sweep 的 phase 2 会把仍为 NULL 的图当时刻当「无 pending」并发 embed，handler 在图未 ready 时只嵌文本并写 hash，compress 终态再改 fingerprint 又嵌一次。置 pending 后 phase 2 与 `maybeEmitMomentEmbed` 同一判据。
5. **phase 2 跳过「无嵌素材」时刻。** P5 handler：无文本无 ready 图 → 只 DELETE、**不写 hash**。若 sweep 只扫 `embed_hash IS NULL`，空时刻每次 CLI 都重复 emit，跨 run 不幂等。闭合：无 `assembleEmbedText` 且无 `derived_status=ready` 的可压图 → 不 emit（对齐 extract-backfill 空素材闭合）。素材出现后日常写路径会 emit。
6. **phase 2 直接 `emitOutbox(OUTBOX_MOMENT_EMBED, { momentId, chainId })`，不调 `maybeEmitMomentEmbed`。** `maybeEmit` 返回 `void` 且 **按 pending embed 行不去重**（P5 偏差 7）。回填 spec 强制 pending 去重。复制其「有 pending 可压图则跳」判据（SQL/JS），去重放 sweep。
7. **只扫 `media.status='ready'` 且 `moment_id IS NOT NULL`。** spec 未写 uploading/未绑定。未绑定行 compress 会早退；uploading 的 `getObject` 无对象。存量回填对象是已发布时刻。
8. **可压判定只调 P3 `isCompressibleMime`，不在 SQL 再抄一份 GIF/HEIC 清单。** 扫描 `derived_status IS NULL` 后 JS 过滤；GIF/HEIC 行 cursor 照样前进、不 emit、不改列。
9. **CLI 演练用 `DASHSCOPE_API_KEY` 前缀覆盖（dotenv 不覆盖已存在 env）。** 测试库空 key 会走「直接退出」。`DASHSCOPE_API_KEY=e2e-drill-dummy` 让 `getEmbeddingProvider()` 非 null；sweep **不调** `embed()`，dummy 零远端。演练前确认无 `pnpm worker` / `pnpm dev` 抢同一测试库 outbox。
10. **不扩展 `src/e2e/` fixture。** spec §11 P10 只要求 e2e 绿 + 回填二跑幂等，没有视觉回归。design-system 基线不在 `pnpm test` 内。
11. **jobs 断言是 e2e 顺带验收 P7，不是新 API。** 创建后、drain 前默认 GET 含 pending `moment.compress`；drain 后默认列表不含 done。
12. **`getEmbeddingProvider()===null` 跳过 **两** 阶段（spec 步骤 1），即使有 NULL 派生图也不发 compress。** 本脚本叫 `backfill:embed`，embedding 停用则整段 no-op。
13. **未登录 401 / 限流 429 / 坏游标不在本计划重测**（P6 HTTP 已钉）。本计划覆盖 spec §9 那条 e2e 字面 + 丢链 + 空 embedding LIKE + 回填。单命中页 `nextCursor` 断言 `null`（P6 已钉 `{h,i}` / `{d,i}` 编解码）。
14. **请求线程零 `getObject` 的 `mockClear` 必须在 `drainOutbox` 之后、derived GET / feed / search 之前。** spec §8 / §9 与 P3：`GET /api/media?variant=derived` 只 `generateAccessUrl`，不读像素。清在 derived GET 之后会把媒体 GET 的违规 `getObject` 洗掉。
15. **phase 2 把 pending compress outbox 的 `mediaId` 视同「仍在飞的可压图」。** spec 步骤 3 字面是 `derived_status=pending`；create/本脚本 emit 时都会置 pending（偏差 4）。若只认列、不认 outbox，则「列仍 NULL + pending compress 行」会在同一 sweep 的 phase 2 抢先 embed（handler 只嵌文本并写 hash，compress 终态再改 fingerprint 又嵌一次）。复用 phase 1 的 `pendingCompressMediaIds`。

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/tests/search/search-e2e.test.ts` | spec §9 e2e：建时刻→compress/embed→GET person_id→POST search→share-album；丢链；LIKE 降级 |
| `apps/server/src/worker/embed-backfill.ts` | `runEmbedBackfillSweep`：phase1 compress + phase2 embed，只发射 |
| `apps/server/scripts/backfill-embed.ts` | CLI：`--batch` / `--interval-ms`；换模型注释；`pool.end()` |
| `apps/server/package.json` | `scripts.backfill:embed` |
| `apps/server/tests/worker/embed-backfill.test.ts` | sweep 单测 + 消费后二跑 + 源码锁 |
| `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md` | Task 3 头部状态回写 |

**本计划明确不改：** `apps/web/package.json`、`apps/app/**`、`packages/dto/**`、`packages/api-client/**`、`src/worker/index.ts`、`src/app.ts`、`chain-policy.ts`、feed cursor、`moment-serializer.ts`、`maybeEmitMomentEmbed` 签名、`tests/helpers/db.ts` 删除顺序、`apps/server/.env`、Dockerfile/compose/nginx、`src/e2e/**`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: search e2e（人+地点+图 → compress/embed → GET person_id → POST search → share-album）

**Files:**
- Create: `apps/server/tests/search/search-e2e.test.ts`
- **不改** 产品代码

**Interfaces:**
- Consumes:
  - `app` / `registerUser` / `createChain` / `insertMoment`（`tests/helpers/fixtures.ts`）
  - `auth`（`tests/search/helpers.ts`，P6）
  - `installMockStorage` / `setStorageAdapter`（P1 `getObject` 已在 mock 上）
  - `runOutboxBatch`（`src/worker/processor.ts`）
  - `setLLMProvider` / `LLMProvider.chat(req)`（system/user messages）
  - `setEmbeddingProvider` / `EmbeddingProvider`（P5）
  - `ensureLance` / `resetLanceForTests` / `closeLanceForTests`
  - `upsertMomentVector` / `deleteVectorsByMomentId` / `listVectorsByMomentId`（P4）
  - `config.INTERNAL_API_BASE_URL`
  - `nock.disableNetConnect` / `nock.enableNetConnect(/127\.0\.0\.1/)`（出域保险丝；afterEach 无参 `enableNetConnect()` 恢复）
  - `setBaAuthTokenForTests`（`src/embeddings/ba-auth.ts`）
  - `denseVector` / `HEX64_A`（`tests/helpers/lance.ts`）
  - `derivedObjectKey`（P3）
  - `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED`
  - `sharp` 现造 JPEG（P3 `jpegOf` 同形）
- Produces: 无新符号（纯测试）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/search/search-e2e.test.ts`：

```ts
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import nock from 'nock';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { SearchParsed } from '@moment/dto';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { deleteVectorsByMomentId, listVectorsByMomentId, upsertMomentVector } from '../../src/lancedb/repository.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import type { PushService } from '../../src/push/push-service.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { auth } from './helpers.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const origin = new URL(config.INTERNAL_API_BASE_URL);

const PLACE = {
  name: '外婆家',
  lat: 39.9042,
  lng: 116.4074,
};

async function jpegOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function dualLlm(intent: SearchParsed): LLMProvider {
  return {
    async chat(req) {
      const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
      if (sys.includes('搜索意图解析器')) {
        return {
          content: JSON.stringify(intent),
          model: 'mock-intent',
          usage: { prompt: 1, completion: 1, total: 2 },
        };
      }
      return {
        content: JSON.stringify({ persons: [], places: [] }),
        model: 'mock-extract',
        usage: { prompt: 1, completion: 1, total: 2 },
      };
    },
  };
}

function mockEmbedding(): EmbeddingProvider {
  return {
    embed: async () => denseVector(0.1),
    modelHash: () => HEX64_A,
    dimensions: () => denseVector().length,
  };
}

function installObjectStore(storage: MockStorage, objects: Map<string, Buffer>): void {
  storage.getObject.mockImplementation(async (key) => {
    const buf = objects.get(key);
    if (!buf) throw new Error(`getObject missing ${key}`);
    return buf;
  });
  storage.uploadFile.mockImplementation(async (key, body) => {
    objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
  });
  storage.copyObject.mockImplementation(async (src, dest) => {
    const buf = objects.get(src);
    if (buf) objects.set(dest, buf);
  });
  storage.headObject.mockImplementation(async (key) => {
    const buf = objects.get(key);
    if (!buf) return null;
    return { size: buf.length, contentType: 'image/jpeg', lastModified: new Date() };
  });
}

function installBaLanceBridge(): nock.Scope {
  setBaAuthTokenForTests('e2e-ba');
  const scope = nock(`${origin.protocol}//${origin.host}`).persist();
  scope.delete(/\/api\/internal\/embeddings\/[0-9a-f-]+$/i).reply(200, async (uri: string) => {
    const momentId = uri.split('/').pop() as string;
    const deleted = await deleteVectorsByMomentId(momentId);
    return { deleted };
  });
  scope.post('/api/internal/embeddings').reply(200, async (_uri: string, raw: nock.Body) => {
    const body = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    await upsertMomentVector({
      momentId: String(body.momentId),
      chainId: String(body.chainId),
      kind: body.kind as 'moment' | 'image',
      mediaId: typeof body.mediaId === 'string' ? body.mediaId : undefined,
      vector: body.vector as number[],
      modelHash: String(body.modelHash),
    });
    return { ok: true };
  });
  return scope;
}

async function drainOutbox(maxBatches = 12): Promise<void> {
  for (let i = 0; i < maxBatches; i++) {
    const batch = await runOutboxBatch({ push: mockPush, batchSize: 50 });
    if (batch.claimed === 0) return;
    expect(batch.failed).toBe(0);
  }
  throw new Error('outbox did not drain');
}

async function readyJpeg(token: string, objects: Map<string, Buffer>, jpeg: Buffer): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set(auth(token))
    .send({ mime: 'image/jpeg', size: jpeg.length, kind: 'image' });
  expect(presigned.status).toBe(201);
  const mediaId = presigned.body.mediaId as string;
  const [row] = await db.select().from(media).where(eq(media.id, mediaId));
  objects.set(row.s3Key, jpeg);
  const complete = await request(app).post(`/api/media/${mediaId}/complete`).set(auth(token)).send({});
  expect(complete.status).toBe(200);
  return mediaId;
}

let storage: MockStorage;
let objects: Map<string, Buffer>;

beforeAll(ensureLance);
beforeEach(async () => {
  await resetDb();
  await resetLanceForTests();
  objects = new Map();
  storage = installMockStorage();
  installObjectStore(storage, objects);
  nock.cleanAll();
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1/);
  installBaLanceBridge();
  setEmbeddingProvider(mockEmbedding());
  setLLMProvider(
    dualLlm({ personNames: ['外婆'], place: '外婆家', time: null, text: '' }),
  );
});
afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
  setBaAuthTokenForTests(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});
afterAll(async () => {
  await closeLanceForTests();
  await closeDb();
});

describe('融合检索 e2e（spec §9：建时刻人+地点+图 → compress mock → embed mock → GET person_id → POST search → share-album）', () => {
  it('全管线：派生 ready + 向量落 Lance + chip/search 命中 + 请求线程零 getObject + 分享无 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const jpeg = await jpegOf(2000, 1000);

    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    const personId = person.body.id as string;

    const mediaId = await readyJpeg(owner.token, objects, jpeg);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'media',
        content: '第一次翻身，在外婆家',
        happenedAt: '2026-08-20T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [mediaId],
        personIds: [personId],
        place: PLACE,
      });
    expect(created.status).toBe(201);
    expect(created.body.persons).toEqual([
      { id: personId, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(created.body.place).toEqual({ ...PLACE, source: 'manual' });
    const momentId = created.body.id as string;

    const compressPending = await db.select().from(outbox).where(eq(outbox.type, 'moment.compress'));
    expect(compressPending).toHaveLength(1);
    expect(compressPending[0]!.payload).toEqual({ momentId, chainId, mediaId });

    const jobsBefore = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set(auth(owner.token));
    expect(jobsBefore.status).toBe(200);
    expect(jobsBefore.body.jobs.some((j: { type: string }) => j.type === 'moment.compress')).toBe(true);
    expect(jobsBefore.body.jobs.every((j: { type: string }) => j.type !== 'moment.extract')).toBe(true);

    await drainOutbox();
    storage.getObject.mockClear();

    const [mediaRow] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(mediaRow.derivedStatus).toBe('ready');
    expect(mediaRow.derivedMime).toBe('image/webp');
    expect(mediaRow.derivedS3Key).toBe(derivedObjectKey(chainId, momentId, mediaId));
    expect(mediaRow.derivedWidth).toBe(512);
    expect(mediaRow.derivedHeight).toBe(256);
    expect(objects.has(mediaRow.derivedS3Key as string)).toBe(true);

    const [momentRow] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(momentRow.embedHash).toEqual(expect.any(String));
    expect(momentRow.embedHash).toHaveLength(64);

    const vectors = await listVectorsByMomentId(momentId);
    expect(vectors.some((v) => v.kind === 'moment')).toBe(true);
    expect(vectors.every((v) => v.modelHash === HEX64_A)).toBe(true);

    const derivedGet = await request(app)
      .get(`/api/media/${mediaId}?variant=derived`)
      .set(auth(owner.token));
    expect(derivedGet.status).toBe(302);
    expect(
      storage.generateAccessUrl.mock.calls.some((c) => String(c[0]).endsWith('.derived.webp')),
    ).toBe(true);

    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&person_id=${personId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    expect(feed.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(feed.body.moments[0].persons[0].name).toBe('外婆');
    expect(feed.body.moments[0].media[0].derivedUrl).toBe(`/api/media/${mediaId}?variant=derived`);
    expect(feed.body.moments[0].media[0].url).toBe(`/api/media/${mediaId}`);

    const list = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${personId}`)
      .set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: { id: string }) => m.id)).toEqual([momentId]);

    const missing = await request(app)
      .get(`/api/feed?person_id=${randomUUID()}`)
      .set(auth(owner.token));
    expect(missing.status).toBe(200);
    expect(missing.body.moments).toEqual([]);

    const otherChain = await createChain(owner.id, '另一链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '邻居' });
    expect(foreign.status).toBe(201);
    const foreignList = await request(app)
      .get(`/api/chains/${chainId}/moments?person_id=${foreign.body.id}`)
      .set(auth(owner.token));
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.items).toEqual([]);

    setLLMProvider(
      dualLlm({ personNames: ['外婆'], place: '外婆家', time: null, text: '' }),
    );
    const hardSearch = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '外婆',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(hardSearch.status).toBe(200);
    expect(hardSearch.body.parsed).toEqual({
      personNames: ['外婆'],
      place: '外婆家',
      time: null,
      text: '',
    });
    expect(hardSearch.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(hardSearch.body.nextCursor).toBeNull();

    const embed = jest.fn(async (req: { text?: string; imageDataUri?: string }) => {
      expect(req.imageDataUri).toBeUndefined();
      expect(req.text).toBe('第一次翻身');
      return denseVector(0.1);
    });
    setEmbeddingProvider({
      embed,
      modelHash: () => HEX64_A,
      dimensions: () => denseVector().length,
    });
    setLLMProvider(
      dualLlm({ personNames: [], place: null, time: null, text: '第一次翻身' }),
    );
    const vectorSearch = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '第一次翻身',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(vectorSearch.status).toBe(200);
    expect(vectorSearch.body.moments[0].id).toBe(momentId);
    expect(vectorSearch.body.parsed.text).toBe('第一次翻身');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(vectorSearch.body.nextCursor).toBeNull();

    expect(storage.getObject).not.toHaveBeenCalled();

    const jobsAfter = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set(auth(owner.token));
    expect(jobsAfter.status).toBe(200);
    expect(jobsAfter.body.jobs).toEqual([]);

    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set(auth(owner.token))
      .send({});
    expect(link.status).toBe(201);
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    const shared = pub.body.moments[0];
    expect('persons' in shared).toBe(false);
    expect('place' in shared).toBe(false);
    expect(Object.keys(shared)).not.toContain('persons');
    expect(Object.keys(shared)).not.toContain('place');
    expect(shared.content).toBe('第一次翻身，在外婆家');
    expect(shared.media[0].derivedUrl).toBe(`/api/media/${mediaId}?variant=derived`);

    const pending = await db.select().from(outbox).where(eq(outbox.status, 'pending'));
    expect(pending).toHaveLength(0);
  });

  it('丢链：q=外婆 且无其它约束时，没有该人名的链不倾倒整链时间线（spec §3.2 / §9）', async () => {
    const owner = await registerUser();
    const withGrandma = await createChain(owner.id, '有外婆');
    const other = await createChain(owner.id, '无外婆');
    const person = await request(app)
      .post(`/api/chains/${withGrandma}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);

    const hit = await request(app)
      .post(`/api/chains/${withGrandma}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'text',
        content: '和外婆吃饭',
        happenedAt: '2026-08-20T10:00:00+08:00',
        happenedTzOffset: -480,
        personIds: [person.body.id],
      });
    expect(hit.status).toBe(201);
    const dumped = await request(app)
      .post(`/api/chains/${other}/moments`)
      .set(auth(owner.token))
      .send({
        type: 'text',
        content: '完全无关的日记',
        happenedAt: '2026-08-21T10:00:00+08:00',
        happenedTzOffset: -480,
      });
    expect(dumped.status).toBe(201);

    setEmbeddingProvider(null);
    setLLMProvider(
      dualLlm({ personNames: ['外婆'], place: null, time: null, text: '' }),
    );
    const res = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '外婆',
      tzOffset: -480,
    });
    expect(res.status).toBe(200);
    const ids = res.body.moments.map((m: { id: string }) => m.id);
    expect(ids).toContain(hit.body.id);
    expect(ids).not.toContain(dumped.body.id);
  });

  it('空 embedding：LIKE 转义后命中 content，不调 getObject，parsed.text===q', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00Z'),
      content: '100%野餐_计划',
    });
    setLLMProvider(null);
    setEmbeddingProvider(null);
    storage.getObject.mockClear();

    const res = await request(app).post('/api/search').set(auth(owner.token)).send({
      q: '100%野餐_计划',
      tzOffset: -480,
      chainIds: [chainId],
    });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '100%野餐_计划',
    });
    expect(res.body.moments.map((m: { id: string }) => m.id)).toEqual([momentId]);
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
```

若 P6 的 `tests/search/helpers.ts` 尚未落地：在本文件顶部内联 `function auth(token: string) { return { Authorization: \`Bearer ${token}\` }; }`，**不要**为了 P10 去改 P6 计划文件。落地后优先 import P6 helper。

- [ ] **Step 2: 运行确认失败**

Run（repo 根目录）:

```bash
pnpm --filter @moment/server test -- tests/search/search-e2e.test.ts
```

Expected:
- P3–P7 **未**合入：FAIL（缺 `derivedObjectKey` / `setEmbeddingProvider` / `ensureLance` / `POST /api/search` / jobs 路由等）。停手，先合入上游。
- P3–P7 **已**合入：新文件会真正跑 3 个用例。红灯只应来自本文件断言与管线不符（例如 BA nock 未把向量写入、drain 未消费 embed）。不要为了绿灯弱化「分享无 persons/place 键」「search 零 getObject」「丢链不倾倒」。瞬时 `ECONNRESET` 重跑同一命令。

- [ ] **Step 3: 最小实现**

本 Task **无产品代码**。若 Step 2 在 P3–P7 已合入后仍红：

1. nock 拦不到 BA：打印 `config.INTERNAL_API_BASE_URL` 与 nock `scope.pendingMocks()`。只允许把 nock host 拼法改成与 P5 `tests/worker/handle-moment-embed.test.ts` **逐字相同**的 `${origin.protocol}//${origin.host}`。禁止改 `ba-client.ts`。若 nock 14 的 async `reply` 不执行 Promise：改成 `.reply(200, (uri, raw, cb) => { ... cb(null, [200, body]); })` 并在本 Task 注释钉死。禁止静默改回「只 `{ ok: true }` 不写 Lance」——那样向量 search 用例会空页。
2. compress `SHARP_DECODE_FAILED`：`objects` 没在 complete 前 seed tmp key，或 `copyObject` 没把 JPEG 拷到 `chains/...`。修测试 helper，不改 handler。
3. embed 不写 hash：`getEmbeddingProvider()` 仍是 null。确认 `beforeEach` 在 `resetDb` 之后 `setEmbeddingProvider(mockEmbedding())`。
4. drain 死循环 / `failed>0`：看 `outbox.last_error`。常见是 BA 401（没 `setBaAuthTokenForTests`）或 nock 没 persist。
5. 链列表不是 `items`：以 **live** `tests/people-place/people-place-e2e.test.ts` 为准改本测试读取字段，不改 controller。
6. `NetConnectNotAllowed`（host 不是 127.0.0.1）：factory mock 没注入或 `afterEach` 没 `nock.enableNetConnect()` 污染了其它文件。修测试，禁止为了出域去删 `disableNetConnect`。

不要改 P3–P7 已冻结 handler 来迁就 e2e。

- [ ] **Step 4: 运行确认通过**

Run:

```bash
pnpm --filter @moment/server test -- tests/search/search-e2e.test.ts
```

Expected: PASS，3 个用例全过。

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/search/search-e2e.test.ts
git commit -m "test(server): add fused retrieval search e2e"
```

---

### Task 2: `backfill:embed`（先 compress NULL 派生，再 embed `embed_hash IS NULL`）

**Files:**
- Create: `apps/server/src/worker/embed-backfill.ts`
- Create: `apps/server/scripts/backfill-embed.ts`
- Modify: `apps/server/package.json`（`scripts` 区在 `"backfill:extract"` 之后追加 `"backfill:embed"`；**不要**改其它 script）
- Test: `apps/server/tests/worker/embed-backfill.test.ts`
- 回归：`apps/server/tests/lancedb/worker-isolation.test.ts`（本 Task **不改**该文件；跑一遍确认 `embed-backfill` 未被 worker 入口 import）

**Interfaces:**
- Consumes:
  - P5 `getEmbeddingProvider()` / `setEmbeddingProvider`
  - P3 `isCompressibleMime`
  - P5 `assembleEmbedText`（只用于「有无可嵌素材」；**不**在 SQL 里算过期 hash）
  - P1 `OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED` / `emitOutbox` / `DbTx`
  - `moments` / `media` / `momentPersons` / `persons` / `outbox`
  - CLI 骨架对齐 live `apps/server/scripts/backfill-extract.ts`（`intArg` / `pool.end()` / `tsx`）
- Produces:
  - `export const EMBED_BACKFILL_DEFAULT_BATCH = 100`
  - `export interface EmbedBackfillOptions { batchSize?: number; pauseMs?: number }`
  - `export interface EmbedBackfillResult { compressDispatched: number; embedDispatched: number }`
  - `export async function runEmbedBackfillSweep(opts?: EmbedBackfillOptions): Promise<EmbedBackfillResult>`
  - CLI：`pnpm --filter @moment/server backfill:embed -- [--batch 100] [--interval-ms 500]`
  - package.json：`"backfill:embed": "tsx scripts/backfill-embed.ts"`

Sweep 语义（spec §11 四步 + 本计划偏差 4–8、12）：

1. `getEmbeddingProvider()===null` → log skip，返回 `{ compressDispatched: 0, embedDispatched: 0 }`，**零 SELECT**。
2. **Phase 1 compress：** 未软删时刻上 `status='ready'` 且 `derived_status IS NULL` 的 media，JS `isCompressibleMime` 为真。已有 pending `moment.compress` 且 `payload.mediaId` 相同 → skip。否则同一事务：`derived_status='pending'`（其余派生列保持 NULL）+ `emitOutbox(COMPRESS, { momentId, chainId, mediaId })`。按 `media.id` 升序游标分页。
3. **Phase 2 embed：** 未软删、`embed_hash IS NULL`、该时刻 **没有** 仍在飞的可压图：`isCompressibleMime && (derived_status==='pending' || pending compress outbox 的 `mediaId`)`。已有 pending `moment.embed` 且 `payload.momentId` 相同 → skip。`assembleEmbedText` 为空 **且** 无 ready 可压图 → skip（偏差 5）。否则 `emitOutbox(EMBED, { momentId, chainId })`。按 `moments.id` 升序游标。复用 phase 1 的 `pendingCompressMediaIds`（进入 sweep 时已含库内 pending 行，phase 1 新 emit 也会 add）。
4. 过期 hash **不**在 SQL 里算。换模型操作见脚本头注释。
5. `pauseMs` 仅在某一 phase 扫满 `batchSize` 后暂停（与 extract-backfill 同）。两 phase 都跑完才返回。
6. 本文件及 CLI **禁止** `import '@lancedb/lancedb'`、禁止相对路径进入 `src/lancedb/`。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/embed-backfill.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { emitOutbox } from '../../src/outbox/outbox.js';
import { runEmbedBackfillSweep, EMBED_BACKFILL_DEFAULT_BATCH } from '../../src/worker/embed-backfill.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

beforeEach(async () => {
  await resetDb();
  setEmbeddingProvider({} as unknown as EmbeddingProvider);
});
afterEach(() => setEmbeddingProvider(undefined));
afterAll(closeDb);

async function addMedia(opts: {
  momentId: string;
  chainId: string;
  ownerId: string;
  mime?: string;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  status?: 'ready' | 'uploading';
}): Promise<string> {
  const mediaId = randomUUID();
  await db.insert(media).values({
    id: mediaId,
    momentId: opts.momentId,
    uploaderId: opts.ownerId,
    s3Key: `chains/${opts.chainId}/${opts.momentId}/${mediaId}.jpeg`,
    mime: opts.mime ?? 'image/jpeg',
    size: 2048,
    status: opts.status ?? 'ready',
    storageMeta: TEST_META,
    sortOrder: 0,
    derivedStatus: opts.derivedStatus === undefined ? null : opts.derivedStatus,
  });
  return mediaId;
}

async function rowsOf(type: typeof OUTBOX_MOMENT_COMPRESS | typeof OUTBOX_MOMENT_EMBED) {
  return db.select().from(outbox).where(eq(outbox.type, type));
}

describe('runEmbedBackfillSweep（spec fused-retrieval §11 P10）', () => {
  it('常量 100；package.json script 是 tsx scripts/backfill-embed.ts', () => {
    expect(EMBED_BACKFILL_DEFAULT_BATCH).toBe(100);
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['backfill:embed']).toBe('tsx scripts/backfill-embed.ts');
    expect(pkg.scripts.test).toContain('--runInBand');
  });

  it('换模型操作注释锁定：LANCEDB_PATH + UPDATE embed_hash NULL；无 --reset-hash', () => {
    const src = readFileSync(path.join(SERVER_ROOT, 'scripts/backfill-embed.ts'), 'utf8');
    expect(src).toContain('LANCEDB_PATH');
    expect(src).toContain('UPDATE moments SET embed_hash = NULL WHERE deleted_at IS NULL');
    expect(src).toContain('--batch');
    expect(src).toContain('--interval-ms');
    expect(src).not.toContain('--reset-hash');
    const worker = readFileSync(path.join(SERVER_ROOT, 'src/worker/index.ts'), 'utf8');
    expect(worker).not.toContain('embed-backfill');
    const impl = readFileSync(path.join(SERVER_ROOT, 'src/worker/embed-backfill.ts'), 'utf8');
    expect(impl).not.toContain('lancedb');
    expect(impl).not.toContain('@lancedb/lancedb');
  });

  it('phase1：3 张 NULL 派生 JPEG、batchSize=2 → compressDispatched=3，列变 pending，payload 含 mediaId；phase2 因 pending 图不发 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
      content: '三连拍',
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await addMedia({ momentId, chainId, ownerId: owner.id }));
    }

    const result = await runEmbedBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(result.compressDispatched).toBe(3);
    expect(result.embedDispatched).toBe(0);

    const compress = await rowsOf(OUTBOX_MOMENT_COMPRESS);
    expect(compress).toHaveLength(3);
    const payloadIds = compress.map((r) => (r.payload as { mediaId: string }).mediaId).sort();
    expect(payloadIds).toEqual([...ids].sort());
    expect(compress.every((r) => (r.payload as { momentId: string; chainId: string }).momentId === momentId)).toBe(
      true,
    );
    expect(compress.every((r) => (r.payload as { chainId: string }).chainId === chainId)).toBe(true);

    for (const id of ids) {
      const [row] = await db.select().from(media).where(eq(media.id, id));
      expect(row.derivedStatus).toBe('pending');
      expect(row.derivedS3Key).toBeNull();
    }
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('GIF/HEIC/HEIF/视频/uploading/软删不 compress；非可压时刻无 pending 可压图且有正文 → 只 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const skipIds: string[] = [];
    for (const mime of ['image/gif', 'image/heic', 'image/heif'] as const) {
      const momentId = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(),
        content: mime,
      });
      await addMedia({ momentId, chainId, ownerId: owner.id, mime });
      skipIds.push(momentId);
    }
    const videoM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: 'video',
    });
    await addMedia({ momentId: videoM, chainId, ownerId: owner.id, mime: 'video/mp4' });
    const uploadingM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: 'uploading',
    });
    await addMedia({
      momentId: uploadingM,
      chainId,
      ownerId: owner.id,
      status: 'uploading',
    });
    const deleted = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已删',
      deletedAt: new Date(),
    });
    await addMedia({ momentId: deleted, chainId, ownerId: owner.id });

    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect((await rowsOf(OUTBOX_MOMENT_COMPRESS)).length).toBe(0);

    const embedPayloads = (await rowsOf(OUTBOX_MOMENT_EMBED)).map(
      (r) => (r.payload as { momentId: string }).momentId,
    );
    expect(embedPayloads).toEqual(expect.arrayContaining([...skipIds, videoM, uploadingM]));
    expect(embedPayloads).not.toContain(deleted);
    expect(result.embedDispatched).toBe(5);

    const [gifRow] = await db.select().from(media).where(eq(media.momentId, skipIds[0]));
    expect(gifRow.derivedStatus).toBeNull();
  });

  it('ready 图 + embed_hash NULL → 不 compress，发 1 条 embed；已有 hash 不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const readyM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已压',
    });
    await addMedia({ momentId: readyM, chainId, ownerId: owner.id, derivedStatus: 'ready' });
    const hashed = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已嵌',
    });
    await db.update(moments).set({ embedHash: 'a'.repeat(64) }).where(eq(moments.id, hashed));

    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect(result.embedDispatched).toBe(1);
    const [row] = await rowsOf(OUTBOX_MOMENT_EMBED);
    expect(row.payload).toEqual({ momentId: readyM, chainId });
  });

  it('failed 派生不阻塞 embed（无 pending）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '坏图仍有正文',
    });
    await addMedia({ momentId, chainId, ownerId: owner.id, derivedStatus: 'failed' });
    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect(result.embedDispatched).toBe(1);
  });

  it('空素材（空正文、无 ready 图）不发 embed——防跨 run 重复派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '',
    });
    const result = await runEmbedBackfillSweep();
    expect(result).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('纯文字 hash NULL → 只 embed；pending compress/embed 去重', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const textId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '纯文字存量',
    });
    const first = await runEmbedBackfillSweep();
    expect(first).toEqual({ compressDispatched: 0, embedDispatched: 1 });
    const second = await runEmbedBackfillSweep();
    expect(second).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(1);

    const jpegM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '待压',
    });
    const mediaId = await addMedia({ momentId: jpegM, chainId, ownerId: owner.id });
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId: jpegM, chainId, mediaId });
    });
    const third = await runEmbedBackfillSweep();
    expect(third).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(
      (await rowsOf(OUTBOX_MOMENT_COMPRESS)).filter((r) => (r.payload as { mediaId: string }).mediaId === mediaId),
    ).toHaveLength(1);
    const [jpegRow] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(jpegRow.derivedStatus).toBeNull();
  });

  it('空 provider（null）→ 直接退出，不写 outbox', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '有素材',
    });
    await addMedia({ momentId, chainId, ownerId: owner.id });
    setEmbeddingProvider(null);
    const result = await runEmbedBackfillSweep();
    expect(result).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_COMPRESS)).toHaveLength(0);
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('消费后二跑幂等：phase1 pending 图被 mock 成 ready 后 phase2 才能 embed；写 hash 后 dispatched=0', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '存量图',
    });
    const mediaId = await addMedia({ momentId, chainId, ownerId: owner.id });

    const first = await runEmbedBackfillSweep();
    expect(first.compressDispatched).toBe(1);
    expect(first.embedDispatched).toBe(0);

    await db
      .update(media)
      .set({
        derivedStatus: 'ready',
        derivedS3Key: `chains/${chainId}/${momentId}/${mediaId}.derived.webp`,
        derivedMime: 'image/webp',
        derivedSize: 100,
        derivedWidth: 512,
        derivedHeight: 256,
      })
      .where(eq(media.id, mediaId));
    await db.update(outbox).set({ status: 'done', processedAt: new Date() }).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));

    const second = await runEmbedBackfillSweep();
    expect(second.compressDispatched).toBe(0);
    expect(second.embedDispatched).toBe(1);

    await db.update(moments).set({ embedHash: 'b'.repeat(64) }).where(eq(moments.id, momentId));
    const third = await runEmbedBackfillSweep();
    expect(third).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(1);
    expect(await rowsOf(OUTBOX_MOMENT_COMPRESS)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run:

```bash
pnpm --filter @moment/server test -- tests/worker/embed-backfill.test.ts
```

Expected: FAIL，`Cannot find module '../../src/worker/embed-backfill.js'`。

- [ ] **Step 3: 实现 embed-backfill.ts**

Create `apps/server/src/worker/embed-backfill.ts`：

```ts
import { and, asc, eq, gt, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { media, momentPersons, moments, outbox, persons } from '../db/schema.js';
import { getEmbeddingProvider } from '../embedding/factory.js';
import { isCompressibleMime } from '../media/derived.js';
import { assembleEmbedText } from '../moments/embed-hash.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

export const EMBED_BACKFILL_DEFAULT_BATCH = 100;

export interface EmbedBackfillOptions {
  batchSize?: number;
  pauseMs?: number;
}

export interface EmbedBackfillResult {
  compressDispatched: number;
  embedDispatched: number;
}

function payloadId(payload: unknown, key: 'mediaId' | 'momentId'): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function pendingIds(type: typeof OUTBOX_MOMENT_COMPRESS | typeof OUTBOX_MOMENT_EMBED, key: 'mediaId' | 'momentId'): Promise<Set<string>> {
  const rows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.type, type), eq(outbox.status, 'pending')));
  const set = new Set<string>();
  for (const r of rows) {
    const id = payloadId(r.payload, key);
    if (id) set.add(id);
  }
  return set;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 存量回填（spec fused-retrieval §11）：只发射不消费。
 * 1) embedding provider null → 退出 0。
 * 2) 未软删时刻的静态可压图且 derived_status IS NULL → moment.compress（pending 去重；同事务置 pending）。
 * 3) 未软删、无 pending 可压图（列 pending 或 pending compress outbox）、embed_hash IS NULL → moment.embed（pending 去重；空素材跳过）。
 */
export async function runEmbedBackfillSweep(
  opts: EmbedBackfillOptions = {},
): Promise<EmbedBackfillResult> {
  const batchSize = opts.batchSize ?? EMBED_BACKFILL_DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? 0;

  if (getEmbeddingProvider() === null) {
    logger.info(
      'embed backfill skipped: embedding disabled (empty DASHSCOPE_API_KEY or MULTIMODAL_EMBEDDING_ENABLED=false)',
    );
    return { compressDispatched: 0, embedDispatched: 0 };
  }

  const pendingCompressMediaIds = await pendingIds(OUTBOX_MOMENT_COMPRESS, 'mediaId');
  let lastMediaId = '';
  let compressDispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [
      isNull(media.derivedStatus),
      eq(media.status, 'ready'),
      isNotNull(media.momentId),
      isNull(moments.deletedAt),
    ];
    if (lastMediaId !== '') conditions.push(gt(media.id, lastMediaId));
    const rows = await db
      .select({
        mediaId: media.id,
        momentId: media.momentId,
        chainId: moments.chainId,
        mime: media.mime,
      })
      .from(media)
      .innerJoin(moments, eq(media.momentId, moments.id))
      .where(and(...conditions))
      .orderBy(asc(media.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      lastMediaId = row.mediaId;
      if (!row.momentId) continue;
      if (!isCompressibleMime(row.mime)) continue;
      if (pendingCompressMediaIds.has(row.mediaId)) continue;
      await db.transaction(async (tx: DbTx) => {
        await tx
          .update(media)
          .set({ derivedStatus: 'pending' })
          .where(and(eq(media.id, row.mediaId), isNull(media.derivedStatus)));
        await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, {
          momentId: row.momentId,
          chainId: row.chainId,
          mediaId: row.mediaId,
        });
      });
      pendingCompressMediaIds.add(row.mediaId);
      compressDispatched += 1;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await pause(pauseMs);
  }

  const pendingEmbedMomentIds = await pendingIds(OUTBOX_MOMENT_EMBED, 'momentId');
  let lastMomentId = '';
  let embedDispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [isNull(moments.embedHash), isNull(moments.deletedAt)];
    if (lastMomentId !== '') conditions.push(gt(moments.id, lastMomentId));
    const rows = await db
      .select({
        id: moments.id,
        chainId: moments.chainId,
        content: moments.content,
        transcript: moments.transcript,
        placeName: moments.placeName,
      })
      .from(moments)
      .where(and(...conditions))
      .orderBy(asc(moments.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const m of rows) {
      lastMomentId = m.id;
      if (pendingEmbedMomentIds.has(m.id)) continue;

      const mediaRows = await db.select().from(media).where(eq(media.momentId, m.id));
      const pendingImg = mediaRows.some(
        (r) =>
          isCompressibleMime(r.mime) &&
          (r.derivedStatus === 'pending' || pendingCompressMediaIds.has(r.id)),
      );
      if (pendingImg) continue;

      const personRows = await db
        .select({ name: persons.name })
        .from(momentPersons)
        .innerJoin(persons, eq(momentPersons.personId, persons.id))
        .where(eq(momentPersons.momentId, m.id));
      const personNames = personRows.map((r) => r.name).filter((n) => n.length > 0);
      const text = assembleEmbedText(m.content, m.transcript, personNames, m.placeName);
      const readyImg = mediaRows.some(
        (r) => isCompressibleMime(r.mime) && r.derivedStatus === 'ready' && Boolean(r.derivedS3Key),
      );
      if (!text && !readyImg) continue;

      await db.transaction(async (tx: DbTx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId: m.id, chainId: m.chainId });
      });
      pendingEmbedMomentIds.add(m.id);
      embedDispatched += 1;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await pause(pauseMs);
  }

  if (compressDispatched > 0 || embedDispatched > 0) {
    logger.info('embed backfill dispatched', { compressDispatched, embedDispatched });
  }
  return { compressDispatched, embedDispatched };
}
```

**禁止** import `../lancedb/`。**禁止**调 `handleMomentCompress` / `handleMomentEmbed` / `getObject`。

- [ ] **Step 4: CLI + package.json**

Create `apps/server/scripts/backfill-embed.ts`：

```ts
/**
 * 一次性融合检索回填（spec fused-retrieval §11）：
 * 先给未软删时刻上 derived_status IS NULL 的静态可压图发射 moment.compress，
 * 再给 embed_hash IS NULL 且无 pending 可压图的时刻发射 moment.embed。
 * 实际压缩/嵌入由常驻 worker 的 outbox 循环完成（本脚本只发射，不调 DashScope、不读像素）。
 * 幂等：消费成功后 derived_status 不再 NULL / embed_hash 已写，二跑不重扫；
 * 未消费窗口由 sweep 内 pending outbox 去重吸收。
 * getEmbeddingProvider()===null（空 DASHSCOPE_API_KEY 或 MULTIMODAL_EMBEDDING_ENABLED=false）：直接退出。
 *
 * 运行：pnpm --filter @moment/server backfill:embed -- [--batch 100] [--interval-ms 500]
 *（pnpm 裸 --batch 会被当 pnpm 自身选项报错，参数必须经 -- 透传）
 *
 * 换模型或维度后全量重嵌（本脚本不重置 hash、不删 Lance、无 --reset-hash）：
 * 1. 停 server 与 worker
 * 2. 换 LANCEDB_PATH 到新子目录，或删除旧 Lance 目录/表
 *    例：LANCEDB_PATH=./lancedb_data/qwen3-vl-2560
 * 3. 在目标库执行：
 *    UPDATE moments SET embed_hash = NULL WHERE deleted_at IS NULL;
 * 4. pnpm --filter @moment/server backfill:embed -- --batch 100 --interval-ms 500
 * 5. 常驻 worker 消费 moment.compress / moment.embed
 */
import { pool } from '../src/db/index.js';
import { logger } from '../src/utils/logger.js';
import { runEmbedBackfillSweep } from '../src/worker/embed-backfill.js';

function intArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[idx + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const batchSize = intArg('batch', 100);
const pauseMs = intArg('interval-ms', 500);

try {
  const result = await runEmbedBackfillSweep({ batchSize, pauseMs });
  logger.info('embed backfill finished', { ...result, batchSize, pauseMs });
} catch (err) {
  logger.error('embed backfill crashed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
```

Modify `apps/server/package.json` 的 `scripts`：在 `"backfill:extract": "tsx scripts/backfill-extract.ts"` 之后追加一行（保留逗号合法 JSON）：

```json
    "backfill:extract": "tsx scripts/backfill-extract.ts",
    "backfill:embed": "tsx scripts/backfill-embed.ts"
```

不要改 `test` / `dev` / `worker` 等既有 script。不要改 `apps/web/package.json`。

- [ ] **Step 5: 运行确认通过**

Run:

```bash
pnpm --filter @moment/server test -- tests/worker/embed-backfill.test.ts tests/lancedb/worker-isolation.test.ts
```

Expected: PASS。worker-isolation 仍绿（`embed-backfill.ts` 不在 worker 入口 import 图里；即使 isolation 扫整个 `src/worker/`，本文件不得出现 `@lancedb/lancedb` 字符串——Step 1 源码锁已钉）。

若 isolation 测试是「从 `handlers.ts` / `index.ts` 做模块图」且本文件未被 import，它本来就不会进图。不要为了让 isolation 看到本文件去改 `index.ts`。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/worker/embed-backfill.ts \
  apps/server/scripts/backfill-embed.ts \
  apps/server/package.json \
  apps/server/tests/worker/embed-backfill.test.ts
git commit -m "feat(server): add backfill:embed script"
```

lockfile 若因误 `pnpm add` 出现 diff：**不许**为 P10 加依赖。nock / sharp / lancedb 已由 P3–P5 加入。若你没有跑 `pnpm add`，不应有 lockfile 变更。

---

### Task 3: CLI 双跑演练 + 全仓门禁 + spec 状态回写

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（**只改第 4 行状态**；不改 §11 分期表、不改产品语义）
- 无其它实现文件（CLI 演练证据记入完工报告，不落 repo）

**Interfaces:**
- Consumes: Task 1–2 产物；P1–P9 已实施为前提。
- Produces: 门禁证据 + spec 头部状态 `已实现（P1–P10 合入，2026-08-29）`。

- [ ] **Step 1: 真实 CLI sweep 双跑演练（spec §11 P10「e2e 绿；二跑幂等」）**

前提：确认 `apps/server/.env` 的 `MYSQL_*` 指向**测试库**（严禁生产库）。确认无 `pnpm worker` / `pnpm dev` 正对同一测试库消费 outbox（`ps` 或先停 dev）——否则第一次 pending 会被 worker 吃掉，第二次 `embedDispatched>0`、演练作废。

在 repo 根目录执行（`DASHSCOPE_API_KEY` 前缀覆盖使 sweep 真实扫描而非空 key 退出，见偏差 9；脚本只发射不调模型）：

```bash
DASHSCOPE_API_KEY=e2e-drill-dummy pnpm --filter @moment/server backfill:embed -- --batch 5 --interval-ms 100
DASHSCOPE_API_KEY=e2e-drill-dummy pnpm --filter @moment/server backfill:embed -- --batch 5 --interval-ms 100
```

Expected（逐条核对）:

1. 两次均 exit 0，日志含 `embed backfill finished` 与 `compressDispatched` / `embedDispatched`。
2. 第一次数字 = 测试库此刻符合扫描条件且无 pending 对应 outbox 的行数（jest 收尾后通常为 0 或小正整数——记录实际值）。
3. 第二次 `compressDispatched: 0` 且 `embedDispatched: 0`（pending 去重；若第一次已是 0/0 同样成立）。
4. 残留 pending 行无害：下一次 jest `resetDb()` 会清 outbox（含 compress/embed 类型）。
5. 若 `.env` 里 `MULTIMODAL_EMBEDDING_ENABLED=false`，两次都会走空 provider 的 0/0（仍满足二跑幂等，但没扫到行）。要演练扫描路径须 `true`（P5 默认 true）。

在完工报告记录：两条命令 exit code、两次 dispatched、执行时间。**不创建任何记录文件进 repo。**

若第一次非 0 而第二次非 0：先停 worker，再查是否没置 pending / pending 去重 key 不是 `mediaId`/`momentId`。不要对生产库重跑。

- [ ] **Step 2: server 全量测试 + typecheck + lint**

Run:

```bash
pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```

Expected: 全绿。记录 server 实际 pass 数（含 Task 1 的 3 个 e2e + Task 2 的 embed-backfill 用例）。不要为绿灯 skip 既有 people-place / recap e2e。

- [ ] **Step 3: 全仓 build / test / lint**

Run（repo 根目录）:

```bash
pnpm build && pnpm test && pnpm lint
```

Expected: exit 0。说明：

1. server 是唯一触库 jest 会话（`--runInBand`）；web vitest 不触库；dto/api-client 是 `tsx --test`。turbo 并行不存在「两个 jest 打同一测试库」。
2. **不**跑 `pnpm --filter @moment/web e2e:design-system`（不在 `pnpm test` 内；本计划不改 web scripts、不改基线）。
3. 若 web/app 编译红：那是 P8/P9 遗漏，停手报告，不在 P10 改客户端。

- [ ] **Step 4: 回写 spec 头部状态**

Modify `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md` 第 4 行，把：

```
> 状态：设计已与用户对齐，并完成校对，作为实施计划唯一真相源
```

改为：

```
> 状态：已实现（P1–P10 合入，2026-08-29）
```

不要改其它段落。不要把 §11「出口」列改成完成勾选表（那是计划 DoD，不是 spec 正文）。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md
git commit -m "docs: mark fused retrieval spec as implemented"
```

若 Step 4 以外无文件变更，不要把测试产物 / `.env` / `lancedb_data/` 加进这个 commit。

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test -- tests/search/search-e2e.test.ts` 3 用例全绿：全管线（人+地点+JPEG → derived ready + embed_hash + Lance 向量 + GET `person_id` feed/链列表 + 他链/不存在空页 + POST search 硬过滤与向量 + jobs 默认不含 extract + derived GET/列表/search 零 `getObject` + share-album 零 persons/place 键且仍有 `derivedUrl`）；丢链不倾倒；空 embedding LIKE `%` `_`
- [ ] `pnpm --filter @moment/server test -- tests/worker/embed-backfill.test.ts` 全绿：两阶段顺序、GIF/HEIC/HEIF 不压、pending 去重（pending compress outbox 时不 embed）、空 provider、空素材、消费后二跑、脚本头换模型注释、`package.json` script、worker/index 不调度
- [ ] CLI 双跑：两次 exit 0，第二次 `compressDispatched: 0` 且 `embedDispatched: 0`（记入完工报告）
- [ ] `pnpm --filter @moment/server test` / `typecheck` / `lint` exit 0
- [ ] `pnpm build` / `pnpm test` / `pnpm lint`（repo 根）exit 0
- [ ] spec §9 e2e 字面覆盖；spec §11 P10 出口「e2e 绿；二跑幂等」
- [ ] 换模型操作可在 `scripts/backfill-embed.ts` 头读到：`LANCEDB_PATH` + `UPDATE moments SET embed_hash = NULL WHERE deleted_at IS NULL` + `--batch` / `--interval-ms`；无 `--reset-hash`
- [ ] 未改 `apps/web/package.json`、`apps/server/.env`、`src/e2e/**`、`src/worker/index.ts`、`resetDb()` 顺序
- [ ] 测试全程未指向生产库；LLM/DashScope 未出域（factory mock / null / dummy key 不 `embed()`；e2e `disableNetConnect` + `enableNetConnect(/127\.0\.0\.1/)`）

## 写完自查（起草者已执行）

- **spec 覆盖：** §9 e2e 条目 → Task 1；§11 回填四步 + 二跑幂等 → Task 2/3；换模型 → 脚本头 + 源码锁；§8 分享红线 → Task 1 键级断言；请求线程零像素含 derived GET（偏差 14）。P2–P7 单测覆盖的 RANGE/限流/坏游标/BA 401 **不重复**（偏差 13）。
- **占位符扫描：** 无 TBD / TODO /「适当处理」/「类似 Task N」/「Write tests for the above」。
- **跨计划类型：** compress payload `{ momentId, chainId, mediaId }`、embed `{ momentId, chainId }` 与 P1/P5 逐字相同；`setEmbeddingProvider` / `isCompressibleMime` / `assembleEmbedText` / `ensureLance` 不改名；CLI 与 `backfill:extract` 同形 `--batch` / `--interval-ms`。
- **无新产品功能：** 只有测试 + 一次性回填脚本 + spec 状态行。不发明 jobs 重试、search URL、IVF、HEIC 解码。
