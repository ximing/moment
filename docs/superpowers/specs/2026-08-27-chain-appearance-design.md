# 链头像、Emoji 与封面设计

日期：2026-08-27
状态：已批准（brainstorm 结论：头像三模式互斥；图片只保存焦点；封面只展示在链首页与公开分享页）

## 1. 背景与目标

当前链标识仅支持 8 个预设色和 10 个预设 Emoji，`ChainMark` 只能渲染色块或“色块 + Emoji”；数据库虽然已有 `chains.cover_media_id`，但 DTO、服务端写入、URL 签发和 Web 展示尚未打通。

本功能让 Web 用户可以完整定制链的视觉身份：

- 链头像支持三种互斥模式：Emoji、上传图片、自定义纯色。
- Emoji 选择器支持完整分类、中文搜索、键盘导航与肤色变体。
- 链支持独立的大封面图。
- 头像和封面上传后默认居中展示，用户可调整焦点；服务端不生成重复裁剪图。
- 侧栏、顶部链列表、时间线与“那年今日”只展示头像；大封面仅展示在链首页头部和公开分享页。
- 图片继续复用现有 `media`、S3/MinIO 预签名上传和服务端 copy 绑定流程。
- 内网部署时 Emoji 选择器不得依赖公共 CDN 或其他运行时外网请求。

非目标：

- 不新增 `chain_assets` 表，不生成头像/封面的多尺寸裁剪副本。
- 不在 RN app 增加编辑入口；DTO 扩展保持兼容，RN 后续可只消费头像字段。
- 不支持视频作为链头像或封面。
- 不在侧栏、时间线卡片或“那年今日”展示大封面。
- 不提供头像滤镜、缩放、旋转或复杂图片编辑。

## 2. 已选方案与取舍

采用“直接扩展 chains + 复用 media”的方案：

- 复用已有 `coverMediaId`，新增 `avatarMediaId`。
- 在 `chains` 上保存头像/封面各自的焦点坐标。
- 数据库不保存额外的 avatar kind：`avatarMediaId != null` 表示图片，`icon != null` 表示 Emoji，二者都为空时由 `color` 表示纯色。
- 服务端负责维持三模式互斥，不信任客户端只传一个字段。

未采用的方案：

1. `chain_assets` 独立表：当前每条链最多只有一个头像和一个封面，独立表增加 join、权限与生命周期复杂度，收益不足。
2. 服务端生成裁剪图：会制造重复对象、额外任务队列和裁剪一致性问题；保存归一化焦点即可覆盖所有响应式容器。
3. 继续维护固定 Emoji 数组：无法满足搜索、分类和后续 Unicode 更新。

## 3. 数据模型

### 3.1 chains

`chains` 增加或调整以下列：

```ts
avatarMediaId: char('avatar_media_id', { length: 36 })
  .references(() => media.id, { onDelete: 'set null' })

// 数据库存 0..10000，5000 = 0.5，避免浮点序列化和比较误差。
avatarFocusX: int('avatar_focus_x').notNull().default(5000)
avatarFocusY: int('avatar_focus_y').notNull().default(5000)
coverFocusX: int('cover_focus_x').notNull().default(5000)
coverFocusY: int('cover_focus_y').notNull().default(5000)

// 组合 Emoji/ZWJ 序列需要超过当前 varchar(16)。
icon: varchar('icon', { length: 64 })
```

已有 `coverMediaId` 和 `color varchar(16)` 保留。四个焦点列增加 `0 <= value <= 10000` 的数据库 check；API 输入输出使用 `0..1`，序列化时转换。

数据库状态不增加 `avatarType`，互斥不变量为：

| 模式 | avatarMediaId | icon | color |
|---|---:|---:|---:|
| 图片 | 非空 | null | null |
| Emoji | null | 非空 | null |
| 纯色 | null | null | 非空 |

