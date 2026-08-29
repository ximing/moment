# 时刻 Moment — 融合检索 Design（M2：意图理解 + 标量过滤 + 向量召回）

> 日期：2026-08-29
> 状态：已实现（P1–P10 合入，2026-08-29）
> 范围：server（标量过滤扩展 + LanceDB 向量索引 + 意图解析 + 派生图压缩管线 + BA 内部写入）+ dto + api-client + web + app
> 权威边界：M1 数据地基以 `2026-08-28-moment-people-place-design.md` 为准（persons / `moment_persons` / place 列 / `serializeMoments({ includePrivate })` / `getLLMProvider` / `getGeocodeProvider` 均已落地）；outbox/worker 以 `2026-08-15-moment-design.md` §5.4 为准；LLM provider 以 `2026-08-20-ai-recap-design.md` §3 与 M1 §5 为准；那年今日以 `2026-08-18-memories-today-design.md` 为准（独立入口，本 spec 不调用 `/api/memories/today`）；视频封面以 `2026-08-22-video-poster-design.md` 为准（本 spec 不改 `poster_media_id` / `posterUrl` 语义，只给封面行同样走派生图）。CONVENTIONS §3 已落地符号不得改名/改语义；本 spec 只追加（outbox 类型常量、`getObject`、路由、dto 字段）。
> 下游依赖：本 spec 是 M3（AI 时光对话）的检索层；不包含地图足迹、persons 合并、视频向量。

## 0. 产品决策（已与用户对齐）

- **M2 范围 = 宽**：一份 spec 写全融合检索终态（意图理解 + 标量过滤 + 向量召回 + 跨链查询层拼接 + 点击过滤 UI）。实施分期见 §11，不拆第二份设计。
- **标量在 MySQL，向量在 LanceDB。** 不把向量字节写入 MySQL。LanceDB 是可丢的派生索引：volume 丢失只能回填重打 embedding API。
- **LanceDB 只挂 HTTP server 进程。** worker **不得** `import '@lancedb/lancedb'`、不 `connect`。worker 经 BA HTTP 把向量写入 server（对齐 aimo `Authorization: Bearer <BA_AUTH_TOKEN>`）。Docker 只给 server 挂 `LANCEDB_PATH` volume。
- **Embedding** 独立三态 `getEmbeddingProvider()`，对齐 aimo `MultimodalEmbeddingService` 与其 `.env` 变量名/默认值（不抄真实 key）：DashScope `qwen3-vl-embedding`、2560 维、`dense`。不复用 `LLM_*`。空 key 或 `MULTIMODAL_EMBEDDING_ENABLED=false` 跳过向量路，标量过滤不停。**写入期** embed 在 worker；**查询期** embed（搜索 `text`）在 server 请求线程——两进程都读同一组 `DASHSCOPE_*` / `MULTIMODAL_*`。
- **嵌什么**：正文 + 转写 + **人名 + 地名** + 图（A+B）。人名地名与图像素会出域到 DashScope，写进 §8。
- **一条时刻的向量**：主向量 = 正文（含人名地名）+ **第一张**图走 `vl`（`enable_fusion=true`，返回一条融合向量）；其余每张图各一条 `image` 向量，行上带 `momentId`，召回后按时刻去重取 **最小 `_distance`**（Lance 默认 L2，距离越小越相似）。`qwen3-vl-embedding` 不支持 `multi_images` 模态键；本 spec 也不把多图塞进一次 fusion。
- **派生图不是裁切缩略图**：整幅保留、等比缩小、最长边 **1280**、**WebP 质量 85**。时间线卡片用派生图；Lightbox 用现有高清档（上传时最长边 2048 JPEG 0.85）。异步、不挡发布。`image/gif`、`image/heic`、`image/heif` **不压**（`derived_status` 保持 NULL，不读像素、不引入 libheif；卡片继续用原图）。
- **图给模型的方式 = 内存压的 embedding WebP（最长边 1024、质量 80）base64 data URI**，不是预签名 URL、**不入库**。对象存储是私有桶（`ATTACHMENT_S3_IS_PUBLIC` 恒 false），DashScope 拉不到 MinIO/S3 预签名。worker 对 **原图 `s3_key`** 有界 `getObject`，sharp 压完只放进请求体。
- **M1 例外（显式）**：
  1. 仅 worker `moment.compress` 允许有界读取**原图**对象字节（`getObject`，上限 `MAX_IMAGE_BYTES`），写出展示派生 1280 WebP 85 并入库。
  2. 仅 worker `moment.embed` 允许有界读取**原图**对象字节（同一上限），内存压 1024 WebP 80 组 DashScope data URI；**禁止** `uploadFile` 该 buffer，**禁止**读 `derived_s3_key`。
  请求线程仍零读像素。不得把例外扩到 extract / search / controller / 其它 handler。
- **任务可见性**：链设置「处理中」分区，仅 **owner**。只投影 `moment.compress` / `moment.embed`。转写/逆地理/抽取不进此页。v1 无重试端点。
- **意图理解**：搜索框走 LLM，结构化 `{ personNames, place, time, text }`。空 `LLM_API_KEY` 整句当 `text`。那年今日入口不动。意图**不抽 tag**；tag 只来自轨上/请求体 `tagId`。
- **搜索范围**：链主页默认当前链（`chainIds: [current]`）；首页 feed 默认 `getMyChains`，可再收窄 `chainIds`（GET feed 收窄仍用既有 query `chain_ids`）。人名按各链词典等值解析。无权链不进召回。结果按排序键混排，不按链分组。
- **融合 = 分层 C，不用产品层 RRF**：chip / 解析出的人/时/地/tag 是 MySQL 硬 AND；扣掉实体后的 `text` 才进 LanceDB。只有硬过滤时排序与今天 `tag_id` 列表相同。
- **API 分流**：chip 扩展现有 GET；搜索框 `POST /api/search`（LLM 不挂 GET）。web 过滤态仍 rab 内存，不进 URL。搜索**不**继承 feed 的 `before` 日期锚定（日历跳转不是 chip；搜索在当前链/首页 scope 内全文检索）。
- **地点过滤**：chip GET 的 `place` **整串相等**（零命中 = 空列表）。搜索意图解析出的 `place`：scope 内零命中则不当硬过滤，词并入 `text`。请求体自带的 `place`（用户点地点 chip）始终硬等值。
- **运行镜像**：`apps/server/Dockerfile` 由 `node:22-alpine` 改为 **`node:22-bookworm-slim`**（glibc，`@lancedb/lancedb` 与 `sharp` 原生绑定）。worker 与 server 共用该镜像，但 worker 进程不加载 Lance。与 aimo `node:20-slim` 同因。

## 1. 数据流

```
手动/EXIF/AI 写路径：仍完全走 M1（persons/place/source 赋值表/outbox geocode+extract）。本 spec 不改 create/update 请求体。

压缩：moments create 提交后，对该时刻所有静态可压图（含视频 poster 行；排除 GIF/HEIC/HEIF）同事务 emit moment.compress
  → worker getObject 有界读原图 → sharp 等比 1280 WebP 85 → uploadFile 派生 key
  → 回写 media.derived_* ；该时刻全部可压图终态（ready/skipped/failed，无 pending）且 hash 变后 emit moment.embed

无待压图时刻：create/update 若 embed_hash 变，同事务直接 emit moment.embed
（PATCH 不能改 mediaIds，故 update 不再发 compress，只可能发 embed）

向量：worker 读原图、内存压 1024 WebP 80（不入库）→ DashScope（vl / text / image，图为 data URI）→ POST /api/internal/embeddings（BA）
  → server upsert LanceDB；全部 upsert 成功后 worker 写 moments.embed_hash

chip 过滤：GET /api/feed | GET /api/chains/:chainId/moments 加 person_id/place/happened_from/to
  → queryMomentPage 半连接/等值/区间 → serializeMoments(includePrivate:true)

搜索：POST /api/search
  → getMyChains 求交 →（有 LLM）意图 JSON → 人名按链词典解析（§3.2 析取）
  → 硬过滤 MySQL AND + 可选 Lance 向量（分层 C）→ serializeMoments(includePrivate:true)
```

