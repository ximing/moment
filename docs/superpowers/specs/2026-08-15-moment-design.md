# 时刻 Moment — 产品设计 & 技术架构 Spec

> 日期：2026-08-15
> 状态：待评审（脑暴 + 对抗分析修订版）
> 参考架构：/Users/ximing/project/mygithub/aimo

## 1. 产品定义

「时刻」是一个多用户时间线记录应用：把此时此刻发生的事情记成 **moment**，组织进主题化的 **时光链（chain）**，链可分享给他人共同记录。

典型场景：亲子成长记录（父母共同编辑、链接分享给祖辈只读）、兴趣小组活动记录、情侣/家庭共享相册。

### 核心概念

| 概念 | 说明 |
|---|---|
| **链（chain）** | 主题的共享时间线，如「宝宝成长」。moment 必须属于某条链。 |
| **moment（时刻）** | 一条记录。三种类型：`text`（纯文本）、`media`（图/视频宫格+文）、`video`（纯视频+文）。 |
| **个人时间线（feed）** | 我参与的所有链的 moments 按 `happened_at` 倒序聚合，支持按链 / tag 过滤。 |
| **tag** | 链内自由创建的标签，链内唯一，用于链内过滤。 |
| **happened_at** | 事件发生时间（可补发），时间线按它排序，区别于系统 `created_at`。 |

### 权限模型（三角色）

| 角色 | 权限 |
|---|---|
| owner | 链设置、邀请/移除成员、删除链内任何内容、转让 owner |
| editor | 发布 moment；编辑/删除**自己的** moment；打 tag；评论/表情 |
| viewer | 只读 + 评论/表情（不可发布） |

- moment 永远显示原作者头像/名字；不允许编辑他人 moment。
- 编辑历史不进 MVP（backlog）。

### 链可见性

- **私密**（默认）：仅成员可见。
- **链接分享**：生成只读分享链接，无需登录可看（供长辈）。一条链可有多个链接，可单独吊销、可设过期。
- **公开发现**：不进 MVP，但 `chains.visibility` 枚举字段现在就加（`private`/`link`/`public`），避免后期迁移。

### MVP 功能范围

含：邮箱注册登录、链 CRUD + 成员/角色 + 邀请、moment 三种类型、媒体上传（图/视频）、tag + feed 过滤、评论、表情 reaction、应用内通知 + Expo Push、只读分享链接 + 公开页。

不含（backlog）：编辑历史、那年今日/时光机、导出 PDF 纪念册、里程碑模板、地图足迹、视频转码 HLS、公开广场、微信/手机号登录。

## 2. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Express + routing-controllers + TypeDI + Drizzle ORM | 沿用 aimo 架构（controllers / services / models / middlewares 分层） |
| 数据库 | MySQL | Drizzle 管理 schema 与迁移 |
| 对象存储 | S3 兼容服务，**私有桶**（`is_public=false`） | 沿用 aimo 的 unified-storage-adapter；所有读取走预签名 URL，见 §5.3 |
| Web | React 19 + Vite + TanStack Query | SPA，与 aimo 一致 |
| App | Expo (React Native) + TanStack Query | EAS Build；媒体选择/压缩/推送用 Expo 生态 |
| 认证 | 邮箱 + 密码（bcrypt，无单独盐字段）+ JWT 双 token | 见 §6 |
| 共享包 | `packages/dto`（zod schema）、`packages/api-client`（typed fetch） | web/app 共用数据层；UI 不共享 |
| 部署 | 单机 docker-compose（server + worker + MySQL + 备份 sidecar） | S3 用云服务 |
| Monorepo | pnpm workspace + Turbo | 沿用 aimo 骨架 |

### Monorepo 结构

```
moment/
├── apps/
│   ├── server/     # Express API
│   ├── web/        # React 19 + Vite
│   └── app/        # Expo RN
├── packages/
│   ├── dto/        # 共享类型 + zod schema
│   └── api-client/ # typed fetch 客户端（注意不挡死上传进度回调）
├── config/         # 共享 tsconfig / eslint / jest preset
├── docker-compose.yml
└── turbo.json
```

## 3. 数据模型（MySQL / Drizzle）

### 表清单

