# 时刻 Moment — 链模板系统 Design

> 日期：2026-08-20
> 状态：已实现（P1–P6 合入，2026-08-21）
> 范围：server + dto + api-client + web + app + 分享页；含用户自建模板的系统架构（编辑器 UI 后置）
> 权威边界：数据模型、权限模型、媒体、分享语义以 `2026-08-15-moment-design.md` 为准；本文定义模板子系统。模板与 `wall_date`/那年今日（`2026-08-18-memories-today-design.md`）正交。

## 0. 产品决策（已与用户对齐）

- 链从「空容器」变成有结构的档案，**模板是产品的扩张轴**。
- 首批内置模板三个：`baby`（宝宝成长）、`travel`（旅行）、`daily`（日常生活）。
- **一链一模板，创建时选定，不可改**；选错只能新建链，UI 明示。
- **用户自建模板的系统架构本轮直接落地**：模板定义存数据库、纯数据 DSL、API 可建；可视化编辑器 UI 后置。内置模板作为 official seed 入库，**没有任何代码特权**——内置能表达的，用户模板就能表达。
- 理由：把「manifest 必须是纯数据」从文档约束变成系统机制，三个内置模板就是 DSL 表达力的第一批测试用户，更早暴露设计问题。

## 1. 核心架构：schema-driven 的 kind + payload

### 1.1 两个正交维度

- `moments.type`（`text`/`media`/`video`）继续表达**媒体形态**，不变。
- `moments.kind`（默认 `standard`）表达**语义类别**：`milestone`（里程碑）、`metric`（身高体重等数值记录）等，由模板注册。
- `moments.payload`（json，可空）承载 kind 对应的结构化数据；普通 moment 也可携带模板定义的附加字段（如 `geo`、`mood`）。

结构化记录**就是普通 moment**：评论、表情、通知、分享、那年今日、软删全部零成本复用。聚合视图（曲线/地图/心情线）是查询投影，不做独立存储。

### 1.2 模板 = 数据库里的一份纯数据 manifest

模板定义从「代码 + zod」改为「`templates` 表一行 JSON」。这是用户自建模板的前提，也是本轮的核心架构决策。

**DSL 硬约束（写进系统，不是文档）：**

1. manifest 必须是可 JSON 序列化的纯数据，**禁止函数/组件引用**；server 入库前做结构校验（自身也是一份 JSON Schema）。
2. payload 校验规则以 **JSON Schema（draft 2020-12）** 表达；禁止不可序列化的校验（refine/transform 类），复杂跨字段校验放 server 业务层。
3. 发布器扩展字段与聚合视图只允许从**受控词表**组合，词表外一律拒收：
   - 字段词表：`text` / `number-unit`（数值+单位）/ `enum` / `date` / `geo` / `emoji-picker`
   - 视图词表：`timeline` / `curve` / `map` / `moodline` / `milestone-axis`
4. manifest 带 `version`（int，单调递增）；编辑规则见 §3.4。

### 1.3 manifest 结构（schema 摘要）

```jsonc
{
  "version": 1,
  "chainPayloadSchema": { /* JSON Schema：链级 payload，可空对象 */ },
  "kinds": [
    {
      "key": "milestone",           // 模板内唯一
      "label": "里程碑",
      "payloadSchema": { /* JSON Schema */ },
      "publisher": { "entry": "button", "label": "记一个里程碑" }
    }
  ],
  "momentFields": [                  // 附加在普通 moment 上的扩展字段
    { "key": "mood", "type": "emoji-picker", "label": "此刻心情", "options": ["😄","🥰","😭","😤","😴"] },
    { "key": "geo",  "type": "geo",  "label": "添加位置" }
  ],
  "views": [
    { "type": "curve", "label": "成长曲线", "source": { "kind": "metric" } },
    { "type": "map",   "label": "足迹地图", "source": { "field": "geo" } },
    { "type": "timeline", "label": "行程", "groupBy": "trips" }
  ],
  "milestoneCatalog": [ /* 仅声明需要目录的 kind：内置选项，用户可自定义追加 */ ]
}
```