- 请求路径：create/update 仍是同步校验 + 写 outbox，**零** DashScope / **零** 读像素（与 M1、主 spec §5.4 一致）。**唯一例外**：`POST /api/search` 在请求线程同步调意图 LLM（`INTENT_TIMEOUT_MS = 8000`）以及（`text` 非空且 provider 非 null 时）查询 embedding；不走 outbox。chip GET **零** LLM、**零** embedding。
- worker **不**打开 LanceDB；只打存储、DashScope、server 内部 HTTP。BA 连接失败（server 未起）抛错走 outbox 退避。
- Lance 生命周期：`apps/server/src/lancedb/factory.ts` 的 `ensureLance()` 做 `lancedb.connect(config.LANCEDB_PATH)` 并 ensure 表 `moment_vectors`。`createApp()` **不** connect（既有 HTTP 测试保持零 Lance）。`src/index.ts` 在 `listen` 前：`NODE_ENV=production` 调用 `ensureLance()`，失败 `process.exit(1)`；development 同样 listen 前 ensure，失败则拒绝启动并打错误日志。测试用 `resetLanceForTests()` / 各测试 `beforeAll(ensureLance)`。
- 链删除：`chain.service` 现有 MySQL tx（已含 `moment_persons`/`persons`，M1）提交成功后，server **直接**按 `chainId` 删 Lance 行（不绕 BA）。失败只打日志——检索仍受 `getMyChains` 约束，孤儿行不可见。
- 时刻软删：`MomentService.remove` 事务提交成功后直接删该 `momentId` 全部 Lance 行。失败只打日志；检索向量路落地时仍校验 `deleted_at IS NULL`。sweeper 物理删时刻 **不强制**再清 Lance（软删已删；失败孤儿被 MySQL 软删过滤）。

### 进程与部署

| 进程 | LanceDB | 压图 / 写向量 | 用户 API / 查询 embedding |
|---|---|---|---|
| server | 唯一 connect | 否 | JWT 过滤/搜索/jobs；BA upsert；搜索 query embed |
| worker | 否（禁止 import lancedb） | 是 | 调 `INTERNAL_API_BASE_URL` |

Docker：

- volume `moment-lancedb` **只**挂 server 的 `LANCEDB_PATH`（`/data/lancedb`）。worker **不**挂。
- worker：`INTERNAL_API_BASE_URL=http://server:3000`，与 server **同一** `BA_AUTH_TOKEN`；`depends_on` server（prod 用 `condition: service_healthy`）。
- 改三份 compose：`docker-compose.yml`、`docker-compose.prod.yml`、`docker-compose.prod.external.yml`。
- 本地 `pnpm dev`：`INTERNAL_API_BASE_URL=http://127.0.0.1:3000`（turbo 并行时 embed 在 server 未 listen 前会退避重试）。
- 公网 nginx（`deploy/nginx.conf` 与 `deploy/nginx.external.conf`）对 `location /api/internal/` **return 404**（须写在 `location /api/` 之前）。worker 走 compose 网络直连 `server:3000`，不经公网 nginx。

新增运行时依赖（`apps/server/package.json`）：`sharp`（compress）、`@lancedb/lancedb`（仅 server 进程加载）。

## 2. 数据模型

### 2.1 MySQL `media` 加列（同一行，不新建 media 行、不复用 poster）

建基于 M1 未改的 `media` 表与视频封面 spec（`poster_media_id` 语义不变）。派生列加在内容图行 **和** 视频封面行上（封面是独立 image 行）。

| 列 | 说明 |
|---|---|
| `derived_s3_key` | varchar(512) NULL。相对 key：`chains/{chainId}/{momentId}/{mediaId}.derived.webp` |
| `derived_mime` | varchar(100) NULL，成功时 `image/webp` |
| `derived_size` | bigint NULL |
| `derived_width` / `derived_height` | int NULL |
| `derived_status` | enum(`pending`,`ready`,`skipped`,`failed`) NULL。非静态可压图恒 NULL |

「静态可压图」= `mime` 以 `image/` 开头且 **不是** `image/gif` / `image/heic` / `image/heif`。GIF / HEIC / HEIF / 音频 / 视频行 `derived_status` 恒 NULL，不 emit compress。

状态：

- emit compress 时置 `pending`（其余派生列保持 NULL）。
- 压完 `derived_size >= size`（没变小）：`skipped`，不 upload，派生列其余为 NULL。
- 成功：`ready` + 五列写齐。
- 终败（损坏、超 `MAX_IMAGE_BYTES`、sharp 解码失败）：`failed`，原因进 **该 outbox 行** `last_error`（见 §2.3）；媒体行 `derived_status=failed`。

时间线：内容图 `ready` 用派生；否则回退原图。Lightbox / 点开大图 **永远**原 `s3_key`（`MomentMedia.url`）。视频卡片的封面走 `posterDerivedUrl`（ready）否则 `posterUrl`。

`MomentMedia` 增加（`packages/dto/src/moments.ts`）：

```ts
/** 派生图稳定入口 `/api/media/:id?variant=derived`；仅 derived_status=ready 非空。不内嵌预签名（CONVENTIONS §3.4） */
derivedUrl: string | null;
/** 视频封面派生入口 `/api/media/:posterId?variant=derived`；仅视频行且封面 derived_status=ready 非空，否则 null。图片行恒 null */
posterDerivedUrl: string | null;
```

`serializeMoments` 在拼 media 时（poster 行仍从 `media[]` 排除，与现网一致）：

- `derivedUrl = derived_status==='ready' ? `/api/media/${id}?variant=derived` : null`
- 视频行：查出 poster 行的 derived 状态，`posterDerivedUrl = poster ready ? `/api/media/${posterMediaId}?variant=derived` : null`；`posterUrl` / `posterMediaId` 语义不变。

share-album 同样输出 `derivedUrl` / `posterDerivedUrl`（这是图，不是 persons/place；隐私红线不覆盖媒体本体——与现网原图一致）。`PublicShareMoment = Omit<MomentResponse, 'persons' | 'place'>` 会自动带上新 media 字段。

### 2.2 MySQL `moments.embed_hash`

`char(64) NULL`。镜像 M1 `ai_extract_hash`（`apps/server/src/moments/ai-extract-hash.ts` 范式，**另函数** `computeEmbedHash` 于 `apps/server/src/moments/embed-hash.ts`，不改 extract hash 语义）。

```
sha256(
  content + '\0' + (transcript ?? '') + '\0' +
  personNames.sort().join('\n') + '\0' +
  (place_name ?? '') + '\0' +
  derivedFingerprint + '\0' +
  model + ':' + dim
)
```

- `personNames`：该时刻当前 `moment_persons` 关联人名，经 `normalizePersonName` 后排序。
- `derivedFingerprint`：该时刻 **所有静态可压图行**（含 poster 行；不含 GIF/HEIC/HEIF/音视频）按 `sortOrder,id` 排序后 `mediaId:derived_status:derived_s3_key??'-'` 用 `\n` 拼接。`pending` / `failed` 变化也会改 hash，避免未压完就嵌、失败重压后不重嵌。
- `model` / `dim` 取 config `MULTIMODAL_EMBEDDING_MODEL` / `MULTIMODAL_EMBEDDING_DIMENSION`。
- hash 相同则 embed handler 不打 API、不写 Lance。

### 2.3 outbox

`apps/server/src/outbox/types.ts` 追加（既有常量不改）：

```ts
export const OUTBOX_MOMENT_COMPRESS = 'moment.compress';
export const OUTBOX_MOMENT_EMBED = 'moment.embed';
```

payload（camelCase，对齐已落地的 M1 geocode/extract，**不是** M1 spec 草稿里的 snake_case）：

- compress：`{ momentId: string, chainId: string, mediaId: string }`
- embed：`{ momentId: string, chainId: string }`

`outbox` 表 **追加** `last_error varchar(512) NULL`（CONVENTIONS §3.2 既有列不改名；本列仅追加）。**不**由 handler 自己改 `outbox.status`（否则 processor 成功路径会覆盖成 `done`）。

