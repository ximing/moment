# 融合检索 P5：DashScope embedding + embed outbox handler + 触发点 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的写入期向量管线：`getEmbeddingProvider` / `setEmbeddingProvider` 三态；DashScope `qwen3-vl-embedding` HTTP（图为 `data:image/webp;base64,...`，nock 钉死 JSON）；`computeEmbedHash`；worker `handleMomentEmbed` 经 BA HTTP upsert/delete（禁止 import lancedb）；create/update/compress 终态/extract/geocode/transcribe/person 改名与删除全部按 spec 触发；时刻软删与链删除由 **server** 直接清 Lance。

**Architecture:** Embedding 独立三态，不复用 `LLM_*` / `ASR_API_KEY`。Hash 是纯函数（发射与消费同源）。`maybeEmitMomentEmbed(tx, momentId)` 是唯一发射口：有 `pending` 可压图则不发；hash 未变不发。Worker 只打存储 `getObject(derived_s3_key)`、DashScope、`INTERNAL_API_BASE_URL`；Lance 读写留在 HTTP server（P4 BA + 本计划软删/链删 repository）。Handler **禁止**自写 `outbox.status`：终败 throw `NonRetryableEmbeddingError`（`error.name` 钉死该字符串），由 P1 processor 立即 `failed`。

**Tech Stack:** `nock@^14`（拦截 native `fetch`，钉死 DashScope / BA JSON）/ jest `--runInBand` + 真实 MySQL 测试库 / `installMockStorage().getObject`（P1）/ P4 `getBaAuthToken` + `INTERNAL_API_BASE_URL` + `deleteVectorsByMomentId` / P3 `isCompressibleMime` / `handleMomentCompress`。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§0 写入期 worker / data URI / 人名地名出域、§1 向量流与软删链删、§2.2 `embed_hash`、§2.3 NonRetryableEmbeddingError、§4.1 Provider、§4.2 compress 步骤 7、§4.3 embed handler、§4.4 重嵌触发、§8 仅 embed 读 derived、§9 embed 测试、§11 P5 出口）

**上游契约:**
- P1 `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`：`moments.embed_hash`、`OUTBOX_MOMENT_EMBED` / `MomentEmbedPayload`、`getObject` / `ObjectTooLargeError`、processor 按 `error.name === 'NonRetryableEmbeddingError'` 立即 failed
- P3 `docs/superpowers/plans/2026-08-29-fused-retrieval-p3-compress-derived.md`：`isCompressibleMime` / `handleMomentCompress`（终态 **尚未** emit embed，偏差 1）/ create 可压图 pending+compress
- P4 `docs/superpowers/plans/2026-08-29-fused-retrieval-p4-lancedb-ba.md`：`config.INTERNAL_API_BASE_URL` / `MULTIMODAL_EMBEDDING_DIMENSION` / `BA_AUTH_TOKEN` / `getBaAuthToken` / `setBaAuthTokenForTests` / `POST|DELETE /api/internal/embeddings` / `upsertMomentVector` / `deleteVectorsByMomentId` / worker isolation 源码图。**P5 不得再往 `envSchema` 加 `MULTIMODAL_EMBEDDING_DIMENSION`。**

执行时假设 P1+P3+P4 已在本分支落地。P2 标量过滤与本计划正交。

## Global Constraints

- 冻结名逐字不得改：`getEmbeddingProvider` / `setEmbeddingProvider` / `computeEmbedHash` / `handleMomentEmbed` / `NonRetryableEmbeddingError`（`error.name` 必须是该字符串）/ `RetryableEmbeddingError` / `maybeEmitMomentEmbed` / `OUTBOX_MOMENT_EMBED = 'moment.embed'` / payload `{ momentId, chainId }` / env `MULTIMODAL_EMBEDDING_ENABLED` 默认 `true`、`MULTIMODAL_EMBEDDING_MODEL`=`qwen3-vl-embedding`、`DASHSCOPE_API_KEY` 默认 `''`、`DASHSCOPE_BASE_URL`=`https://dashscope.aliyuncs.com/api/v1`、`MULTIMODAL_EMBEDDING_OUTPUT_TYPE`=`dense`。`MULTIMODAL_EMBEDDING_DIMENSION` 已由 P4 落地（默认 2560），本计划只读。
- **worker 禁止** `import '@lancedb/lancedb'`、禁止相对路径进入 `src/lancedb/`。embed 写入只走 `fetch(INTERNAL_API_BASE_URL)`。软删/链删清向量只在 **server** 的 `MomentService.remove` / `ChainService.remove`（事务提交之后），失败只打日志。
- Handler **不得** `update outbox.status`。终败 throw `NonRetryableEmbeddingError`；可重试（存储/网络/DashScope 429/5xx/超时/BA 非 2xx）原样 throw，走 P1 五档退避。
- **无 pending 可压图才 emit embed**；组装图只纳入 `derived_status=ready`。failed 不阻塞。第一张图 = 含 poster 行、按 `sortOrder,id` 升序的下标 0。图 payload 是 data URI，禁止原图、禁止预签名 URL。
- transcribe 成功且 hash 变 → **同事务直接 emit embed**（即使 extract 因空 LLM 跳过）。person DELETE：**先**查 momentId，再删关联+词典，再 emit。
- `MULTIMODAL_EMBEDDING_ENABLED` 用 `enum true/false` + transform，**禁止** `z.coerce.boolean()`。`DASHSCOPE_API_KEY` **不**回退 `ASR_API_KEY`。
- **不**实现 `POST /api/search`、意图 LLM、`VECTOR_CANDIDATE_LIMIT`、ANN `.search()`、`{d,i}` 游标、jobs HTTP、api-client/web/app、`backfill:embed`。不改 `apps/server/.env`。
- CONVENTIONS §3 只追加：不改 `ChainPolicy` / feed `{h,i}`/`{c,i}` / 既有存储方法名 / 既有 outbox 列。无新表，`resetDb()` 删除顺序不变。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已写完允许追加项）。
- server 测试：`pnpm --filter @moment/server test -- <file>`（脚本已含 `--runInBand`）；触库文件 `afterAll(closeDb)` + `beforeEach(resetDb)`。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **`enable_fusion` 放在 `parameters` 内，不放 body 顶层。** 2026-08 官方 HTTP 示例（`help.aliyun.com/zh/model-studio/multimodal-embedding-api-reference`）是 `"parameters": { "enable_fusion": true }`；Python SDK 的顶层 `enable_fusion=True` 会编进 parameters。仅 vl（`contents.length > 1`）设该键；text-only / image-only **不出现**该键。nock 钉死实际 JSON。
2. **DashScope HTTP 测试用 `nock@^14`（拦截 native fetch）。** 现网 LLM/ASR 测试 mock `globalThis.fetch`；spec 与本计划要求 nock 钉 body。安装 `nock@^14`（14.x 用 undici MockAgent 拦 fetch）。若本仓库 jest `--experimental-vm-modules` 下 nock 拦不到 fetch：停手报告实际错误，**禁止**静默改回 mock fetch。不要用 nock@13。
3. **Worker BA 客户端读 P4 `getBaAuthToken()`**，这样 `setBaAuthTokenForTests` 对 handler 测试生效（`config.BA_AUTH_TOKEN` 在 import 时已 parse）。
4. **`deleteVectorsByChainId(chainId: string): Promise<number>` 本计划追加到 P4 repository**（P4 明确「不按 chainId 删，属 P5」）。where 仍走 `lanceEqUuid('chainId', chainId)`，非 uuid warn+return 0。
5. **软删/链删清 Lance：失败（含 `LANCE_NOT_READY`，因为 `createApp()` 不 connect）只 `logger.warn`，不让 HTTP 204 变 500。** spec「失败只打日志」。既有 `moment-list-crud` / `chains.crud` 删链测试不 `ensureLance`，必须继续绿。
6. **`deploy/.env.example` 与 `deploy/.env.external.example` 同步本计划 5 个 DashScope/开关字段**（对齐 P4 偏差 9）。仍不覆盖 `apps/server/.env`。
7. **`maybeEmitMomentEmbed` 不按 pending embed 行去重**（spec §4.4，与 extract 偏差 8 相同）。消费侧 hash 幂等吸收。
8. **`computeEmbedHash` 公式不含 `outputType`**（spec §2.2 是 `model + ':' + dim`）。Lance 行上 `modelHash` 才是 `sha256(model:dim:outputType)`。
9. **compress 终态 emit 包进写 derived 列的同一事务**（ready/skipped/failed 三条路径都调 `maybeEmitMomentEmbed`）。GIF/HEIC/缺失/软删早退路径不 emit。
10. **查询期 `embed({ text })` 属 P6。** 本计划 factory 两进程都能 `getEmbeddingProvider()`，但没有任何 search 路由调用它。
11. **`maybeEmitMomentEmbed` / `handleMomentEmbed` 不 import `PersonService`。** 人名取词典行 `persons.name`（create/rename/extract 写入时已 `normalizePersonName`）。否则 T6 的 `person.service` → `embed-outbox` → `person.service` 构成 ESM 环。hash 侧仍对名字数组 `sort()`。
12. **geocode/extract/transcribe 在已 claim 的批次里再插 embed**（偏差 7）。既有 `people-place-e2e` 必须 drain `runOutboxBatch` 至 `claimed=0` 才能保持 `pending=0`；`handle-moment-extract` 转写全链路直调 transcribe 后再 `runOutboxBatch` 会一次 claim extract+embed（`done===2`）。凡走默认 handlers 的 e2e/processor 测 `setEmbeddingProvider(null)`，避免测试库若配了 `DASHSCOPE_API_KEY` 打真网。

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/src/config.ts` | ENABLED / MODEL / DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / OUTPUT_TYPE（**不加 DIMENSION**） |
| `apps/server/.env.example` + 两份 `deploy/.env*.example` | 同上 |
| `apps/server/src/embedding/base.provider.ts` | 类型、错误类、`computeEmbeddingModelHash` |
| `apps/server/src/embedding/dashscope-multimodal.provider.ts` | HTTP + enable_fusion 规则 |
| `apps/server/src/embedding/factory.ts` | 三态 factory |
| `apps/server/src/moments/embed-hash.ts` | `computeEmbedHash` / `derivedFingerprintOf` / `assembleEmbedText` |
| `apps/server/src/moments/embed-outbox.ts` | `maybeEmitMomentEmbed` |
| `apps/server/src/embedding/ba-client.ts` | worker `fetch` DELETE/POST，10s abort |
| `apps/server/src/embedding/handle-moment-embed.ts` | `handleMomentEmbed` |
| `apps/server/src/worker/handlers.ts` | 注册 `moment.embed` |
| `apps/server/src/media/handle-moment-compress.ts` | 终态 emit embed |
| `apps/server/src/moments/moment.service.ts` | create/update maybeEmit；remove 后清 Lance |
| `apps/server/src/llm/extract/persist.ts` | persist 成功后 maybeEmit |
| `apps/server/src/worker/handlers.ts` | geocode / transcribe 成功路径 maybeEmit |
| `apps/server/src/persons/person.service.ts` | rename/delete emit |
| `apps/server/src/lancedb/repository.ts` | `deleteVectorsByChainId` |
| `apps/server/src/chains/chain.service.ts` | 删链成功后清 Lance |
| `apps/server/package.json` + lockfile | `nock@^14` devDependency |

**本计划明确不改：** `chain-policy.ts`、feed cursor、`momentSerializer`、`queryMomentPage`、SearchController、jobs 路由、`VECTOR_CANDIDATE_LIMIT`、api-client、web/app、`scripts/backfill-*.ts`、`tests/helpers/db.ts` 删除顺序、Dockerfile/compose/nginx（P4 已落地）、`apps/server/.env`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: embedding env（config + .env.example；不加 DIMENSION）

**Files:**
- Modify: `apps/server/src/config.ts`（P4 的 `MULTIMODAL_EMBEDDING_DIMENSION` 块之后、`envSchema` 闭合之前）
- Modify: `apps/server/.env.example`（P4 Lance/BA 块之后）
- Modify: `deploy/.env.example` / `deploy/.env.external.example`（P4 四字段之后）
- Test: `apps/server/tests/embedding/config.test.ts`

**Interfaces:**
- Consumes:
  - 现 `envSchema`（zod 3；boolean 用 enum+transform，禁止 `z.coerce.boolean()`）
  - P4 已有 `MULTIMODAL_EMBEDDING_DIMENSION` / `INTERNAL_API_BASE_URL` / `BA_AUTH_TOKEN` / `LANCEDB_PATH` — **不要再声明 DIMENSION**
- Produces:
  - `config.MULTIMODAL_EMBEDDING_ENABLED: boolean` 默认 `true`
  - `config.MULTIMODAL_EMBEDDING_MODEL: string` 默认 `'qwen3-vl-embedding'`
  - `config.DASHSCOPE_API_KEY: string` 默认 `''`
  - `config.DASHSCOPE_BASE_URL: string` 默认 `'https://dashscope.aliyuncs.com/api/v1'`
  - `config.MULTIMODAL_EMBEDDING_OUTPUT_TYPE: string` 默认 `'dense'`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/embedding/config.test.ts`：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, envSchema } from '../../src/config.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