创建链时若三者全部省略，服务端按既有链 id 哈希规则选择一个预设色并持久化，使新数据仍满足不变量。历史异常数据读取时采取 `avatarMediaId > icon > color > id 哈希色` 的防御性优先级。

### 3.2 media 生命周期补强

`media` 增加：

```ts
orphanedAt: timestamp('orphaned_at', { mode: 'date' })
```

所有将 `status` 改为 `orphaned` 的路径同时写 `orphanedAt = now`，包括上传 abort、Moment 删除、用户头像替换、链图片替换和主动丢弃。迁移将历史 `orphaned` 行的 `orphanedAt` 回填为 `createdAt`。

这样 generic orphan sweeper 可以从“进入孤儿状态的时间”计算保留期，而不会把刚替换但创建时间很早的图片立即物理删除。

### 3.3 迁移与历史数据

schema 迁移使用 `drizzle-kit generate`，生成后、首次执行前追加数据回填：

- `icon IS NOT NULL` 的历史链保留 Emoji，并将 `color` 置 null（Emoji 优先，符合新互斥规则）。
- `icon IS NULL AND color IS NULL` 的链允许继续走 id 哈希回退；首次被编辑时持久化明确纯色。
- 新焦点列统一为 5000。
- 历史 orphaned media 回填 `orphaned_at = created_at`。

迁移只增加可空引用/时间列、增加带默认值的整数列并扩宽 varchar，不删除资源字段。迁移前后旧客户端仍能读取既有 `color/icon/coverMediaId`。

## 4. DTO 与 API 契约

### 4.1 基础类型

`packages/dto/src/chains.ts` 提供：

```ts
type ChainPresetColor = (typeof CHAIN_COLORS)[number];
type ChainColor = ChainPresetColor | `#${string}`;

interface ChainImageFocus {
  x: number; // 0..1
  y: number; // 0..1
}
```

- 颜色 schema 接受现有预设名或严格 `#RRGGBB`，服务端将 hex 规范化为大写。
- `CHAIN_ICONS` 保留并更名/别名为推荐列表，避免旧消费方断裂；实际 `ChainIcon` 变为字符串。
- Emoji schema 使用 Unicode Emoji 正则，要求输入恰好是一个完整 Emoji 序列，允许肤色修饰、旗帜和 ZWJ 家庭等组合，拒绝普通文本和多个 Emoji。
- 焦点 schema 的 x/y 均为有限数且在闭区间 `[0, 1]`。

### 4.2 创建与更新输入

create/update 保持平铺字段以兼容现有客户端：

```ts
color?: ChainColor | null;
icon?: string | null;
avatarMediaId?: string | null;
avatarFocus?: ChainImageFocus;
coverMediaId?: string | null;
coverFocus?: ChainImageFocus;
```

规则：

- 同一请求中 `color`、非空 `icon`、非空 `avatarMediaId` 最多出现一个；多个非空选择器返回 `VALIDATION_ERROR`。
- update 传入其中一个非空选择器即切换到该模式，服务端清空另外两个字段。
- 将当前模式字段显式传 null 且没有给出新模式时，回退到服务端选定并持久化的默认纯色。
- `avatarFocus` 可与新 `avatarMediaId` 一起提交，也可单独调整当前图片；当前不是图片模式时单独传焦点返回 `CHAIN_AVATAR_FOCUS_INVALID`。
- `coverMediaId: null` 删除封面并把焦点重置为中心；`coverFocus` 可与新封面一起提交，也可单独调整现有封面。
- 头像与封面不得引用同一个 media id，违反时返回 `CHAIN_MEDIA_DUPLICATED`。
- `coverMediaId` 从“只读预留字段”升级为 owner 可写字段。

### 4.3 响应

`ChainDto` 增加：

```ts
avatarMediaId: string | null;
avatarUrl: string | null;
avatarExpiresAt: string | null;
avatarFocus: ChainImageFocus | null;
coverUrl: string | null;
coverExpiresAt: string | null;
coverFocus: ChainImageFocus | null;
```

