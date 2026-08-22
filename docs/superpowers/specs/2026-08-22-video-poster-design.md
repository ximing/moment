# 时刻 Moment — 视频封面（客户端截帧）Design

> 日期：2026-08-22
> 状态：设计已与用户对齐（脑暴后缩减范围版）
> 范围：dto + server + web + app
> 权威边界：数据模型、权限模型、存储与上传管线语义以 `2026-08-15-moment-design.md` 为准；web/app UI 规范以根 CLAUDE.md 列出的 Web C 端设计规范与各端 CLAUDE.md 为准。本 spec 不改媒体权限（`GET /media/:id` 鉴权语义）与上传管线（presign → PUT/multipart → complete）语义，只在其上做一处关联扩展。

## 0. 产品决策（记录对齐过程与搁置决策）

主 spec backlog 中的「视频转码 HLS / 服务端抽帧封面」经脑暴后缩减范围。本期只做一件事：**视频 moment 的客户端截帧封面**。

已对齐的决策：

- **封面来源 = 客户端截帧**：web 端用本地 `<video>` 加载 file blob + canvas 导出 JPEG，支持拖动选帧；app 端用 `expo-video-thumbnails` 截首帧（v1 固定首帧，无选帧 UI）。用户自选帧优于服务端盲抽（如在 10% 处抽一帧）——封面是情感入口，黑屏/虚焦帧等于没有封面。
- **封面上传 = 复用现有图片管线**：截出的 JPEG 作为普通图片走 presign（`kind: 'image'`，`image/jpeg` 在 `IMAGE_MIME_TYPES` 白名单内，无需改 presign schema）→ PUT → complete，拿到 `ready` 状态的 mediaId。
- **关联方式**：发布 moment 时请求体带 `posterMediaId`，server 在发布事务内把 poster 行与视频行同样绑定到 moment，并在视频行写 `poster_media_id`（列已存在，主 spec §3 预留，本期启用）。
- **仅 `type = video`（单视频）支持封面**（已知限制，YAGNI）：宫格（`type = media`）中混排的视频本期不支持封面——宫格视频的封面语义（每个视频一张 poster？前端如何组织选帧 UI？）会显著放大交互与契约复杂度，等真实需求出现再做。
- **存量不回填**：已发布视频保持无封面，序列化输出 `posterMediaId: null` / `posterUrl: null`。

搁置决策（明确不做，重启条件写明）：

- **HLS 转码**：不做。重启触发条件：出现大规模分享给弱网环境设备的实际场景，原片播放体验成为投诉源。当时曾评估过「自建 ffmpeg worker 容器 + 双档 ABR + 服务端重写 playlist 鉴权」方案，备查。
- **服务端 ffmpeg 抽帧**：不做。重启触发条件：客户端截帧覆盖率不足（如旧设备 canvas/解码失败率高）且封面缺失成为实际投诉。
- **HEVC 兼容性处理**：不做。重启触发条件：出现 HEVC 视频在对方设备播放不了的实际投诉。

## 1. 契约变更（dto）

`packages/dto/src/moments.ts`：

- `createMomentInputSchema` 增加字段：

```ts
posterMediaId: z.string().min(1).optional(),
```

  并在现有 `superRefine` 中增加一条：**仅 `type === 'video'` 时可传 `posterMediaId`**；其他类型传了 → issue `MEDIA_NOT_ALLOWED`（path `['posterMediaId']`，与 text 类型传 mediaIds 的现有错误码一致）。
- `MomentMedia` 增加字段（与现有 `id`/`url` 的对偶关系一致，id 与路径同时出）：