describe('config DashScope embedding env（fused-retrieval spec §4.1 / §11 P5）', () => {
  it('五字段存在；缺省与 spec 默认一致', () => {
    expect(typeof config.MULTIMODAL_EMBEDDING_ENABLED).toBe('boolean');
    expect(typeof config.MULTIMODAL_EMBEDDING_MODEL).toBe('string');
    expect(typeof config.DASHSCOPE_API_KEY).toBe('string');
    expect(typeof config.DASHSCOPE_BASE_URL).toBe('string');
    expect(typeof config.MULTIMODAL_EMBEDDING_OUTPUT_TYPE).toBe('string');

    const parsed = envSchema.parse({
      ...process.env,
      MULTIMODAL_EMBEDDING_ENABLED: undefined,
      MULTIMODAL_EMBEDDING_MODEL: undefined,
      DASHSCOPE_API_KEY: undefined,
      DASHSCOPE_BASE_URL: undefined,
      MULTIMODAL_EMBEDDING_OUTPUT_TYPE: undefined,
    });
    expect(parsed.MULTIMODAL_EMBEDDING_ENABLED).toBe(true);
    expect(parsed.MULTIMODAL_EMBEDDING_MODEL).toBe('qwen3-vl-embedding');
    expect(parsed.DASHSCOPE_API_KEY).toBe('');
    expect(parsed.DASHSCOPE_BASE_URL).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(parsed.MULTIMODAL_EMBEDDING_OUTPUT_TYPE).toBe('dense');
  });

  it('ENABLED 用 enum+transform：字符串 false 是 false（禁止 z.coerce.boolean）', () => {
    expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: 'false' }).MULTIMODAL_EMBEDDING_ENABLED).toBe(false);
    expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: 'true' }).MULTIMODAL_EMBEDDING_ENABLED).toBe(true);
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_ENABLED: '1' })).toThrow();
  });

  it('DASHSCOPE_BASE_URL 须是 URL；空 key 合法', () => {
    expect(() => envSchema.parse({ ...process.env, DASHSCOPE_BASE_URL: 'not-a-url' })).toThrow();
    expect(envSchema.parse({ ...process.env, DASHSCOPE_API_KEY: '' }).DASHSCOPE_API_KEY).toBe('');
  });

  it('不把 ASR_API_KEY 当成 DASHSCOPE_API_KEY', () => {
    const parsed = envSchema.parse({
      ...process.env,
      DASHSCOPE_API_KEY: '',
      ASR_API_KEY: 'sk-asr-only',
    });
    expect(parsed.DASHSCOPE_API_KEY).toBe('');
    expect(parsed.ASR_API_KEY).toBe('sk-asr-only');
  });
});

describe('.env.example DashScope 五字段（不读 apps/server/.env）', () => {
  function mustHaveKeys(rel: string) {
    const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const k of [
      'MULTIMODAL_EMBEDDING_ENABLED=',
      'MULTIMODAL_EMBEDDING_MODEL=',
      'DASHSCOPE_API_KEY=',
      'DASHSCOPE_BASE_URL=',
      'MULTIMODAL_EMBEDDING_OUTPUT_TYPE=',
    ]) {
      expect(text).toContain(k);
    }
    expect(text).not.toMatch(/DASHSCOPE_API_KEY=\$\{ASR/);
  }

  it('apps/server 与两份 deploy example 都含五字段', () => {
    mustHaveKeys('apps/server/.env.example');
    mustHaveKeys('deploy/.env.example');
    mustHaveKeys('deploy/.env.external.example');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/embedding/config.test.ts`
Expected: FAIL。`config.MULTIMODAL_EMBEDDING_ENABLED` 不是 `Config` 的字段（TS/jest：`undefined` 或编译失败）。

- [ ] **Step 3: 最小实现**

Modify `apps/server/src/config.ts` — 在 P4 的 `MULTIMODAL_EMBEDDING_DIMENSION` 字段之后、`});` 之前插入：
```ts
  // ---------- fused retrieval DashScope embedding（spec §4.1 / §11 P5）----------
  // 禁止 z.coerce.boolean()：字符串 'false' 会被判 true。
  MULTIMODAL_EMBEDDING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  MULTIMODAL_EMBEDDING_MODEL: z.string().min(1).default('qwen3-vl-embedding'),
  // 空串 = 停用向量路。不回退 ASR_API_KEY（运维可填同一值，但 config 层不自动借用）。
  DASHSCOPE_API_KEY: z.string().default(''),
  DASHSCOPE_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/api/v1'),
  MULTIMODAL_EMBEDDING_OUTPUT_TYPE: z.string().min(1).default('dense'),
```

**不要**再加 `MULTIMODAL_EMBEDDING_DIMENSION` / `LANCEDB_PATH` / `BA_AUTH_TOKEN` / `INTERNAL_API_BASE_URL`。**不要**加 `MULTIMODAL_EMBEDDING_VIDEO_FPS` / `EMBEDDING_IMAGE_URL_TTL_SECONDS`。

Append to `apps/server/.env.example`（P4 块之后）：
```
# ---------- fused retrieval DashScope embedding（P5）----------
# 空 key 或 ENABLED=false → getEmbeddingProvider()=null，跳过向量路，标量过滤不停。
# 人名/地名/正文/转写/派生 WebP 会出域到 DashScope（spec §8）。不回退 ASR_API_KEY。
MULTIMODAL_EMBEDDING_ENABLED=true
MULTIMODAL_EMBEDDING_MODEL=qwen3-vl-embedding
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
MULTIMODAL_EMBEDDING_OUTPUT_TYPE=dense
```

把同样五条赋值（注释可压缩）追加到 `deploy/.env.example` 与 `deploy/.env.external.example` 的 P4 块之后。`DASHSCOPE_API_KEY=` 在 example 里留空。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/embedding/config.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/.env.example deploy/.env.example deploy/.env.external.example apps/server/tests/embedding/config.test.ts
git commit -m "feat(server): add DashScope multimodal embedding env vars"
```

---

### Task 2: DashScope provider + factory + nock 钉 body

**Files:**
- Create: `apps/server/src/embedding/base.provider.ts`
- Create: `apps/server/src/embedding/dashscope-multimodal.provider.ts`
- Create: `apps/server/src/embedding/factory.ts`
- Test: `apps/server/tests/embedding/dashscope-multimodal.test.ts`
- Test: `apps/server/tests/embedding/factory.test.ts`
- Modify: `apps/server/package.json` + 根 `pnpm-lock.yaml`（`pnpm --filter @moment/server add -D nock@^14`）

**Interfaces:**
- Consumes: Task 1 五字段；P4 `config.MULTIMODAL_EMBEDDING_DIMENSION`
- Produces:
  - `export type EmbeddingModality = 'text' | 'image' | 'vl'`
  - `export interface EmbeddingRequest { text?: string; imageDataUri?: string }`
  - `export interface EmbeddingProvider { embed(req: EmbeddingRequest): Promise<number[]>; modelHash(): string; dimensions(): number }`
  - `class RetryableEmbeddingError extends Error` — `this.name = 'RetryableEmbeddingError'`
  - `class NonRetryableEmbeddingError extends Error` — `this.name = 'NonRetryableEmbeddingError'`（P1 processor 只认 name 字符串）
  - `computeEmbeddingModelHash(model: string, dim: number, outputType: string): string` — `sha256(\`${model}:${dim}:${outputType}\`).digest('hex')`，64 位小写
  - `export const EMBEDDING_TIMEOUT_MS = 20_000`
  - `export const MULTIMODAL_EMBEDDING_PATH = '/services/embeddings/multimodal-embedding/multimodal-embedding'`
  - `class DashScopeMultimodalProvider implements EmbeddingProvider`
  - `getEmbeddingProvider(): EmbeddingProvider | null`
  - `setEmbeddingProvider(p: EmbeddingProvider | null | undefined): void` — `undefined` 回落真实 config；业务代码禁用
  - `isMultimodalEmbeddingConfigured(): boolean` — `ENABLED && DASHSCOPE_API_KEY !== ''`
  - null 当：`DASHSCOPE_API_KEY===''` **或** `MULTIMODAL_EMBEDDING_ENABLED===false`

HTTP 规则（nock 钉死）：

- `POST {baseUrl}{MULTIMODAL_EMBEDDING_PATH}`，`Authorization: Bearer {apiKey}`，`Content-Type: application/json`
- body：
  ```
  {
    "model": "<MODEL>",
    "input": { "contents": [ {"text":"..."} 和/或 {"image":"data:image/webp;base64,..."} ] },
    "parameters": {
      "dimension": <dim>,
      "output_type": "<OUTPUT_TYPE>",
      "enable_fusion": true   // 仅 contents.length > 1；单模态不出现该键
    }
  }
  ```
- 仅 `text` → text；仅 `imageDataUri` → image；两者都有 → vl；两者都缺 → `NonRetryableEmbeddingError` message `EMPTY_EMBEDDING_REQUEST`
- 429/5xx/网络/超时 → `RetryableEmbeddingError`；其它 4xx、缺 `output.embeddings[0].embedding`、向量长度 ≠ dim → `NonRetryableEmbeddingError`
- 成功返回 `output.embeddings[0].embedding`（number[]）

- [ ] **Step 1: 加 nock**

Run: `pnpm --filter @moment/server add -D nock@^14`

`apps/server/package.json` `devDependencies` 必须出现 `"nock"`，版本主版本 14。接受 lockfile 解析的 14.x。

- [ ] **Step 2: 写失败测试 — provider + nock**

Create `apps/server/tests/embedding/dashscope-multimodal.test.ts`：
```ts
import { createHash } from 'node:crypto';
import nock from 'nock';
import {
  EMBEDDING_TIMEOUT_MS,
  MULTIMODAL_EMBEDDING_PATH,
  NonRetryableEmbeddingError,
  RetryableEmbeddingError,
  computeEmbeddingModelHash,
} from '../../src/embedding/base.provider.js';
import { DashScopeMultimodalProvider } from '../../src/embedding/dashscope-multimodal.provider.js';

const HOST = 'https://dashscope.aliyuncs.com';
const PATH = '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const DIM = 8;
const VEC = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
const DATA_URI = 'data:image/webp;base64,AAAA';

const opts = {
  baseUrl: `${HOST}/api/v1`,
  apiKey: 'sk-test',
  model: 'qwen3-vl-embedding',
  dimension: DIM,
  outputType: 'dense',
  timeoutMs: 200,
};

function replyOk(embedding: number[] = VEC) {
  return { output: { embeddings: [{ index: 0, embedding }] }, request_id: 'r1' };
}

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('NonRetryableEmbeddingError name（P1 processor 只认 error.name）', () => {
  it('钉死字符串', () => {
    const err = new NonRetryableEmbeddingError('EMBEDDING_DIM_MISMATCH');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NonRetryableEmbeddingError');
    expect(err.message).toBe('EMBEDDING_DIM_MISMATCH');
    expect(new RetryableEmbeddingError('x').name).toBe('RetryableEmbeddingError');
    expect(EMBEDDING_TIMEOUT_MS).toBe(20_000);
    expect(MULTIMODAL_EMBEDDING_PATH).toBe(
      '/services/embeddings/multimodal-embedding/multimodal-embedding',
    );
  });
});

describe('computeEmbeddingModelHash', () => {
  it('sha256(model:dim:outputType) 64 hex', () => {
    const expectHex = createHash('sha256').update('qwen3-vl-embedding:2560:dense').digest('hex');
    expect(computeEmbeddingModelHash('qwen3-vl-embedding', 2560, 'dense')).toBe(expectHex);
    expect(expectHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DashScopeMultimodalProvider.embed（spec §4.1；nock 钉 JSON）', () => {
  it('text-only：parameters 无 enable_fusion；Bearer；返回向量', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .matchHeader('Authorization', 'Bearer sk-test')
      .reply(200, replyOk());

    const out = await new DashScopeMultimodalProvider(opts).embed({ text: '外婆家' });
    expect(out).toEqual(VEC);
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '外婆家' }] },
      parameters: { dimension: DIM, output_type: 'dense' },
    });
    expect((captured as { parameters: Record<string, unknown> }).parameters.enable_fusion).toBeUndefined();
  });

  it('image-only：contents[{image:data URI}]，无 enable_fusion', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .reply(200, replyOk());

    await new DashScopeMultimodalProvider(opts).embed({ imageDataUri: DATA_URI });
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ image: DATA_URI }] },
      parameters: { dimension: DIM, output_type: 'dense' },
    });
  });

  it('vl：parameters.enable_fusion=true（官方 HTTP 放 parameters 内）', async () => {
    let captured: unknown;
    nock(HOST)
      .post(PATH, (body) => {
        captured = body;
        return true;
      })
      .reply(200, replyOk());

    await new DashScopeMultimodalProvider(opts).embed({ text: '正文', imageDataUri: DATA_URI });
    expect(captured).toEqual({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '正文' }, { image: DATA_URI }] },
      parameters: { dimension: DIM, output_type: 'dense', enable_fusion: true },
    });
  });

  it('两者都缺 → NonRetryableEmbeddingError EMPTY_EMBEDDING_REQUEST；零 HTTP', async () => {
    expect(nock.pendingMocks()).toEqual([]);
    await expect(new DashScopeMultimodalProvider(opts).embed({})).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
      message: 'EMPTY_EMBEDDING_REQUEST',
    });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('429/5xx/网络/超时 → RetryableEmbeddingError', async () => {
    nock(HOST).post(PATH).reply(429, { message: 'rate' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(503, { message: 'down' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).replyWithError({ code: 'ECONNRESET', message: 'reset' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'RetryableEmbeddingError',
    });

    nock(HOST).post(PATH).delayConnection(500).reply(200, replyOk());
    await expect(
      new DashScopeMultimodalProvider({ ...opts, timeoutMs: 50 }).embed({ text: 'a' }),
    ).rejects.toMatchObject({ name: 'RetryableEmbeddingError' });
  });

  it('4xx 其它 / 缺 embeddings / 维数不符 → NonRetryableEmbeddingError', async () => {
    nock(HOST).post(PATH).reply(400, { code: 'InvalidParameter' });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(200, { output: { embeddings: [] } });
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });

    nock(HOST).post(PATH).reply(200, replyOk([0.1, 0.2]));
    await expect(new DashScopeMultimodalProvider(opts).embed({ text: 'a' })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
    });
  });

  it('modelHash / dimensions 来自构造参数', () => {
    const p = new DashScopeMultimodalProvider(opts);
    expect(p.dimensions()).toBe(DIM);
    expect(p.modelHash()).toBe(computeEmbeddingModelHash('qwen3-vl-embedding', DIM, 'dense'));
  });
});
```

Create `apps/server/tests/embedding/factory.test.ts`：
```ts
import { jest } from '@jest/globals';
import { config } from '../../src/config.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { DashScopeMultimodalProvider } from '../../src/embedding/dashscope-multimodal.provider.js';
import {
  getEmbeddingProvider,
  isMultimodalEmbeddingConfigured,
  setEmbeddingProvider,
} from '../../src/embedding/factory.js';

describe('getEmbeddingProvider 三态（对齐 getLLMProvider）', () => {
  afterEach(() => setEmbeddingProvider(undefined));

  it('注入 mock → 返回该 mock（单例缓存）', () => {
    const mock = { embed: jest.fn(), modelHash: () => 'a', dimensions: () => 2560 };
    setEmbeddingProvider(mock as unknown as EmbeddingProvider);
    expect(getEmbeddingProvider()).toBe(mock);
    expect(getEmbeddingProvider()).toBe(mock);
  });

  it('注入 null → null（空 key / ENABLED=false）', () => {
    setEmbeddingProvider(null);
    expect(getEmbeddingProvider()).toBeNull();
  });

  it('重置 undefined → 回落真实 config：未配置则 null，已配置则 DashScopeMultimodalProvider', () => {
    setEmbeddingProvider(undefined);
    const provider = getEmbeddingProvider();
    if (isMultimodalEmbeddingConfigured()) {
      expect(provider).toBeInstanceOf(DashScopeMultimodalProvider);
    } else {
      expect(provider).toBeNull();
    }
  });
});

describe('isMultimodalEmbeddingConfigured', () => {
  it('空 key 或 ENABLED=false → false', () => {
    expect(isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: '', MULTIMODAL_EMBEDDING_ENABLED: true })).toBe(false);
    expect(
      isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: 'sk', MULTIMODAL_EMBEDDING_ENABLED: false }),
    ).toBe(false);
    expect(
      isMultimodalEmbeddingConfigured({ ...config, DASHSCOPE_API_KEY: 'sk', MULTIMODAL_EMBEDDING_ENABLED: true }),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/embedding/dashscope-multimodal.test.ts tests/embedding/factory.test.ts`
Expected: FAIL，`base.provider.js` / `dashscope-multimodal.provider.js` / `factory.js` 不是模块。

若 **nock 本身** import 失败：停手报告（esm default import）。不要改用 mock fetch。

- [ ] **Step 4: 实现 base.provider.ts**

Create `apps/server/src/embedding/base.provider.ts`：
```ts
import { createHash } from 'node:crypto';

export type EmbeddingModality = 'text' | 'image' | 'vl';

export interface EmbeddingRequest {
  text?: string;
  /** 派生 WebP 的 data URI。禁止原图、禁止公网 URL。 */
  imageDataUri?: string;
}

export interface EmbeddingProvider {
  embed(req: EmbeddingRequest): Promise<number[]>;
  modelHash(): string;
  dimensions(): number;
}

export const EMBEDDING_TIMEOUT_MS = 20_000;
export const MULTIMODAL_EMBEDDING_PATH = '/services/embeddings/multimodal-embedding/multimodal-embedding';

export function computeEmbeddingModelHash(model: string, dim: number, outputType: string): string {
  return createHash('sha256').update(`${model}:${dim}:${outputType}`).digest('hex');
}

export class RetryableEmbeddingError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableEmbeddingError';
  }
}

/** processor 只认 error.name === 'NonRetryableEmbeddingError'。handler 禁止自写 outbox.status。 */
export class NonRetryableEmbeddingError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableEmbeddingError';
  }
}
```

- [ ] **Step 5: 实现 dashscope-multimodal.provider.ts**

Create `apps/server/src/embedding/dashscope-multimodal.provider.ts`：
```ts
import {
  EMBEDDING_TIMEOUT_MS,
  MULTIMODAL_EMBEDDING_PATH,
  NonRetryableEmbeddingError,
  RetryableEmbeddingError,
  computeEmbeddingModelHash,
  type EmbeddingProvider,
  type EmbeddingRequest,
} from './base.provider.js';

export interface DashScopeMultimodalProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
  outputType: string;
  timeoutMs?: number;
}

export class DashScopeMultimodalProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: DashScopeMultimodalProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  }

  dimensions(): number {
    return this.opts.dimension;
  }

  modelHash(): string {
    return computeEmbeddingModelHash(this.opts.model, this.opts.dimension, this.opts.outputType);
  }

  async embed(req: EmbeddingRequest): Promise<number[]> {
    const contents: Array<Record<string, string>> = [];
    if (req.text !== undefined && req.text.length > 0) contents.push({ text: req.text });
    if (req.imageDataUri) contents.push({ image: req.imageDataUri });
    if (contents.length === 0) throw new NonRetryableEmbeddingError('EMPTY_EMBEDDING_REQUEST');

    const parameters: Record<string, unknown> = {
      dimension: this.opts.dimension,
      output_type: this.opts.outputType,
    };
    if (contents.length > 1) parameters.enable_fusion = true;

    const url = `${this.baseUrl}${MULTIMODAL_EMBEDDING_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.opts.model,
          input: { contents },
          parameters,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new RetryableEmbeddingError(
        err instanceof Error && err.name === 'AbortError'
          ? `embedding request timed out after ${this.timeoutMs}ms`
          : `embedding network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableEmbeddingError(`embedding HTTP ${resp.status}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableEmbeddingError(`embedding HTTP ${resp.status}`);
    }

    let data: unknown;
    try {
      data = (await resp.json()) as unknown;
    } catch (err) {
      throw new NonRetryableEmbeddingError('embedding response is not JSON', err);
    }
    const embedding = readEmbedding(data);
    if (!embedding) throw new NonRetryableEmbeddingError('embedding response missing embeddings[0].embedding');
    if (embedding.length !== this.opts.dimension) {
      throw new NonRetryableEmbeddingError('EMBEDDING_DIM_MISMATCH');
    }
    return embedding;
  }
}

function readEmbedding(data: unknown): number[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const output = (data as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) return null;
  const embeddings = (output as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length === 0) return null;
  const first = embeddings[0];
  if (typeof first !== 'object' || first === null) return null;
  const embedding = (first as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding) || !embedding.every((n) => typeof n === 'number')) return null;
  return embedding as number[];
}
```

空 `text: ''` 不进 contents（与「空则无文本」一致）。调用方在组装时已 trim；若只剩 image 则走 image 模态。

- [ ] **Step 6: 实现 factory.ts**

Create `apps/server/src/embedding/factory.ts`：
```ts
import { config, type Config } from '../config.js';
import type { EmbeddingProvider } from './base.provider.js';
import { DashScopeMultimodalProvider } from './dashscope-multimodal.provider.js';