`coverMediaId`、`color`、`icon` 保留。只有关联 media 存在且为 ready 时才签发 URL；图片无效时 URL/focus 返回 null，Web 按防御性优先级回退。

链列表、链详情、创建与更新响应均重新签发短期 GET URL，并返回对应过期时间。签发使用 media 行自己的 `storageMeta`，兼容 MinIO/S3 配置切换。

`PublicShareChainInfo` 增加同样的只读视觉字段。匿名分享 API 只在 token 有效时签发该链头像/封面 URL；不允许通过任意 media id 探测其他链资源。

### 4.4 丢弃未绑定媒体

新增：

```http
DELETE /api/media/:id
→ 204 No Content
```

仅 uploader 可调用。服务端在事务内锁定 media 并确认：

- `momentId IS NULL`；
- 未被 `users.avatarMediaId` 引用；
- 未被 `chains.avatarMediaId` 或 `chains.coverMediaId` 引用；
- 状态为 uploading、ready 或已经 orphaned。

uploading 复用 multipart abort 行为；ready 转为 orphaned；orphaned 幂等返回 204。已绑定媒体统一返回 `MEDIA_ALREADY_BOUND`，不因 uploader 身份允许破坏活引用。

## 5. 服务端媒体绑定

只有链 owner 可以创建/修改链视觉资源。成员读取链 DTO 时可以取得头像与封面 URL；公开分享页只取得分享 token 对应链的资源。

创建或更新链图片时，在数据库事务中完成：

1. 对所有待绑定 media 行 `FOR UPDATE`，阻止同一上传被并发绑定两次。
2. 校验行数量、uploader、`status = ready`、`momentId IS NULL`、允许的 image MIME、尚未被用户头像/其他链引用，以及头像/封面 id 不重复。
3. 将临时对象 copy 到：
   - `chains/{chainId}/avatar/{mediaId}.{ext}`
   - `chains/{chainId}/cover/{mediaId}.{ext}`
4. 更新 media 的 `s3Key` 和链引用/焦点；更新成功后提交事务。
5. 事务提交后 best-effort 删除 tmp 对象；失败由 `tmp/` bucket lifecycle 兜底。
6. 新引用生效后，事务内把被替换的旧 media 标为 orphaned 并写 `orphanedAt`。

如果 copy 后数据库事务回滚，catch 分支 best-effort 删除这次生成的 final 对象；原 media 行仍指向 tmp，用户可以重试。删除补偿失败只留下不可达对象并记录带 mediaId/finalKey 的告警，不会丢失当前链图片。

同一个 media id 再次保存同一位置视为幂等，只更新焦点，不重复 copy、不把自身标记为 orphaned。

## 6. 媒体清理

在 worker 现有 sweeper 周期中增加两类任务，单轮仍遵守 batch limit、对象删除失败保留 DB 行供下轮重试：

1. **过期未绑定 ready 上传**：创建超过 `MEDIA_UPLOADING_TTL_HOURS`，`momentId IS NULL`，且未被 users/chains 引用的 ready media，先标记 orphaned 并写 `orphanedAt`。这覆盖上传完成后直接关页、断网或浏览器崩溃。
2. **过期 orphaned 对象**：`orphanedAt` 超过统一保留期后删除 S3 对象，再删除 media 行。保留期沿用 Moment 软删除的 30 天语义，避免同一 status 出现两套不可解释的物理删除时限。

原 `sweepSoftDeletedMomentMedia` 仍负责按 Moment 软删除时间处理历史兼容数据；generic orphan sweeper 与它都使用“对象删除成功才删行”的规则，因此并发命中是幂等的。

## 7. Web 交互设计

### 7.1 共用编辑器

创建链弹窗和链设置页共用 `ChainAppearanceEditor` 展示组件；页面 Service 继续按 `@rabjs/react` 三层模式持有草稿、上传状态和保存动作。组件不直接调用 API。

