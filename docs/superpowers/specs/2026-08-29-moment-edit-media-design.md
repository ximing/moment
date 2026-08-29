# 时刻 Moment — 编辑已发布时刻的图片 Design

> 日期：2026-08-29
> 状态：设计稿（已与用户对齐，待实施计划消费）
> 范围：`packages/dto`（`patchMomentInputSchema`）+ `apps/server`（`MomentService.update` 媒体全量替换、compress/embed 触发、sweeper 派生对象）+ `apps/web` / `apps/app` 编辑态选图。不改路由、不改 CONVENTIONS §3 方法名、不改视频/封面、不改分享页。
> 权威边界：权限 / 软删 / tmp→final copy / outbox 形态听 `2026-08-15-moment-design.md` 与落地代码 `apps/server/src/moments/moment.service.ts`；媒体 URL 听 CONVENTIONS §3.4 **现状**（响应内签发预签名 GET，`PRESIGN_GET_TTL_SECONDS` 默认 21600）；voice 构成听 `2026-08-23-voice-moment-design.md`；poster 听 `2026-08-22-video-poster-design.md`（本 spec 保持「发布后不可改」）；compress / embed / `maybeEmitMomentEmbed` / GIF·HEIC·HEIF 不压听 `2026-08-29-moment-fused-retrieval-design.md`（本 spec **显式修订**其中「PATCH 不能改 mediaIds」两句）。
> 下游依赖：实施计划按 §11 分期直接抄本文件的 dto 签名、server 事务步骤、错误码表与客户端 dirty 规则。本 spec 取代下列历史句子的产品口径（**不改那些历史文件正文**，以免无授权扩范围）：
>
> - `2026-08-16-web-product.md` §4「媒体本轮不支持改已发布附件」；§5「编辑态：只 PATCH 正文/时间/标签/补发；不重传媒体」。
> - `2026-08-16-web-redesign-sticker-design.md`「编辑态不重传媒体」。
> - `2026-08-18-app-moment-edit-delete-design.md` §1「`.strict()` 拒绝 `type` / `mediaIds`」中 **拒绝 `mediaIds`** 的半句；§2「选图/选视频区全部隐藏（server 不允许改）」。
> - `2026-08-22-video-poster-design.md` §1「不改 `patchMomentInputSchema`：`.strict()` 把 `posterMediaId` 当未知键拒掉」——改为已知可选键，server 恒 `MEDIA_NOT_ALLOWED`（封面仍不可改）。
> - `2026-08-29-moment-fused-retrieval-design.md` §1「PATCH 不能改 mediaIds，故 update 不再发 compress，只可能发 embed」；§4.2「PATCH 不能改媒体，故 update 不发 compress」。

## 0. 产品决策（已与用户对齐）

下列口径锁定，实施不得改：

1. **PATCH 增加可选 `mediaIds`**（全量替换，对齐 `tagIds` / `personIds`）：`undefined` = 媒体集合不变；提交数组 = 新集合。客户端 dirty tracking：用户没动过媒体就不传该键。
2. **客户端仍不传 `type`。** `type` 由 server 在**原 type 约束下**按结果集推导（完整矩阵 §4.6），不是无视原 type 的自由投影：
   - 原 `text`：结果 1–9 张 `image/*`、无 audio/video → 升级 `type=media`；结果 0 媒体 → 保持 `text`
   - 原 `media` / `voice` / `video`：成功路径保持原 type；不能靠提交图/音频把它们互转
   - 其它非法组合见 §4.6
3. **`type=media`**：可删、可追加、可换图。结果必须仍是 **1–9 张 `image/*`**。不能删光变成 `text`（`MEDIA_COUNT_INVALID`）。
4. **`type=text`**：可提交 `mediaIds` 1–9 张图 → 升级为 `type=media`（给纯文字追加图片）。
5. **`type=voice`**：可改 **附图**（0–8 张 image），**不能换/删那一条 `audio/*`**。提交的 `mediaIds` 必须恰好包含原来那条 audio id，其余全是 image，合计 1–9。audio 不在集合里 → `MEDIA_INVALID`。
6. **`type=video`：本 spec 不做。** PATCH 带 `mediaIds`（含 `[]`）或试图改 poster → `MEDIA_NOT_ALLOWED`。视频文件与封面仍发布后不可改。
7. **不能** 把 media / voice / video 互转（除 text→media）。不能 voice→media（丢掉音频）、不能 media→video。
8. **权限不变**：仅作者 + 链成员；软删 410 `MOMENT_DELETED`；非作者 403 `NOT_MOMENT_AUTHOR`。鉴权先于软删（与现 `MomentService.update` 一致）。
9. **web + app 都做编辑态可改图**（与现发布选图同一套压缩 / `uploadMedia`）。编辑面板展示已有媒体 + 可移除 + 可追加；达上限禁用追加。
10. **不改路由。** 仍 `PATCH /api/moments/:id`（`apps/server/src/moments/moment.controller.ts` 现网）。
11. **CONVENTIONS §3 符号不得改名。** 媒体 URL 现状：`serializeMoments` 写入 `url` / `derivedUrl` / `posterUrl` / `posterDerivedUrl` 为本次签发的预签名 GET（`PRESIGN_GET_TTL_SECONDS` 默认 21600，整点窗对齐）；编辑宫格用这些 https URL 直出 `<img>`。不要写回「不得内嵌预签名」。`GET /api/media/:id` 仍 302（分享 `?st=`、未绑定预览）。

此前「PATCH 不能改媒体」是 MVP 产品砍法，不是系统做不到。本 spec 把这条砍法收回。

## 1. 数据流

```
客户端编辑面板
  hydrate：已有内容媒体（排除 poster）按 sortOrder 进宫格
  用户叉掉 / 追加本地图（compress + 待上传）
  dirty：仅增删过才把 mediaIds 放进 PATCH；顺序 = 当前宫格顺序

PATCH /api/moments/:id  { mediaIds?: uuid[] }   // 仍不传 type
  → patchMomentInputSchema（可选、uuid、去重、0–9；仍 strict 拒未知键与 type）
  → MomentService.update
       鉴权 viewer + 作者 + 未软删（现网不变）
       若 posterMediaId !== undefined（含 JSON null）→ 400 MEDIA_NOT_ALLOWED
       若 mediaIds === undefined → 跳过媒体分支（现网其余字段照旧）
       否则进入事务：FOR UPDATE 重读 moment，originalType = 锁后 type
         originalType=video → 400 MEDIA_NOT_ALLOWED（含 mediaIds:[]）
         否则按锁后 originalType 做全量替换（§4.5）
         已绑定本 moment 的内容行：保留，按新下标重写 sortOrder
         未绑定、uploader=作者、status=ready 的 tmp 行：copy tmp→final，绑 momentId
         离开集合的旧内容行：momentId=null, status='orphaned', orphanedAt=now
         推导 type：仅允许保持 或 text→media
         新进入集合的静态可压图：derived_status=pending + emitOutbox(moment.compress)
       然后走现网 tagIds / personIds / place / extract hash / maybeEmitMomentEmbed
  → serializeMoments（预签名 GET）

worker
  moment.compress：与 fused-retrieval 相同（GIF/HEIC/HEIF 不压；有界 getObject 原图）
  全部可压图终态且 hash 变 → emit moment.embed
  moment.embed：先 DELETE /api/internal/embeddings/:momentId 再按新集合 upsert
                （离开集合的图向量随这次整时刻重嵌消失，不按 media 逐条删、不新 outbox 类型）

sweeper
  既有 sweepOrphanedMedia 按 orphanedAt 保留期物理删对象；本 spec 让 destroyMediaObject
  同时删 derived_s3_key（§5.3）。请求线程不删行、不删对象。
```