`runOutboxBatch`（`apps/server/src/worker/processor.ts`）在既有退避语义上追加：

- handler 正常返回 → `status=done`，`last_error=null`。
- handler throw 且 `attempts > 5` → `status=failed`，`last_error = String(err.message ?? err).slice(0, 512)`。
- handler throw 且仍可退避 → 保持 `pending`，同样写入 `last_error`（处理中分区能看到最近一次原因）。
- 未注册 type → 与现网一样直接 `failed`，`last_error='NO_HANDLER'`。

compress / embed 的可重试错误（存储/网络/DashScope 5xx/超时）直接 throw，走既有 5 档退避。

终败（损坏图、sharp 解码失败、超 maxBytes、DashScope 4xx 以外的不可恢复）throw `NonRetryableCompressError` / `NonRetryableEmbeddingError`（`error.name` 钉死这两字符串）。**processor 对这两种 name 立即 `status=failed` + 写 `last_error`，不占 5 档退避**（与 transcribe 在 handler 内吞掉 NonRetryableLLMError 不同：压缩失败必须让 outbox 停在 `failed`，否则 jobs 默认 `pending,failed` 看不到）。不得把这套立即失败扩到既有 `NonRetryableLLMError`（extract/recap 仍走 5 档，M1 语义不动）。handler 在 throw 终败前把媒体行写成 `derived_status=failed`。

### 2.4 存储适配器

CONVENTIONS §3.3 既有方法名零改动。**追加**：

```ts
getObject(key: string, metadata: StorageMetadata, maxBytes: number): Promise<Buffer>;
```

超 `maxBytes` 抛错。`maxBytes = MAX_IMAGE_BYTES`（dto 已有 `10 * 1024 * 1024`）。实现必须按行上 `storageMeta` 选桶/endpoint（与 `generateAccessUrl` 同），内部走 SDK GetObject / 有界流式读取，不得无界缓冲。测试 mock 点与现有 `UnifiedStorageAdapter` 相同（`tests/helpers/storage.ts` 补 `getObject`）。

本 spec **不**用「预签名 GET + fetch」做 compress/embed 读字节（避免再开一条与 ASR 相同的可达性假设）。ASR 预签名拉音频的现网路径不动。

### 2.5 LanceDB 表 `moment_vectors`

包：`@lancedb/lancedb`（用法参考 aimo `apps/server/src/sources/lancedb.ts`：connect、openTable、search、add/merge insert）。模块放 `apps/server/src/lancedb/`（factory + schema + repository），**不**把完整 moment 标量复制进 Lance（有意偏离 aimo 后期「整行进 Lance」——MySQL 仍是时刻真相源）。

Apache Arrow schema：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | Utf8 PK | `moment:{momentId}` 或 `media:{mediaId}` |
| `momentId` | Utf8 | 时刻 id |
| `chainId` | Utf8 | 链 id（检索 `where chainId IN (...)`） |
| `kind` | Utf8 | `moment` \| `image` |
| `mediaId` | Utf8 | 主向量空串 `""`；附图为 media id |
| `vector` | FixedSizeList N × Float32 | `N = config.MULTIMODAL_EMBEDDING_DIMENSION`（ensure 时按 config 建表；默认 2560）。换维必须换目录或删表 |
| `modelHash` | Utf8 | sha256(`${model}:${dim}:${outputType}`) 的 hex（64 字符） |

upsert：Lance `mergeInsert` 按 `id`。家庭量级 **不建 IVF**，暴力距离。检索过滤用 Lance `.where` 字符串；拼进 where 的 id **必须**先经 uuid 正则（`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`），否则丢弃该 id 并 warn（防拼接注入）。

测试：`LANCEDB_PATH` 由 `.env.test` / 默认 `./lancedb_data`（gitignore）；`resetLanceForTests()` 删表重建。**不**进入 MySQL `resetDb()`。

### 2.6 迁移与回滚

- MySQL：`media` 六列 + `moments.embed_hash` + `outbox.last_error`，全部可空/NULL 默认，无存量回填。`drizzle-kit generate`。派生图靠 compress 增量；存量时刻靠 §11 `backfill:embed`。
- `resetDb()`：无新表则删除顺序不变。
- 回滚 = drop 上述八列 + 删除 Lance 目录。旧客户端忽略 `derivedUrl` / `posterDerivedUrl`。
- gitignore 增加 `apps/server/lancedb_data/` 与仓库根 `lancedb_data/`（默认相对 cwd）。

### 2.7 索引

- `person_id`：已有 M1 `idx_moment_persons_person_moment`。
- `place_name`：**不加**（M1 §10）。等值过滤在链内小集。
- `happened_from/to`：走已有 `moments(chain_id, happened_at, id)`。
- `wall_date`：已有 `idx_moments_wall_date`（那年今日）；意图 `wall_date` 等值走该索引。

## 3. 意图理解

建基于 M1 §5 抽取 prompt 范式（只要 JSON、截断声明、畸形当降级）与 `getLLMProvider()` 三态。**不**改 `LLMProvider.chat` 签名。只在 `POST /api/search` 调用。chip GET **零** LLM。意图调用包一层 `Promise.race` 实现 8s 超时（不改 provider）。**不**内部重试（与 extract 的两次解析重试不同：用户在等）。

### 3.1 请求与输出

`q` 与 `INTENT_MAX_QUERY_CHARS = 500` 同一上限：zod `max(500)` 超长直接 400 `VALIDATION_ERROR`，prompt 内不再二次截断。`temperature = 0`。`maxTokens = 512`。不把链词典塞进 prompt。

```ts
export type SearchTime =
  | { kind: 'range'; from: string; to: string }      // ISO datetime，happened_at 闭区间
  | { kind: 'wall_date'; year: number; month: number; day: number }; // month 1..12 / day 1..31

export interface SearchParsed {
  personNames: string[];
  place: string | null;
  time: SearchTime | null;
  text: string;
}
```

系统 prompt（实施须逐字进 `apps/server/src/llm/intent/prompt.ts`）：

```
你是家庭时光链的搜索意图解析器。把用户的一句话解析成过滤条件。
只返回一个 JSON 对象，不要 markdown、不要解释。
JSON：
{
  "personNames": ["<人名或亲属称谓>"],
  "place": "<地名或场所短语或 null>",
  "time": { "kind": "range", "from": "<ISO>", "to": "<ISO>" } | { "kind": "wall_date", "year": <number>, "month": <1-12>, "day": <1-31> } | null,
  "text": "<扣掉已识别实体后用于语义搜索的剩余文本>"
}
规则：
1. personNames：只抽人名与亲属称谓，原样保留；不抽「我」「你」「咱们」。没有则为 []。不要抽标签名。
2. place：文本中的地名/场所；没有则为 null。不要编造。
3. time：「去年今天」「N 年前的今天」用 wall_date（年份=查看者今年-N，月日=查看者今天）；「去年夏天」等用 range。没有时间则为 null。
4. 季节按北半球气象季节、查看者本地年锚定：春 03-01～05-31，夏 06-01～08-31，秋 09-01～11-30，冬 12-01～次年 02-28（闰年 02-29）。from=该本地日 00:00:00.000、to=该本地日 23:59:59.999，输出带时区的 ISO（可用 Z）。「去年夏天」= 查看者今年-1 的夏天。
5. text：去掉已抽的人名、地名、时间短语后的剩余；若整句都是实体则为 ""。
6. 只根据给定查询，不要编造未出现的实体。
```

user prompt 带 `# 查询` + `q` + `# 查看者本地日期` `YYYY-MM-DD` + `# 时区偏移分钟` `tzOffset`（语义同 JS `getTimezoneOffset`，东八区 = -480）。

查看者本地日期（与 `apps/server/src/moments/wall-date.ts` 同一算术）：

```
shifted = Date.now() - tzOffset * 60_000
viewerDate = UTC 历法日 YYYY-MM-DD（getUTCFullYear/Month/Date）
```

「那年今日」两套时钟（memories-today spec §2）仍然成立：`wall_date` 是**记录者**时区墙钟日，搜索「去年今天」用查看者今天的月日去等值匹配记录者墙钟日。

