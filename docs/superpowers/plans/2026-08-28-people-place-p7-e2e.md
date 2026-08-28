# 时刻人物与地点 P7：e2e 全链路 + 回填 sweep 演练 + 收尾 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用全链路测试钉死「时刻人物与地点」（M1）的完整闭环（spec §9 e2e 条目 + §11 P7 出口标准）：HTTP 建时刻带 personIds + 坐标 → 响应回读（source 只由 server 赋值）→ mock geocode provider 经 `runOutboxBatch` 真实分发回填 `place_name` → mock LLM 抽取仅补缺（manual 不降级、place 全空才填文本名）→ feed / 链时间线 / 详情三路径含完整 persons/place，share-album **零 persons/place 键**（§8 隐私红线，键级断言）；voice 时刻 transcribe → extract 全链路（转写回填 → 同事务补发 → 消费落库 + hash 幂等）；回填 sweep 在测试库演练（mock LLM 消费 → 二跑幂等 + 真实 CLI 双跑）；`src/e2e/` 视觉回归 fixture 扩展 persons/place 确定性行；最后全仓门禁（`pnpm test` / `pnpm lint` / `pnpm build`）与收尾验收清单。

**Architecture:** e2e 场景沿 **recap P7 先例**（`docs/superpowers/plans/2026-08-20-ai-recap-p7-e2e.md`）：Jest + supertest + 真实测试库（`.env`），落 `apps/server/tests/people-place/`（jest `roots: ['<rootDir>/tests']` 自动纳入，与单测同一 jest run `--runInBand` 串行——**零并行冲突**，这正是「测试库禁两个 jest 会话并行」的既有解法）；HTTP 请求打 `tests/helpers/fixtures.ts` 的模块级 `app`（`listenLocal` 显式绑 127.0.0.1，规避 Dumbo 端口劫持 flake）；outbox 消费**不起新 worker 进程**，直接 `runOutboxBatch({ push: mockPush })` 驱动默认 handlers 注册表（`moment.created` / `moment.geocode` / `moment.transcribe` / `moment.extract` 全部真实分发，`moment.created` 的通知扇出一并被 mockPush 吸收）；远端依赖全 mock 注入——`setGeocodeProvider`（P3 范式）、`setLLMProvider`（既有三态）、`setASRProvider` + `globalThis.fetch` + `installMockStorage`（voice 转写链路，对齐 `tests/moments/create-voice-moment.test.ts` 的 readyMedia 造数与 P4 `handle-moment-extract.test.ts` 的 fetch/ASR mock 范式）。`apps/server/src/e2e/` 是**设计系统视觉回归的 fixture CLI**（`MOMENT_E2E` 守卫 + 专用一次性 `moment_e2e` 库 + 本地 MinIO），不是 jest 测试框架——本计划在该目录只做 fixture 行扩展（Task 1），HTTP e2e 场景一律不进该目录（见偏差 1）。

**Tech Stack:** Jest 29 + supertest 7（真实 MySQL 测试库，`--runInBand`、`afterAll(closeDb)`、`beforeEach(resetDb)`）/ node:test（`src/e2e/fixture-rows.test.ts` 纯行工厂测试，`node --loader ts-node/esm --test` 手动跑——先例 `2026-08-18-web-design-system-refactor.md` Task 14，不进 jest roots 也不进 turbo test，P7 沿用该跑法）/ tsx（`backfill:extract` CLI，P4 落地）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§1 数据流、§5 AI 文本抽取（voice 独立触发 / 回填 sweep）、§6 API（响应回读）、§8 隐私红线、§9 测试策略 e2e 条目、§11 P7 出口标准）

**上游契约（P1–P6 全部已评审定稿，Consumes 逐字引用）：**
- P1 `2026-08-28-people-place-p1-dto-schema.md`：schema 两表五列 + fixtures
- P2 `2026-08-28-people-place-p2-server-persons.md`：persons API + moments personIds/place 写读 + `includePrivate` 序列化
- P3 `2026-08-28-people-place-p3-server-geocode.md`：geocode 模块 + worker handler
- P4 `2026-08-28-people-place-p4-server-extract.md`：AI 抽取管线 + 回填 sweep
- P5/P6（web/app）：本计划不触客户端代码，仅在收尾门禁做 typecheck/build 联动（`pnpm build` / `pnpm test` 全仓覆盖）
- 执行编排 `docs/superpowers/prompts/2026-08-28-people-place-execution.md` T7 节 + §1 M1 专属硬约束

## Global Constraints（只写本计划新增，通用约束继承编排 §1）