let singleton: EmbeddingProvider | null | undefined;
let override: EmbeddingProvider | null | undefined;

export function isMultimodalEmbeddingConfigured(cfg: Config = config): boolean {
  return cfg.MULTIMODAL_EMBEDDING_ENABLED && cfg.DASHSCOPE_API_KEY !== '';
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = isMultimodalEmbeddingConfigured()
      ? new DashScopeMultimodalProvider({
          baseUrl: config.DASHSCOPE_BASE_URL,
          apiKey: config.DASHSCOPE_API_KEY,
          model: config.MULTIMODAL_EMBEDDING_MODEL,
          dimension: config.MULTIMODAL_EMBEDDING_DIMENSION,
          outputType: config.MULTIMODAL_EMBEDDING_OUTPUT_TYPE,
        })
      : null;
  }
  return singleton;
}

/** 测试注入。undefined = 回落真实 config。严禁业务代码使用。 */
export function setEmbeddingProvider(p: EmbeddingProvider | null | undefined): void {
  override = p;
}
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/embedding/dashscope-multimodal.test.ts tests/embedding/factory.test.ts tests/embedding/config.test.ts`
Expected: PASS。

若 nock 拦不到 fetch（pending mocks 未消耗、或真实网络错误）：停手报告，附 jest/nock 版本。禁止改 mock fetch。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/embedding/base.provider.ts \
  apps/server/src/embedding/dashscope-multimodal.provider.ts \
  apps/server/src/embedding/factory.ts \
  apps/server/tests/embedding/dashscope-multimodal.test.ts \
  apps/server/tests/embedding/factory.test.ts \
  apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add DashScope multimodal embedding provider"
```

---

### Task 3: `computeEmbedHash` + fingerprint + 组装文本

**Files:**
- Create: `apps/server/src/moments/embed-hash.ts`
- Test: `apps/server/tests/moments/embed-hash.test.ts`

**Interfaces:**
- Consumes: P3 `isCompressibleMime(mime: string): boolean`；`normalizePersonName` 不在本文件调用（调用方先归一化）
- Produces:
  - `export interface EmbedHashInput { content: string; transcript: string | null; personNames: string[]; placeName: string | null; derivedFingerprint: string; model: string; dim: number }`
  - `computeEmbedHash(input: EmbedHashInput): string` — `sha256(content + '\0' + (transcript ?? '') + '\0' + personNames.sort().join('\n') + '\0' + (placeName ?? '') + '\0' + derivedFingerprint + '\0' + model + ':' + dim)`
  - `derivedFingerprintOf(rows: Array<{ id: string; mime: string; sortOrder: number; derivedStatus: string | null; derivedS3Key: string | null }>): string` — 过滤 `isCompressibleMime`，按 `sortOrder` 升序、`id` 升序，行格式 `` `${id}:${derivedStatus ?? 'null'}:${derivedS3Key ?? '-'}` ``，`'\n'` 拼接。无行 → `''`
  - `assembleEmbedText(content: string, transcript: string | null, personNames: string[], placeName: string | null): string` — `[content, transcript ?? '', personNames.slice().sort().join('\n'), placeName ?? ''].join('\n').trim()`；空串表示无文本

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/embed-hash.test.ts`：
```ts
import { createHash } from 'node:crypto';
import {
  assembleEmbedText,
  computeEmbedHash,
  derivedFingerprintOf,
} from '../../src/moments/embed-hash.js';

const base = {
  content: '正文',
  transcript: '转写',
  personNames: ['外婆', '朵朵'],
  placeName: '朝阳公园',
  derivedFingerprint: 'm1:ready:chains/c/m/m1.derived.webp',
  model: 'qwen3-vl-embedding',
  dim: 2560,
};

describe('computeEmbedHash（spec fused-retrieval §2.2）', () => {
  it('与手工 sha256 逐字一致；64 hex；不含 outputType', () => {
    const names = ['外婆', '朵朵'].sort().join('\n');
    const manual = createHash('sha256')
      .update(`正文\0转写\0${names}\0朝阳公园\0${base.derivedFingerprint}\0qwen3-vl-embedding:2560`)
      .digest('hex');
    expect(computeEmbedHash(base)).toBe(manual);
    expect(manual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('personNames 在函数内排序（调用方顺序不影响）', () => {
    expect(computeEmbedHash({ ...base, personNames: ['朵朵', '外婆'] })).toBe(computeEmbedHash(base));
  });

  it('transcript null 与空串同 hash；content/人名/地名/fingerprint/model/dim 变化则变', () => {
    expect(computeEmbedHash({ ...base, transcript: null })).toBe(computeEmbedHash({ ...base, transcript: '' }));
    expect(computeEmbedHash({ ...base, content: '改' })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, personNames: ['外婆'] })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, placeName: null })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, derivedFingerprint: 'x' })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, dim: 1024 })).not.toBe(computeEmbedHash(base));
    expect(computeEmbedHash({ ...base, model: 'other' })).not.toBe(computeEmbedHash(base));
  });
});

