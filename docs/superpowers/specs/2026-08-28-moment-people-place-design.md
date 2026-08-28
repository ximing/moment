# 时刻 Moment — 时刻人物与地点元数据 Design（M1：AI 融合检索地基）

> 日期：2026-08-28
> 状态：已批准，待实施
> 范围：server（persons/place 数据模型 + geocode 模块 + AI 抽取管线）+ dto + api-client + web + app
> 权威边界：outbox/worker 异步机制以 `2026-08-15-moment-design.md` §5.4 为准；LLM provider 抽象以 `2026-08-20-ai-recap-design.md` §3 为准；语音 transcript 语义以 `2026-08-23-voice-moment-design.md` 为准。本 spec 不修改媒体上传语义与链权限模型。
> 下游依赖：本 spec 是 M2（融合检索：意图理解 + 标量 + 向量）与 M3（AI 时光对话）的数据地基；地点坐标同时为 backlog「地图足迹」供数。

## 0. 产品决策（已与用户对齐）

- **AI 时光对话是产品方向**，架构定为融合检索：LLM 意图理解（"去年今天"→标量时间条件）+ 标量过滤 + 向量召回 + RRF 融合。但现有时刻只有时间维度，"和谁在一起 / 在哪里"缺位，标量路无米下锅——**破坏性的 schema 变更必须趁数据量小先行**，故 M1 优先于相框模式等其他方向。
- 时刻补两个维度：**人物**（和谁在一起）、**地点**（在哪里）。
- 人物词典**链级作用域**，完整镜像 `tags`/`moment_tags` 范式（链级词典 + 多对多关联 + 批取序列化）。"外婆"属于链；跨链搜索在 M2 查询层拼接，不在词典层解决。
- 三路采集，**优先级 manual > exif > ai**：
  - **手动**：编辑器内人物多选 + 地点文本输入。
  - **EXIF**：**客户端解码**（web 文件切片 + exifreader；app 原生 EXIF API），服务端**不读 S3 字节**——app 端压缩管线会剥 EXIF、HEIC 容器元数据不在文件头部，服务端 range read 两个失败模式已排除。
  - **AI**：LLM 从 content + transcript 抽取人物/地点，**自动落库**（source 标记、UI 可区分、用户可删改），不做"建议待确认"。
- 地点含**逆地理编码**（高德 Web 服务），坐标 → 地名异步回填；"在北京的时刻"本期即可搜。
- 隐私红线：**公开分享相册（share-album）序列化输出不含 persons 与 place**。家庭精确坐标绝不随公开链接外发。

## 1. 数据流

```
手动路：编辑器提交 personIds/place → moments create/update（校验人物属链、坐标范围）→ 落库
EXIF 路：客户端选图 → 解析 GPS → 编辑器状态（可见/可改/可删）→ 随 create/update 提交（source=exif）
        → server 落库坐标 → 写 outbox（moment.geocode）→ worker 逆地理编码 → 回填 place_name
AI 路：  moments create/update（content/transcript 变化）→ 写 outbox（moment.extract）
        → worker 调 LLM 抽取 {persons[], places[]} → persons 链词典按名 upsert
        → moment_persons 补 source=ai 行；place 仅在完全为空时填文本名（source=ai）
```

- 全部副作用在 worker，请求路径只新增同步校验（人物属链、坐标范围），零远端调用（与主 spec §5.4 一致）。
- outbox 事件类型在 `src/outbox/types.ts` 追加 `moment.geocode` / `moment.extract` 两个常量，handler 挂 `src/worker/handlers.ts`。

## 2. 数据模型

### 新表 `persons`（镜像 `tags`）

| 列 | 说明 |
|---|---|
| id | char(36) 主键，应用层 randomUUID() |
| chain_id | char(36) FK → chains.id |
| name | varchar(50)，词典名（"外婆"、"朵朵"） |
| user_id | char(36) NULL，FK → users.id；可选链接到链成员用户（"爸爸"就是注册用户），供 M3 "爸爸发了哪些"类查询 |
| created_at | timestamp notNull defaultNow |