- **e2e 场景落 `apps/server/tests/people-place/`，不落 `src/e2e/`**（偏差 1）：`src/e2e/` 是视觉回归 fixture CLI（`MOMENT_E2E=1` 守卫、`MYSQL_DATABASE` 必须整串 `moment_e2e`、本地 MinIO 桶），jest 测试混入会破坏其「干净 shell / env -i」约束与守卫语义；recap P7 已确立 `tests/<domain>/*-e2e.test.ts` 先例。
- **同一 jest run 串行**：两个 e2e 文件与全部单测同在 `pnpm --filter @moment/server test`（`--runInBand`）内串行执行，**不另起第二个 jest 会话**（远程共享测试库禁并行；瞬时 ECONNRESET 重跑同一命令即可）。`src/e2e/fixture-rows.test.ts` 是 node:test 纯函数测试（不触库、不触网络），与 jest 并行约束无关。
- **outbox 消费驱动方式**：一律 `runOutboxBatch({ push: mockPush })`（`src/worker/processor.ts`，不传 `handlers` 用默认注册表——这同时证明 `moment.geocode` / `moment.extract` 已注册）；`mockPush = { send: jest.fn() } as unknown as PushService`（对齐 P3/P4 handler 测试范式）。
- **provider mock 注入点对齐上游范式**：`setGeocodeProvider(mock)`（P3 Task 3）、`setLLMProvider(mock)`（既有）、`setASRProvider(mock)`（既有）；**每个触库测试文件 `afterEach` 里对全部注入过的 factory 调 `setXxxProvider(undefined)` 重置**（`--runInBand` 下防跨文件状态污染，P3/P4 同款纪律）；`globalThis.fetch` mock 须在 `afterEach` 恢复真实引用。
- **voice 全链路走真实 HTTP 建时刻**（presign → complete → `POST /api/chains/:chainId/moments type=voice`），转写音频字节用 `globalThis.fetch` mock + `installMockStorage`（对齐 `create-voice-moment.test.ts` 的 `readyMedia` 范式），不走 P4 的 `insertVoice` 直插（P7 是 e2e，能走 HTTP 的都走 HTTP）。
- **sweep 演练双层**：确定性 jest 演练（二跑幂等断言，Task 3）+ 真实 CLI 双跑演练（`LLM_API_KEY=<dummy> pnpm --filter @moment/server backfill:extract`——脚本只发射不调 LLM，dummy key 让 sweep 真实扫描；证据 exit code 与 dispatched 数记入完工报告，不落 repo 文件）。**严禁对生产库执行**（`.env` 指向测试库）。
- **fixture 扩展与视觉基线**（偏差 2）：`src/e2e` fixture 加 persons/place 后，web 端卡片/详情（P5 已实现展示）渲染输出变化，design-system 24 张基线 PNG 必然 diff；基线更新需人工视觉确认（`apps/web/e2e/README.md` 基线纪律）且该套件不在 `pnpm test` 门禁内（需 CSI daemon + 本地 MinIO）——列为 P7 手测清单项，不阻断 DoD。
- 每 Task 一个 commit（conventional commits）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **「e2e 场景」的落点钉死在 `apps/server/tests/people-place/`，`src/e2e/` 只做 fixture 扩展**：编排 T7 owner 清单写「`apps/server/src/e2e/`（fixture-seeder/fixture-rows 扩展）+ e2e 场景」。已核实 `src/e2e/` 的全部现状（fixture-asset / fixture-cli-contract / fixture-cli / fixture-rows / fixture-seeder 五文件）：它是 design-system 视觉回归的确定性 fixture CLI，带 `MOMENT_E2E=1` + `MYSQL_DATABASE === 'moment_e2e'` + 私有 MinIO 桶三重守卫，其配套测试是 `env -i` 下跑的 node:test 契约测试——HTTP e2e（supertest + jest 触库）混入会同时破坏两者。owner 清单的前半句（fixture-seeder/fixture-rows 扩展）正是 Task 1；后半句「e2e 场景」按 recap P7 先例（`tests/recaps/recap-e2e.test.ts`，spec §9 e2e 条目的同款落地方式）落 jest。这是对 owner 清单的边界细化，非越界。
2. **fixture 扩展引起视觉基线 diff，基线更新列为手测项而非自动门禁**：spec/编排均未提及基线；design-system 套件本就不在 `pnpm test` 内（硬前置 CSI daemon + MinIO + 三终端），P7 不改 `apps/web/e2e/` 任何文件。fixture persons/place 落库后，下一次人工跑 design-system 回归时基线必然 diff，须按 README 纪律人工确认后 `--update-baselines`。此条写进 Task 4 手测清单与 DoD 备注。
3. **spec §9 e2e 字面「geocode mock 回填 → AI mock 补缺」在单次 `runOutboxBatch` 内一并完成**：建时刻（带坐标）同事务发 `moment.created` + `moment.geocode` + `moment.extract` 三行（P2/P4），一批消费全部处理——geocode 回填 place_name、extract 补 ai 人物，两断言在同一用例内先后验证。非偏差，是对执行语义的钉死说明（断言不依赖行处理顺序：geocode 与 extract 互不读写同一列——extract 只在 place 四列全空时写 place，本场景 place 已有 exif 坐标，不会被 extract 触碰）。
4. **voice 全链路的两批消费断言对 outbox 行内顺序不敏感**：create 同事务发的 `moment.transcribe` 与 `moment.extract` 行 `created_at` 可能同 tick，`runOutboxBatch` 按 `createdAt asc` 的处理顺序不保证 transcribe 先于 extract。两条路径终态收敛：extract 先行 → 空素材（content 与 transcript 均空）跳过不写 hash，转写回填后补发的 extract 行在第二批完成抽取；transcribe 先行 → 第一批即完成抽取，第二批的补发行 hash 短路。断言只写终态（transcript 落库、LLM 恰好调用 1 次、persons/place/hash 落库），两序均绿。
5. **CLI sweep 演练用 `LLM_API_KEY` 环境变量覆盖使 sweep 真实扫描**：测试库 `.env` 的 `LLM_API_KEY` 为空（P3 config 测试已断言 AMAP 同款前提），直接跑 CLI 只会走「空 key 直接退出」路径（P4 Task 5 Step 7 已演练过该退出路径）。P7 演练补齐「有 key 扫描 + pending 去重二跑」路径：`LLM_API_KEY=e2e-drill-dummy` 前缀覆盖（dotenv 不覆盖已存在的环境变量；sweep 只判 provider 非 null 不调 chat，dummy 值零远端风险）。演练前须确认无 `pnpm worker` / `pnpm dev` 进程正对同一测试库消费 outbox（`ps` 核查或先停 dev）——否则第一次发射的 pending 行会被 worker 消费掉，sweep 的 pending 去重随即失效，第二次 `dispatched > 0`、演练证据作废。残留 pending 行由下一次 jest `resetDb()` 清理（resetDb 已含 outbox 表）。
6. **`ai_extract_hash` 断言经 `computeAiExtractHash` 同源计算**（P4 唯一实现 import），不在测试内手写 sha256 公式——与 P4「hash 唯一实现」约束同源。

---

### Task 1: src/e2e fixture 扩展（persons/momentPersons 确定性行 + image moment place 列 + seeder reset/insert + 行工厂测试同步）

**Files:**
- Modify: `apps/server/src/e2e/fixture-rows.ts`（`personId` 常量 + persons/momentPersons 行 + image moment place 四列）
- Modify: `apps/server/src/e2e/fixture-seeder.ts`（reset 外键逆序补两表 delete + seed 事务补两表 insert + `DesignSystemFixture.personId`）
- Modify: `apps/server/src/e2e/fixture-rows.test.ts`（常量断言 + 全行集 deepEqual 同步）

**Interfaces:**
- Consumes（P1 Produces 逐字引用）:
  - `persons` / `momentPersons`（`src/db/schema.js` barrel，P1 落地；`NewPerson` 类型由 schema 导出，`momentPersons` 的 insert 形状经 `typeof momentPersons.$inferInsert` 本地推导——fixture-rows.ts 的 DB-free 约束要求 schema 仅 type-only import，与既有 `chainMembers` / `momentTags` 同款）
  - `moments` 表五列 `placeLat/placeLng/placeName/placeSource/aiExtractHash`（P1 迁移 0016 落地；`NewMoment` 的 place 列可空可选，fixture 只在 image moment 上赋值）
