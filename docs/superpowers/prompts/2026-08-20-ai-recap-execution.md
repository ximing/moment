# 执行编排 Prompt：AI 月度回顾

> 用法：把本文件全文粘贴给一个新的支持 SubAgent 的主 Agent（Claude Code / Codex 等）。它是编排者，不是实现者。
> Spec：`docs/superpowers/specs/2026-08-20-ai-recap-design.md`（唯一设计真相源）
> 约定：`docs/superpowers/plans/CONVENTIONS.md`（接口契约 §3 不得改名/改语义）

---

你是时刻 Moment 项目的**编排主 Agent**，负责按本编排执行「AI 月度回顾」的实施。工作目录 `/Users/ximing/project/mygithub/moment`。

## 0. 角色纪律（最高优先级，不可违背）

1. **你只做事：任务边界定义、派发、验收、状态同步、commit。你不写任何实现代码、不亲自修 bug。**
2. 每个 Task 走串行流水线：**实现 SubAgent → 独立复审 SubAgent（≠ 实现者）→ 有阻塞/高危问题派 fixer SubAgent → 你终验 → 你 commit**。一次只跑一个 Task，禁止并行改共享文件。
3. 实现 SubAgent 的输入：**对应 plan 文件（唯一工作内容真相源，见 §2 映射表）** + 本文件中该 Task 的边界摘要 + spec 路径 + CONVENTIONS.md 路径。复审 SubAgent 的输入：git diff + plan + spec + 任务边界，只输出问题清单（按 阻塞/高危/建议 分级）。两者不得是同一会话。
4. 实现/fixer 越界（改了 owner 清单外的文件、改了契约语义）必须停手报告，由你裁决；**任何 SubAgent 都不得自行 commit**，commit 由你在验收通过后执行（conventional commits，每 Task 一个）。
5. plan 文档内嵌的 commit 步骤由你（编排者）在验收后执行；实现/fixer SubAgent 跳过该步并报告待提交文件清单。commit 粒度按 plan 的 Task，可细于本编排的 T1–T7。
6. 每个 "done/pass" 必须有真实证据：门禁命令的 exit code、测试通过数、build 结果。凭 agent 自述不算数。
7. 用 TaskList 维护 T1–T7 状态，每完成一个 Task 向用户同步一行进度。

## 1. 环境事实与全局硬约束

- pnpm 10.22+，Node ≥ 20；先 `pnpm build` 再跑 dev/测试（dto 等依赖包需先构建）。
- ESM NodeNext：TS 相对 import 一律带 `.js` 后缀。
- 测试打 `apps/server/.env` 指向的 MySQL 测试库（`--runInBand`），**严禁生产库**；触库测试文件必须 `afterAll(closeDb)`；`.env` 严禁提交或覆盖。
- 新表必须：建表 → `drizzle-kit generate` → migrate → **扩展 `resetDb()`（按外键依赖逆序 delete）** → 同步 `tests/helpers/fixtures.ts` 夹具。
- 主键 `char(36)` + 应用层 `randomUUID()`；时间列 `timestamp({mode:'date'})`；`created_at` 一律 `defaultNow()`。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码；链内资源路由嵌套 `/api/chains/:chainId/...`；controller 内禁止手写角色判断（用 `ChainPolicy.require` / `requireChainRole`）。
- dto：请求 schema 用 zod、响应用 interface，`packages/dto/src/index.ts` re-export，测试 `tsx --test`。
- web 开发必须遵循 `docs/superpowers/specs/` 下 2026-08-17/18 的六份 C 端设计规范，不另立样式约定。
- **recap 专属硬约束**：
  - LLM_* 环境变量经 `config.ts` zod 校验；`LLM_API_KEY` 空串 = recap 管线整体停用：**sweep 层跳过派发**（不写 outbox 行，spec §3「扫描照常但跳过派发」）；手动 regenerate 在空 key 时走降级（不调 LLM）。
  - recap 不强依赖模板（纯文本 moment 也能跑），但复用 kind/payload 摘要逻辑（T3 消费 templates 的 momentField/kind 定义）。
  - moment 内容出域到第三方 LLM：`.env.example` 显式声明（spec §8）。
  - outbox 类型用点号命名 `recap.generate`（对齐 `moment.created` 等，CONVENTIONS §3.2 范式）；notification 类型 `recap.ready`（对齐 `moment.created`）。
  - handler 内直接 `fanoutNotifications`（对齐既有 `handleMomentCreated` 范式，非 spec §1 描述的「第二条 outbox」——spec §1 是抽象层描述，codebase 既有范式是 handler 内直接 fanout，已注明偏差）。