- `UNIQUE uk_persons_chain_name (chain_id, name)`；索引 `(chain_id)`。
- 名归一化在应用层（trim + 去内部连续空白），不写 DB 函数；中文名为主，不做大小写折叠之外的变换。

### 新表 `moment_persons`（镜像 `moment_tags`）

| 列 | 说明 |
|---|---|
| moment_id | char(36) FK → moments.id |
| person_id | char(36) FK → persons.id |
| source | enum(`manual`,`ai`)，抽取来源（UI 区分展示、优先级规则用） |

- `PRIMARY KEY (moment_id, person_id)`；索引 `idx_moment_persons_person_moment (person_id, moment_id)`（M2 按人物圈结果集的驱动索引，语义同 tags 的驱动索引）。
- 同行升级：source=ai 的行被用户手动确认/重选后升级为 manual（见 §5 冲突规则），不允许同行两 source。

### `moments` 表加列

| 列 | 说明 |
|---|---|
| place_lat | decimal(10,7) NULL，WGS-84 原始坐标（EXIF/手动地图选点均为 WGS-84 或已换算，见 §4） |
| place_lng | decimal(10,7) NULL |
| place_name | varchar(255) NULL，展示名（逆地理编码回填或手动/AI 文本） |
| place_source | enum(`manual`,`exif`,`ai`) NULL；place 三列同生同灭（见 §6 清除语义） |
| ai_extract_hash | char(64) NULL，上次 AI 抽取时 sha256(content + '\0' + transcript)，幂等判据（§5） |

- 索引：v1 **不加** place 索引——M2 标量过滤的驱动列是 person_id/tag_id/happened_at，地点过滤在 person/时间圈出的小结果集上回表完成；若 M2 实测需要再加（演进路径见 §10）。

### 迁移与回滚

- 两新表（含唯一索引/驱动索引）+ moments 五个可空新列，全部增量，**无存量数据回填**（存量时刻靠 §5 回填 sweep 补 AI 路；EXIF 路不回溯历史媒体——客户端解码决策意味着服务端永不读对象字节）。
- `drizzle-kit generate` 生成迁移；按 server CLAUDE.md 约定**扩展 `tests/helpers/db.ts` 的 `resetDb()`**（persons/moment_persons 按外键逆序插入 delete 序列）。
- 回滚 = drop 两表 + drop 五列，无损。
- 对现有客户端**零破坏**：请求新字段全可选，响应新字段旧端忽略。

## 3. 客户端 EXIF 提取

### 为什么在前端

EXIF 是文件头部结构化元数据，解析只读一小段二进制 buffer，**不做像素解码**（不碰 createImageBitmap/canvas），这是它与"图片压缩/预览"的性能本质区别。

### web 端

- 时机：compose 编辑器选图/粘贴/拖拽落文件时，对 `mime ∈ image/*` 的 File：
  `file.slice(0, 256 * 1024).arrayBuffer()` → `exifreader`（**动态 import**，compose 流程外零加载体积）→ `ExifReader.load` → GPS 字段转十进制（注意 S/W 半球取负）。
- 耗时量级：亚毫秒~数毫秒，主线程同步解析无卡顿风险；256KB 切片对 JPEG 必然覆盖 APP1 段，对 HEIC 尽力而为（失败静默，不提示错误）。
- 解析出 GPS → 写入编辑器 place 草稿态并展示"已从照片读取位置"chip（可点×移除）；多图取**第一张含 GPS 的照片**，其余忽略（v1 不做多坐标合并）。
- 随 moment create/update 提交 `place: {lat, lng}`（无 name）；name 由 §4 异步回填。

### app 端

- `expo-image-picker` `launchImageLibraryAsync({ exif: true })` 读取**压缩前原始 asset** 的 EXIF（绕开压缩剥 EXIF 的失败模式）；GPSLatitude/GPSLongitude + Ref 半球归一。
- 其余与 web 相同：编辑器草稿态 chip + 随提交上送。

### 安全与信任边界