- Produces（design-system 视觉回归套件与后续手测消费）:
  - `personId = '00000000-0000-4000-8000-00000000001a'`（`fixture-rows.ts` 稳定 id 常量，延续既有 `...0011`..`...0019` 序列）
  - `FIXTURE_PERSON_NAME = '外婆'`、`FIXTURE_PLACE_NAME = '北京市东城区东华门街道天安门广场'`（`fixture-rows.ts` 导出常量）
  - `FixtureRows.persons: NewPerson[]` 与 `FixtureRows.momentPersons: Array<typeof momentPersons.$inferInsert>`（词典一行 + text moment 的 manual 关联一行）
  - image moment 行新增 place 四列（坐标 + 名字 + `placeSource: 'manual'`，即 §6 赋值表「坐标 + 名字 → manual」形态——视觉上地点行有名字可展示）
  - `DesignSystemFixture.personId: string`（seed 返回值新增字段，web 侧 runner 消费为增量、不破坏既有形状）
  - `resetFixture()` 覆盖 `moment_persons` / `persons` 两表（外键逆序，镜像 `tests/helpers/db.ts` 的 resetDb 扩展）

- [ ] **Step 1: 写失败测试（先改 fixture-rows.test.ts）**

Modify `apps/server/src/e2e/fixture-rows.test.ts`：

(a) import 块的 fixture-rows import 中，`ownerId,` 之前按既有字母序插入（并补三个新符号）：
```ts
import {
  buildFixtureRows,
  chainId,
  FIXTURE_EXPIRY_MS,
  FIXTURE_FIXED_NOW,
  FIXTURE_INVITE_TOKEN,
  FIXTURE_OWNER_NICKNAME,
  FIXTURE_PERSON_NAME,
  FIXTURE_PLACE_NAME,
  FIXTURE_SHARE_TOKEN,
  FIXTURE_VIEWER_NICKNAME,
  imageMomentId,
  inviteId,
  mediaId,
  momentId,
  ownerId,
  personId,
  shareLinkId,
  tagId,
  viewerId,
} from './fixture-rows.js';
```

(b) `describe('fixture constants')` 的 `test('stable ids and tokens are the exact plan values', ...)` 内，`assert.equal(inviteId, ...)` 之后追加：
```ts
    assert.equal(personId, '00000000-0000-4000-8000-00000000001a');
    assert.equal(FIXTURE_PERSON_NAME, '外婆');
    assert.equal(FIXTURE_PLACE_NAME, '北京市东城区东华门街道天安门广场');
```

(c) `test('returns the complete deterministic row set with exact values and FKs', ...)` 的 deepEqual 目标对象做两处同步：

`moments` 数组第二项（image moment）的 `deletedAt: null,` 之后追加四行：
```ts
          placeLat: 39.9042,
          placeLng: 116.4074,
          placeName: '北京市东城区东华门街道天安门广场',
          placeSource: 'manual',
```

`momentTags: [{ momentId, tagId }],` 之后追加两个新键（ persons 词典行 + text moment 的 manual 关联）：
```ts
      persons: [
        {
          id: personId,
          chainId,
          name: '外婆',
          userId: null,
          createdAt: fixedNow,
        },
      ],
      momentPersons: [{ momentId, personId, source: 'manual' }],
```

- [ ] **Step 2: 运行确认失败**

Run（repo 根目录）:
```bash
node --loader ts-node/esm --test apps/server/src/e2e/fixture-rows.test.ts
```
Expected: FAIL——TS 编译错误（`personId` / `FIXTURE_PERSON_NAME` / `FIXTURE_PLACE_NAME` 不在 `fixture-rows.js` 导出）或 deepEqual 断言失败（rows 缺 `persons` / `momentPersons` 键、image moment 缺 place 四列）。

- [ ] **Step 3: 实现 fixture-rows.ts 扩展**

Modify `apps/server/src/e2e/fixture-rows.ts`：

(a) type-only schema import 块替换为（加 `momentPersons, NewPerson, persons`；`momentPersons`/`persons` 仅作 typeof 类型推导用，运行时零依赖，DB-free 约束不破）：
```ts
import type {
  chainMembers,
  momentPersons,
  momentTags,
  NewChain,
  NewChainInvite,
  NewMedia,
  NewMoment,
  NewPerson,
  NewShareLink,
  NewTag,
  NewUser,
  persons,
} from '../db/schema.js';
```

(b) 常量区 `export const inviteId = '00000000-0000-4000-8000-000000000019';` 之后追加：
```ts
/** persons 词典行（people-place P7 fixture）：外婆，未链接用户。 */
export const personId = '00000000-0000-4000-8000-00000000001a';
```

(c) 文案常量区 `export const FIXTURE_IMAGE_MOMENT_CONTENT = ...` 之后追加：
```ts
export const FIXTURE_PERSON_NAME = '外婆';
export const FIXTURE_PLACE_NAME = '北京市东城区东华门街道天安门广场';
/** text moment 的人工关联（manual；AI 路在 fixture 中不出现——视觉回归只钉手动路展示形态）。 */
export const FIXTURE_PERSON_SOURCE = 'manual' as const;
```

(d) 本地类型推导区（`type NewChainMember = ...` 旁）追加：
```ts
type NewMomentPerson = typeof momentPersons.$inferInsert;
```

(e) `FixtureRows` 接口 `momentTags: NewMomentTag[];` 之后追加：
```ts
  persons: NewPerson[];
  momentPersons: NewMomentPerson[];
```

(f) `buildFixtureRows` 返回对象：`moments` 数组第二项（image moment）的 `deletedAt: null,` 之后追加：
```ts
        // people-place（spec §6 赋值表「坐标 + 名字 → manual」形态）：视觉上地点行有名字可展示
        placeLat: 39.9042,
        placeLng: 116.4074,
        placeName: FIXTURE_PLACE_NAME,
        placeSource: 'manual',
```
`momentTags: [{ momentId, tagId }],` 之后追加：
```ts
    persons: [
      {
        id: personId,
        chainId,
        name: FIXTURE_PERSON_NAME,
        userId: null,
        createdAt: fixedNow,
      },
    ],
    momentPersons: [{ momentId, personId, source: FIXTURE_PERSON_SOURCE }],
```

- [ ] **Step 4: 实现 fixture-seeder.ts 扩展**

Modify `apps/server/src/e2e/fixture-seeder.ts`：

