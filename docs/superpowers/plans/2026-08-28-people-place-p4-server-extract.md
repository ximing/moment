# 时刻人物与地点 P4：AI 文本抽取管线（llm/extract + moment.extract worker）+ 回填 sweep 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的 AI 文本抽取管线（spec §5 全节）：`src/moments/ai-extract-hash.ts`（幂等 hash 唯一实现）+ `src/llm/extract/`（`prompt.ts` 抽取 prompt（素材各截断 2000 字符并声明截断）+ `extract.ts`（LLMProvider 调用 + JSON 解析防御）+ `persist.ts`（词典 upsert / moment_persons 仅补缺 / place 全空才填 / 写 hash））；发射侧——moments create/update 落库后 hash 判据同事务发射 `moment.extract`、`handleMomentTranscribe` 转写回填成功同事务补发射（voice 独立触发）；消费侧——worker `handleMomentExtract`（重读软删跳过 → LLM null 跳过不写 hash → 空素材跳过 → hash 幂等 → 抽取 → 行锁事务落库）；存量回填——`src/worker/extract-backfill.ts` + `scripts/backfill-extract.ts`（`backfill:extract` 脚本，分批写 outbox，空 key 直接退出，二跑幂等）。

**Architecture:** `src/llm/extract/` 完整镜像 `src/llm/recap/` 结构：`prompt.ts`（system/user 模板 + 截断护栏）与 `extract.ts`（provider 调用 + `parseExtractJson` 防御解析 + 解析失败重试一次）一一对应 recap 的 prompt.ts / generate.ts 前半；recap 的 `input.ts`（DB 组装）在抽取场景退化为两个字符串入参（素材只有 content + transcript，voice 时刻 transcript 是主素材），截断在 prompt 内完成，故无对应文件；recap 的 `upsertRecap` 落库角色由 `persist.ts` 的 `persistExtraction` 承担。幂等判据 `computeAiExtractHash` 是发射侧（moment.service create/update、transcribe 回填）与消费侧（handleMomentExtract 写回）的唯一同源实现（spec §5 公式，严禁复制公式）。handler 错误策略对齐 P3 geocode：不 try/catch、全部传播给 processor 走既有 5 档指数退避、终败仅记日志不重派（见偏差 5）。落库事务带行锁重读 + 素材快照比对，防「LLM IO 期间内容变化 → stale 结果配新 hash」的错误终态（偏差 10）。回填 sweep 是**一次性 CLI 脚本**（`pnpm --filter @moment/server backfill:extract`），复用 recap-scheduler 的批量扫描骨架（分批查询 + 事务内 emitOutbox + pending 去重），只发射不消费——实际抽取由常驻 worker 的 outbox 循环完成，**`src/worker/index.ts` 不改**（一次性脚本不挂 worker 常驻循环）。

**Tech Stack:** jest + 真实 MySQL 测试库（`--runInBand`、触库文件 `afterAll(closeDb)`、`beforeEach(resetDb)`）/ drizzle-orm 0.45 / tsx（脚本入口）/ LLM 全程 mock 注入（`setLLMProvider` + `afterEach(setLLMProvider(undefined))` 三态清理，对齐 `tests/llm/recap/generate.test.ts` 范式）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§5 AI 文本抽取全节——触发与幂等/voice 独立触发/抽取内容与落库规则/冲突规则汇总/成本护栏与回填、§9 测试策略、§11 P4 出口标准）

**上游契约:**
- `docs/superpowers/plans/2026-08-28-people-place-p1-dto-schema.md`（`persons`/`momentPersons` 表、moments 五列、fixtures `insertPerson`/`attachPerson` 逐字消费）
- `docs/superpowers/plans/2026-08-28-people-place-p2-server-persons.md`（`normalizePersonName`、`replaceMomentPersons`、`OUTBOX_MOMENT_GEOCODE` 已落地 types.ts、moment.service P2 后形态锚点）
- `docs/superpowers/plans/2026-08-28-people-place-p3-server-geocode.md`（handler 注册范式、`getLLMProvider` 消费方式、终败退避语义——P4 错误策略对齐对象）
- 执行编排 `docs/superpowers/prompts/2026-08-28-people-place-execution.md` T4 节 + §1 M1 专属硬约束（LLM_API_KEY 空跳过不写 hash / 优先级 manual>exif>ai / 幂等 hash / transcribe 回填补发射 / worker 软删竞态 / outbox 命名）

**执行前提**：P1–P3 已实施（编排串行 T1→T4）。本计划所有锚点基于 **P2/P3 之后**的代码形态（moment.service 含 personIds/place/geocode 发射、types.ts 含 `OUTBOX_MOMENT_GEOCODE`、handlers.ts 含 `handleMomentGeocode`）。若执行时锚点对不上（上游实现与本计划引用的代码块有出入），以语义为准定位插入点并停手报告差异，不自行改契约。

## Global Constraints（只写本计划新增，通用约束继承 Phase 1 / 编排 §1）

- **hash 唯一实现**：`computeAiExtractHash(content, transcript) = sha256(content + '\0' + transcript ?? '')`（`src/moments/ai-extract-hash.ts`）。发射判据、消费幂等、写回值三处全部 import 该函数，任何位置不得内联重写公式。
- **LLM_API_KEY 空 → 消费即跳过、不写 `ai_extract_hash`**（编排硬约束）：handler 判 `getLLMProvider() === null` 直接 return；恢复 key 后内容再变化自然补抽，存量由 sweep 补。sweep 空 key 直接退出（不查询不发射）。
- **优先级 manual > exif > ai**：AI 人物仅补缺（已存在的 moment_persons 行一律不动——manual 不降级）；AI place 仅在 place 四列全空（lat/lng/name/source）时填 `places[0]`（source=ai、无坐标）。
- **幂等**：hash 未变不重抽（发射侧 hash 判据 + 消费侧 hash 短路 + stale 丢弃）；voice 时刻 transcript 由 transcribe handler 异步回填，**回填成功同事务必须写 `moment.extract` outbox 行**（spec §5）。
- **worker 软删竞态**：`moment.extract` 消费时重读时刻，不存在或已软删即跳过；落库事务内行锁重读再校验。
- **outbox 命名**：常量 `OUTBOX_MOMENT_EXTRACT = 'moment.extract'` 落地 `src/outbox/types.ts`（P2 已加 `OUTBOX_MOMENT_GEOCODE`，本计划只加自己那一行）；payload **camelCase** `{ momentId: string }`（继承 P2 偏差 1）。
- **AI 人物落库不复用 `replaceMomentPersons`**（P2 Task 3 Produces 明文禁止——该函数删全集），新写 `persistExtraction`。
- **`src/worker/index.ts` 与 `src/config.ts` 均不改**：回填是一次性 CLI 脚本不进 worker 循环；无新增环境变量（复用 `LLM_API_KEY`）。脚本参数走 `process.argv`（`--batch` / `--interval-ms`），不落 `process.env`（server CLAUDE.md：环境变量只经 config.ts）。
- 触库测试打 `.env` 指向的远程共享测试库：`--runInBand`、`afterAll(closeDb)`、`beforeEach(resetDb)`、禁止两个 jest 会话并行（瞬时 ECONNRESET 重跑同一命令即可）；严禁生产库。LLM mock 一律 `setLLMProvider` 注入 + `afterEach(setLLMProvider(undefined))`。
- 每 Task 一个 commit（conventional commits）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **outbox payload camelCase `{ momentId }`**：spec §5 字面写 `{moment_id}`，但既有全部 outbox payload 均 camelCase，P2 偏差 1 已为 `moment.geocode` 钉死 camelCase，本计划对 `moment.extract` 沿用同一裁决。
2. **`OUTBOX_MOMENT_EXTRACT` 常量由本计划落地 `src/outbox/types.ts`**：与 P2 偏差 2 同款边界处理——常量必须先于发射存在；P2 已在 types.ts 落地 `OUTBOX_MOMENT_GEOCODE`，本计划在其后追加自己的一行常量 + 一个联合成员，不触碰既有条目。
3. **AI 人物落库不复用 `replaceMomentPersons`，新写 `persistExtraction`**：P2 Task 3 Produces 逐字写明「P4 的 AI『仅补缺』语义不得复用本函数（本函数删全集），需另写助手」。理由：`replaceMomentPersons` 是先删全集再插的 PATCH 全量替换语义，AI 需要「已存在行一律不动、只 insert 缺失行」；复用会删掉 manual 行（降级）与集合外 ai 行（破坏「删除保持」语义）。新助手落在 `src/llm/extract/persist.ts`。
4. **复活语义钉死（spec §5 冲突规则的显式化）**：spec §5「用户删除 ai 行后保持删除（hash 未变不重抽）」——删除的持久性**由 hash 不变保证**（不重抽 → 不重落）；一旦内容变化触发重抽，spec 字面的「重新落库」**接受复活**：已删的 moment_persons ai 行重新插入（source=ai）、被整体删除的词典行（DELETE person 路径）重新 upsert。manual 行永不降级（仅补缺），升级 manual 只发生在 P2 的 PATCH 全量替换路径。测试双向钉死「内容未变 → 删除保持」「内容变化 → 复活为 ai 行」。
5. **handler 错误策略对齐 P3 geocode（全传播 → 退避 → 终败仅记日志），不采 transcribe 的「NonRetryable 自落终态」**：extract 在 moments 上**无终态列可自落**（transcribe 有 `transcriptionStatus`、recap 有行 status，extract 没有对应物），outbox 行自身状态就是唯一记录，走完 pending→(退避)→failed 才是 spec §5「失败走 outbox 既有指数退避，终败仅记日志」的字面实现；且 LLM 畸形输出/4xx 混杂永久与时变失败，按 NonRetryable 提前终态会静默丢可恢复行（与 P3 偏差 3 的 (b) 同理）。畸形输出解析**内部重试一次**（recap 范式）后抛 `NonRetryableLLMError` 传播，由 processor 退避兜底——同一 people-place worker 家族（`moment.geocode`/`moment.extract`）错误策略保持一致。
6. **空素材跳过不写 hash**：spec §5 未写 handler 对「content 与 transcript 均空」的行为；对齐 sweep 的素材判据（偏差 11 闭合后的 `content <> '' OR (transcript IS NOT NULL AND transcript <> '')`，spec §5 回填节）在 handler 判空跳过（done、**不写 hash**）——避免空 prompt 的 LLM 调用浪费；素材出现（转写回填 / 正文编辑）时对应发射路径自会再触发。发射侧仍按 spec §5 字面 hash 判据恒发（create 时 hash 恒 NULL ≠ 任意 hash），空素材行由消费侧吸收。
7. **hash 公式中 transcript NULL ≡ 空串**：`sha256(content + '\0' + '')`——未转写与「转写成功但文本为空」（笑声/环境音，transcribe 存空串）产生同 hash：两者素材语义相同（无可抽内容），幂等判据一致是正确行为，非缺陷。
8. **发射判据是 `ai_extract_hash`，发射侧无 pending 去重**：spec §5 字面判据只对 hash；worker 消费前重复 PATCH 同一内容会重复发射 outbox 行，消费侧 hash 幂等吸收（第二次消费短路 no-op）。不为请求路径加 outbox 去重查询（请求路径零远端调用/零额外查询的既有纪律）；sweep 侧**保留** pending 去重（对齐 recap-scheduler 的 `alreadyDispatched` 范式，防「发射未消费」窗口内二跑重复发射）——sweep 是低频运维脚本，多一次查询无成本顾虑。故障期放大系数：LLM 故障窗口内同一 moment 的 N 条重复 pending 行各自独立退避（发射侧无去重的代价）——最坏 N×6 次 handler 尝试（5 档退避 + 终败 attempts=6）、每次尝试 handler 内最多 2 回 chat（解析内部重试一次），家庭规模 + 手动编辑低频下可接受；运维须知「LLM 长时间宕机 + 高频编辑」组合会按此系数放大最坏 LLM 调用量（此时可先停编辑或临时清 LLM_API_KEY 使消费即跳过）。
9. **LLM 输出防御上限**：persons 经 `normalizePersonName` 归一化去重后取**前 20**（对齐 dto `momentPersonIdsSchema` max(20)）；归一化后名长 >50（persons.name varchar(50)，P1）**丢弃**（截断会产生半截人名，比丢条目更糟）；place 取 `places[0]` 截断 255（对齐 place_name 列宽与 P3 的 `PLACE_NAME_MAX_CHARS` 范式）。spec 未定，防御性钉死。
10. **LLM IO 期间内容变化的竞态防御（stale 丢弃）**：LLM IO 期间用户 PATCH / transcribe 回填改变了素材 → 落库事务内**行锁重读 + 与抽取时快照逐字段比对**，不一致即丢弃本次结果（不写 hash、不落库）——否则会出现「新内容配旧抽取结果的 hash」的错误终态（hash 一写，新内容的发射判据 `新hash ≠ 旧hash` 仍成立会重抽，但旧结果已污染词典/关联/place）；变化路径自会发射新事件按新素材重抽。spec 未明说，正确性要求。
11. **sweep 扫描条件对 spec §5 字面做「空 transcript 视同无素材」的闭合**：spec §5 回填节字面是 `content <> '' OR transcript IS NOT NULL`，会把「转写成功但文本为空」（笑声/环境音，transcribe 存空串）且 content 为空的 voice 时刻判为有素材而派发；handler 对空素材跳过且**不写 hash**（偏差 6）→ 该行 `ai_extract_hash` 恒 NULL，**每次跑 backfill 都重复派发**，跨 run 不幂等。扫描条件闭合为 `(content <> '' OR (transcript IS NOT NULL AND transcript <> ''))`——空 transcript 视同无素材，与偏差 6（空素材跳过）/ 偏差 7（空串 ≡ NULL 的 hash 语义）一致；素材出现（转写回填 / 正文编辑）时对应发射路径自会再触发，不漏抽。

