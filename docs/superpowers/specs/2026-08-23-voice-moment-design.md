# 时刻 Moment — 语音时刻（voice moment）Design

> 日期：2026-08-23
> 状态：设计已与用户对齐；2026-08-24 ASR provider 修订为 DashScope `fun-asr`
> 范围：dto + server（含 worker）+ web + app
> 权威边界：数据模型、权限模型、存储与上传管线语义以 `2026-08-15-moment-design.md` 为准；web/app UI 规范以根 CLAUDE.md 列出的 Web C 端设计规范与各端 CLAUDE.md 为准。本 spec 不改媒体权限（`GET /media/:id` 鉴权语义）与上传管线（presign → PUT/multipart → complete）语义，只在其上扩展 audio kind 与新 moment 类型。

## 0. 产品决策（记录对齐过程与搁置决策）

动机：降低记录门槛（抱娃/开车等空不出手的场景），并保留「声音本身」的纪念价值——宝宝的笑声、第一次叫奶奶，转写文本是副产品，语音才是主角。

已对齐的决策：

- **形态 = 独立 voice 类型（形态二）**：`moments.type` 新增第四种 `voice`，时间线卡片主体是语音播放条，文字是转写产物。曾对比「语音作为 media 宫格附件（形态一）」，结论是形态一回答「记录里附带声音」、形态二回答「记录就是声音」，后者才是降低记录门槛的主力；形态一（media 宫格混排 audio）明确**不做**，重启条件：出现「一组照片配多段语音解说」的真实高频诉求。
- **可附图**：voice moment = 1 段语音（必有）+ 0~8 张照片（可选）+ 转写文本。数据层与 media moment 同构（都靠 media 行绑定），边界靠 UI 表达：voice 卡片主体是播放条、图缩略；media 卡片主体是宫格。
- **转写与原文分离**：`content` 存展示文本（用户可编辑，与现有 moment 编辑能力一致），`transcript` 存 ASR 原始转写（不可改）。用户改崩了能看原文，也为将来「重新转写」留路。
- **异步转写**：发布即上时间线（语音立即可播），转写走 outbox + worker 回填，发布路径零阻塞。转写失败不影响语音存在与播放。
- **ASR 服务商**：固定使用阿里云百炼 DashScope `fun-asr` 非实时异步任务 API，不再使用 OpenAI-compatible `/audio/transcriptions` multipart 上传。worker 向 DashScope 提交一个可公网读取的预签名 GET URL，provider 同步等待该异步任务完成并拉取结果 JSON；与 recap 的 chat LLM（DeepSeek）配置相互独立，允许 ASR 和 chat 单独停用。
- **隐私声明**：语音内容会出域到 ASR 第三方。这是功能固有代价（不像 recap 有「无内容出域」降级路径可选），部署方通过 `ASR_API_KEY` 留空整体停用转写（语音录制/播放不受影响）。
- **ASR 停用部署形态**：维持「create 恒 emit `moment.transcribe` + handler 内判 `getASRProvider() === null` 落 `failed`」，不改为 create 时按 ASR config 条件 emit。取舍：停用期间发布的 voice 在启用后也不会自动补转（两方案在此点等价），而 handler 判 null 让「停用」语义集中在 worker 一处，create 路径不读 ASR config、不与部署态耦合（详见 §4.3 步骤 3）。
- **转写完成前/失败后的 recap 与聚合**：voice 以空 `content` 参与 recap 与聚合视图——recap input 只 select `content` / `kind` / `payload`（`apps/server/src/llm/recap/input.ts`），产出空摘要行属可接受退化，不改代码；`done` 后转写文本（经 content 回填）自然进入后续 recap。

搁置决策（明确不做，重启条件写明）：

- **「重新转写」入口**：不做。重启触发条件：转写质量投诉达到一定量级，或换更强模型后有批量重转诉求。
- **转写完成后二次通知**：不做。发布时 `moment.created` 通知已扇出；文本回填静默进行，用户下次打开自然看到。重启触发条件：出现「长辈只看推送摘要看不懂语音动态」的反馈。
- **波形图渲染**：v1 播放条 = 播放按钮 + 进度条 + 时长，不渲染波形（需服务端或客户端解码算振幅，成本与价值不匹配）。重启触发条件：设计评审认为播放条辨识度不足。
- **media 宫格混排 audio（形态一）**：见上。

