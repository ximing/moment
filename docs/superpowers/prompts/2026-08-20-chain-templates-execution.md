# 执行编排 Prompt：链模板系统

> 用法：把本文件全文粘贴给一个新的支持 SubAgent 的主 Agent（Claude Code / Codex 等）。它是编排者，不是实现者。
> Spec：`docs/superpowers/specs/2026-08-20-chain-templates-design.md`（唯一设计真相源）
> 约定：`docs/superpowers/plans/CONVENTIONS.md`（接口契约 §3 不得改名/改语义）

---

你是时刻 Moment 项目的**编排主 Agent**，负责按本编排执行「链模板系统」的实施。工作目录 `/Users/ximing/project/mygithub/moment`。

## 0. 角色纪律（最高优先级，不可违背）

1. **你只做事：任务边界定义、派发、验收、状态同步、commit。你不写任何实现代码、不亲自修 bug。**
2. 每个 Task 走串行流水线：**实现 SubAgent → 独立复审 SubAgent（≠ 实现者）→ 有阻塞/高危问题派 fixer SubAgent → 你终验 → 你 commit**。一次只跑一个 Task，禁止并行改共享文件。
3. 实现 SubAgent 的输入：本文件中该 Task 的边界（含 owner 文件清单与接口契约）+ spec 路径 + CONVENTIONS.md 路径。复审 SubAgent 的输入：git diff + spec + 任务边界，只输出问题清单（按 阻塞/高危/建议 分级）。两者不得是同一会话。
4. 实现/fixer 越界（改了 owner 清单外的文件、改了契约语义）必须停手报告，由你裁决；**任何 SubAgent 都不得自行 commit**，commit 由你在验收通过后执行（conventional commits，每 Task 一个）。
5. 每个 "done/pass" 必须有真实证据：门禁命令的 exit code、测试通过数、build 结果。凭 agent 自述不算数。
6. 用 TaskList 维护 T1–T7 状态，每完成一个 Task 向用户同步一行进度。

## 1. 环境事实与全局硬约束

- pnpm 10.22+，Node ≥ 20；先 `pnpm build` 再跑 dev/测试（dto 等依赖包需先构建）。
- ESM NodeNext：TS 相对 import 一律带 `.js` 后缀。
- 测试打 `apps/server/.env` 指向的 MySQL 测试库（`--runInBand`），**严禁生产库**；触库测试文件必须 `afterAll(closeDb)`；`.env` 严禁提交或覆盖。
- 新表必须：建表 → `drizzle-kit generate` → migrate → **扩展 `resetDb()`（按外键依赖逆序 delete）** → 同步 `tests/helpers/fixtures.ts` 夹具。
- 主键 `char(36)` + 应用层 `randomUUID()`；时间列 `timestamp({mode:'date'})`；`created_at` 一律 `defaultNow()`。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码；链内资源路由嵌套 `/api/chains/:chainId/...`；controller 内禁止手写角色判断（用 `ChainPolicy.require` / `requireChainRole`）。
- dto：请求 schema 用 zod、响应用 interface，`packages/dto/src/index.ts` re-export，测试 `tsx --test`。
- web 开发必须遵循 `docs/superpowers/specs/` 下 2026-08-17/18 的六份 C 端设计规范，不另立样式约定。
- **如发现 spec 与本编排矛盾或 spec 有漏洞：停手报告，不得自行发明设计绕过。**

## 2. Task 拆分总览

```
T1 dto 模板域 → T2 server 模板注册表 → T3 server chains/moments 接入
→ T4 server 聚合端点+分享页 → T5 web → T6 app → T7 e2e+收尾
```

全部串行。T5/T6 虽无代码依赖仍串行执行（共享 spec 解释权，串行让 T6 复用 T5 的裁决结论）。

---

### T1 — dto：模板域类型与官方模板定义

**Owner 文件**：
- Create `packages/dto/src/templates/{vocab.ts, manifest-schema.ts, official-templates.ts, index.ts, templates.test.ts}`
- Modify `packages/dto/src/index.ts`（re-export）；`packages/dto/package.json`（如需加 `json-schema-to-ts` 依赖）

**Consumes**：spec §1.2–1.4、§4。
**Produces**（后续 Task 引用的精确符号，不得改名）：
- `TEMPLATE_FIELD_TYPES`（`['text','number-unit','enum','date','geo','emoji-picker'] as const`）、`type TemplateFieldType`
- `TEMPLATE_VIEW_TYPES`（`['timeline','curve','map','moodline','milestone-axis'] as const`）、`type TemplateViewType`
- `manifestJsonSchema`（JSON Schema draft 2020-12 常量对象，即 manifest 的 meta-schema，覆盖 spec §1.3 全部字段）
- `type TemplateManifest = FromSchema<typeof manifestJsonSchema>`（TS 类型从 schema 生成，**禁止手写平行类型**）
- `OFFICIAL_TEMPLATES: readonly { key: 'baby'|'travel'|'daily'; name: string; description: string; icon: string; manifest: TemplateManifest }[]`——三模板内容忠实 spec §4 表格（baby：chainPayloadSchema 含 birthdate 等 + kinds milestone/metric + views milestone-axis/curve；travel：chainPayloadSchema trips + momentFields geo + views map/timeline；daily：momentFields mood + views moodline）
- `createTemplateInputSchema` / `updateTemplateInputSchema`（zod；create 含 name/description/icon/manifest，update 全可选）
- `interface TemplateDto`（id/key/scope/ownerId/name/description/icon/manifest/version/status/createdAt/updatedAt）