**users**：id, email（唯一，存储前小写归一化）, password_hash（bcrypt）, nickname, avatar_media_id, password_changed_at, created_at

**refresh_tokens**：id, user_id, token_hash, device_info, expires_at, revoked_at, created_at — 支持旋转与吊销

**chains**：id, name, description, cover_media_id, owner_id, visibility enum(`private`,`link`,`public`) default `private`, created_at
- 成员关系以 `chain_members` 为准；`owner_id` 冗余用于快速展示，转让时同事务更新两边。

**chain_members**：chain_id, user_id, role enum(`owner`,`editor`,`viewer`), joined_at
- `UNIQUE(chain_id, user_id)`。硬删除（退链/移除）。

**chain_invites**：id, chain_id, token（唯一，不可猜测）, email（可空）, role, created_by, expires_at, accepted_at
- 支持「未注册邮箱先收链接，注册后自动入链」。

**share_links**：id, chain_id, token（唯一索引）, created_by, expires_at（可空）, revoked_at（可空）, created_at
- 一链多链接、单独吊销；访问可统计（后期加 access_count）。

**moments**：id, chain_id, author_id, type enum(`text`,`media`,`video`), content(text), happened_at（UTC timestamp）, happened_tz_offset（提交时时区偏移，分钟，供展示）, is_backfill(bool), created_at, updated_at, deleted_at（软删）
- **索引：`(chain_id, happened_at, id)`** —— feed 与链内时间线的核心索引。
- 软删级联规则：详情页返回 410；评论/表情随之不可见；media 由 sweeper 延迟物理清理；已发出通知的 payload 存标题快照，跳转时优雅降级。

**media**：id, moment_id（可空，上传完成绑定前为空）, uploader_id, s3_key, mime, size, width, height, duration, poster_media_id（视频封面，预留）, sort_order, status enum(`uploading`,`ready`,`orphaned`), storage_meta(json), created_at
- 多 part 上传会话信息：`upload_id`（S3 multipart id，可空）。
- `storage_meta` 沿用 aimo 的 `StorageMetadata`（bucket / prefix / endpoint / region / isPublicBucket）：**按行记录写入时的存储配置**，日后换桶/换后端/换 endpoint 时旧媒体仍可访问。

**tags**：id, chain_id, name, created_at — `UNIQUE(chain_id, name)`；硬删除（删时先清 `moment_tags` 关联）。每链上限 100 个。

**moment_tags**：moment_id, tag_id — 硬删除。

**comments**：id, moment_id, author_id, content, created_at, deleted_at（软删）

**reactions**：id, moment_id, user_id, emoji, created_at — `UNIQUE(moment_id, user_id)`，换表情 = upsert，取消 = 硬删除。

**notifications**：id, user_id, type, payload(json，含资源标题快照), read_at, created_at
- 索引 `(user_id, read_at)`（未读列表/未读数是高频查询）。

**push_tokens**：id, user_id, expo_token（唯一）, platform, last_seen_at, invalidated_at — 一用户多设备；Expo receipts 返回 DeviceNotRegistered 时置 invalidated。

**outbox**：id, type, payload(json), status enum(`pending`,`done`,`failed`), attempts, next_retry_at, created_at, processed_at
- 所有副作用（通知扇出、推送、清理任务）的统一异步出口，见 §5.4。

### 事务边界（必须显式声明）

- 创建 moment：插 moment + 绑定 media（校验 `status=ready` 且属于当前用户）+ 插 moment_tags + 写 outbox = **一个事务**。
- 预签名申请：先插 media(`uploading`) 行再返 URL，顺序固定。
- 转让 owner / 删链 / 接受邀请：多表写，均单事务。
- 软删 moment：更新 deleted_at + 写 outbox（清理任务）= 一个事务。

## 4. API 设计（REST / routing-controllers）

### Auth
- `POST /auth/register` `POST /auth/login` `POST /auth/refresh` `POST /auth/logout`（吊销 refresh）
- `GET /me` `PATCH /me`
- 注册/登录/邀请接受：IP + 账号维度限流（如 5 次/分钟）。