解析防御对齐 `parseExtractJson`：剥 ```json 围栏；`personNames` 必须是 string 数组（元素非 string 丢弃；缺字段或非数组 = 畸形）；`place` 为 string 或 null；`time` 为合法 `SearchTime` 或 null；`text` 必须是 string（缺省当 `""`）。`time.kind=range` 的 `from`/`to` 必须通过与 feed 相同的 `isoDatetime` 正则，且 `Date.parse(from) <= Date.parse(to)`，否则畸形。`wall_date` 的 year/month/day 必须是整数，year ≥ 1，month 1..12，day 1..31，否则畸形。非法则 **本请求当空 key**（`parsed = { personNames:[], place:null, time:null, text:q }`），打 warn，不 500。RetryableLLMError / 超时同样降级，不 500。

### 3.2 服务端解析

可见链 `scope = getMyChains ∩ (chainIds ?? 全部)`。未授权的 `chainIds` 项静默丢弃（与 feed `chain_ids` 相同，不 403、不泄露存在性）。空 scope → 空页（坏游标仍 400 `INVALID_CURSOR`）。

人名按链解析（跨链同名是不同 id）：

1. 每条 `personNames[i]` 做 `normalizePersonName`（trim + 去内部连续空白）；空串丢弃。
2. 在 **该链** `persons` 上 `(chain_id, name)` 等值查找。
3. **同一链内多个命中 id AND**（时刻必须同时关联这些 person；两个 `moment_persons` semi-join）。
4. 某名字在该链没有词典行 → 该名字在该链不加过滤。
5. **丢链规则**：若 `personNames` 归一化后非空，且该链 **0 个名字命中**，则：
   - 若该请求对该链还有其它约束（解析出的 time、硬 place、非空 `text`、或请求体 `personId`/`tagId`/`place`/`happenedFrom`/`happenedTo`）→ 保留该链，不加人物过滤（「仍可被时间/地点/向量命中」）。
   - 若没有任何其它约束 → **从本次 scope 去掉该链**（禁止把整条链时间线当作「外婆」的结果）。
6. 所有链都被丢掉 → 空页。
7. SQL 形状是按链析取，**不能**把跨链的不同 `person_id` 压成 `queryMomentPage` 的单个 `personId`。GET chip 仍用单 `person_id`；`POST /api/search` 在 `search.service.ts` 组：

```
(chain_id = c1 AND id IN (person_id = p11) AND id IN (person_id = p12))
OR (chain_id = c2 AND id IN (person_id = p2))
OR (chain_id = c3 /* 无人名命中但未丢链 */)
```

再与下面的全局条件 AND。

其它解析：

- `place`（解析结果）：trim 后截断到 255（与 `place_name` 列宽一致）。先在 scope 内 `eq(moments.placeName, place)` 且未软删计数；**零命中** → 不把 place 当硬过滤，把该字符串并入 `text`（空 `text` 则 `text = place`）。有命中 → 全局 `place_name` 等值硬过滤。
- `time.kind=range`：`happened_at` 闭区间 `[from, to]`（`gte` + `lte`）。
- `time.kind=wall_date`：`moments.wall_date = YYYY-MM-DD`。2-29 仅闰年有行（与那年今日 spec 相同）。**不**调用 `/api/memories/today`。
- 请求体自带的 `personId`/`tagId`/`place`/`happenedFrom`/`happenedTo` 与解析结果 **AND**。请求体 `place` **不做**零命中降级（用户点了地点 chip）。请求体 `Date.parse(happenedFrom) > Date.parse(happenedTo)` → 400 `VALIDATION_ERROR`（zod superRefine，不降级）。

GET chip 的单 `person_id` 他链/不存在 → 空列表，不 404（与现网 `tag_id` 相同）。

### 3.3 降级

| 条件 | 行为 |
|---|---|
| `getLLMProvider()===null` | `parsed = { personNames:[], place:null, time:null, text:q }` |
| JSON 畸形 / 8s 超时 / RetryableLLMError | 同上，日志 warn |
| 有 `text` 且 `getEmbeddingProvider()===null` | 不用 Lance；MySQL `content`/`transcript`/`place_name`/`persons.name` 对 `text` 做转义后 `LIKE %text%` **OR**，再 AND 硬过滤，`happened_at DESC, id DESC` |
| LLM 与 embedding 皆空，且无硬过滤 | 等同今天 feed 首页（scope 内 `happened_at DESC, id DESC`）；`parsed.text === q` |
| 有 embedding 但 Lance 候选在丢弃 `modelHash` 不匹配后为空 | **不**回退 LIKE（排序键不能从距离切到时间）。空页 + warn。换模型未回填完时即此形态 |

`LIKE` 必须转义 `\`、`%`、`_`（先 `\` 再 `%` `_`），SQL `ESCAPE '\\'`。`persons.name` 经 `moment_persons` 关联，且 `moments.chain_id IN scope`、`deleted_at IS NULL`。

## 4. 向量召回

### 4.1 Provider

新模块 `apps/server/src/embedding/`：`base.provider.ts` + `dashscope-multimodal.provider.ts` + `factory.ts`。

三态与 `getLLMProvider` / `getGeocodeProvider` / `getASRProvider` 同形：

```ts
export function getEmbeddingProvider(): EmbeddingProvider | null;
export function setEmbeddingProvider(p: EmbeddingProvider | null | undefined): void;
```

`null` 当：`DASHSCOPE_API_KEY===''` **或** `MULTIMODAL_EMBEDDING_ENABLED===false`。

```ts
export type EmbeddingModality = 'text' | 'image' | 'vl';
export interface EmbeddingRequest {
  text?: string;
  /** 派生 WebP 的 data URI：`data:image/webp;base64,...`。禁止原图、禁止公网 URL */
  imageDataUri?: string;
}
export interface EmbeddingProvider {
  embed(req: EmbeddingRequest): Promise<number[]>; // length === config dim
  modelHash(): string; // sha256(`${model}:${dim}:${outputType}`) hex
  dimensions(): number;
}
```

模态：仅 `text` → text；仅 `imageDataUri` → image；两者都有 → vl。两者都缺 → 调用方不得调用。

HTTP：`POST {DASHSCOPE_BASE_URL}/services/embeddings/multimodal-embedding/multimodal-embedding`，`Authorization: Bearer`。

```
{
  "model": "<MULTIMODAL_EMBEDDING_MODEL>",
  "input": { "contents": [ /* {"text":"..."} 和/或 {"image":"data:image/webp;base64,..."} */ ] },
  "parameters": {
    "dimension": <MULTIMODAL_EMBEDDING_DIMENSION>,
    "output_type": "<MULTIMODAL_EMBEDDING_OUTPUT_TYPE>",
    "enable_fusion": true   // 仅 vl（contents.length > 1）；text-only / image-only 不设
  }
}
```

若官方把 `enable_fusion` 放在 body 顶层，实施与官方文档对齐；测试用 nock 钉死实际 JSON。超时 20s；429/5xx/网络/超时 → `RetryableEmbeddingError`；其它 4xx → `NonRetryableEmbeddingError`。响应向量长度必须等于 config dim，否则当 NonRetryable。

环境变量（`config.ts` zod + `.env.example`；**不**写/覆盖 `apps/server/.env`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MULTIMODAL_EMBEDDING_ENABLED` | `true`（`enum true/false` + transform，与现有 boolean 同形，禁止 `z.coerce.boolean()`） | 与空 key 任一即停用 |
| `MULTIMODAL_EMBEDDING_MODEL` | `qwen3-vl-embedding` | |
| `DASHSCOPE_API_KEY` | `''` | **不**回退 `ASR_API_KEY`；运维可填同一值 |
| `DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/api/v1` | |
| `MULTIMODAL_EMBEDDING_DIMENSION` | `2560` | 须 ∈ `{2560,2048,1536,1024,768,512,256}`，否则进程启动 zod 失败 |
| `MULTIMODAL_EMBEDDING_OUTPUT_TYPE` | `dense` | |
| `LANCEDB_PATH` | `./lancedb_data` | server 独占目录 |
| `BA_AUTH_TOKEN` | `''` | 空 → 内部口一律 401 `BA_NOT_CONFIGURED` |
| `INTERNAL_API_BASE_URL` | `http://127.0.0.1:3000` | 写入 `config.ts`（两进程同 schema）；**仅 worker embed handler** 的 `DELETE`/`POST /api/internal/embeddings` 读它，server 忽略 |