`views[].groupBy`（可选，词表值，当前仅 `'trips'`、仅 `timeline` 视图可用）：渲染器按链 `payload.trips` 把时刻分章节展示。

### 1.4 dto 包的单一真相

- `packages/dto` 新增单文件 `src/templates.ts`（+ 同目录 `templates.test.ts`）：manifest 的 TS 类型 + manifest 自身的 JSON Schema + 词表枚举。单文件布局的理由：dto「每业务域一文件」约定 + 测试 glob 只匹配 `src/*.test.ts`。
- **TS 类型从 JSON Schema 生成**（`json-schema-to-ts` 的 `FromSchema`），不手写平行类型，避免两套真相漂移。
- 三个 official 模板的 manifest 以 TS 常量定义在 dto 包（类型安全），server 迁移时 seed 入库；入库后 server 运行时只读 DB，不读常量（常量仅作 seed 源与测试基准）。
- server 用 **ajv** 校验 moment/chain payload 与 manifest 本身；api-client 透传。

## 2. 数据模型与迁移

### 2.1 新表 `templates`

| 列 | 说明 |
|---|---|
| id | 主键 |
| key | 全局唯一。official：保留 slug（`baby`/`travel`/`daily`，不含 `/`）；user：server 分配 `u_<21 位十六进制随机>`，用户只填 name，不选 key（避免撞名与抢注官方命名空间）。**用 `u_` 不用 `u/`**：`:key` 路由参数不匹配含 `/` 的路径段，斜杠 key 无法被 `GET/PATCH/DELETE /api/templates/:key` 寻址 |
| scope | enum(`official`,`user`) |
| owner_id | user 模板的创建者；official 为 NULL |
| name / description / icon | 展示信息（icon 从词表选，禁止 URL） |
| manifest | json，纯数据 DSL（§1.3） |
| version | int，从 1 开始，每次编辑 +1 |
| status | enum(`active`,`archived`)，默认 active |
| created_at / updated_at | |

### 2.2 既有表变更

- `chains`：
  - `template varchar NOT NULL` —— 指向 `templates.key`（应用层校验，不加 FK：模板 key 全局唯一但删模板是 archive 不是物理删，FK 无收益且阻碍模板演进）。
  - `payload json NULL` —— 链级模板数据（宝宝生日、行程列表等），按 manifest 的 `chainPayloadSchema` 校验。
- `moments`：
  - `kind varchar NOT NULL DEFAULT 'standard'`。
  - `payload json NULL`。
  - 索引：`kind` 不进核心索引（`(chain_id, happened_at, id)` 不变）；聚合视图查询走 `chain_id` 过滤后小结果集回表，量大的演进路径见 §7。

### 2.3 迁移（三阶段，沿用 wall_date 迁移先例）

1. `templates` 建表（纯 DDL）；official seed 由 `migrate.ts` 迁移完成后调 `seedOfficialTemplates()` 幂等 upsert——数据源是 dto 的 TS 常量 `OFFICIAL_TEMPLATES`，SQL 迁移无法 import；`resetDb()` 清表后同样重 seed，保证测试前置数据。
2. `chains`：`ADD COLUMN template varchar NULL` → `UPDATE chains SET template='daily'` → `MODIFY template varchar NOT NULL`；`ADD COLUMN payload json NULL`。
3. `moments`：`ADD COLUMN kind varchar NOT NULL DEFAULT 'standard'`（有默认值可一步到位）、`ADD COLUMN payload json NULL`。

**存量链落 `daily` 的理由**：`daily` 的心情标记是可选字段、不改变既有发布路径，且避免引入第四个「空白模板」；空白体验 = daily 不用心情字段。**部署顺序：迁移与新代码同批发布**（同 wall_date 先例，不允许先迁移后隔天部署）。

回滚：drop 新列/新表（纯投影与新增，无损）。

### 2.4 测试夹具

`tests/helpers/fixtures.ts` 的 `insertChain`/`insertMoment` 同步补 `template`/`kind` 字段（同 wall_date 的夹具教训）。