describe('derivedFingerprintOf（含 poster 行；GIF 排除；pending/failed 改 hash）', () => {
  const jpeg = (id: string, sortOrder: number, status: string | null, key: string | null) => ({
    id,
    mime: 'image/jpeg',
    sortOrder,
    derivedStatus: status,
    derivedS3Key: key,
  });

  it('按 sortOrder,id；不可压 mime 丢弃', () => {
    const a = jpeg('a-uuid', 1, 'ready', 'ka');
    const b = jpeg('b-uuid', 0, 'pending', null);
    const gif = { id: 'g', mime: 'image/gif', sortOrder: 0, derivedStatus: null, derivedS3Key: null };
    const video = { id: 'v', mime: 'video/mp4', sortOrder: 0, derivedStatus: null, derivedS3Key: null };
    expect(derivedFingerprintOf([a, gif, video, b])).toBe('b-uuid:pending:-\na-uuid:ready:ka');
  });

  it('同 sortOrder 按 id；status null → 字面 null', () => {
    expect(derivedFingerprintOf([jpeg('b', 0, null, null), jpeg('a', 0, 'failed', null)])).toBe(
      'a:failed:-\nb:null:-',
    );
  });
});

describe('assembleEmbedText', () => {
  it('换行拼接后 trim；全空 → 空串', () => {
    expect(assembleEmbedText('正文', '转写', ['朵朵', '外婆'], '公园')).toBe('正文\n转写\n朵朵\n外婆\n公园');
    expect(assembleEmbedText('', null, [], null)).toBe('');
    expect(assembleEmbedText('  hi  ', null, [], null)).toBe('hi');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/embed-hash.test.ts`
Expected: FAIL，`embed-hash.js` 不是模块。

- [ ] **Step 3: 实现 embed-hash.ts**

Create `apps/server/src/moments/embed-hash.ts`：
```ts
import { createHash } from 'node:crypto';
import { isCompressibleMime } from '../media/derived.js';

export interface EmbedHashInput {
  content: string;
  transcript: string | null;
  personNames: string[];
  placeName: string | null;
  derivedFingerprint: string;
  model: string;
  dim: number;
}

export function computeEmbedHash(input: EmbedHashInput): string {
  const names = [...input.personNames].sort().join('\n');
  const raw = `${input.content}\0${input.transcript ?? ''}\0${names}\0${input.placeName ?? ''}\0${input.derivedFingerprint}\0${input.model}:${input.dim}`;
  return createHash('sha256').update(raw).digest('hex');
}

export function derivedFingerprintOf(
  rows: Array<{
    id: string;
    mime: string;
    sortOrder: number;
    derivedStatus: string | null;
    derivedS3Key: string | null;
  }>,
): string {
  return rows
    .filter((r) => isCompressibleMime(r.mime))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((r) => `${r.id}:${r.derivedStatus ?? 'null'}:${r.derivedS3Key ?? '-'}`)
    .join('\n');
}

export function assembleEmbedText(
  content: string,
  transcript: string | null,
  personNames: string[],
  placeName: string | null,
): string {
  return [content, transcript ?? '', [...personNames].sort().join('\n'), placeName ?? ''].join('\n').trim();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/embed-hash.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/moments/embed-hash.ts apps/server/tests/moments/embed-hash.test.ts
git commit -m "feat(server): add computeEmbedHash for multimodal embedding"
```

---

### Task 4: BA HTTP 客户端 + `handleMomentEmbed` + 注册表

**Files:**
- Create: `apps/server/src/embedding/ba-client.ts`
- Create: `apps/server/src/embedding/handle-moment-embed.ts`
- Modify: `apps/server/src/worker/handlers.ts`（import + `handlers['moment.embed']`）
- Test: `apps/server/tests/embedding/ba-client.test.ts`
- Test: `apps/server/tests/worker/handle-moment-embed.test.ts`
- Modify: `apps/server/tests/worker/handlers.test.ts`（九种 → 十种）
- 回归：`apps/server/tests/lancedb/worker-isolation.test.ts`（本 Task **不改** 该文件，跑一遍确认 handler 没把 lancedb 拉进 worker 图）

**Interfaces:**
- Consumes:
  - `config.INTERNAL_API_BASE_URL`（P4）
  - `getBaAuthToken()`（P4）
  - `getEmbeddingProvider` / `NonRetryableEmbeddingError` / `computeEmbedHash` / `derivedFingerprintOf` / `assembleEmbedText`
  - `getStorage().getObject(key, metadata, MAX_IMAGE_BYTES)`
  - `isCompressibleMime`（人名用词典行存储值，偏差 11）
  - P1 `OUTBOX_MOMENT_EMBED` 仅注册，本 Task 不 emit
- Produces:
  - `export const BA_HTTP_TIMEOUT_MS = 10_000`
  - `deleteInternalEmbeddings(momentId: string): Promise<number>` — `DELETE {INTERNAL_API_BASE_URL}/api/internal/embeddings/{momentId}`，`Authorization: Bearer {getBaAuthToken()}`，Abort 10s；2xx JSON `{ deleted: number }`；非 2xx / 网络 / 超时 throw 普通 `Error`（可重试）
  - `upsertInternalEmbedding(body: { momentId: string; chainId: string; kind: 'moment' | 'image'; mediaId?: string; vector: number[]; modelHash: string }): Promise<void>` — `POST {base}/api/internal/embeddings`，同样 Bearer + 10s；2xx `{ ok: true }`
  - `handleMomentEmbed(payload: Record<string, unknown>, _deps?: { push: unknown }): Promise<void>`
  - `handlers['moment.embed'] === handleMomentEmbed`
  - **本文件及 worker import 图不得出现 `@lancedb/lancedb` 或 `src/lancedb/`**

`handleMomentEmbed` 步骤（spec §4.3）：

1. 重读 moment：无/软删 → return（不调 BA）
2. `getEmbeddingProvider()===null` → return（**不写 hash**）
3. `computeEmbedHash === embed_hash` → return（零 DashScope、零 BA）
4. 组装文本：`assembleEmbedText`；空串 = 无文本
5. 图：`derived_status==='ready'` 且 `isCompressibleMime`（**含 poster 行**），按 `sortOrder,id`。每张 `getObject(derivedS3Key, storageMeta, MAX_IMAGE_BYTES)` → `data:image/webp;base64,${buf.toString('base64')}`。`derivedS3Key` 空则跳过该张（不读原图 `s3Key`）。`ObjectTooLargeError` → throw `NonRetryableEmbeddingError('OBJECT_TOO_LARGE')`
6. `await deleteInternalEmbeddings(momentId)`
7. 调用（每次 BA POST 一条）：
   - 有文本且有第一张：`embed({ text, imageDataUri })` → upsert `kind:'moment'`（不传 mediaId）
   - 仅文本：`embed({ text })` → `kind:'moment'`
   - 仅第一张：`embed({ imageDataUri })` → `kind:'moment'`
   - 无文本无图：到此为止，**不写 hash**
   - 其余 ready 图：各 `embed({ imageDataUri })` → `kind:'image', mediaId`
8. 全部 BA 2xx 后 `update moments set embed_hash = hash`
9. 禁止 `update outbox`

- [ ] **Step 1: 写失败测试 — ba-client**

Create `apps/server/tests/embedding/ba-client.test.ts`：
```ts
import nock from 'nock';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import {
  BA_HTTP_TIMEOUT_MS,
  deleteInternalEmbeddings,
  upsertInternalEmbedding,
} from '../../src/embedding/ba-client.js';
import { config } from '../../src/config.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';
const origin = new URL(config.INTERNAL_API_BASE_URL);

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  setBaAuthTokenForTests(undefined);
});

describe('ba-client（spec §6.3 worker fetch，10s abort）', () => {
  it('常量 10s；DELETE/POST 带 Bearer，body 形状锁定', async () => {
    expect(BA_HTTP_TIMEOUT_MS).toBe(10_000);
    setBaAuthTokenForTests('ba-secret');
    const vec = [0.1, 0.2];
    nock(`${origin.protocol}//${origin.host}`)
      .delete(`/api/internal/embeddings/${MOMENT}`)
      .matchHeader('Authorization', 'Bearer ba-secret')
      .reply(200, { deleted: 2 });
    nock(`${origin.protocol}//${origin.host}`)
      .post('/api/internal/embeddings', (body) => {
        expect(body).toEqual({
          momentId: MOMENT,
          chainId: CHAIN,
          kind: 'moment',
          vector: vec,
          modelHash: 'a'.repeat(64),
        });
        expect(body.mediaId).toBeUndefined();
        return true;
      })
      .matchHeader('Authorization', 'Bearer ba-secret')
      .reply(200, { ok: true });

    expect(await deleteInternalEmbeddings(MOMENT)).toBe(2);
    await upsertInternalEmbedding({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: vec,
      modelHash: 'a'.repeat(64),
    });
  });

  it('kind=image 带 mediaId；非 2xx throw（可重试，不是 NonRetryableEmbeddingError）', async () => {
    setBaAuthTokenForTests('t');
    nock(`${origin.protocol}//${origin.host}`)
      .post('/api/internal/embeddings', (body) => {
        expect(body.kind).toBe('image');
        expect(body.mediaId).toBe(MEDIA);
        return true;
      })
      .reply(503, { error: { code: 'DOWN' } });
    await expect(
      upsertInternalEmbedding({
        momentId: MOMENT,
        chainId: CHAIN,
        kind: 'image',
        mediaId: MEDIA,
        vector: [1],
        modelHash: 'b'.repeat(64),
      }),
    ).rejects.toThrow(/BA HTTP 503/);
  });
});
```

- [ ] **Step 2: 写失败测试 — handleMomentEmbed**

Create `apps/server/tests/worker/handle-moment-embed.test.ts`：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import nock from 'nock';
import { eq } from 'drizzle-orm';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { media, moments, momentPersons, outbox, persons } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { NonRetryableEmbeddingError } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { handleMomentEmbed } from '../../src/embedding/handle-moment-embed.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { derivedObjectKey } from '../../src/media/derived.js';
import { computeEmbedHash, derivedFingerprintOf } from '../../src/moments/embed-hash.js';
import { ObjectTooLargeError } from '../../src/storage/bounded-read.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handlers } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const origin = new URL(config.INTERNAL_API_BASE_URL);
const WEBP = Buffer.from('RIFF....WEBP', 'utf8');
const DATA_URI = `data:image/webp;base64,${WEBP.toString('base64')}`;

let storage: MockStorage;
const embedCalls: Array<{ text?: string; imageDataUri?: string }> = [];

function mockProvider(vec = denseVector(0.1)): EmbeddingProvider {
  embedCalls.length = 0;
  return {
    embed: async (req) => {
      embedCalls.push({ text: req.text, imageDataUri: req.imageDataUri });
      return vec;
    },
    modelHash: () => HEX64_A,
    dimensions: () => config.MULTIMODAL_EMBEDDING_DIMENSION,
  };
}

function baNock(opts: { deletes?: number; posts?: number } = {}) {
  const deletes = opts.deletes ?? 1;
  const posts = opts.posts ?? 1;
  setBaAuthTokenForTests('ba-test');
  nock(`${origin.protocol}//${origin.host}`).delete(/\/api\/internal\/embeddings\//).times(deletes).reply(200, { deleted: 0 });
  if (posts > 0) {
    nock(`${origin.protocol}//${origin.host}`).post('/api/internal/embeddings').times(posts).reply(200, { ok: true });
  }
}

async function seedMoment(opts?: {
  content?: string;
  transcript?: string | null;
  placeName?: string | null;
  deletedAt?: Date | null;
  embedHash?: string | null;
}): Promise<{ momentId: string; chainId: string; ownerId: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-29T10:00:00Z'),
    content: opts?.content ?? '第一次翻身',
  });
  await db
    .update(moments)
    .set({
      transcript: opts?.transcript === undefined ? null : opts.transcript,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      deletedAt: opts?.deletedAt ?? null,
      embedHash: opts?.embedHash === undefined ? null : opts.embedHash,
    })
    .where(eq(moments.id, momentId));
  return { momentId, chainId, ownerId: owner.id };
}