- **如发现 spec 与本编排矛盾或 spec 有漏洞：停手报告，不得自行发明设计绕过。**

## 2. Task 拆分总览

```
T1 dto Recap 域 → T2 server LLM provider 抽象 → T3 server recaps 表+输入组装+prompt+generate 管线+预算降级
→ T4 server outbox 派发/消费+调度+API+通知扇出+分享页开关 → T5 web → T6 app → T7 e2e+收尾
```

全部串行。T5/T6 无代码依赖仍串行执行（共享 spec 解释权，串行让 T6 复用 T5 的裁决结论）。

**实施计划映射表——每个 Task 的完整实现内容以对应 plan 文件为唯一真相源**：

| Task | Plan 文件 | 状态 |
|---|---|---|
| T1 | `docs/superpowers/plans/2026-08-20-ai-recap-p1-dto.md` | ✅ 已起草并评审通过 |
| T2 | `docs/superpowers/plans/2026-08-20-ai-recap-p2-server-llm.md` | ✅ 已起草并评审通过 |
| T3 | `docs/superpowers/plans/2026-08-20-ai-recap-p3-server-pipeline.md` | ✅ 已起草并评审通过 |
| T4 | `docs/superpowers/plans/2026-08-20-ai-recap-p4-server-dispatch.md` | ✅ 已起草并评审通过 |
| T5 | `docs/superpowers/plans/2026-08-20-ai-recap-p5-web.md` | ✅ 已起草并评审通过 |
| T6 | `docs/superpowers/plans/2026-08-20-ai-recap-p6-app.md` | ✅ 已起草并评审通过 |
| T7 | `docs/superpowers/plans/2026-08-20-ai-recap-p7-e2e.md` | ✅ 已起草并评审通过 |

> 注：T1–T7 的完整 plan 文件已全部起草并经独立复审 + fixer 修复（2026-08-21）。每个 Task 的实现内容以对应 plan 文件为唯一真相源；本编排的 T 节用于你（编排者）把握边界与验收。

实现 SubAgent 的输入 = 对应 plan 文件（逐 Task 逐步执行，含完整代码）+ spec + CONVENTIONS.md；本编排的 T 节用于你（编排者）把握边界与验收。

---

### T1 — dto：Recap 域类型与 period 校验

**Owner 文件**：
- Create `packages/dto/src/recaps.ts`、`packages/dto/src/recaps.test.ts`（单文件布局：dto「每业务域一文件」约定 + 测试 glob 只匹配 `src/*.test.ts`）
- Modify `packages/dto/src/index.ts`（re-export）

**Consumes**：spec §2（recaps 表列）、§6（API）。
**Produces**（后续 Task 引用的精确符号，不得改名）：
- `RECAP_STATUSES`（`['generating','ready','failed','degraded'] as const`）+ `type RecapStatus` + `recapStatusSchema`
- `periodSchema`（zod：`/^\d{4}-(0[1-9]|1[0-2])$/`，char(7) YYYY-MM）+ `type Period = string`
- `interface RecapTokenUsage`：`{ prompt: number; completion: number; total: number }`
- `interface RecapDto`：`{ id: string; chainId: string; period: Period; status: RecapStatus; content: string; highlights: string[]; model: string | null; promptVersion: number; tokenUsage: RecapTokenUsage | null; error: string | null; generatedAt: string | null; createdAt: string; updatedAt: string }`
- `interface RecapListResponse`：`{ recaps: RecapDto[] }`（period 倒序，无分页——每链每月至多一条）
- `type PublicShareRecap = RecapDto`（分享页外发，字段集与 RecapDto 一致，直接复用）

**Spec 偏差**：spec §4 写 `highlight_moment_ids: number[]`，但 moments.id 是 `char(36)` UUID，故 `highlights` 类型为 `string[]`。这是 spec 笔误的机械修正，非设计发明。