## 1. 数据模型（MySQL / Drizzle）

**moments 表**两处变更（`drizzle-kit generate` 一并产出迁移，不手写 SQL）：

- `type` 的 `mysqlEnum` 从 `['text','media','video']` 扩为 `['text','media','video','voice']`（ALTER COLUMN，与下列两列新增同迁移）。

新增两列：

- `transcript`：`text`，可空。ASR 原始转写；非 voice 类型恒 NULL。用户不可改（PATCH `.strict()` 拒绝）。
- `transcription_status`：`enum('pending','done','failed')`，可空。仅 voice moment 非空：创建时 `pending`；转写成功（含空文本）`done`；最终失败 `failed`。非 voice 类型恒 NULL——用「可空」而非 default 值，避免给 text/media/video 行赋予无意义的转写语义。

**media 表零改动**：无 kind 列，kind 只是 presign 入参；audio 行靠 `mime`（`audio/*`）识别，`duration` 列复用现有（音频时长，秒）。一条 voice moment 绑定的 media：恰好 1 个 `audio/*` + 0~8 个 `image/*`，`sortOrder` 按 `mediaIds` 入参序（与现有一致）。

无新表，`tests/helpers/db.ts` 的 `resetDb()` 无需扩展。

## 2. dto 契约变更（packages/dto）

### 2.1 `media.ts`

- 常量新增（所有端共享的唯一来源，与现有 MAX_* 同范式）：

```ts
/** 语音 ≤25MB（对齐主流 ASR 文件上限）；≤5 分钟（与视频时长上限同值同语义）。 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 300;
/** mime 白名单（同 IMAGE/VIDEO 的安全理由：不放行任意 audio/*） */
export const AUDIO_MIME_TYPES = [
  'audio/mp4',   // m4a / AAC（app 端 expo-audio 录音预设产物，见 §6）
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',  // mp3
  'audio/wav',   // web 端 MediaRecorder → PCM/WAV 转码产物
  'audio/x-wav',
] as const;
```

  **不收 `audio/webm` / `audio/ogg`**：百炼/硅基流动对 webm/opus 支持不稳定，web 端在浏览器内转码为 WAV 再上传（见 §5），服务端不引入 ffmpeg。
- `mediaPresignInputSchema`：`kind` 枚举加 `'audio'`；superRefine 扩展——`kind === 'audio'` 走 `AUDIO_MIME_TYPES` 白名单，且 **`durationSeconds` 必填**（≤ `MAX_AUDIO_DURATION_SECONDS`；voice 卡片的时长展示与 5 分钟上限强依赖它，服务端不探测实际时长，与视频同取舍）。image 分支「禁传 durationSeconds」的既有校验不变。

### 2.2 `moments.ts`