`MULTIMODAL_EMBEDDING_VIDEO_FPS` **本轮不读**（不做视频向量）。**不**引入 `EMBEDDING_IMAGE_URL_TTL_SECONDS`（图走 data URI，无预签名 TTL）。

换模型或维度：与表 FixedSizeList 不兼容；换 `LANCEDB_PATH` 子目录或删表 + 全量回填。检索丢弃 `modelHash` 不一致的行并 warn。

### 4.2 compress handler

`handleMomentCompress`：

1. 重读 media：不存在 / 无 moment / 时刻已软删 → 跳过（outbox done，不写 failed）。
2. mime 非静态可压图（含 GIF/HEIC/HEIF）→ 跳过，**不改** `derived_*`（保持 NULL；create 本不应 emit）。
3. `getObject(s3Key, storageMeta, MAX_IMAGE_BYTES)`。超限 → 置 `failed`，throw `NonRetryableCompressError`。
4. `sharp(buf).rotate().resize({ width:1280, height:1280, fit:'inside', withoutEnlargement:true }).webp({ quality:85 })`。解码失败 → 置 `failed`，throw `NonRetryableCompressError`。
5. 若输出 length ≥ 原 `size` → `skipped`，不 upload。
6. 否则 `uploadFile(derivedKey, webpBuf)`（现网签名无 meta，写入当前桶；MVP 单桶，与原图同一 `storage_meta` 快照），写 derived 列 `ready`（key / mime=`image/webp` / size / width / height / status）。
7. 若该 `momentId` 下所有静态可压图均已终态（`derived_status ∈ {ready,skipped,failed}`，无 `pending`）且 `computeEmbedHash` ≠ `embed_hash` → 同事务 `emitOutbox(moment.embed)`。**failed 图不阻塞 embed**（组装时只纳入 ready 图；failed 重压成功会改 fingerprint 再嵌）。embed 读的是原图，不消费刚写入的 derived 对象。

create：对每张静态可压图 emit compress（置 pending）。GIF/HEIC/HEIF **不** emit、`derived_status` 保持 NULL。无待压图且 hash 变 → 直接 embed。已 `ready` 且 hash 未变不重发（create 新媒体行派生列 NULL，故首次必压）。

PATCH 不能改媒体，故 update 不发 compress。

### 4.3 embed handler

`handleMomentEmbed`（在 worker）：

1. 重读 moment：无/软删 → 跳过。
2. `getEmbeddingProvider()===null` → 跳过（不写 hash，恢复 key 后回填/下次变化再嵌）。
3. `computeEmbedHash === embed_hash` → 跳过。
4. 组装文本：`content`、`transcript`、人名排序、`place_name`，用换行拼接，去首尾空。空则无文本。
5. 图：`derived_status=ready` 的静态可压图（**含 poster 行**），按 `sortOrder,id`。第一张 = 下标 0。对每张 `getObject(s3_key, storageMeta, MAX_IMAGE_BYTES)`（原图）再 `compressToEmbedWebp`（最长边 1024、质量 80）做成 `data:image/webp;base64,...`。该 buffer **禁止** `uploadFile`。解码失败 → `NonRetryableEmbeddingError`。
6. 先 HTTP `DELETE {INTERNAL_API_BASE_URL}/api/internal/embeddings/:momentId` 清该 moment 旧向量（handler 在 worker，必须 HTTP，禁止直连 Lance）。
7. 调用（每次 BA POST 一条）：
   - 有文本且有第一张：`vl` { text, imageDataUri } → upsert `kind=moment` `id=moment:{momentId}`
   - 仅文本：`text` → `kind=moment`
   - 仅第一张：`image` → `kind=moment`（主向量仍 moment id，便于「只有图」）
   - 无文本无图：只 DELETE，**不写 hash**（下次素材出现再嵌）
   - 其余 ready 图：各 `image` → `kind=image` `id=media:{mediaId}` `mediaId=<id>`
8. 全部 BA 2xx 后写 `embed_hash`。任一步可重试错误 throw（processor 退避；已 upsert 的行下次 DELETE 后重写，幂等）。

### 4.4 重嵌触发

| 事件 | 动作 |
|---|---|
| create 素材 | 有待压图 compress 链；无待压图且 hash 变 → embed |
| 该时刻可压图全部终态 | 同事务 embed（hash 变才发） |
| create/update 导致 hash 变（正文/人物/地点） | 无 pending 图则直接 embed |
| extract `persistExtraction` 成功后 | 同事务若 hash 变 → embed（不改抽取语义） |
| geocode 回填 `place_name` 成功 | 同事务若 hash 变 → embed |
| transcribe 回填 `transcript` 成功 | 除已有 extract emit 外，同事务若 hash 变 → **直接 embed**（extract 因空 LLM 跳过时 transcript 仍必须进向量） |
| PATCH person 改名（名字确实变化） | 查出该 `person_id` 全部 momentId（`idx_moment_persons_person_moment`），逐条 embed（可分批 emit，不当请求同步；同名幂等返回则不发） |
| DELETE person | **先**查出关联 momentId，再删关联+词典（M1 语义）；受影响时刻 emit embed |
| 时刻软删 / 链删除 | server 直接删 Lance 行 |

emit embed 前若该 momentId 已有 `pending` 的 `moment.embed` outbox 行，仍允许再插一行（与 extract 偏差 8 相同）；消费侧 hash 幂等吸收。回填脚本必须做 pending 去重（§11）。

### 4.5 查询期向量

`text` 非空且 provider 非 null：server 调 `embed({ text })` 得查询向量（纯 text 模态，不设 `enable_fusion`）。

常量 `VECTOR_CANDIDATE_LIMIT = 200`、`HARD_FILTER_PREFILTER_MAX = 200`。家庭可见范围远小于 200；向量路 **每次**从 Lance 取最多 200 条近邻（kind 混合），在内存按 `momentId` 去重保留最小 `_distance`，再应用硬过滤、软删、scope、`modelHash`、游标，最后截 `limit`。禁止只取 `limit*3` 全局 top-k 再翻页（第 2 页会空）。超过 200 的近邻窗口截断，不保证全局第 201 近出现（§10 演进 IVF）。

硬过滤命中数 **< 200**：先 MySQL 圈 id（0 条 → 空页，不调 Lance）；Lance `.where` 加 `chainId IN` **且** `momentId IN (...)`。≥200 或无硬过滤：Lance 先召回 200，再 MySQL AND（无硬过滤则只校验仍在 scope 且 `deleted_at IS NULL`）。

`modelHash` 不匹配的行丢弃。

## 5. 融合与分页

不用产品层 RRF，不用 Lance BM25（不把正文作 Lance text 字段）。

| 形态 | 召回 | 排序 | 游标 |
|---|---|---|---|
| 仅硬过滤（含 chip GET，以及 POST search 在 `text===""` 时） | MySQL | `happened_at DESC, id DESC` | CONVENTIONS `{h,i}` |
| 仅 `text` + 有 embedding | Lance 200 近邻 | `_distance ASC, momentId DESC` | `{d:number, i:string}` |
| 仅 `text` + 无 embedding | LIKE OR | `happened_at DESC, id DESC` | `{h,i}` |
| 硬过滤 + `text` + embedding | §4.5 求交 | 距离 | `{d,i}` |
| GET 无过滤无 q | 现 feed / 链列表 | `happened_at` 或 `created_at` | `{h,i}` 或 `{c,i}` |

chip GET **永不**走向量、**永不** `{d,i}`。`POST /api/search` 的 `q` 必填，不存在「无 q」形态。`POST /api/search` 才可能 `{d,i}`。