### Chains
- `POST /chains` `GET /chains`（我参与的） `GET /chains/:id` `PATCH /chains/:id` `DELETE /chains/:id`
- `POST /chains/:id/invites`（生成邀请） `POST /invites/:token/accept`
- `GET /chains/:id/members` `PATCH /chains/:id/members/:userId`（改角色/转让） `DELETE /chains/:id/members/:userId`
- `POST /chains/:id/share-links` `GET /chains/:id/share-links` `DELETE /share-links/:id`（吊销）

### Moments & Feed
- `POST /chains/:id/moments` `GET /chains/:id/moments`（游标分页） `GET /moments/:id` `PATCH /moments/:id` `DELETE /moments/:id`
- `GET /feed?cursor=&chain_ids=&tag_id=&order=happened_at|created_at`
  - 默认按 `happened_at`；补发场景提供 `created_at`（按添加时间）次要排序，解决「补发即隐身」。
  - **游标 = `(happened_at, id)` 复合游标**，DTO 里就是 opaque string。同时间戳 moment 跨页不得丢失/重复。

### Media（详见 §5）
- `POST /media/presign`（单图 / 初始化 multipart）
- `POST /media/:id/parts`（逐 part 预签名） `POST /media/:id/complete` `POST /media/:id/abort`
- `GET /media/:id` —— 权限校验后 302 到预签名 URL（稳定入口，见 §5.3）

### Tags / Comments / Reactions / Notifications
- `GET /chains/:id/tags` `POST /chains/:id/tags` `DELETE /tags/:id`
- `GET /moments/:id/comments` `POST /moments/:id/comments` `DELETE /comments/:id`
- `PUT /moments/:id/reaction`（upsert） `DELETE /moments/:id/reaction`
- `GET /notifications?unread=` `POST /notifications/read`
- `POST /devices/push-token`（注册/心跳）

### Public（匿名）
- `GET /public/share/:token` —— 链信息 + moments 只读视图；媒体走带链接权限的 URL。**匿名不可评论**（viewer 评论指登录成员）。

## 5. 关键机制

### 5.1 Feed 查询（核心路径）

1. 请求入口一次查出「我的 chain_id 集合 + 各链角色」进请求上下文（可短 TTL 缓存），feed 查询只用 id 列表，**不做 members join**。
2. 查询：`WHERE chain_id IN (:myChains) AND deleted_at IS NULL AND (happened_at, id) < :cursor ORDER BY happened_at DESC, id DESC LIMIT n`，走 `(chain_id, happened_at, id)` 索引；MySQL 对每个 chain_id range scan 后归并。
3. tag 过滤传 `tag_id`，以 `moment_tags(tag_id, moment_id)` 为驱动表，接受小结果集回表排序。
4. **容量假设**（写进文档，超过再演进）：人均链数 < 50、单链 moments < 10 万。演进路径 = 每用户物化 feed 表（写时扇出），现在不做。
5. 计数：评论数/表情数用一次 `GROUP BY moment_id IN (...)` 批量查出（禁止逐条 COUNT 的 N+1）。feed/详情序列化器是唯一出口，未来加冗余计数列只改这一处。

### 5.2 权限：消灭逐端点手写校验

- 实现 `@RequireChainRole('editor')` 装饰器/中间件，统一从 path 的 `chainId` 或资源 id 反查链，调用集中的 `chainPolicy.can(user, chain, action)`。
- `chainPolicy` 单测覆盖全矩阵（3 角色 × 全部操作）。
- controller 内禁止手写角色判断。读接口（moment 详情等）同样必须过校验——只验登录不验成员身份是最常见越权漏法。

### 5.3 存储抽象与媒体读取（私有桶）

**桶为私有（`ATTACHMENT_S3_IS_PUBLIC=false`），所有读取必须生成预签名 URL——这是已确认的产品决策。** 在此前提下做缓存友好设计：

