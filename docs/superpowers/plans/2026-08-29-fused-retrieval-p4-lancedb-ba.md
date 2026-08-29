# 融合检索 P4：LanceDB ensure + BA 内部口 + bookworm 镜像实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的向量基建：`ensureLance` / `resetLanceForTests` 在 HTTP server 进程独占 connect 表 `moment_vectors`；BA 内部口 `POST /api/internal/embeddings` 与 `DELETE /api/internal/embeddings/:momentId`；`createApp()` 不 connect；`index.ts` listen 前 ensure，production 失败 `exit(1)`；worker 禁止 `import '@lancedb/lancedb'`；Dockerfile 改为 `node:22-bookworm-slim`；三份 compose 只给 server 挂 Lance volume；公网 nginx 对 `/api/internal/` 返回 404。

**Architecture:** Lance 是可丢的派生索引，MySQL 仍是时刻真相源（不把完整 moment 标量复制进 Lance）。查询期与 BA 写入都在 HTTP server 进程；worker 只打 `INTERNAL_API_BASE_URL`（本计划只把该 env 写进 config/compose，fetch 属 P5）。`createApp()` 只组装 Express，connect 发生在 `startServer()` 的 listen 之前。BA 无 JWT（`@Authorized` 不挂），`populateUser` 遇到 BA token 会 JWT 失败并保持匿名，随后 `baAuth` 用 `timingSafeEqual` 校验。测试用真实 Lance 目录 + `resetLanceForTests()`，**不**进入 MySQL `resetDb()`。

**Tech Stack:** `@lancedb/lancedb` + `apache-arrow@18.1.0`（peer `>=15 <=18.1.0`；`Schema` / `Utf8` / `Float32` / `FixedSizeList`）/ zod ^3.22（config 与 BA body）/ `crypto.timingSafeEqual` / routing-controllers 0.11 `UnauthorizedError`/`BadRequestError` / jest `--runInBand` + supertest / Docker `node:22-bookworm-slim` / pnpm `supportedArchitectures` linux+glibc。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§0 Lance 只挂 server、§1 进程表与 ensure 时机、§2.5 `moment_vectors`、§2.6 gitignore、§4.1 `LANCEDB_PATH`/`BA_AUTH_TOKEN`/`INTERNAL_API_BASE_URL`/`MULTIMODAL_EMBEDDING_DIMENSION`、§6.3 BA 内部、§6.6 错误码、§8 BA 安全、§9 BA/createApp 测试、§11 P4 出口）

**上游契约:** `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`（执行时假设 P1 已在本分支落地）。P2 标量过滤、P3 compress 与本计划正交。P1 **没有**把 embedding/Lance env 写入 `config.ts`（P1 偏差：那些变量属 P4/P5）。

## Global Constraints

- 冻结名逐字不得改（P5–P10 靠此对齐）：`ensureLance` / `resetLanceForTests` / `getLanceTable` / `isLanceReady` / `closeLanceForTests` / 表 `moment_vectors` 字段 `id,momentId,chainId,kind,mediaId,vector,modelHash` / `POST /api/internal/embeddings` / `DELETE /api/internal/embeddings/:momentId` / `BA_AUTH_TOKEN` 默认 `''` / `LANCEDB_PATH` 默认 `./lancedb_data` / `INTERNAL_API_BASE_URL` 默认 `http://127.0.0.1:3000` / `MULTIMODAL_EMBEDDING_DIMENSION` 默认 `2560` 且 ∈ `{2560,2048,1536,1024,768,512,256}` / `BA_NOT_CONFIGURED` 401 / `BA_AUTH_INVALID` 401 / `EMBEDDING_DIM_MISMATCH` 400 / `startServer`。
- **worker 进程禁止** `import '@lancedb/lancedb'`、禁止相对路径进入 `src/lancedb/`、不 `connect`。本计划用源码图测试钉死；P5 软删/链删清向量必须走 **server** 直接调 repository，不得让 worker import 图碰到 Lance。
- **`createApp()` 不 connect Lance**（既有 HTTP 测试保持零 Lance I/O）。`src/index.ts` 入口调用 `startServer()`：`createApp()` → `ensureLance()` → `listen`。`NODE_ENV=production` 时 ensure 失败 `process.exit(1)`；development/test ensure 失败打 error 日志、不 listen、throw。
- CONVENTIONS §3 **只追加不改语义**：不改 `ChainPolicy` / `requireChainRole`；不改 feed `{h,i}`/`{c,i}`；媒体稳定入口仍 `/api/media/:id`；不改既有存储方法；无新 MySQL 表（`resetDb()` 删除顺序不变）。新路由仅 BA 两口，**不**进 `@moment/api-client` / `@moment/dto`。**不改** `docs/superpowers/plans/CONVENTIONS.md`（P1 Task 8 已预留 `POST|DELETE /api/internal/embeddings*`）。
- 本计划 **不**加 `DASHSCOPE_*` / `MULTIMODAL_EMBEDDING_ENABLED` / `MULTIMODAL_EMBEDDING_MODEL` / `MULTIMODAL_EMBEDDING_OUTPUT_TYPE`（P5）。**只**加 `LANCEDB_PATH` / `BA_AUTH_TOKEN` / `INTERNAL_API_BASE_URL` / `MULTIMODAL_EMBEDDING_DIMENSION`。不改、不覆盖 `apps/server/.env`。`apache-arrow` 钉 peer 区间内（18.1.0）；`pnpm-workspace.yaml` 必须让 linux gnu 进入 lockfile，并忽略 lancedb 的 `openai` / `@huggingface/transformers` optional。
- **不**实现 `getEmbeddingProvider` / `handleMomentEmbed` / `computeEmbedHash` / DashScope / `.search()` ANN / `POST /api/search` / compress / jobs / web / app / `backfill:embed`。不按 `chainId` 删向量（P5）。
- `resetLanceForTests()` **不**进入 `tests/helpers/db.ts`。触库（MySQL）文件仍 `afterAll(closeDb)`；Lance 测试 `afterAll(closeLanceForTests)`。server 测试：`pnpm --filter @moment/server test -- <file>`（脚本已含 `--runInBand`）。严禁生产库。
- 每 Task 一个 commit（conventional commits）。**本计划的实现者执行 Commit 步骤**。

**Spec 引用与偏差（逐条注明）：**

1. **`startServer` 抽到 `apps/server/src/boot.ts`**：`src/index.ts` 仅 `import 'reflect-metadata'` + `void startServer()`。测试 import `boot.js`，避免加载 entry 副作用 listen。spec「`index.ts` listen 前 ensure」由 entry 调用 `startServer` 满足。
2. **`setBaAuthTokenForTests(token: string | undefined)`**：`config` 在 import 时 parse，测试不能靠改 `process.env` 让已解析的 `BA_AUTH_TOKEN` 变。对齐 `setLLMProvider`。`undefined` = 回落 `config.BA_AUTH_TOKEN`。业务代码禁用。
3. **`MULTIMODAL_EMBEDDING_DIMENSION` 在 P4 落地**：spec §4.1 把它和 DashScope 写在同一张表，但 §2.5 / §6.3 / §11 P4 需要 dim 建 `FixedSizeList` 并做 `EMBEDDING_DIM_MISMATCH`。P5 **不得**再往 `envSchema` 加同名字段。其余 embedding env 仍属 P5。
4. **`INTERNAL_API_BASE_URL` 本计划写入 `config.ts` + worker compose override**；server 进程忽略该值。P5 embed handler 才 `fetch`。本地默认 `http://127.0.0.1:3000`；compose worker 必须覆盖成 `http://server:3000`（否则容器内会打 worker 自己的 loopback）。
5. **BA body schema 放 `apps/server/src/embeddings/internal.schema.ts`**，不进 `@moment/dto` / api-client（spec §6.3「不进 api-client」；frozen dto 列表无 BA schema）。
6. **本计划导出读口 `listVectorsByMomentId` / `getLanceTable` / `lanceEqUuid` / `LANCE_UUID_RE` / `vectorRowId`**：spec 只钉 mergeInsert 与按 `momentId` 删除；测试与 P5 软删、P6 `.where` 需要同一套 uuid 防注入。本计划 **不**实现向量 `.search()` / ANN / `{d,i}`。
7. **`apache-arrow` 直接依赖**：用 Arrow `Schema` 建空表。必须钉在 `@lancedb/lancedb` 的 **peerDependencies** `apache-arrow` 闭区间内（npm latest `0.37.1` 为 `>=15.0.0 <=18.1.0`）。`pnpm add apache-arrow` 不写版本会装到 19+，`Schema`/`FixedSizeList` instanceof 与 `createEmptyTable` 会裂。本计划安装 `apache-arrow@18.1.0`。禁止 `@apache-arrow/ts`。
8. **development/test ensure 失败：`logger.error('lancedb ensure failed', err)` 后 throw，不 `listen`、不 `exit(1)`**。仅 `nodeEnv === 'production'` 调 `exit(1)` 并 return。
9. **`deploy/.env.example` 与 `deploy/.env.external.example` 同步四字段**（`LANCEDB_PATH` / `BA_AUTH_TOKEN` / `INTERNAL_API_BASE_URL` / `MULTIMODAL_EMBEDDING_DIMENSION`；生产 compose `env_file: .env` 来自这两份）。CLAUDE.md 只强制 `apps/server/.env.example`；不改这两份的话，ops 文档会缺 `BA_AUTH_TOKEN`，生产 worker 若漏 compose override 会带着默认 `INTERNAL_API_BASE_URL=http://127.0.0.1:3000` 打自己的 loopback。**仍不覆盖** `apps/server/.env` / 仓库根 `.env`。
10. **建空表 API**：优先 `db.createEmptyTable(MOMENT_VECTORS_TABLE, schema)`；若当前 `@lancedb/lancedb` 无此方法，则 `db.createTable(MOMENT_VECTORS_TABLE, [], { schema })`。禁止用含真实向量的 seed 行建表。家庭量级 **不建 IVF**。
11. **pnpm native 可选依赖（Docker 必过）**：`@lancedb/lancedb` 的 `.node` 在 `optionalDependencies`（`@lancedb/lancedb-linux-x64-gnu` 等）。pnpm 默认只把**当前平台**写入 lockfile；macOS 上 `pnpm add` 后 `apps/server/Dockerfile` 的 linux `pnpm install --frozen-lockfile` 会缺 gnu 绑定。本计划改 `pnpm-workspace.yaml`：`supportedArchitectures` 含 `linux`/`darwin`/`glibc`；`ignoredOptionalDependencies` 排除 `openai` 与 `@huggingface/transformers`（lancedb 自带的 embedding extras，本计划不实现 provider，禁止打进 server 镜像）。