async function addReadyImage(opts: {
  momentId: string;
  chainId: string;
  ownerId: string;
  sortOrder: number;
  mediaId?: string;
}): Promise<{ mediaId: string; derivedKey: string }> {
  const mediaId = opts.mediaId ?? randomUUID();
  const derivedKey = derivedObjectKey(opts.chainId, opts.momentId, mediaId);
  await db.insert(media).values({
    id: mediaId,
    momentId: opts.momentId,
    uploaderId: opts.ownerId,
    s3Key: `chains/${opts.chainId}/${opts.momentId}/${mediaId}.jpg`,
    mime: 'image/jpeg',
    size: 2048,
    sortOrder: opts.sortOrder,
    status: 'ready',
    storageMeta: {},
    derivedS3Key: derivedKey,
    derivedMime: 'image/webp',
    derivedSize: 100,
    derivedWidth: 512,
    derivedHeight: 256,
    derivedStatus: 'ready',
  });
  return { mediaId, derivedKey };
}

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  storage.getObject.mockResolvedValue(WEBP);
  setEmbeddingProvider(mockProvider());
  embedCalls.length = 0;
  nock.cleanAll();
  nock.disableNetConnect();
});
afterEach(() => {
  setStorageAdapter(null);
  setEmbeddingProvider(undefined);
  setBaAuthTokenForTests(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});
afterAll(closeDb);

describe('handleMomentEmbed（spec fused-retrieval §4.3）', () => {
  it('vl + 附图：先 DELETE 再两条 POST；读 derived key 不是原图；写 embed_hash；data URI', async () => {
    const { momentId, chainId, ownerId } = await seedMoment({ content: '正文', placeName: '公园' });
    const first = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const extra = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 1, mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const personId = randomUUID();
    await db.insert(persons).values({ id: personId, chainId, name: '外婆' });
    await db.insert(momentPersons).values({ momentId, personId, source: 'manual' });

    const posts: unknown[] = [];
    setBaAuthTokenForTests('ba-test');
    const scope = nock(`${origin.protocol}//${origin.host}`);
    scope.delete(`/api/internal/embeddings/${momentId}`).reply(200, { deleted: 0 });
    scope.post('/api/internal/embeddings', (body) => {
      posts.push(body);
      return true;
    }).times(2).reply(200, { ok: true });

    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });

    expect(storage.getObject).toHaveBeenCalledWith(first.derivedKey, {}, MAX_IMAGE_BYTES);
    expect(storage.getObject).toHaveBeenCalledWith(extra.derivedKey, {}, MAX_IMAGE_BYTES);
    expect(storage.getObject.mock.calls.every((c) => String(c[0]).includes('.derived.webp'))).toBe(true);
    expect(embedCalls[0]).toEqual({ text: expect.stringContaining('正文'), imageDataUri: DATA_URI });
    expect(embedCalls[1]).toEqual({ imageDataUri: DATA_URI });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ momentId, chainId, kind: 'moment', modelHash: HEX64_A });
    expect((posts[0] as { mediaId?: string }).mediaId).toBeUndefined();
    expect(posts[1]).toMatchObject({ kind: 'image', mediaId: extra.mediaId });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    const fp = derivedFingerprintOf([
      { id: first.mediaId, mime: 'image/jpeg', sortOrder: 0, derivedStatus: 'ready', derivedS3Key: first.derivedKey },
      { id: extra.mediaId, mime: 'image/jpeg', sortOrder: 1, derivedStatus: 'ready', derivedS3Key: extra.derivedKey },
    ]);
    expect(m.embedHash).toBe(
      computeEmbedHash({
        content: '正文',
        transcript: null,
        personNames: ['外婆'],
        placeName: '公园',
        derivedFingerprint: fp,
        model: config.MULTIMODAL_EMBEDDING_MODEL,
        dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
      }),
    );
    expect(scope.isDone()).toBe(true);
  });

  it('hash 相同 → 零 getObject 零 BA 零 embed()', async () => {
    const { momentId, chainId } = await seedMoment({ content: 'x' });
    const hash = computeEmbedHash({
      content: 'x',
      transcript: null,
      personNames: [],
      placeName: null,
      derivedFingerprint: '',
      model: config.MULTIMODAL_EMBEDDING_MODEL,
      dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
    });
    await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(embedCalls).toEqual([]);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('getEmbeddingProvider()=null → 跳过且不写 hash', async () => {
    setEmbeddingProvider(null);
    const { momentId, chainId } = await seedMoment();
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(embedCalls).toEqual([]);
  });

  it('软删 / 不存在 → 跳过，不调 BA', async () => {
    await expect(handleMomentEmbed({ momentId: randomUUID(), chainId: randomUUID() }, { push: mockPush })).resolves.toBeUndefined();
    const { momentId, chainId } = await seedMoment({ deletedAt: new Date() });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('无文本无 ready 图：DELETE 一次，不 POST，不写 hash', async () => {
    const { momentId, chainId } = await seedMoment({ content: '' });
    baNock({ deletes: 1, posts: 0 });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(embedCalls).toEqual([]);
  });

  it('failed 图不组装；pending 不在 ready 列表；第一张含 poster（sortOrder,id）', async () => {
    const { momentId, chainId, ownerId } = await seedMoment({ content: 'v' });
    const posterId = '11111111-1111-4111-8111-111111111111';
    const laterId = '22222222-2222-4222-8222-222222222222';
    const failedId = randomUUID();
    await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: laterId });
    const poster = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0, mediaId: posterId });
    await db.insert(media).values({
      id: failedId,
      momentId,
      uploaderId: ownerId,
      s3Key: 'orig.jpg',
      mime: 'image/jpeg',
      size: 10,
      sortOrder: 0,
      status: 'ready',
      storageMeta: {},
      derivedStatus: 'failed',
    });
    baNock({ deletes: 1, posts: 2 });
    await handleMomentEmbed({ momentId, chainId }, { push: mockPush });
    expect(embedCalls[0]!.imageDataUri).toBe(DATA_URI);
    expect(storage.getObject.mock.calls[0]![0]).toBe(poster.derivedKey);
  });

  it('ObjectTooLargeError on derived → NonRetryableEmbeddingError；不改 outbox.status', async () => {
    const { momentId, chainId, ownerId } = await seedMoment();
    const img = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0 });
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(img.derivedKey, MAX_IMAGE_BYTES));
    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'pending',
    });
    await expect(handleMomentEmbed({ momentId, chainId }, { push: mockPush })).rejects.toMatchObject({
      name: 'NonRetryableEmbeddingError',
      message: 'OBJECT_TOO_LARGE',
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.status).toBe('pending');
  });

  it('processor：NonRetryableEmbeddingError 立即 failed + last_error', async () => {
    const { momentId, chainId, ownerId } = await seedMoment();
    const img = await addReadyImage({ momentId, chainId, ownerId, sortOrder: 0 });
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(img.derivedKey, MAX_IMAGE_BYTES));
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'pending',
    });
    const result = await runOutboxBatch({ push: mockPush });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 0, failed: 1 });
    const [ob] = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(ob.status).toBe('failed');
    expect(ob.lastError).toBe('OBJECT_TOO_LARGE');
    expect(ob.attempts).toBe(1);
  });

  it('handlers 登记 moment.embed', () => {
    expect(handlers['moment.embed']).toBe(handleMomentEmbed);
  });
});
```

Modify `apps/server/tests/worker/handlers.test.ts`：顶部追加 `import { handleMomentEmbed } from '../../src/embedding/handle-moment-embed.js';`，把「九种事件」整段换成：
```ts
  it('十种事件均已注册（含 moment.embed）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['recap.generate']).toBe(handleRecapGenerate);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(handlers['moment.geocode']).toBe(handleMomentGeocode);
    expect(handlers['moment.extract']).toBe(handleMomentExtract);
    expect(handlers['moment.compress']).toBe(handleMomentCompress);
    expect(handlers['moment.embed']).toBe(handleMomentEmbed);
    expect(Object.keys(handlers)).toHaveLength(10);
  });
```

P3 落地后该用例标题是「九种事件均已注册（含 moment.compress）」、`Object.keys(handlers)` 长度为 9。本 Task 把它改成上面这一段（10 项）。不要只加 embed 却把 compress 漏掉。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/embedding/ba-client.test.ts tests/worker/handle-moment-embed.test.ts`
Expected: FAIL，`ba-client.js` / `handle-moment-embed.js` 不是模块。

- [ ] **Step 4: 实现 ba-client.ts**

Create `apps/server/src/embedding/ba-client.ts`：
```ts
import { config } from '../config.js';
import { getBaAuthToken } from '../embeddings/ba-auth.js';

export const BA_HTTP_TIMEOUT_MS = 10_000;

function origin(): string {
  return config.INTERNAL_API_BASE_URL.replace(/\/+$/, '');
}

async function baFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BA_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${getBaAuthToken()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === 'AbortError'
        ? `BA request timed out after ${BA_HTTP_TIMEOUT_MS}ms`
        : `BA network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function deleteInternalEmbeddings(momentId: string): Promise<number> {
  const resp = await baFetch(`${origin()}/api/internal/embeddings/${momentId}`, { method: 'DELETE' });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`BA HTTP ${resp.status}`);
  const json = (await resp.json()) as { deleted?: number };
  return typeof json.deleted === 'number' ? json.deleted : 0;
}

export async function upsertInternalEmbedding(body: {
  momentId: string;
  chainId: string;
  kind: 'moment' | 'image';
  mediaId?: string;
  vector: number[];
  modelHash: string;
}): Promise<void> {
  const resp = await baFetch(`${origin()}/api/internal/embeddings`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`BA HTTP ${resp.status}`);
}
```

**禁止** `import` 任何 `../lancedb/` 模块。

- [ ] **Step 5: 实现 handle-moment-embed.ts**

Create `apps/server/src/embedding/handle-moment-embed.ts`：
```ts
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, momentPersons, moments, persons } from '../db/schema.js';
import { isCompressibleMime } from '../media/derived.js';
import { assembleEmbedText, computeEmbedHash, derivedFingerprintOf } from '../moments/embed-hash.js';
import { getStorage } from '../storage/factory.js';
import { NonRetryableEmbeddingError } from './base.provider.js';
import { deleteInternalEmbeddings, upsertInternalEmbedding } from './ba-client.js';
import { getEmbeddingProvider } from './factory.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function dataUri(buf: Buffer): string {
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

/**
 * moment.embed（spec fused-retrieval §4.3）。
 * 禁止改 outbox.status；禁止 import lancedb。
 */
export async function handleMomentEmbed(
  payload: Record<string, unknown>,
  _deps?: { push: unknown },
): Promise<void> {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  const provider = getEmbeddingProvider();
  if (!provider) return;

  const mediaRows = await db.select().from(media).where(eq(media.momentId, momentId));
  const personRows = await db
    .select({ name: persons.name })
    .from(momentPersons)
    .innerJoin(persons, eq(momentPersons.personId, persons.id))
    .where(eq(momentPersons.momentId, momentId));
  const personNames = personRows.map((r) => r.name).filter((n) => n.length > 0);

  const hash = computeEmbedHash({
    content: m.content,
    transcript: m.transcript,
    personNames,
    placeName: m.placeName,
    derivedFingerprint: derivedFingerprintOf(mediaRows),
    model: config.MULTIMODAL_EMBEDDING_MODEL,
    dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
  });
  if (hash === m.embedHash) return;

  const text = assembleEmbedText(m.content, m.transcript, personNames, m.placeName);
  const ready = mediaRows
    .filter((r) => isCompressibleMime(r.mime) && r.derivedStatus === 'ready' && r.derivedS3Key)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const images: Array<{ mediaId: string; uri: string }> = [];
  for (const row of ready) {
    try {
      const buf = await getStorage().getObject(row.derivedS3Key as string, row.storageMeta, MAX_IMAGE_BYTES);
      images.push({ mediaId: row.id, uri: dataUri(buf) });
    } catch (err) {
      if (err instanceof Error && err.name === 'ObjectTooLargeError') {
        throw new NonRetryableEmbeddingError('OBJECT_TOO_LARGE', err);
      }
      throw err;
    }
  }

  await deleteInternalEmbeddings(momentId);

  const first = images[0];
  if (!text && !first) return;

  const modelHash = provider.modelHash();
  if (text && first) {
    const vector = await provider.embed({ text, imageDataUri: first.uri });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  } else if (text) {
    const vector = await provider.embed({ text });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  } else if (first) {
    const vector = await provider.embed({ imageDataUri: first.uri });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  }

  for (const img of images.slice(1)) {
    const vector = await provider.embed({ imageDataUri: img.uri });
    await upsertInternalEmbedding({
      momentId,
      chainId: m.chainId,
      kind: 'image',
      mediaId: img.mediaId,
      vector,
      modelHash,
    });
  }

  await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
}
```

- [ ] **Step 6: 注册 handlers.ts**

Modify `apps/server/src/worker/handlers.ts`：

1. import 区追加：
```ts
import { handleMomentEmbed } from '../embedding/handle-moment-embed.js';
```

2. `export const handlers` 在 `'moment.compress': handleMomentCompress,` 之后追加：
```ts
  'moment.embed': handleMomentEmbed,
```

**不要**从 `handle-moment-embed.ts` import `../lancedb/`。**不要**让 `handlers.ts` import `moment.service`。

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/embedding/ba-client.test.ts tests/worker/handle-moment-embed.test.ts tests/worker/handlers.test.ts tests/lancedb/worker-isolation.test.ts`
Expected: PASS。worker-isolation 仍绿（ba-client / handle-moment-embed / person.service / derived 均不进 `src/lancedb/`）。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/embedding/ba-client.ts \
  apps/server/src/embedding/handle-moment-embed.ts \
  apps/server/src/worker/handlers.ts \
  apps/server/tests/embedding/ba-client.test.ts \
  apps/server/tests/worker/handle-moment-embed.test.ts \
  apps/server/tests/worker/handlers.test.ts