```ts
/** 视频封面媒体 id：登录态经 useMediaObjectUrl / useMediaUri(posterMediaId) 取 blob；仅视频行非空，无封面为 null */
posterMediaId: string | null;
/** 视频封面稳定入口相对路径 /api/media/:posterId（不内嵌预签名 URL，CONVENTIONS §3.4）；分享态拼 ?st= 用；仅视频行非空，无封面为 null */
posterUrl: string | null;
```

  必须同时出 id 与路径的原因：两端媒体加载原语都以 mediaId 为键——web 登录态走 `useMediaObjectUrl(mediaId)`（blob + Authorization 头，`apps/web/src/media/useMediaObjectUrl.ts`），app 走 `useMediaUri(mediaId)` / `fetchMediaBlob(mediaId)`（`apps/app/src/lib/use-media-uri.ts` 注释明写原生 Image/video 不带鉴权头）；浏览器对 `<video poster>` / `<img src>` 的裸请求同样不带 Authorization，登录态直接消费 `posterUrl` 会 401。`posterUrl` 语义与现有 `url` 一致——稳定入口相对路径，权限由 `GET /media/:id` 的 302 鉴权保证，供分享态拼 `?st=` 使用。仅视频行（`mime` 为 `video/*`）两字段可能非空，图片行恒 `null`。
- 不改 `mediaPresignInputSchema`：poster 就是一张 `kind: 'image'` / `image/jpeg` 的普通图片上传。
- 不改 `patchMomentInputSchema`：其 `.strict()` 会把 `posterMediaId` 当未知键拒掉——**封面发布后不可改**，与「媒体不可改」的现有语义一致。

## 2. server 绑定逻辑

改动集中在 `apps/server/src/moments/` 两处，其余模块零改动。

### 2.1 发布事务（`moment.service.ts` create）

沿用现有事务范式（行锁 + 同事务 copy tmp→final），`posterMediaId` 存在时按下述扩展：

- **行锁范围扩展**：`SELECT ... FOR UPDATE` 的 id 集合从 `mediaIds` 扩为 `mediaIds ∪ {posterMediaId}`，并发语义与现有媒体行一致。**但 poster 行与媒体行在代码里分两个集合装**（poster 行单独变量持有，不进 `mediaRows`）：现有数量校验 `mediaRows.length === new Set(input.mediaIds).size`（`moment.service.ts:61`）只对媒体集合做，不能被 poster 行污染。
- **poster 行校验**（全部满足才放行，任一违反 → 400 `MEDIA_INVALID`）：
  1. poster 行存在且为本人上传（`uploaderId === userId`）；
  2. `status === 'ready'`；
  3. `momentId` 为 null（未被其他 moment 绑定）；
  4. `mime` 为 `image/*`；
  5. 不在 `mediaIds` 中（同一行不能既是内容媒体又是封面）。
- **绑定处理**（copy 逻辑复用、update 分支分开）：poster 行与媒体行走同一 tmp→final copy——同桶服务端 copy 到相对 key `chains/{chainId}/{momentId}/{posterId}.{ext}`（prefix 由 adapter 拼接，与现状一致），tmp 对象进同一个 `copiedTmp` 列表。**update 分支与媒体行分开写**：poster 行 update 只绑 `momentId`（与新 `s3Key`），**不写 `sortOrder`**——现有媒体循环的 `sortOrder = input.mediaIds.indexOf(mediaId)`（`moment.service.ts:98`）对 poster 会算出 -1，poster 行 `sortOrder` 保持上传时的值（默认 0），不参与宫格排序；`storageMeta` 不变、无需写入（现有媒体行 update 是同值重写 `storageMeta`，见 `moment.service.ts:101`，poster 分支不照抄）；视频行 update 另写 `posterMediaId`。
- tmp 对象的删除沿用现有「事务提交后 best-effort 删除 + tmp/ lifecycle 7 天兜底」机制，poster 的 tmp 对象进同一个 `copiedTmp` 列表。
- 同步更新 `apps/server/src/db/schema/media.ts:24` `poster_media_id` 列的注释：现为「预留，服务端抽帧二期」，与本期「客户端截帧 + 服务端抽帧已搁置」的决策不符，改为如实描述（客户端截帧封面，关联同 moment 的 poster 媒体行；不做 FK 以避免自引用循环的说明保留）。

