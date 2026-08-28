# 执行编排 Prompt：时刻人物与地点元数据（M1）

> 用法：把本文件全文粘贴给一个新的支持 SubAgent 的主 Agent（Claude Code / Codex 等）。它是编排者，不是实现者。
> Spec：`docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（唯一设计真相源）
> 约定：`docs/superpowers/plans/CONVENTIONS.md`（接口契约 §3 不得改名/改语义）

---

你是时刻 Moment 项目的**编排主 Agent**，负责按本编排执行「时刻人物与地点元数据（M1）」的实施。工作目录 `/Users/ximing/project/mygithub/moment`。

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
- 测试打 `apps/server/.env` 指向的 MySQL 测试库（`--runInBand`），**严禁生产库**；测试库是远程共享 MySQL，**禁止两个 jest 会话并行**，连接可能瞬时 ECONNRESET（重试即可）；触库测试文件必须 `afterAll(closeDb)`；`.env` 严禁提交或覆盖。
- supertest 的 server 必须显式绑 `127.0.0.1`（本机 Dumbo.app 会劫持 :: 上的 127.0.0.1 流量）。
- 新表必须：建表 → `drizzle-kit generate` → migrate → **扩展 `resetDb()`（按外键依赖逆序 delete）** → 同步 `tests/helpers/fixtures.ts` 夹具。
- 主键 `char(36)` + 应用层 `randomUUID()`；时间列 `timestamp({mode:'date'})`；`created_at` 一律 `defaultNow()`。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码；链内资源路由嵌套 `/api/chains/:chainId/...`；controller 内禁止手写角色判断（用 `ChainPolicy.require` / `requireChainRole`）。
- dto：请求 schema 用 zod、响应用 interface，`packages/dto/src/index.ts` re-export，测试 `tsx --test`（glob 只匹配 `src/*.test.ts`，单文件布局）。
- web 开发必须遵循 `docs/superpowers/specs/` 下 2026-08-17/18 的六份 C 端设计规范，不另立样式约定；横切规则 `.claude/rules/web-ui.md`。
- **M1 专属硬约束**（全部出自 spec，违一条即验收失败）：
  - **source 只能 server 赋值**：客户端请求不含 source 字段；赋值表：坐标+名字→manual、仅坐标→exif、仅名字→manual、null→清空（spec §6）。
  - **客户端提交纪律（dirty tracking）**：`personIds`/`place` 仅用户实际修改才提交（undefined=不变；place:null=显式清除）；tagIds 保持全量提交不动。server 端 PATCH 语义本身不变。
  - **`includePrivate` 默认 false**：`serializeMoments` 加该选项；链内路径（feed/时间线/详情）显式传 `true`；share-album 路径不传。隐私红线：share-album 输出零 persons/place，双路测试钉死。
  - **EXIF 只在前端解码**：web 用 `file.slice` + exifreader（动态 import）；app 用 expo-image-picker `exif:true`（兼容 iOS `{GPS}` 嵌套与 Android 扁平键）。**服务端永不读 S3 对象字节做 EXIF**。
  - **坐标系**：DB 落 WGS-84 原值；调高德 regeo 前必须 WGS-84→GCJ-02 换算（`src/geocode/gcj02.ts` 纯函数，境外不偏移直接请求）。
  - **AMAP_WEB_KEY** 经 `config.ts` zod + `.env.example`；空 key → geocode provider null → outbox 消费即跳过（坐标照存、place_name 留空），管线不阻断。
  - **LLM_API_KEY 空** → AI 抽取消费即跳过、不写 `ai_extract_hash`（复用 `getLLMProvider()` 三态 null 语义）。
  - **优先级 manual > exif > ai**：AI 人物仅补缺（manual 行不降级）；AI 地点仅在 place 三列全空时填文本名。
  - **幂等**：`ai_extract_hash = sha256(content + '\0' + transcript)`，hash 未变不重抽；voice 时刻 transcript 由 transcribe handler 异步回填，**回填成功同事务必须写 `moment.extract` outbox 行**（spec §5）。
  - **worker 软删竞态**：geocode/extract 消费时重读时刻，不存在或已软删即跳过。
  - outbox 类型点号命名：`moment.geocode` / `moment.extract`，常量集中在 `src/outbox/types.ts`。
  - 链删除 tx（`chain.service.ts` 删除流程）必须补 `moment_persons`、`persons` 两行 delete（FK 不加 onDelete，镜像 tags 范式）。
  - **如发现 spec 与本编排矛盾或 spec 有漏洞：停手报告，不得自行发明设计绕过。**

## 2. Task 拆分总览

```
T1 dto + server schema + 迁移 → T2 server persons CRUD + moments 集成（含 includePrivate）
→ T3 geocode 模块 + worker → T4 AI 抽取管线 + 回填 sweep
→ T5 api-client + web → T6 app → T7 e2e + 收尾
```

全部串行。T5/T6 无代码依赖仍串行执行（共享 spec 解释权，串行让 T6 复用 T5 的裁决结论）。T3/T4 依赖 T2 的 moments 写路径（outbox 发射点），不得提前。

**实施计划映射表——每个 Task 的完整实现内容以对应 plan 文件为唯一真相源**：

| Task | Plan 文件 | 状态 |
|---|---|---|
| T1 | `docs/superpowers/plans/2026-08-28-people-place-p1-dto-schema.md` | ✅ 已起草并评审通过 |
| T2 | `docs/superpowers/plans/2026-08-28-people-place-p2-server-persons.md` | ✅ 已起草并评审通过 |
| T3 | `docs/superpowers/plans/2026-08-28-people-place-p3-server-geocode.md` | ✅ 已起草并评审通过 |
| T4 | `docs/superpowers/plans/2026-08-28-people-place-p4-server-extract.md` | ✅ 已起草并评审通过 |
| T5 | `docs/superpowers/plans/2026-08-28-people-place-p5-web.md` | ⬜ 待起草 |
| T6 | `docs/superpowers/plans/2026-08-28-people-place-p6-app.md` | ⬜ 待起草 |
| T7 | `docs/superpowers/plans/2026-08-28-people-place-p7-e2e.md` | ⬜ 待起草 |

> Plan 起草流水线：每期 plan 由独立 SubAgent 起草（输入 = spec + CONVENTIONS.md + 本文件 T 节边界 + 相关源码），再由 ≠ 起草者的复审 SubAgent 对 spec/代码核实，fixer 修复后状态置 ✅。执行阶段本表状态改为「✅ 已实施」。

---

### T1 — dto persons 域 + moments dto 增量 + server schema 两表五列 + 迁移

**Owner 文件**：
- Create `packages/dto/src/persons.ts`、`packages/dto/src/persons.test.ts`
- Modify `packages/dto/src/moments.ts`（personIds/place schema + MomentResponse 增字段）、`packages/dto/src/moments.test.ts`、`packages/dto/src/index.ts`
- Create `apps/server/src/db/schema/persons.ts`、`apps/server/src/db/schema/moment-persons.ts`
- Modify `apps/server/src/db/schema/moments.ts`（五列）、`apps/server/src/db/schema.ts`（barrel）、`apps/server/tests/helpers/db.ts`（resetDb 逆序扩展）、`apps/server/tests/helpers/fixtures.ts`（夹具同步）
- 迁移：`apps/server/drizzle/`（drizzle-kit generate，禁手写 SQL）

**边界**：dto 只放 schema 与纯类型（`packages/dto/CLAUDE.md`）。place zod：name 可选(1..255)、lat/lng 同有同无且 name 与坐标至少其一（refine）。personIds：`z.array(z.string().uuid()).max(20)`。PersonBrief `{id,name,userId,source}`（moment 上下文）；词典响应 `{id,name,userId}`。moments 五列：place_lat/place_lng decimal(10,7)、place_name varchar(255)、place_source enum(manual,exif,ai)、ai_extract_hash char(64)，全可空。索引仅 `uk_persons_chain_name` 与 `idx_moment_persons_person_moment`。

**出口标准（DoD）**：`pnpm --filter @moment/dto test` 绿；`pnpm --filter @moment/server migrate` 在测试库通过；server 触库冒烟（建表后 resetDb 可用）绿。

### T2 — server persons CRUD + moments personIds/place 写读 + 序列化 includePrivate

**Owner 文件**：
- Create `apps/server/src/persons/`（controller/service/repository，模块范式对齐 tags）
- Modify `apps/server/src/moments/moment.service.ts`（create/update 集成）、`apps/server/src/moments/moment-serializer.ts`（includePrivate + persons/place 批取）、feed/share 相关调用方、`apps/server/src/chains/chain.service.ts`（删除 tx 补两行）
- Test：`apps/server/tests/` 下对应测试

**边界**：路由 `/api/chains/:chainId/persons*`（GET/POST/PATCH/DELETE），权限走 requireChainRole（读 viewer、写 editor）。POST 幂等（名归一化撞 uk 返回已存在行）。PATCH 改名撞名 409 `PERSON_NAME_CONFLICT`。DELETE = 先删 moment_persons 关联再删词典行。moments create/update：personIds 属链校验（400 `PERSON_NOT_IN_CHAIN`）、PATCH 全量替换（提交集合写 manual、集合外删除）、place 赋值表 + geocode outbox 触发（仅坐标且 place_name 空时同事务写 `moment.geocode`）。序列化批取防 N+1。

**DoD**：server 测试全绿（含 includePrivate 双路红线测试）；`pnpm --filter @moment/server test` 无回归。

### T3 — geocode 模块 + gcj02 + worker

**Owner 文件**：
- Create `apps/server/src/geocode/`（base.provider.ts / factory.ts / amap.provider.ts / gcj02.ts）
- Modify `apps/server/src/config.ts`（AMAP_WEB_KEY）、`apps/server/.env.example`、`apps/server/src/outbox/types.ts`、`apps/server/src/worker/handlers.ts`
- Test：对应测试

**边界**：factory 三态单例 + `setGeocodeProvider` 测试注入，**逐字复刻 `llm/factory.ts` 范式**。`reverse(lat,lng): Promise<string|null>`，入参 WGS-84，内部先转 GCJ-02 再调高德（`location=lng,lat`，取 `regeocode.formatted_address`）。handler：重读时刻（软删跳过）→ provider null 跳过 → 成功回填 place_name；终败仅记日志不重派。

**DoD**：mock provider 测试全绿（回填/空 key 跳过/软删跳过/终败）；gcj02 纯函数用例（境内偏移/境外不偏移）。

### T4 — AI 抽取管线 + 回填 sweep

**Owner 文件**：
- Create `apps/server/src/llm/extract/`（prompt.ts / extract.ts，范式对齐 `llm/recap/`）
- Modify `apps/server/src/moments/moment.service.ts`（hash 判据 + outbox 发射）、`apps/server/src/worker/handlers.ts`（moment.extract handler + transcribe 回填处补发射）、`apps/server/src/outbox/types.ts`
- Create 回填 sweep 脚本（package.json `backfill:extract`）
- Test：对应测试

**边界**：hash = sha256(content + '\0' + transcript)；hash 未变不重抽。抽取输入各截断 2000 字符。输出 `{persons:string[], places:string[]}`；人物归一化 upsert 链词典（仅补缺、manual 不降级）；place 仅三列全空时填 places[0]（source=ai）。LLM_API_KEY 空 → 消费即跳过不写 hash。sweep 扫描 `ai_extract_hash IS NULL AND deleted_at IS NULL AND (content<>'' OR transcript IS NOT NULL)` 分批写 outbox，空 key 直接退出，二跑幂等。

**DoD**：mock LLM 测试全绿（upsert/仅补缺/不降级/不覆盖/hash 幂等/transcribe 触发/软删跳过）；sweep 在测试库二跑幂等。

### T5 — api-client + web 编辑器 + 卡片展示

**Owner 文件**：
- Modify `packages/api-client/`（persons 资源 + moments 增量，精确文件由 plan 钉）
- Modify `apps/web/src/compose/`（人物选择器 + 地点 + EXIF chip + dirty tracking）、时刻卡片/详情展示组件
- 遵循六份 C 端设计规范 + `.claude/rules/web-ui.md`

**边界**：EXIF 解析只在 compose 流程动态 import exifreader（`file.slice(0, 256*1024)`），失败静默；多图取第一张含 GPS 的；编辑器展示"已从照片读取位置"chip 可移除。人物选择器：链成员置顶 + 词典搜索 + 自由文本回车新建（幂等 POST）；AI chip 带来源标识。personIds/place 判脏提交（undefined=不变）。卡片展示只读，不可点击过滤（M2 的事）。

**DoD**：typecheck/build/lint 绿 + 手测清单过 + 组件测试按 web 端既有范式。

### T6 — app 编辑器 + 原生 EXIF + 卡片展示

**Owner 文件**：
- Modify `apps/app/app/compose.tsx` 及其 service 层、时刻展示组件
- EXIF 解析工具 + fixture 测试

**边界**：expo-image-picker `exif:true`；解析兼容 iOS `{GPS}` 嵌套与 Android 扁平键，**先写 fixture 测试验证两条解析路径再真机确认**。编辑器 UX 对齐 T5（人物选择器/地点/EXIF chip/判脏提交）。

**DoD**：typecheck/build 绿 + fixture 测试绿 + 真机/模拟器手测清单过。

### T7 — e2e + 收尾

**Owner 文件**：
- `apps/server/src/e2e/`（fixture-seeder/fixture-rows 扩展）+ e2e 场景
- 回填 sweep 测试库演练记录

**边界**：全链路：建时刻带人物+坐标 → 响应回读 → geocode mock 回填 → AI mock 补缺 → feed/详情/share-album 三路径序列化断言（share 无 persons/place）。sweep 二跑幂等演练。

**DoD**：e2e 全绿；`pnpm test` 全仓绿；`pnpm lint` / `pnpm build` 绿。