- 请求路径仍然 **零读像素、零 DashScope**。压图 / 嵌向量只走既有 outbox。
- tmp→final 的 copy 时机对齐落地 create（`MomentService.create` 在发布事务内 `storage.copyObject`），不是 CONVENTIONS §3.3 草稿里「complete 时 copy」那句；complete 仍只把行推到 `ready`。PATCH 新进集合的行走同一 copy。事务提交成功后 best-effort 删 tmp 对象（失败靠 `tmp/` lifecycle 7 天兜底），与 create 相同，禁止在 copy 成功前删 tmp。
- `handleMomentCompress` 入口仍是「`!row.momentId` 即跳过」。入口之后到写回之前有窗口（getObject + sharp 期间 PATCH 可能 orphan 该行）。本 spec **允许两处最小补丁**（不改函数签名、不改 payload）：
  1. 终态 `UPDATE media SET derived_* WHERE id=? AND moment_id IS NOT NULL`（`markDerivedFailed` / skipped / ready 三条都加）。
  2. **ready 路径**先 `uploadFile(derivedObjectKey(...))` 再 UPDATE。若 `affectedRows===0`：不 `maybeEmitMomentEmbed`；对该次 `derivedKey` 做 best-effort `deleteFile`（失败只 warn）。**不要**指望 sweeper 按行上 `derivedS3Key` 收到这个对象——0 行意味着 key 从未写进行。skipped / failed 不 upload，无此步。

## 2. 覆盖关系（历史口径作废的句子）

只在本文件声明，不修改历史 spec 文件：

| 历史句 | 本 spec 替换为 |
|---|---|
| web-product §4「媒体本轮不支持改已发布附件」 | 作者可在编辑态增删/换图（video 除外） |
| web-product §5「编辑态不重传媒体」 | 仅当用户增删过媒体才上传**新**本地图并提交 `mediaIds`；未动过的已绑行不重传 |
| app-edit-delete §1「`.strict()` 拒绝 mediaIds」 | `mediaIds` 成为合法可选键；仍拒绝 `type` |
| app-edit-delete §2 选图区隐藏 | text / media / voice 编辑态展示可编辑宫格；video 只读 |
| fused-retrieval §1 / §4.2「PATCH 不能改 mediaIds，update 不发 compress」 | 集合变化时：新进可压图发 `moment.compress`；无待压图且 embed hash 变则 `maybeEmitMomentEmbed`。未提交 `mediaIds` 的 PATCH 仍只可能 embed（正文/人物/地点） |
| video-poster「PATCH `.strict()` 拒 posterMediaId」 | `posterMediaId` 变为已知可选键；server 恒 400 `MEDIA_NOT_ALLOWED` |

create 路径、宫格混排视频（`type=media` 发布时仍允许 `image/*`+`video/*`，见现网 `create-moment.test.ts`）**不改**。只约束 PATCH 结果集。

## 3. dto / API

路由与方法不变：`PATCH /api/moments/:id`，controller 仍 `patchMomentInputSchema.parse(body)`（`apps/server/src/moments/moment.controller.ts`）。

`packages/dto/src/moments.ts` 的 `patchMomentInputSchema`：

- 现网 `.strict()` 把 `mediaIds` / `type` 当未知键 → `VALIDATION_ERROR`。本 spec 把 `mediaIds`、`posterMediaId` 收进对象，**仍 `.strict()`**，**仍拒绝 `type`**（未知键 → `VALIDATION_ERROR`）。
- `EMPTY_PATCH` refine 不变：`Object.values` 至少一项非 `undefined`。`mediaIds: []` 是有效非空补丁（是否合法由 server 按原 type 判）。
- dto **看不到** 当前行的 `type`，因此 **数量/mime 构成不在 dto 做**（与 voice create「dto 只验数量、mime 在 server」同分工）。

字段：

```ts
mediaIds: z.array(z.string().uuid()).optional(),
posterMediaId: z.string().uuid().nullable().optional(),
```

`mediaIds` 元素 **有意比 create 更严**：create 仍是 `z.array(z.string().min(1))`（dto 测试可用 `'m-1'`），**create 不改**。PATCH 行 id 均为 `randomUUID()`，T1 测试夹具必须用真 uuid，禁止照抄 create 的 `'m-1'`。

对象级 `superRefine`（在 `.strict()` 之后、与 `EMPTY_PATCH` 共存）：

| 条件 | issue message | path |
|---|---|---|
| `mediaIds` 有值且 `new Set(mediaIds).size !== mediaIds.length` | `MEDIA_COUNT_INVALID` | `['mediaIds']` |
| `mediaIds` 有值且 `mediaIds.length > 9` | `MEDIA_COUNT_INVALID` | `['mediaIds']` |

不要用 `z.array().max(9)` 的默认 `too_big` 文案（否则 issue.message 不是机器码）。超长与重复都只走上面的 superRefine，HTTP 包络仍是 ZodError → `VALIDATION_ERROR`，details[].message = `MEDIA_COUNT_INVALID`。长度 0 合法。非 uuid 元素走 zod uuid 失败，包络同样 `VALIDATION_ERROR`。

`posterMediaId`：**dto 放行**（含 `null`；否则 `.strict()` / 非 uuid 只能给出 `VALIDATION_ERROR`，锁不到决策 6 的机器码）。server 判断 `input.posterMediaId !== undefined`（`null` 与非空 uuid 一样）即 `HttpError(400, 'MEDIA_NOT_ALLOWED')`，不读其值、不改任何 poster 行。`{ posterMediaId: null }` 不是 `EMPTY_PATCH`。这是「试图改封面 / 清封面」的机器码出口，覆盖 video-poster 的未知键拒法。

客户端 **不传 `type`**。传了 → `.strict()` → 400 `VALIDATION_ERROR`。

`PatchMomentInput` / `UpdateMomentInput` 随 schema 推导。`packages/api-client` 的 `updateMoment(momentId, PatchMomentInput)` 无手写字段副本，dto 变更自动生效；补一条 client 测试：PATCH JSON 体能带 `mediaIds`。

不改 `createMomentInputSchema`、不改 `MomentMedia` / `MomentResponse` 形状（序列化已含预签名 URL）。

## 4. Server 事务语义

改动集中在 `apps/server/src/moments/moment.service.ts` 的 `update`。鉴权 / 作者 / 软删 / kind·payload 合并校验 / tagIds / personIds / place / extract hash 判据 **保持现网顺序与口径**。媒体分支插在「写 moments 行其它列」的同一 `db.transaction` 内，**先于** `replaceMomentTags` / `replaceMomentPersons` / geocode / extract / `maybeEmitMomentEmbed`，保证 embed 指纹看到的是替换后的媒体行。

现网注释「媒体不可改（dto 层 .strict() 已拒绝 mediaIds/type）」作废，改为本小节。

### 4.1 内容媒体 vs poster

「内容媒体」= 该 `momentId` 下、**不是 poster 的** media 行。判定与 `serializeMoments` 相同：查出 `momentId` 下全部行，`posterIds = Set(rows.map(r => r.posterMediaId).filter(Boolean))`，内容媒体 = `!posterIds.has(r.id)`。

- voice：内容 = 1 条 `audio/*` + 0–8 条 `image/*`。audio **不排除**。
- media：内容 = 宫格行（发布时可能含 `video/*`；PATCH 结果集不允许再含）。
- video：内容 = 那一条 `video/*`；poster 行不进集合。本 spec 不碰任一行。
- text：内容为空集。