头像区域采用三段互斥选择：

- **Emoji**：打开完整选择器；选择后立即更新头像预览。
- **上传图片**：选择图片后立即显示本地 object URL，并沿用现有图片单 PUT 上传；展示进度、失败重试、重新选择和删除。
- **纯色**：展示现有预设色、原生取色器和 hex 输入；合法输入实时更新色块。

切换模式时：

- 草稿只保留新模式值；已完成但尚未保存的上传调用 `DELETE /media/:id`。
- 仍在 uploading 的上传调用同一删除端点中止。
- 页面卸载时撤销 object URL；无法保证发出清理请求的关页场景交给 sweeper。
- 任何头像/封面仍在上传时保存按钮禁用，避免提交半成品 mediaId。

### 7.2 Emoji 选择器与内网约束

采用 MIT 许可的 `frimousse@0.3.0`：它支持组合式样式、虚拟列表、键盘导航、屏幕阅读器、搜索与肤色选择，并兼容 React 19。

Frimousse 默认从 jsDelivr 获取 Emojibase 数据，因此不能直接使用默认配置。实现时：

- 固定一版 Emojibase 中文数据，把 `zh/data.json`、`zh/messages.json` 和对应许可证随 Web 静态资源部署到 `apps/web/public/vendor/emojibase/`。
- `EmojiPicker.Root` 设置 `locale="zh"`、固定 `emojiVersion`，并将 `emojibaseUrl` 指向同源 `/vendor/emojibase`。
- Emoji picker 自身动态加载，只在用户进入 Emoji 模式或打开选择器时进入该路由 chunk；静态数据由浏览器正常缓存。
- CSP 不增加公共域名，生产运行时不请求 `cdn.jsdelivr.net`、Liveblocks 或 GitHub。

Frimousse 只负责 picker 行为，样式使用 Moment 的 spacing、radius、surface、line、text 与 action tokens，不引入第三方默认视觉皮肤。

### 7.3 纯色

预设色仍用 `CHAIN_COLORS`。自定义色同时提供：

- 点击色块/原生 `input[type=color]`；
- `#RRGGBB` 文本输入；
- 当前颜色的大号即时预览。

失焦或保存时统一转大写；非法 hex 保留输入并显示字段错误，不提交旧值冒充成功。

### 7.4 图片与焦点

头像使用圆形预览，封面使用约 3:1 的宽幅预览。文件没有强制宽高比，展示统一使用 `object-fit: cover`。

初次上传焦点为 `(0.5, 0.5)`。点击“调整位置”进入 `FocalImageEditor`：

- 用户拖动图片，组件根据源图尺寸、容器尺寸和 cover 缩放结果，把位移换算为归一化 `object-position`。
- 焦点始终 clamp 到 `[0, 1]`；保存只提交坐标，不生成 Blob、不二次上传。
- 头像以圆形遮罩预览，封面以宽幅遮罩预览；两者共用同一套焦点换算函数。
- Escape/取消恢复进入编辑器前的坐标，确认才写入页面草稿。

### 7.5 展示范围与回退

`ChainMark` 统一按 `image > emoji > color > id hash color` 渲染：

- 图片使用签名 URL、`object-fit: cover` 和保存的 `object-position`。
- Emoji 模式使用统一的柔和 token 背景，不叠加自定义纯色。
- 图片加载失败时回退到 id 哈希纯色，不显示破损图片图标。

侧栏、顶部 chips、时间线链标识和“那年今日”只使用 `ChainMark`。链首页头部和公开分享页在有 `coverUrl` 时渲染响应式封面；封面加载失败或不存在时回退到当前普通头部布局。

## 8. 错误处理与并发