## File map

| 路径 | 职责 |
|---|---|
| `apps/server/src/config.ts` | `LANCEDB_PATH` / `BA_AUTH_TOKEN` / `INTERNAL_API_BASE_URL` / `MULTIMODAL_EMBEDDING_DIMENSION` |
| `apps/server/.env.example` | 同上，含隐私注释 |
| `deploy/.env.example` / `deploy/.env.external.example` | 生产 compose 用的同一组变量 |
| `.gitignore` | `apps/server/lancedb_data/` 与仓库根 `lancedb_data/` |
| `apps/server/src/lancedb/ids.ts` | `LANCE_UUID_RE` / `lanceEqUuid` / `vectorRowId` |
| `apps/server/src/lancedb/schema.ts` | Arrow schema + 表名常量 |
| `apps/server/src/lancedb/factory.ts` | connect 单例、`ensureLance` / `resetLanceForTests` / `getLanceTable` |
| `apps/server/src/lancedb/repository.ts` | `upsertMomentVector` / `deleteVectorsByMomentId` / `listVectorsByMomentId` |
| `apps/server/src/embeddings/ba-auth.ts` | `assertBaAuth` / `baAuth` / `setBaAuthTokenForTests` |
| `apps/server/src/embeddings/internal.schema.ts` | BA POST body zod |
| `apps/server/src/embeddings/internal.controller.ts` | POST upsert / DELETE by momentId |
| `apps/server/src/app.ts` | controllers 追加 `InternalEmbeddingsController`（不调用 ensure） |
| `apps/server/src/boot.ts` | `startServer` |
| `apps/server/src/index.ts` | `void startServer()` |
| `apps/server/Dockerfile` | `FROM node:22-bookworm-slim` |
| `docker-compose.yml` / `docker-compose.prod.yml` / `docker-compose.prod.external.yml` | 仅 server volume + worker `INTERNAL_API_BASE_URL` |
| `deploy/nginx.conf` / `deploy/nginx.external.conf` | `/api/internal/` 404，且必须写在 `location /api/` 之前 |
| `apps/server/package.json` + 根 `pnpm-lock.yaml` | `@lancedb/lancedb`、`apache-arrow@18.1.0`（peer 区间内） |
| `pnpm-workspace.yaml` | `supportedArchitectures`（linux/darwin + glibc）+ `ignoredOptionalDependencies`（openai / transformers） |

**本计划明确不改：** `chain-policy.ts`、feed cursor、`momentSerializer`、`queryMomentPage`、compress/embed handler、`getEmbeddingProvider`、`handlers.ts` 注册表、`tests/helpers/db.ts`、`packages/dto`、`packages/api-client`、web/app、`apps/web/Dockerfile`、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: config env + .env.example + gitignore

**Files:**
- Modify: `apps/server/src/config.ts:93-97`（`AMAP_WEB_KEY` 之后、`envSchema` 闭合之前）
- Modify: `apps/server/.env.example`（`AMAP_WEB_KEY=` 块之后追加）
- Modify: `deploy/.env.example`（`LLM_RECAP_MAX_CHARS=8000` 之后、备份段之前）
- Modify: `deploy/.env.external.example`（同上位置）
- Modify: `.gitignore`（文件末尾追加两行）
- Test: `apps/server/tests/lancedb/config.test.ts`

**Interfaces:**
- Consumes:
  - 现 `envSchema`（zod 3；boolean 用 enum+transform，禁止 `z.coerce.boolean()`；本 Task 不加 boolean 字段）
  - `loadEnv({ path: [\`.env.${process.env.NODE_ENV ?? 'development'}\`, '.env'] })` 不变
- Produces:
  - `config.LANCEDB_PATH: string` 默认 `'./lancedb_data'`
  - `config.BA_AUTH_TOKEN: string` 默认 `''`
  - `config.INTERNAL_API_BASE_URL: string` 默认 `'http://127.0.0.1:3000'`（`z.string().url()`，须接受 `http://server:3000`）
  - `config.MULTIMODAL_EMBEDDING_DIMENSION: number` 默认 `2560`；合法集合 `2560,2048,1536,1024,768,512,256`；非法 → parse throw
  - `.gitignore` 含 `apps/server/lancedb_data/` 与 `lancedb_data/`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/lancedb/config.test.ts`：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, envSchema } from '../../src/config.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

const DIMS = [2560, 2048, 1536, 1024, 768, 512, 256];

describe('config Lance/BA env（fused-retrieval spec §4.1 / §11 P4）', () => {
  it('四字段存在；缺省与 spec 默认一致（测试 .env 未覆盖时）', () => {
    expect(typeof config.LANCEDB_PATH).toBe('string');
    expect(config.LANCEDB_PATH.length).toBeGreaterThan(0);
    expect(typeof config.BA_AUTH_TOKEN).toBe('string');
    expect(typeof config.INTERNAL_API_BASE_URL).toBe('string');
    expect(typeof config.MULTIMODAL_EMBEDDING_DIMENSION).toBe('number');

    const parsed = envSchema.parse({
      ...process.env,
      LANCEDB_PATH: undefined,
      BA_AUTH_TOKEN: undefined,
      INTERNAL_API_BASE_URL: undefined,
      MULTIMODAL_EMBEDDING_DIMENSION: undefined,
    });
    expect(parsed.LANCEDB_PATH).toBe('./lancedb_data');
    expect(parsed.BA_AUTH_TOKEN).toBe('');
    expect(parsed.INTERNAL_API_BASE_URL).toBe('http://127.0.0.1:3000');
    expect(parsed.MULTIMODAL_EMBEDDING_DIMENSION).toBe(2560);
  });

  it('INTERNAL_API_BASE_URL 接受 docker DNS 名 http://server:3000', () => {
    const cfg = envSchema.parse({ ...process.env, INTERNAL_API_BASE_URL: 'http://server:3000' });
    expect(cfg.INTERNAL_API_BASE_URL).toBe('http://server:3000');
  });

  it('INTERNAL_API_BASE_URL 非 URL 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, INTERNAL_API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('MULTIMODAL_EMBEDDING_DIMENSION 合法集合；字符串数字 coerce；非法拒绝', () => {
    for (const d of DIMS) {
      expect(envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: String(d) }).MULTIMODAL_EMBEDDING_DIMENSION).toBe(d);
    }
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '128' })).toThrow();
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '3000' })).toThrow();
    expect(() => envSchema.parse({ ...process.env, MULTIMODAL_EMBEDDING_DIMENSION: '2560.5' })).toThrow();
  });

  it('空串 BA_AUTH_TOKEN 是合法配置（内部口将 401 BA_NOT_CONFIGURED）', () => {
    expect(envSchema.parse({ ...process.env, BA_AUTH_TOKEN: '' }).BA_AUTH_TOKEN).toBe('');
  });
});

describe('gitignore lancedb_data（spec §2.6）', () => {
  it('根 gitignore 含 apps/server/lancedb_data/ 与仓库根 lancedb_data/', () => {
    const gi = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gi).toMatch(/(^|\n)apps\/server\/lancedb_data\/(\n|$)/);
    expect(gi).toMatch(/(^|\n)lancedb_data\/(\n|$)/);
  });
});

describe('.env.example 四字段（spec §4.1；不读 apps/server/.env）', () => {
  function mustHaveKeys(rel: string) {
    const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    for (const k of [
      'LANCEDB_PATH=',
      'BA_AUTH_TOKEN=',
      'INTERNAL_API_BASE_URL=',
      'MULTIMODAL_EMBEDDING_DIMENSION=',
    ]) {
      expect(text).toContain(k);
    }
  }

  it('apps/server 与两份 deploy example 都含四字段赋值', () => {
    mustHaveKeys('apps/server/.env.example');
    mustHaveKeys('deploy/.env.example');
    mustHaveKeys('deploy/.env.external.example');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/config.test.ts`
Expected: FAIL。`config.LANCEDB_PATH` 不是 `Config` 的字段（TS/jest：`undefined` 或编译失败）。gitignore / `.env.example` 断言失败。

- [ ] **Step 3: 最小实现**