**存储抽象（沿用 aimo `sources/unified-storage-adapter/`）**：
- `base.adapter.ts` 定义 `UnifiedStorageAdapter` 接口（upload/download/delete/list/fileExists/getFileMetadata/**generateAccessUrl**），`s3.adapter.ts` 实现，`factory.ts` 按配置创建。本地开发可挂 local adapter。
- `generateAccessUrl(key, metadata, expiresIn)`：私有桶走 `getSignedUrl(GetObjectCommand)`；**按 media 行上的 `storage_meta` 生成**，而非当前全局配置——换桶/换 endpoint 后旧媒体仍可访问（aimo 已验证此模式）。
- Content-Type 安全：对 `text/html`、`javascript` 等危险类型强制 `application/octet-stream`（沿用 aimo `getContentType`），防止存储被滥用为静态站托管。

**读取路径（缓存友好）**：
- feed/详情接口返回的媒体 URL 是稳定入口 **`/media/:id`**（而非 feed 里内嵌预签名 URL——那会随请求变化，客户端图片缓存全失效）。
- `GET /media/:id`：服务端校验「用户对 media 所属链的读权限（或有效 share_link token）」→ **302 到预签名 GET URL**。302 响应带 `Cache-Control: private, max-age=300`，客户端 5 分钟内复用重定向目标，不重复打 server。
- 预签名 **TTL 按固定时间窗取整**（如对齐到整点过期，TTL 1h）：同一窗口内同一 media 签出的 URL 相同，客户端/网关缓存可命中；窗口外由 `/media/:id` 重新 302。
- 签名开销：HMAC 微秒级，且经上述两级缓存后实际签名次数远低于媒体展示次数。
- 规模化演进：切 CDN 签名 cookie（一次鉴权、媒体 URL 完全稳定），`/media/:id` 接口形态不变。

### 5.4 异步副作用：outbox + worker

- 用户请求路径上**不做**通知扇出、不调 Expo Push、不做清理。事务内写 outbox 行即可。
- 独立 worker 进程（docker-compose 独立 service，随发布不中断 API）轮询 outbox：批量插 notifications、批量调 Expo Push、处理 receipts、失效 push_token 置 invalidated、重试（指数退避，`attempts`/`next_retry_at`）。
- 触发点：链内新 moment（`is_backfill=true` 不推送）、我的 moment 被评论/表情、被邀请进链。
- notifications 的 `type` 维度保持可扩展，扇出逻辑不硬编码，为「链免打扰」预留。

### 5.5 媒体上传管线

1. 客户端压缩（图：expo-image-manipulator；视频：客户端压到 ≤1080p/合理码率）。
2. 限制：**图 ≤10MB ×9**；**视频 ≤500MB / ≤5 分钟**（3 分钟 4K 轻松超 300MB，原 100MB/3min 不可行）。
3. 图片：单次预签名 PUT。视频：**S3 multipart**（每 part 5–20MB，逐 part 预签名，按 part 重试 = 断点续传）。
4. `complete` 回调：HeadObject 校验（存在、size、mime 与申请一致）+ 幂等（重复回调返回相同结果）。发布 moment 拒绝引用 `status != ready` 的 media。
5. Key 布局（前缀来自 `ATTACHMENT_S3_PREFIX`，按环境隔离）：
   - 上传中：`{prefix}/tmp/{mediaId}.{ext}`
   - complete 时服务端同桶 copy 到 `{prefix}/chains/{chainId}/{momentId}/{mediaId}.{ext}` 并删 tmp 对象（同桶 copy 为服务端操作，不经客户端）；`storage_meta` 记录最终位置。
6. 防孤儿：
   - S3 lifecycle：`tmp/` 前缀 7 天未 complete 自动删；`AbortIncompleteMultipartUpload` 清理未完成分片（隐藏账单）。
   - sweeper（复用 worker）：清 `uploading` 超 24h 的 media 行 + S3 对象；清软删超期 moment 的媒体。
6. media 模型预留视频封面字段（poster_media_id），服务端抽帧二期做。

### 5.6 时区与补发

- `happened_at` 存 UTC；客户端传本地时间 + 时区偏移，服务端换算，`happened_tz_offset` 供展示（跨时区家庭场景）。
- 补发（`is_backfill`）不推送通知；feed 提供「按添加时间」排序入口，保证补发可被其他成员发现。

### 5.7 删除语义

- 硬删除：chain_members、moment_tags、reactions、tags（先清关联）。
- 软删除：moments、comments。软删不挂在唯一索引上，避免「删后重建撞唯一约束」。
- owner 退链：必须先转让或删链（服务端约束）。

## 6. 安全

- 密码 bcrypt（cost ≥10），无单独盐字段（bcrypt 内嵌随机盐）。
- access token 15–60 min + refresh token 表（旋转、可吊销、httpOnly cookie / App 安全存储）；`password_changed_at` 用于使旧 token 失效。
- 邀请 token / share token 均为不可猜测随机串 + 唯一索引。
- 注册/登录/邀请接受限流。
- 媒体权限统一走 §5.3 的服务端校验；匿名分享页仅读。

## 7. 错误处理与可观测性

- 统一错误中间件 + 错误码；请求体用 `packages/dto` 的 zod schema 在 controller 边界校验。
- server/worker 结构化日志（参考 aimo 的 packages/logger）。
- worker 记录 outbox 处理指标（积压量、失败数）。

## 8. 测试策略

- server：Jest + supertest（同 aimo）。重点：
  - `chainPolicy` 全矩阵单测（3 角色 × 全部操作）；
  - feed 复合游标翻页（含同时间戳、补发、tag 过滤）；
  - 媒体 complete 幂等 / HeadObject 校验；
  - outbox 消费与重试。
- dto / api-client：单测。
- web：关键流程组件测试（二期补）。

## 9. 部署与运维

- docker-compose services：`server`、`worker`、`mysql`、`backup`（每日 mysqldump → S3）。
- MySQL 数据卷备份与恢复演练流程写入 README。
- 环境变量（`apps/server/.env`，已 gitignore；仓库内提供 `.env.example` 占位模板，**真实凭据不进 git**）：

| 变量 | 说明 |
|---|---|
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | MySQL 连接；测试/生产用不同库与账号（已配置于 .env，本文件不记录真实值） |
| `ATTACHMENT_S3_BUCKET` | 桶名（沿用 aimo 的 `ATTACHMENT_S3_*` 命名约定） |
| `ATTACHMENT_S3_PREFIX` | key 前缀，按环境隔离（如 `dev/attachments`、`prod/attachments`） |
| `ATTACHMENT_S3_ENDPOINT` | S3 兼容服务地址（自建 endpoint，`forcePathStyle` 行为沿用 aimo 适配器逻辑：非阿里云 endpoint 用 path-style） |
| `ATTACHMENT_S3_REGION` | region（如 `cn-beijing`） |
| `ATTACHMENT_S3_ACCESS_KEY_ID` / `ATTACHMENT_S3_SECRET_ACCESS_KEY` | 访问凭据 |
| `ATTACHMENT_S3_IS_PUBLIC` | **`false`（私有桶，产品决策）**；所有读取走 §5.3 预签名 |
| `JWT_SECRET` | ≥32 字符随机串 |
| `PRESIGN_GET_TTL_SECONDS` | 预签名 GET 有效期（默认 3600，按整点时间窗对齐） |
| `PRESIGN_PUT_TTL_SECONDS` | 预签名 PUT/part 有效期（默认 900） |

## 10. 实施阶段

1. **脚手架**：monorepo + config + server 骨架 + auth（含双 token）+ docker-compose
2. **链**：chains + 成员/角色 + `chainPolicy`/`@RequireChainRole` + 邀请闭环
3. **时刻**：moments 三类型 + 媒体上传（multipart + complete 校验）+ web 时间线
4. **标签与 feed**：tags + 复合游标 feed 聚合过滤
5. **互动与异步**：评论 + 表情 + outbox/worker + 应用内通知
6. **App 端**：Expo 全功能 + 媒体压缩/分片上传 + Expo Push
7. **分享**：share_links + 匿名只读公开页
8. **加固**：sweeper、备份 sidecar、限流、S3 lifecycle

## 11. 容量假设与演进路径（显式声明）

| 假设 | 演进触发 |
|---|---|
| 人均链数 < 50 | 物化 feed 表（写时扇出） |
| 单链 moments < 10 万 | 分库/归档 |
| 媒体经 `/media/:id` 302 | 切 CDN 签名 cookie（接口不变） |
| outbox 单 worker 轮询 | 换 Redis 队列/多 worker |
| 视频原片播放 | 接云点播转码 HLS |

## 12. Backlog

编辑历史、那年今日/时光机、导出 PDF 纪念册、里程碑模板、地图足迹、视频转码 HLS、服务端抽帧封面、公开广场、微信/手机号登录、链免打扰设置、分享链接访问统计。