- `momentTypeSchema` 加 `'voice'`。
- `createMomentInputSchema` superRefine 扩展：
  - `type === 'voice'`：`mediaIds` 1~9 条（dto 层只验数量与去重；「恰好 1 条 audio/* 且其余全 image/*」的 mime 构成校验在 server 发布事务内做——dto 不知道上传行的 mime，与现有 video/media 类型同分工）；
  - `type === 'voice'` 时 `content` **允许为空**（转写回填前无文本；现有 text 类型的 `CONTENT_REQUIRED` 不涉及 voice）；`posterMediaId` 仍仅 video 可传（voice 传了 → `MEDIA_NOT_ALLOWED`）。
- `MomentResponse` 增加字段：

```ts
/** ASR 原始转写；仅 voice 可能非空，其余类型恒 null */
transcript: string | null;
/** 转写状态；仅 voice 非空（pending/done/failed），其余类型恒 null */
transcriptionStatus: 'pending' | 'done' | 'failed' | null;
```

- `patchMomentInputSchema` 不改：`content` 本来就可改（voice 上即「修正转写文本」）；`transcript` / `transcriptionStatus` 是未知键，被 `.strict()` 拒绝——转写原文与状态不可经 API 改。

### 2.3 api-client

`packages/api-client` 随 dto 类型自动获得新字段（typed fetch 无手写类型副本）；`src/upload.ts` 有两处手写 audio 分支必须同步：

- `UploadMediaInput.kind: 'image' | 'video'` 联合类型扩为含 `'audio'`；
- 上传前 size 上限三元 `input.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES` 扩展为三分支，audio 走 `MAX_AUDIO_BYTES`（不扩则 audio 被当 video 按 500MB 放行，25MB 上限只在 server 侧兜底）。

## 3. server：发布 / 序列化 / 权限 / 清理

### 3.1 上传管线（`media/media.service.ts` presign）

- size 校验加 audio 分支（`input.kind === 'audio' && input.size > MAX_AUDIO_BYTES` → 413 `MEDIA_TOO_LARGE`）。
- 传输方式分支从 `kind === 'image'` 改为 `kind !== 'video'`：audio 与 image 同走单 PUT，不启 multipart（≤25MB 单 PUT 足够，避免无谓的分片复杂度）。
- complete / abort / resolveAccessUrl **零改动**：它们按行上 mime 与状态工作，对 audio 天然成立；audio 行绑定 moment 后，成员鉴权与 `?st=` 分享透传走既有分支，无新代码。

### 3.2 发布事务（`moments/moment.service.ts` create）

- 媒体行 mime 校验矩阵扩展：**media/video 校验语义不变，但分支结构扩展为三分支（voice 前置）**——现状是 `input.type === 'video' ? 全 video/* : image/* || video/*` 的二元三元，else 分支同时服务 media；voice 不能塞进 else（media 宫格放行 `video/*`，voice 误走该分支会把 `video/*` 当合法附图放行），必须前置独立分支：

| type | 校验 |
|---|---|
| `voice` | `mediaRows` 中**恰好 1 条 `audio/*`**，其余全部 `image/*`——voice 分支必须显式拒绝 `video/*` 与「多条 audio」；任一违反 → 400 `MEDIA_INVALID` |

- voice moment 插入时写 `transcriptionStatus: 'pending'`（`transcript` 留 NULL）。
- **同事务多发一行 outbox**：`type === 'voice'` 时除 `moment.created` 外再 `emitOutbox(tx, OUTBOX_MOMENT_TRANSCRIBE, { momentId })`。outbox 类型常量集中地 `outbox/types.ts` 加 `OUTBOX_MOMENT_TRANSCRIBE = 'moment.transcribe'` 并并入 `OutboxType` 联合。
- tmp→final copy、行锁、tag 替换、`moment.created` 扇出全部沿用现有路径，无 voice 特判。

### 3.3 序列化（`moments/moment-serializer.ts`）

- 出口补 `transcript` / `transcriptionStatus` 两字段（db 行自带，批量查询无新增 join、无 N+1）。非 voice 类型输出 `null` / `null`。
- **`MomentLike` 接口必须同步扩展**：该接口显式枚举字段且 `type` 硬编码 `'text' | 'media' | 'video'`（`moment-serializer.ts` 顶部），需扩 type 联合为含 `'voice'` 并新增 `transcript: string | null` / `transcriptionStatus: 'pending' | 'done' | 'failed' | null` 两字段——否则 db 行传入时新字段被结构类型抹掉，出口取不到值。
- `MediaLike` 类型无需改（media 行结构不变）；audio 行在 `media` 数组里自然出现（`mime: audio/*`、`duration` 非空），客户端按 mime 渲染播放条。**voice 的 audio 行不排除**——与 video poster「排除封面行」不同，audio 是内容本体。

### 3.4 通知摘要（`worker/handlers.ts` handleMomentCreated）

voice moment 发布时 `content` 通常为空，推送摘要是空串。`summarize(m.content)` 调用点加 voice 兜底：`m.type === 'voice' && !m.content.trim()` 时摘要用固定文案 `[语音]`（body 同理：`发布了新动态：[语音]`）。其余通知逻辑零改动；转写完成后**不**二次通知（§0 搁置决策）。

### 3.5 权限与清理：零改动

- 读取：audio 行走 `GET /media/:id` 既有鉴权（成员 viewer / `?st=` 分享透传），voice moment 的 get/list/feed 走既有 ChainPolicy。
- 软删：`handleMomentDeleted` 按 `momentId` 把 ready 媒体标 orphaned，audio 行自动覆盖；sweeper 物理清理同理。
- 转写 outbox 与删除的竞态：转写 handler 读到已软删 moment → 直接返回（见 §4.3），不写任何状态。

## 4. ASR 转写管线

协议依据：阿里云官方 [Fun-ASR 非实时语音识别 HTTP API](https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api)（submit/poll 请求、任务/子任务状态与 `transcription_url` 结果 JSON）。

### 4.1 provider（`src/llm/asr/`）

与 `LLMProvider` 同范式（接口 + 默认实现 + factory 单例 + 测试注入点）：

```ts
export interface ASRTranscribeRequest {
  /** DashScope 可通过 HTTP/HTTPS 读取的音频预签名 GET URL */
  fileUrl: string;
}
export interface ASRProvider {
  transcribe(req: ASRTranscribeRequest): Promise<{ text: string }>;
}
```

- 删除 `openai-compat.provider.ts`，以 `dashscope.provider.ts` 的 `DashScopeASRProvider` 取代；factory 仅实例化新 provider，旧类与 multipart filename/mime 映射全部移除。
- `transcribe({ fileUrl })` 只接受 `http:` / `https:` URL。调用固定为：
  1. `POST {ASR_BASE_URL}/services/audio/asr/transcription`；请求头 `Authorization: Bearer <ASR_API_KEY>`、`Content-Type: application/json`、`X-DashScope-Async: enable`；JSON body 为 `{ "model": ASR_MODEL, "input": { "file_urls": [fileUrl] }, "parameters": {} }`。成功响应必须含非空 `output.task_id`。
  2. 每 **2000ms** `GET {ASR_BASE_URL}/tasks/{encodeURIComponent(taskId)}`（Bearer，无 request body），直到 `output.task_status` 为终态。`PENDING` / `RUNNING` 继续轮询；整个 `transcribe()`（含 submit、poll、结果下载）硬超时 **300000ms（5 分钟）**。
  3. 不能只看任务级状态：DashScope 文档规定任一子任务成功即可令整体为 `SUCCEEDED`。本功能每次只提交一个 URL，必须找到该唯一结果并确认 `subtask_status === 'SUCCEEDED'` 且 `transcription_url` 为 HTTP/HTTPS；随后 GET 该 URL 下载结果 JSON，将 `transcripts[].text` 按数组顺序以 `\n` 拼接为 `{ text }`。`transcripts: []` 合法返回空串（无语音内容）；缺少 `transcripts` 或任一非 string `text` 属畸形响应。
- 错误分类**复用** `llm/base.provider.ts` 的 `RetryableLLMError` / `NonRetryableLLMError`，不新增 ASR 错误类：
  - submit / poll / 结果 JSON 下载任一阶段的 HTTP 429、HTTP 5xx、网络错误、Abort/5 分钟整体超时 → `RetryableLLMError`；
  - 其他 HTTP 4xx、非 JSON/字段缺失/未知 `task_status`/非法 `transcription_url` → `NonRetryableLLMError`；
  - 任务级 `FAILED` 或任务级 `SUCCEEDED` 但唯一子任务 `FAILED`：错误码恰为 `FILE_DOWNLOAD_FAILED` 时 → `RetryableLLMError`（outbox 下次会生成新预签名 URL 并重新提交）；其他 code（含缺 code）→ `NonRetryableLLMError`。错误消息必须带 taskId、code/message，便于日志定位。
- provider 保留 Aimo 的“提交后同步等待”封装方式，但不持久化 DashScope task id；该取舍与 at-least-once 语义见 §4.3。
- factory `getASRProvider()`：`ASR_API_KEY` 空 → 返回 `null`（转写整体停用，语义对齐 `getLLMProvider`）；`setASRProvider()` 为测试注入点（严禁业务代码使用）。

### 4.2 配置（`config.ts` zod + `.env.example` 同步）

```env
ASR_BASE_URL=https://dashscope.aliyuncs.com/api/v1
ASR_API_KEY=
ASR_MODEL=fun-asr
```

与 `LLM_*` 完全独立。空 key 是合法的「停用转写」部署态。`ASR_API_KEY` 的真实值只写入 ignored 的本地 `apps/server/.env` / `.env.<environment>` 或部署 secret；仓库中的 `.env.example` 只保留空值，严禁提交密钥。轮询间隔、整体超时与 source URL TTL 是实现常量，不新增环境变量，也不新增依赖或数据库迁移。

### 4.3 worker handler（`worker/handlers.ts` 新增 `handleMomentTranscribe`）

注册 `'moment.transcribe'`。流程：

1. 读 moment：不存在 / 已软删 / `type !== 'voice'` / `transcriptionStatus !== 'pending'` → 直接返回（幂等 + 竞态防御）。
2. 查该 moment 的 `audio/*` media 行；不存在（异常态）→ 置 `failed` 后返回。
3. `getASRProvider()` 为 `null` → 置 `failed` 后正常返回（部署方停用转写，不占重试额度；「create 恒 emit、handler 判 null」的取舍记录见 §0「ASR 停用部署形态」）。
4. 生成内部预签名 GET（复用 `getStorage().generateAccessUrl`），TTL 固定 **3600 秒**，不再沿用旧实现无充分余量的 300 秒。理由：DashScope 是异步拉取源文件；3600 秒覆盖 provider 的 5 分钟同步等待窗口并额外留出 55 分钟服务端排队/拉取余量，同时每次 outbox 重试都会生成新 URL，因此不需要新增 `ASR_SOURCE_URL_TTL_SECONDS` 环境变量。handler 先用同一 URL 下载并做既有 25MB 有界防御：`Content-Length > MAX_AUDIO_BYTES` 时不读 body 直接置 `failed`；无/不可信 `Content-Length` 时流式累计，超过上限立即 cancel 并置 `failed`；下载非 2xx/网络失败继续抛出让 outbox 重试。防御下载所得 Buffer 随后丢弃，不再上传给 provider。
5. 调 `transcribe()`：
   - **成功**：单条 UPDATE 落 `transcript = text`、`transcriptionStatus = 'done'`，且 **`content` 条件回填**——`SET content = text WHERE id = ? AND content = ''`（用户可能在转写完成前已手动编辑正文，不覆盖用户输入；回填与状态更新同事务/同语句批，避免中间态）。空文本（笑声/环境音）也置 `done`，`transcript` 存空串。**`transcript` 与 `content` 回填统一截断到 5000 字符**（对齐 dto `content` 的 `max(5000)`：worker 回填绕过 API 校验，不截断会落出 API 写不出的值，破坏契约对称；超长 ASR 输出截断即可，不另设错误态）。
   - **`RetryableLLMError`**：不 catch，传播给 processor 走指数退避。
   - **`NonRetryableLLMError`**：handler 内置 `failed` 后正常返回（对齐 recap 范式：自己落终态、不占 processor 退避额度）。
6. 不扇出任何通知（§0 搁置决策）。

**at-least-once / 重复任务取舍**：Moment 只持久化 `pending|done|failed`、`transcript` 与 `content`，outbox 也不增加 DashScope `task_id` 列。worker 在提交成功后若进程退出，或 poll / 结果下载遇到 retryable 错误/5 分钟超时，当前 outbox 会按既有退避重跑 handler，并向 DashScope **重新提交**一个任务；这可能产生重复识别与重复计费。v1 接受该代价，避免为单一供应商引入新表/迁移和“恢复既有 task id”的状态机。重复/迟到结果仍受现有写入 CAS 约束：只允许未软删、`type='voice'`、`transcription_status='pending'` 的首个成功结果写 `done`，并仅在 `content=''` 时回填；其他结果不覆盖终态、用户正文，也不发通知。最终 outbox 重试耗尽仍由 §4.4 的 6h sweeper 把悬挂 `pending` 置 `failed`。

### 4.4 悬挂兜底（`worker/sweeper.ts` 扩展）

outbox 重试耗尽（5 次退避后标 failed）后 moment 会挂在 `pending`。sweeper 增加一路：voice moment `transcription_status = 'pending'` 且 `created_at` 超过 **6 小时** → 置 `failed`。与现有 sweep 任务同周期执行；这路 sweep 同时覆盖「outbox 行丢失/ worker 长期宕机」的极端场景。

**cutoff 取值理由**：processor 退避档为 1min → 5min → 15min → 1h → 4h（`worker/processor.ts` `RETRY_DELAYS_MS`），5 档退避用尽后（第 6 次失败）标 failed，累计退避窗口约 5h21m。cutoff 必须**大于**最大累计退避，否则 sweeper 会在合法重试期间把 moment 抢置 `failed`，而后续重试成功又被 §4.3 步骤 1 的幂等守卫（`transcriptionStatus !== 'pending'` 直接返回）丢弃——语音永远拿不到转写。取 6h 留出约 40 分钟余量覆盖 worker 调度抖动。

## 5. web 端

- **录制入口**：`apps/web/src/compose/compose-panel/` 发布面板新增 voice 类型（类型选择与现有 text/media/video 平级）。
- **录制与转码**：`MediaRecorder` 采集 → `AudioContext.decodeAudioData` 解码 → 重采样为 **16kHz mono PCM → WAV** 编码（纯 JS，无依赖；5 分钟 ≈ 9.6MB，远低于 25MB 上限）。产出 `audio/wav` 走单 PUT 上传管线。**不做** webm 直传（§2.1 白名单不收）。浏览器不支持 `MediaRecorder`（老 Safari）→ voice 类型入口置灰并提示，不影响其他类型。
- **录制交互**：开始/停止、实时时长显示（到 300s 自动停止）、回听、重录（丢弃未上传草稿；已上传未绑定的 audio 行按既有 ready-unbound gap 处理，与 video-poster §2.4 记录一致，本期不新增清理）。
- **附图**：复用现有图片选择/上传（合计 mediaIds ≤ 9，即 1 audio + ≤8 图）。
- **发布**：`type: 'voice'`，`content` 允许留空；发布后面板即关，时间线出现 pending 态卡片。
- **消费侧（时间线卡片）**：voice 卡片 = 播放条（播放/暂停 + 进度条 + 时长，`useMediaObjectUrl(audioMediaId)` 取 blob）+ 文本区 + 附图缩略宫格。`transcriptionStatus` 三态文案：`pending` → 「转写中…」弱化提示；`done` → 显示 `content`；`failed` → 不显示任何转写相关 UI（语音可播即是完整内容，不渲染负面状态）。`content` 为空且 `done`（空转写）→ 同样不显示文本区。
- **消费侧必须修改点（mime 是 `string`，tsc 不会报警，不改会静默渲染破图）**：附图宫格/lightbox 只传 `image/*` 行，`audio/*` 行只进播放条。点名：
  - `apps/web/src/timeline/moment-sheet.tsx`：`const images = moment.media.filter((m) => !m.mime.startsWith('video/'))`（约 L69）——「非 video 即图」的过滤会把 `audio/*` 当图，需改为显式 `image/*` 过滤；
  - `apps/web/src/media/MediaBlock.tsx`：`video/*` 走 video 分支、其余一律落 `<img>` 分支（约 L55 起）——`audio/*` 会落 img 渲染破图，voice 卡片不该走 MediaBlock 渲 audio 行，调用方须先拆出 audio 行。
- **分享页**：语音走稳定入口 + `?st=`（`<audio src={/api/media/:id?st=...}>`），与 poster 的分享态同通道；转写文本按登录态同规则渲染。
- UI 遵循 `apps/web/CLAUDE.md` 与根 CLAUDE.md 列出的 Web C 端设计规范，本 spec 不另立样式约定。

## 6. app 端

- **录制入口**：`apps/app/src/features/compose/` 新增 voice 类型。**新增依赖 `expo-audio`**（项目 SDK ~54，未装 `expo-av`，且 `expo-av` 自 Expo SDK 52 起 deprecated）：录音用 `useAudioRecorder`（预设 m4a/AAC，`audio/mp4` 在白名单内）；麦克风权限走 `expo-audio` 的权限 API（`app.config.ts` 同步声明 iOS `NSMicrophoneUsageDescription` / Android `RECORD_AUDIO`），需处理拒绝态。
- **录制交互**与 web 对齐：时长显示、300s 自动停、回听、重录。
- **附图**：复用现有图片选择；合计 ≤ 9。
- **消费侧**：voice 卡片播放条用 `useMediaUri(audioMediaId)` / `fetchMediaBlob` 拿本地 uri 后播放——播放可用 `expo-audio` 的 `useAudioPlayer`，或复用已装的 `expo-video`（`useVideoPlayer` 同样能播音频文件；实现时二选一，不重复引依赖）（**不能用裸 url 直渲**——原生播放器不带鉴权头，与 video-poster §4 的约束相同）；三态文案规则同 web。
- **消费侧必须修改点（同 web，mime 是 `string`，不改静默渲染破图）**：附图宫格只传 `image/*` 行，`audio/*` 行只进播放条。点名：
  - `apps/app/src/components/MediaGrid.tsx`：`m.mime.startsWith('video/') ? … : …`（约 L41）——else 分支按图渲染，`audio/*` 会落图分支；
  - `apps/app/src/features/moment/index.tsx`：同样的 video 三元（约 L115）——voice 卡片须先拆出 audio 行再交宫格。
- 编辑已发布 voice moment 的 `content`（修正转写）走既有编辑入口，无需新代码路径。

## 7. 错误处理

dto zod 校验矩阵（新增部分）：

| 场景 | 结果 |
|---|---|
| presign `kind: 'audio'` + 白名单 mime + 必填 `durationSeconds` ≤300 + size ≤25MB | 通过，单 PUT |
| `kind: 'audio'` + 非白名单 mime | 400 `MIME_KIND_MISMATCH` |
| `kind: 'audio'` 缺 `durationSeconds` 或 >300 | 400（zod issue） |
| `kind: 'audio'` size >25MB | 413 `MEDIA_TOO_LARGE`（server） |
| `type: 'voice'` mediaIds 0 条或 >9 / 重复 id | 400 `MEDIA_COUNT_INVALID` |
| `type: 'voice'` 传 `posterMediaId` | 400 `MEDIA_NOT_ALLOWED` |
| `type: 'voice'` 空 `content` | 通过 |
| PATCH 传 `transcript` / `transcriptionStatus` | 400 `VALIDATION_ERROR`（`.strict()`） |

server 发布事务：`voice` 的 media 构成非「1 audio + 其余全 image」→ 400 `MEDIA_INVALID`（含 media 宫格/text 类型夹带 `audio/*` 的情况——现有 mime 分支不放行 audio，天然拒绝）。

转写管线的失败语义集中在 §4.3/§4.4：可重试走退避，不可重试与停用态落 `failed`，悬挂有 sweeper 兜底；**任何转写失败都不影响 moment 存在、语音播放与分享**。

## 8. 测试策略

遵守 `.claude/rules/testing.md`：server 触库测试 `--runInBand` 串行、`afterAll(closeDb)`、只打 `.env` 指向的测试库；dto 测试与源文件同目录、不触库。

- **dto**（`media.test.ts` / `moments.test.ts` 扩展）：
  - audio presign 白名单 / durationSeconds 必填与上限 / image 分支既有校验不回归；
  - voice create：数量边界（0/1/9/10）、重复 id、空 content 通过、`posterMediaId` 拒绝；text/media/video 既有矩阵不回归。
- **server**（`apps/server/tests/` 触库）：
  - presign audio：单 PUT、size 上限 413；
  - create voice：成功（audio 行绑定 + `transcriptionStatus='pending'` + **同事务两行 outbox**（created + transcribe））；各 `MEDIA_INVALID` 分支（2 条 audio / 纯图无 audio / 夹 video）；
  - 序列化：voice 响应出 `transcript` / `transcriptionStatus`，非 voice 恒 `null`；audio 行在 `media` 数组中（mime/duration 正确）；
  - 通知摘要：voice 空 content 扇出 `[语音]` 兜底文案；
  - DashScope provider 单元测试（不触库）：提交 URL/方法/Bearer/JSON/`X-DashScope-Async: enable`/`input.file_urls` 精确断言；`PENDING → RUNNING → SUCCEEDED` 轮询（fake timer，不真实等待 2 秒）；任务成功后检查唯一子任务并下载 `transcription_url`，按顺序拼接 `transcripts[].text`，空数组返回空串；任务级 `SUCCEEDED` 但子任务 `FAILED` 不得误判成功；submit / poll / result 三阶段分别覆盖 429、5xx、network、整体 timeout → Retryable，其他 4xx与畸形 JSON/字段 → NonRetryable；`FILE_DOWNLOAD_FAILED` → Retryable，其他 DashScope `FAILED` → NonRetryable；factory 的 null/override/默认 DashScope 实例不回归；
  - 转写 handler（触库，`setASRProvider` 注入 mock）：同一预签名 URL 先做 25MB 有界下载，再以 `{ fileUrl }` 传 provider；精确断言 TTL 3600 秒、`Content-Length` 预拒绝、分块流超限 cancel、下载非 2xx传播重试；成功回填、空文本 done、5000 截断、「用户已编辑 content 不覆盖」、并发 failed/软删/重复 handler 的 CAS、Retryable 传播、NonRetryable 落 failed、provider null 落 failed、已软删/非 pending 幂等返回；每条成功/失败路径均断言不新增 notification 且不调用 push；
  - sweeper：pending 超 6h 置 failed；未超 6h（合法重试窗口内）不被扫置；
  - 软删带 audio 的 voice moment → audio 行随既有路径 orphaned。
- **server 测试夹具同步**：`MomentResponse` 新增两个必填字段后，手工构造该类型字面量的测试工厂/夹具必须补 `transcript` / `transcriptionStatus`（voice 场景除外一律给 `null`）；`MediaLike` 不变，但 `MomentLike` 接口扩了 type 联合与两字段，手写的 MomentLike 夹具同样要补。web/app 侧同理（参照 video-poster §6 列出的夹具位置逐一排查，grep `: MomentResponse` 与手写 moment 字面量构造点）。
- **api-client**：`upload.ts` 的 kind 联合改动靠 tsc + dto 测试间接覆盖，但 size 上限三分支不行——dto 测试不 import api-client，tsc 也管不到运行时三元，`upload.ts` 的 size 三分支漏扩 audio 不会有任何测试报警。`packages/api-client/src/upload.test.ts` 已有 node:test 单测设施（图片超 `MAX_IMAGE_BYTES` → 本地 413 `MEDIA_TOO_LARGE` 用例，约 L85），照它镜像一条：`kind: 'audio'` 且 size 超 `MAX_AUDIO_BYTES` → 本地抛 413 `MEDIA_TOO_LARGE`，不发起任何请求。
- **web / app**：`pnpm lint` + tsc（重点覆盖 §5/§6 点名的 4 个消费侧组件的 audio 拆分）；手测录制/转码/上传/降级（模拟 ASR 失败）与三态卡片渲染；app 侧手测含 expo-audio 麦克风权限拒绝态。
- **全量验证门槛**：`pnpm --filter @moment/server test -- tests/llm/asr-provider.test.ts`（不触库）通过后，再单独串行执行 `pnpm --filter @moment/server test -- tests/worker/handle-moment-transcribe.test.ts`（触真实测试库，不得并发 Jest）；最后 `pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint && pnpm test` 全部通过。