---

### Task 1: 幂等 hash 纯函数 + 抽取 prompt（ai-extract-hash.ts + llm/extract/prompt.ts）

**Files:**
- Create: `apps/server/src/moments/ai-extract-hash.ts`
- Create: `apps/server/src/llm/extract/prompt.ts`
- Test: `apps/server/tests/moments/ai-extract-hash.test.ts`
- Test: `apps/server/tests/llm/extract/prompt.test.ts`

**Interfaces:**
- Consumes: 无（纯函数、零 DB 依赖；zod/dto 不涉及）。
- Produces（Task 2–5 消费；P5/P7 复用）:
  - `computeAiExtractHash(content: string, transcript: string | null): string`（`src/moments/ai-extract-hash.ts`；spec §5 公式 `sha256(content + '\0' + transcript ?? '')` 的唯一实现；发射侧 moment.service / transcribe 回填、消费侧 handleMomentExtract、sweep 语义判据同源引用）
  - `EXTRACT_MAX_INPUT_CHARS = 2000`（`src/llm/extract/prompt.ts`；spec §5 成本护栏）
  - `buildExtractSystemPrompt(): string`（要求严格 JSON `{persons: string[], places: string[]}` + 人物/地点抽取规则）
  - `buildExtractUserPrompt(content: string, transcript: string | null): string`（两段素材各截断 2000 字符、超长时声明截断；transcript null 声明「无语音转写」）

- [ ] **Step 1: 写失败测试 — hash**

Create `apps/server/tests/moments/ai-extract-hash.test.ts`（纯单测，不触库）：
```ts
import { createHash } from 'node:crypto';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';

describe('computeAiExtractHash（spec people-place §5 幂等判据）', () => {
  it('sha256(content + "\\0" + transcript)，64 位小写十六进制', () => {
    expect(computeAiExtractHash('外婆家', '朵朵笑了')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('与手工 sha256 逐字一致（钉死公式，防实现漂移）', () => {
    const manual = createHash('sha256').update('正文\0转写').digest('hex');
    expect(computeAiExtractHash('正文', '转写')).toBe(manual);
  });

  it('确定性：同输入同 hash；内容或转写任一变化 → hash 变化', () => {
    const base = computeAiExtractHash('正文', '转写');
    expect(computeAiExtractHash('正文', '转写')).toBe(base);
    expect(computeAiExtractHash('正文改', '转写')).not.toBe(base);
    expect(computeAiExtractHash('正文', '转写改')).not.toBe(base);
    expect(computeAiExtractHash('正文改', '转写改')).not.toBe(base);
  });

  it('分隔符语义：content 与 transcript 边界变化可区分', () => {
    // 'a' + '\0' + 'bc' ≠ 'ab' + '\0' + 'c' —— \0 分隔符保证拼接无歧义
    expect(computeAiExtractHash('a', 'bc')).not.toBe(computeAiExtractHash('ab', 'c'));
  });

  it('transcript null 与空串产生相同 hash（偏差 7：素材语义相同）', () => {
    expect(computeAiExtractHash('正文', null)).toBe(computeAiExtractHash('正文', ''));
  });
});
```

- [ ] **Step 2: 写失败测试 — prompt**

Create `apps/server/tests/llm/extract/prompt.test.ts`（纯单测，不触库）：
```ts
import {
  EXTRACT_MAX_INPUT_CHARS,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
} from '../../../src/llm/extract/prompt.js';

describe('buildExtractSystemPrompt（spec people-place §5 抽取规则）', () => {
  it('要求返回 JSON {persons, places} 且声明输出结构', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('JSON');
    expect(sys).toContain('persons');
    expect(sys).toContain('places');
    expect(sys).toContain('[]'); // 空数组合法（没有人物/地点）
  });

  it('人物规则：亲属称谓原样抽、第一/二人称不抽（spec §5）', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('亲属称谓');
    expect(sys).toContain('第一人称');
    expect(sys).toContain('第二人称');
  });

  it('地点规则：地名与场所短语、不臆造（spec §5）', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('场所');
    expect(sys).toContain('不要臆造');
  });
});

describe('buildExtractUserPrompt（spec §5 素材 + 成本护栏）', () => {
  it('含正文与语音转写两段素材', () => {
    const user = buildExtractUserPrompt('今天在外婆家吃饭', '朵朵说了一整天的话');
    expect(user).toContain('今天在外婆家吃饭');
    expect(user).toContain('朵朵说了一整天的话');
  });

  it('transcript 为 null → 声明无语音转写；正文为空 → 声明无正文（voice 时刻主素材是转写）', () => {
    const user = buildExtractUserPrompt('', null);
    expect(user).toContain('（无正文）');
    expect(user).toContain('（无语音转写）');
  });

  it('transcript 为空串（转写成功但无文本）→ 声明转写为空，与 null 区分', () => {
    const user = buildExtractUserPrompt('正文', '');
    expect(user).toContain('（语音转写为空）');
  });

  it('超长素材各截断 2000 字符并声明截断（spec §5 成本护栏：prompt 内声明截断）', () => {
    expect(EXTRACT_MAX_INPUT_CHARS).toBe(2000);
    const content = '甲'.repeat(EXTRACT_MAX_INPUT_CHARS + 500);
    const transcript = '乙'.repeat(EXTRACT_MAX_INPUT_CHARS + 500);
    const user = buildExtractUserPrompt(content, transcript);
    expect(user).toContain('甲'.repeat(EXTRACT_MAX_INPUT_CHARS));
    expect(user).not.toContain('甲'.repeat(EXTRACT_MAX_INPUT_CHARS + 1));
    expect(user).toContain('乙'.repeat(EXTRACT_MAX_INPUT_CHARS));
    expect(user).not.toContain('乙'.repeat(EXTRACT_MAX_INPUT_CHARS + 1));
    expect(user.match(/已截断/g)?.length).toBe(2); // 两段各自声明
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/ai-extract-hash.test.ts tests/llm/extract/prompt.test.ts`
Expected: FAIL，`Cannot find module '../../src/moments/ai-extract-hash.js'` 与 `Cannot find module '../../../src/llm/extract/prompt.js'`。

- [ ] **Step 4: 实现 ai-extract-hash.ts**

Create `apps/server/src/moments/ai-extract-hash.ts`：
```ts
import { createHash } from 'node:crypto';

/**
 * AI 抽取幂等判据（spec people-place §5）：sha256(content + '\0' + transcript)。
 * 唯一实现——发射侧（moment.service create/update、transcribe 回填补发射）与消费侧
 * （handleMomentExtract 判据与写回）、回填 sweep 的语义判据全部同源 import，严禁复制公式。
 *
 * transcript 为 null 时按空串参与拼接（分隔符保留）：未转写与「转写成功但文本为空」
 * （笑声/环境音，transcribe 存空串）产生同 hash——两者素材语义相同（无可抽内容），
 * 幂等判据一致是正确行为（见计划偏差 7）。
 */
export function computeAiExtractHash(content: string, transcript: string | null): string {
  return createHash('sha256').update(`${content}\0${transcript ?? ''}`).digest('hex');
}
```

- [ ] **Step 5: 实现 llm/extract/prompt.ts**

Create `apps/server/src/llm/extract/prompt.ts`：
```ts
/**
 * AI 文本抽取 prompt（spec people-place §5）。
 * 输入素材：moment 正文 content + 语音转写 transcript（voice 时刻正文常空，transcript 是主素材）。
 * 输出契约：严格 JSON `{ "persons": string[], "places": string[] }`。
 * 成本护栏（spec §5）：content 与 transcript 各截断前 2000 字符，超长时在 prompt 内声明截断。
 */

/** 单段素材截断上限（spec §5 成本护栏：content+transcript 各取前 2000 字符）。 */
export const EXTRACT_MAX_INPUT_CHARS = 2000;

export function buildExtractSystemPrompt(): string {
  return `你是家庭时光链的元数据抽取助手。从一条时刻记录（正文与语音转写文本）中抽取「人物」与「地点」。

输出要求：
1. 仅返回一个 JSON 对象，不要包含任何解释文字、markdown 代码块包裹或注释。
2. JSON 结构：
   {
     "persons": ["<string: 人物名>", ...],
     "places": ["<string: 地名或场所短语>", ...]
   }
3. 人物规则：抽取人名与亲属称谓，原样保留文本写法（如「外婆」「朵朵」「王叔叔」）；不抽取第一人称与第二人称（「我」「你」「咱们」等）；没有人物时 persons 为空数组 []。
4. 地点规则：抽取地名与场所短语，原样保留文本写法（如「外婆家」「朝阳公园」「北京」）；不要臆造或补全坐标、门牌等文本中不存在的细节；没有地点时 places 为空数组 []。
5. 只从给定文本抽取，不要编造文本中未出现的人物或地点。
6. 输出语言与输入一致。`;
}

/**
 * User prompt（spec §5）：正文与语音转写两段素材，各截断到 EXTRACT_MAX_INPUT_CHARS，
 * 超长时声明截断（spec §5「prompt 内声明截断」，不静默截断）。
 */
export function buildExtractUserPrompt(content: string, transcript: string | null): string {
  const contentSlice = content.slice(0, EXTRACT_MAX_INPUT_CHARS);
  const transcriptSlice = (transcript ?? '').slice(0, EXTRACT_MAX_INPUT_CHARS);

  const lines: string[] = [];
  lines.push('# 时刻记录');
  lines.push('');
  lines.push('## 正文');
  lines.push(contentSlice.length === 0 ? '（无正文）' : contentSlice);
  if (content.length > contentSlice.length) {
    lines.push(`（正文超长，已截断为前 ${EXTRACT_MAX_INPUT_CHARS} 字符）`);
  }
  lines.push('');
  lines.push('## 语音转写');
  if (transcript === null) {
    lines.push('（无语音转写）');
  } else if (transcriptSlice.length === 0) {
    lines.push('（语音转写为空）');
  } else {
    lines.push(transcriptSlice);
    if (transcript.length > transcriptSlice.length) {
      lines.push(`（语音转写超长，已截断为前 ${EXTRACT_MAX_INPUT_CHARS} 字符）`);
    }
  }
  lines.push('');
  lines.push('请从以上时刻记录中抽取人物与地点，按系统要求的 JSON 结构返回。');
  return lines.join('\n');
}
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/ai-extract-hash.test.ts tests/llm/extract/prompt.test.ts`
Expected: PASS，hash 5 用例 + prompt 7 用例全过（纯单测不触库）。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/moments/ai-extract-hash.ts apps/server/src/llm/extract/prompt.ts \
  apps/server/tests/moments/ai-extract-hash.test.ts apps/server/tests/llm/extract/prompt.test.ts