git commit -m "feat(server): handle moment.embed via DashScope and BA HTTP"
```

---

### Task 5: `maybeEmitMomentEmbed` + create/update + compress 终态

**Files:**
- Create: `apps/server/src/moments/embed-outbox.ts`
- Modify: `apps/server/src/moments/moment.service.ts`（create 在 compress emit 之后；update 在 extract emit 之后）
- Modify: `apps/server/src/media/handle-moment-compress.ts`（ready/skipped/failed 写列的同一事务末尾）
- Test: `apps/server/tests/moments/moment-embed-emit.test.ts`
- Modify: `apps/server/tests/worker/handle-moment-compress.test.ts`（补终态 emit / pending 不发 / failed 不阻塞）
- Modify: `apps/server/tests/moments/create-voice-moment.test.ts`（仅 audio：全表 3→4，含 `moment.embed`；两图+audio：仍是 created+extract+transcribe+2 compress，**无 embed**）
- Modify: `apps/server/tests/moments/moment-list-crud.test.ts` 仅当全表 outbox 断言会被 text create 的 embed 打坏时才改（P3 JPEG create 仍无 embed；直插 text 不走 service）

**Interfaces:**
- Consumes: Task 3 hash 函数；P1 `emitOutbox` / `OUTBOX_MOMENT_EMBED` / `DbTx`；P3 `isCompressibleMime`
- Produces:
  - `maybeEmitMomentEmbed(tx: DbTx, momentId: string): Promise<void>`
    1. 重读 moment；无/软删 → return
    2. 若存在 `isCompressibleMime` 且 `derivedStatus==='pending'` 的 media → return
    3. 算 `computeEmbedHash`；`=== embed_hash` → return
    4. `emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId, chainId })`
  - create：无 pending 可压图则 maybeEmit（纯文字 / 仅音频 / GIF-only / 无封面视频会发；JPEG pending 不发）
  - update：同样 maybeEmit（PATCH 不发 compress）
  - compress 在 derived 终态（ready/skipped/failed）写完后 maybeEmit；早退路径不调

- [ ] **Step 1: 写失败测试 — emit 规则**

Create `apps/server/tests/moments/moment-embed-emit.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, outbox } from '../../src/db/schema.js';
import { OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
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
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
  return presigned.body.mediaId as string;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

async function embedJobs() {
  return db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EMBED));
}

describe('create/update emit moment.embed（spec §4.2 / §4.4）', () => {
  it('纯文字：无 pending 可压图 → 同事务 embed {momentId,chainId}', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '第一次翻身',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(res.status).toBe(201);
    const jobs = await embedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ momentId: res.body.id, chainId });
    expect(jobs[0].status).toBe('pending');
  });

  it('JPEG：pending compress → 不发 embed', async () => {
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
    expect((await db.select().from(media).where(eq(media.id, imageId)))[0].derivedStatus).toBe('pending');
    expect(await embedJobs()).toHaveLength(0);
  });

  it('GIF-only：不 pending，发 embed', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const gifId = await readyImage(alice.token, 'image/gif');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [gifId],
    });
    expect(res.status).toBe(201);
    expect(await embedJobs()).toHaveLength(1);
  });

  it('PATCH 正文且无 pending → 再发 embed；同内容在 hash 已写前可重复发（偏差 7）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const created = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '旧',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(created.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '新正文' });
    expect(patched.status).toBe(200);
    expect(await embedJobs()).toHaveLength(2);
  });
});
```

Modify `apps/server/tests/worker/handle-moment-compress.test.ts`：

1. 在 P3 的 `seed` 函数之后追加（P3 `seed` 每次新建 moment，第二张必须手插到同一 `momentId`）：
```ts
async function seedSibling(
  parent: { momentId: string; chainId: string },
  size: number,
): Promise<{ mediaId: string; momentId: string; chainId: string; s3Key: string }> {
  const [row] = await db
    .select({ uploaderId: media.uploaderId })
    .from(media)
    .where(eq(media.momentId, parent.momentId))
    .limit(1);
  const mediaId = randomUUID();
  const s3Key = `chains/${parent.chainId}/${parent.momentId}/${mediaId}.jpeg`;
  await db.insert(media).values({
    id: mediaId,
    momentId: parent.momentId,
    uploaderId: row!.uploaderId,
    s3Key,
    mime: 'image/jpeg',
    size,
    status: 'ready',
    storageMeta: TEST_META,
    derivedStatus: 'pending',
  });
  return { mediaId, momentId: parent.momentId, chainId: parent.chainId, s3Key };
}
```

2. 在 `describe('handleMomentCompress')` 末尾、handlers 登记用例之前追加：
```ts
  it('全部可压图终态 ready → emit moment.embed；仍 pending 则不发', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const a = await seed({ size: jpeg.length });
    const b = await seedSibling(a, jpeg.length);
    storage.getObject.mockResolvedValue(jpeg);

    await handleMomentCompress({ momentId: a.momentId, chainId: a.chainId, mediaId: a.mediaId }, { push: mockPush });
    expect(await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).toHaveLength(0);

    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId: b.momentId, chainId: b.chainId, mediaId: b.mediaId }, { push: mockPush });
    const embeds = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(embeds).toHaveLength(1);
    expect(embeds[0].payload).toEqual({ momentId: a.momentId, chainId: a.chainId });
  });

  it('一张 failed、其余 ready：仍 emit embed（failed 不阻塞）', async () => {
    const jpeg = await jpegOf(2000, 1000);
    const ready = await seed({ size: jpeg.length });
    const fail = await seedSibling(ready, 1024);
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress(
      { momentId: ready.momentId, chainId: ready.chainId, mediaId: ready.mediaId },
      { push: mockPush },
    );
    storage.getObject.mockRejectedValue(new ObjectTooLargeError(fail.s3Key, MAX_IMAGE_BYTES));
    await expect(
      handleMomentCompress({ momentId: fail.momentId, chainId: fail.chainId, mediaId: fail.mediaId }, { push: mockPush }),
    ).rejects.toMatchObject({ name: 'NonRetryableCompressError' });
    const embeds = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
    expect(embeds).toHaveLength(1);
    expect((await derivedCols(fail.mediaId)).derivedStatus).toBe('failed');
  });

  it('skipped 终态同样可触发 embed', async () => {
    const jpeg = await jpegOf(64, 48);
    const row = await seed({ size: 1 });
    storage.getObject.mockResolvedValue(jpeg);
    await handleMomentCompress({ momentId: row.momentId, chainId: row.chainId, mediaId: row.mediaId }, { push: mockPush });
    expect((await derivedCols(row.mediaId)).derivedStatus).toBe('skipped');
    expect(await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'))).toHaveLength(1);
  });
```

Modify `apps/server/tests/moments/create-voice-moment.test.ts`：

- 「1 audio + 2 JPEG」成功用例（P3 已是 5 行：created+extract+transcribe+2 compress）：保持 length 5，types **不含** `moment.embed`（JPEG 仍 pending）。
```ts
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.type).sort()).toEqual(
      ['moment.compress', 'moment.compress', 'moment.created', 'moment.extract', 'moment.transcribe'].sort(),
    );
```
- 「仅 audio 无附图」用例追加：
```ts
    const events = await db.select().from(outbox);
    expect(events.map((e) => e.type).sort()).toEqual(
      ['moment.created', 'moment.embed', 'moment.extract', 'moment.transcribe'].sort(),
    );
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-embed-emit.test.ts tests/worker/handle-moment-compress.test.ts tests/moments/create-voice-moment.test.ts`
Expected: FAIL。纯文字 create 0 条 embed；compress ready 后仍 0 条；仅 audio 缺 `moment.embed`。

- [ ] **Step 3: 实现 embed-outbox.ts**

Create `apps/server/src/moments/embed-outbox.ts`：
```ts
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { media, momentPersons, moments, persons } from '../db/schema.js';
import { isCompressibleMime } from '../media/derived.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { computeEmbedHash, derivedFingerprintOf } from './embed-hash.js';

export async function maybeEmitMomentEmbed(tx: DbTx, momentId: string): Promise<void> {
  const [m] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  const mediaRows = await tx.select().from(media).where(eq(media.momentId, momentId));
  const pending = mediaRows.some((r) => isCompressibleMime(r.mime) && r.derivedStatus === 'pending');
  if (pending) return;

  const personRows = await tx
    .select({ name: persons.name })
    .from(momentPersons)
    .innerJoin(persons, eq(momentPersons.personId, persons.id))
    .where(eq(momentPersons.momentId, momentId));
  const personNames = personRows.map((r) => r.name).filter((n) => n.length > 0);
  const hash = computeEmbedHash({
    content: m.content,
    transcript: m.transcript,
    personNames,
    placeName: m.placeName,
    derivedFingerprint: derivedFingerprintOf(mediaRows),
    model: config.MULTIMODAL_EMBEDDING_MODEL,
    dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
  });
  if (hash === m.embedHash) return;

  await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId, chainId: m.chainId });
}
```

本文件 **禁止** import `../lancedb/`。

- [ ] **Step 4: create / update 调 maybeEmit**

Modify `apps/server/src/moments/moment.service.ts`：

1. import：
```ts
import { maybeEmitMomentEmbed } from './embed-outbox.js';
```

2. `create` 事务内，在 `emitOutbox(..., OUTBOX_MOMENT_EXTRACT, ...)` **之后**：
```ts
      await maybeEmitMomentEmbed(tx, momentId);
```
（此时可压图已 `pending`+compress emit，maybeEmit 会因 pending 直接 return。）

3. `update` 事务内，在 extract 的 hash 判断 / emit **之后**：
```ts
      await maybeEmitMomentEmbed(tx, momentId);
```

- [ ] **Step 5: compress 终态 emit**

Modify `apps/server/src/media/handle-moment-compress.ts`：

1. import：
```ts
import { maybeEmitMomentEmbed } from '../moments/embed-outbox.js';
```
2. 把 P3 的 `markDerivedFailed(mediaId)` 改成带 `momentId` 的事务（**ObjectTooLarge 与 SHARP_DECODE_FAILED 两个 call site 都走这里**，禁止只包 ObjectTooLarge）：
```ts
async function markDerivedFailed(mediaId: string, momentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
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
    await maybeEmitMomentEmbed(tx, momentId);
  });
}
```
两个 call site 都改成 `await markDerivedFailed(row.id, m.id)`，然后照旧 throw（processor 仍把**本条 compress**标 failed；新 embed 行保持 pending）。
3. 把 **skipped / ready** 写列路径包进 `db.transaction`，事务末尾 `await maybeEmitMomentEmbed(tx, m.id)`。`uploadFile` **留在事务外**（ready：先 upload，成功后再开事务写列 + maybeEmit）。
4. GIF/HEIC/缺失/软删早退：**不要** maybeEmit。
5. upload 失败仍在 pending 时 throw：不要 maybeEmit。

skipped 路径：
```ts
  if (out.buffer.length >= row.size) {
    await db.transaction(async (tx) => {
      await tx
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
      await maybeEmitMomentEmbed(tx, m.id);
    });
    return;
  }
```

ready 路径（upload 成功之后）：
```ts
  const key = derivedObjectKey(m.chainId, m.id, row.id);
  await getStorage().uploadFile(key, out.buffer);
  await db.transaction(async (tx) => {
    await tx
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
    await maybeEmitMomentEmbed(tx, m.id);
  });
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-embed-emit.test.ts tests/worker/handle-moment-compress.test.ts tests/moments/create-voice-moment.test.ts tests/moments/moment-compress-emit.test.ts tests/moments/moment-list-crud.test.ts tests/lancedb/worker-isolation.test.ts`
Expected: PASS。`moment-list-crud` 删链全表 outbox 仍是 JPEG create 的 `moment.created` + `moment.extract` + `moment.compress`（无 embed；直插 text 不走 service）。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/moments/embed-outbox.ts \
  apps/server/src/moments/moment.service.ts \
  apps/server/src/media/handle-moment-compress.ts \
  apps/server/tests/moments/moment-embed-emit.test.ts \
  apps/server/tests/worker/handle-moment-compress.test.ts \
  apps/server/tests/moments/create-voice-moment.test.ts \
  apps/server/tests/moments/moment-list-crud.test.ts
git commit -m "feat(server): emit moment.embed after create/update/compress terminal"
```

---

### Task 6: extract / geocode / transcribe / person 改名与删除

**Files:**
- Modify: `apps/server/src/llm/extract/persist.ts`（写 `aiExtractHash` 之后 `maybeEmitMomentEmbed`）
- Modify: `apps/server/src/worker/handlers.ts`（`handleMomentGeocode` 成功回填；`handleMomentTranscribe` 成功事务内，**CAS `affectedRows===0` 早退之后**）
- Modify: `apps/server/src/persons/person.service.ts`（rename 真改名；remove 先查 momentId）
- Test: `apps/server/tests/worker/moment-embed-triggers.test.ts`
- Test: `apps/server/tests/persons/person-embed-emit.test.ts`
- Modify: `apps/server/tests/worker/handle-moment-extract.test.ts`（转写全链路 `runOutboxBatch().done`：transcribe 现同事务再发 embed，claimed 2）
- Modify: `apps/server/tests/people-place/people-place-e2e.test.ts`（`setEmbeddingProvider(null)`；drain 到 pending=0）
- Modify: `apps/server/tests/people-place/people-place-pipeline-e2e.test.ts`（`setEmbeddingProvider(null)`，避免默认 handlers 打真 DashScope/BA）