- 客户端坐标是**不可信输入**：server 校验 lat ∈ [-90,90]、lng ∈ [-180,180]，越界 400 `PLACE_COORDS_INVALID`。家庭场景不防伪——伪造坐标只污染自己的数据。
- place 随 create/update 提交时 source 由 **server 按 §6 赋值表判定**，客户端不传 source（防止伪造 source 绕过优先级规则）；客户端 EXIF 路径只提交坐标，落在 exif 分支。

## 4. 逆地理编码（geocode 模块）

- 新模块 `src/geocode/`：`base.provider.ts`（`reverse(lat, lng): Promise<string | null>`）+ `factory.ts`（singleton 三态 + `setGeocodeProvider` 测试注入，**完整复刻 `llm/factory.ts` 范式**）+ `amap.provider.ts`（高德 `restapi.amap.com/v3/geocode/regeo`，取 `regeocode.formatted_address`）。
- **坐标系**：EXIF GPS 是 WGS-84，高德全家是 GCJ-02，直接用偏几十到几百米、地名可能跨街区。落库保留 WGS-84 原值（数据真相），**调用高德前做 WGS-84→GCJ-02 换算**（`src/geocode/gcj02.ts`，纯函数无依赖，约 50 行标准算法，含中国境外判断——境外不偏移直接请求）。后续地图足迹展示同样需要这层换算。
- 新环境变量 `AMAP_WEB_KEY`（同步 `config.ts` zod + `.env.example`）。**空 key → provider null → 坐标照存、place_name 留空、outbox 行消费即跳过**，管线不阻断（同 recap 的 LLM_API_KEY 停用模式）。
- outbox `moment.geocode` payload：`{moment_id, lat, lng}`。worker 成功回填 `place_name`；失败走 outbox 既有指数退避，终败仅记日志（坐标仍在，损失可接受，不重派）。
- 触发时机：place_source=exif 且 place_name 为空时，由 moments create/update 在同事务写 outbox 行。手动仅文本的 place 不触发（无坐标可编）。

## 5. AI 文本抽取

### 触发与幂等

- moments create/update 落库后，若 `sha256(content + '\0' + transcript) ≠ ai_extract_hash`，同事务写 outbox `moment.extract`（payload `{moment_id}`）。
- worker 消费：重读 moment → 调 LLM 抽取 → 成功则更新 `ai_extract_hash`。**内容没变不重抽**；LLM_API_KEY 为空 → provider null → 消费即跳过（不写 hash，恢复 key 后下次内容变化自然补抽）。

### 抽取内容与落库规则

- prompt 输入：content + transcript（voice 时刻正文常为空，transcript 是主素材）。输出 JSON：`{persons: string[], places: string[]}`。
  - 人物：人名与亲属称谓原样抽取（"外婆"、"朵朵"、"王叔叔"）；第一/二人称（"我"、"你"）不抽。
  - 地点：地名与场所短语（"外婆家"、"朝阳公园"、"北京"），取文本原样，不臆造坐标。
- persons 落库：名归一化后在链词典 upsert（已存在复用 id）；写 `moment_persons` source=ai 行——**仅补缺**：已存在 manual 行的 person 不动（不降级）。
- place 落库：**仅当 place 三列全空时**填 `place_name = places[0]`、source=ai（无坐标）。exif/manual 已有 place 时 AI 永不覆盖；ai 的文本名可被后续 exif/manual 整体覆盖。
- **冲突规则汇总**（manual > exif > ai）：
  - 人物：manual 与 ai 并集共存，source 逐行标记；用户删除 ai 行后保持删除（hash 未变不重抽）；用户在编辑器里重新加回同一 person → 该行 source 升级 manual。
  - 地点：manual 显式提交（含显式清除） > exif 坐标 > ai 文本名；用户显式清除 place = 提交 place:null（§6），server 清空三列 + source，此后 AI 需等内容再次变化才可能重填，exif 需重新绑定新媒体才可能重填——符合用户直觉。

### 成本护栏与回填