git commit -m "feat(server): add ai extract prompt and content hash helpers"
```

---

### Task 2: extract.ts（LLMProvider 调用 + JSON 解析防御）

**Files:**
- Create: `apps/server/src/llm/extract/extract.ts`
- Test: `apps/server/tests/llm/extract/extract.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 Produces：`buildExtractSystemPrompt()` / `buildExtractUserPrompt(content, transcript)`（`./prompt.js`）
  - 既有：`LLMProvider` / `LLMChatRequest` / `RetryableLLMError` / `NonRetryableLLMError`（`src/llm/base.provider.js`，chat 签名 `chat(req: LLMChatRequest): Promise<LLMChatResponse>`）；`getLLMProvider(): LLMProvider | null`（`src/llm/factory.js`）
- Produces（Task 4 消费；P7 e2e 复用）:
  - `interface ExtractResult { persons: string[]; places: string[] }`
  - `parseExtractJson(raw: string): ExtractResult | null`（畸形/缺键/非数组 → null；空数组合法；非字符串成员与空白串过滤——对齐 recap `parseRecapJson` 的防御范式）
  - `extractPersonsPlaces(content: string, transcript: string | null, opts?: { provider?: LLMProvider | null }): Promise<ExtractResult>`（解析失败内部重试一次（recap 范式），两次均失败抛 `NonRetryableLLMError` 传播给 processor 退避（偏差 5）；provider.chat 抛错原样传播；`opts.provider` 是测试注入点，缺省走 `getLLMProvider()`）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/extract/extract.test.ts`（纯单测，不触库；mock provider 直传 `opts.provider`）：
```ts
import { setLLMProvider } from '../../../src/llm/factory.js';
import {
  NonRetryableLLMError,
  RetryableLLMError,
  type LLMChatRequest,
  type LLMProvider,
} from '../../../src/llm/base.provider.js';
import { extractPersonsPlaces, parseExtractJson } from '../../../src/llm/extract/extract.js';

/** mock provider 工厂：chat 返回指定原始 content，记录调用次数与请求（对齐 recap generate.test 范式）。 */
function chatReturning(
  content: string,
  counter?: { calls: number },
  captured?: LLMChatRequest[],
): LLMProvider {
  return {
    async chat(req) {
      if (counter) counter.calls += 1;
      captured?.push(req);
      return { content, model: 'mock-model', usage: { prompt: 10, completion: 5, total: 15 } };
    },
  };
}

describe('parseExtractJson（对齐 recap parseRecapJson 防御范式，spec people-place §5）', () => {
  it('合法 JSON {persons, places}', () => {
    expect(parseExtractJson('{"persons":["外婆"],"places":["朝阳公园"]}')).toEqual({
      persons: ['外婆'],
      places: ['朝阳公园'],
    });
  });

  it('markdown 代码块包裹容错（```json ... ```）', () => {
    expect(parseExtractJson('```json\n{"persons":[],"places":[]}\n```')).toEqual({
      persons: [],
      places: [],
    });
  });

  it('空数组合法（没有人物/地点，spec §5）', () => {
    expect(parseExtractJson('{"persons":[],"places":[]}')).toEqual({ persons: [], places: [] });
  });

  it('persons/places 缺失或非数组 → null', () => {
    expect(parseExtractJson('{"persons":[]}')).toBeNull();
    expect(parseExtractJson('{"places":[]}')).toBeNull();
    expect(parseExtractJson('{"persons":"外婆","places":[]}')).toBeNull();
    expect(parseExtractJson('{"persons":{},"places":[]}')).toBeNull();
  });

  it('非字符串成员与空白串过滤（防 number/boolean 混入与空名）', () => {
    const r = parseExtractJson('{"persons":["外婆", 1, null, "  "],"places":["北京", true]}');
    expect(r).toEqual({ persons: ['外婆'], places: ['北京'] });
  });

  it('非 JSON → null', () => {
    expect(parseExtractJson('not json')).toBeNull();
    expect(parseExtractJson('')).toBeNull();
  });
});

describe('extractPersonsPlaces（spec people-place §5）', () => {
  it('正常路径：system+user 两条消息调 provider，解析 persons/places', async () => {
    const counter = { calls: 0 };
    const captured: LLMChatRequest[] = [];
    const provider = chatReturning('{"persons":["外婆","朵朵"],"places":["外婆家"]}', counter, captured);

    const result = await extractPersonsPlaces('在外婆家', null, { provider });

    expect(result).toEqual({ persons: ['外婆', '朵朵'], places: ['外婆家'] });
    expect(counter.calls).toBe(1);
    expect(captured[0].messages).toHaveLength(2);
    expect(captured[0].messages[0].role).toBe('system');
    expect(captured[0].messages[0].content).toContain('persons');
    expect(captured[0].messages[1].role).toBe('user');
    expect(captured[0].messages[1].content).toContain('在外婆家'); // 素材进 user prompt
  });

  it('空数组输出合法（无人物无地点）', async () => {
    const result = await extractPersonsPlaces('普通正文', null, {
      provider: chatReturning('{"persons":[],"places":[]}'),
    });
    expect(result).toEqual({ persons: [], places: [] });
  });

  it('畸形输出重试一次：第一次畸形、第二次合法 → 返回结果、共调 2 次（recap 范式）', async () => {
    const counter = { calls: 0 };
    let first = true;
    const provider: LLMProvider = {
      async chat() {
        counter.calls += 1;
        const content = first ? 'not json {' : '{"persons":["外婆"],"places":[]}';
        first = false;
        return { content, model: 'mock-model', usage: { prompt: 1, completion: 1, total: 2 } };
      },
    };

    const result = await extractPersonsPlaces('正文', null, { provider });
    expect(result).toEqual({ persons: ['外婆'], places: [] });
    expect(counter.calls).toBe(2);
  });

  it('畸形输出两次均失败 → 抛 NonRetryableLLMError 传播（processor 退避兜底，偏差 5）', async () => {
    const counter = { calls: 0 };
    const provider = chatReturning('still not json', counter);

    await expect(extractPersonsPlaces('正文', null, { provider })).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
    expect(counter.calls).toBe(2);
  });

  it('opts.provider 为 null（调用方违约，handler 应先行跳过）→ 抛 NonRetryableLLMError', async () => {
    await expect(extractPersonsPlaces('正文', null, { provider: null })).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });

  it('provider.chat 抛 RetryableLLMError → 原样传播、不做内部重试（outbox 退避负责）', async () => {
    const counter = { calls: 0 };
    const provider: LLMProvider = {
      async chat() {
        counter.calls += 1;
        throw new RetryableLLMError('LLM 429');
      },
    };

    await expect(extractPersonsPlaces('正文', null, { provider })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    expect(counter.calls).toBe(1);
  });

  it('opts.provider 缺省走 getLLMProvider()（setLLMProvider 注入生效）', async () => {
    setLLMProvider(chatReturning('{"persons":[],"places":[]}'));
    try {
      expect(await extractPersonsPlaces('正文', null)).toEqual({ persons: [], places: [] });
    } finally {
      setLLMProvider(undefined);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/extract/extract.test.ts`
Expected: FAIL，`Cannot find module '../../../src/llm/extract/extract.js'`。

- [ ] **Step 3: 实现 extract.ts**

Create `apps/server/src/llm/extract/extract.ts`：
```ts
import { getLLMProvider } from '../factory.js';
import { NonRetryableLLMError, type LLMProvider } from '../base.provider.js';
import { buildExtractSystemPrompt, buildExtractUserPrompt } from './prompt.js';

/** LLM 抽取结果（spec people-place §5 输出契约）。空数组合法（没有人物/地点）。 */
export interface ExtractResult {
  persons: string[];
  places: string[];
}

/**
 * 解析 LLM 返回的 JSON（对齐 recap parseRecapJson 的防御范式）：
 * - 容错去除 ```json ... ``` 代码块包裹；
 * - persons/places 必须均为数组（缺一即 null），空数组合法；
 * - 非字符串成员与空白串过滤（防 number/boolean 混入与空名——词典名归一化前的第一道防御）；
 * - 任何畸形 → null（由调用方决定重试）。
 */
export function parseExtractJson(raw: string): ExtractResult | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.persons) || !Array.isArray(o.places)) return null;
    const clean = (arr: unknown[]): string[] =>
      arr
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return { persons: clean(o.persons), places: clean(o.places) };
  } catch {
    return null;
  }
}

/**
 * 从 content + transcript 抽取人物/地点（spec §5）。
 *
 * - 解析失败**内部重试一次**（对齐 recap generate 的防御范式）；两次均失败抛
 *   NonRetryableLLMError——按本计划偏差 5，错误传播给 outbox processor 走既有 5 档退避，
 *   终败仅记日志（extract 无 moment 级终态列，outbox 行状态即唯一记录）。
 * - provider.chat 抛错（Retryable/NonRetryable）原样传播，不做内部重试——可重试性
 *   分类由 processor 退避统一兜底（对齐 P3 geocode 的传播策略）。
 * - @param opts.provider 测试注入点（默认 getLLMProvider()）。调用方（handler）必须在
 *   provider 为 null 时先行跳过；null 到达此处视为调用方违约，抛错暴露而非静默降级。
 */
export async function extractPersonsPlaces(
  content: string,
  transcript: string | null,
  opts: { provider?: LLMProvider | null } = {},
): Promise<ExtractResult> {
  const provider = opts.provider !== undefined ? opts.provider : getLLMProvider();
  if (provider === null) {
    throw new NonRetryableLLMError('extract LLM provider disabled (caller must skip first)', 503);
  }

  const systemPrompt = buildExtractSystemPrompt();
  const userPrompt = buildExtractUserPrompt(content, transcript);

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await provider.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const parsed = parseExtractJson(resp.content);
    if (parsed !== null) return parsed;
    lastError = `LLM extract output parse failed (attempt ${attempt + 1})`;
  }
  throw new NonRetryableLLMError(lastError, 502);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/llm/extract/`
Expected: PASS，prompt 7 + extract 13 个用例全过。

- [ ] **Step 5: typecheck + lint**

Run: `pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/extract/extract.ts apps/server/tests/llm/extract/extract.test.ts
git commit -m "feat(server): add llm extract pipeline with json parse defense"
```

---

### Task 3: 发射侧（OUTBOX_MOMENT_EXTRACT + moment.service create/update hash 判据 + transcribe 回填补发射）

**Files:**
- Modify: `apps/server/src/outbox/types.ts`（`OUTBOX_MOMENT_EXTRACT` 一行常量 + 一个联合成员）
- Modify: `apps/server/src/moments/moment.service.ts`（create/update 落库后 hash 判据同事务发射）
- Modify: `apps/server/src/worker/handlers.ts`（`handleMomentTranscribe` 成功事务内补发射）
- Modify（既有测试回归修复，均为机械断言更新，见 Step 5）:
  - `apps/server/tests/moments/create-moment.test.ts`
  - `apps/server/tests/moments/create-voice-moment.test.ts`
  - `apps/server/tests/moments/moment-list-crud.test.ts`
- Test: `apps/server/tests/worker/moment-extract-emit.test.ts`

**Interfaces:**
- Consumes（P1/P2 Produces 逐字引用 + 既有符号）:
  - Task 1 Produces：`computeAiExtractHash(content: string, transcript: string | null): string`（`src/moments/ai-extract-hash.js`）
  - 既有：`emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>`（`src/outbox/outbox.js`）、`OutboxType`（`src/outbox/types.ts`，P2 后已含 `OUTBOX_MOMENT_GEOCODE`）、moment.service P2 后形态（create tx 内顺序：`replaceMomentTags` → `replaceMomentPersons` → geocode 发射 → `OUTBOX_MOMENT_CREATED` → voice `OUTBOX_MOMENT_TRANSCRIBE` → `return inserted`；update tx 内顺序：`replaceMomentTags` → `replaceMomentPersons` → geocode 发射 → `return row`）、`handleMomentTranscribe`（`src/worker/handlers.ts`，成功事务 CAS 块）、`Moment` 行含 `content: string` / `transcript: string | null` / `aiExtractHash: string | null`
  - 测试：`resetDb()/closeDb()`、`registerUser/createChain/insertMoment`（`tests/helpers/*.js`）、`installMockStorage` / `setStorageAdapter`（`tests/helpers/storage.js`）、`setASRProvider`（`src/llm/asr/factory.js`）
- Produces（Task 4/5 消费；P7 e2e 消费）:
  - `OUTBOX_MOMENT_EXTRACT = 'moment.extract'`（`src/outbox/types.ts`；`OutboxType` 联合新增成员）；payload 形状 `{ momentId: string }`（camelCase，偏差 1）
  - 发射行为契约：moments create 恒发（hash 恒 NULL ≠ 任意 hash，spec §5 字面）；update 落库后 `computeAiExtractHash(row.content, row.transcript) !== row.aiExtractHash` 才发；transcribe 回填成功同事务补发（spec §5 voice 独立触发）
  - `computeAiExtractHash`（Task 1 Produces 的发射侧消费落点——P5/P7 以本 Task 的发射行为为契约）

**边界（编排硬约束）**：本 Task 只做发射，不做消费（`handleMomentExtract` 属 Task 4）；不写 `ai_extract_hash` 任何值（hash 只由消费侧写）；`moment.geocode` 发射是 P2 既有逻辑，本 Task 不动。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/moment-extract-emit.test.ts`（触库；HTTP 发射断言 + transcribe 回填断言，transcribe 部分镜像 `handle-moment-transcribe.test.ts` 的造数范式）：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, moments, outbox, users } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { RetryableLLMError } from '../../src/llm/base.provider.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentTranscribe } from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  installMockStorage();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const baseBody = {
  type: 'text' as const,
  content: '在外婆家吃饭',
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

async function extractEvents() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
}

/** 直插 voice moment（pending + 1 条 ready audio），镜像 handle-moment-transcribe.test.ts 的 insertVoice。 */
async function insertVoice(): Promise<string> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: 'voice',
    content: '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: 'pending',
  });
  const audioId = randomUUID();
  await db.insert(media).values({
    id: audioId,
    momentId,
    uploaderId: userId,
    s3Key: `chains/${chainId}/${momentId}/${audioId}.wav`,
    mime: 'audio/wav',
    size: 1024,
    duration: 12,
    status: 'ready',
    storageMeta: {},
  });
  return momentId;
}