**验收门禁**：`pnpm --filter @moment/dto test` 全绿、`pnpm --filter @moment/dto build` exit 0、lint 通过。
**Commit**：`feat(dto): add recap domain types and period validation`

---

### T2 — server：LLM provider 抽象层 + config

**Owner 文件**：
- Create `apps/server/src/llm/base.provider.ts`、`apps/server/src/llm/openai-compat.provider.ts`、`apps/server/src/llm/factory.ts`
- Create `apps/server/tests/llm/config.test.ts`、`provider.test.ts`、`factory.test.ts`
- Modify `apps/server/src/config.ts`（加 LLM_* env）、`apps/server/.env.example`

**Consumes**：spec §3。
**Produces**：
- `interface LLMProvider { chat(req: LLMChatRequest): Promise<LLMChatResponse> }`（`base.provider.ts` 定义）
- `interface LLMChatRequest`（`base.provider.ts` 定义，`LLMProvider.chat` 入参：`{ messages: { role: 'system'|'user'; content: string }[]; maxTokens?: number; temperature?: number }`，T3 generate 消费）
- `interface LLMChatResponse`（`base.provider.ts` 定义，`LLMProvider.chat` 出参：`{ content: string; model: string; usage: { prompt: number; completion: number; total: number } }`，T3 generate 消费，`usage` 透传到 `recaps.token_usage`）
- `class OpenAICompatProvider implements LLMProvider`：POST `{LLM_BASE_URL}/chat/completions`，Bearer `LLM_API_KEY`，body `{ model, messages, max_tokens?, temperature? }`；超时 60s（AbortController）；错误分类——`RetryableLLMError`（429/5xx/网络/超时）、`NonRetryableLLMError`（4xx 其他，携带 `statusCode: number`）。从响应取 `choices[0].message.content`、`model`、`usage.{prompt_tokens,completion_tokens,total_tokens}`。
- `getLLMProvider(): LLMProvider | null`：factory 单例；`LLM_API_KEY` 为空 → 返回 null（recap 管线整体停用，扫描照常但跳过派发）。
- `setLLMProvider(p: LLMProvider | null | undefined): void`：测试注入点，与 `push/factory.ts` 的 `setPushService` 同范式；传 `undefined` 重置回真实 config 行为，`null`/provider 为注入值；严禁业务代码使用。
- config 新增（zod）：`LLM_BASE_URL`（url，default `https://api.deepseek.com/v1`）、`LLM_API_KEY`（string，default `''`）、`LLM_MODEL`（string，default `deepseek-chat`）、`LLM_MONTHLY_TOKEN_BUDGET`（coerce number int min 0，default 0=不限）、`LLM_RECAP_TZ`（string，default `Asia/Shanghai`）、`LLM_RECAP_MAX_MOMENTS`（coerce number int min 1，default 100）、`LLM_RECAP_MAX_CHARS`（coerce number int min 1，default 8000）。
- `export const envSchema`：config 模块新增导出的 zod schema 本体，供测试边界校验直接复用真实 schema 而非同构副本（与 `config` 同文件导出）。
- `.env.example` 同步加（LLM_API_KEY 留空 + 注释「空 = recap 停用」+ 隐私声明「moment 内容出域到第三方 LLM」）。
- 错误类 `RetryableLLMError`/`NonRetryableLLMError`（都 `extends Error`，供 T4 outbox handler 判断是否重试；`NonRetryableLLMError` 携带 `statusCode: number`）。

**验收门禁**：`pnpm --filter @moment/server test`（provider 重试分类单测：mock 429/500/400/401/超时/空 key→factory null；factory 三态注入点 `setLLMProvider` 覆盖 mock/null/重置回落）全绿；config 测试覆盖真实 `config` 默认值（7 字段）与 `envSchema` 边界拒绝（非 URL/负数/<1/coerce）；typecheck+lint 通过。
**Commit**：`feat(server): add LLM provider abstraction with OpenAI-compatible implementation`

---

### T3 — server：recaps 表 + 输入组装 + prompt + generate 管线 + 预算降级