PATCH **永不** orphan / 改写 poster 行，**永不**把 poster id 收进新集合（提交 poster id → `MEDIA_INVALID`）。

### 4.2 `posterMediaId !== undefined`

在媒体分支最前（可在开事务前，只看 input）：`input.posterMediaId !== undefined`（含 JSON `null`）立即 `throw new HttpError(400, 'MEDIA_NOT_ALLOWED')`。不写库。任意 type 都如此。即使 `mediaIds` 缺省也要拦（只改正文却夹带 poster 仍拒）。

### 4.3 `mediaIds === undefined`

整段媒体逻辑跳过：不锁媒体行、不改 `type`、不发 compress。然后走现网其余字段；末尾仍调用既有 `maybeEmitMomentEmbed`（正文/人物/地点导致的 hash 变）。这保持 fused-retrieval「只改正文的 PATCH 不发 compress」的测试意图。

### 4.4 `originalType === 'video'` 且 `mediaIds` 有值

判定发生在 §4.5 step 2：**锁后**的 `originalType`，禁止用事务外 `m.type`。命中则 `throw new HttpError(400, 'MEDIA_NOT_ALLOWED')`。含 `[]`。不 orphan 视频行、不改 poster。

### 4.5 全量替换步骤（text / media / voice）

前置：无 `posterMediaId` 键（§4.2）、`mediaIds` 有值（不是 §4.3）。**不要**用事务外的 `m.type` 当「原 type」——并发 PATCH 会把 text 升级成 media，后到者若仍按快照 `text` 套 `[]` 矩阵会 200 并 orphan 掉刚绑的图，留下 `type=media` 且 0 条内容图（打穿锁定决策 3）。`copiedTmp` 与 create 同形，**事务提交后**再 `deleteFile` tmp。

1. **锁 moment 行并重读 type**：`const [locked] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1).for('update')`。`originalType = locked.type`。事务外那份 `m.type` 从此禁止进入矩阵、video 闸门、step 10。`locked` 缺失或 `deletedAt` 非空 → 与现网一样 404 / 410（防御）。
2. **video 闸门（§4.4）**：`originalType === 'video'` → `HttpError(400, 'MEDIA_NOT_ALLOWED')`。
3. **读现有内容媒体**（同一事务、锁后）：按 §4.1 从该 `momentId` 排除 poster。记下 `existingContentIds`、voice 的 **原 audio id**（`mime` 以 `audio/` 开头的那一条；0 条或 ≥2 条视为损坏，只要本次提交了 `mediaIds` 就 `MEDIA_INVALID`）。内容行集合也必须来自锁后查询，禁止用事务外缓存。
4. **行锁媒体**：`lockIds = unique(existingContentIds ∪ input.mediaIds)`。`lockIds` **为空**（锁后仍是 text 且 `[]`）则跳过 `SELECT`（MySQL `IN ()` 非法）。非空则 `SELECT ... FROM media WHERE id IN (...) FOR UPDATE`。并发 create/PATCH 抢同一 tmp 行时，后到者读到 `momentId` 非空 → `MEDIA_INVALID`（与 create 同行锁语义）。
5. **先分类、再校验、最后才 copy / 写行**（校验失败必须零 copy、零 orphan）：
   - 对 `input.mediaIds` 每一项（保序）：
     - 锁集合里找不到 → `MEDIA_INVALID`
     - id ∈ posterIds → `MEDIA_INVALID`
     - `row.momentId === 本 momentId`：划入 **keep**（不要求再验 uploader；已是本时刻内容）
     - `row.momentId === null && row.uploaderId === userId && row.status === 'ready'`：划入 **incoming**（与 create 相同的「未绑定 tmp 行」）
     - 其它（不存在已在上面处理 / 非本人 / 非 ready / 已绑其它 moment / `orphaned` / `uploading`）→ `MEDIA_INVALID`
   - 禁止把其它 moment 的媒体拖过来（即使同一作者）。
6. **按 `originalType`（锁后）做结果集矩阵**（§4.6）。失败码见该表。此步仍零写。因此：A 已把 text 升级为 media 并绑 1 张图之后，B 的 `mediaIds: []` 看到 `originalType=media` → `MEDIA_COUNT_INVALID`，**不会** orphan A 的图。
7. **orphan 离开集合的旧内容行**：`existingContentIds - Set(mediaIds)` 的每一行 `UPDATE media SET momentId=null, status='orphaned', orphanedAt=now()`。不改 `s3_key` / `derived_*`（sweeper 凭这些 key 删对象）。**不**物理删行或对象。
8. **keep**：只 `UPDATE sortOrder = mediaIds.indexOf(id)`。不 recopy、不改 `s3_key`、不把 `derived_status` 打回 pending、不重发 compress。
9. **incoming**：与 create 同一套：
   - `ext = mime.extension(row.mime) || 'bin'`
   - `finalKey = chains/${chainId}/${momentId}/${row.id}.${ext}`（相对 key；prefix 由 adapter 拼，CONVENTIONS §3.3）
   - `storage.copyObject(row.s3Key, finalKey, row.storageMeta)`，tmp 入 `copiedTmp`
   - `UPDATE`：`s3Key=finalKey, momentId, sortOrder, storageMeta` 原样快照；**不写** `posterMediaId`（PATCH 不碰封面；create 循环里给内容行写 poster 的那一枝这里不要抄）。若 `isCompressibleMime(row.mime)`（`apps/server/src/media/derived.ts`：`image/*` 且不是 gif/heic/heif）则 `derivedStatus='pending'`，并把 id 记入 `compressIds`
10. **写 `moments.type`**：仅当 `originalType === 'text'` 且结果集长度 ≥ 1 时 `type='media'`；media 保持 media，voice 保持 voice。其它转换已被矩阵拒绝。
11. **同事务** 对每个 `compressIds`：`emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId, chainId, mediaId })`。payload camelCase，类型常量不改名（`apps/server/src/outbox/types.ts` 的 `OUTBOX_MOMENT_COMPRESS` / `MomentCompressPayload`）。
12. 事务其余部分（content 等列、tags、persons、geocode、extract、**既有** `await maybeEmitMomentEmbed(tx, momentId)`）照旧。不要新 outbox 类型，不要在 update 里直接调 Lance / `deleteVectorsByMomentId`。
13. 提交后循环 `copiedTmp` 删 tmp，失败只 warn。

`maybeEmitMomentEmbed`（`apps/server/src/moments/embed-outbox.ts`）现成行为直接消费：

- 该时刻仍有 `derived_status='pending'` 的可压图 → return（等 compress 终态再嵌）。
- `computeEmbedHash`（含 `derivedFingerprintOf`：只纳入可压图，按 `sortOrder,id`）与 `moments.embed_hash` 相同 → return。
- 否则 `emitOutbox(OUTBOX_MOMENT_EMBED, { momentId, chainId })`。

因此：

- 新进 JPEG/PNG 等可压图：compress 链，update 末尾 embed 被 pending 挡住。
- 只删可压图 / 只改 sortOrder / 只进 GIF·HEIC·HEIF（不 pending）：hash 变则直接 embed。
- 只进/只出 GIF 等不可压图：fingerprint 不含它们，hash 可能不变，embed 跳过——这些图本就不进向量，与 create GIF-only 行为一致。
- 未提交 `mediaIds`：不发 compress；embed 只随正文/人物/地点。

`handleMomentEmbed` 第 6 步已是「先 HTTP DELETE 该 momentId 全部向量再 upsert」。离开集合的图向量在这次重嵌时消失。压缩完成前的短暂窗口里旧图向量仍可能召回该时刻，与 create「压完才嵌」相同，不在请求线程同步删 Lance。