function asrReturning(text: string): ASRProvider {
  return { transcribe: async () => ({ text }) };
}

describe('发射侧：moments create/update 的 hash 判据（spec people-place §5）', () => {
  it('POST create → 同事务写 moment.extract（payload {momentId} camelCase，偏差 1）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(res.status).toBe(201);

    const events = await extractEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.extract', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId: res.body.id });
  });

  it('PATCH content 变化 → 追加一行', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);
    expect(await extractEvents()).toHaveLength(1);

    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: '改了正文，提到朵朵' });
    expect(patched.status).toBe(200);
    expect(await extractEvents()).toHaveLength(2);
    const events = await extractEvents();
    expect(events[1].payload).toEqual({ momentId: created.body.id });
  });

  it('hash 已写（消费完成形态）后：PATCH 同内容 / 仅 tagIds → 均不追加（内容没变不重抽，spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);

    // 模拟 worker 消费成功：hash 已写为当前内容的 hash
    await db
      .update(moments)
      .set({ aiExtractHash: computeAiExtractHash(baseBody.content, null) })
      .where(eq(moments.id, created.body.id));

    const sameContent = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: baseBody.content });
    expect(sameContent.status).toBe(200);
    expect(await extractEvents()).toHaveLength(1); // 不追加

    const tagOnly = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ tagIds: [] });
    expect(tagOnly.status).toBe(200);
    expect(await extractEvents()).toHaveLength(1); // 不追加
  });

  it('hash 未写时重复 PATCH 同内容 → 仍追加：发射判据是 ai_extract_hash 而非 pending 去重（偏差 8）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send(baseBody);
    expect(created.status).toBe(201);

    // hash 仍 NULL（worker 未消费）：同内容 PATCH 再发一行，消费侧 hash 幂等吸收
    const again = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: baseBody.content });
    expect(again.status).toBe(200);
    expect(await extractEvents()).toHaveLength(2);
  });
});

describe('发射侧：transcribe 回填补发射（spec §5 voice 独立触发）', () => {
  it('转写成功落 transcript 的同事务补写 moment.extract（payload {momentId}）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider(asrReturning('今天带朵朵去外婆家吃饭'));

    await handleMomentTranscribe({ momentId }, { push: mockPush });

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBe('今天带朵朵去外婆家吃饭');
    expect(m.transcriptionStatus).toBe('done');
    // voice 独立触发：否则转写文本永远进不了抽取管线（spec §5）
    const events = await extractEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.extract', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId });
  });

  it('转写失败（Retryable 传播）→ 不写 extract 行、transcript 保持 NULL（事务回滚语义）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    setASRProvider({
      transcribe: async () => {
        throw new RetryableLLMError('ASR 429');
      },
    });

    await expect(handleMomentTranscribe({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.transcript).toBeNull();
    expect(await extractEvents()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/moment-extract-emit.test.ts`
Expected: FAIL——`OUTBOX_MOMENT_EXTRACT` 不存在（TS 编译错误）或所有 `extractEvents()` 断言为 0 行（发射逻辑未实现）。红后才进 Step 3。

- [ ] **Step 3: outbox 类型常量**

Modify `apps/server/src/outbox/types.ts` — 在 `export const OUTBOX_MOMENT_GEOCODE = 'moment.geocode';`（P2 Task 3 落地）之后追加：
```ts
/** AI 文本抽取（spec people-place §5）：payload {momentId}（camelCase，P2 偏差 1 同款）；
 *  P4 moments 写路径与 transcribe 回填发射，P4 worker 消费 */
export const OUTBOX_MOMENT_EXTRACT = 'moment.extract';
```
`OutboxType` 联合在 `| typeof OUTBOX_MOMENT_GEOCODE` 之后追加 `| typeof OUTBOX_MOMENT_EXTRACT`。

- [ ] **Step 4: moment.service + handlers 发射实现**

**(a) `apps/server/src/moments/moment.service.ts`**

import 区追加（`wallDateOf` import 行之后）：
```ts
import { computeAiExtractHash } from './ai-extract-hash.js';
```
outbox 常量 import 行替换为（加 `OUTBOX_MOMENT_EXTRACT`，保持字母序）：
```ts
import {
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_DELETED,
  OUTBOX_MOMENT_EXTRACT,
  OUTBOX_MOMENT_GEOCODE,
  OUTBOX_MOMENT_TRANSCRIBE,
} from '../outbox/types.js';
```

**create()**——在 voice 转写发射块（P2 后形态）：
```ts
      if (input.type === 'voice') {
        await emitOutbox(tx, OUTBOX_MOMENT_TRANSCRIBE, { momentId });
      }
```
之后、`return inserted;` 之前追加：
```ts
      // AI 抽取（spec people-place §5）：create 时 ai_extract_hash 恒 NULL ≠ 当前内容 hash → 恒发射
      //（判据字面）。空素材（content 与 transcript 均空，如无正文 media/voice 时刻）的行由
      // handler 判空跳过、不写 hash；voice 时刻转写回填后由 transcribe 路径再次发射，转写文本必进管线。
      await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId });
```

**update()**——P2 后形态的事务尾部（personIds 替换与 geocode 发射块之后）、`return row;` 之前追加：
```ts
      // AI 抽取（spec people-place §5）：内容 hash 变化才发射。row 是本事务更新后重读的行；
      // transcript 不随 PATCH 变化（只来自 transcribe 回填路径的自有发射），判据只看组合 hash。
      // 重复 PATCH 同内容在消费前会重复发射（判据是 ai_extract_hash 而非 pending 去重，偏差 8），
      // 消费侧 hash 幂等吸收。
      if (computeAiExtractHash(row.content, row.transcript) !== row.aiExtractHash) {
        await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId });
      }
      return row;
```
（原 `return row;` 行由本块包含，勿重复。）

**(b) `apps/server/src/worker/handlers.ts`（transcribe 回填补发射）**

import 区追加（`getLLMProvider` import 行之后）：
```ts
import { computeAiExtractHash } from '../moments/ai-extract-hash.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_EXTRACT } from '../outbox/types.js';
```

`handleMomentTranscribe` 的成功事务块整体替换为（在既有两个 UPDATE 之后追加 extract 补发射；其余逻辑逐字保留）：
```ts
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(moments)
        .set({ transcript: truncated, transcriptionStatus: 'done' })
        .where(
          and(
            eq(moments.id, momentId),
            isNull(moments.deletedAt),
            eq(moments.type, 'voice'),
            eq(moments.transcriptionStatus, 'pending'),
          ),
        );
      if (result.affectedRows === 0) return;
      await tx
        .update(moments)
        .set({ content: truncated })
        .where(and(eq(moments.id, momentId), eq(moments.content, '')));
      // AI 抽取（spec people-place §5 voice 独立触发）：转写回填成功的同事务补发 moment.extract——
      // 否则 voice 时刻（content 常空、transcript 后补）只在 create 时以空素材进入管线一次，
      // 转写文本永远进不了抽取。判据同 create/update：hash 变化才发（cur 是回填后的最新行，
      // content 条件回填也计入）。
      const [cur] = await tx
        .select({ content: moments.content, transcript: moments.transcript, aiExtractHash: moments.aiExtractHash })
        .from(moments)
        .where(eq(moments.id, momentId))
        .limit(1);
      if (cur && computeAiExtractHash(cur.content, cur.transcript) !== cur.aiExtractHash) {
        await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId });
      }
    });
```

- [ ] **Step 5: 既有测试回归修复（发射新增行引起的断言更新，均为机械修改）**

P4 起 HTTP create 会多发一行 `moment.extract`，三处既有断言需同步（均已逐处核实当前代码）：

1. `apps/server/tests/moments/create-moment.test.ts`——首个用例「text moment：201，落库 + outbox(moment.created)，response 不含预签名」内（`const [event] = await db.select().from(outbox);` 所在处）：
```ts
    const [event] = await db.select().from(outbox);
```
替换为（P4 起同事务还有 moment.extract 行，无 ORDER BY 的取首行不稳定，按 type 过滤）：
```ts
    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'moment.created'));