**Owner 文件**：
- Create `apps/server/src/db/schema/recaps.ts`、`apps/server/src/llm/recap/{input.ts,prompt.ts,generate.ts}` + 测试
- Modify `apps/server/src/db/schema.ts`（barrel）、`apps/server/tests/helpers/db.ts`（resetDb 加 recaps，在 chains 之前删——FK 逆序）、`apps/server/tests/helpers/fixtures.ts`（insertRecap）
- 迁移 `apps/server/drizzle/0011_*.sql`（CREATE TABLE recaps + UNIQUE(chain_id,period) + FK ON DELETE CASCADE）

**Consumes**：T2 `LLMProvider` / `getLLMProvider` / `RetryableLLMError` / `NonRetryableLLMError`；T1 `RecapDto` / `RecapStatus` / `periodSchema`；spec §2、§4、§5。
**Produces**：
- `recaps` 表（spec §2 全列：id char36 pk、chain_id char36 FK→chains ON DELETE CASCADE、period char(7)、status enum(generating/ready/failed/degraded)、content text、highlights json（string[]）、model varchar null、prompt_version int、token_usage json null、error text null、generated_at/created_at/updated_at；UNIQUE(chain_id,period)）。
- `buildRecapInput(chainId, period, opts?: { maxMoments?: number; maxChars?: number }): Promise<RecapInput>`（spec §4）：取该链 wall_date 落 period 内的未软删 moments（happened_at 正序）；每条序列化 `[MM-DD HH:mm] {昵称}` + 正文 + kind 标记 + payload 摘要（milestone→【里程碑】{label}；metric→【记录】{metric} {value}{unit}；mood→【心情】{emoji}；geo→【位置】{place_name}；standard→无标记）；精选评论每 moment ≤2 条 ≤100 字；截断护栏（超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取；超 MAX_CHARS 二次截断；截断时在 prompt 声明条数）；baby 模板注入 birthdate 换算月龄；`mediaRefs` 恒为 `[]`（v1 视觉预留）。`opts.maxMoments/maxChars` 是测试注入点（config 在 import 时已 parse，无法用 process.env 覆盖；生产路径 generateRecap 调用时不传，回落 config）。`RecapInput` 类型含 `moments: SerializedMoment[]; period; chainName; babyAge?: string; mediaRefs: []; truncated: { moments: boolean; chars: boolean; count: number }`。（milestone→【里程碑】{label}；metric→【记录】{metric} {value}{unit}；mood→【心情】{emoji}；geo→【位置】{place_name}；standard→无标记）；精选评论每 moment ≤2 条 ≤100 字；截断护栏（超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取；超 MAX_CHARS 二次截断；截断时在 prompt 声明条数）；baby 模板注入 birthdate 换算月龄；`mediaRefs` 恒为 `[]`（v1 视觉预留）。`RecapInput` 类型含 `moments: SerializedMoment[]; period; chainName; babyAge?: string; mediaRefs: []; truncated: { moments: boolean; chars: boolean; count: number }`。
- `PROMPT_VERSION`（=1）、`buildSystemPrompt()`（要求返回 JSON `{content: markdown, highlight_moment_ids: string[]}`）、`buildUserPrompt(input)`。
- `generateRecap(chainId, period, opts?: { provider?: LLMProvider | null; budgetOverride?: number }): Promise<void>`：①查**当前运行月**全局 token 消耗（SUM token_usage.total 按 generated_at 当月聚合，spec §5「当月」= 当前运行月，非 period 月——sweep 在 8 月生成 7 月回顾时查 8 月已消耗 token）超 budget（`opts.budgetOverride ?? LLM_MONTHLY_TOKEN_BUDGET`，>0 时；`budgetOverride` 是测试注入点，config import 时 parse 无法 env 覆盖）→ 走降级路径（`buildDegradedContent(input)` 规则文案「本月记录 N 条，里程碑：…」+ 标注非 AI 生成，status=degraded，不调 provider）；②否则 build input → provider.chat（`NonRetryableLLMError` 在此 catch 落 failed 行正常返回不 rethrow，与 parse 失败同范式；`RetryableLLMError` 传播给 handler 走 processor 退避）→ 解析 JSON（失败重试一次，再失败 status=failed 落 error 摘要）；③`highlight_moment_ids` 过滤掉不属于该链该月的 id（幻觉防线）；④upsert recaps 行（ON CONFLICT chain_id,period 更新 content/highlights/status/model/promptVersion/tokenUsage/error/generatedAt，保留 created_at）；provider 为 null → 直接降级路径。