### 2.2 序列化（`moment-serializer.ts`）

- **内部接口扩展**：`MediaLike`（22-29 行）加 `posterMediaId: string | null` 字段（db 行结构自带该列，类型对齐即可）；单条出口 `momentSerializer` 的 media map 同步出 `posterMediaId: x.posterMediaId` 与 `posterUrl: x.posterMediaId ? \`/api/media/${x.posterMediaId}\` : null`——`posterUrl` 始终由 `posterMediaId` 派生，两字段同生同灭，不会出现一个 null 另一个非 null 的状态。
- **poster 行必须从 `media` 数组中排除**：`serializeMoments` 现按 `momentId IN (:page)` 一次查出该页全部媒体行，poster 行绑了同一 `momentId` 后会被查出——不排除就会以第 2 条媒体出现在响应里，破坏 `type = video` 恰好 1 条视频媒体的契约，客户端也会把封面渲染成宫格多出一格。实现：在 `serializeMoments` 批量函数内查出本页视频行的 `posterMediaId` 集合，组装 `mediaBy` 时跳过这些 id（排除逻辑只存在于批量函数，单条出口 `momentSerializer` 不做过滤——它消费的就是批量函数组装好的 `extras.media`）；输出契约（video 恰 1 条媒体）因此继续成立——`MomentResponse` 是纯 interface、无响应侧 zod 校验，该不变式靠上述批量函数的排除逻辑保证。
- 图片行 `posterMediaId` / `posterUrl` 恒 `null`。序列化仍是唯一出口，不新增 N+1（`posterMediaId` 已在查出的行上）。

### 2.3 权限读取：零改动

poster 行走现有 `GET /media/:id` → 302（含 `?st=` 分享透传）。因为 poster 行绑了 `momentId`，`resolveAccessUrl` 的既有分支（已绑定 moment → 校验所属链 viewer / 有效 share token）对 poster 自然生效，成员与分享鉴权无需任何新代码。

### 2.4 清理语义：零改动

- 软删 moment：`handleMomentDeleted`（outbox `moment.deleted`）把该 moment 的全部 ready 媒体标 `orphaned`，poster 行因绑了 `momentId` 自动被覆盖；sweeper 既有「软删 moment 媒体」路径（`sweepSoftDeletedMomentMedia`，按 `momentId` join、不限 status）到期物理清理，poster 行同样自动被覆盖。
- 已知既有 gap（与现状一致，本期不处理，记录备查）：`ready` 但未绑定任何 moment 的媒体行不被任何清理路径覆盖——上传后放弃发布即泄漏（对象留在 `tmp/` 前缀，靠 S3 lifecycle 的 7 天规则兜底删对象，行残留）。poster 上传后放弃发布与该 gap 同性质，不新增处理。

## 3. web 端