向量游标放 `apps/server/src/search/search-cursor.ts`（CONVENTIONS §3.4「第二份游标」仅约束 moments 列表；search 与 `comment-cursor.ts` 同属另域）。格式 `base64url(JSON)`。坏串 / `d` 非有限 number（`NaN`/`Infinity`）/ `i` 非非空字符串 → `INVALID_CURSOR`。下一页：`distance > d OR (distance = d AND id < i)`（与 `_distance ASC, momentId DESC` 一致：同距已出示更大 id，余下更小 id）。`d` 必须是有限 number，原样回传 Lance 给出的 `_distance`，不用再四舍五入。

`limit` 默认 20、最大 50（`SEARCH_DEFAULT_LIMIT` / `SEARCH_MAX_LIMIT`）。去重求交截断后再编游标；不足一页则 `nextCursor=null`（即使 Lance 窗口还有更远向量，家庭量级 200 已覆盖）。

跨链：全局按排序键混排。search **忽略** `order=created_at`（body 无此字段）。

响应序列化：`serializeMoments(rows, userId, { includePrivate: true })`。share-album 无搜索、无 jobs。

## 6. API 设计

### 6.1 GET 硬过滤

扩展 `feedQuerySchema` 与 `listMomentsQuerySchema`（app 链页走 `listChainMoments`，web 链页走 `getFeed`+`chainIds`，**两端都要能滤**）。HTTP query 一律 snake_case。`happened_from` / `happened_to` 使用与 feed `before` 相同的 `isoDatetime`（从 `packages/dto/src/feed.ts` **导出**复用；`listMomentsQuerySchema` 既有 `before` 仍用现在的 `isoTimestampSchema`，不改既有松紧）。

```ts
person_id: z.string().regex(uuidLoose).optional(), // 与既有 tag_id 同一正则，不要用更严的 z.string().uuid()
place: z.string().trim().min(1).max(255).optional(),
happened_from: isoDatetime.optional(),
happened_to: isoDatetime.optional(),
```

`feedQuerySchema` superRefine 追加：

- `Date.parse(happened_from) > Date.parse(happened_to)` → `VALIDATION_ERROR`（禁止用 ISO 字符串直接 `>`，带偏移的串字典序不可靠）。
- (`happened_from` 或 `happened_to`) 与 `order=created_at` 共存 → 400 `RANGE_REQUIRES_HAPPENED_AT`。
- 既有 `before` + `created_at` → 仍为 `BEFORE_REQUIRES_HAPPENED_AT`（不改名）。

链内列表恒 `happened_at`，`RANGE_REQUIRES_HAPPENED_AT` 只出现在 feed。`happened_*` 与 `before`（严格 `<`）共存：AND 取更严上界。

`queryMomentPage` 增加可选 `personId`/`place`/`happenedFrom`/`happenedTo`：

- `personId`：`inArray(moments.id, select momentId from moment_persons where person_id=?)`（同 `tagId`）
- `place`：`eq(moments.placeName, place)`（硬等值，零命中空页）
- 时间：`gte`/`lte` `happened_at`

month-index **不加**这些参数。

链列表 GET 改为 `listMomentsQuerySchema.parse(req.query)`（与 feed 一样吃 query object），再映射进 `MomentService.list`；`limit` 仍在 service 层解析，非法 → `INVALID_LIMIT`（保持现网，不改成 zod coerce）。

`FeedQuery`（api-client）增加 camelCase `personId`/`place`/`happenedFrom`/`happenedTo`，序列化 snake_case。`listChainMoments` 的 query 同样 camelCase → `person_id` / `place` / `happened_from` / `happened_to`。

### 6.2 `POST /api/search`

`@Authorized()`。**非**链嵌套（跨链，与 `/api/feed` 同级）。Controller `apps/server/src/search/`（`app.ts` 的 `controllers` 数组追加 `SearchController`）。dto 新文件 `packages/dto/src/search.ts`（barrel 导出）。

挂限流：`searchRateLimiter`，60s / 20 次 / `ipKey + userId`（测试环境 1000，与现网 limiter 同形）；命中 429 `RATE_LIMITED`。挂在 `populateUser` 之后、routing-controllers 之前，仿 inviteAccept。

```ts
export const searchInputSchema = z.object({
  q: z.string().trim().min(1).max(500),
  chainIds: z.array(z.string().uuid()).optional(),
  tzOffset: z.number().int().min(-840).max(840),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  personId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  place: z.string().trim().min(1).max(255).optional(),
  happenedFrom: isoDatetime.optional(),
  happenedTo: isoDatetime.optional(),
}).superRefine((val, ctx) => {
  if (val.happenedFrom && val.happenedTo && Date.parse(val.happenedFrom) > Date.parse(val.happenedTo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happenedTo'] });
  }
});
export interface SearchResponse {
  moments: MomentResponse[];
  nextCursor: string | null;
  parsed: SearchParsed;
}
```

`tzOffset` 必填。`limit` 缺省 20。降级时 `parsed.text === q`，其它字段空。body **无** `before`、**无** `order`、**无** `source`。

api-client：`searchMoments(input: SearchInput): Promise<SearchResponse>`（`SearchInput = z.infer<typeof searchInputSchema>`），JSON POST，不走 query string。

错误码：`VALIDATION_ERROR`、`INVALID_CURSOR`、`RATE_LIMITED`、`UNAUTHORIZED`。不因缺 LLM/embedding 返回 5xx。本期 search **不**返回 `RANGE_REQUIRES_HAPPENED_AT`。

### 6.3 BA 内部

中间件 `apps/server/src/embeddings/ba-auth.ts`。Controller `apps/server/src/embeddings/internal.controller.ts`（`app.ts` controllers 追加）。**无** `@Authorized()`（worker 不持 JWT）。`populateUser` 遇到 BA token 会 JWT 校验失败并保持匿名，不影响后续 BA 中间件。

错误走 Moment `{error:{code,message}}`。

- `BA_AUTH_TOKEN===''`：无论是否带 Authorization，一律 401 `BA_NOT_CONFIGURED`（不区分「没传」以免探测开关）。
- 已配置：无 `Authorization` 或不 `Bearer` 或 token 不恒等 → 401 `BA_AUTH_INVALID`。
- 比较：长度不等先 false；等长则 `crypto.timingSafeEqual`。

`POST /api/internal/embeddings`

```ts
{
  momentId: uuid,
  chainId: uuid,
  kind: 'moment' | 'image',
  mediaId?: uuid,           // kind=image 必填
  vector: number[],         // length === dim；express.json 1mb 足够一条 2560 维
  modelHash: string         // 64 字符 hex（zod length 64）
}
```

`vector.length !== dim` → 400 `EMBEDDING_DIM_MISMATCH`。`kind=image` 缺 `mediaId` → `VALIDATION_ERROR`。id 派生：`moment:{momentId}` / `media:{mediaId}`。upsert。200 `{ ok: true }`。

`DELETE /api/internal/embeddings/:momentId` → 删该 momentId 全部 kind。`:momentId` 非 uuid → 400 `VALIDATION_ERROR`。200 `{ deleted: number }`。

**不**进 `@moment/api-client`。worker 用内部 `fetch` + Bearer，10s abort；非 2xx / 网络错误 throw（processor 退避）。

### 6.4 任务列表

`GET /api/chains/:chainId/jobs`

Controller `apps/server/src/jobs/`（独立域，不塞进 search；`app.ts` controllers 追加）。`@UseBefore(requireChainRole('owner'))`。非成员 404 `CHAIN_NOT_FOUND`（policy 现网语义）；editor/viewer 成员 → 403 `CHAIN_ROLE_INSUFFICIENT`。

query：`status` 可选 csv，每一段必须是 `pending|failed|done`，非法 → `VALIDATION_ERROR`；默认 `pending,failed`；`limit` 1..50 默认 50。dto `packages/dto/src/jobs.ts`。

只选 `type ∈ {moment.compress, moment.embed}`。**应用层**过滤 `payload.chainId === params.chainId`（不依赖 MySQL JSON 函数）。缺 `payload.momentId` 的脏行跳过并 warn。无游标；`ORDER BY created_at DESC`（最近优先）。超过 50 条 v1 截断。