```

2. `apps/server/tests/moments/create-voice-moment.test.ts`——voice 发布用例内：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['moment.created', 'moment.transcribe']);
```
替换为：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type).sort()).toEqual(['moment.created', 'moment.extract', 'moment.transcribe']);
```

3. `apps/server/tests/moments/moment-list-crud.test.ts`——「链内含 moments 时 owner 删链成功」用例尾部：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.created', status: 'pending' });
```
替换为（该用例的 moment 经 HTTP POST 创建，P4 起多一行 extract；该 moment 素材无人物地点，worker 判空跳过）：
```ts
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['moment.created', 'moment.extract']);
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/moment-extract-emit.test.ts tests/moments/`
Expected: PASS——新文件 6 用例全过；`tests/moments/` 全目录（含 Step 5 修复的三处）无回归。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 7: 全量回归 + typecheck + lint**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全套件绿（P2 的 `moment-persons-place.test.ts` 按 type 过滤 geocode 行不受影响；worker/processor/sweeper 测试均自建 outbox 行不受影响）。若发现**其他**既有用例因 create 多发 extract 行而红：按 Step 5 同款「按 type 过滤 / 计数 +1」机械修复并在完工报告列出，不改断言语义。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/outbox/types.ts apps/server/src/moments/moment.service.ts apps/server/src/moments/ai-extract-hash.ts \
  apps/server/src/worker/handlers.ts apps/server/tests/worker/moment-extract-emit.test.ts \
  apps/server/tests/moments/create-moment.test.ts apps/server/tests/moments/create-voice-moment.test.ts \
  apps/server/tests/moments/moment-list-crud.test.ts
git commit -m "feat(server): emit moment.extract outbox on create/update and transcribe backfill"
```

（注：`ai-extract-hash.ts` 已随 Task 1 commit；若 Task 1–3 由同一实现会话连续执行且编排者按 Task 分次 commit，此处 `git add` 含它仅为兜底——编排者按实际 diff 拆分 commit。）

---

### Task 4: 消费 handler（persistExtraction + handleMomentExtract + 注册表）

**Files:**
- Create: `apps/server/src/llm/extract/persist.ts`
- Modify: `apps/server/src/worker/handlers.ts`（`handleMomentExtract` + 注册表条目）
- Modify: `apps/server/tests/worker/handlers.test.ts`（注册表断言 7→8）
- Test: `apps/server/tests/worker/handle-moment-extract.test.ts`

**Interfaces:**
- Consumes（P1/P2/P3 Produces 逐字引用 + 本计划 Task 1/2）:
  - P2 Produces：`normalizePersonName(name: string): string`（`src/persons/person.service.ts` 导出——spec §2 名归一化唯一实现，词典 upsert 消费）；`replaceMomentPersons` **不消费**（见偏差 3，P2 Produces 明文禁止 AI 仅补缺语义复用）
  - P1 Produces：`persons` / `momentPersons`（`src/db/schema.js` barrel）；`Moment` 行 `chainId/content/transcript/aiExtractHash/placeLat/placeLng/placeName/placeSource/deletedAt`；fixtures `insertPerson(opts: { chainId: string; name: string; userId?: string | null })` / `attachPerson(momentId: string, personId: string, source?: 'manual' | 'ai')`
  - 本计划 Task 1：`computeAiExtractHash(content, transcript)`；Task 2：`extractPersonsPlaces(content, transcript, opts?)` / `ExtractResult`
  - 既有：`getLLMProvider(): LLMProvider | null`（`src/llm/factory.js`）；`OutboxHandler` 与 `handlers` 注册表（`src/worker/handlers.ts`，注册键字符串字面量，P3 后含 `'moment.geocode'`）；`runOutboxBatch` + `RETRY_DELAYS_MS` 5 档退避语义（`src/worker/processor.ts`）；`str(v)` 助手（handlers.ts 既有）
- Produces（P7 e2e 依赖）:
  - `persistExtraction(tx: DbTx, moment: { id: string; chainId: string }, extraction: ExtractResult, extractHash: string): Promise<void>`（词典 upsert（normalizePersonName + ER_DUP_ENTRY 兜底）→ moment_persons 仅补缺 insert → place 四列全空才填 `places[0]`（截断 255、source=ai）→ 写 `aiExtractHash`；调用方事务内先行完成软删/快照/hash 三重守卫）
  - `handleMomentExtract: OutboxHandler`（`src/worker/handlers.ts` 导出；注册表键 `'moment.extract'`）——P7 e2e 的「AI mock 补缺」场景经 runOutboxBatch 真实分发消费
  - 行为契约：LLM null / 软删 / 空素材 → 跳过不写 hash；hash 相同 → 短路；成功 → 词典 upsert + ai 行补缺 + place 全空才填 + hash 写回；一切错误传播退避（偏差 5）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/handle-moment-extract.test.ts`（触库；范式对齐 `handle-moment-transcribe.test.ts` / P3 的 `handle-moment-geocode.test.ts`：`setLLMProvider` 注入 mock + 直查表断言 + runOutboxBatch 集成）：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, media, momentPersons, moments, outbox, persons, users } from '../../src/db/schema.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { setASRProvider } from '../../src/llm/asr/factory.js';
import { RetryableLLMError, type LLMChatResponse, type LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { handleMomentExtract, handleMomentTranscribe } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  installMockStorage();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setLLMProvider(undefined);
  setASRProvider(undefined);
  setStorageAdapter(null);
});
afterAll(closeDb);

const DEFAULT_CONTENT = '今天在外婆家和朵朵玩，去了朝阳公园';

/** mock LLM：chat 返回指定 persons/places 的 JSON，记录调用次数。
 *  参数名用 personNames/placeNames——避免与 schema 表 `persons` 的 import 遮蔽（eslint no-shadow）。 */
function llmReturning(
  personNames: string[],
  placeNames: string[],
  counter?: { calls: number },
): LLMProvider {
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

/** 造一条 moment（默认有正文素材、hash NULL、place 全空）。 */
async function seedMoment(opts?: {
  content?: string;
  transcript?: string | null;
  deletedAt?: Date | null;
  placeLat?: number | null;
  placeLng?: number | null;
  placeName?: string | null;
  placeSource?: 'manual' | 'exif' | 'ai' | null;
}): Promise<{ momentId: string; chainId: string }> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-20T10:00:00Z'),
    content: opts?.content ?? DEFAULT_CONTENT,
  });
  await db
    .update(moments)
    .set({
      transcript: opts?.transcript === undefined ? null : opts.transcript,
      deletedAt: opts?.deletedAt ?? null,
      placeLat: opts?.placeLat === undefined ? null : opts.placeLat,
      placeLng: opts?.placeLng === undefined ? null : opts.placeLng,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      placeSource: opts?.placeSource === undefined ? null : opts.placeSource,
    })
    .where(eq(moments.id, momentId));
  return { momentId, chainId };
}

async function momentRow(momentId: string) {
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
  return m;
}