- 位置：`apps/web/src/compose/compose-panel/`（发布面板，选择视频文件后的现有流程内）。
- 选择视频文件后，本地截帧组件：`<video>` 元素加载本地 file blob（`URL.createObjectURL`），`canvas` 导出 JPEG；提供拖动选帧（时间轴滑杆），默认落在首帧。
- 产出 JPEG 走现有图片上传管线（presign `kind: 'image'` → PUT → complete），发布请求带 `posterMediaId`。
- **poster 草稿与视频选择同生同灭**：替换或移除视频即丢弃已截帧/已上传的 poster 草稿（截帧位图与已拿到的 `posterMediaId` 一并清空），新视频重新走截帧流程。挂载点 = compose-panel service 的 video 状态重置路径：`addVideo` 覆盖旧视频（205-206 行 revoke + 重赋值）、`confirmReplace` 图/视频互斥置换（238-239 行 `video = null`）、`clearPreviews`（266-267 行）。不重置的后果：选视频 A → 截帧/上传 poster → 替换为视频 B → 直接发布，封面静默是旧视频的帧，且 poster 已 ready、发布校验全过、无任何错误信号。被丢弃的已上传未绑定 poster 行按 §2.4 记录的既有 ready-unbound gap 处理（tmp 对象靠 S3 lifecycle 7 天兜底、行残留），不在本期清理。
- **截帧失败降级**：浏览器解码失败 / canvas 导出失败（如 HEVC 本地不可解）→ 静默降级为「无封面发布」（不带 `posterMediaId`），不阻塞发布流程，不出错误弹窗——封面是增强不是门槛。
- **消费侧**（`apps/web/src/media/MediaBlock.tsx` 的 `VideoOne`）：登录态时间线的视频占位不是 `<video>` 元素，而是 135-149 行的深色播放按钮（`<video>` 点播放后才挂载），封面真正落点在这个按钮里——`posterMediaId` 非空时，在按钮内（播放图标层之下）放一张 `<img>`，src 用 `useMediaObjectUrl(media.posterMediaId)` 的 blob URL（hook 接受 `string | null`，null 时不发请求）；blob 未就绪或 `posterMediaId` 为 null 时保持现状的纯深色播放面。分享态 `<video>` 直接挂载（`shareSrc` 拼 `?st=`），用 `poster={\`${m.posterUrl}?st=${encodeURIComponent(token)}\`}` 作原生 poster（`posterUrl` 为 null 时不传 `poster` 属性，无封面视频的分享态行为与现状一致）——分享请求不带 Authorization，走稳定入口 + share token 是唯一可行通道，这正是契约保留 `posterUrl` 的原因。
- **lightbox 不处理**：`apps/web/src/timeline/lightbox.tsx` 的视频是 `autoPlay` 直接起播（90 行），poster 一闪而过无意义，本期不改 lightbox。
- UI 遵循 `apps/web/CLAUDE.md` 与根 CLAUDE.md 列出的 Web C 端设计规范（field/button/feedback 等），本 spec 不另立样式约定。

## 4. app 端

- 位置：`apps/app/src/features/compose/`（发布流程）。新增依赖 `expo-video-thumbnails`。
- 选中视频后用 `expo-video-thumbnails` 截首帧（v1 固定首帧，无选帧 UI——选帧交互在 RN 上成本高，首帧对手机拍摄视频通常可用，YAGNI）。
- 产出 JPEG 走与 web 相同的图片上传管线，发布请求带 `posterMediaId`。
- **poster 草稿与视频选择同生同灭**：挂载点 = compose service 的 video 字段重置路径——`ComposeService.chooseVideo`（`compose.service.ts:226-233`）每次选视频直接覆盖 `this.video`，再次选择即替换。覆盖时丢弃上一支视频的已截帧/已上传 poster 草稿（截帧位图与已拿到的 `posterMediaId` 一并清空），新视频重新截帧；理由与 web 侧相同（poster 已 ready、校验全过，不重置会静默发旧帧封面）。被丢弃的已上传未绑定 poster 行同样按 §2.4 记录的 ready-unbound gap 处理，不在本期清理。另组件侧类型切换（`index.tsx:96` 的 SegmentBar `onChange`）与「移除」按钮（`index.tsx:138`）也直接置空 `service.video`，同样需丢弃 poster 草稿。
- 截帧失败同样降级为无封面发布，不阻塞流程。
- **消费侧**：`apps/app/src/components/MediaGrid.tsx` 的视频占位 cell（28-33 行的 ink 深色格 + ▶/时长文案）——`m.posterMediaId` 非空时用 `useMediaUri(m.posterMediaId)` 取本地缓存文件 uri 渲染 `<Image>` 作封面底图（复用同文件 `MediaImage` 的既有模式），其上保留 ▶/时长文案层；`posterMediaId` 为 null 时保持现状 ink 占位。**不能用 `posterUrl` 直渲**：`apps/app/src/lib/use-media-uri.ts` 注释明写原生 Image/video 不带鉴权头且 `source.headers` 会跟过 302 被 S3 拒，一切走 `useMediaUri(mediaId)` / `fetchMediaBlob(mediaId)`。moment 详情页（`apps/app/src/features/moment/index.tsx` 的 `VideoView`）不处理封面——进入详情即起播，expo-video 的 `VideoView` 无 poster 语义。