(a) schema import 块中 `media,` 之后、`momentTags,` 之前插 `momentPersons,`，`moments,` 之后（`notifications,` 之前）插 `persons,`（字母序）：
```ts
import {
  chainInvites,
  chainMembers,
  chains,
  comments,
  media,
  momentPersons,
  momentTags,
  moments,
  notifications,
  outbox,
  persons,
  pushTokens,
  reactions,
  refreshTokens,
  shareLinks,
  tags,
  users,
} from '../db/schema.js';
```

(b) fixture-rows import 块的符号列表中 `ownerId,` 之后插 `personId,`（字母序 ownerId → personId）。

(c) `DesignSystemFixture` 类型 `tagId: string;` 之后追加：
```ts
  personId: string;
```

(d) `resetFixture()` 的 delete 序列中，`await db.delete(momentTags);` 之后插一行、`await db.delete(tags);` 之后插一行（外键逆序，镜像 resetDb：`moment_persons` 依赖 moments 与 persons、`persons` 依赖 chains，二者必须早于 `moments`/`chains` 的 delete）：
```ts
  await db.delete(momentTags);
  await db.delete(momentPersons);
  await db.delete(tags);
  await db.delete(persons);
```
（注释块「外键逆序：pushTokens, notifications, reactions, comments, momentTags, tags, ...」同步改为「... comments, momentTags, momentPersons, tags, persons, outbox, ...」。）

(e) `seedFixture()` 事务内 `await tx.insert(momentTags).values(rows.momentTags);` 之后追加：
```ts
      await tx.insert(persons).values(rows.persons);
      await tx.insert(momentPersons).values(rows.momentPersons);
```
（插入顺序满足 FK：persons 依赖 chains（已插）、momentPersons 依赖 moments 与 persons（均已插）。）

(f) 返回对象 `tagId,` 之后追加：
```ts
    personId,
```

- [ ] **Step 5: 运行确认通过**

Run（repo 根目录）:
```bash
node --loader ts-node/esm --test apps/server/src/e2e/fixture-rows.test.ts
env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts
```
Expected: 两个文件全过（fixture-rows 含新增 persons/momentPersons/place 断言；fixture-cli-contract 未被触碰，回归绿）。

- [ ] **Step 6: typecheck + lint**

Run:
```bash
pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```
Expected: exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/e2e/fixture-rows.ts apps/server/src/e2e/fixture-seeder.ts apps/server/src/e2e/fixture-rows.test.ts
git commit -m "feat(server): extend e2e fixture with persons and place rows"
```

---

### Task 2: HTTP 全链路 e2e（建时刻带人物+坐标 → 响应回读 → geocode/AI mock 消费 → 三路径序列化 + 隐私红线）

**Files:**
- Test: `apps/server/tests/people-place/people-place-e2e.test.ts`（新建；jest `roots: tests/` 自动纳入，无需改 jest 配置）

**Interfaces:**
- Consumes（P1–P4 Produces 逐字引用 + 既有符号）:
  - P2 API 契约：`POST /api/chains/:chainId/persons`（editor，新建 201，body `{id, name, userId}`）、`POST /api/chains/:chainId/moments` 与 `PATCH /api/moments/:id` 接受 `personIds` / `place`、`GET /api/chains/:chainId/moments`（items）、`GET /api/moments/:id`、`GET /api/feed?chain_ids=<id>&order=happened_at`（moments）、`POST /api/chains/:chainId/share-links`（201 body.token）、`GET /api/public/share/:token`（moments，零 persons/place 键）；`OUTBOX_MOMENT_GEOCODE` payload `{ momentId: string; lat: number; lng: number }`（camelCase，P2 偏差 1）
  - P3 Produces：`setGeocodeProvider(p: GeocodeProvider | null | undefined): void`、`GeocodeProvider`（`reverse(lat: number, lng: number): Promise<string | null>`，入参 WGS-84）、`handleMomentGeocode`（注册表键 `'moment.geocode'`，经 `runOutboxBatch` 默认表真实分发）
  - P4 Produces：`OUTBOX_MOMENT_EXTRACT` payload `{ momentId: string }`、`handleMomentExtract`（注册表键 `'moment.extract'`）、`computeAiExtractHash(content: string, transcript: string | null): string`
  - 既有：`runOutboxBatch(deps?: ProcessorDeps): Promise<OutboxBatchResult>`（`src/worker/processor.js`，不传 handlers 用默认注册表）、`setLLMProvider` / `LLMProvider`（`src/llm/factory.js` / `base.provider.js`）、`app` / `registerUser` / `createChain`（`tests/helpers/fixtures.js`，`app` 为 `listenLocal(createApp())` 显式绑 127.0.0.1）、`resetDb()` / `closeDb()`（`tests/helpers/db.js`）、`outbox` / `moments` / `momentPersons` / `persons`（`src/db/schema.js` barrel）
- Produces:
  - e2e 场景测试文件（纯测试，无新运行时符号）；spec §9 e2e 条目前半（建时刻带人物+坐标 → 响应回读 → geocode mock 回填 → AI mock 补缺）与 §8 红线三路径键级断言的落地载体

- [ ] **Step 1: 写测试（前序 P1–P4 已实施，本 Task 红灯 = 前序若未合入；已合入则直接绿，记录输出为证据——recap P7 同款条件步骤）**

Create `apps/server/tests/people-place/people-place-e2e.test.ts`：
```ts
import { jest } from '@jest/globals';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(resetDb);
afterEach(() => {
  setGeocodeProvider(undefined);
  setLLMProvider(undefined);
});
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const MOCK_PLACE_NAME = '北京市东城区东华门街道天安门广场';

/** mock geocode provider（P3 范式）：返回固定地名，记录收到的 WGS-84 坐标。 */
function geocodeReturning(name: string | null, seen?: Array<{ lat: number; lng: number }>): GeocodeProvider {
  return {
    reverse: async (lat, lng) => {
      seen?.push({ lat, lng });
      return name;
    },
  };
}