```ts
export interface ChainJobDto {
  id: string;
  type: 'moment.compress' | 'moment.embed';
  status: 'pending' | 'done' | 'failed';
  momentId: string;
  mediaId: string | null; // compress 取 payload.mediaId；embed 恒 null
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}
export interface ChainJobListResponse { jobs: ChainJobDto[] }
```

v1 **无** 重试端点。

api-client：`listChainJobs(chainId: string, query?: { status?: string; limit?: number }): Promise<ChainJobListResponse>`。

### 6.5 媒体派生

`GET /api/media/:id?variant=derived`：

- `variant` 缺省或 `original`：保持现网（签 `s3_key`）。
- `variant=derived`：行非 `derived_status=ready` 或 `derived_s3_key` 空 → 404 `DERIVED_NOT_READY`（不回退原图）。
- 其它 `variant` 值 → 400 `VALIDATION_ERROR`。
- 鉴权与现 `resolveAccessUrl` 相同（链 viewer / `st=`），签名 **derived_s3_key**，TTL 仍走 `alignedGetPresign()`。
- Cache-Control 保持现网 `private, max-age=300`。

客户端：仅当 serializer 给出非空 `derivedUrl` / `posterDerivedUrl` 时才请求 `variant=derived`；若 404/blob 失败，回退 `url` / `posterUrl`，不把死链留给用户。

api-client：

```ts
mediaUrl(mediaId: string, opts?: { variant?: 'original' | 'derived'; st?: string }): string;
fetchMediaBlob(mediaId: string, opts?: { variant?: 'original' | 'derived' }): Promise<Blob>;
```

`useMediaObjectUrl(mediaId, { variant })` / `useMediaUri(mediaId, { variant })` 的缓存键必须含 variant（`{mediaId}:{variant}`），禁止 derived 与 original 共用同一 object URL。

### 6.6 错误码汇总（UPPER_SNAKE，HttpError `message` = 机器码）

| 码 | HTTP | 何时 |
|---|---|---|
| `BA_NOT_CONFIGURED` | 401 | 内部口，token 未配置 |
| `BA_AUTH_INVALID` | 401 | 内部口，token 错/缺（已配置时） |
| `EMBEDDING_DIM_MISMATCH` | 400 | BA vector 长度 ≠ dim |
| `DERIVED_NOT_READY` | 404 | `variant=derived` 但行未 ready |
| `RANGE_REQUIRES_HAPPENED_AT` | 400 | feed `happened_from/to` + `order=created_at` |
| `BEFORE_REQUIRES_HAPPENED_AT` | 400 | 既有：`before` + `created_at`（不改名） |
| `INVALID_CURSOR` | 400 | 既有 + 向量游标坏串 |
| `VALIDATION_ERROR` | 400 | zod / 非法 jobs status / 非法 variant / range from>to |
| `CHAIN_ROLE_INSUFFICIENT` | 403 | 既有；jobs 非 owner |
| `CHAIN_NOT_FOUND` | 404 | 既有；jobs 非成员 |
| `INVALID_LIMIT` | 400 | 既有；仅链列表 GET |
| `RATE_LIMITED` | 429 | 既有；搜索 limiter 复用 |
| `UNAUTHORIZED` | 401 | 既有；搜索未登录 |

客户端搜索/过滤请求 **无** `source` 字段。

## 7. 各端 UX

设计系统：C 端规范 + Button/Field/Modal/Feedback/Menu spec（根 CLAUDE.md 列出的 6 份 web spec）；只消费 `tokens.css` 已发布 token，禁止页面写十六进制/一次性尺寸。分享页 `readOnly` / `PublicShareMoment`：无 persons/place、无搜索、无 jobs；chip 保持非按钮（键不存在则不渲染）。

### 7.1 点击过滤

链内人物 chip：`button`，`focus-visible:ring-focus`，AI 角标保留。点击设置页级 `personId`（**单选**，与 tag 同：再点同一人清除）。地点行「📍 {name}」可点，设置 `place` 等值。正文 tag 字本轮不新绑点击（过滤仍走轨）。

`RailFilter`（`apps/web/src/timeline/timeline-rail.tsx`）增 `personId?: string; place?: string`。`filtered` 含这两项（以及既有 tagId/order/before/chainIds）。清除 chip 展示在列表顶（「外婆 ×」「📍 朝阳公园 ×」）。web：rab 内存，`feedQuery()` 带出 `personId`/`place`；app：feed.service / chain-home.service 增同名字段，`getFeed` / `listChainMoments` 带 query；从卡片点人/地点 `hydrate` 写入（与现有 tag setter 同形）。

### 7.2 搜索框

feed-home 与 chain-home 主列顶部既有 `Field` + `Input`/`TextField`，`type="search"`（Field 已支持该 type，不新造 SearchBar）。占位「搜索时刻，例如 去年今天和外婆」。提交 `POST /api/search`（链页 `chainIds:[current]`，`tzOffset: currentTzOffset()`——web 已有 `apps/web/src/lib/time.ts`；app 用 `new Date().getTimezoneOffset()`）。结果替换 `moments`；`parsed` 做一条可关闭摘要。关闭摘要 = 退出搜索、回到 GET 时间线（清 search cursor，恢复 GET `{h,i}`）。

搜索与轨上硬过滤 AND：body 带当前 `personId`/`tagId`/`place`（**不**带 `before`）。翻页继续 POST，带 `cursor`/`parsed` 不回传（服务端每页重跑意图；家庭 q 短、LLM temperature=0）。

空态 `EmptyState`「没有找到相关时刻」。降级不 Toast。429 用既有 `humanError`。

**不做**：建议下拉、语音搜、保存搜索、URL 同步、按链分组。

### 7.3 媒体

`MediaBlock`：有 `derivedUrl` 时认证通道 `useMediaObjectUrl(id, { variant:'derived' })`。分享通道 **禁止** `` `${derivedUrl}?st=` ``（`derivedUrl` 已含 `?variant=derived`，再拼 `?st=` 会破坏 query）。一律走 api-client `mediaUrl(id, { variant:'derived', st })`，规则：已有 `?` 则 `&st=`，否则 `?st=`。P8 把现网 `url?st=` 抽成同一 helper，其它稳定入口（无 query 的 `url`/`posterUrl`）行为不变。Lightbox / 点开大图只用 `url`（原图，variant 默认 original）。无 `derivedUrl` 时卡片用原图，无「优化中」角标。

视频：封面优先 `posterDerivedUrl`（同源 hook + variant），否则 `posterUrl` / `posterMediaId`。

app `useMediaUri` 同样接受 `{ variant }`。

### 7.4 任务

`ChainSettingsSections` 的 `Section` 联合类型增 `'jobs'`；`items` 增 `{ key:'jobs', label:'处理中', show: owner }`。进入该分区时 load，可见时 10s 轮询（`JOBS_POLL_MS = 10000`），离开或 unmount 停止。列：类型文案（`moment.compress` →「压缩图」/ `moment.embed` →「索引」）、时刻 id 短摘要（前 8 位）、状态、次数、`lastError`、时间。空态「没有处理中的任务」。app 链设置同构，`useTheme()`。

## 8. 隐私与安全

建基于 M1 §6/§8：`serializeMoments` 默认 `includePrivate:false`；share-album 不传 → 零 persons/place。本 spec 不改变该默认。

### 出域

| 通道 | 内容 | 停用 |
|---|---|---|
| DashScope embedding | content、transcript、人名、地名、**派生 WebP 像素（base64 data URI）** | 空 `DASHSCOPE_API_KEY` 或 enabled=false |
| 意图 LLM | `q` ≤500 字 + 查看者本地日期 + tzOffset | 空 `LLM_API_KEY` |
| 高德 | 仍仅坐标（M1） | 空 `AMAP_WEB_KEY` |

不出域：原图像素给模型、坐标进 embedding、词典全量进意图 prompt、Lance 文件出容器、BA token 进前端包。

### M1 例外