Modify `apps/server/src/config.ts` — 在 `AMAP_WEB_KEY: z.string().default(''),` 之后、`});` 之前插入：
```ts
  // ---------- fused retrieval Lance / BA（spec §4.1 / §11 P4）----------
  // server 独占目录；worker 禁止 connect。默认相对 cwd（jest 在 apps/server 下即 apps/server/lancedb_data）。
  LANCEDB_PATH: z.string().min(1).default('./lancedb_data'),
  // 空串 = 内部口一律 401 BA_NOT_CONFIGURED（不区分有没有 Authorization，防探测）。
  BA_AUTH_TOKEN: z.string().default(''),
  // 写入 config（两进程同 schema）；仅 worker embed handler 读它（P5）。server 忽略。
  INTERNAL_API_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  // ensure 时按此维建 FixedSizeList；BA vector.length 必须相等。换维必须换目录或删表。
  // 须 ∈ {2560,2048,1536,1024,768,512,256}，否则进程启动 zod 失败。
  MULTIMODAL_EMBEDDING_DIMENSION: z.coerce
    .number()
    .int()
    .refine((n) => [2560, 2048, 1536, 1024, 768, 512, 256].includes(n), {
      message: 'MULTIMODAL_EMBEDDING_DIMENSION must be one of 2560,2048,1536,1024,768,512,256',
    })
    .default(2560),
```

**不要**加 `DASHSCOPE_*` / `MULTIMODAL_EMBEDDING_ENABLED` / `MODEL` / `OUTPUT_TYPE`。

Append to `apps/server/.env.example`：
```
# ---------- fused retrieval Lance / BA（P4；DashScope provider 属 P5）----------
# server 独占 Lance 目录。测试会 reset 该目录下的 moment_vectors 表。
# 建议测试库在 ignored 的 .env.test 设 LANCEDB_PATH=./lancedb_data/jest。
LANCEDB_PATH=./lancedb_data
# 内部 BA 口共享密钥。空 = 一律 401 BA_NOT_CONFIGURED。生产必须设成长随机串（openssl rand -hex 32），
# 与 worker 同一值。严禁进前端包。
BA_AUTH_TOKEN=
# 仅 worker embed handler 使用（P5）。本地 turbo：server 未 listen 前会退避。compose 里 worker 覆盖为 http://server:3000。
INTERNAL_API_BASE_URL=http://127.0.0.1:3000
# 向量维。须 ∈ 2560,2048,1536,1024,768,512,256。换维必须换 LANCEDB_PATH 子目录或删表。
MULTIMODAL_EMBEDDING_DIMENSION=2560
```

Append the same four assignments (with the same comments, condensed if needed) to `deploy/.env.example` and `deploy/.env.external.example` after the LLM block. Production values: keep `BA_AUTH_TOKEN=` empty in the example（ops 填真实值）；`INTERNAL_API_BASE_URL=http://127.0.0.1:3000` 仍可写（compose worker `environment:` 会覆盖）；`LANCEDB_PATH=./lancedb_data` 仍可写（compose server `environment:` 覆盖成 `/data/lancedb`）。

Append to `.gitignore`：
```
# LanceDB 本地目录（spec fused-retrieval §2.6）；默认相对 cwd
apps/server/lancedb_data/
lancedb_data/
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/config.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/.env.example deploy/.env.example deploy/.env.external.example .gitignore apps/server/tests/lancedb/config.test.ts
git commit -m "feat(server): add Lance/BA env vars and gitignore lancedb_data"
```

---

### Task 2: `@lancedb/lancedb` + schema + `ensureLance` / `resetLanceForTests`

**Files:**
- Create: `apps/server/src/lancedb/schema.ts`
- Create: `apps/server/src/lancedb/factory.ts`
- Create: `apps/server/src/lancedb/ids.ts`
- Create: `apps/server/tests/helpers/lance.ts`
- Test: `apps/server/tests/lancedb/factory.test.ts`
- Modify: `pnpm-workspace.yaml`（`supportedArchitectures` + `ignoredOptionalDependencies`）
- Modify: `apps/server/package.json` + 仓库根 `pnpm-lock.yaml`（`pnpm --filter @moment/server add`）

**Interfaces:**
- Consumes:
  - `config.LANCEDB_PATH` / `config.MULTIMODAL_EMBEDDING_DIMENSION`（Task 1）
  - `@lancedb/lancedb` `connect` / `tableNames` / `openTable` / `dropTable` / `createEmptyTable`（或 `createTable([], { schema })`）
  - `apache-arrow`：`Field`, `FixedSizeList`, `Float32`, `Schema`, `Utf8`
- Produces:
  - `MOMENT_VECTORS_TABLE = 'moment_vectors'`
  - `momentVectorsSchema(dim?: number): Schema` — 字段顺序精确 `id, momentId, chainId, kind, mediaId, vector, modelHash`；`vector` = `FixedSizeList(dim, Field('item', Float32))`；`dim` 默认 `config.MULTIMODAL_EMBEDDING_DIMENSION`
  - `LANCE_UUID_RE`：`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`（与 spec §2.5 逐字）
  - `lanceEqUuid(column: string, value: string): string | null` — 非 uuid 返回 null（调用方 warn + 丢弃）；成功返回 `` `${column} = '${value}'` ``
  - `vectorRowId(kind: 'moment' | 'image', momentId: string, mediaId?: string): string` — `moment:${momentId}` / `media:${mediaId}`
  - `ensureLance(): Promise<void>` — idempotent `connect` + ensure 表
  - `getLanceTable(): Table` — 未 ensure 抛 `Error` 且 `error.message === 'LANCE_NOT_READY'`
  - `isLanceReady(): boolean`
  - `resetLanceForTests(): Promise<void>` — 删表重建（spec：「删表重建」；**不**进 `resetDb()`）
  - `closeLanceForTests(): Promise<void>` — 若 `db` 非 null 先 `db.close()`，再把单例置 null
  - `denseVector(fill?: number): number[]`（测试 helper，长度 = config dim）
  - `pnpm-workspace.yaml`：`supportedArchitectures.os` 含 `linux` 与 `darwin`；`libc` 含 `glibc`；`ignoredOptionalDependencies` 含 `openai` 与 `@huggingface/transformers`
  - lockfile 含 `@lancedb/lancedb-linux-(x64|arm64)-gnu`；`apps/server/package.json` 的 `apache-arrow` 主版本 ∈ 15–18

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/helpers/lance.ts`：
```ts
import { config } from '../../src/config.js';

export function denseVector(fill = 0.01): number[] {
  return Array.from({ length: config.MULTIMODAL_EMBEDDING_DIMENSION }, () => fill);
}

export const HEX64_A = 'a'.repeat(64);
export const HEX64_B = 'b'.repeat(64);
```

Create `apps/server/tests/lancedb/factory.test.ts`：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedSizeList, Float32, Utf8 } from 'apache-arrow';
import { config } from '../../src/config.js';
import {
  closeLanceForTests,
  ensureLance,
  getLanceTable,
  isLanceReady,
  resetLanceForTests,
} from '../../src/lancedb/factory.js';
import { LANCE_UUID_RE, lanceEqUuid, vectorRowId } from '../../src/lancedb/ids.js';
import { MOMENT_VECTORS_TABLE, momentVectorsSchema } from '../../src/lancedb/schema.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

afterAll(async () => {
  await closeLanceForTests();
});

describe('moment_vectors schema（spec §2.5）', () => {
  it('表名与字段顺序/类型锁定', () => {
    expect(MOMENT_VECTORS_TABLE).toBe('moment_vectors');
    const schema = momentVectorsSchema(2560);
    expect(schema.fields.map((f) => f.name)).toEqual([
      'id',
      'momentId',
      'chainId',
      'kind',
      'mediaId',
      'vector',
      'modelHash',
    ]);
    expect(schema.fields[0].type).toBeInstanceOf(Utf8);
    expect(schema.fields[5].type).toBeInstanceOf(FixedSizeList);
    const list = schema.fields[5].type as FixedSizeList;
    expect(list.listSize).toBe(2560);
    expect(list.children[0].name).toBe('item');
    expect(list.children[0].type).toBeInstanceOf(Float32);
    expect(momentVectorsSchema().fields[5].type).toBeInstanceOf(FixedSizeList);
    expect((momentVectorsSchema().fields[5].type as FixedSizeList).listSize).toBe(config.MULTIMODAL_EMBEDDING_DIMENSION);
  });
});

describe('LANCE_UUID_RE / vectorRowId（spec §2.5 防拼接注入）', () => {
  it('uuid 正则与 id 派生', () => {
    expect(LANCE_UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(LANCE_UUID_RE.test("x'; DROP TABLE")).toBe(false);
    expect(lanceEqUuid('momentId', '123e4567-e89b-12d3-a456-426614174000')).toBe(
      "momentId = '123e4567-e89b-12d3-a456-426614174000'",
    );
    expect(lanceEqUuid('momentId', "x' OR 1=1")).toBeNull();
    expect(vectorRowId('moment', 'm-1')).toBe('moment:m-1');
    expect(vectorRowId('image', 'm-1', 'media-9')).toBe('media:media-9');
  });
});

describe('ensureLance / resetLanceForTests', () => {
  it('未 ensure 时 getLanceTable 抛 LANCE_NOT_READY；isLanceReady=false', async () => {
    await closeLanceForTests();
    expect(isLanceReady()).toBe(false);
    expect(() => getLanceTable()).toThrow(/LANCE_NOT_READY/);
  });

  it('ensureLance 幂等；reset 后表存在且可打开', async () => {
    await ensureLance();
    expect(isLanceReady()).toBe(true);
    const t1 = getLanceTable();
    await ensureLance();
    expect(getLanceTable()).toBe(t1);
    await resetLanceForTests();
    expect(isLanceReady()).toBe(true);
    expect(() => getLanceTable()).not.toThrow();
  });
});

describe('lancedb packaging（Docker linux gnu + arrow peer）', () => {
  it('apache-arrow 主版本 ∈ 15–18；workspace 钉 linux/glibc 且忽略 transformers/openai', () => {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@lancedb/lancedb']).toBeTruthy();
    const arrow = String(pkg.dependencies?.['apache-arrow'] ?? '');
    expect(arrow).toMatch(/^\^?1[5-8]/);

    const ws = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(ws).toMatch(/supportedArchitectures/);
    expect(ws).toMatch(/linux/);
    expect(ws).toMatch(/glibc/);
    expect(ws).toMatch(/ignoredOptionalDependencies/);
    expect(ws).toMatch(/openai/);
    expect(ws).toMatch(/@huggingface\/transformers/);

    const lock = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/@lancedb\/lancedb-linux-(x64|arm64)-gnu/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/factory.test.ts`