- 复用 recap 的护栏思路：worker 内串行消费（outbox 既有机制），无并发放大；单次抽取输入截断（content+transcript 各取前 2000 字符，prompt 内声明截断）。
- 存量回填：一次性 sweep（`pnpm --filter @moment/server backfill:extract`，复用 worker 进程模式的批量扫描骨架），扫描 `ai_extract_hash IS NULL AND deleted_at IS NULL AND (content <> '' OR transcript IS NOT NULL)` 的时刻分批写 outbox；批量大小与间隔做参数，LLM_API_KEY 为空直接退出。回填天然幂等（hash 判据）。

## 6. API 设计

全部嵌套路由，权限走 `requireChainRole` / `ChainPolicy.require`，禁止手写角色判断。

### Persons（词典 CRUD-lite）

| 端点 | 说明 |
|---|---|
| `GET /api/chains/:chainId/persons` | 列出链词典（含 user_id 链接信息），编辑器选择器数据源 |
| `POST /api/chains/:chainId/persons` | `{name, userId?}` 新建；名归一化撞唯一约束 → 返回已存在行（幂等创建，编辑器"自由文本新建"天然幂等） |
| `PATCH /api/chains/:chainId/persons/:personId` | `{name}` 改名；撞名归一化 → 409 `PERSON_NAME_CONFLICT`（v1 不做合并，合并入 backlog） |
| `DELETE /api/chains/:chainId/persons/:personId` | 删除 = 先删全部 moment_persons 关联再删词典行（元数据级联，不触时刻本体） |

### Moments create/update 增量字段

- `CreateMomentInput` / `PatchMomentInput` 增加：
  - `personIds?: string[]`（uuid，max 20）。PATCH 语义 = **全量替换**（与 `tagIds` 对齐）；提交即视为 manual 意图——提交的 id 集合写 source=manual，**集合外原有的 ai 行删除**（编辑器展示全集、用户删 chip 即此路径），集合外原有 manual 行也删除（与 tagIds 替换语义一致）。
  - `place?: {name: string(1..255), lat?: number, lng?: number} | null`；lat/lng 必须同有同无（zod refine，否则 400 `PLACE_COORDS_INVALID`）。PATCH `place: null` = 显式清除三列 + source。
- server 端 source 赋值表：

  | 提交内容 | place_source | 后续动作 |
  |---|---|---|
  | 坐标 + 名字 | `manual`（客户端地图选点/确认后的形态） | 有名字不触发 geocode |
  | 仅坐标 | `exif` | 写 outbox geocode 回填名字 |
  | 仅名字 | `manual` | 不触发 geocode |
  | null | 清空 | — |

- 校验：`personIds` 必须全部属于该链词典，否则 400 `PERSON_NOT_IN_CHAIN`。

### 响应体与序列化

- `MomentResponse` 增加：`persons: PersonBrief[]`（`{id, name, userId, source}`，source 取自 moment_persons 关联行）、`place: {lat, lng, name, source} | null`。词典端点 `GET persons` 返回 `{id, name, userId}`（词典行无 source 概念）。
- feed/链时间线序列化按 tags 的**批取范式**（按 moment ids 一次 IN 查询再内存分组），禁止 N+1。
- **share-album（公开分享）序列化器不包含这两个字段**（§8 红线），并有显式测试钉死。

## 7. 各端 UX

### web + app 共有

- 时刻编辑器：
  - **人物选择器**：chip 多选；链成员置顶（选中即建/复用 user_id 链接的 person）；词典搜索；自由文本回车新建（走幂等 POST）。AI 抽取的 chip 带轻标识（如"AI"角标/淡色），长按/悬停提示来源。
  - **地点**：文本输入框 + EXIF chip（§3）；无地图选点器（v2 演进项）。
- 时刻卡片/详情：人物 chip 行与地点行只读展示（不加展示等于白做）；点击行为（按人物/地点过滤）属 M2，v1 不可点。
- **明确不做**：地图足迹视图、地图选点、persons 合并、按人物/地点的筛选 UI。

## 8. 隐私与安全