仅 `moment.compress` 有界读**原图**；仅 `moment.embed` 有界读 **derived**。EXIF 仍只在前端（M1 §3）。禁止在 extract/search/controller 读任何对象像素。

### BA

token 只在 server/worker 环境；`.env.example` 留空。不进前端包。`/api/internal/*` 可被反代打到，但公网 nginx 404；无 token 401，body 不回是否配置以外的多余字段（空配置 code 固定 `BA_NOT_CONFIGURED`）。

### 越权

scope 只来自 `getMyChains`。Lance `chainId IN scope`。jobs 仅 owner。他链 person_id 空列表。搜索限流防刷 LLM。

## 9. 测试策略

`.claude/rules/testing.md`。Lance 临时目录 + `resetLanceForTests()`。mock：`setEmbeddingProvider`、`setLLMProvider`、存储 `getObject`/`uploadFile`。server 测试 `--runInBand`，触库 `afterAll(closeDb)`。**断言不指向生产库。**

server：

- GET `person_id`/`place`/`happened_from|to` 与 `tag_id`/`before` AND；`created_at`+区间 400 `RANGE_REQUIRES_HAPPENED_AT`；`happened_from > happened_to` 400。
- search：mock 意图硬过滤+向量；空 LLM；空 embedding LIKE（含 `%` `_` 转义）；坏 JSON 降级；scope 求交；跨链同名两人析取；「外婆」在无该人名且无其它约束的链上 **不**倾倒整链；季节 range 闭区间。
- 分层 C：仅 chip 不调 Lance / 不调 embedding；仅 text 调；混合结果皆含硬过滤实体。
- 游标 `{h,i}`/`{d,i}` 坏串 / 非有限 `d`；距离平局 `id` 降序。
- compress：fixture JPEG → ready、边 ≤512、mime webp；GIF/HEIC 不 emit、`derived_status` 仍 NULL、handler 误收到也不 `getObject`；超 maxBytes failed；failed 图不阻塞同刻其它图 embed。
- embed：vl + 附图条数；hash 二刷零 API；软删跳过；读的是 derived key 不是原图；空 provider 不写 hash。
- BA：空/错 token；dim 400；upsert 幂等；DELETE 清空；非 uuid 400。
- jobs：owner 200；editor 403；非成员 404；不含 extract；默认不返回 done。
- `derivedUrl` / `posterDerivedUrl` 仅 ready；includePrivate 双路回归（share-album 仍无 persons/place，但有 derivedUrl）。
- 链删后 Lance 无该 chainId（允许日志失败分支单测 mock throw）。
- 断言 GET 列表/search **不**调用 `getObject`。
- `createApp()` 不 connect Lance（既有测试不被 Lance 拖死）。

dto/api-client：新 query/body；`searchMoments`；`listChainJobs`；`fetchMediaBlob` variant；不封装 internal。

web/app：chip 可点/分享不可点；过滤清除；搜索 POST；jobs 仅 owner；MediaBlock 派生 vs Lightbox 原图；`useMediaObjectUrl` cache key 含 variant。

e2e：`apps/server/tests/search/` 建时刻（人+地点+图）→ compress mock → embed mock → GET person_id → POST search → share-album 仍无 persons/place。

## 10. 容量假设与演进路径

家庭：单链数十到数百时刻；可见链个位数；每时刻最多 1+8 条向量（主 + 最多 8 张附图；视频另加 poster）。暴力距离 + 200 近邻窗口足够。压图/embed 走 outbox 串行。派生图增加对象存储约一成到三成，时间线传输下降。

演进（本期不做）：

- `place_name` 索引：地点 chip 变热再加。
- Lance IVF：向量行稳定 > ~1 万。
- 向量落 MySQL / worker 直连 Lance：否。
- `multi_images` / 视频向量：换模型且有「搜画面」需求。
- 搜索 URL、按链分组、jobs 重试、jobs 游标、month-index 跟人/地、search 继承 `before`。
- Lance 纳入 backup sidecar（本轮只钉 volume 与敏感级 = MySQL）。
- persons 合并、地图足迹（M1 §10）。
- HEIC 解码（需 libheif 时再开；本轮不压，`derived_status` NULL）。
- 除 compress 原图 / embed derived 外任何服务端读像素。
- 公网开放 `/api/internal`。

## 11. 实施分期

| 期 | 内容 | 出口 |
|---|---|---|
| P1 | dto（列表 query、search、`MomentMedia.derivedUrl`/`posterDerivedUrl`、jobs）+ 迁移（media 派生六列、`embed_hash`、`outbox.last_error`）+ outbox 两常量 + `getObject` + processor 写 `last_error`（含对 `NonRetryableCompressError` / `NonRetryableEmbeddingError` 立即 failed） | 迁移通过；dto 测试绿；mock storage 含 `getObject` |
| P2 | `queryMomentPage` + GET feed/链列表过滤（含 `RANGE_REQUIRES_HAPPENED_AT`） | API 测试绿 |
| P3 | compress handler + `sharp` 依赖 + `variant=derived` + serializer `derivedUrl`/`posterDerivedUrl` + 媒体 GET | mock 存储绿；HEIC/GIF 不压。`sharp` 有 linuxmusl 预编译，可在现 alpine 镜像跑 |
| P4 | `src/lancedb` + `@lancedb/lancedb` + BA 内部口 + Dockerfile **改为 bookworm-slim** + 三份 compose volume（仅 server）+ nginx 拒绝 `/api/internal/` + gitignore + `BA_AUTH_*` / `INTERNAL_API_BASE_URL` / `LANCEDB_PATH` | BA 测试绿；production ensure 失败不可 listen。**生产部署 P4 必须先于或同批于依赖 Lance 的 P5** |
| P5 | `getEmbeddingProvider` + embed handler（data URI）+ hash + 删链/软删清向量 + 改名/extract/geocode/transcribe emit | mock DashScope 绿 |
| P6 | `POST /api/search` 意图 + 分层 C + 双游标 + 降级 + search 限流 | mock LLM/embedding 绿；丢链规则单测 |
| P7 | `GET .../jobs` owner | 角色测试绿 |
| P8 | api-client + web（chip、搜索框、派生图、处理中） | 组件测试 + 手测 |
| P9 | app 同构 | 手测 |
| P10 | e2e + `pnpm --filter @moment/server backfill:embed` | e2e 绿；二跑幂等 |

并行：P2 完成后 P8 的 chip 可先接 GET；搜索/派生/jobs 分别等 P6/P3/P7。P9 镜像 P8。P5 依赖 P3+P4；P6 依赖 P2+P5。

回填脚本 `apps/server/scripts/backfill-embed.ts`（`package.json` script `backfill:embed`），CLI 与 extract 回填同形：`pnpm --filter @moment/server backfill:embed -- [--batch 100] [--interval-ms 500]`。

1. `getEmbeddingProvider()===null` → 退出 0（不查询不发射）。
2. 扫描未软删时刻的静态可压图且 `derived_status IS NULL` 的 media，分批 emit `moment.compress`（已有 pending compress 去重）。
3. 扫描未软删、无 `pending` 可压图、且 `embed_hash IS NULL` 的时刻，分批 emit `moment.embed`（已有 pending embed 去重）。「过期 hash」不在 SQL 里算（fingerprint 需人名/派生列）；hash 过期靠日常写路径与 compress 终态触发。需要全量重嵌（换模型）时：**删 Lance 表或换 `LANCEDB_PATH` 子目录，并把未软删时刻 `embed_hash` 置 NULL** 后再跑本脚本。
4. 只发射不消费。空 key 退出。二跑幂等。

回填只走与 handler 相同的 embed + BA upsert，禁止在请求线程打模型。

---

M1 契约（persons 表与列、`serializeMoments`/`includePrivate`、`getLLMProvider`/`getGeocodeProvider` 三态、outbox `moment.geocode`/`moment.extract`、chain-policy、错误码机器名、feed `{h,i}/{c,i}` 游标、媒体稳定入口）本 spec **只追加不改语义**。若实施中发现与 M1 或 CONVENTIONS §3 冲突：停手报告，不得改 M1/CONVENTIONS 绕过。