Expected: FAIL，`../../src/lancedb/factory.js` 不是一个模块（或 `@lancedb/lancedb` / `apache-arrow` 未安装 / workspace 未钉 linux gnu）。

- [ ] **Step 3: 安装依赖 + 最小实现**

**先改 workspace，再 add**（否则 lockfile 只含当前平台，Docker linux 缺 gnu 绑定）。

Modify `pnpm-workspace.yaml` — 在现有 `onlyBuiltDependencies` 块之后追加（不要删 `bcrypt` / `esbuild`）：
```yaml
supportedArchitectures:
  os:
    - current
    - linux
    - darwin
  cpu:
    - current
    - x64
    - arm64
  libc:
    - current
    - glibc

ignoredOptionalDependencies:
  - openai
  - '@huggingface/transformers'
```
`libc` 必须含 `current`：只写 `glibc` 会让 macOS 的 `@lancedb/lancedb-darwin-*` 装不上。不要加 `musl`（本计划已离开 alpine）。

Run:
```bash
pnpm --filter @moment/server add @lancedb/lancedb apache-arrow@18.1.0
```
Expected: `apps/server/package.json` dependencies 出现 `@lancedb/lancedb` 与 `apache-arrow`（18.1.x）；根 `pnpm-lock.yaml` 含 `@lancedb/lancedb-linux-x64-gnu` 或 `linux-arm64-gnu`。

然后打开 `node_modules/@lancedb/lancedb/package.json` 核对 `peerDependencies['apache-arrow']`。若区间不再包含 18.1.0，改钉到该闭区间内的最高 18.x（或区间上限），**禁止 19+**。若 lockfile 仍没有 `lancedb-linux-*-gnu`，停手报告，不要只改 Dockerfile。

Create `apps/server/src/lancedb/ids.ts`：
```ts
/** spec fused-retrieval §2.5：拼进 Lance `.where` 的 id 必须先过此正则，否则丢弃并 warn。 */
export const LANCE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lanceEqUuid(column: string, value: string): string | null {
  if (!LANCE_UUID_RE.test(value)) return null;
  return `${column} = '${value}'`;
}

export function vectorRowId(kind: 'moment' | 'image', momentId: string, mediaId?: string): string {
  return kind === 'image' ? `media:${mediaId ?? ''}` : `moment:${momentId}`;
}
```

Create `apps/server/src/lancedb/schema.ts`：
```ts
import { Field, FixedSizeList, Float32, Schema, Utf8 } from 'apache-arrow';
import { config } from '../config.js';

export const MOMENT_VECTORS_TABLE = 'moment_vectors';

export function momentVectorsSchema(dim: number = config.MULTIMODAL_EMBEDDING_DIMENSION): Schema {
  return new Schema([
    new Field('id', new Utf8(), false),
    new Field('momentId', new Utf8(), false),
    new Field('chainId', new Utf8(), false),
    new Field('kind', new Utf8(), false),
    new Field('mediaId', new Utf8(), false),
    new Field('vector', new FixedSizeList(dim, new Field('item', new Float32(), false)), false),
    new Field('modelHash', new Utf8(), false),
  ]);
}
```

Create `apps/server/src/lancedb/factory.ts`：
```ts
import * as lancedb from '@lancedb/lancedb';
import type { Table } from '@lancedb/lancedb';
import { config } from '../config.js';
import { MOMENT_VECTORS_TABLE, momentVectorsSchema } from './schema.js';

let db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
let table: Table | null = null;

async function createMomentVectorsTable(
  conn: NonNullable<typeof db>,
): Promise<Table> {
  const schema = momentVectorsSchema();
  const anyConn = conn as unknown as {
    createEmptyTable?: (name: string, schema: unknown) => Promise<Table>;
    createTable: (name: string, data: unknown[], opts?: { schema: unknown }) => Promise<Table>;
  };
  if (typeof anyConn.createEmptyTable === 'function') {
    return anyConn.createEmptyTable(MOMENT_VECTORS_TABLE, schema);
  }
  return anyConn.createTable(MOMENT_VECTORS_TABLE, [], { schema });
}

function tableNameList(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return names.map((n) => (typeof n === 'string' ? n : String((n as { name?: string })?.name ?? n)));
}

export async function ensureLance(): Promise<void> {
  if (db && table) return;
  db = await lancedb.connect(config.LANCEDB_PATH);
  const names = tableNameList(await db.tableNames());
  table = names.includes(MOMENT_VECTORS_TABLE)
    ? await db.openTable(MOMENT_VECTORS_TABLE)
    : await createMomentVectorsTable(db);
}

export function getLanceTable(): Table {
  if (!table) {
    const err = new Error('LANCE_NOT_READY');
    throw err;
  }
  return table;
}

export function isLanceReady(): boolean {
  return table !== null;
}

export async function resetLanceForTests(): Promise<void> {
  await ensureLance();
  if (!db) throw new Error('LANCE_NOT_READY');
  const names = tableNameList(await db.tableNames());
  if (names.includes(MOMENT_VECTORS_TABLE)) {
    await db.dropTable(MOMENT_VECTORS_TABLE);
  }
  table = await createMomentVectorsTable(db);
}

export async function closeLanceForTests(): Promise<void> {
  try {
    db?.close();
  } catch {
    /* native 句柄释放失败不挡测试收尾 */
  }
  db = null;
  table = null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/factory.test.ts`
Expected: PASS。首次 `connect` 可能创建 `config.LANCEDB_PATH` 目录（已被 gitignore）。

若 jest 报无法解析 native binding / ESM：在 `apps/server/jest.config.mjs` **不要**改 preset；把错误原文停手报告。若仅 `transformIgnorePatterns` 需要放行 `@lancedb`，追加：
```js
transformIgnorePatterns: ['/node_modules/(?!(@lancedb)/)'],
```
并在本 Task commit 里带上该行（这是跑通测试的最小改动，不是范围泄漏）。

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml apps/server/package.json pnpm-lock.yaml apps/server/src/lancedb/ids.ts apps/server/src/lancedb/schema.ts apps/server/src/lancedb/factory.ts apps/server/tests/helpers/lance.ts apps/server/tests/lancedb/factory.test.ts apps/server/jest.config.mjs
git commit -m "feat(server): add LanceDB ensureLance and moment_vectors schema"
```
（若未改 `jest.config.mjs` 则不要 `git add` 它。）

---

### Task 3: repository upsert / deleteByMomentId

**Files:**
- Create: `apps/server/src/lancedb/repository.ts`
- Test: `apps/server/tests/lancedb/repository.test.ts`

**Interfaces:**
- Consumes:
  - Task 2：`ensureLance` / `resetLanceForTests` / `getLanceTable` / `closeLanceForTests` / `lanceEqUuid` / `vectorRowId` / `denseVector` / `HEX64_A` / `HEX64_B`
  - `Table.mergeInsert(on).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows)`
  - `Table.delete(predicate)` / `Table.query().where(predicate).toArray()` 或等价 `filter`
  - `logger.warn`（非 uuid 丢弃）
- Produces:
  - `export type MomentVectorKind = 'moment' | 'image'`
  - `export interface MomentVectorRow { id: string; momentId: string; chainId: string; kind: MomentVectorKind; mediaId: string; vector: number[]; modelHash: string }`
  - `export interface MomentVectorInput { momentId: string; chainId: string; kind: MomentVectorKind; mediaId?: string; vector: number[]; modelHash: string }`
  - `upsertMomentVector(input: MomentVectorInput): Promise<void>` — `kind=moment` 时 `id=moment:{momentId}`、`mediaId=""`（忽略传入的 mediaId）；`kind=image` 时 `id=media:{mediaId}`、`mediaId` 必填（缺则 throw `Error('VALIDATION_ERROR')`）。`mergeInsert` 按 `id`。
  - `deleteVectorsByMomentId(momentId: string): Promise<number>` — 删该 momentId 全部 kind；非 uuid → warn + return 0；返回删除前匹配行数
  - `listVectorsByMomentId(momentId: string): Promise<MomentVectorRow[]>` — 非 uuid → `[]`；供测试与 P5 核对。**不是** ANN search。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/lancedb/repository.test.ts`：