extract：`computeAiExtractHash(content, transcript)` 不含媒体。只改 `mediaIds` 不改正文时 **不** 因媒体变化而多发 `moment.extract`。text→media 且正文未变：同样不发 extract。transcribe：voice 音频不变，不重发 `moment.transcribe`。

text 升 media 后 `content` 可空（与 create media 一致）。media 时刻 PATCH 仍允许空 content（现网 dto 已允许）。server **不**在 PATCH 上加 `CONTENT_REQUIRED`（现网 update 也没有）。

### 4.6 结果集矩阵（server，`originalType` × 提交的 `mediaIds`）

dto 只保证：可选、uuid、去重、长度 0–9。下表在事务内、copy 之前判定。**`originalType` = §4.5 step 1 FOR UPDATE 后的 `locked.type`**，不是事务外 `m.type`。`结果 mime` 看分类后的 keep+incoming **行上 mime**（不是客户端自称）。

| originalType | `mediaIds` | 结果 type | HTTP |
|---|---|---|---|
| 任一 | 缺省 `undefined` | 不变 | 200（媒体分支跳过，§4.3） |
| 任一 | body 含 `posterMediaId`（uuid 或 `null`） | 不变 | 400 `MEDIA_NOT_ALLOWED`（§4.2，先于开事务） |
| 任一 | body 含 `type` | — | 400 `VALIDATION_ERROR`（dto `.strict()`） |
| `text` | `[]` | `text` | 200（0 媒体，保持 text；无行可 orphan） |
| `text` | 1–9 条，全部 `image/*` | `media` | 200 |
| `text` | 1–9 条但并非全部 `image/*`（含 audio/video/pdf/octet-stream 等） | — | 400 `MEDIA_INVALID` |
| `media` | `[]` | — | 400 `MEDIA_COUNT_INVALID`（禁止删光变 text） |
| `media` | 1–9 条，全部 `image/*` | `media` | 200 |
| `media` | 1–9 条但并非全部 `image/*`（含 audio/video/pdf 等） | — | 400 `MEDIA_INVALID` |
| `voice` | 恰好含 **原 audio id**（不要求下标 0），其余 0–8 全 `image/*`，合计 1–9 | `voice` | 200 |
| `voice` | `[]` / 缺原 audio / 换成另一条 audio / audio 条数 ≠ 1 / 其余项并非全部 `image/*`（含 video/pdf 等） | — | 400 `MEDIA_INVALID` |
| `video` | 任何数组（含 `[]`） | — | 400 `MEDIA_NOT_ALLOWED`（锁后 §4.4） |
| 任一 | 含已绑其它 moment / 非本人 / 非 ready / 不存在 / poster id | — | 400 `MEDIA_INVALID` |
| 任一 | 重复 id / 长度 >9 | — | 400 `VALIDATION_ERROR`（dto `MEDIA_COUNT_INVALID` issue） |

存量「`type=media` 且宫格里已有 `video/*`」（create 仍允许混排）：

- 不提交 `mediaIds`：视频留在原处，时间线不变。
- 一旦提交 `mediaIds`，结果集必须全是 `image/*`——客户端若把存量 video 留在宫格里一起提交，server `MEDIA_INVALID`。产品语义：改图就必须先叉掉宫格视频；本 spec 不提供「保留宫格视频同时改图」。

`sortOrder` = 提交数组下标（0-based），响应 `media` 按 `sortOrder` 升序（现网 serializer 已 sort）。

## 5. outbox / worker / sweeper

### 5.1 不改的符号

`OUTBOX_MOMENT_COMPRESS` / `OUTBOX_MOMENT_EMBED`、payload 形状、`emitOutbox`、`maybeEmitMomentEmbed`、`handleMomentEmbed`、`isCompressibleMime`、`derivedObjectKey`、BA `DELETE /api/internal/embeddings/:momentId`：本 spec **零改名、零改语义**。`handleMomentCompress` **除终态 UPDATE 的 WHERE、以及 ready 路径 `affectedRows===0` 时 best-effort `deleteFile(derivedKey)` 外**，零改名、零改语义。只让 update 在集合变化时走 create 已经在走的那条发射路径。

fused-retrieval §4.2 发射规则替换为：

| 事件 | compress | embed |
|---|---|---|
| create 素材 | 每张静态可压图一行 | 无 pending 且 hash 变才直接 embed |
| PATCH **未**带 `mediaIds` | 不发 | hash 变则 `maybeEmitMomentEmbed` |
| PATCH 新进静态可压图 | 每张新进可压图一行（keep 的 ready/skipped/failed/pending 不重发） | 有 pending 则等 compress 终态 |
| PATCH 只 orphan / 只改 sortOrder / 只进不可压图 | 不发 | hash 变则直接 embed |
| compress 全部可压图终态 | — | 既有 handler 末尾 `maybeEmitMomentEmbed` |

GIF / HEIC / HEIF：**不** emit compress、`derived_status` 保持 NULL，与 fused-retrieval §2.1 相同。

`handleMomentCompress` 本 spec 只改 §1 那两处（WHERE + 0 行时删刚 upload 的 derivedKey）。0 行：不 `maybeEmitMomentEmbed`，handler 正常返回（outbox done）。函数签名、payload、sharp 参数、GIF 跳过规则都不动。禁止把派生列写回 orphan 行来「方便 sweeper」——那会污染已离开集合的行。

### 5.2 软删 vs 编辑 orphan

`handleMomentDeleted`（`moment.deleted`）仍把该时刻 **全部 ready 行**（含 poster、audio）标 orphaned。PATCH 只 orphan **离开集合的内容行**，时刻本身还在。两条路径都写 `orphanedAt`，都交给既有 sweeper，请求线程都不 `deleteFile`。

### 5.3 sweeper 删派生对象

`apps/server/src/worker/sweeper.ts` 的 `destroyMediaObject` 是 **模块内部函数，不导出、不升为 public API**。现网只 `deleteFile(row.s3Key)`。编辑换图会 orphan 已有 `derived_s3_key` 的行，派生对象不在 `tmp/` lifecycle 覆盖内。本 spec **扩展该内部函数**，计划经 `sweepOrphanedMedia` / `sweepSoftDeletedMomentMedia` 断言，不要新入口、不要 export。

1. 若 `row.derivedS3Key` 非空：先 `deleteFile(derivedS3Key, storageMeta)`；失败 → 与现网原图失败相同，`return false`（**保留行**，下轮重试）。派生是「正式对象」，不能删行留对象。
2. 再删 `s3Key`（现网逻辑）。失败同样 `return false`。
3. 两者都成功才允许调用方 `DELETE FROM media`。
4. **`SweepResult.deletedObjects`：每成功一次 `deleteFile` +1**。一行同时删派生 + 原图 → `deletedObjects += 2`。现网 `sweeper.test.ts` 里 `expect(result.deletedObjects).toBe(1)` 在夹具带 `derivedS3Key` 时改为 2；无派生列的行仍为 1。

abort multipart 仍只针对 `uploadId`（orphaned 内容行通常为 null）。`deleteFile` 对对象已不存在视为成功（S3 `DeleteObject` 幂等；mock 同样按成功处理），以便「上次已删派生、本次重试原图」不卡死。不改 `MOMENT_SOFT_DELETE_RETENTION_DAYS`、不改 batch 上限。软删到期路径走同一内部函数，存量泄漏一并收口。

## 6. Web

文件：`apps/web/src/compose/compose-panel/index.tsx`、`compose-panel.service.ts`（及现有 `compose-panel.service.test.ts`）。UI 只消费已发布 token / Button / Field / Sheet / IconButton / Banner，不写十六进制或一次性尺寸。分享页 `readOnly` **不改**。