**Spec 偏差**：`highlight_moment_ids` 过滤后类型为 `string[]`（spec §4 写 `number[]`，moments.id 是 char36 UUID）。

**验收门禁**：server 测试全绿（输入组装截断/payload 摘要/幻觉 id 过滤/解析重试/预算降级/重生成 upsert 覆盖，全程 mock provider 注入）；resetDb 扩展后既有测试不回归。
**Commit**：`feat(server): add recap generation pipeline with budget guard`

> ⚠️ T3 起草注意：T1 `RecapTokenUsage` 与 T2 `LLMChatResponse.usage` shape 相同（`{prompt, completion, total}`），generate 应直接透传 LLM 响应 `usage` 到 `recaps.token_usage`，不重新发明字段名。

---

### T4 — server：outbox 派发/消费 + 调度 + API + 通知扇出 + 分享页开关

**Owner 文件**：
- Modify `apps/server/src/outbox/types.ts`（加 `OUTBOX_RECAP_GENERATE = 'recap.generate'` + 联合）、`apps/server/src/worker/handlers.ts`（handleRecapGenerate）、`apps/server/src/worker/index.ts`（接调度）、`apps/server/src/notifications/types.ts`（加 `NOTIFICATION_RECAP_READY = 'recap.ready'` + 联合）、`apps/server/src/db/schema/chains.ts`（加 `share_recaps_enabled`）、`apps/server/src/share/share-link.service.ts`（附加最近 ready/degraded recap）、`packages/dto/src/share.ts`（PublicShareResponse 加 `recap?: RecapDto`）、`apps/server/src/app.ts`（注册 RecapController）
- Create `apps/server/src/worker/recap-scheduler.ts`、`apps/server/src/recaps/recap.controller.ts` + `recap.service.ts` + 测试
- 迁移 `apps/server/drizzle/0012_*.sql`（ADD COLUMN chains.share_recaps_enabled boolean NOT NULL DEFAULT true）

**Consumes**：T2 factory、T3 `generateRecap`；T1 `RecapDto` / `periodSchema` / `RecapListResponse`；spec §1、§6、§5。
**Produces**：
- outbox `recap.generate`（payload `{chainId, period}`）；handler `handleRecapGenerate`：调 `generateRecap(chainId, period, { provider })`（provider = `getLLMProvider()`，可能为 null → generateRecap 走降级路径 status=degraded，spec §5：降级回顾同样推送；null provider 仅手动 regenerate 边缘 case 到达——sweep 已在空 key 时 skip 派发（spec §3），handler 正常不会收到 null；null→generateRecap 降级+扇出）；重试分类由 generateRecap 内部处理（NonRetryableLLMError 落 failed 行正常返回不 rethrow；RetryableLLMError 传播给 processor 退避）；成功且 status∈{ready,degraded} → 直接调 `fanoutNotifications(deps, {userIds: 链全体成员, type: NOTIFICATION_RECAP_READY, payload: {chainId, period, chainName, title, body, data:{chainId,period}}, push: true})`（复用既有 handler→fanout 范式，非「第二条 outbox」——spec §1 的描述是抽象层，codebase 既有范式是 handler 内直接 fanout，对齐之并注明偏差）。
- `runRecapSweep(now): Promise<{dispatched: number}>`（spec §1）：判断当前是否为生成窗口（LLM_RECAP_TZ 下每月 1 号；每小时检查一次由 worker 调度）；空 key（`getLLMProvider()==null`）时 skip 派发（不查活动链、不写 outbox 行，spec §3「扫描照常但跳过派发」）；否则找出「上月有活动」（上月存在未软删 moment）的链，对尚无该 period recap 行的链幂等写 `recap.generate` outbox 行（payload 唯一性检查去重）。worker/index.ts 接一个独立小时级 interval 调 `runRecapSweep`。
- recap controller（spec §6）：`GET /chains/:chainId/recaps`（requireChainRole('viewer')，period 倒序）、`GET /chains/:chainId/recaps/:period`（period zod 校验→非法 `INVALID_PERIOD`）、`POST /chains/:chainId/recaps/:period/regenerate`（requireChainRole('editor')，period 必须该月有记录否则 `RECAP_PERIOD_INACTIVE`，每日每链限 3 次 `RECAP_REGENERATE_LIMIT`，事务内写 recap.generate outbox）。
- chains 加列 `share_recaps_enabled boolean NOT NULL DEFAULT true`；ShareLinkService.getSharedChain 在 `share_recaps_enabled` 时附最近一期 ready/degraded recap（generating/failed 不外发）。
- 错误码：`INVALID_PERIOD` / `RECAP_REGENERATE_LIMIT` / `RECAP_PERIOD_INACTIVE` / `RECAP_NOT_FOUND`（GET 单条 period 不存在时 404，与 `CHAIN_NOT_FOUND` 同范式）。