```ts
import { closeLanceForTests, ensureLance, resetLanceForTests } from '../../src/lancedb/factory.js';
import {
  deleteVectorsByMomentId,
  listVectorsByMomentId,
  upsertMomentVector,
} from '../../src/lancedb/repository.js';
import { denseVector, HEX64_A, HEX64_B } from '../helpers/lance.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';

beforeAll(async () => {
  await ensureLance();
});
beforeEach(async () => {
  await resetLanceForTests();
});
afterAll(async () => {
  await closeLanceForTests();
});

function asNumbers(v: unknown): number[] {
  return Array.from(v as ArrayLike<number>);
}

describe('upsertMomentVector / deleteVectorsByMomentId', () => {
  it('kind=moment upsert 幂等：同 id 更新 vector/modelHash，list 仍一条', async () => {
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      mediaId: 'should-be-ignored',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.2),
      modelHash: HEX64_B,
    });
    const rows = await listVectorsByMomentId(MOMENT);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`moment:${MOMENT}`);
    expect(rows[0].kind).toBe('moment');
    expect(rows[0].mediaId).toBe('');
    expect(rows[0].chainId).toBe(CHAIN);
    expect(rows[0].modelHash).toBe(HEX64_B);
    expect(asNumbers(rows[0].vector)[0]).toBeCloseTo(0.2, 5);
    expect(asNumbers(rows[0].vector)).toHaveLength(denseVector().length);
  });

  it('kind=image 用 media:{mediaId}；同 moment 主向量+附图 DELETE 清空', async () => {
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'moment',
      vector: denseVector(0.1),
      modelHash: HEX64_A,
    });
    await upsertMomentVector({
      momentId: MOMENT,
      chainId: CHAIN,
      kind: 'image',
      mediaId: MEDIA,
      vector: denseVector(0.3),
      modelHash: HEX64_A,
    });
    const before = await listVectorsByMomentId(MOMENT);
    expect(before.map((r) => r.id).sort()).toEqual([`media:${MEDIA}`, `moment:${MOMENT}`].sort());
    const deleted = await deleteVectorsByMomentId(MOMENT);
    expect(deleted).toBe(2);
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);
    expect(await deleteVectorsByMomentId(MOMENT)).toBe(0);
  });

  it('kind=image 缺 mediaId → VALIDATION_ERROR；非 uuid momentId 删除返回 0', async () => {
    await expect(
      upsertMomentVector({
        momentId: MOMENT,
        chainId: CHAIN,
        kind: 'image',
        vector: denseVector(0.1),
        modelHash: HEX64_A,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    expect(await deleteVectorsByMomentId("x' OR 1=1")).toBe(0);
    expect(await listVectorsByMomentId('not-a-uuid')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/repository.test.ts`
Expected: FAIL，`repository.js` 不是一个模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/lancedb/repository.ts`：
```ts
import { logger } from '../utils/logger.js';
import { getLanceTable } from './factory.js';
import { lanceEqUuid, vectorRowId } from './ids.js';

export type MomentVectorKind = 'moment' | 'image';

export interface MomentVectorRow {
  id: string;
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId: string;
  vector: number[];
  modelHash: string;
}

export interface MomentVectorInput {
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId?: string;
  vector: number[];
  modelHash: string;
}

function toRow(input: MomentVectorInput): MomentVectorRow {
  if (input.kind === 'image' && !input.mediaId) {
    throw new Error('VALIDATION_ERROR');
  }
  const mediaId = input.kind === 'image' ? (input.mediaId as string) : '';
  return {
    id: vectorRowId(input.kind, input.momentId, mediaId),
    momentId: input.momentId,
    chainId: input.chainId,
    kind: input.kind,
    mediaId,
    vector: Array.from(input.vector),
    modelHash: input.modelHash,
  };
}

export async function upsertMomentVector(input: MomentVectorInput): Promise<void> {
  const row = toRow(input);
  const table = getLanceTable();
  await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([row]);
}

export async function listVectorsByMomentId(momentId: string): Promise<MomentVectorRow[]> {
  const pred = lanceEqUuid('momentId', momentId);
  if (!pred) return [];
  const table = getLanceTable();
  const q = table as unknown as { query: () => { where: (p: string) => { toArray: () => Promise<unknown[]> } } };
  const raw = await q.query().where(pred).toArray();
  return raw as MomentVectorRow[];
}

export async function deleteVectorsByMomentId(momentId: string): Promise<number> {
  const pred = lanceEqUuid('momentId', momentId);
  if (!pred) {
    logger.warn('lancedb delete ignored non-uuid momentId');
    return 0;
  }
  const existing = await listVectorsByMomentId(momentId);
  const n = existing.length;
  if (n === 0) return 0;
  await getLanceTable().delete(pred);
  return n;
}
```

锁定 `getLanceTable().query().where(pred).toArray()`（非 ANN）。若安装版本没有 `query`，停手报告实际方法名（例如 `filter`），不要改用 `search()` 向量路。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/repository.test.ts tests/lancedb/factory.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lancedb/repository.ts apps/server/tests/lancedb/repository.test.ts
git commit -m "feat(server): add moment_vectors upsert and delete-by-momentId"
```

---

### Task 4: BA `assertBaAuth` / `baAuth` / `setBaAuthTokenForTests`

**Files:**
- Create: `apps/server/src/embeddings/ba-auth.ts`
- Test: `apps/server/tests/embeddings/ba-auth.test.ts`

**Interfaces:**
- Consumes:
  - `config.BA_AUTH_TOKEN`（Task 1）
  - `crypto.timingSafeEqual`
  - `UnauthorizedError` from `routing-controllers`（httpCode 401；`message` 为机器码）
- Produces:
  - `assertBaAuth(configuredToken: string, authorization: string | string[] | undefined): void`
    - `configuredToken === ''` → 无论 header 如何，抛 `UnauthorizedError('BA_NOT_CONFIGURED')`
    - 已配置：无 header / 非 `Bearer ` 前缀 / token 不恒等 → `UnauthorizedError('BA_AUTH_INVALID')`
    - 长度不等先 `false`（不调用 `timingSafeEqual`，它会因长度不同 throw）；等长则 `timingSafeEqual(Buffer.from(a,'utf8'), Buffer.from(b,'utf8'))`
  - `getBaAuthToken(): string` — 有测试 override 用 override，否则 `config.BA_AUTH_TOKEN`
  - `setBaAuthTokenForTests(token: string | undefined): void` — `undefined` 清除 override
  - `baAuth: RequestHandler` — `assertBaAuth(getBaAuthToken(), req.headers.authorization)`，成功 `next()`，失败 `next(err)`（与 `requireChainRole` 同形）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/embeddings/ba-auth.test.ts`：
```ts
import { UnauthorizedError } from 'routing-controllers';
import { jest } from '@jest/globals';
import {
  assertBaAuth,
  baAuth,
  getBaAuthToken,
  setBaAuthTokenForTests,
} from '../../src/embeddings/ba-auth.js';

afterEach(() => setBaAuthTokenForTests(undefined));

function thrown(fn: () => void): UnauthorizedError {
  try {
    fn();
    throw new Error('expected throw');
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedError);
    return err as UnauthorizedError;
  }
}

describe('assertBaAuth（spec §6.3）', () => {
  it('空配置：有/无 Authorization 都是 BA_NOT_CONFIGURED（不探测）', () => {
    expect(thrown(() => assertBaAuth('', undefined)).message).toBe('BA_NOT_CONFIGURED');
    expect(thrown(() => assertBaAuth('', 'Bearer secret')).message).toBe('BA_NOT_CONFIGURED');
    expect(thrown(() => assertBaAuth('', 'Bearer ')).message).toBe('BA_NOT_CONFIGURED');
  });

  it('已配置：缺头 / 非 Bearer / 错 token → BA_AUTH_INVALID；精确匹配通过', () => {
    const tok = 'ba-secret-token';
    expect(thrown(() => assertBaAuth(tok, undefined)).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Basic abc')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer wrong')).message).toBe('BA_AUTH_INVALID');
    expect(thrown(() => assertBaAuth(tok, 'Bearer ba-secret-tokex')).message).toBe('BA_AUTH_INVALID'); // 等长错误
    expect(() => assertBaAuth(tok, 'Bearer ba-secret-token')).not.toThrow();
  });

  it('Authorization 数组取首元素', () => {
    expect(() => assertBaAuth('t', ['Bearer t', 'Bearer other'])).not.toThrow();
  });
});

describe('setBaAuthTokenForTests', () => {
  it('override 空串 / 非空；undefined 回落 config', () => {
    const original = getBaAuthToken();
    setBaAuthTokenForTests('');
    expect(getBaAuthToken()).toBe('');
    setBaAuthTokenForTests('injected');
    expect(getBaAuthToken()).toBe('injected');
    setBaAuthTokenForTests(undefined);
    expect(getBaAuthToken()).toBe(original);
  });
});