### 6.1 编辑态不再隐藏选图

去掉「`edit && edit.media.length > 0` → 只读 `MediaBlock` + 『已发布的媒体不能更换』」和「选图区 `!edit` 才渲染」这一对互斥。按原 type 分支：

| 原 type | 媒体区 |
|---|---|
| `text` / `media` | 可编辑宫格（已有图、存量视频占位格、新本地预览）+「加图片」；**不**渲染「加视频」、**不**渲染 `VoiceRecorder` |
| `voice` | 原 audio 用既有 `AudioBar` **只读**（不能换录音）；附图进同一套可编辑宫格；「加图片」；无录音器、无加视频 |
| `video` | 既有 `MediaBlock` 只读 + 文案「视频发布后不能更换」；无加图片/视频 |

已有 `image/*`：`<img src={cardDisplayUrl(m)}>`（`apps/web/src/lib/media-src.ts`：`derivedUrl || url`，已是预签名 https）。存量 `video/*`：占位面用已发布 token `bg-ink` + 文案 `text-bg`「视频」+ 叉，不挂播放器、不写十六进制、不新发明 `h-[…]` / 负边距。新图继续 `URL.createObjectURL`。每格叉按钮复用现网 compose 本地图那颗 `IconButton`（Lucide `X`，`variant="secondary"`，`className="absolute -right-1 -top-1"` 是既有调用，新格照抄、不另做尺寸）。`focus-visible` 走组件既有 ring。

宫格顺序：先留下的已有内容格（原相对顺序），后追加的本地图。本 spec **不做**拖拽重排。提交顺序 = 该宫格顺序（voice 在数组首位插入 `keptAudio.id`，见 §6.3）。

### 6.2 Service 状态

`ComposePanelService.hydrate`（每次打开编辑或新建都必须跑完这一组复位，面板是 `bindServices` 长寿命实例）：

- 草稿一律清零，避免「记下 → 编辑」残留：`images = []`（先 revoke 旧 previewUrl）、`video = null`、`voice = null`、`posterBlob = null`、`posterMediaId = null`、`replaceConfirm = null`、`pendingFiles = []`。
- `keptMedia: MomentMedia[]`：
  - 新建 / 无 edit：`[]`
  - `text`：`[]`
  - `media`：`edit.media` 全部内容行（`image/*` **和存量 `video/*`**，poster 本来就不在 `MomentResponse.media` 里）
  - `voice`：仅 `image/*`；audio 另持 `keptAudio: MomentMedia | null`（按 `mime` 以 `audio/` 开头取，不按下标 0 猜）。**禁止**把 `audio/*` 推进 `keptMedia`，否则 `editOccupied` 会多占一格、附图 cap 变成 7。
  - `video`：不进 `keptMedia`（只读 `MediaBlock`）
- `keptAudio`：仅 `edit.type==='voice'` 时赋值，否则 `null`。
- `mediaTouched = false`。
- `baselineMediaIds: string[]`：voice = `[keptAudio.id, ...keptMedia.map(m => m.id)]`（无 audio 则视为损坏，提交前置失败）；text/media = `keptMedia.map(m => m.id)`；video / 新建 = `[]`。关闭确认的 dirty 基线要带上这个数组。

**容量：编辑与新建禁止共用一个表达式。**

编辑（只用已发布 type，禁止读 `this.voice` / `this.video`）：

```ts
function editImageCap(edit: { type: MomentType }): 8 | 9 {
  return edit.type === 'voice' ? 8 : 9;
}
function editOccupied(keptMedia: MomentMedia[], images: { file: File }[]): number {
  return keptMedia.length + images.length; // 依赖：audio 永不进 keptMedia；media 存量 video 格算占用
}
```

`addImages` **内部必须分支**，禁止编辑再走 `this.voice`（hydrate 已把 `voice` 置 `null`，否则 voice 编辑 cap 会变成 9，提交 1 audio + 9 图打穿决策 5）：