**Interfaces:**
- Consumes: Task 5 `maybeEmitMomentEmbed(tx, momentId)`
- Produces:
  - `persistExtraction` 成功路径同事务 maybeEmit（persons/place 变化改 hash）
  - geocode：条件 UPDATE 影响到行后，同事务 maybeEmit；`raw===null` / 守卫失败不发
  - transcribe：回填成功的**同一事务**内，在 extract emit 之后 maybeEmit（空 LLM 跳过 extract 时 transcript 仍进向量）
  - `PersonService.rename`：归一化后同名幂等 **不发**；名字确实变化 → 查该 `person_id` 全部 `momentId`（`moment_persons`），同一事务逐条 maybeEmit
  - `PersonService.remove`：**先** `select momentId from moment_persons where person_id=?`，再删关联+词典，再对查出的 id maybeEmit

- [ ] **Step 1: 写失败测试 — worker 触发**

Create `apps/server/tests/worker/moment-embed-triggers.test.ts`：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, moments, outbox, users } from '../../src/db/schema.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { handleMomentExtract, handleMomentGeocode, handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
let storage: MockStorage;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setGeocodeProvider(undefined);
  setASRProvider(undefined);
});
afterAll(closeDb);

async function embedCount(momentId: string): Promise<number> {
  const rows = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
  return rows.filter((r) => (r.payload as { momentId?: string }).momentId === momentId).length;
}

describe('extract/geocode/transcribe 触发 embed（spec §4.4）', () => {
  it('persistExtraction 成功 → 同事务 embed（人名进 hash）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '今天带朵朵去外婆家',
    });
    setLLMProvider({
      chat: async () => ({
        content: '{"persons":["朵朵","外婆"],"places":[]}',
        model: 'm',
        usage: { prompt: 1, completion: 1, total: 2 },
      }),
    } as unknown as LLMProvider);
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await embedCount(momentId)).toBe(1);
  });

  it('geocode 回填 place_name 成功 → embed；null 地址不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await db
      .update(moments)
      .set({ placeLat: 39.9, placeLng: 116.4, placeName: null, placeSource: 'exif' })
      .where(eq(moments.id, momentId));
    setGeocodeProvider({ reverse: async () => '天安门' } as GeocodeProvider);
    await handleMomentGeocode({ momentId }, { push: mockPush });
    expect(await embedCount(momentId)).toBe(1);

    const other = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await db
      .update(moments)
      .set({ placeLat: 1, placeLng: 2, placeName: null, placeSource: 'exif' })
      .where(eq(moments.id, other));
    setGeocodeProvider({ reverse: async () => null } as GeocodeProvider);
    await handleMomentGeocode({ momentId: other }, { push: mockPush });
    expect(await embedCount(other)).toBe(0);
  });

  it('transcribe 成功且 hash 变 → 同事务直接 embed（不依赖 extract）', async () => {
    // seed 对齐 tests/worker/handle-moment-transcribe.test.ts 的 insertVoice + stubAudioDownload
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
    const chainId = randomUUID();
    await db.insert(chains).values({
      id: chainId,
      name: 'c',
      ownerId: userId,
      visibility: 'private',
      template: 'daily',
    });
    const momentId = randomUUID();
    const happenedAt = new Date('2026-08-23T02:00:00Z');
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: userId,
      type: 'voice',
      content: '',
      happenedAt,
      happenedTzOffset: 0,
      wallDate: wallDateOf(happenedAt, 0),
      transcriptionStatus: 'pending',
    });
    const audioId = randomUUID();
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
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setLLMProvider(null);
    setASRProvider({ transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) } as unknown as ASRProvider);
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcriptionStatus).toBe('done');
    expect(await embedCount(momentId)).toBe(1);
  });
});
```

- [ ] **Step 2: 写失败测试 — person**

Create `apps/server/tests/persons/person-embed-emit.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachPerson, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function embedsFor(momentId: string) {
  const rows = await db.select().from(outbox).where(eq(outbox.type, 'moment.embed'));
  return rows.filter((r) => (r.payload as { momentId?: string }).momentId === momentId);
}

describe('PATCH/DELETE person 触发 embed（spec §4.4）', () => {
  it('改名成功 → 该 person 关联的每个 moment 一条 embed；同名幂等不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(m1, created.body.id);
    await attachPerson(m2, created.body.id);

    const renamed = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: '姥姥' });
    expect(renamed.status).toBe(200);
    expect(await embedsFor(m1)).toHaveLength(1);
    expect(await embedsFor(m2)).toHaveLength(1);

    const noop = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(noop.status).toBe(200);
    expect(await embedsFor(m1)).toHaveLength(1);
  });

  it('DELETE：先能查出 momentId（删关联前），再 emit；时刻本体仍在', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, editor.id, 'editor');
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(editor.token));
    expect(res.status).toBe(204);
    expect(await embedsFor(momentId)).toHaveLength(1);
  });
});
```

Modify `apps/server/tests/worker/handle-moment-extract.test.ts`：

1. import 追加 `import { setEmbeddingProvider } from '../../src/embedding/factory.js';`。`beforeEach` 在 `installMockStorage()` 之后 `setEmbeddingProvider(null);`，`afterEach` 加 `setEmbeddingProvider(undefined);`（默认 handlers 跑 extract 时会顺带 claim 新 embed 行；null provider 让 handler 跳过，不打 DashScope/BA）。
2. 用例「transcribe 回填 → extract 全链路」（约 L432–433）。`handleMomentTranscribe` 直调后会同时留下 `moment.extract` + `moment.embed`，随后 `runOutboxBatch` 一次 claim 两行：
```ts
    const result = await runOutboxBatch({ push: mockPush });
    expect(result.done).toBe(2); // extract + transcribe 同事务补发的 embed（null provider → handler 跳过仍 done）
    expect(result.failed).toBe(0);
```
（实现前 done 仍是 1，本步红灯。`emitExtractRow` 那条「已注册分发 done===1」仍成立：persist 新插的 embed 不在本批 claim 里。）

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/moment-embed-triggers.test.ts tests/persons/person-embed-emit.test.ts tests/worker/handle-moment-extract.test.ts`
Expected: FAIL。extract/geocode/transcribe/rename/delete 后 embed 计数 0；转写全链路 `done` 仍是 1 不是 2。

- [ ] **Step 4: persistExtraction 末尾 emit**

Modify `apps/server/src/llm/extract/persist.ts`：文件顶部追加
```ts
import { maybeEmitMomentEmbed } from '../../moments/embed-outbox.js';
```
（`persist.ts` 现网已 `import { normalizePersonName } from '../../persons/person.service.js'`；embed-outbox **禁止** import `person.service`，否则 `person.service → embed-outbox → person.service` 环。）

在 `await tx.update(moments).set({ aiExtractHash: extractHash })` **之后**：
```ts
  await maybeEmitMomentEmbed(tx, moment.id);
```

- [ ] **Step 5: geocode 成功路径**

Modify `apps/server/src/worker/handlers.ts` 的 `handleMomentGeocode` 步骤 5：把单独 `db.update` 换成事务（只有 `affectedRows > 0` 才 maybeEmit）：
```ts
  const name = raw.slice(0, PLACE_NAME_MAX_CHARS);
  await db.transaction(async (tx) => {
    const [result] = await tx
      .update(moments)
      .set({ placeName: name })
      .where(
        and(
          eq(moments.id, momentId),
          isNull(moments.deletedAt),
          eq(moments.placeSource, 'exif'),
          isNull(moments.placeName),
        ),
      );
    if (result.affectedRows === 0) return;
    await maybeEmitMomentEmbed(tx, momentId);
  });
```

文件顶部追加 `import { maybeEmitMomentEmbed } from '../moments/embed-outbox.js';`。

- [ ] **Step 6: transcribe 成功事务内 emit**

同一文件 `handleMomentTranscribe` 成功 `db.transaction`。`maybeEmit` 必须在 `affectedRows === 0` 早退 **之后**、与 extract emit 同一事务（CAS 没抢到 pending 则既不 extract 也不 embed）。把事务尾改成：
```ts
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(moments)
        .set({ transcript: truncated, transcriptionStatus: 'done' })
        .where(
          and(
            eq(moments.id, momentId),
            isNull(moments.deletedAt),
            eq(moments.type, 'voice'),
            eq(moments.transcriptionStatus, 'pending'),
          ),
        );
      if (result.affectedRows === 0) return;
      await tx
        .update(moments)
        .set({ content: truncated })
        .where(and(eq(moments.id, momentId), eq(moments.content, '')));
      const [cur] = await tx
        .select({ content: moments.content, transcript: moments.transcript, aiExtractHash: moments.aiExtractHash })
        .from(moments)
        .where(eq(moments.id, momentId))
        .limit(1);
      if (cur && computeAiExtractHash(cur.content, cur.transcript) !== cur.aiExtractHash) {
        await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId });
      }
      await maybeEmitMomentEmbed(tx, momentId);
    });
```
（extract 因空 LLM 跳过、本 handler 仍发出 embed：transcript 必须进向量。不要把 maybeEmit 放在 `if (result.affectedRows === 0) return` 之前或事务外。）

- [ ] **Step 7: PersonService.rename / remove**

Modify `apps/server/src/persons/person.service.ts`：

import：
```ts
import { emitOutbox } 不需要；用 maybeEmitMomentEmbed
import { maybeEmitMomentEmbed } from '../moments/embed-outbox.js';
```

`rename`：在 `if (person.name === name) return toResponse(person);` 之后的更新，包进事务：
```ts
    await db.transaction(async (tx) => {
      try {
        await tx.update(persons).set({ name }).where(eq(persons.id, personId));
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'PERSON_NAME_CONFLICT');
        throw err;
      }
      const links = await tx
        .select({ momentId: momentPersons.momentId })
        .from(momentPersons)
        .where(eq(momentPersons.personId, personId));
      for (const row of links) {
        await maybeEmitMomentEmbed(tx, row.momentId);
      }
    });
    return { id: person.id, name, userId: person.userId };
```
保留更新前的 409 查重。`person.name === name` 早退必须在事务外，保证同名零 embed。

`remove`：
```ts
    await db.transaction(async (tx) => {
      const links = await tx
        .select({ momentId: momentPersons.momentId })
        .from(momentPersons)
        .where(eq(momentPersons.personId, personId));
      await tx.delete(momentPersons).where(eq(momentPersons.personId, personId));
      await tx.delete(persons).where(eq(persons.id, personId));
      for (const row of links) {
        await maybeEmitMomentEmbed(tx, row.momentId);
      }
    });
```
**禁止**先 delete 再 select（测例专抓这个顺序）。

- [ ] **Step 8: 既有 e2e drain + 隔离 embedding**

geocode/extract/transcribe 在 **正在被消费的那批之后** 再插 `moment.embed`（claim 已结束，偏差 7 不去重）。`people-place-e2e` 现网 `expect(pending).toHaveLength(0)` 只跑一轮 `runOutboxBatch`，T6 之后会剩 embed 行。默认 handlers 若测试库配了真 `DASHSCOPE_API_KEY` 还会打 DashScope/BA。

Modify `apps/server/tests/people-place/people-place-e2e.test.ts`：

1. import 追加：
```ts
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
```
2. `beforeEach` / `afterEach`：
```ts
beforeEach(async () => {
  await resetDb();
  setEmbeddingProvider(null);
});
afterEach(() => {
  setGeocodeProvider(undefined);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
});
```
3. 把「outbox 全部终态」那轮改成排空（`failed` 必须全程 0）：
```ts
    setEmbeddingProvider(null);
    let batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(3); // moment.created + moment.geocode + moment.extract（+ create 的 embed）
    expect(batch.failed).toBe(0);
    // geocode/extract 同事务新插的 moment.embed 不在本批 claim 里
    do {
      batch = await runOutboxBatch({ push: mockPush });
      expect(batch.failed).toBe(0);
    } while (batch.claimed > 0);

    const pending = await db.select().from(outbox).where(eq(outbox.status, 'pending'));
    expect(pending).toHaveLength(0);
```

Modify `apps/server/tests/people-place/people-place-pipeline-e2e.test.ts`：同样 `import { setEmbeddingProvider }`，`beforeEach` 在 `resetDb` 之后 `setEmbeddingProvider(null)`，`afterEach` 加 `setEmbeddingProvider(undefined)`。`first.done` / `second.done` 的 `toBeGreaterThanOrEqual` 不用改。

不要把 `setEmbeddingProvider(null)` 写进 `persist.ts` / handlers 业务路径。