describe('baAuth 中间件', () => {
  it('失败 next(err)；成功 next()', () => {
    setBaAuthTokenForTests('');
    const next1 = jest.fn();
    baAuth({ headers: {} } as never, {} as never, next1);
    expect(next1.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect((next1.mock.calls[0][0] as UnauthorizedError).message).toBe('BA_NOT_CONFIGURED');

    setBaAuthTokenForTests('tok');
    const next2 = jest.fn();
    baAuth({ headers: { authorization: 'Bearer tok' } } as never, {} as never, next2);
    expect(next2).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/embeddings/ba-auth.test.ts`
Expected: FAIL，`ba-auth.js` 不是一个模块。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/embeddings/ba-auth.ts`：
```ts
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from 'routing-controllers';
import { config } from '../config.js';

let override: string | undefined;

export function getBaAuthToken(): string {
  return override !== undefined ? override : config.BA_AUTH_TOKEN;
}

/** 测试注入。undefined = 回落 config。严禁业务代码使用。 */
export function setBaAuthTokenForTests(token: string | undefined): void {
  override = token;
}

function headerValue(authorization: string | string[] | undefined): string | undefined {
  if (Array.isArray(authorization)) return authorization[0];
  return authorization;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function assertBaAuth(
  configuredToken: string,
  authorization: string | string[] | undefined,
): void {
  if (configuredToken === '') {
    throw new UnauthorizedError('BA_NOT_CONFIGURED');
  }
  const header = headerValue(authorization);
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('BA_AUTH_INVALID');
  }
  const presented = header.slice('Bearer '.length);
  if (!tokensEqual(configuredToken, presented)) {
    throw new UnauthorizedError('BA_AUTH_INVALID');
  }
}

export const baAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    assertBaAuth(getBaAuthToken(), req.headers.authorization);
    next();
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/embeddings/ba-auth.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/embeddings/ba-auth.ts apps/server/tests/embeddings/ba-auth.test.ts
git commit -m "feat(server): add BA bearer auth for internal embeddings"
```

---

### Task 5: BA HTTP `POST` / `DELETE` + 注册进 `createApp`（仍不 connect）

**Files:**
- Create: `apps/server/src/embeddings/internal.schema.ts`
- Create: `apps/server/src/embeddings/internal.controller.ts`
- Modify: `apps/server/src/app.ts:28-54`（import + `controllers` 数组末尾追加 `InternalEmbeddingsController`）
- Test: `apps/server/tests/embeddings/internal.test.ts`

**Interfaces:**
- Consumes:
  - Task 3 repository / Task 2 ensure+reset / Task 4 `baAuth` + `setBaAuthTokenForTests`
  - `createApp()` 现签名 `(): express.Express`（**不得**在函数体内调 `ensureLance`）
  - `listenLocal` from `tests/helpers/http-server.ts`
  - `BadRequestError` / `@JsonController('/internal/embeddings')`（`routePrefix` `/api` → `/api/internal/embeddings`）
  - **无** `@Authorized()`
  - `config.MULTIMODAL_EMBEDDING_DIMENSION`
- Produces:
  - `embeddingUpsertSchema`：
    ```ts
    z.object({
      momentId: z.string().uuid(),
      chainId: z.string().uuid(),
      kind: z.enum(['moment', 'image']),
      mediaId: z.string().uuid().optional(),
      vector: z.array(z.number()),
      modelHash: z.string().length(64),
    }).superRefine((val, ctx) => {
      if (val.kind === 'image' && !val.mediaId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['mediaId'] });
      }
    })
    ```
  - `POST /api/internal/embeddings` → 200 `{ ok: true }`；`vector.length !== dim` → 400 `EMBEDDING_DIM_MISMATCH`（`BadRequestError`，信封 `error.code` 即该机器码）
  - `DELETE /api/internal/embeddings/:momentId` → 200 `{ deleted: number }`；`:momentId` 非 uuid → 400 `VALIDATION_ERROR`（zod `z.string().uuid().parse`）
  - `InternalEmbeddingsController` 进 `createApp` controllers 数组
  - `createApp()` 调用后 `isLanceReady()` 保持调用前的值（本 Task 用 `closeLanceForTests` 后断言 false）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/embeddings/internal.test.ts`：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { setBaAuthTokenForTests } from '../../src/embeddings/ba-auth.js';
import { closeLanceForTests, ensureLance, isLanceReady, resetLanceForTests } from '../../src/lancedb/factory.js';
import { listVectorsByMomentId } from '../../src/lancedb/repository.js';
import { closeDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { denseVector, HEX64_A } from '../helpers/lance.js';

const MOMENT = '123e4567-e89b-12d3-a456-426614174000';
const CHAIN = '123e4567-e89b-12d3-a456-426614174001';
const MEDIA = '123e4567-e89b-12d3-a456-426614174002';
const TOKEN = 'ba-test-token-32bytes-minimum-ok';

const app = listenLocal(createApp());

afterAll(async () => {
  setBaAuthTokenForTests(undefined);
  await closeLanceForTests();
  await closeDb();
});

function body(over: Record<string, unknown> = {}) {
  return {
    momentId: MOMENT,
    chainId: CHAIN,
    kind: 'moment',
    vector: denseVector(0.11),
    modelHash: HEX64_A,
    ...over,
  };
}

describe('createApp 不 connect Lance（spec §1 / §9）', () => {
  it('close 之后 createApp 保持 isLanceReady=false', async () => {
    await closeLanceForTests();
    expect(isLanceReady()).toBe(false);
    createApp();
    expect(isLanceReady()).toBe(false);
  });
});

describe('BA 未配置 → 401 BA_NOT_CONFIGURED', () => {
  beforeEach(() => setBaAuthTokenForTests(''));

  it('无头 / 带 Bearer 都是同一 code（不探测开关）', async () => {
    const a = await request(app).post('/api/internal/embeddings').send(body());
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe('BA_NOT_CONFIGURED');
    expect(a.body.error).not.toHaveProperty('configured');
    const b = await request(app).post('/api/internal/embeddings').set('Authorization', `Bearer ${TOKEN}`).send(body());
    expect(b.status).toBe(401);
    expect(b.body.error.code).toBe('BA_NOT_CONFIGURED');
  });
});

describe('BA 已配置 HTTP（spec §6.3 / §9）', () => {
  beforeAll(async () => {
    await ensureLance();
  });
  beforeEach(async () => {
    setBaAuthTokenForTests(TOKEN);
    await resetLanceForTests();
  });
  afterEach(() => setBaAuthTokenForTests(undefined));

  it('错/缺 token → 401 BA_AUTH_INVALID', async () => {
    const missing = await request(app).post('/api/internal/embeddings').send(body());
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('BA_AUTH_INVALID');
    const wrong = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', 'Bearer nope')
      .send(body());
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('BA_AUTH_INVALID');
  });

  it('vector 长度 ≠ dim → 400 EMBEDDING_DIM_MISMATCH', async () => {
    const res = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ vector: [1, 2, 3] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMBEDDING_DIM_MISMATCH');
    expect(config.MULTIMODAL_EMBEDDING_DIMENSION).not.toBe(3);
  });

  it('kind=image 缺 mediaId → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ kind: 'image' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('合法 Bearer upsert 200 {ok:true} 幂等；DELETE 清空；非 uuid 400', async () => {
    const post = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body());
    expect(post.status).toBe(200);
    expect(post.body).toEqual({ ok: true });

    const again = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ vector: denseVector(0.5) }));
    expect(again.status).toBe(200);

    const img = await request(app)
      .post('/api/internal/embeddings')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body({ kind: 'image', mediaId: MEDIA, vector: denseVector(0.7) }));
    expect(img.status).toBe(200);
    expect(await listVectorsByMomentId(MOMENT)).toHaveLength(2);

    const del = await request(app)
      .delete(`/api/internal/embeddings/${MOMENT}`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: 2 });
    expect(await listVectorsByMomentId(MOMENT)).toEqual([]);

    const bad = await request(app)
      .delete('/api/internal/embeddings/not-a-uuid')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/embeddings/internal.test.ts`
Expected: FAIL。`createApp` 的 controllers 没有内部口 → POST 走 404 `NOT_FOUND`（或模块缺失）。`isLanceReady` 用例在实现前也可能因 import 失败红。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/embeddings/internal.schema.ts`：
```ts
import { z } from 'zod';

export const embeddingUpsertSchema = z
  .object({
    momentId: z.string().uuid(),
    chainId: z.string().uuid(),
    kind: z.enum(['moment', 'image']),
    mediaId: z.string().uuid().optional(),
    vector: z.array(z.number()),
    modelHash: z.string().length(64),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'image' && !val.mediaId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['mediaId'] });
    }
  });
```

Create `apps/server/src/embeddings/internal.controller.ts`：
```ts
import { BadRequestError, Body, Delete, JsonController, Param, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';
import { config } from '../config.js';
import { deleteVectorsByMomentId, upsertMomentVector } from '../lancedb/repository.js';
import { baAuth } from './ba-auth.js';
import { embeddingUpsertSchema } from './internal.schema.js';

@JsonController('/internal/embeddings')
@Service()
export class InternalEmbeddingsController {
  @Post('/')
  @UseBefore(baAuth)
  async upsert(@Body() body: unknown): Promise<{ ok: true }> {
    const input = embeddingUpsertSchema.parse(body);
    if (input.vector.length !== config.MULTIMODAL_EMBEDDING_DIMENSION) {
      throw new BadRequestError('EMBEDDING_DIM_MISMATCH');
    }
    await upsertMomentVector(input);
    return { ok: true };
  }

  @Delete('/:momentId')
  @UseBefore(baAuth)
  async remove(@Param('momentId') momentId: string): Promise<{ deleted: number }> {
    z.string().uuid().parse(momentId);
    const deleted = await deleteVectorsByMomentId(momentId);
    return { deleted };
  }
}
```

Modify `apps/server/src/app.ts`：
- 在其它 controller import 之后追加：`import { InternalEmbeddingsController } from './embeddings/internal.controller.js';`
- `controllers` 数组在 `RecapController` 之后追加 `InternalEmbeddingsController`。
- **`createApp` 函数体内禁止**调用 `ensureLance` / `lancedb.connect`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/embeddings/internal.test.ts tests/embeddings/ba-auth.test.ts tests/health.test.ts`
Expected: PASS。`tests/health.test.ts` 仍零 Lance I/O（`createApp` 不 connect）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/embeddings/internal.schema.ts apps/server/src/embeddings/internal.controller.ts apps/server/src/app.ts apps/server/tests/embeddings/internal.test.ts
git commit -m "feat(server): add internal embeddings upsert/delete endpoints"
```

---

### Task 6: `startServer` listen 前 ensure + worker 禁止 import lancedb

**Files:**
- Create: `apps/server/src/boot.ts`
- Modify: `apps/server/src/index.ts`（整文件替换为 entry）
- Test: `apps/server/tests/lancedb/boot.test.ts`
- Test: `apps/server/tests/lancedb/worker-isolation.test.ts`

**Interfaces:**
- Consumes:
  - `createApp(): express.Express`（Task 5 已注册 BA controller）
  - `ensureLance(): Promise<void>`
  - `config.PORT` / `config.NODE_ENV`
  - `logger.error` / `logger.info`
  - `apps/server/src/worker/index.ts` 及其相对 import 图（现网：processor / handlers / recap-scheduler / sweeper / db / push / logger / config）
- Produces:
  - `export type StartServerDeps = { createApp: () => express.Express; ensureLance: () => Promise<void>; listen: (app: express.Express) => void; exit: (code: number) => void; nodeEnv: 'development' | 'test' | 'production'; logger: Pick<typeof logger, 'error' | 'info'> }`
  - `startServer(deps?: Partial<StartServerDeps>): Promise<void>` — 顺序锁定：`createApp` → `ensureLance` → `listen`。ensure throw 时：`logger.error('lancedb ensure failed', err)`；`nodeEnv==='production'` 则 `exit(1)` 且 **不** listen；否则 rethrow 且 **不** listen。
  - `src/index.ts`：`import 'reflect-metadata'; import { startServer } from './boot.js'; void startServer();`
  - worker 入口相对 import 图不含 `@lancedb/lancedb` 且路径不含 `/lancedb/`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/lancedb/boot.test.ts`：
```ts
import { jest } from '@jest/globals';
import type { Express } from 'express';
import { startServer } from '../../src/boot.js';
import { closeDb } from '../helpers/db.js';

const app = { name: 'fake-app' } as unknown as Express;

afterAll(closeDb);

describe('startServer（spec §1 ensure 时机）', () => {
  it('顺序 createApp → ensureLance → listen', async () => {
    const order: string[] = [];
    const listen = jest.fn();
    const exit = jest.fn();
    await startServer({
      createApp: () => {
        order.push('create');
        return app;
      },
      ensureLance: async () => {
        order.push('ensure');
      },
      listen: (a) => {
        order.push('listen');
        listen(a);
      },
      exit,
      nodeEnv: 'production',
    });
    expect(order).toEqual(['create', 'ensure', 'listen']);
    expect(listen).toHaveBeenCalledWith(app);
    expect(exit).not.toHaveBeenCalled();
  });

  it('production ensure 失败 → exit(1) 且不 listen', async () => {
    const listen = jest.fn();
    const exit = jest.fn();
    const log = { error: jest.fn(), info: jest.fn() };
    await startServer({
      createApp: () => app,
      ensureLance: async () => {
        throw new Error('disk full');
      },
      listen,
      exit,
      nodeEnv: 'production',
      logger: log,
    });
    expect(log.error).toHaveBeenCalledWith('lancedb ensure failed', expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
  });

  it('development ensure 失败 → throw、不 listen、不 exit', async () => {
    const listen = jest.fn();
    const exit = jest.fn();
    const log = { error: jest.fn(), info: jest.fn() };
    await expect(
      startServer({
        createApp: () => app,
        ensureLance: async () => {
          throw new Error('disk full');
        },
        listen,
        exit,
        nodeEnv: 'development',
        logger: log,
      }),
    ).rejects.toThrow(/disk full/);
    expect(log.error).toHaveBeenCalledWith('lancedb ensure failed', expect.any(Error));
    expect(exit).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
```

Create `apps/server/tests/lancedb/worker-isolation.test.ts`：
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(SERVER_ROOT, 'src');
const WORKER_ENTRY = path.join(SRC, 'worker/index.ts');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function stripTypeImports(src: string): string {
  return src.replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
}

function relativeSpecs(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      statSync(cand);
      return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

function walk(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = stripTypeImports(readFileSync(file, 'utf8'));
    if (/from\s+['"]@lancedb\/lancedb['"]/.test(src) || /import\s+['"]@lancedb\/lancedb['"]/.test(src)) {
      throw new Error(`${file} imports @lancedb/lancedb`);
    }
    for (const spec of relativeSpecs(src)) {
      const next = resolveSpec(file, spec);
      if (next) stack.push(next);
    }
  }
  return seen;
}

describe('worker 禁止加载 Lance（spec §0 / §1）', () => {
  it('src/worker 源码不含 @lancedb/lancedb', () => {
    for (const file of listTs(path.join(SRC, 'worker'))) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toContain('@lancedb/lancedb');
    }
  });

  it('worker/index.ts 相对 import 图不进入 src/lancedb 且不 import @lancedb/lancedb', () => {
    const files = walk(WORKER_ENTRY);
    for (const file of files) {
      expect(file.replaceAll('\\', '/')).not.toMatch(/\/lancedb\//);
      expect(readFileSync(file, 'utf8')).not.toContain('@lancedb/lancedb');
    }
    expect(files.has(WORKER_ENTRY)).toBe(true);
  });

  it('src/app.ts 不直接调用 ensureLance / connect（createApp 零 Lance I/O）', () => {
    const src = readFileSync(path.join(SRC, 'app.ts'), 'utf8');
    expect(src).not.toContain('ensureLance');
    expect(src).not.toContain('@lancedb/lancedb');
    expect(src).not.toContain('lancedb.connect');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/boot.test.ts tests/lancedb/worker-isolation.test.ts`
Expected: FAIL。`boot.js` 不是一个模块。worker-isolation 的 `app.ts` 断言在 Task 5 后应已绿（`app.ts` 本就不含 ensureLance）；**红灯以 `boot.test.ts` 模块缺失为准**。不要为了红灯去改 worker 源码。

- [ ] **Step 3: 最小实现**

Create `apps/server/src/boot.ts`：
```ts
import type { Express } from 'express';
import { createApp as createAppImpl } from './app.js';
import { config } from './config.js';
import { ensureLance as ensureLanceImpl } from './lancedb/factory.js';
import { logger as loggerImpl } from './utils/logger.js';

export type StartServerDeps = {
  createApp: () => Express;
  ensureLance: () => Promise<void>;
  listen: (app: Express) => void;
  exit: (code: number) => void;
  nodeEnv: 'development' | 'test' | 'production';
  logger: Pick<typeof loggerImpl, 'error' | 'info'>;
};

export async function startServer(deps?: Partial<StartServerDeps>): Promise<void> {
  const createApp = deps?.createApp ?? createAppImpl;
  const ensureLance = deps?.ensureLance ?? ensureLanceImpl;
  const logger = deps?.logger ?? loggerImpl;
  const nodeEnv = deps?.nodeEnv ?? config.NODE_ENV;
  const exit = deps?.exit ?? ((code: number) => {
    process.exit(code);
  });
  const listen =
    deps?.listen ??
    ((app: Express) => {
      app.listen(config.PORT, () => {
        logger.info(`server listening on :${config.PORT}`, { env: config.NODE_ENV });
      });
    });

  const app = createApp();
  try {
    await ensureLance();
  } catch (err) {
    logger.error('lancedb ensure failed', err);
    if (nodeEnv === 'production') {
      exit(1);
      return;
    }
    throw err;
  }
  listen(app);
}
```

Replace `apps/server/src/index.ts` 全部内容为：
```ts
import 'reflect-metadata';
import { startServer } from './boot.js';

void startServer();
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/boot.test.ts tests/lancedb/worker-isolation.test.ts tests/embeddings/internal.test.ts tests/health.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/index.ts apps/server/tests/lancedb/boot.test.ts apps/server/tests/lancedb/worker-isolation.test.ts
git commit -m "feat(server): ensure Lance before listen and isolate worker from lancedb"
```

---

### Task 7: bookworm-slim 镜像 + 三份 compose volume + nginx `/api/internal/` 404

**Files:**
- Modify: `apps/server/Dockerfile:2`（`FROM node:22-alpine AS base` → `FROM node:22-bookworm-slim AS base`）
- Modify: `docker-compose.yml`（server volume + `LANCEDB_PATH`；worker `INTERNAL_API_BASE_URL` + depends_on server；`volumes` 增加 `moment-lancedb`）
- Modify: `docker-compose.prod.yml`（同上；worker `depends_on.server.condition: service_healthy`）
- Modify: `docker-compose.prod.external.yml`（server volume + `LANCEDB_PATH`；worker URL + `service_healthy`；文件末尾新增 `volumes:`）
- Modify: `deploy/nginx.conf`（`location /api/` **之前**插入 `/api/internal/` 404）
- Modify: `deploy/nginx.external.conf`（同上）
- Test: `apps/server/tests/lancedb/deploy.test.ts`

**Interfaces:**
- Consumes: 现网 Dockerfile / 三份 compose / 两份 nginx（本 Task 只改列出的片段）
- Produces:
  - `apps/server/Dockerfile` 所有 `FROM` 阶段继承 `node:22-bookworm-slim`（改 base 即可）；**不**出现 `node:22-alpine`
  - volume 名 `moment-lancedb` **只**挂 server 的 `/data/lancedb`；server env `LANCEDB_PATH=/data/lancedb`
  - worker / migrate / backup / web **不**挂该 volume；worker env `INTERNAL_API_BASE_URL=http://server:3000`
  - prod 两份：worker `depends_on.server.condition: service_healthy`
  - nginx：`location /api/internal/ { return 404; }` 在 `location /api/` 之前
  - `apps/web/Dockerfile` 仍 alpine（本计划不改）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/lancedb/deploy.test.ts`：
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function serviceBlock(yaml: string, name: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) throw new Error(`missing service ${name}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i]) || lines[i] === 'volumes:') {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function assertNginxInternalBeforeApi(conf: string, label: string): void {
  const internal = conf.search(/location\s+\/api\/internal\//);
  // 必须用 `/api/ {`：裸 `/location\s+\/api\//` 会先命中 `location /api/internal/`，实现后测试永远红。
  const api = conf.search(/location\s+\/api\/\s*\{/);
  if (internal < 0 || api <= internal) {
    throw new Error(`${label}: location /api/internal/ must appear before location /api/ { (internal=${internal}, api=${api})`);
  }
  const slice = conf.slice(internal, api);
  expect(slice).toMatch(/return\s+404\s*;/);
}

describe('Dockerfile bookworm-slim（spec §0 / §11 P4）', () => {
  it('server 镜像 base 是 node:22-bookworm-slim，不再 alpine', () => {
    const df = readFileSync(path.join(SERVER_ROOT, 'Dockerfile'), 'utf8');
    expect(df).toMatch(/^FROM node:22-bookworm-slim AS base\s*$/m);
    expect(df).not.toMatch(/node:22-alpine/);
  });

  it('web Dockerfile 仍 alpine（本计划不改）', () => {
    const df = readFileSync(path.join(REPO_ROOT, 'apps/web/Dockerfile'), 'utf8');
    expect(df).toMatch(/FROM node:22-alpine AS base/);
  });
});

describe('compose Lance volume 只挂 server（spec §1）', () => {
  const files = ['docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.prod.external.yml'] as const;

  it.each(files)('%s：server 挂 /data/lancedb，worker 不挂，worker INTERNAL_API_BASE_URL=http://server:3000', (file) => {
    const yml = read(file);
    const server = serviceBlock(yml, 'server');
    const worker = serviceBlock(yml, 'worker');
    expect(server).toContain('moment-lancedb:/data/lancedb');
    expect(server).toMatch(/LANCEDB_PATH:\s*\/data\/lancedb/);
    expect(worker).not.toContain('moment-lancedb:/data/lancedb');
    expect(worker).toMatch(/INTERNAL_API_BASE_URL:\s*http:\/\/server:3000/);
    for (const name of ['migrate', 'backup', 'web'] as const) {
      const start = yml.split('\n').findIndex((l) => l === `  ${name}:`);
      if (start < 0) continue;
      expect(serviceBlock(yml, name)).not.toContain('moment-lancedb:/data/lancedb');
    }
    expect(yml).toMatch(/^  moment-lancedb:\s*\{\}\s*$/m);
  });

  it('prod compose worker depends_on server service_healthy', () => {
    for (const file of ['docker-compose.prod.yml', 'docker-compose.prod.external.yml'] as const) {
      const worker = serviceBlock(read(file), 'worker');
      expect(worker).toMatch(/server:\s*\n\s*condition:\s*service_healthy/);
    }
  });
});

describe('nginx 公网拒绝 /api/internal/（spec §1 / §8）', () => {
  it('两份 conf 都在 location /api/ 之前 return 404', () => {
    assertNginxInternalBeforeApi(read('deploy/nginx.conf'), 'nginx.conf');
    assertNginxInternalBeforeApi(read('deploy/nginx.external.conf'), 'nginx.external.conf');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/lancedb/deploy.test.ts`
Expected: FAIL。Dockerfile 仍是 alpine；compose 无 `moment-lancedb`；nginx 无 `/api/internal/`。

- [ ] **Step 3: 最小实现（逐字改这些片段）**

**Dockerfile** — 仅改第 2 行：
```
FROM node:22-bookworm-slim AS base
```
其余 `RUN corepack enable` / COPY / CMD **不动**。不要给 web Dockerfile 改 base。

**`docker-compose.yml`** — `server` 的 `environment` / `depends_on` 之后补 volume 与路径；`worker` 补 URL 与 depends_on；底部 volumes 加一项：
```yaml
  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    restart: unless-stopped
    env_file: apps/server/.env
    environment:
      NODE_ENV: production
      MYSQL_HOST: mysql
      MYSQL_PORT: '3306'
      LANCEDB_PATH: /data/lancedb
    ports:
      - '3000:3000'
    depends_on:
      mysql:
        condition: service_healthy
    volumes:
      - moment-lancedb:/data/lancedb

  worker:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    restart: unless-stopped
    command: ['node', 'dist/worker/index.js']
    env_file: apps/server/.env
    environment:
      NODE_ENV: production
      MYSQL_HOST: mysql
      MYSQL_PORT: '3306'
      INTERNAL_API_BASE_URL: http://server:3000
    depends_on:
      mysql:
        condition: service_healthy
      server:
        condition: service_started

volumes:
  moment-mysql: {}
  moment-lancedb: {}
```
`mysql` / `backup` 服务保持原样。

**`docker-compose.prod.yml`** — 只改 `server` / `worker` / `volumes`。`x-server-env` **不要**加 `LANCEDB_PATH`（免得 migrate/worker 也带上路径）。server：
```yaml
  server:
    image: ghcr.io/ximing/moment-server:${MOMENT_IMAGE_TAG:-stable}
    pull_policy: always
    restart: unless-stopped
    env_file: .env
    environment:
      <<: *server-env
      LANCEDB_PATH: /data/lancedb
    volumes:
      - moment-lancedb:/data/lancedb
    depends_on:
      mysql:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          'fetch("http://127.0.0.1:3000/api/health").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))',
        ]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 20s
    logging: *logging
```
worker（在既有 mysql/migrate depends_on 上追加 server healthy）：
```yaml
  worker:
    image: ghcr.io/ximing/moment-server:${MOMENT_IMAGE_TAG:-stable}
    pull_policy: always
    restart: unless-stopped
    command: ['node', 'dist/worker/index.js']
    env_file: .env
    environment:
      <<: *server-env
      INTERNAL_API_BASE_URL: http://server:3000
    depends_on:
      mysql:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      server:
        condition: service_healthy
    logging: *logging
```
volumes：
```yaml
volumes:
  moment-mysql: {}
  moment-lancedb: {}
```

**`docker-compose.prod.external.yml`** — `server` 在 `<<: *app` 之后显式写 `environment`（必须保留 `NODE_ENV: production`，YAML 嵌套 key 会盖掉 anchor 的 environment）+ volumes；`worker` 同样盖 environment 并 depends_on server；文件末尾新增 volumes（该文件目前没有 `volumes:`）：
```yaml
  server:
    <<: *app
    image: ghcr.io/ximing/moment-server:${MOMENT_IMAGE_TAG:-stable}
    depends_on:
      migrate:
        condition: service_completed_successfully
    environment:
      NODE_ENV: production
      LANCEDB_PATH: /data/lancedb
    volumes:
      - moment-lancedb:/data/lancedb
    ports:
      - '${MOMENT_API_BIND:-127.0.0.1}:${MOMENT_API_PORT:-3000}:3000'
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          'fetch("http://127.0.0.1:3000/api/health").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))',
        ]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 20s

  worker:
    <<: *app
    image: ghcr.io/ximing/moment-server:${MOMENT_IMAGE_TAG:-stable}
    command: ['node', 'dist/worker/index.js']
    environment:
      NODE_ENV: production
      INTERNAL_API_BASE_URL: http://server:3000
    depends_on:
      migrate:
        condition: service_completed_successfully
      server:
        condition: service_healthy
```
文件末尾：
```yaml
volumes:
  moment-lancedb: {}
```
`migrate` / `backup` 保持 `<<: *app`，**不要**挂 `moment-lancedb`。

**`deploy/nginx.conf`** — 在 `location /api/` **之前**插入（resolver / `$moment_api` 块保持不动）：
```nginx
    # BA 内部口不对公网开放（spec fused-retrieval §1/§8）；worker 走 compose 网络直连 server:3000
    location /api/internal/ {
        return 404;
    }

    location /api/ {
```

**`deploy/nginx.external.conf`** — 同样插在 `location /api/` 之前：
```nginx
    location /api/internal/ {
        return 404;
    }

    location /api/ {
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/lancedb/deploy.test.ts`
Expected: PASS。

- [ ] **Step 5: 回归 + lint/typecheck**

Run:
```bash
pnpm --filter @moment/server test -- tests/lancedb tests/embeddings tests/health.test.ts
pnpm --filter @moment/server lint && pnpm --filter @moment/server typecheck
```
Expected: PASS / exit 0。既有 `tests/health.test.ts` 与全套 lancedb/BA 绿。不要跑会打生产库的命令。

- [ ] **Step 6: Commit**

```bash
git add apps/server/Dockerfile docker-compose.yml docker-compose.prod.yml docker-compose.prod.external.yml deploy/nginx.conf deploy/nginx.external.conf apps/server/tests/lancedb/deploy.test.ts
git commit -m "feat(server): switch server image to bookworm-slim and wire Lance volume/nginx"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test -- tests/lancedb tests/embeddings tests/health.test.ts` 全绿
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] `createApp()` 不 connect（`isLanceReady` 在 close 后仍 false；`src/app.ts` 无 `ensureLance`）
- [ ] `startServer`：production ensure 失败 `exit(1)` 且不 listen；development throw 且不 listen
- [ ] BA：空 token `BA_NOT_CONFIGURED` 401；错 token `BA_AUTH_INVALID` 401；dim 错 `EMBEDDING_DIM_MISMATCH` 400；upsert 幂等；DELETE 清空；非 uuid 400
- [ ] worker import 图不含 `@lancedb/lancedb` / `src/lancedb`
- [ ] Dockerfile `node:22-bookworm-slim`；三份 compose 仅 server 挂 `moment-lancedb`（migrate/backup/web 不挂）；nginx `/api/internal/` 在 `/api/` 之前 404
- [ ] gitignore 含 `apps/server/lancedb_data/` 与 `lancedb_data/`
- [ ] `pnpm-workspace.yaml` 钉 linux/glibc；lockfile 含 `@lancedb/lancedb-linux-*-gnu`；`apache-arrow` 主版本 15–18；未把 `openai` / `@huggingface/transformers` 当本计划实现
- [ ] spec §11 P4 出口：BA 测试绿；production ensure 失败不可 listen
- [ ] 未泄漏 P5–P10：无 `getEmbeddingProvider` / `DASHSCOPE_*`（除已落地的 DIMENSION）/ `handleMomentEmbed` / `computeEmbedHash` / `.search()` ANN / `POST /api/search` / jobs / api-client / web / app / `backfill:embed` / 按 chainId 删向量
- [ ] CONVENTIONS §3：ChainPolicy 未动；feed 游标未动；`/api/media/:id` 稳定入口未改；无新 MySQL 表；`resetDb()` 未改；`CONVENTIONS.md` 文件零 diff（路由已由 P1 预留）