**验收门禁**：`pnpm --filter @moment/dto test`（含 parity 测试：OFFICIAL_TEMPLATES 三份 manifest 均通过 manifestJsonSchema 自校验）、`pnpm --filter @moment/dto build` 通过。
**Commit**：`feat(dto): add template manifest schema and official templates`

---

### T2 — server：templates 表 + CRUD + manifest 校验器

**Owner 文件**：
- Create `apps/server/src/db/schema/templates.ts`；`apps/server/src/templates/{manifest-validator.ts, template.service.ts, template.controller.ts}`；测试文件按 `apps/server/src/chains/` 既有模块的测试布局照抄
- Modify `apps/server/src/db/schema.ts`（barrel）、`apps/server/src/app.ts`（注册 controller）、`apps/server/tests/helpers/db.ts`（resetDb）、`apps/server/package.json`（如需加 `ajv` 依赖）

**Consumes**：T1 的 dto 符号；spec §2.1、§3.1、§3.4。
**Produces**：
- `templates` 表（列严格按 spec §2.1）；迁移内含三份 official 模板 seed（数据来自 dto 的 `OFFICIAL_TEMPLATES`，幂等）
- `validateManifest(raw: unknown): TemplateManifest`——ajv 校验 + 词表白名单 + 嵌套 payloadSchema 本身是合法 JSON Schema；失败抛 `BadRequestError('TEMPLATE_MANIFEST_INVALID')`（details 附 ajv 错误路径）
- `assertAdditiveEdit(prev: TemplateManifest, next: TemplateManifest): void`——仅允许新增 kind/字段/视图/目录项，禁止删除或收窄；违反抛 `BadRequestError('TEMPLATE_EDIT_NOT_ADDITIVE')`
- 路由（spec §3.1）：`GET/POST /api/templates`、`GET/PATCH/DELETE /api/templates/:key`（DELETE = archive）。user 模板 key = `u/` + nanoid（仓库无 nanoid 依赖则用 randomUUID 去横线截断 21 位并在报告中说明）；PATCH 仅 owner 本人且过 `assertAdditiveEdit`，version+1；official 模板只读
- 错误码：`TEMPLATE_MANIFEST_INVALID` / `TEMPLATE_NOT_FOUND` / `TEMPLATE_FORBIDDEN` / `TEMPLATE_EDIT_NOT_ADDITIVE`

**验收门禁**：迁移在测试库跑通（jest globalSetup）；`pnpm --filter @moment/server test` 全绿（含校验器全矩阵单测、CRUD 权限测试）；seed 幂等测试（重复迁移不重复插）。
**Commit**：`feat(server): add template registry with CRUD and manifest validation`

---

### T3 — server：chains/moments 加列 + payload 校验接入

**Owner 文件**：
- Modify `apps/server/src/db/schema/{chains.ts, moments.ts}`、`apps/server/src/chains/`（controller/service）、`apps/server/src/moments/`（controller/service）、`apps/server/src/moments/moment-serializer.ts`、`apps/server/tests/helpers/fixtures.ts`（insertChain/insertMoment 补字段）
- Create `apps/server/src/templates/payload-validator.ts` + 测试
- Modify `packages/dto/src/{chains.ts, moments.ts}`（请求/响应扩展）

**Consumes**：T2 的模板查询能力；spec §2.2–2.4、§3.2–3.3、§8。
**Produces**：
- 迁移（三阶段，spec §2.3）：`chains.template`（NULL→回填 `'daily'`→NOT NULL）+ `chains.payload json NULL`；`moments.kind varchar NOT NULL DEFAULT 'standard'` + `moments.payload json NULL`
- `validateChainPayload(template: TemplateManifest, payload: unknown): void`、`validateMomentPayload(template: TemplateManifest, kind: string, payload: unknown): void`——kind 必须在模板 kinds 内、payload 过对应 JSON Schema、standard moment 的 payload 只允许 momentFields 声明的 key；失败抛 `BadRequestError('MOMENT_PAYLOAD_INVALID')`
- `POST /api/chains` **必传 template**（dto 的 createChainInputSchema 加必填字段）；`PATCH /api/chains` 改 template → `BadRequestError('TEMPLATE_IMMUTABLE')`，允许改 payload（过 chainPayloadSchema 校验）
- moments create/update 接受 `kind`（默认 `standard`）与 `payload`，过 `validateMomentPayload`
- 响应 DTO：`Chain` 增 `template`/`payload`，链详情内嵌 `templateManifest`；`Moment` 增 `kind`/`payload`（momentSerializer 唯一出口处加）