- **红线**：share-album 公开输出零 persons/place 字段（显式测试钉死，§9）。
- 逆地理编码把坐标发给高德：spec 显式声明；`AMAP_WEB_KEY` 置空即整体停用该外发（坐标仍落库，仅缺地名）。
- EXIF 提取在客户端完成后，上送的结构化坐标即用户可见的编辑器草稿——不存在"服务端偷偷读照片信息"的黑盒路径，符合家庭用户隐私直觉。
- persons/place 的读写权限与时刻本体一致（链角色模型），无新增权限面。
- 速率滥用：geocode/AI 全在 worker 串行消费，请求路径不可直接触发远端调用。

## 9. 测试策略

- 遵循 `.claude/rules/testing.md`：触库测试 `afterAll(closeDb)`、`--runInBand`、只打 `.env` 测试库；新表进 `resetDb()`。
- server：
  - persons CRUD + 链角色守卫（requireChainRole 拒绝跨角色/跨链）+ 幂等创建 + 改名冲突。
  - moments create/update：personIds 属链校验、坐标范围与同有同无校验、source 赋值表全分支、PATCH 全量替换（ai 行删除/manual 保留语义）、place:null 清除。
  - geocode worker：mock provider（`setGeocodeProvider`）断言回填/空 key 跳过/终败不重派；gcj02 换算纯函数用例（境内偏移/境外不偏移）。
  - AI 抽取 worker：mock LLM（`setLLMProvider`）断言 upsert 词典/仅补缺/manual 不降级/place 非空不覆盖/hash 幂等（同内容二投不重抽）。
  - **share-album 序列化显式断言无 persons/place**（隐私红线测试）。
- dto：zod schema 用例（lat/lng refine、personIds 上限、place:null 语义）。
- web/app：编辑器人物选择器与 EXIF chip 的组件测试按各端既有范式；EXIF 解析函数用含 GPS 的 fixture buffer 单测。
- e2e：建时刻带人物+坐标 → 响应回读 → geocode mock 回填 → AI mock 补缺；回填 sweep 幂等二跑。

## 10. 容量假设与演进路径

- 人物词典：单链数十量级；moment_persons 与 moment_tags 同量级。驱动索引 `(person_id, moment_id)` 足够 M2 圈集。
- 逆地理 QPS：worker 异步，高峰为上传洪峰的尾随，远低于高德免费配额；无缓存层（家庭坐标离散，缓存命中率不值这层复杂度）。
- 演进路径（显式声明，本期不做）：
  - moments.place 标量索引：M2 实测地点过滤热时再加；
  - persons 合并（"外婆"="姥姥"）：backlog；
  - 地图选点器（提交坐标+名字走 manual 分支，API 已预留）；
  - 地图足迹视图：坐标已就绪，独立 spec；
  - 客户端补传 EXIF 元数据的旁路（presign metadata）：若原生读取覆盖不足再加。

## 11. 实施分期

| 期 | 内容 | 出口标准 |
|---|---|---|
| P1 | dto（persons/place schema + PersonBrief）+ server schema 两表五列 + 迁移 + `resetDb()` | 迁移在测试库通过，dto 测试绿 |
| P2 | server persons CRUD + moments personIds/place 写读 + feed 批取序列化 + share-album 排除 | API 测试全绿（含隐私红线测试） |
| P3 | geocode 模块 + gcj02 换算 + geocode worker + `AMAP_WEB_KEY` | mock provider 测试全绿 |
| P4 | AI 抽取管线（prompt + worker + hash 幂等）+ 回填 sweep 脚本 | mock LLM 测试全绿，sweep 二跑幂等 |
| P5 | api-client 类型 + web 编辑器（人物选择器/地点/EXIF 读取）+ 卡片展示 | web 手测 + 组件测试绿 |
| P6 | app 编辑器（原生 EXIF）+ 卡片展示 | app 手测通过 |
| P7 | e2e 联调 + 回填脚本在测试库演练 | e2e 全绿 |

P1–P4 纯后端可顺序串行；P5/P6 在 P2 完成后即可与 P3/P4 并行（客户端只依赖 API 契约，不依赖两条 worker 管线）。