/** mock LLM provider（P4 范式）：chat 返回抽取 JSON，记录调用次数。 */
function llmReturning(persons: string[], places: string[], counter?: { calls: number }): LLMProvider {
  return {
    async chat() {
      if (counter) counter.calls += 1;
      return {
        content: JSON.stringify({ persons, places }),
        model: 'mock-model',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

const baseBody = {
  type: 'text' as const,
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('people-place 全链路 e2e（spec §1 数据流 / §9 e2e 条目）', () => {
  it('建时刻带人物+坐标 → 响应回读（manual/exif）→ geocode mock 回填 + AI mock 补缺 → 详情/feed 完整回读', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    // 人物词典经真实 POST 创建（spec §6）
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    expect(person.body).toEqual({ id: expect.any(String), name: '外婆', userId: null });

    // 建时刻：personIds（manual 意图）+ 仅坐标（EXIF 形态 → exif 分支）
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        ...baseBody,
        content: '今天在外婆家吃饭，朵朵很开心',
        personIds: [person.body.id],
        place: { lat: 39.9042, lng: 116.4074 },
      });
    expect(created.status).toBe(201);
    // 响应回读：source 只由 server 赋值（spec §3/§6 赋值表）
    expect(created.body.persons).toEqual([
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(created.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const momentId = created.body.id as string;

    // 同事务发射 moment.geocode（payload camelCase，P2 偏差 1）
    const geocodeRows = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(geocodeRows).toHaveLength(1);
    expect(geocodeRows[0].payload).toEqual({ momentId, lat: 39.9042, lng: 116.4074 });

    // mock provider 注入 + 常驻 worker 真实分发（默认 handlers 注册表：created/geocode/extract 一批全消费）
    const geocodeSeen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning(MOCK_PLACE_NAME, geocodeSeen));
    setLLMProvider(llmReturning(['朵朵'], []));

    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(3); // moment.created + moment.geocode + moment.extract
    expect(batch.failed).toBe(0);
    expect(geocodeSeen).toEqual([{ lat: 39.9042, lng: 116.4074 }]); // WGS-84 行坐标直达 provider

    // 详情回读：geocode 名回填（source 仍 exif，不被 AI 触碰——place 非空不覆盖）；AI 人物仅补缺（外婆 manual 不降级、朵朵 ai 新增）
    const detail = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    const persons = [...detail.body.persons].sort(
      (a: { source: string }, b: { source: string }) => a.source.localeCompare(b.source),
    );
    expect(persons).toEqual([
      { id: expect.any(String), name: '朵朵', userId: null, source: 'ai' },
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(detail.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: MOCK_PLACE_NAME, source: 'exif' });

    // feed 路径同样完整（includePrivate: true 批取序列化）
    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    const feedItem = feed.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.persons).toHaveLength(2);
    expect(feedItem.place).toEqual({ lat: 39.9042, lng: 116.4074, name: MOCK_PLACE_NAME, source: 'exif' });

    // outbox 全部终态（done），无重试/失败残留
    const pending = await db.select().from(outbox).where(eq(outbox.status, 'pending'));
    expect(pending).toHaveLength(0);
  });

  it('AI 抽取补缺 place：place 四列全空时填文本名（source=ai 无坐标）→ 响应回读（spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, content: '今天去了朝阳公园玩' });
    expect(created.status).toBe(201);
    expect(created.body.place).toBeNull();

    setLLMProvider(llmReturning([], ['朝阳公园']));
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(2); // moment.created + moment.extract
    expect(batch.failed).toBe(0);

    const detail = await request(app).get(`/api/moments/${created.body.id}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.place).toEqual({ lat: null, lng: null, name: '朝阳公园', source: 'ai' });
  });
});

describe('三路径序列化 + share-album 隐私红线（spec §8，键级断言）', () => {
  it('链时间线/详情/feed 含 persons/place；share-album 输出零 persons/place 键', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);

    // 坐标 + 名字 → manual（§6 赋值表第一行），不触发 geocode
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        ...baseBody,
        content: '在外婆家过年',
        personIds: [person.body.id],
        place: { name: '外婆家', lat: 39.9, lng: 116.4 },
      });
    expect(created.status).toBe(201);
    expect(created.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });
    const momentId = created.body.id as string;

    // 路径 1：链时间线
    const list = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(list.status).toBe(200);
    const listItem = list.body.items.find((m: { id: string }) => m.id === momentId);
    expect(listItem.persons).toEqual([
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(listItem.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });

    // 路径 2：详情
    const detail = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.persons).toHaveLength(1);
    expect(detail.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });

    // 路径 3：feed
    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    const feedItem = feed.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.persons).toHaveLength(1);
    expect(feedItem.place.name).toBe('外婆家');

    // 红线：公开分享相册零 persons/place（键完全不存在，不是空数组/null 值）
    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set(auth(owner.token))
      .send({});
    expect(link.status).toBe(201);

    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.moments).toHaveLength(1);
    const shared = pub.body.moments[0];
    expect('persons' in shared).toBe(false);
    expect('place' in shared).toBe(false);
    expect(Object.keys(shared)).not.toContain('persons');
    expect(Object.keys(shared)).not.toContain('place');
    // 同一时刻本体（content/tags 等）在分享路径照常输出——证明剥离是精确的两键级，不是整卡隐藏
    expect(shared.content).toBe('在外婆家过年');
  });
});
```

- [ ] **Step 2: 运行确认失败（条件步骤）**

Run: `pnpm --filter @moment/server test -- tests/people-place/people-place-e2e.test.ts`
Expected: 若上游未合入则 FAIL（模块解析/TS 编译错误——`src/geocode/factory.js`、`src/llm/extract/*` 等符号缺失；T7 串行于 T1–T4 之后，此路径实际不会走到）；已合入则记录 PASS 输出并视为 Step 3 证据（recap P7 同款条件步骤）。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 3: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/people-place/people-place-e2e.test.ts`
Expected: PASS，3 个用例全过。

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/tests/people-place/people-place-e2e.test.ts
git commit -m "test(server): add people-place full-chain e2e with privacy redline assertions"
```

---

### Task 3: voice transcribe→extract 全链路 + 回填 sweep 测试库演练

**Files:**
- Test: `apps/server/tests/people-place/people-place-pipeline-e2e.test.ts`（新建）
- 无产品代码改动（纯测试 + CLI 演练记录）

**Interfaces:**
- Consumes（P4 Produces 逐字引用 + 既有符号）:
  - `OUTBOX_MOMENT_EXTRACT = 'moment.extract'`（payload `{ momentId: string }`，camelCase，P4 偏差 1）与 `OUTBOX_MOMENT_TRANSCRIBE`（既有，`moment.transcribe`）
  - `handleMomentTranscribe`（既有，转写回填成功同事务补发 extract——P4 Task 3 落地）、`handleMomentExtract`（注册表键 `'moment.extract'`）、`handleMomentGeocode`（注册表键 `'moment.geocode'`，本 Task 间接消费）
  - `computeAiExtractHash(content: string, transcript: string | null): string`（`src/moments/ai-extract-hash.js`，hash 断言同源计算——P4「唯一实现」约束）
  - `runExtractBackfillSweep(opts?: { batchSize?: number; pauseMs?: number }): Promise<{ dispatched: number }>`（`src/worker/extract-backfill.js`，P4 Task 5）
  - CLI：`pnpm --filter @moment/server backfill:extract -- [--batch <n>] [--interval-ms <n>]`（P4 Task 5；只发射不消费）
  - 既有：`runOutboxBatch`（`src/worker/processor.js`）、`setLLMProvider` / `setASRProvider` / `ASRProvider`（`src/llm/asr/base.provider.js`：`transcribe(...)` 返回 `{ text }`）、`installMockStorage` / `setStorageAdapter`（`tests/helpers/storage.js`）、`createUser`（`tests/helpers/auth.js`）、`createChainWithMembers`（`tests/helpers/chain.js`）、`app` / `insertMoment`（`tests/helpers/fixtures.js`）、`resetDb()` / `closeDb()`、`moments` / `momentPersons` / `persons` / `outbox`（schema barrel）、`POST /api/media/presign` + `POST /api/media/:mediaId/complete`（真实媒体就绪链路，mock storage）
- Produces:
  - voice 全链路 + sweep 演练 e2e 测试文件（纯测试，无新运行时符号）；spec §9 e2e 条目后半（「回填 sweep 幂等二跑」）与 §11 P7「回填脚本在测试库演练」的落地载体

- [ ] **Step 1: 写测试（条件红灯，同 Task 2 Step 2）**

Create `apps/server/tests/people-place/people-place-pipeline-e2e.test.ts`：
```ts
import { jest } from '@jest/globals';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, outbox, persons as personsTable } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { runExtractBackfillSweep } from '../../src/worker/extract-backfill.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { app, insertMoment } from '../helpers/fixtures.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

let storage: MockStorage;
let owner: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  owner = await createUser(app, 'alice');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setLLMProvider(undefined);
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** mock LLM provider（P4 范式）：chat 返回抽取 JSON，记录调用次数。 */
function llmReturning(personNames: string[], placeNames: string[], counter?: { calls: number }): LLMProvider {
  return {
    async chat() {
      if (counter) counter.calls += 1;
      return {
        content: JSON.stringify({ persons: personNames, places: placeNames }),
        model: 'mock-model',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

/** 走真实接口造一条 ready audio media（presign → complete），对齐 create-voice-moment.test.ts 的 readyMedia。 */
async function readyAudio(token: string): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set(authHeader(token))
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12 });
  expect(presigned.status).toBe(201);
  storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
  const complete = await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set(authHeader(token))
    .send({});
  expect(complete.status).toBe(200);
  return presigned.body.mediaId as string;
}

describe('voice 时刻 transcribe → extract 全链路（spec §5 voice 独立触发）', () => {
  it('HTTP 建带 audio 的 voice moment → 转写 mock 回填 → 抽取 mock 落库 + hash 幂等（两批消费，终态与行序无关）', async () => {
    const chainId = await createChainWithMembers(owner.id);
    const audioId = await readyAudio(owner.token);
    // transcribe 链路的两个远端 IO：存储预签名 URL（mock storage）+ 拉音频字节（mock fetch）
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider({ transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) } satisfies ASRProvider);
    const llmCalls = { calls: 0 };
    setLLMProvider(llmReturning(['朵朵', '外婆'], ['外婆家'], llmCalls));

    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(authHeader(owner.token))
      .send({
        type: 'voice',
        content: '',
        happenedAt: '2026-08-23T10:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [audioId],
      });
    expect(created.status).toBe(201);
    expect(created.body.transcriptionStatus).toBe('pending');
    expect(created.body.persons).toEqual([]); // 建时刻无人物；抽取是异步补缺
    const momentId = created.body.id as string;

    // 第一批：moment.created → moment.transcribe（转写回填 + 同事务补发 extract）→ create 时的 moment.extract。
    // 行内处理顺序不保证（见计划偏差 4），两条路径终态收敛。
    const first = await runOutboxBatch({ push: mockPush });
    expect(first.done).toBeGreaterThanOrEqual(3);
    expect(first.failed).toBe(0);

    const [afterFirst] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(afterFirst.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(afterFirst.transcriptionStatus).toBe('done');

    // 第二批：transcribe 补发的 moment.extract 行 → 消费终态（先行路径：完成抽取；后行路径：hash 短路 no-op）
    const second = await runOutboxBatch({ push: mockPush });
    expect(second.done).toBeGreaterThanOrEqual(1);
    expect(second.failed).toBe(0);
    // 无论行序，LLM 恰好被调用一次（hash 幂等：同内容二投不重抽，spec §5）
    expect(llmCalls.calls).toBe(1);

    // 落库断言：词典两行 + ai 关联两行 + place 全空填文本名 + hash 写回（P4 唯一实现同源计算）
    const dict = await db.select().from(personsTable).where(eq(personsTable.chainId, chainId));
    expect(dict.map((p) => p.name).sort()).toEqual(['朵朵', '外婆']);
    const links = await db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.placeName).toBe('外婆家');
    expect(m.placeSource).toBe('ai');
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.aiExtractHash).toBe(computeAiExtractHash('今天带朵朵去外婆家吃饭', '今天带朵朵去外婆家吃饭'));

    // 响应回读：voice 时刻主素材（transcript）确实进了抽取管线
    const detail = await request(app).get(`/api/moments/${momentId}`).set(authHeader(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(detail.body.persons).toHaveLength(2);
    expect(detail.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'ai' });
  });
});

describe('回填 sweep 测试库演练（spec §5 存量回填 / §9「回填 sweep 幂等二跑」/ §11 P7）', () => {
  it('存量时刻分批派发 → mock LLM 消费写 hash → 二跑幂等（dispatched=0、无新行）', async () => {
    const chainId = await createChainWithMembers(owner.id);
    // 存量：2 条有素材未抽取（hash NULL）+ 1 条已抽取（hash 非空，扫描判据天然排除）
    const m1 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z'), content: '在外婆家第一天',
    });
    const m2 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-02T00:00:00Z'), content: '朵朵学会了走路',
    });
    const m3 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-08-03T00:00:00Z'), content: '已抽取过的存量',
    });
    await db.update(moments).set({ aiExtractHash: 'a'.repeat(64) }).where(eq(moments.id, m3));

    // sweep 只判 provider 非 null（占位 provider，不调 chat——对齐 P4 extract-backfill.test 范式）
    setLLMProvider({} as unknown as LLMProvider);
    const first = await runExtractBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(first.dispatched).toBe(2);

    // 常驻 worker 消费（mock LLM 真实抽取落库）
    setLLMProvider(llmReturning(['外婆'], []));
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(2);
    expect(batch.failed).toBe(0);
    for (const id of [m1, m2]) {
      const [row] = await db
        .select({ aiExtractHash: moments.aiExtractHash })
        .from(moments)
        .where(eq(moments.id, id));
      expect(row.aiExtractHash).not.toBeNull();
    }

    // 二跑幂等：hash 判据排除已抽取行 → dispatched=0、无新 outbox 行（既有行全部 done）
    setLLMProvider({} as unknown as LLMProvider);
    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    const extractRows = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(extractRows).toHaveLength(2);
    expect(extractRows.every((r) => r.status === 'done')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败（条件步骤）**

Run: `pnpm --filter @moment/server test -- tests/people-place/people-place-pipeline-e2e.test.ts`
Expected: P1–P4 已合入则直接进入 Step 3（记录输出为证据）；未合入则 FAIL。

- [ ] **Step 3: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/people-place/people-place-pipeline-e2e.test.ts`
Expected: PASS，2 个用例全过。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 4: 真实 CLI sweep 双跑演练（spec §11 P7「回填脚本在测试库演练」，证据记入完工报告）**

前提：确认 `apps/server/.env` 的 `MYSQL_*` 指向**测试库**（严禁生产库）；确认无 `pnpm worker` / `pnpm dev` 进程正对同一测试库消费 outbox（`ps` 核查或先停 dev）——否则第一次发射的 pending 行会被 worker 消费掉，sweep 的 pending 去重随即失效，第二次 `dispatched > 0`、演练证据作废。在 repo 根目录执行（`LLM_API_KEY` 前缀覆盖使 sweep 真实扫描而非空 key 退出，见偏差 5；脚本只发射不调 LLM，dummy 值零远端风险）：
```bash
LLM_API_KEY=e2e-drill-dummy pnpm --filter @moment/server backfill:extract -- --batch 5 --interval-ms 100
LLM_API_KEY=e2e-drill-dummy pnpm --filter @moment/server backfill:extract -- --batch 5 --interval-ms 100
```
Expected（逐条核对）:
1. 两次均 exit 0，输出 `extract backfill finished` 与各自 `dispatched` 数。
2. 第一次 `dispatched: <n>`（n = 测试库此刻 `ai_extract_hash IS NULL 且有素材且无 pending extract 行` 的时刻数；jest 收尾残留数据下 n 通常 > 0，可能为 0——记录实际值即可）。
3. 第二次 `dispatched: 0`（第一次发射的 pending 行尚未被任何 worker 消费 → sweep 的 pending 去重生效；若第一次为 0 则第二次必为 0，同样成立）。
4. 残留 pending 行无害：下一次 jest `resetDb()` 会清空 outbox 表（resetDb 已含 outbox）。

在完工报告中记录：两条命令的 exit code、两次 `dispatched` 数值、执行时间。**不创建任何记录文件进 repo。**

- [ ] **Step 5: 全量回归 + typecheck + lint**

Run:
```bash
pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```
Expected: 全套件绿（含 Task 1–3 新增：`tests/db/people-place-schema.test.ts`（P1）、`tests/moments/moment-private-serialization.test.ts` / `tests/persons/persons.test.ts` / `tests/moments/moment-persons-place.test.ts`（P2）、`tests/geocode/*` / `tests/worker/handle-moment-geocode.test.ts`（P3）、`tests/llm/extract/*` / `tests/worker/handle-moment-extract.test.ts` / `tests/worker/moment-extract-emit.test.ts` / `tests/worker/extract-backfill.test.ts`（P4）、本计划 `tests/people-place/*-e2e.test.ts` 两个文件 5 个用例）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/tests/people-place/people-place-pipeline-e2e.test.ts
git commit -m "test(server): add voice extract pipeline e2e and backfill sweep drill"
```

---

### Task 4: 收尾——全仓门禁 + 编排状态回写验收清单

**Files:**
- 无实现文件（门禁执行 + 证据收集；spec / 编排 prompt 的状态回写由**编排主 Agent**执行，本 Task 只提供精确的目标文本与验收清单——实现 SubAgent 不得改这两份文档）

**Interfaces:**
- Consumes: Task 1–3 全部产物；P1–P6 各 plan 的 DoD（均已实施为前提）。
- Produces: 全仓门禁证据（exit code / 通过数）+ 编排者收尾动作清单。

- [ ] **Step 1: 全仓构建**

Run: `pnpm build`（repo 根目录，turbo 依 `^build` 先构建 dto → api-client → server/web/app）
Expected: exit 0。若 web/app 编译红即为 P5/P6 遗漏，停手报告编排主 Agent，不在本计划内修。

- [ ] **Step 2: 全仓测试**

Run: `pnpm test`（repo 根目录）
Expected: exit 0，turbo 逐包全绿（dto / api-client / server / web；app 当前无 test 脚本、turbo 自动跳过——若 P6 已实施则为含 app 的五包全绿，P6 Task 1 会给 app 加 vitest）。说明两点：
1. server 是唯一触库 jest 会话（`--runInBand`）；web 是 vitest（不触库、node 环境），dto/api-client 是 `tsx --test`——turbo 内并行不存在「两个 jest 会话打同一测试库」（app 在 P6 落地 vitest 后同 web，不触库）。
2. 记录 server 实际 pass 用例总数（含本计划新增 5 个 e2e 用例）作为完工报告证据。

- [ ] **Step 3: 全仓 lint**

Run: `pnpm lint`
Expected: exit 0。

- [ ] **Step 4: 手测清单（P7 范围内，逐项记录结果）**

1. **src/e2e fixture 测试**（Task 1 已跑，此处为收尾复跑）：
   ```bash
   node --loader ts-node/esm --test apps/server/src/e2e/fixture-rows.test.ts
   env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts
   ```
   Expected: 全过。
2. **CLI sweep 双跑演练**（Task 3 Step 4 已执行，确认证据完整：两次 exit 0、第二次 dispatched=0）。
3. **design-system 视觉回归基线更新（可选、人工、不阻断 DoD）**：fixture 新增 persons/place 后基线必 diff。具备 CSI daemon + 本地 MinIO 环境时按 `apps/web/e2e/README.md` 流程跑 `pnpm --filter @moment/web e2e:design-system`，人工视觉确认后 `--update-baselines` 更新基线并跑只读证明（`manifest.mjs --hashes` 前后一致）。不具备环境时记录「待办」并提醒编排者——本项不是 P7 出口标准（spec §11 P7 只要求 e2e 全绿 + 全仓门禁）。

- [ ] **Step 5: 编排者收尾动作清单（不由实现 SubAgent 执行；逐项列精确目标文本）**

以下动作由**编排主 Agent** 在 T7 验收通过后执行（本计划只写清单）：

1. `docs/superpowers/prompts/2026-08-28-people-place-execution.md` §2 映射表 T7 行：`⬜ 待起草`/`✅ 已起草并评审通过` → `✅ 已实施`。
2. `docs/superpowers/specs/2026-08-28-moment-people-place-design.md` 第 4 行状态：`> 状态：已批准，待实施` → `> 状态：已实现（P1–P7 合入，2026-08-28）`（recap P7 Task 3 同款收尾）。
3. commit 这两处文档变更：`docs: mark people-place spec as implemented`。
4. 向用户同步 T1–T7 全部完成的一行进度。

- [ ] **Step 6: Commit（仅当本 Task 产生了实现文件变更时；纯门禁执行无 commit）**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

本 Task 默认零文件变更（门禁执行 + 清单），无 commit；Step 5 的文档回写由编排者单独提交。

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿，含新增 `tests/people-place/people-place-e2e.test.ts`（3 用例：全链路回读+geocode 回填+AI 补缺、AI place 全空填文本名、三路径序列化+share-album 零 persons/place 键级断言）与 `tests/people-place/people-place-pipeline-e2e.test.ts`（2 用例：voice transcribe→extract 两批消费全链路、sweep 派发→消费→二跑幂等）
- [ ] `node --loader ts-node/esm --test apps/server/src/e2e/fixture-rows.test.ts` 与 `env -i PATH="$PATH" node --loader ts-node/esm --test apps/server/src/e2e/fixture-cli-contract.test.ts` 全过（fixture persons/momentPersons/place 行 + seeder reset 覆盖两新表）
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] CLI sweep 双跑演练证据：两次 exit 0、第二次 `dispatched: 0`（记入完工报告）
- [ ] `pnpm build` / `pnpm test` / `pnpm lint`（repo 根目录，全仓）exit 0
- [ ] spec §9 e2e 条目逐字覆盖：「建时刻带人物+坐标 ✓ → 响应回读 ✓（persons manual / place exif，source 只由 server 赋值）→ geocode mock 回填 ✓（runOutboxBatch 真实分发，provider 收到 WGS-84 行坐标）→ AI mock 补缺 ✓（manual 不降级 + place 全空填文本名两分支）；回填 sweep 幂等二跑 ✓」
- [ ] spec §8 红线 e2e 级钉死：feed / 链时间线 / 详情三路径 persons/place 必产出；share-album 输出零 persons/place **键**（`in` / `Object.keys` 双重断言），且 content 等公开字段照常输出（证明是精确两键级剥离）
- [ ] spec §11 P7 出口标准：「e2e 联调 ✓ + 回填脚本在测试库演练 ✓（jest 确定性演练 + CLI 双跑）→ e2e 全绿 ✓」；全仓 `pnpm test` / `pnpm lint` / `pnpm build` 绿（编排 T7 DoD）
- [ ] 编排 T7 owner 边界核对：`src/e2e/` 只改 fixture-rows.ts / fixture-seeder.ts / fixture-rows.test.ts 三文件；e2e 场景 + sweep 演练落 `tests/people-place/`（偏差 1 钉死的解读）；客户端（web/app）零代码触碰
- [ ] 边界确认：未改任何产品运行时代码（P7 是纯测试 + fixture + 门禁计划）；`moment.e2e` 专用库守卫（MOMENT_E2E / MYSQL_DATABASE / MinIO 三重）未被触碰；测试库纪律全程遵守（--runInBand、127.0.0.1、afterAll(closeDb)、单 jest 会话）

## 写完自查（起草者已执行）

- **spec 覆盖**：§9 e2e 条目逐字落地（Task 2 两个 describe + Task 3 sweep）；§8 红线 e2e 级键级断言（Task 2 红线用例）；§11 P7 出口标准（DoD 逐项）；§5 voice 独立触发与 sweep 幂等（Task 3）；§1 数据流三路（手动路 HTTP / AI 路 outbox / geocode 路 outbox 均在全链路用例内穿越）。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」；两份测试文件与 fixture 改动均为完整可运行代码。
- **跨 Task 类型一致性**：Consumes 符号与 P1（`persons`/`momentPersons`/`insertPerson`/`attachPerson`——本计划 e2e 实际经 HTTP 创建 person、直插夹具仅 sweep 用 `insertMoment`）、P2（persons 端点/`OUTBOX_MOMENT_GEOCODE` payload `{ momentId, lat, lng }` camelCase/includePrivate 行为）、P3（`setGeocodeProvider`/`GeocodeProvider.reverse(lat, lng)`/`handleMomentGeocode` 注册键）、P4（`OUTBOX_MOMENT_EXTRACT` payload `{ momentId }`/`computeAiExtractHash(content, transcript)`/`handleMomentExtract`/`runExtractBackfillSweep({ batchSize, pauseMs })`/`backfill:extract`）逐字核对；mock 注入点（`setGeocodeProvider`/`setLLMProvider`/`setASRProvider` + `installMockStorage` + `globalThis.fetch`）与 P3/P4 测试范式逐一对应；outbox 消费驱动统一为 `runOutboxBatch({ push: mockPush })`（默认 handlers 注册表）。
- **既有事实核实**（起草时逐处验证）：`src/e2e/` 五文件现状与 `MOMENT_E2E` 守卫语义；`fixture-rows.test.ts` 的全行集 deepEqual 结构（Task 1 的同步点）；`tests/helpers/fixtures.ts` 的 `app`（listenLocal 绑 127.0.0.1）/`registerUser`/`createChain(ownerId)`/`insertMoment` 签名；`tests/helpers/chain.ts` 的 `createChainWithMembers(ownerId, members?)`；`create-voice-moment.test.ts` 的 `readyMedia`（presign `{ mime, size, kind, durationSeconds }` + `headObject` mock + complete）与 voice 校验（恰 1 条 audio、其余 image——audio-only 合法）；`runOutboxBatch` 的 claim（`nextRetryAt` null 或到期）与默认 handlers 分发；`RETRY_DELAYS_MS` 退避语义；根 `pnpm test` = turbo test 的包组成与并行性（仅 server 触库；app 当前无 test 脚本被 turbo 跳过，P6 落地 vitest 后含 app）。