**验收门禁**：server 测试全绿（含 3 模板 × 各 kind/字段正反例的分发校验矩阵、迁移回填断言）；fixtures 补齐后既有测试不得回归。
**Commit**：`feat(server): wire template payloads into chains and moments`

---

### T4 — server：聚合视图端点 + 分享页数据

**Owner 文件**：
- Create `apps/server/src/templates/{aggregate.service.ts, aggregate.controller.ts}` + 测试
- Modify `apps/server/src/share/`（公开页响应组装）

**Consumes**：T3 的 moments 列与模板 manifest；spec §3.2、§5。
**Produces**：
- `GET /api/chains/:chainId/aggregate?view=<type>&kind=<key>&field=<key>`——`requireChainRole('viewer')`；按链模板 manifest 中声明的视图取投影，未声明的 view → `BadRequestError('INVALID_AGGREGATE_VIEW')`；剔除软删 moment。投影 shape（spec §3.2）：curve → `[{happened_at, value, unit}]`；map → `[{moment_id, lat, lng, place_name, happened_at}]`；milestone-axis → milestone moments 序列；moodline → 按日心情分布
- `GET /api/public/share/:token` 响应附带链模板 manifest + 各视图投影（只读）

**验收门禁**：server 测试全绿（四种投影正确性、软删剔除、viewer 可读、非成员 404、未声明视图 400）。
**Commit**：`feat(server): add aggregate views and share-page template data`

---

### T5 — web：模板感知 UI

**Owner 文件**：`apps/web/src/` 内（创建链流程、发布面板、链页视图区、分享页），具体路径由实现 agent 按现有目录结构定并在报告列出；**不得动 server/dto**。

**Consumes**：T1 dto 词表与类型；T3/T4 端点；`@moment/api-client` 需同步加模板/聚合方法（属本 Task owner 范围）；六份 web C 端设计规范。
**Produces**：
- 创建链 = 先选模板（卡片选择器，数据来自 `GET /api/templates?scope=official`），确认页明示「模板选定后不可更改」
- **词表通用渲染器**（不是三个模板各写一套）：发布面板按 manifest 渲染 `momentFields`/kinds 入口（emoji-picker/geo/number-unit 等字段组件）；链眉下方按 views 渲染聚合视图入口与页面（curve 用 SVG 手绘即可，不引图表库；**map 默认选型 Leaflet + 栅格 tile，tile URL 走环境变量默认 OSM**——若实现中发现依赖问题，停手上报替代方案）
- 分享只读页渲染 milestone-axis/map/moodline
- baby 模板年龄标注（birthdate + happened_at 前端计算，不落库）

**验收门禁**：`pnpm --filter @moment/web build` + typecheck + lint 通过；手动验收清单（建 baby 链→记里程碑→记身高体重→看曲线与里程碑轴；建 travel 链→带位置发 moment→看地图；建 daily 链→带心情发 moment→看心情线；分享页匿名可见三视图）。
**Commit**：`feat(web): add template-aware creation, composer fields and aggregate views`

---

### T6 — app：模板感知 UI（Expo）

同 T5 的范围与纪律，落在 `apps/app/`；geo 采集用 `expo-location`，地图渲染默认 `react-native-maps`（EAS 可构建；若有依赖障碍停手上报）。遵守 `apps/app/CLAUDE.md`。
**验收门禁**：`pnpm --filter app build`（或该包等效 typecheck/build 命令）+ lint；手动验收清单同 T5。
**Commit**：`feat(app): add template-aware creation, composer fields and aggregate views`

---

### T7 — e2e 与收尾

**Owner 文件**：`apps/server/src/e2e/`（或既有 e2e 布局）、两份 spec 文档头部状态。
- e2e：API 建 user 模板（增量编辑被拒的负例也要）→ 建链 → 发 milestone/metric/带 geo/带 mood 的 moment → 聚合端点断言 → 分享 token 匿名断言 manifest+投影
- 两份 spec 头部「状态」改为「已实现」；spec §8 breaking 清单逐项核对已在 T3 落实
- **最终 DoD**：`pnpm build` 全仓绿、`pnpm --filter @moment/server test` 全绿（报告测试总数）、`pnpm lint` 通过

**Commit**：`test(server): add template system e2e`（docs 状态变更并入此 commit 或单独 `docs:` commit）

---

## 3. 每个 Task 的报告格式（要求 SubAgent 严格遵守）

实现 agent 报告：改动文件清单（必须在 owner 范围内）、接口 Produces 的实际签名、门禁命令原始输出摘要（exit code + 测试数）、越界/存疑点。
复审 agent 报告：阻塞/高危/建议三级问题清单，每条附文件:行号与 spec 依据；无问题也要明说「无阻塞」。
你（编排者）验收后：commit → TaskList 推进 → 向用户一行同步。

## 4. 全部完成后的最终回复

逐 Task：状态、commit hash、测试数、DoD 证据；以及执行中发现的 spec/编排问题清单（供回写 spec）。