async function linkRows(momentId: string) {
  return db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 直插 voice moment（pending + 1 条 ready audio），镜像 handle-moment-transcribe.test.ts。 */
async function insertVoice(): Promise<string> {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@t.com`, passwordHash: 'x', nickname: 'u' });
  const chainId = randomUUID();
  await db
    .insert(chains)
    .values({ id: chainId, name: 'c', ownerId: userId, visibility: 'private', template: 'daily' });
  const momentId = randomUUID();
  const happenedAt = new Date('2026-08-23T02:00:00Z');
  await db.insert(moments).values({
    id: momentId,
    chainId,
    authorId: userId,
    type: 'voice',
    content: '',
    happenedAt,
    happenedTzOffset: 0,
    wallDate: wallDateOf(happenedAt, 0),
    transcriptionStatus: 'pending',
  });
  const audioId = randomUUID();
  await db.insert(media).values({
    id: audioId,
    momentId,
    uploaderId: userId,
    s3Key: `chains/${chainId}/${momentId}/${audioId}.wav`,
    mime: 'audio/wav',
    size: 1024,
    duration: 12,
    status: 'ready',
    storageMeta: {},
  });
  return momentId;
}

describe('handleMomentExtract（spec people-place §5）', () => {
  it('成功：词典 upsert 两行 + moment_persons 两行 source=ai + place 填 places[0]（source=ai 无坐标）+ hash 写回', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆', '朵朵'], ['朝阳公园']));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict.map((p) => p.name).sort()).toEqual(['朵朵', '外婆']);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const m = await momentRow(momentId);
    expect(m.placeName).toBe('朝阳公园');
    expect(m.placeSource).toBe('ai');
    expect(m.placeLat).toBeNull();
    expect(m.placeLng).toBeNull();
    expect(m.aiExtractHash).toBe(computeAiExtractHash(DEFAULT_CONTENT, null));
  });

  it('词典复用 + 名归一化：抽出名归一化后撞已有词典行 → 复用 id、不新建（spec §2/§5）', async () => {
    const { momentId, chainId } = await seedMoment();
    const existingId = await insertPerson({ chainId, name: '王叔叔' });
    setLLMProvider(llmReturning(['  王   叔叔 ', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict).toHaveLength(2); // 王叔叔复用 + 外婆新建
    const links = await linkRows(momentId);
    expect(links.map((l) => l.personId).sort()).toEqual([existingId, dict.find((p) => p.name === '外婆')!.id].sort());
  });

  it('仅补缺 / manual 不降级：已有 manual 行的 person 原行不动（source 保持 manual），只补 ai 行', async () => {
    const { momentId, chainId } = await seedMoment();
    const duoduoId = await insertPerson({ chainId, name: '朵朵' });
    await attachPerson(momentId, duoduoId, 'manual');
    setLLMProvider(llmReturning(['朵朵', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    const duoduo = links.find((l) => l.personId === duoduoId)!;
    expect(duoduo.source).toBe('manual'); // 不降级（spec §5 冲突规则）
    expect(links.find((l) => l.personId !== duoduoId)!.source).toBe('ai');
  });

  it('place 非空不覆盖：manual 名 / exif 坐标 / ai 已有名三种形态均不动（spec §5 冲突规则）', async () => {
    const manualNamed = await seedMoment({ placeName: '家', placeSource: 'manual' });
    const exifCoord = await seedMoment({ placeLat: 39.9042, placeLng: 116.4074, placeSource: 'exif' });
    const aiNamed = await seedMoment({ placeName: 'AI 上次抽的地名', placeSource: 'ai' });
    setLLMProvider(llmReturning(['外婆'], ['朝阳公园']));

    await handleMomentExtract({ momentId: manualNamed.momentId }, { push: mockPush });
    await handleMomentExtract({ momentId: exifCoord.momentId }, { push: mockPush });
    await handleMomentExtract({ momentId: aiNamed.momentId }, { push: mockPush });

    expect(await momentRow(manualNamed.momentId)).toMatchObject({ placeName: '家', placeSource: 'manual' });
    expect(await momentRow(exifCoord.momentId)).toMatchObject({ placeName: null, placeSource: 'exif' });
    expect(await momentRow(aiNamed.momentId)).toMatchObject({ placeName: 'AI 上次抽的地名', placeSource: 'ai' });
  });

  it('place 填充截断 255（worker 回填绕过 API 校验，对齐 P3 PLACE_NAME_MAX_CHARS 范式）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider(llmReturning([], ['长'.repeat(300)]));

    await handleMomentExtract({ momentId }, { push: mockPush });

    const m = await momentRow(momentId);
    expect(m.placeName).toHaveLength(255);
    expect(m.placeName).toBe('长'.repeat(255));
  });

  it('hash 幂等：同内容二投 → 第二次消费短路，不再调 LLM、行集合不变（spec §5）', async () => {
    const { momentId } = await seedMoment();
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await handleMomentExtract({ momentId }, { push: mockPush });
    await handleMomentExtract({ momentId }, { push: mockPush }); // 同内容二投

    expect(counter.calls).toBe(1);
    expect(await linkRows(momentId)).toHaveLength(1);
  });

  it('LLM_API_KEY 空（provider null）→ 消费即跳过、不写 hash、不建词典（编排硬约束）', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(null);

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).resolves.toBeUndefined();

    const m = await momentRow(momentId);
    expect(m.aiExtractHash).toBeNull();
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
  });

  it('空素材（content 与 transcript 均空）→ 跳过、不写 hash、不调 LLM（偏差 6，对齐 sweep 素材判据）', async () => {
    const { momentId } = await seedMoment({ content: '' });
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).resolves.toBeUndefined();

    expect(counter.calls).toBe(0);
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('transcript 主素材：voice 时刻 content 空、transcript 非空 → 以 transcript 抽取，hash 覆盖两者', async () => {
    const { momentId } = await seedMoment({ content: '', transcript: '带朵朵去了外婆家' });
    setLLMProvider(llmReturning(['朵朵', '外婆'], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    expect(await linkRows(momentId)).toHaveLength(2);
    const m = await momentRow(momentId);
    expect(m.aiExtractHash).toBe(computeAiExtractHash('', '带朵朵去了外婆家'));
  });

  it('moment 不存在 / 已软删 → done 跳过，不调 LLM（worker 软删竞态，编排硬约束）', async () => {
    const counter = { calls: 0 };
    setLLMProvider(llmReturning(['外婆'], [], counter));

    await expect(
      handleMomentExtract({ momentId: randomUUID() }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const deleted = await seedMoment({ deletedAt: new Date() });
    await handleMomentExtract({ momentId: deleted.momentId }, { push: mockPush });
    expect((await momentRow(deleted.momentId)).aiExtractHash).toBeNull();

    expect(counter.calls).toBe(0);
  });

  it('空抽取结果（persons/places 均空）→ 合法终态：写 hash、零副作用行', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning([], []));

    await handleMomentExtract({ momentId }, { push: mockPush });

    expect((await momentRow(momentId)).aiExtractHash).toBe(computeAiExtractHash(DEFAULT_CONTENT, null));
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
    expect(await linkRows(momentId)).toHaveLength(0);
    expect((await momentRow(momentId)).placeName).toBeNull();
  });

  it('复活语义（偏差 4）：删除后内容未变 → 不重抽、删除保持；内容变化 → 重抽复活为 ai 行', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆'], []));

    // 第一次抽取：外婆 ai 行 + hash 写回
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await linkRows(momentId)).toHaveLength(1);

    // 用户删除该 ai 行（PATCH personIds 全量替换路径的等效直删）
    await db.delete(momentPersons).where(eq(momentPersons.momentId, momentId));

    // 内容未变：再次消费 → hash 短路，行保持删除（spec §5「删除 ai 行后保持删除」）
    await handleMomentExtract({ momentId }, { push: mockPush });
    expect(await linkRows(momentId)).toHaveLength(0);

    // 内容变化（等效 PATCH content + 新事件）：重抽 → 重新落库，复活为 ai 行（spec 接受的语义）
    await db.update(moments).set({ content: '又和外婆出门了' }).where(eq(moments.id, momentId));
    await handleMomentExtract({ momentId }, { push: mockPush });
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0].source).toBe('ai');
    const dict = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(dict).toHaveLength(1); // 词典行不重复建
    expect((await momentRow(momentId)).aiExtractHash).toBe(computeAiExtractHash('又和外婆出门了', null));
  });

  it('LLM IO 期间素材变化 → 落库事务丢弃本次结果：不写 hash、不落行（stale 防御，偏差 10）', async () => {
    const { momentId } = await seedMoment();
    const started = deferred<void>();
    const result = deferred<LLMChatResponse>();
    setLLMProvider({
      chat: async () => {
        started.resolve();
        return result.promise;
      },
    });

    const handling = handleMomentExtract({ momentId }, { push: mockPush });
    await started.promise;
    // LLM IO 期间用户改了正文（变化路径会发射新事件按新内容重抽）
    await db.update(moments).set({ content: '用户改了正文' }).where(eq(moments.id, momentId));
    result.resolve({
      content: JSON.stringify({ persons: ['外婆'], places: [] }),
      model: 'mock-model',
      usage: { prompt: 1, completion: 1, total: 2 },
    });
    await handling;

    expect(await linkRows(momentId)).toHaveLength(0); // stale 结果丢弃
    expect((await momentRow(momentId)).aiExtractHash).toBeNull(); // 不写 hash
  });

  it('provider 抛 RetryableLLMError → 原样传播（processor 退避），hash 不写（偏差 5）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new RetryableLLMError('LLM 429');
      },
    });

    await expect(handleMomentExtract({ momentId }, { push: mockPush })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
    expect(await linkRows(momentId)).toHaveLength(0);
  });
});

describe('runOutboxBatch × moment.extract（注册表分发 + 既有退避终败，spec §5/偏差 5）', () => {
  async function emitExtractRow(momentId: string, over: Partial<typeof outbox.$inferInsert> = {}) {
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.extract',
      payload: { momentId },
      status: 'pending',
      ...over,
    });
  }

  it('已注册分发：成功路径经默认 handlers 表落库（词典 + ai 行 + hash）', async () => {
    const { momentId, chainId } = await seedMoment();
    setLLMProvider(llmReturning(['外婆'], ['朝阳公园']));
    await emitExtractRow(momentId);

    const result = await runOutboxBatch({ push: mockPush }); // 默认 handlers → 证明注册表条目存在
    expect(result.done).toBe(1);
    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(1);
    expect((await momentRow(momentId)).aiExtractHash).not.toBeNull();
  });

  it('失败退避：首败 attempts=1、仍 pending（既有指数退避）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new Error('LLM_DOWN');
      },
    });
    await emitExtractRow(momentId);

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.retried).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('终败：attempts=5 的行再失败 → status=failed、不重派、hash 不写（终败仅记日志，偏差 5）', async () => {
    const { momentId } = await seedMoment();
    setLLMProvider({
      chat: async () => {
        throw new Error('LLM_STILL_DOWN');
      },
    });
    await emitExtractRow(momentId, { attempts: 5 });

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.failed).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();
    expect((await momentRow(momentId)).aiExtractHash).toBeNull();
  });

  it('transcribe 回填 → extract 全链路：转写落库 + extract 行 → 消费后从 transcript 抽取人物（spec §5 voice 独立触发）', async () => {
    const momentId = await insertVoice();
    const storage = installMockStorage();
    storage.generateAccessUrl.mockResolvedValue('https://s3.example/audio.wav?signature=test');
    globalThis.fetch = (async () => new Response(new Uint8Array(100))) as typeof fetch;
    const asr: ASRProvider = { transcribe: async () => ({ text: '今天带朵朵去外婆家吃饭' }) };
    setASRProvider(asr);
    setLLMProvider(llmReturning(['朵朵', '外婆'], ['外婆家']));

    // 转写回填（Task 3 的补发射在此刻产出 moment.extract 行）
    await handleMomentTranscribe({ momentId }, { push: mockPush });
    const events = await db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
    expect(events).toHaveLength(1);

    // 常驻 worker 消费该行 → 从 transcript 抽取落库
    const result = await runOutboxBatch({ push: mockPush });
    expect(result.done).toBe(1);

    const links = await linkRows(momentId);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'ai')).toBe(true);
    const m = await momentRow(momentId);
    expect(m.placeName).toBe('外婆家');
    expect(m.placeSource).toBe('ai');
    expect(m.aiExtractHash).toBe(computeAiExtractHash('今天带朵朵去外婆家吃饭', '今天带朵朵去外婆家吃饭'));
  });
});
```

（末个用例 hash 断言说明：voice 空正文被 transcribe 条件回填，content 与 transcript 同为转写文本——这是 transcribe 既有语义，hash 按落库后的两字段计算。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-extract.test.ts`
Expected: FAIL，`handleMomentExtract` 不存在于 `src/worker/handlers.ts` 导出（TS 编译错误 `Module ... has no exported member 'handleMomentExtract'`）；`runOutboxBatch` 分发用例因 `'moment.extract'` 未注册 → 行直接 failed（与 done 断言不符）。

- [ ] **Step 3: 实现 persist.ts**

Create `apps/server/src/llm/extract/persist.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { momentPersons, moments, persons } from '../../db/schema.js';
import type { DbTx } from '../../outbox/outbox.js';
import { normalizePersonName } from '../../persons/person.service.js';
import type { ExtractResult } from './extract.js';

/** AI 抽取人物数上限：对齐 dto momentPersonIdsSchema max(20)——LLM 输出防御（偏差 9）。 */
const MAX_AI_PERSONS = 20;
/** 词典名列宽 persons.name varchar(50)（P1）；归一化后超长名丢弃（截断会产生半截人名，偏差 9）。 */
const PERSON_NAME_MAX_CHARS = 50;
/** 地名截断上限：对齐 moments.place_name varchar(255)（P3 PLACE_NAME_MAX_CHARS 同款范式）。 */
const PLACE_NAME_MAX_CHARS = 255;

/**
 * 链词典 upsert（spec §5）：名归一化后按 (chainId, name) 查，已存在复用 id，不存在插入新行。
 * 并发兜底对齐 PersonService.create：撞 uk_persons_chain_name 的 ER_DUP_ENTRY 重查返回。
 */
async function upsertPersonByName(tx: DbTx, chainId: string, name: string): Promise<string> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
    .limit(1);
  if (existing) return existing.id;

  const id = randomUUID();
  try {
    await tx.insert(persons).values({ id, chainId, name });
    return id;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [race] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
        .limit(1);
      if (race) return race.id;
    }
    throw err;
  }
}

/**
 * 抽取结果落库（spec §5 抽取内容与落库规则）。调用方必须在同一事务内先行完成
 * 软删 / 素材快照 / hash 幂等三项守卫（见 handlers.ts 的 handleMomentExtract）。
 *
 * - persons：normalizePersonName 归一化 → 去重（≤20、名长 ≤50）→ 链词典 upsert（已存在复用 id）
 *   → moment_persons **仅补缺**：已存在的关联行一律不动（manual 不降级；用户删除的 ai 行在
 *   「内容未变不重抽」下不会走到这里，内容变化重抽时复活为 ai 行是 spec 接受的语义，见偏差 4）。
 * - place：仅当四列全空（三值列 + source 同生同灭，spec §2）时填 place_name = places[0]
 *   （截断 255）、place_source='ai'（无坐标）；exif/manual/ai 已有 place 一律不覆盖
 *   （spec §5 冲突规则 manual > exif > ai）。条件 UPDATE 自带竞态防御（IO 后再校验）。
 * - 最后写 ai_extract_hash = extractHash（幂等判据收口，与落库同事务原子）。
 */