```ts
addImages(files: File[]): void {
  const next = [...this.images];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    // size 上限现网不变
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

- 编辑：`cap` / `occupied` **只用** `this.edit.type` 与 `keptMedia`，读 `this.voice` 是 bug。
- 新建：现网口径，`this.voice ? 8 : 9`，占用 = `next.length`。本 spec 不改新建。
- 「加图片」`disabled` 与循环里同一对 `cap`/`occupied`（编辑 `editOccupied(keptMedia, images) >= editImageCap(edit)`）。disabled 挡不住粘贴/拖放/文件框，所以 **`addImages` 本身必须拒第 N+1 张**，不能只靠按钮。

动作：

- 叉掉已有格 → 从 `keptMedia` 移除，`mediaTouched = true`。voice 的 audio **没有叉按钮**。
- 编辑态选图 / 粘贴 / 拖放：**不**调用 `onPickImages` / `onPickVideo`（那两条会走 `replaceConfirm`）。只收 `image/*` 再进上面的 `addImages`；碰到 `video/*` **直接拒绝**，文案「编辑时不能换成视频」。
- 新建态 `onPickImages` / `onPickVideo` / `confirmReplace` 现网不变（仍可进 `addImages` 的新建分支）。
- `removeImage`（本地草稿）现网不变；编辑态再置 `mediaTouched = true`。

存量 `type=media` 且 `keptMedia` 含 `video/*`：视频格渲染深色占位 + 文案「视频」+ 叉（不挂播放器、不上 `VideoPosterPicker`）。若 `mediaTouched` 且提交前 `keptMedia` 仍含 `video/*`，前置拦截 `error = '改图片前请先移除宫格里的视频'`，不打 API。

### 6.3 dirty 与提交

面板关闭确认的 `isDirty`（`index.tsx` 的 `DraftBaseline` 增 `mediaIds: string[]`，hydrate 时写入 `baselineMediaIds`）：下列任一即为媒体 dirty——`service.mediaTouched`；或当前提交序 id 数组（voice 含 audio）与 `baselineMediaIds` 不等；或 `images.length > 0`。其它字段（正文/时间/标签/人物/地点/payload）现网不变。

`submit` 编辑分支：

- 仍不传 `type`、不传 `posterMediaId`。
- **仅当 `mediaTouched`** 才带 `mediaIds`（动作级；叉掉再加回同一已有 id 也算动过，仍提交）。编辑分支 **不得** 走新建的 `createMoment` 路径。顺序钉死：先按宫格从左到右串行 `compressImage` + `client.uploadMedia({ kind: 'image' })` 拿新 id，再 `client.updateMoment`；已有格不重传。`mediaIds` = 该宫格顺序下的 id 数组。voice：**客户端**把 `keptAudio.id` 放在数组首位（server 只验「集合含原 audio」，不验下标）。无 `keptAudio` → 前置失败，文案「录音不能换」，不打 API。
- 未动媒体：请求体不含 `mediaIds` 键（与 `personIds` / `place` 的 dirty 纪律相同）。
- 前置人话：
  - 原 `text` 且结果 0 图且标准 kind 且正文空：保持现网「先写一句此刻吧」。
  - 原 `text` 且结果 1–9 图：允许空正文（升级为 media）。
  - 原 `media` 且结果 0 图：`至少留一张图`。
  - 原 `voice`：不校验正文必填（现网编辑也不因 voice 强求正文）。
- 上传失败：面板不关、稿保留（现网 `humanError`）。
- 成功：`moment:changed { op:'update' }`，关面板。现网 revoke 本地 previewUrl。

`apps/web/src/lib/errors.ts` 增补（app 对称，§7）：

```
MEDIA_INVALID: '这些图片不能用，请重新选择'
MEDIA_NOT_ALLOWED: '这种时刻不能改媒体'
```

`MEDIA_COUNT_INVALID` 现网「图片或视频数量不对」保留。`MEDIA_INVALID` 是兜底；voice 缺原 audio 在客户端前置拦掉（「录音不能换」），不依赖这句人话解释机器码。

粘贴：去掉 `if (edit || busy) return` 里对 `edit` 的短路；改为 `busy` 或 `edit.type==='video'` 才忽略。拖放同。

## 7. App

文件：`apps/app/src/features/compose/index.tsx`、`compose.service.ts`、`compose.service.test.ts`（新建）；宫格叉按钮落在 `apps/app/src/components/MediaGrid.tsx` 的可选回调；`apps/app/src/lib/media.ts` 的 `pickImages` 增加可选 `selectionLimit`（默认 9，create 调用点不传）。

### 7.1 编辑态 UI

`index.tsx` 现网 `isEdit` 时隐藏 SegmentBar / 选链 / 选图 / 选视频 / `VoiceRecorder`，并把 `service.edit.media` 整包丢给只读 `MediaGrid`。改为 **不要再整包只读**（会把待叉的图冻住、漏掉新本地图）：

| 原 type | UI |
|---|---|
| `text` / `media` | `MediaGrid` 渲染 `keptMedia`（含存量 `video/*`）并传 `onRemove`；其下本地 `images` 预览可叉；按钮「选图（n/9）」达 cap 禁用；无选视频、无类型条 |
| `voice` | 既有 `AudioBar` 只读（`apps/app/src/components/AudioBar.tsx`）；附图「选图（n/8）」；无重录 |
| `video` | 只读 `MediaGrid`（不传 `onRemove`）+ 文案「视频发布后不能更换」 |

`MediaGrid` 增加可选 `onRemove?: (mediaId: string) => void`：

- **不传**（时间线 / 视频编辑只读）：现网 `VideoCell`（海报 / ▶ /「进详情播放」）零变化。
- **传入**（图文/混排编辑）：`image/*` 与 `video/*` 格都显示移除。video 格 **不要** 再用可点的 `VideoCell` 播放语义；改成与 web 同义的占位 +「视频」+ 叉（theme token：`ink` 底、`bg` 字，不写 hex）。
- `audio/*` 仍不渲染（compose 用 `AudioBar`）。

禁止编辑态 `chooseVideo` / `setVoice`。

### 7.2 `loadForEdit` 复位与容量（与 web 拆开，禁止抄 §6.2 那条共用公式）

`loadForEdit` 在赋值 `edit` 的同时显式复位：`images = []`、`video = null`（经 `resetPoster` / `clearVideo`）、`voice = null`、`poster = null`、`posterMediaId = null`、`mediaTouched = false`。然后填 `keptMedia` / `keptAudio` / `baselineMediaIds`，规则与 web §6.2 的 **kept 分类**相同（不是容量公式相同）。同样 **禁止** 把 `audio/*` 推进 `keptMedia`。

编辑容量（只用 `edit.type`）：

```ts
function editImageCap(edit: { type: MomentType }): 8 | 9 {
  return edit.type === 'voice' ? 8 : 9;
}
function editOccupied(keptMedia: MomentMedia[], images: ReadyImage[]): number {
  return keptMedia.length + images.length;
}
```

`pickMoreImages` **编辑态**：`remain = editImageCap(this.edit) - editOccupied(this.keptMedia, this.images)`；`remain <= 0` 抛现网中文 Error。调用 `pickImages({ selectionLimit: remain })`，禁止再写死 `selectionLimit: 9` 再 slice（用户会以为选中了却被丢掉）。

`pickMoreImages` **新建态**（本 spec 不改口径）：继续 `const cap = this.type === 'voice' ? 8 : 9`（SegmentBar 已切到 voice 时即使未录音也是 8），`remain = cap - this.images.length`，`pickImages` 默认 limit 9 或同样传 `remain`。禁止用 `Boolean(this.voice)` 当 app 新建 cap——那会让未录音的 voice 变成 9，create 走出 1 audio + 9 图。

叉已有格、`pickMoreImages`、清空本地图都置 `mediaTouched = true`。

### 7.3 dirty 与 `submitEdit`

`submitEdit`：仅 `mediaTouched` 时先串行上传新图再 PATCH，带 `mediaIds`（voice 以 `keptAudio.id` 开头）。未动不传该键。前置校验对齐 §6.3（文字空正文 + 无新图；media 不能 0 图；混排残留 video 人话「改图片前请先移除宫格里的视频」；无 `keptAudio` →「录音不能换」）。时间 / 标签 / 人物 / 地点 dirty 纪律不变。成功仍 `moment:changed { op:'update' }`。

`apps/app/src/lib/errors.ts` 与 web 相同两句 copy。

编辑加载失败 404/410 文案现网不变。

### 7.4 单测

新建 `apps/app/src/features/compose/compose.service.test.ts`（Vitest，与源码同目录）。app 无独立 `vitest.config.ts`，沿用现网 `src/lib/*.test.ts` 的默认 vitest；**不新增 package scripts**。

文件顶部必须 `vi.mock`：

- `expo-location`
- `expo-video-thumbnails`
- `../../lib/media`（`pickImages` / `compressImage` / `pickVideo` / `validateVideo` / `uriToBlob`）
- `../../lib/api`（`client.updateMoment` / `client.getMoment` / `client.uploadMedia`）

注入套路对齐 web `compose-panel.service.test.ts`：`register(ComposeService)` 后 `resolve`，断言 `updateMoment` 的 JSON 体。命令：`pnpm --filter @moment/app test -- src/features/compose/compose.service.test.ts`。用例与 web 同一组 dirty/submit（未动无 `mediaIds`；叉后提交剩余 id；text 加图先 upload 再 PATCH；video 编辑不 upload）。

## 8. 错误码

不新增机器码。HTTP 包络 `error.code`（`ErrorHandlerMiddleware`：ZodError 恒 `VALIDATION_ERROR`；`HttpError` 的 `message` 为 UPPER_SNAKE 则当 code）。

| 码 | HTTP | 层 | 何时 |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | dto | 未知键（含 `type`）；`mediaIds` 元素非 uuid；zod 其它字段失败。details 里重复/超长的 issue.message 为 `MEDIA_COUNT_INVALID` |
| `EMPTY_PATCH` | 400 | dto refine | 所有键都是 `undefined` |
| `MEDIA_COUNT_INVALID` | 400 | server `HttpError` | 原 `type=media` 且结果 0 条。dto 重复/超 9 不走这个包络 code（走 `VALIDATION_ERROR`），与 create 数量失败同形 |
| `MEDIA_INVALID` | 400 | server | 不存在 / 非本人 / 非 ready / 已绑别人 / poster id / mime 构成不匹配 / voice 缺原 audio 或换 audio |
| `MEDIA_NOT_ALLOWED` | 400 | server | `posterMediaId !== undefined`（含 `null`）；或锁后 `originalType=video` 且提交了 `mediaIds` |
| `NOT_MOMENT_AUTHOR` | 403 | server | 现网，非作者（含 owner） |
| `MOMENT_NOT_FOUND` | 404 | server | 现网；非成员一律 404 |
| `MOMENT_DELETED` | 410 | server | 现网；仅成员可见 |
| `CHAIN_NOT_FOUND` | 404 | policy | 现网；作者退链后成员资格优先于作者身份 |

不用 `MEDIA_ALREADY_BOUND`（那是 discard-media / 链外观的活引用码）。已绑其它 moment 的行在 PATCH 里与 create 一样走 `MEDIA_INVALID`。

## 9. 测试策略

遵守 `.claude/rules/testing.md`：server 触库 `--runInBand`、`afterAll(closeDb)`、`resetDb()`；只打 `.env` 测试库。dto 与源文件同目录。存储 mock `installMockStorage`。不在测试里打 DashScope、不读真实像素。

**dto**（`packages/dto/src/moments.test.ts`）：

- `{ mediaIds: [uuid] }` / `{ mediaIds: [] }` 通过；仅 `mediaIds` 不是 `EMPTY_PATCH`。夹具必须是真 uuid，禁止 `'m-1'`。
- 10 条、重复 id → 失败且 issue `MEDIA_COUNT_INVALID`。
- 非 uuid → 失败。
- `{ type: 'media' }` 仍失败（strict）。
- `{ posterMediaId: uuid }` 与 `{ posterMediaId: null }` **通过 parse**（改掉现网「strict 拒 posterMediaId」用例）；未知键仍失败。
- create 矩阵不回归（create 仍接受 `'m-1'`）。

**api-client**：`updateMoment` 请求 JSON 含 `mediaIds`。

**server**（新建 `apps/server/tests/moments/moment-update-media.test.ts`，并改下列现网文件的断言）：

- `moment-list-crud.test.ts`「媒体不可改」用例：`mediaIds: ['x']` 现为 400；改为非 uuid → `VALIDATION_ERROR`，合法 uuid 走本文件矩阵。作者改 content 仍 200。
- `moment-poster.test.ts`「PATCH 传 posterMediaId → 400 VALIDATION_ERROR」改为 400 `MEDIA_NOT_ALLOWED`，且视频行 / poster 行 `momentId` 与 `s3_key` 未动；补 `posterMediaId: null` 同一码。
- `moment-compress-emit.test.ts`「PATCH 不 emit compress（不能改媒体）」拆成：只改正文 → compress 行数不变；追加 JPEG → 新 compress payload `{momentId,chainId,mediaId}` 且新行 `derivedStatus='pending'`；keep 的旧 JPEG 不第二行 compress。
- `apps/server/tests/worker/sweeper.test.ts`：夹具带 `derivedS3Key` 的行，`deletedObjects` 按每次成功 `deleteFile` +1（派生+原图 = 2）；无派生仍为 1；派生 `deleteFile` 失败不删行。
- GIF/HEIC/HEIF 新进：不 compress、`derived_status` NULL。
- text + 1 张 JPEG → 200、`type==='media'`、tmp→final key 布局 `chains/{chainId}/{momentId}/{mediaId}.{ext}`、orphan 无。
- text + `[]` → 200、`type==='text'`（锁后仍是 text）。
- media 删到 0 → 400 `MEDIA_COUNT_INVALID`，原行仍绑着。
- media 换图：旧行 `status='orphaned'` 且 `momentId` null 且 `orphanedAt` 非空；新行绑上；响应 `media` 顺序 = 提交顺序。
- 拖其它 moment 的图 / 非本人 / uploading / `application/pdf` 行 → `MEDIA_INVALID`，目标时刻媒体不变。
- voice：改附图成功且 audio id 仍在集合中；缺 audio / 换 audio / 其余项非 image → `MEDIA_INVALID`。
- video + `mediaIds` → `MEDIA_NOT_ALLOWED`；视频行与 poster 行未动。
- 并发 tmp 行：同一 tmp 被两个 PATCH/create 抢，后到 `MEDIA_INVALID`（行锁）。
- **并发 type**：text 时刻 `Promise.all` 同时 PATCH `mediaIds:[jpeg]` 与 `mediaIds:[]`。终态不变量：禁止出现 `type=media` 且 0 条内容图。若升级先提交，后到者必须 400 `MEDIA_COUNT_INVALID` 且 jpeg 仍绑定。另补顺序用例：先 200 升级再 PATCH `[]` → `MEDIA_COUNT_INVALID`。
- embed：构造两张已 `derived_status='skipped'`（或 ready）且无 pending 的 media 时刻，PATCH 删一张 → 新 `moment.embed`；只改正文的既有 embed 用例不回归。
- compress handler：orphan 后再让在途 compress 走完 ready 写回 → `UPDATE` 0 行、不发 embed、派生列不写到 orphan 行；mock `deleteFile` 收到这次 `derivedObjectKey`（best-effort；失败不抛）。skipped/failed 路径不调用这次 delete。

**web**：`compose-panel.service.test.ts` 扩编辑态：未动媒体 → body 无 `mediaIds`；叉一张再保存 → `mediaIds` 为剩余 id（先 mock `compressImage` + `uploadMedia` 再断言 `updateMoment`）；text 加图 → 上传后 `mediaIds` 仅新 id；video 编辑不调用 upload、不带 `mediaIds`。**cap 接线（P0-2）**：voice 编辑 `keptMedia` 已 8 张时再 `addImages` 第 9 张被拒（`error`「语音时刻最多 8 张附图」、`images` 不增长），即使 `this.voice === null`；media 已有 8 张时再 paste 第 10 张内容被拒（`error`「最多 9 张图片」）。「加图片」disabled 与 `addImages` 用同一对 cap/occupied。`apps/web/src/pages/chain-home/chain-home.test.tsx` 现网「编辑已有媒体时刻只读展示媒体，不出现加图入口」+「已发布的媒体不能更换」改为：text/media/voice 出现「加图片」且可叉已有格；video 只读文案「视频发布后不能更换」、无加图按钮。

**app**：见 §7.4。手测清单：编辑图文叉/加、文字补图、voice 改附图且不能换录音、视频只读文案、满 9 禁用。

## 10. 非目标

- 不改视频文件、不改封面 poster、不改 `poster_media_id` 绑定语义。
- 不改分享页编辑（分享只读）。
- 不改 CONVENTIONS §3 方法名（`emitOutbox` / `copyObject` / `generateAccessUrl` / `getObject` / `maybeEmitMomentEmbed` / `serializeMoments` 等）。
- 不做编辑历史。
- 不把 media 删光变回 text。
- 不在请求线程读像素 / 调 DashScope / 连 Lance。`handleMomentCompress` 除终态 `WHERE moment_id IS NOT NULL`、以及 ready 路径 0 行时 best-effort `deleteFile(derivedKey)` 外不改。
- 不做宫格拖拽重排 UI、不把宫格混排视频做成可编辑保留。
- 不改 create 的 media 混排视频能力。
- 不改 voice 转写、不重录、不重发 `moment.transcribe`。
- 不改路由表、不新环境变量、不新表、不扩 `resetDb()` 表清单。
- 不把 orphan 行改回 `ready` 以便「撤销」；叉掉必须重传。

## 11. 实施分期

一份计划按下列顺序执行，每段可独立测试、每段一个 conventional commit。禁止占位实现。

### T1 — dto（`feat(dto): allow mediaIds on moment patch`）

- **Files**：`packages/dto/src/moments.ts`、`packages/dto/src/moments.test.ts`；`packages/api-client/src/client.test.ts`（PATCH 带 `mediaIds`）。
- **Produces**：`PatchMomentInput.mediaIds?: string[]`、`posterMediaId?: string | null`；`.strict()` 仍拒 `type`。
- **出口**：只跑 dto / api-client 测试（`pnpm --filter @moment/dto test` 与 api-client 对应命令）必须绿。**本 commit 不合入可部署的 server 镜像单独上线**——现网 `moment-list-crud.test.ts` 仍把 `mediaIds` 当未知键，T2 第一件事就是改那些断言并实现 update。T1 与 T2 由同一份计划连续执行。

### T2 — server（`feat(server): replace moment media on patch`）

- **Files**：`apps/server/src/moments/moment.service.ts`；`apps/server/src/media/handle-moment-compress.ts`（终态 UPDATE 加 `moment_id IS NOT NULL`；ready 路径 0 行则 `deleteFile(derivedKey)`）；`apps/server/src/worker/sweeper.ts`（内部 `destroyMediaObject`，不 export）；`apps/server/tests/moments/moment-update-media.test.ts`（新建）；必改断言：`moment-list-crud.test.ts`、`moment-poster.test.ts`、`apps/server/tests/worker/sweeper.test.ts`、`moment-compress-emit.test.ts`、`moment-embed-emit.test.ts`。
- **Consumes**：T1 schema；`emitOutbox` / `OUTBOX_MOMENT_COMPRESS` / `maybeEmitMomentEmbed` / `isCompressibleMime` / `getStorage().copyObject`；create 的 tmp→final 写法；`tx.select().from(moments).for('update')`。
- **Produces**：`MomentService.update` 在 `mediaIds` 有值时执行 §4（`originalType` 来自锁后行）；video/poster/`null` poster → `MEDIA_NOT_ALLOWED`。
- **出口**：§9 server 用例绿（含并发 type 不变量）；只改正文仍不发 compress。

### T3 — web（`feat(web): edit published moment images`）

- **Files**：`apps/web/src/compose/compose-panel/index.tsx`、`compose-panel.service.ts`、`compose-panel.service.test.ts`、`apps/web/src/lib/errors.ts`、`apps/web/src/pages/chain-home/chain-home.test.tsx`。
- **Consumes**：T1 `PatchMomentInput`；T2 API；`cardDisplayUrl`；现网 `compressImage` / `uploadMedia`。
- **Steps 必须写明**：`addImages` 按 §6.2 内部 `this.edit ? editImageCap(this.edit) : (this.voice ? 8 : 9)` 分支，编辑禁止读 `this.voice`；编辑 `submit` 先串行 `compressImage` + `uploadMedia({ kind:'image' })` 再 `updateMoment`，禁止复用新建 `createMoment` 分支；`hydrate` 按 §6.2 复位草稿。service 测试含 voice 第 9 张附图被拒、media 已有 8 张再 paste 被拒。
- **出口**：service + chain-home 测试绿；手测 §6 四类型编辑。

### T4 — app（`feat(app): edit published moment images`）

- **Files**：`apps/app/src/features/compose/index.tsx`、`compose.service.ts`、`compose.service.test.ts`（新建）、`apps/app/src/components/MediaGrid.tsx`、`apps/app/src/lib/errors.ts`、`apps/app/src/lib/media.ts`（`pickImages({ selectionLimit })`，默认 9）。
- **Consumes**：与 T3 相同的契约。编辑 cap 用 §7.2 的 `editImageCap` / `editOccupied`；新建 cap 仍 `this.type === 'voice' ? 8 : 9`。
- **出口**：§7.4 测试绿 + `typecheck`；手测 §7。不新增 app package scripts。

并行：T3 在 T2 API 可用后即可；T4 镜像 T3，不互相阻塞代码，但不要在 T2 前对生产发带 `mediaIds` 的客户端（旧 server 会 `VALIDATION_ERROR`）。

## 12. Key Decisions

| 决策 | 理由 |
|---|---|
| `mediaIds` 全量替换、缺省不变 | 与已落地的 `tagIds` / `personIds` 同一心智；避免「只传新增」的差量协议 |
| 客户端不传 `type`，server 推导 | 防止伪造 type 做 media↔voice↔video；text→media 是唯一允许的升级 |
| media 不能删光变 text | 类型是时间线卡片形态，删光变文字等于另发一条；用户可删时刻再发 |
| voice 锁定原 audio id | 语音是主角，转写/时长绑那一行；换音频等于新时刻 |
| video / poster 本 spec 不做 | 封面与原片绑定成本高，video-poster 已明确发布后不可改 |
| 非法 mime / 缺音频走 `MEDIA_INVALID`，media 空集走 `MEDIA_COUNT_INVALID`，video 改媒体走 `MEDIA_NOT_ALLOWED` | 全部是现网码；空集是数量问题，video 是能力关闭，其余是行/构成不合法 |
| `posterMediaId` 收进 schema 由 server 抛 `MEDIA_NOT_ALLOWED` | `.strict()` 只能给出 `VALIDATION_ERROR`，与锁定的机器码对不齐 |
| 离开集合标 `orphaned` 而非请求线程删对象 | 对齐 `handleMomentDeleted` / 链外观换图，避免事务回滚丢对象 |
| 向量按时刻 `maybeEmitMomentEmbed` 整表重嵌 | embed handler 已先 DELETE 再 upsert；不按 media 删、不新 outbox 类型 |
| 只给 **新进** 可压图发 compress | keep 的图派生已在；重发会重复占 jobs |
| 编辑宫格用响应里的预签名 URL | CONVENTIONS §3.4 现状；登录态不再 fetch blob |
| dirty 动作级，未动不传 `mediaIds` | 与 personIds 相同，避免无变化 PATCH 重写 sortOrder、误触发 embed |
| 编辑态拒绝引入视频 | 换视频/封面不在范围；互斥确认会清稿，编辑态危险 |
| 存量宫格视频必须先叉才能改图 | PATCH 结果集锁定全 `image/*`，避免「半改」留下非法构成 |
| T1+T2 连续落地 | dto 放行 `mediaIds` 的瞬间，旧 server 测试「未知键」会红 |
| 矩阵的 `originalType` 取 FOR UPDATE 后的行 | 否则并发 `[]` 会按过期 `text` 把刚升级的 media 删空 |
| 编辑/新建容量公式拆开 | 共用 `this.voice` 会打穿 app 新建 voice 未录音的 cap=8，也会让编辑误读残留草稿 |
| compress 终态 WHERE `moment_id IS NOT NULL`；0 行则 `deleteFile(derivedKey)` | 入口检查盖不住 getObject/sharp 窗口；upload 发生在写行之前，sweeper 看不到未落列的 key |
| 编辑 `addImages` 用 `edit.type` 算 cap | hydrate 清空 `this.voice` 后，再走新建公式会让 voice 编辑 cap=9 |

## 13. 自检

- 占位符：无 TBD / TODO / 「适当处理」/「类似 Task N」。
- 内部一致：§0 十一条与 §4.6 矩阵、§8 错误码、§11 分期互相引用同一码与同一推导规则。
- 范围：无新表、无新路由、无新 outbox 类型、无新环境变量；一份计划 T1–T4 可吃下。
- 历史口径：§2 列出全部被取代句子，不改历史文件。
- 歧义钉死：空数组对 text / media / voice / video 各有一行；`originalType` 锁后重读；poster `null` 也是 `MEDIA_NOT_ALLOWED`；keep vs incoming vs orphan；compress 只针对 incoming；embed 走现成 `maybeEmitMomentEmbed`；编辑 `addImages` 用 `edit.type` 算 cap；ready 路径 0 行删 derivedKey；客户端 dirty 与宫格顺序；video 文案。
- CONVENTIONS §3 方法名未改；媒体 URL 按预签名现状书写。

---

实施中若发现与 CONVENTIONS §3 方法名冲突：停手报告，不得改 CONVENTIONS 绕过。与 fused-retrieval 压缩/嵌入语义冲突时以本 spec §5.1 替换表为准（只放开「PATCH 能否改媒体」这一刀，不改 handler）。