## 3. API 设计

### 3.1 模板 CRUD（不走 chainPolicy，非链内资源）

- `GET /templates` —— official 全部 + 我的 user 模板（`?scope=` 过滤）。
- `POST /templates` —— 任何登录用户可建 user 模板；body 为 manifest + name/description/icon；server 分配 key、跑 manifest 结构校验（含 JSON Schema 合法性、词表白名单）。
- `GET /templates/:key` `PATCH /templates/:key` `DELETE /templates/:key`（= archive，owner 本人）。
- 错误码：`TEMPLATE_MANIFEST_INVALID`（附 ajv 错误路径）、`TEMPLATE_NOT_FOUND`、`TEMPLATE_FORBIDDEN`（非 owner）。

### 3.2 链与 moment 的契约变化（breaking）

- `POST /chains`：**必传 `template`**。`PATCH /chains` 拒绝改 template → `TEMPLATE_IMMUTABLE`；允许改 `payload`（按链模板的 `chainPayloadSchema` 校验，如补录宝宝生日、编辑行程列表）。
- `POST /chains/:id/moments` / `PATCH /moments/:id`：可传 `kind`（默认 `standard`）与 `payload`；server 按**该链模板**的 manifest 校验：kind 必须在模板 kinds 内、payload 过对应 JSON Schema、普通 moment 的 payload 只允许模板 momentFields 声明的 key。不匹配 → `MOMENT_PAYLOAD_INVALID`（链 payload 非法用并列的 `CHAIN_PAYLOAD_INVALID`）。
- 响应 DTO：`Chain` 增 `template`、`payload`；`Moment` 增 `kind`、`payload`；另返 `templateManifest`（链详情里内嵌，客户端不必二次请求）。
- 聚合视图统一端点：`GET /chains/:id/aggregate?view=<视图类型>&kind=<kind>&field=<字段>`（成员权限，viewer 可读），返回视图无关的投影数据（如 curve → `[{happened_at, value, unit}]`；map → `[{moment_id, lat, lng, place_name, happened_at}]`；milestone-axis → milestone moments 序列；moodline → 按日心情分布）。**渲染是各端词表渲染器的事，server 只出数据。**
- 分享页：`GET /public/share/:token` 响应附带链模板 manifest 与聚合投影（只读），长辈可见里程碑轴/地图。

### 3.3 权限矩阵影响

- 发布带 kind 的 moment：仍是 editor 及以上（chainPolicy 无需新增动作，payload 校验在 controller 边界之后、service 之内）。
- 模板 CRUD：登录即可建；改/删仅 owner 本人；official 模板对所有人只读（seed 管理，无运行时写 API）。
- `GET /templates/:key` 对他人的 user 模板同样可读：manifest 是纯结构定义、不含用户数据；可见性控制由 list 承担（只列 official + 我的），详情接口不额外设防。
- viewer 对聚合视图只读可见。

### 3.4 模板编辑规则（版本语义）

- user 模板可被 owner 编辑，但**仅允许增量变更**：新增 kind/字段/视图/里程碑目录项；禁止删除或收窄（改字段类型、缩 enum 选项、删 kind）——存量链的 payload 可能已依赖旧定义。server 校验非增量编辑 → `TEMPLATE_EDIT_NOT_ADDITIVE`。
- v1 实现取保守冻结：`chainPayloadSchema` 与既存 kind 的 `payloadSchema` 整体冻结（含 publisher 与目录项的 label/icon），比「禁止收窄」更严；后续确需「schema 加 optional 字段」「改目录项文案」再按需放宽。
- 每次编辑 `version + 1`；链不 pin 版本（增量规则保证向后兼容，pin 无收益）。
- archive：存量链照常使用（模板定义快照语义 = 读时按当前 manifest，archive 只阻止**新建链**选用）。不物理删除。

## 4. 三个内置模板定义