export async function persistExtraction(
  tx: DbTx,
  moment: { id: string; chainId: string },
  extraction: ExtractResult,
  extractHash: string,
): Promise<void> {
  const names = [
    ...new Set(
      extraction.persons
        .map((raw) => normalizePersonName(raw))
        .filter((name) => name.length > 0 && name.length <= PERSON_NAME_MAX_CHARS),
    ),
  ].slice(0, MAX_AI_PERSONS);

  if (names.length > 0) {
    const personIds = new Set<string>();
    for (const name of names) {
      personIds.add(await upsertPersonByName(tx, moment.chainId, name));
    }
    const existingRows = await tx
      .select({ personId: momentPersons.personId })
      .from(momentPersons)
      .where(eq(momentPersons.momentId, moment.id));
    const existing = new Set(existingRows.map((r) => r.personId));
    const missing = [...personIds].filter((id) => !existing.has(id));
    if (missing.length > 0) {
      await tx
        .insert(momentPersons)
        .values(missing.map((personId) => ({ momentId: moment.id, personId, source: 'ai' as const })));
    }
  }

  if (extraction.places.length > 0) {
    const placeName = extraction.places[0].slice(0, PLACE_NAME_MAX_CHARS);
    await tx
      .update(moments)
      .set({ placeName, placeSource: 'ai' })
      .where(
        and(
          eq(moments.id, moment.id),
          isNull(moments.placeLat),
          isNull(moments.placeLng),
          isNull(moments.placeName),
          isNull(moments.placeSource),
        ),
      );
  }

  await tx.update(moments).set({ aiExtractHash: extractHash }).where(eq(moments.id, moment.id));
}
```

- [ ] **Step 4: 实现 handler（handlers.ts 三处改动）**

**(a) import 区**——在 Task 3 追加的 `import { OUTBOX_MOMENT_EXTRACT } from '../outbox/types.js';` 之后追加：
```ts
import { extractPersonsPlaces } from '../llm/extract/extract.js';
import { persistExtraction } from '../llm/extract/persist.js';
```

**(b) handler**——在 `handleMomentGeocode` 实现（P3 落地）之后追加：
```ts
/**
 * moment.extract（spec people-place §5）：LLM 从 content + transcript 抽取人物/地点并落库。
 *
 * 流程与守卫（顺序敏感）：
 * 1. 重读 moment：不存在 / 已软删 → done 跳过（worker 软删竞态，编排硬约束）。
 * 2. getLLMProvider() 为 null（LLM_API_KEY 空停用）→ 消费即跳过，**不写 hash**——
 *    恢复 key 后内容再变化自然补抽，存量由 backfill sweep 补（spec §5）。
 * 3. 空素材（content 与 transcript 均空）→ 跳过、不写 hash（对齐 sweep 素材判据，
 *    避免空 prompt 的 LLM 调用；素材出现时由对应发射路径再触发，见偏差 6）。
 * 4. hash 幂等：computeAiExtractHash(content, transcript) === ai_extract_hash → 不重抽
 *    （同内容二投 no-op；用户删除 ai 行后内容未变即保持删除，spec §5 冲突规则）。
 * 5. extractPersonsPlaces（输入截断护栏在 prompt 内，解析失败内部重试一次）。
 * 6. 落库事务：行锁（FOR UPDATE）重读 moment → 软删/素材快照/hash 三重再校验——
 *    LLM IO 期间素材可能已变：不一致即丢弃本次结果、不写 hash（变化路径自会发射新事件
 *    按新素材重抽，见偏差 10）→ persistExtraction（词典 upsert + 仅补缺 + place 全空才填 + 写 hash）。
 *
 * 失败语义（对齐 P3 geocode，偏差 5）：本 handler 不 try/catch，一切错误（含解析终败抛出的
 * NonRetryableLLMError、provider 的 Retryable/NonRetryable）传播给 processor → 既有 5 档指数退避
 * → attempts>5 终败仅记日志不重派。extract 无 moment 级终态列（对照 transcribe 的
 * transcriptionStatus / recap 的行 status），outbox 行状态即唯一记录。
 */
export const handleMomentExtract: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  // 步骤 1：幂等 + 软删竞态防御——不存在 / 已软删直接返回（spec §5）
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  // 步骤 2：部署方停用（LLM_API_KEY 空）→ 消费即跳过，不写 hash（编排硬约束）
  const provider = getLLMProvider();
  if (!provider) return;

  // 步骤 3：空素材跳过（偏差 6）——content notNull；transcript 可 null
  const content = m.content;
  const transcript = m.transcript;
  if (content.length === 0 && (transcript ?? '').length === 0) return;

  // 步骤 4：hash 幂等——内容没变不重抽（spec §5）
  const extractHash = computeAiExtractHash(content, transcript);
  if (extractHash === m.aiExtractHash) return;

  // 步骤 5：LLM 抽取（一切错误传播给 processor 退避）
  const extraction = await extractPersonsPlaces(content, transcript, { provider });

  // 步骤 6：落库事务（行锁重读 + 三重守卫 + persistExtraction 原子落库）
  await db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(moments)
      .where(eq(moments.id, momentId))
      .for('update')
      .limit(1);
    if (!cur || cur.deletedAt) return;
    if (cur.content !== content || cur.transcript !== transcript) return; // IO 期间素材已变：丢弃（偏差 10）
    if (cur.aiExtractHash === extractHash) return; // 并发已消费同内容（防御，worker 串行下不应发生）
    await persistExtraction(tx, { id: cur.id, chainId: cur.chainId }, extraction, extractHash);
  });
};
```

**(c) 注册表**——`handlers` 对象在 `'moment.geocode': handleMomentGeocode,`（P3 落地）之后追加：
```ts
  'moment.extract': handleMomentExtract,
```

- [ ] **Step 5: 注册表测试同步（handlers.test.ts）**

Modify `apps/server/tests/worker/handlers.test.ts`：

handlers import 块的 `handleMomentTranscribe,` 之后追加一行：
```ts
  handleMomentExtract,
```

注册表用例整体替换为：
```ts
describe('handlers 注册表', () => {
  it('八种事件均已注册（moment.deleted 为 orphaned 标记实现）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(handlers['recap.generate']).toBe(handleRecapGenerate);
    expect(handlers['moment.transcribe']).toBe(handleMomentTranscribe);
    expect(handlers['moment.geocode']).toBe(handleMomentGeocode);
    expect(handlers['moment.extract']).toBe(handleMomentExtract);
    expect(Object.keys(handlers)).toHaveLength(8);
  });
});
```
并在文件头 handlers import 中补 `handleMomentGeocode`（若 P3 执行时已补则跳过）。

> 说明：P3 计划未显式列出该断言的同步（`toHaveLength(6)` → 7），P3 执行会话应已修正；若执行时发现该用例仍为 6/7 不符，按上表直接落 8（含 geocode 行）并在完工报告注明——这是机械回归修复，非语义变更。

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-extract.test.ts tests/worker/handlers.test.ts`
Expected: PASS，handler 14 用例 + runOutboxBatch 集成 4 用例 + 注册表用例全过。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 7: 全量回归 + typecheck + lint**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全部 exit 0，全套件无回归。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/extract/persist.ts apps/server/src/worker/handlers.ts \
  apps/server/tests/worker/handle-moment-extract.test.ts apps/server/tests/worker/handlers.test.ts
git commit -m "feat(server): add moment.extract worker handler to persist ai persons and place"
```

---

### Task 5: 回填 sweep（worker/extract-backfill.ts + scripts/backfill-extract.ts + package.json）

**Files:**
- Create: `apps/server/src/worker/extract-backfill.ts`
- Create: `apps/server/scripts/backfill-extract.ts`
- Modify: `apps/server/package.json`（scripts 区加 `backfill:extract`）
- Test: `apps/server/tests/worker/extract-backfill.test.ts`

**Interfaces:**
- Consumes:
  - 本计划 Task 3 Produces：`OUTBOX_MOMENT_EXTRACT = 'moment.extract'`（`src/outbox/types.ts`，只消费不改）
  - 既有：`emitOutbox` / `DbTx`（`src/outbox/outbox.js`）、`getLLMProvider()`（`src/llm/factory.js`）、`moments` 行 `content/transcript/aiExtractHash/deletedAt`、`outbox` 表（payload/status/type 列）；骨架范式对齐 `src/worker/recap-scheduler.ts`（分批扫描 + 事务内 emitOutbox + pending 去重 + 空 key 跳过）
  - 测试：`resetDb()/closeDb()`、`registerUser/createChain/insertMoment`、`runOutboxBatch`（`src/worker/processor.js`）
- Produces（P7 e2e 依赖）:
  - `runExtractBackfillSweep(opts?: { batchSize?: number; pauseMs?: number }): Promise<{ dispatched: number }>`（`src/worker/extract-backfill.ts`；扫描 `ai_extract_hash IS NULL AND deleted_at IS NULL AND (content <> '' OR (transcript IS NOT NULL AND transcript <> ''))`（偏差 11：空 transcript 视同无素材）分批写 outbox；空 key 直接返回 0；pending 去重防二跑窗口；默认 batch 100）
  - `EXTRACT_BACKFILL_DEFAULT_BATCH = 100`（`src/worker/extract-backfill.ts` 导出常量）
  - CLI：`pnpm --filter @moment/server backfill:extract -- [--batch <n>] [--interval-ms <n>]`（pnpm 裸 `--batch` 会被当 pnpm 自身选项报错，参数必须经 `--` 透传；脚本只发射不消费；实际抽取由常驻 worker 的 outbox 循环完成，`src/worker/index.ts` 不改）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/extract-backfill.test.ts`（触库；范式对齐 `tests/worker/recap-scheduler.test.ts`——sweep 只判 provider 非 null 不调 chat，注入占位 provider）：
```ts
import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments, outbox } from '../../src/db/schema.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runExtractBackfillSweep } from '../../src/worker/extract-backfill.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  // sweep 只检查 getLLMProvider() !== null，不调 chat——注入占位 provider
  //（对齐 recap-scheduler.test.ts 范式；空 key 用例在自身内部 setLLMProvider(undefined) 重置）
  setLLMProvider({} as unknown as LLMProvider);
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

async function extractRows() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
}

describe('runExtractBackfillSweep（spec people-place §5 存量回填）', () => {
  it('分批：3 条有素材时刻、batchSize=2 → 单次调用内循环派发 3 行（payload {momentId}）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertMoment({
          chainId,
          authorId: owner.id,
          happenedAt: new Date('2026-08-01T00:00:00Z'),
          content: `在外婆家第${i}天`,
        }),
      );
    }

    const result = await runExtractBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(result.dispatched).toBe(3);

    const rows = await extractRows();
    expect(rows).toHaveLength(3);
    const payloads = rows.map((r) => (r.payload as { momentId: string }).momentId).sort();
    expect(payloads).toEqual([...ids].sort());
  });

  it('素材判据（spec §5 扫描条件 + 偏差 11 空串闭合）：空正文无转写 / 已软删 / 已抽取（hash 非空）不派发；仅 transcript 有素材派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已删的素材',
      deletedAt: new Date(),
    });
    const extracted = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '已抽过' });
    await db.update(moments).set({ aiExtractHash: 'a'.repeat(64) }).where(eq(moments.id, extracted));
    const voiceOnly = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await db.update(moments).set({ transcript: '带朵朵去了外婆家' }).where(eq(moments.id, voiceOnly));

    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(1);
    const rows = await extractRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ momentId: voiceOnly });
  });

  it('空 transcript 视同无素材（偏差 11）：content 空且 transcript 空串（转写成功但无文本）不派发——防跨 run 重复派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const emptyVoice = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await db.update(moments).set({ transcript: '' }).where(eq(moments.id, emptyVoice));
    // 老条件（OR transcript IS NOT NULL）会把该行判为有素材而派发；handler 空素材跳过不写
    // hash → ai_extract_hash 恒 NULL → 每次 backfill 都重复派发（跨 run 不幂等），偏差 11 闭合。

    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(0);
  });

  it('空 key（LLM 停用）→ 直接退出：dispatched=0、不写任何 outbox 行（spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '有素材' });

    setLLMProvider(undefined); // 重置 → 真实 config（测试库空 key → null）
    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(0);
  });

  it('二跑幂等（消费后，spec §5「回填天然幂等（hash 判据）」的链路版）：第一跑派发 → mock LLM 消费写 hash → 第二跑不重扫', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '今天在外婆家',
    });

    const first = await runExtractBackfillSweep();
    expect(first.dispatched).toBe(1);

    // 常驻 worker 消费（mock LLM）→ 成功后 hash 已写——sweep 二跑的 IS NULL 判据天然排除
    setLLMProvider({
      async chat() {
        return {
          content: JSON.stringify({ persons: ['外婆'], places: [] }),
          model: 'mock-model',
          usage: { prompt: 1, completion: 1, total: 2 },
        };
      },
    });
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBe(1);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.aiExtractHash).not.toBeNull();

    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(1); // 无新行
  });

  it('pending 窗口二跑：第一跑未消费 → 第二跑去重不重复发射（对齐 recap-scheduler 范式，偏差 8）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '今天在外婆家' });

    await runExtractBackfillSweep();
    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/extract-backfill.test.ts`
Expected: FAIL，`Cannot find module '../../src/worker/extract-backfill.js'`。

- [ ] **Step 3: 实现 extract-backfill.ts**

