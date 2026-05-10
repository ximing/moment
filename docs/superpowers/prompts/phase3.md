# Phase 3 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 3 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase3-moments-media.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 3 实施计划：时刻与媒体：moments 三类型 + S3 预签名/multipart 上传 + outbox 基建。

本计划范围与设计要点（spec §3 media/moments/outbox、§4 Moments/Media API、§5.3 存储抽象与媒体读取、§5.5 上传管线、§5.6 时区）：
1) 存储层：src/storage/{base.adapter.ts, s3.adapter.ts, factory.ts}，接口方法严格按 CONVENTIONS §3.3（含 multipart 全套、copyObject、generateAccessUrl 按行 meta 签名）。可参考 /Users/ximing/project/mygithub/aimo/apps/server/src/sources/unified-storage-adapter/ 的实现模式（读它）。config.ts 扩展 ATTACHMENT_S3_* 与 PRESIGN_GET_TTL_SECONDS(3600)/PRESIGN_PUT_TTL_SECONDS(900)，同步 .env.example。
2) 表：media（spec §3 全字段：id uuid, moment_id char(36) null, uploader_id, s3_key, mime, size bigint, width/height/duration int null, poster_media_id null, sort_order int, status enum(uploading,ready,orphaned), storage_meta json, upload_id varchar(128) null, created_at）；moments（id uuid, chain_id ref, author_id ref, type enum(text,media,video), content text, happened_at timestamp mode date, happened_tz_offset int（分钟偏移）, is_backfill boolean default false, created_at, updated_at, deleted_at null，索引 (chain_id, happened_at, id)）；outbox 表 + emitOutbox + src/outbox/types.ts（常量 moment.created / moment.deleted），严格按 CONVENTIONS §3.2。扩展 resetDb。
3) 媒体端点：POST /api/media/presign（@Authorized，body {mime,size,kind:image|video,sortOrder?}，校验：图 ≤10MB 且 mime image/*，视频 ≤500MB 且 mime video/*，超限 413 MEDIA_TOO_LARGE；插 media(uploading, tmp key) → 图片返回 {mediaId, method:put, url}，视频 init multipart 返回 {mediaId, method:multipart, uploadId, partSize}）；POST /api/media/:id/parts（body {partNumbers:number[]}，仅 uploader 本人，逐 part 预签名）；POST /api/media/:id/complete（仅 uploader 本人；multipart 先 completeMultipart；HeadObject 校验存在+size/mime 与申请一致，不符 422 MEDIA_MISMATCH；幂等：重复 complete 返回相同结果）；POST /api/media/:id/abort（abort multipart + 状态 orphaned）；GET /api/media/:id（鉴权：media 已绑定 moment → ChainPolicy.require(user, chainId, viewer)；未绑定 → 仅 uploader；预留 ?st= share token 透传点（Phase 8 实现，本阶段带 st 参数时返回 403 并注明）。通过后 302 到预签名 GET，TTL 按整点时间窗对齐（expiresIn = 到下一整点的秒数 + 3600），302 响应带 Cache-Control: private, max-age=300）。
4) moments 端点：POST /api/chains/:chainId/moments（requireChainRole(editor)，body {type, content, happenedAt, happenedTzOffset, isBackfill, mediaIds[]}，校验：type=text 时 mediaIds 必须空；type=video 时恰好 1 个 video media；type=media 时 1-9 个。一个事务：校验所有 media 属于本人且 status=ready → copy tmp→final key（storage_meta 更新）→ 绑定 moment_id → 插 moment → emitOutbox(moment.created, {momentId, chainId, authorId, isBackfill})）；GET /api/chains/:chainId/moments（viewer+，happened_at 复合游标分页，游标格式按 CONVENTIONS §3.4，每页默认 20 上限 50，含 media 与 author 摘要，软删排除）；GET /api/moments/:id（service 层反查 chainId 后 ChainPolicy.require viewer，软删返回 410 MOMENT_DELETED）；PATCH /api/moments/:id（仅作者本人，仅 content/happenedAt/happenedTzOffset/isBackfill 可改，媒体不可改）；DELETE /api/moments/:id（作者或链 owner，软删 + emitOutbox(moment.deleted)）。
5) momentSerializer 初版（src/moments/moment-serializer.ts，唯一出口；media 出 {id, url:/api/media/:id, mime, width, height, duration, sortOrder}，不得内嵌预签名 URL）。
6) dto：moments.ts + media.ts。测试：storage 全 mock（factory 注入点），单测 presign 限制/complete 幂等/HeadObject 校验；集成测试 moments 全流程（事务、媒体归属校验、越权、软删 410）；链内列表同 happened_at 时间戳翻页稳定性测试（提前验证游标逻辑，feed 复用）；RUN_S3_IT=1 真实桶 smoke 默认跳过。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase3-moments-media.md（用 Write 工具）。
- 假设 Phase 1-2 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase3-moments-media.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（routing-controllers 0.11/typedi/drizzle 0.45/zod 3/jest ESM/tsx/@aws-sdk/client-s3），含 API 用法、类型、异步、事务写法、multipart API 参数。
2. 契约符合性：与 CONVENTIONS §3（特别是 §3.2 outbox、§3.3 storage 接口、§3.4 游标）逐字比对；与 spec 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase3-moments-media.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏、测试断言同步更新）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase 3 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