| 模板 | 链级 payload | kinds | momentFields | views |
|---|---|---|---|---|
| `baby` 宝宝成长 | `{baby_name?, birthdate?, gender?: boy/girl/unknown}` | `milestone`（payload: `{catalog_key? 或 custom_label, note?}`）、`metric`（payload: `{metric: 'height'\|'weight', value, unit}`） | 无 | `milestone-axis`、`curve`（metric） |
| `travel` 旅行 | `{trips: [{name, start, end, cover_media_id?}]}` | 无 | `geo`（type=geo，payload: `{lat, lng, place_name?}`） | `map`、`timeline`（`groupBy: 'trips'`，按行程分章节） |
| `daily` 日常生活 | 无 | 无 | `mood`（type=emoji-picker） | `moodline` |

年龄自动标注（「1 岁 2 个月」）是 baby 模板的**展示层能力**：由 `birthdate` + `happened_at` 计算，不落库。

baby 里程碑目录（内置 8 项，用户发 moment 时可自定义追加 custom_label）：first-smile 第一次微笑 😊 / first-roll 第一次翻身 🔄 / first-sit 第一次独坐 🪑 / first-crawl 第一次爬 🐾 / first-stand 第一次站立 🧍 / first-steps 第一次走路 👣 / first-word 第一次开口 💬 / first-tooth 第一颗牙 🦷。

## 5. 各端 UX 要点

- 创建链 = 先选模板（三卡片 + 预览文案），确认页明示「模板选定后不可更改」。
- 发布面板按 manifest 动态渲染：baby 出「记里程碑 / 记身高体重」入口；travel 出定位按钮；daily 出心情选择器。**各端写的是词表通用渲染器，不是三个模板的硬编码 UI。**
- 链眉下方出聚合视图入口（按模板 views 渲染 tab）。
- 分享只读页同样渲染里程碑轴/地图/心情线——给祖辈的惊喜时刻。
- web 遵循 `docs/superpowers/specs/` 已批准的 C 端设计规范，不另立样式约定。

## 6. 测试策略

- manifest 校验器：词表外字段/视图拒收、非法 JSON Schema 拒收、非增量编辑拒收（全矩阵单测）。
- moment payload 分发校验：3 模板 × 各 kind/字段 × 正反例。
- 迁移：存量链落 `daily`、official seed 幂等。
- 聚合端点：curve/map/moodline/milestone-axis 投影正确性（含软删 moment 剔除、viewer 权限）。
- dto：JSON Schema ↔ TS 类型 parity 测试。
- 模板 CRUD 权限（非 owner 改删 → 403）。

## 7. 容量假设与演进路径

| 假设 | 演进触发 |
|---|---|
| 聚合视图 = `chain_id` 过滤 + JSON 投影回表，单链结构化 moment < 1 万 | 物化投影表 / MySQL generated column + 索引（如 geo、metric value） |
| 模板数 < 数百（official + 早期 user） | 模板列表分页/搜索 |
| 词表覆盖用户需求 | 新字段/视图类型随版本发布（词表只增不减），所有模板自动可用 |
| 用户经 API 建模板 | 模板编辑器 UI、模板市场（clone/发布），均为加法不返工 |

## 8. Breaking change 清单

1. `POST /chains` 必传 `template`（旧客户端 400）——客户端同批发版。
2. `Chain`/`Moment` 响应 DTO 增字段（向后兼容，但 api-client/dto 需同版）。
3. `PATCH /chains` 改 template 从静默忽略变 `TEMPLATE_IMMUTABLE` 报错。
4. 迁移 NOT NULL 收紧要求迁移与代码同批部署。

## 9. 实施分期

1. dto：manifest 类型 + 词表 + JSON Schema 生成管线 + official 三模板常量。
2. server：`templates` 表 + seed + 模板 CRUD + ajv 校验链。
3. server：chains/moments 加列 + payload 校验接入 + 聚合端点。
4. web：创建链选模板 + 词表发布器渲染器 + 三个视图渲染器 + 分享页。
5. app：同上（Expo 端，geo 用 expo-location）。
6. 加固：夹具补齐、e2e、文档。