Create `apps/server/src/worker/extract-backfill.ts`（骨架对齐 `recap-scheduler.ts` 的「扫描 → 幂等判据 → 事务内 emitOutbox」范式；一次性语义差异：无时间窗判定、循环到扫尽）：
```ts
import { and, asc, eq, gt, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments, outbox } from '../db/schema.js';
import { getLLMProvider } from '../llm/factory.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_EXTRACT } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

/** 默认批量大小（spec §5「批量大小与间隔做参数」，CLI 可覆盖）。 */
export const EXTRACT_BACKFILL_DEFAULT_BATCH = 100;

export interface ExtractBackfillOptions {
  /** 每批扫描的 moment 数上限（正整数）。 */
  batchSize?: number;
  /** 批间暂停毫秒（给共享测试库/远端 DB 留呼吸；0 = 不暂停）。 */
  pauseMs?: number;
}

/**
 * 存量回填 sweep（spec people-place §5）：扫描
 * `ai_extract_hash IS NULL AND deleted_at IS NULL
 *  AND (content <> '' OR (transcript IS NOT NULL AND transcript <> ''))`
 * 的时刻，分批写 moment.extract outbox 行。**只发射不消费**——实际抽取由常驻 worker 的
 * outbox 循环完成（本函数不被 worker/index.ts 调度，是一次性脚本的函数体）。
 *
 * 素材判据与 handler 一致（偏差 6/11）：空 transcript（转写成功但无文本）视同无素材——
 * 否则该类行 ai_extract_hash 恒 NULL，每次跑 backfill 都重复派发（跨 run 不幂等）。
 *
 * - LLM_API_KEY 空 → 直接退出（不查询不发射，spec §5）。
 * - 幂等：消费成功后 hash 已写，`IS NULL` 判据天然排除（二跑不重扫）；
 *   「发射未消费」窗口内的二跑由 pending outbox 去重吸收（对齐 recap-scheduler 的
 *   alreadyDispatched 范式，见偏差 8）。单次调用内以 moments.id 游标分页推进
 *   （gt(lastId) + orderBy(asc)）——天然终止且不产生随扫描量增长的巨型 IN 子句。
 * - @returns {dispatched} 本次派发的 outbox 行数
 */
export async function runExtractBackfillSweep(
  opts: ExtractBackfillOptions = {},
): Promise<{ dispatched: number }> {
  const batchSize = opts.batchSize ?? EXTRACT_BACKFILL_DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? 0;

  if (getLLMProvider() === null) {
    logger.info('extract backfill skipped: LLM disabled (empty LLM_API_KEY)');
    return { dispatched: 0 };
  }

  // pending 去重：进入时查一次 pending 行的 momentId 集合。sweep 运行期该集合只会因
  // 本函数自己的发射而扩大（发射前已逐行判过），无需逐批重查；跨 run 的「发射未消费」
  // 窗口由每次调用进入时的这次重查吸收（对齐 recap-scheduler 的 alreadyDispatched 范式）。
  const pendingMomentIds = new Set(
    (
      await db
        .select({ payload: outbox.payload })
        .from(outbox)
        .where(and(eq(outbox.type, OUTBOX_MOMENT_EXTRACT), eq(outbox.status, 'pending')))
    )
      .map((r) => (r.payload as { momentId?: unknown }).momentId)
      .filter((x): x is string => typeof x === 'string'),
  );

  let lastId = '';
  let dispatched = 0;
  while (true) {
    const conditions: (SQL | undefined)[] = [
      isNull(moments.aiExtractHash),
      isNull(moments.deletedAt),
      or(ne(moments.content, ''), and(isNotNull(moments.transcript), ne(moments.transcript, ''))),
    ];
    if (lastId !== '') conditions.push(gt(moments.id, lastId));
    const rows = await db
      .select({ id: moments.id })
      .from(moments)
      .where(and(...conditions))
      .orderBy(asc(moments.id))
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const { id } of rows) {
      lastId = id; // 游标推进（含 pending 跳过的行——否则同批全跳过时游标不前进会死循环）
      if (pendingMomentIds.has(id)) continue;
      await db.transaction(async (tx: DbTx) => {
        await emitOutbox(tx, OUTBOX_MOMENT_EXTRACT, { momentId: id });
      });
      dispatched++;
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  if (dispatched > 0) logger.info('extract backfill dispatched', { dispatched });
  return { dispatched };
}
```

- [ ] **Step 4: 实现 CLI 脚本**

Create `apps/server/scripts/backfill-extract.ts`（CLI 包装，对齐 `scripts/setup-s3-lifecycle.ts` 的「读 config + 顶层 await + logger」形态；参数走 `process.argv` 不落 env）：
```ts
/**
 * 一次性 AI 抽取回填（spec people-place §5 存量回填）：
 * 扫描 ai_extract_hash IS NULL 且有素材（content 非空或 transcript 非空串，偏差 11）的
 * 未软删时刻，分批写 moment.extract outbox 行。实际抽取由常驻 worker 的 outbox 消费完成
 * （本脚本只发射，不调 LLM）。
 * 幂等：消费成功后 hash 已写，二跑不重扫；未消费窗口由 sweep 内 pending 去重吸收。
 * LLM_API_KEY 空：直接退出（spec §5）。
 * 运行：pnpm --filter @moment/server backfill:extract -- [--batch 100] [--interval-ms 500]
 *（pnpm 裸 --batch 会被当 pnpm 自身选项报错，参数必须经 -- 透传）
 */
import { pool } from '../src/db/index.js';
import { logger } from '../src/utils/logger.js';
import { runExtractBackfillSweep } from '../src/worker/extract-backfill.js';

function intArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[idx + 1]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const batchSize = intArg('batch', 100);
const pauseMs = intArg('interval-ms', 500);

try {
  const result = await runExtractBackfillSweep({ batchSize, pauseMs });
  logger.info('extract backfill finished', { ...result, batchSize, pauseMs });
} catch (err) {
  logger.error('extract backfill crashed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
```

- [ ] **Step 5: package.json 脚本**

Modify `apps/server/package.json` — scripts 区在 `"setup:s3-lifecycle": "tsx scripts/setup-s3-lifecycle.ts"` 之后追加：
```json
    "backfill:extract": "tsx scripts/backfill-extract.ts"
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/extract-backfill.test.ts`
Expected: PASS，6 个用例全过（分批 / 素材判据 / 空 transcript 闭串（偏差 11）/ 空 key / 二跑幂等（消费后）/ pending 窗口二跑）。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 7: 测试库空跑演练（脚本真实执行，spec §11 P7 的前置）**

Run: `pnpm --filter @moment/server backfill:extract -- --batch 5 --interval-ms 100`
Expected: 测试库当前 moments 为空或已被消费 → 输出 `extract backfill finished` + `dispatched: <n>`（n 为测试库残留的待抽取时刻数，通常 0），exit 0。**严禁对生产库执行**——本步只在 `.env` 指向的测试库演练脚本可运行性与退出路径；规模化演练属 P7。

- [ ] **Step 8: 全量回归 + typecheck + lint**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全部 exit 0，全套件无回归。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/extract-backfill.ts apps/server/scripts/backfill-extract.ts \
  apps/server/package.json apps/server/tests/worker/extract-backfill.test.ts
git commit -m "feat(server): add one-shot extract backfill sweep script"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿，含新增：`tests/moments/ai-extract-hash.test.ts`（5）、`tests/llm/extract/prompt.test.ts`（7）、`tests/llm/extract/extract.test.ts`（13）、`tests/worker/moment-extract-emit.test.ts`（6）、`tests/worker/handle-moment-extract.test.ts`（18）、`tests/worker/extract-backfill.test.ts`（6）——新增数以各 Task Step 内 it 块为准，若有出入以实际为准并在完工报告说明
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] spec §5 逐条落实：
  - **触发与幂等**：create/update hash 判据同事务发射（create 恒发、update 内容变化才发）；voice 独立触发（transcribe 回填成功同事务补发射，测试钉死）；消费侧重读软删跳过；LLM_API_KEY 空消费即跳过**不写 hash**；内容没变不重抽（发射侧 + 消费侧 + stale 丢弃三重）
  - **抽取内容与落库规则**：prompt 输入 content+transcript、各截断 2000 字符并声明；输出 `{persons, places}`；人物人名/亲属称谓原样抽、第一/二人称不抽（prompt 规则 + 测试关键词钉死）；地点取文本原样不臆造坐标；persons 归一化 upsert 词典（复用 id）+ 仅补缺；place 仅三列全空时填 places[0]、source=ai
  - **冲突规则汇总**：manual 行不降级（仅补缺测试）；删除 ai 行后 hash 未变保持删除、内容变化重抽复活（双向测试）；place exif/manual/ai 已有不覆盖（三形态测试）
  - **成本护栏与回填**：单次输入截断；worker 串行消费（outbox 既有机制，无新增并发面）；`backfill:extract` sweep 分批、参数化、空 key 直接退出、二跑幂等（含消费后与 pending 窗口两个测试）、空 transcript 不派发（偏差 11，跨 run 幂等关键）
- [ ] 编排 T4 边界核对：`llm/extract/` 范式对齐 `llm/recap/`；hash = sha256(content + '\0' + transcript) 唯一实现；LLM mock（setLLMProvider）覆盖 upsert/仅补缺/不降级/不覆盖/hash 幂等/transcribe 触发/软删跳过；sweep 测试库二跑幂等
- [ ] 边界确认：未改 `src/worker/index.ts`、`src/config.ts`（无新环境变量）、`replaceMomentPersons`（未消费未修改）、`OUTBOX_MOMENT_GEOCODE`（只读不动）；`ai_extract_hash` 只由 `persistExtraction` 写（发射侧零写入）
- [ ] Produces 符号逐个可解析：`computeAiExtractHash` / `EXTRACT_MAX_INPUT_CHARS` / `buildExtractSystemPrompt` / `buildExtractUserPrompt` / `ExtractResult` / `parseExtractJson` / `extractPersonsPlaces` / `persistExtraction` / `handleMomentExtract`（含注册表键 `'moment.extract'`）/ `OUTBOX_MOMENT_EXTRACT`（payload `{ momentId }`）/ `runExtractBackfillSweep` / `EXTRACT_BACKFILL_DEFAULT_BATCH` / `backfill:extract` 脚本

## 写完自查（起草者已执行）

- **spec §5 覆盖**：触发与幂等（含 voice 独立触发与 transcribe 失败不发射）、抽取内容与落库规则（prompt 规则/截断声明/空数组合法/畸形防御）、冲突规则汇总三条（manual 并集共存不降级 + 删除保持/复活语义 + place 优先级不覆盖与显式清除后 AI 需内容变化才重填——后者由「place 四列全空才填」与 hash 判据共同保证）、成本护栏（截断/串行/sweep）逐条有代码与测试对应；§9（mock LLM 断言清单逐项、sweep 幂等）、§11 P4 出口标准（mock LLM 测试全绿 + sweep 二跑幂等）落实。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」/示意占位代码块；所有内嵌代码（prompt 全文、extract.ts、persist.ts、handler、transcribe 事务块、sweep、脚本、六份测试文件）均为完整可运行形态。
- **跨 Task 类型一致性**：`computeAiExtractHash(content: string, transcript: string | null)` 在 Task 1 定义、Task 3 发射侧 / Task 4 消费侧 / Task 5 测试逐字同参消费；`ExtractResult`（Task 2）被 Task 4 `persistExtraction` 与 handler 逐字消费；`OUTBOX_MOMENT_EXTRACT` payload `{ momentId }` camelCase 与偏差 1 一致；Consumes 符号与 P1（`persons`/`momentPersons`/`insertPerson`/`attachPerson`）、P2（`normalizePersonName`/`replaceMomentPersons` 不消费声明/`OUTBOX_MOMENT_GEOCODE` 已存在）、P3（`handleMomentGeocode` 锚点/退避语义）逐字核对。
- **三个定死点**：复活语义（偏差 4）、错误策略（偏差 5）、AI 落库不复用 `replaceMomentPersons`（偏差 3）——结论与理由均已在偏差节写明并配测试。