## 5. 错误处理

dto zod 校验矩阵：

| 场景 | 结果 |
|---|---|
| `type = video` + 合法 `posterMediaId` | 通过，进 server 绑定校验 |
| `type = text` / `media` 传 `posterMediaId` | 400，issue `MEDIA_NOT_ALLOWED` |
| poster 行不存在/非本人/非 ready/已绑定其他 moment/非 `image/*`/出现在 `mediaIds` 中 | 400 `MEDIA_INVALID`（server 发布事务内） |
| 不传 `posterMediaId` | 通过，无封面发布 |

序列化：无封面视频输出 `posterMediaId: null` / `posterUrl: null`；图片行两字段恒 `null`。PATCH 传 `posterMediaId` → `.strict()` 拒绝（VALIDATION_ERROR），封面不可改。

## 6. 测试策略

遵守 `.claude/rules/testing.md`：server 触库测试 `--runInBand` 串行、`afterAll(closeDb)`、只打 `.env` 指向的测试库；dto 测试与源文件同目录、不触库。

- **dto**（`packages/dto/src/moments.test.ts` 扩展）：
  - `type = video` 带/不带 `posterMediaId` 均通过；
  - `type = text` / `media` 传 `posterMediaId` → `MEDIA_NOT_ALLOWED`；
  - 既有 mediaIds 校验矩阵不回归。
- **server**（`apps/server/tests/` 触库）：
  - 绑定成功路径：video + poster 发布，断言 poster 行 `momentId` 已绑、s3_key 已 copy 到 final 布局、视频行 `poster_media_id` 已写、tmp 清理入队语义不变；
  - 各 400 分支：poster 非本人 / `status != ready` / 已绑定其他 moment / mime 为 `video/*` / poster id 同时出现在 `mediaIds`；
  - 序列化：响应 `media` 数组恰 1 条视频行（poster 不泄漏为第 2 条媒体）且视频行 `posterMediaId = posterId`、`posterUrl = /api/media/{posterId}`；无封面视频两字段均 `null`；图片行两字段恒 `null`；
  - 软删路径：软删带 poster 的 video moment，`handleMomentDeleted` 后 poster 行随既有路径标 `orphaned`（与视频行同事务语义一致）。
- **web / app**：`pnpm lint` + tsc；手测选帧/上传/降级（模拟截帧失败）与发布时间线封面展示。
- **web 测试夹具同步**：`MomentMedia` 新增两个必填字段后，所有手工构造 `MomentMedia` 字面量的测试工厂/夹具必须补上 `posterMediaId` / `posterUrl`（一般给 `null`），否则 tsc 直接挂。已知位置（grep `: MomentMedia` 外加搜索 `sortOrder:` 字面量构造点可补全）：`apps/web/src/timeline/lightbox.test.tsx:23-27`（image/video 工厂）、`apps/web/src/media/MediaBlock.test.tsx:25-29`（image/video 工厂）、`apps/web/src/pages/timeline-variants.test.tsx:153`（image 工厂）、`apps/web/src/pages/chain-home/chain-home.test.tsx:157`（内联 `MomentMedia` 字面量，非工厂函数，grep `: MomentMedia` 抓不到）。
- **server 测试夹具同步**：`apps/server/tests/moments/moment-serializer.test.ts:21-22` 手工构造 `MediaLike` 字面量，`MediaLike` 加必填 `posterMediaId` 后需同步补字段（给 `null`），否则 tsc 挂。
- 全量验证门槛：`pnpm test` 通过。