- [ ] **Step 9: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/moment-embed-triggers.test.ts tests/persons/person-embed-emit.test.ts tests/worker/handle-moment-extract.test.ts tests/worker/handle-moment-geocode.test.ts tests/worker/handle-moment-transcribe.test.ts tests/persons/persons.test.ts tests/people-place/people-place-e2e.test.ts tests/people-place/people-place-pipeline-e2e.test.ts tests/lancedb/worker-isolation.test.ts`
Expected: PASS。既有 extract/geocode/transcribe/persons 语义不变，只是多了 embed 行（按 type 过滤的旧断言不受影响）。转写全链路 `done===2`。e2e drain 后 pending=0。worker-isolation 仍绿（`person.service` 只 import `embed-outbox`，不进 lancedb）。

若 transcribe 测例因缺 audio 行 / fetch mock 红：对齐 `tests/worker/handle-moment-transcribe.test.ts` 的 seed（含 `MAX_AUDIO_BYTES` 有界下载），不要放宽断言。

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/llm/extract/persist.ts \
  apps/server/src/worker/handlers.ts \
  apps/server/src/persons/person.service.ts \
  apps/server/tests/worker/moment-embed-triggers.test.ts \
  apps/server/tests/persons/person-embed-emit.test.ts \
  apps/server/tests/worker/handle-moment-extract.test.ts \
  apps/server/tests/people-place/people-place-e2e.test.ts \
  apps/server/tests/people-place/people-place-pipeline-e2e.test.ts
git commit -m "feat(server): emit moment.embed from extract, geocode, transcribe, and persons"
```

---

### Task 7: 时刻软删 / 链删除清 Lance（server 直连 repository）

**Files:**
- Modify: `apps/server/src/lancedb/repository.ts`（追加 `deleteVectorsByChainId`）
- Modify: `apps/server/tests/lancedb/repository.test.ts`（chainId 删除 + 非 uuid）
- Modify: `apps/server/src/moments/moment.service.ts`（`remove` 事务提交之后）
- Modify: `apps/server/src/chains/chain.service.ts`（`remove` 事务提交之后）
- Test: `apps/server/tests/lancedb/lifecycle-cleanup.test.ts`

**Interfaces:**
- Consumes: P4 `deleteVectorsByMomentId` / `upsertMomentVector` / `listVectorsByMomentId` / `lanceEqUuid` / `ensureLance` / `resetLanceForTests` / `denseVector` / `HEX64_A`
- Produces:
  - `deleteVectorsByChainId(chainId: string): Promise<number>` — 非 uuid：`logger.warn('lancedb delete ignored non-uuid chainId')` 并 return 0；否则删该 `chainId` 全部 kind，返回删除前行数
  - `MomentService.remove`：MySQL 软删事务 **commit 成功后** `deleteVectorsByMomentId(momentId)`，catch 后 `logger.warn('lancedb delete after moment soft-delete failed', err)`，不 rethrow
  - `ChainService.remove`：MySQL 硬删事务 **commit 成功后** `deleteVectorsByChainId(chainId)`，catch 后 `logger.warn('lancedb delete after chain delete failed', err)`，不 rethrow
  - **不要**把这两处调用放进 `handleMomentDeleted`（那会把 lancedb 拉进 worker 图）

- [ ] **Step 1: 写失败测试 — repository + HTTP 生命周期**

Modify `apps/server/tests/lancedb/repository.test.ts`：import 追加 `deleteVectorsByChainId`，describe 末尾追加：
```ts
  it('deleteVectorsByChainId 清该链全部 kind；非 uuid 返回 0', async () => {
    const m2 = '123e4567-e89b-12d3-a456-426614174099';
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: m2,
      chainId: CHAIN,
      kind: 'image',
      mediaId: MEDIA,
      vector: denseVector(0.2),
      modelHash: HEX64_A,
    });
    expect(await deleteVectorsByChainId(CHAIN)).toBe(2);
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);
    expect(await listVectorsByMomentId(m2)).toEqual([]);
    expect(await deleteVectorsByChainId("x' OR 1=1")).toBe(0);
  });
```

Create `apps/server/tests/lancedb/lifecycle-cleanup.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import { listVectorsByMomentId, upsertMomentVector } from '../../src/lancedb/repository.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';
import { insertMoment } from '../helpers/fixtures.js';

const app = listenLocal(createApp());

beforeAll(async () => {
  await ensureLance();
});
beforeEach(async () => {
  await resetDb();
  await resetLanceForTests();
});
afterAll(async () => {
  await closeLanceForTests();
  await closeDb();
});

describe('软删 / 链删清 Lance（spec §1；server 直连，不经 BA）', () => {
  it('DELETE /api/moments/:id 提交后该 momentId 向量为空', async () => {
    const alice = await createUser(app, 'alice');
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment({
      chainId,
      authorId: alice.id,
      happenedAt: new Date(),
      content: '待删',
    });
    await upsertMomentVector({
      momentId,
      chainId,
      kind: 'moment',
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    expect(await listVectorsByMomentId(momentId)).toHaveLength(1);

    const res = await request(app).delete(`/api/moments/${momentId}`).set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(await listVectorsByMomentId(momentId)).toEqual([]);
  });

  it('DELETE /api/chains/:id 提交后该 chain 下向量为空', async () => {
    const alice = await createUser(app, 'alice-chain');
    const chainId = await createChainWithMembers(alice.id);
    const momentId = await insertMoment({
      chainId,
      authorId: alice.id,
      happenedAt: new Date(),
      content: '链内',
    });
    await upsertMomentVector({
      momentId,
      chainId,
      kind: 'moment',
      vector: denseVector(0.4),
      modelHash: HEX64_A,
    });

    const res = await request(app).delete(`/api/chains/${chainId}`).set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(await listVectorsByMomentId(momentId)).toEqual([]);
  });
});
```

`createUser` 的 nickname/email 若要求唯一，用随机后缀（对齐 `helpers/auth.ts` 现网）。`insertMoment` 需要的 `authorId` 必须是链 owner。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/repository.test.ts tests/lancedb/lifecycle-cleanup.test.ts`
Expected: FAIL。`deleteVectorsByChainId` 不是 export；HTTP 软删后 `listVectorsByMomentId` 仍 1 条。

- [ ] **Step 3: repository 追加 deleteVectorsByChainId**

在 `apps/server/src/lancedb/repository.ts` 追加（与 `deleteVectorsByMomentId` 同构，列名 `chainId`）：
```ts
export async function listVectorsByChainId(chainId: string): Promise<MomentVectorRow[]> {
  const pred = lanceEqUuid('chainId', chainId);
  if (!pred) return [];
  const table = getLanceTable();
  const q = table as unknown as { query: () => { where: (p: string) => { toArray: () => Promise<unknown[]> } } };
  const raw = await q.query().where(pred).toArray();
  return raw as MomentVectorRow[];
}

export async function deleteVectorsByChainId(chainId: string): Promise<number> {
  const pred = lanceEqUuid('chainId', chainId);
  if (!pred) {
    logger.warn('lancedb delete ignored non-uuid chainId');
    return 0;
  }
  const existing = await listVectorsByChainId(chainId);
  const n = existing.length;
  if (n === 0) return 0;
  await getLanceTable().delete(pred);
  return n;
}
```

锁定 `query().where().toArray()`，禁止 `.search()`。

- [ ] **Step 4: MomentService.remove 之后清 Lance**

Modify `apps/server/src/moments/moment.service.ts`：

import：
```ts
import { deleteVectorsByMomentId } from '../lancedb/repository.js';
```

`remove` 的 `await db.transaction(...)` **之后**（成功才执行）：
```ts
    try {
      await deleteVectorsByMomentId(momentId);
    } catch (err) {
      logger.warn('lancedb delete after moment soft-delete failed', err);
    }
```

幂等软删早退（`if (m.deletedAt) return;`）不要再删 Lance。

- [ ] **Step 5: ChainService.remove 之后清 Lance**

Modify `apps/server/src/chains/chain.service.ts`：

import：
```ts
import { deleteVectorsByChainId } from '../lancedb/repository.js';
import { logger } from '../utils/logger.js';
```
（若已有 logger 则不重复。）

`remove` 的 `await db.transaction(...)` **之后**：
```ts
    try {
      await deleteVectorsByChainId(chainId);
    } catch (err) {
      logger.warn('lancedb delete after chain delete failed', err);
    }
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/repository.test.ts tests/lancedb/lifecycle-cleanup.test.ts tests/lancedb/worker-isolation.test.ts tests/moments/moment-list-crud.test.ts tests/health.test.ts`
Expected: PASS。

- worker-isolation **必须仍绿**：`moment.service` / `chain.service` 虽 import `src/lancedb/repository.js`，但 worker 入口相对图 **不经过** 这两个 service。
- `moment-list-crud` 软删/删链不 `ensureLance`：`deleteVectorsByMomentId` 会因 `LANCE_NOT_READY` throw，被 warn 吃掉，HTTP 仍 204。
- `health.test.ts`：`createApp()` 仍不 connect Lance。

- [ ] **Step 7: lint / typecheck / 回归**

Run:
```bash
pnpm --filter @moment/server test -- tests/embedding tests/worker/handle-moment-embed.test.ts tests/worker/handle-moment-compress.test.ts tests/worker/moment-embed-triggers.test.ts tests/worker/handlers.test.ts tests/worker/handle-moment-extract.test.ts tests/moments/embed-hash.test.ts tests/moments/moment-embed-emit.test.ts tests/persons/person-embed-emit.test.ts tests/people-place/people-place-e2e.test.ts tests/people-place/people-place-pipeline-e2e.test.ts tests/lancedb tests/health.test.ts
pnpm --filter @moment/server lint && pnpm --filter @moment/server typecheck
```
Expected: 全绿 / exit 0。不要跑会打生产库的命令。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/lancedb/repository.ts \
  apps/server/tests/lancedb/repository.test.ts \
  apps/server/src/moments/moment.service.ts \
  apps/server/src/chains/chain.service.ts \
  apps/server/tests/lancedb/lifecycle-cleanup.test.ts
git commit -m "feat(server): delete Lance vectors on moment soft-delete and chain delete"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test -- tests/embedding tests/moments/embed-hash.test.ts tests/moments/moment-embed-emit.test.ts tests/worker/handle-moment-embed.test.ts tests/worker/handle-moment-compress.test.ts tests/worker/moment-embed-triggers.test.ts tests/worker/handlers.test.ts tests/worker/handle-moment-extract.test.ts tests/persons/person-embed-emit.test.ts tests/people-place/people-place-e2e.test.ts tests/people-place/people-place-pipeline-e2e.test.ts tests/lancedb tests/health.test.ts` 全绿
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] nock 钉死：text-only / image-only **无** `enable_fusion`；vl 的 `enable_fusion` 在 **`parameters` 内**；图字段是 `data:image/webp;base64,...`
- [ ] `getEmbeddingProvider` 空 key 或 ENABLED=false → null；不回退 `ASR_API_KEY`
- [ ] `computeEmbedHash` 公式含 fingerprint 与 `model:dim`，不含 outputType
- [ ] `handleMomentEmbed`：hash 二刷零 API；软删跳过；空 provider 不写 hash；读 derived key 不读原图；无文本无图只 DELETE 不写 hash；handler 不改 `outbox.status`；`NonRetryableEmbeddingError.name === 'NonRetryableEmbeddingError'`
- [ ] worker 只 HTTP BA，`tests/lancedb/worker-isolation.test.ts` 绿
- [ ] 无 pending 可压图才 emit；compress failed 不阻塞；第一张含 poster，`sortOrder,id`
- [ ] transcribe 成功 + hash 变 → 同事务 embed；person DELETE 先查 momentId 再删再 emit
- [ ] 软删/链删 server 清 Lance；`createApp()` 仍不 connect
- [ ] **未**泄漏 P6–P10：无 `POST /api/search`、无 `VECTOR_CANDIDATE_LIMIT`、无 ANN `.search()`、无 jobs HTTP、无 api-client/web/app、无 `backfill:embed`
- [ ] 未覆盖 `apps/server/.env`；未重加 `MULTIMODAL_EMBEDDING_DIMENSION`

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P5）**：§4.1 provider + env；§2.2 hash；§4.3 handler + data URI + BA HTTP；§4.2 步骤 7 compress 终态 emit；§4.4 全部触发；§1 软删/链删清向量；§2.3 不改 outbox.status + NonRetryableEmbeddingError；§8 仅 embed 读 derived；§9 embed 测试；§11 P5 出口。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：T1 env 被 T2 factory 与 T3/T5 hash 消费；T2 `NonRetryableEmbeddingError.name` 与 P1 processor 集合逐字相同；T4 BA body 与 P4 `embeddingUpsertSchema` 字段一致；T5 `maybeEmitMomentEmbed` 被 T6 逐字调用；T6 改 `handle-moment-extract` 转写全链路 `done===2` 与 `people-place-e2e` drain；T7 `deleteVectorsByChainId` 与 P4 `lanceEqUuid` 同形。
- **worker isolation**：T4/T5/T6 不 import `src/lancedb`；T7 只在 `moment.service` / `chain.service`（server HTTP）import repository。