**Spec 偏差**：handler 内直接 fanout（非 spec §1 的「第二条 outbox」），对齐既有 `handleMomentCreated` 范式。

**验收门禁**：server 测试全绿（派发幂等/重生成 upsert/recap_ready 扇出/viewer 可读/非成员 403/分享开关关闭不外发/period 校验/重生成限流）。
**Commit**：`feat(server): add recap dispatch, scheduling, API and share toggle`

> ⚠️ T4 起草时定夺：分享页是否含 degraded。spec §6 字面仅 ready，但 §5 降级回顾「同样推送」。建议含 degraded 并在 T7 回写 spec §6 注明；若不含则改回仅 ready 对齐 §6。

---

### T5 — web：recap UI + api-client

**Owner 文件**：`apps/web/src/`（入口条、recap 页、高光跳转、分享页展示）+ `packages/api-client/src/`（recap 方法）。遵守六份 web C 端设计规范。

**Consumes**：T1 dto RecapDto/RecapListResponse；T4 端点 `GET /chains/:chainId/recaps`、`GET /chains/:chainId/recaps/:period`、分享页 `recap` 字段。
**Produces**：
- 时间线顶部入口条：存在最近一期 ready/degraded 回顾时渲染（与那年今日入口条同模式），点击进入链内 recap 页。
- recap 页：Markdown 正文 + 「高光时刻」区（highlights 引用的 moments 卡片，点击跳转详情）。
- 分享页只读展示 recap。
- `@moment/api-client` 加 recap 方法（listRecaps / getRecap / 分享页已含 recap 字段）。

**验收门禁**：`pnpm --filter @moment/web build` + typecheck + lint 通过；手动验收清单。
**Commit**：`feat(web): add recap entry bar, recap page and share-page display`

---

### T6 — app：recap UI（Expo）

**Owner 文件**：`apps/app/src/`，遵守 `apps/app/CLAUDE.md`。同 T5 范围。

**Consumes**：同 T5。
**Produces**：同 T5 落 app 端。
**验收门禁**：`pnpm --filter app build`（或等效 typecheck/build）+ lint；手动验收清单同 T5。
**Commit**：`feat(app): add recap entry bar, recap page and share-page display`

---

### T7 — e2e + 收尾

**Owner 文件**：`apps/server/tests/recaps/` e2e + 回写 `docs/superpowers/specs/2026-08-20-ai-recap-design.md` 头部状态为「已实现」。

**Consumes**：T1–T6 全部。
**Produces**：
- e2e：造数据 → 手动触发派发 → 断言落库与通知扇出。
- 回写 ai-recap spec 头部状态为「已实现」。
- **最终 DoD**：`pnpm build` 全绿、`pnpm --filter @moment/server test` 全绿（报告测试总数）、`pnpm lint` 通过。

**Commit**：`test(server): add recap e2e and mark spec implemented`

---

## 3. 每个 Task 的报告格式（要求 SubAgent 严格遵守）

实现 agent 报告：改动文件清单（必须在 owner 范围内）、接口 Produces 的实际签名、门禁命令原始输出摘要（exit code + 测试数）、越界/存疑点。
复审 agent 报告：阻塞/高危/建议三级问题清单，每条附文件:行号与 spec 依据；无问题也要明说「无阻塞」。
你（编排者）验收后：commit → TaskList 推进 → 向用户一行同步。

## 4. 全部完成后的最终回复

逐 Task：状态、commit hash、测试数、DoD 证据；以及执行中发现的 spec/编排问题清单（供回写 spec）。