- DTO schema 拒绝多模式、非法 Emoji、非法颜色、越界焦点和无效 UUID，返回统一 `VALIDATION_ERROR`。
- 媒体过大、MIME 不允许、上传中断、对象 head 校验失败沿用现有 media 错误；Web 映射为就地错误和可重试动作。
- 非 owner 修改继续使用链权限错误；媒体不存在或不属于本人不泄露存在性。
- 两个请求并发绑定同一 media 时由行锁串行，后到请求得到 `MEDIA_ALREADY_BOUND`/`MEDIA_INVALID`，不能覆盖先到请求。
- 保存请求在前端防重复点击，但服务端仍保证替换幂等和事务一致性。
- 签名 URL 过期后通过下一次链列表/详情加载刷新；图片 `onError` 当次回退，不做无限重试。
- 公开分享 token 无效、过期或吊销时仍统一 `SHARE_NOT_FOUND`，不单独暴露封面或头像。

## 9. 测试与验收

### 9.1 DTO

- 预设色与 `#RRGGBB` 正常；短 hex、透明色、CSS 表达式拒绝。
- 单 Emoji、肤色、旗帜、ZWJ 家庭正常；文本、空串、多个 Emoji 拒绝。
- 三模式互斥、focus 边界、focus 与 media 组合规则。
- `ChainDto` 与 `PublicShareChainInfo` 新字段类型对齐。

### 9.2 Server

- create/update 三模式切换会清空互斥字段；全空回退到持久化默认色。
- 只有 owner 可修改；viewer/editor 不能绑定或删除链资源。
- media uploader/status/MIME/未绑定/重复 id 校验。
- 新绑定、同 id 幂等更新焦点、替换旧资源、删除资源。
- copy 失败、事务回滚和 post-commit tmp 删除失败的状态与补偿。
- 列表/详情/公开分享正确签发 URL，失效 share token 不签发。
- discard 端点不能删除用户头像、Moment 媒体或任意链的活资源。
- stale ready 与 orphaned sweeper 的 cutoff、引用保护、dry-run、对象删除失败重试。
- 迁移回填后历史链展示优先级和旧 orphaned 数据正确。

server 测试遵循真实测试库与 `--runInBand` 约束；迁移验证先使用隔离的本地 MySQL schema，不在共享测试库上反复回滚迁移。

### 9.3 Web

- 创建链与设置页使用同一个 appearance editor，提交数据一致。
- Emoji 搜索/选择、三模式切换、自定义颜色合法与非法状态。
- 上传中禁用保存，失败可重试，切换/删除会 discard 未绑定媒体。
- 焦点换算、clamp、取消恢复和头像/封面 object-position。
- `ChainMark` 三模式及图片加载失败回退。
- 封面只出现在链首页和公开分享页，其他链标识不渲染封面。

### 9.4 真实浏览器验收

使用 CSI 在真实 Chrome 中验证：

1. 新建 Emoji、图片、纯色三类链并刷新确认持久化。
2. 设置页在三种模式间往返，确认旧上传被丢弃且当前资源不被误删。
3. 分别调整头像和封面焦点，在宽屏与窄屏确认主体位置稳定。
4. 链首页显示封面；侧栏、时间线、“那年今日”只显示头像。
5. 公开分享页显示对应头像/封面，吊销链接后页面不可再加载数据。
6. 模拟上传失败与图片加载失败，确认错误和视觉回退。
7. 记录 Emoji picker 打开时的网络请求，确认全部为 Moment 同源请求，没有公共 CDN 请求。

## 10. 安全与运维边界

- 客户端只持有预签名 PUT/GET，不接触 S3/MinIO 密钥。
- 服务端不接受客户端提供的 object key、bucket 或任意图片 URL，只接受 mediaId。
- SVG 不进入允许的头像/封面 MIME 列表，避免浏览器主动内容风险；沿用受控的 raster image allowlist。
- 所有链资源读取都来自已通过链成员或 share token 校验的 DTO 序列化路径。
- Emoji 数据和许可证随应用版本发布，更新需要代码评审，不在生产运行时自动漂移。
- sweeper 删除对象成功后才删除数据库行；失败保留可重试状态并记录结构化日志。
