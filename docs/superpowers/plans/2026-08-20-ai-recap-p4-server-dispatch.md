# AI 月度回顾 P4：server 派发/调度/API/扇出/分享页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/server` 落地 recap 的派发与调度：outbox `recap.generate` 类型 + `handleRecapGenerate` handler（含重试分类与 `recap.ready` 通知扇出）、`runRecapSweep` 定时扫描（每月 1 号 + 小时级 interval）、recap controller（list/get/regenerate API + 权限 + 限流）、chains `share_recaps_enabled` 列 + 分享页附最近一期 ready/degraded recap、`PublicShareResponse` 加 `recap` 字段。

**Architecture:** 派发走 outbox（`emitOutbox(tx, 'recap.generate', {chainId, period})`），worker handler `handleRecapGenerate` 消费 → 调 `generateRecap`（T3）→ 成功后 handler 内直接 `fanoutNotifications`（对齐既有 `handleMomentCreated` 范式，**非 spec §1 的第二条 outbox**——spec §1 是抽象层描述，codebase 既有范式是 handler 内直接 fanout）。调度循环（worker/index.ts）接独立小时级 interval 调 `runRecapSweep`。重生成 API 在请求事务内写 outbox 行，限流查 outbox 表当日已派发数。

**Tech Stack:** routing-controllers + TypeDI / drizzle-orm / jest + supertest（真实测试库，`--runInBand`，触库文件 `afterAll(closeDb)`）；LLM 调用全程 mock 注入（`setLLMProvider(mock)` + `afterEach(setLLMProvider(undefined))` 清理，对齐 p2 三态）。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§1 数据流、§5 成本护栏、§6 API、§8 隐私）

## Global Constraints

- 执行 prompt T4 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`；Produces 符号 `OUTBOX_RECAP_GENERATE` / `NOTIFICATION_RECAP_READY` / `handleRecapGenerate` / `runRecapSweep` / recap controller 三端点 / `share_recaps_enabled` 列 逐字不得改。
- 上游契约（已定稿）：T1 `RecapDto` / `periodSchema` / `RecapListResponse` / `PublicShareRecap`（`packages/dto/src/recaps.ts`）；T2 `getLLMProvider` / `setLLMProvider` / `NonRetryableLLMError` / `RetryableLLMError`（`apps/server/src/llm/*`）；T3 `generateRecap` / `recaps` 表（`apps/server/src/llm/recap/generate.ts` + `apps/server/src/db/schema/recaps.ts`）。
- 既有契约（CONVENTIONS §3）：`emitOutbox(tx, type, payload)` / `DbTx`（`outbox/outbox.ts`）；`OutboxHandler` 签名 + handlers 注册表 + `loadSnapshot`（`worker/handlers.ts`）；`fanoutNotifications(deps, {userIds, type, payload, push})`（`notifications/notification.service.ts`）；`ChainPolicy.require` / `requireChainRole('viewer'/'editor')`；`ShareLinkService.getSharedChain`（`share/share-link.service.ts`）。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 链权限一律走 `ChainPolicy.require` / `requireChainRole`，controller 内禁止手写角色判断（CONVENTIONS §3.1）。
- 业务错误抛 `HttpError` 系，`message` 为 UPPER_SNAKE 机器码；链内资源路由嵌套 `/api/chains/:chainId/recaps`。
- 错误码：`INVALID_PERIOD` / `RECAP_REGENERATE_LIMIT` / `RECAP_PERIOD_INACTIVE` 逐字不得改。
- 触库测试必须 `afterAll(closeDb)` + `resetDb()`；每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **handler 内直接 fanout（非 spec §1 的第二条 outbox）**：spec §1 数据流写「成功：写第二条 outbox（type = notify…）」，但 codebase 既有范式是 handler 内直接 `fanoutNotifications`（见 `handleMomentCreated`），无第二条 outbox。本计划对齐既有范式，handler 内直接 fanout，注明偏差。
2. **NonRetryableLLMError 不 rethrow（processor.ts 现状）**：读 `apps/server/src/worker/processor.ts` 后确认——其 catch 块对捕获的 err **不区分错误类型**，只要 `attempts <= 5` 就退避重试，`>5` 才 failed。故 `NonRetryableLLMError` 应**直接落 recaps status=failed（error 摘要）+ 不 rethrow**（让 outbox 标 done，避免占 5 次退避额度）；`RetryableLLMError` 才 rethrow 走 processor 退避。**该重试分类现由 `generateRecap`（p3）内部处理**（NonRetryable catch 在 generateRecap 内落 failed 正常返回；Retryable 传播），handler 不再 try/catch，只负责 fanout。依据：processor.ts L85-103 的 catch 不分类型。
3. **分享页含 degraded（S2 注，T7 回写 spec §6）**：spec §6 字面仅「附最近一期 ready 回顾」，但 §5 降级回顾「同样推送」。本计划分享页附最近一期 **ready/degraded** recap（generating/failed 不外发），注明 T7 回写 spec §6。
4. **recap.ready 通知无 momentId 故跳过去重**：`fanoutNotifications` 对 payload 无 momentId 的类型跳过去重直接插行（既有语义，见 notification.service.ts L108-111）。recap_ready payload 不含 momentId，直接插行，与既有「无 momentId 跳过去重」语义一致。

---

### Task 1: outbox/notification 类型追加 + chains 加列迁移 0012 + dto share 扩展

**Files:**
- Modify: `apps/server/src/outbox/types.ts`（追加 `OUTBOX_RECAP_GENERATE` + 联合）
- Modify: `apps/server/src/notifications/types.ts`（追加 `NOTIFICATION_RECAP_READY` + 联合）
- Modify: `apps/server/src/db/schema/chains.ts`（加 `share_recaps_enabled` 列）
- Create: `apps/server/drizzle/0012_chains_share_recaps_enabled.sql`
- Modify: `apps/server/drizzle/meta/_journal.json`、`apps/server/drizzle/meta/0012_snapshot.json`（drizzle-kit generate 产出）
- Modify: `packages/dto/src/share.ts`（`PublicShareResponse` 加 `recap?: RecapDto`）
- Test: `apps/server/tests/recaps/types-and-columns.test.ts`

**Interfaces:**
- Consumes: 既有 `OutboxType` 联合（`outbox/types.ts`）；既有 `NotificationType` 联合（`notifications/types.ts`）；`chains` schema；T1 `RecapDto`。
- Produces:
  - `OUTBOX_RECAP_GENERATE = 'recap.generate'`（`outbox/types.ts` 追加 + 加入 `OutboxType` 联合）
  - `NOTIFICATION_RECAP_READY = 'recap.ready'`（`notifications/types.ts` 追加 + 加入 `NotificationType` 联合）
  - `chains.share_recaps_enabled boolean NOT NULL DEFAULT true`（迁移 0012，纯加列有默认值，一步到位，无回填）
  - `PublicShareResponse.recap?: RecapDto`（`packages/dto/src/share.ts`）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/recaps/types-and-columns.test.ts`（触库，`afterAll(closeDb)`）：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains } from '../../src/db/schema.js';
import { OUTBOX_RECAP_GENERATE } from '../../src/outbox/types.js';
import { NOTIFICATION_RECAP_READY } from '../../src/notifications/types.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain } from '../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

describe('recap 类型常量', () => {
  it('OUTBOX_RECAP_GENERATE = recap.generate', () => {
    expect(OUTBOX_RECAP_GENERATE).toBe('recap.generate');
  });

  it('NOTIFICATION_RECAP_READY = recap.ready', () => {
    expect(NOTIFICATION_RECAP_READY).toBe('recap.ready');
  });
});

describe('chains.share_recaps_enabled 列（spec §2）', () => {
  it('默认 true（长辈收到本月回顾是最强回访钩子）', async () => {
    const chainId = await createChain(owner.id);
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId));
    expect(chain.shareRecapsEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/recaps/types-and-columns.test.ts`
Expected: FAIL，`OUTBOX_RECAP_GENERATE` / `NOTIFICATION_RECAP_READY` 未导出，`chains.shareRecapsEnabled` 列不存在（TS 编译错误）。

- [ ] **Step 3: 追加 outbox 类型**

Modify `apps/server/src/outbox/types.ts`——在 `OUTBOX_REACTION_CREATED` 行后追加：
```ts
export const OUTBOX_RECAP_GENERATE = 'recap.generate';
```
`OutboxType` 联合末尾加 `| typeof OUTBOX_RECAP_GENERATE`：
```ts
export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED
  | typeof OUTBOX_COMMENT_CREATED
  | typeof OUTBOX_REACTION_CREATED
  | typeof OUTBOX_RECAP_GENERATE;
```

- [ ] **Step 4: 追加 notification 类型**

Modify `apps/server/src/notifications/types.ts`——在 `NOTIFICATION_REACTION_CREATED` 行后追加：
```ts
export const NOTIFICATION_RECAP_READY = 'recap.ready';
```
`NotificationType` 联合末尾加 `| typeof NOTIFICATION_RECAP_READY`：
```ts
export type NotificationType =
  | typeof NOTIFICATION_MOMENT_CREATED
  | typeof NOTIFICATION_COMMENT_CREATED
  | typeof NOTIFICATION_REACTION_CREATED
  | typeof NOTIFICATION_RECAP_READY;
```

- [ ] **Step 5: chains schema 加列**

Modify `apps/server/src/db/schema/chains.ts`——`payload` 行后加：
```ts
  /** 链级开关：分享只读页是否外发最近一期 ready/degraded 回顾（spec §2/§6）。默认开（长辈收到本月回顾是最强回访钩子） */
  shareRecapsEnabled: boolean('share_recaps_enabled').notNull().default(true),
```
import 行把 `boolean` 加入 `drizzle-orm/mysql-core` 的导入列表。

- [ ] **Step 6: 生成迁移**

Run: `pnpm --filter @moment/server migrate:generate`
Expected: `drizzle/` 新增 `0012_*.sql`（0011 已被 p3 占）。纯加列有默认值，单步 `ADD COLUMN ... NOT NULL DEFAULT true`，无回填。

确认 SQL 内容形如（drizzle-kit 生成，实现 SubAgent 以实际生成为准，仅校验含 `share_recaps_enabled` + `DEFAULT true` + `NOT NULL`）：
```sql
ALTER TABLE `chains` ADD `share_recaps_enabled` boolean NOT NULL DEFAULT true;
```

Run: `pnpm --filter @moment/server migrate`
Expected: exit 0（globalSetup 也会在测试前自动跑迁移）。

- [ ] **Step 7: dto share 扩展**

Modify `packages/dto/src/share.ts`：
- import 块顶部加 `import type { RecapDto } from './recaps.js';`
- `PublicShareResponse` 末尾（`nextCursor` 之后）加：
```ts
  /** 最近一期 ready/degraded 回顾（share_recaps_enabled 开启时外发，generating/failed 不外发，spec §6） */
  recap?: RecapDto;
```

- [ ] **Step 8: 运行确认通过 + 全量回归**

Run:
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build
pnpm --filter @moment/server test -- tests/recaps/types-and-columns.test.ts
pnpm --filter @moment/server typecheck
```
Expected: dto 测试全绿 + build exit 0；types-and-columns 3 个测试全过；typecheck exit 0（`chains.shareRecapsEnabled` 列存在、`PublicShareResponse.recap` 类型可解析）。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/outbox/types.ts apps/server/src/notifications/types.ts apps/server/src/db/schema/chains.ts apps/server/drizzle/0012_*.sql apps/server/drizzle/meta/ packages/dto/src/share.ts apps/server/tests/recaps/types-and-columns.test.ts
git commit -m "feat(server): add recap outbox and notification types with share toggle column"
```

---

### Task 2: handleRecapGenerate handler（重试分类 + recap.ready 扇出）

**Files:**
- Modify: `apps/server/src/worker/handlers.ts`（加 `handleRecapGenerate` + 注册）
- Test: `apps/server/tests/worker/handle-recap-generate.test.ts`

**Interfaces:**
- Consumes: T2 `getLLMProvider` / `NonRetryableLLMError` / `RetryableLLMError`；T3 `generateRecap`；T1 `OUTBOX_RECAP_GENERATE` / `NOTIFICATION_RECAP_READY`（Task 1）；`recaps` schema（T3 p3 Task 1）；`chainMembers` / `chains` / `recaps` schema；`fanoutNotifications` / `loadSnapshot` 范式（既有 `handlers.ts`）。
- Produces:
  - `handleRecapGenerate: OutboxHandler`（handlers.ts）：payload `{chainId, period}`。
    - 调 `generateRecap(chainId, period, { provider })`（provider = `getLLMProvider()`，可能为 null → generateRecap 走降级路径 status=degraded，spec §5：降级回顾同样推送）。handler 不再 no-op 跳过 null——「停用→跳过派发」语义在 sweep 派发层。
    - **重试分类由 generateRecap 内部处理**：NonRetryableLLMError 落 failed 行正常返回（不 rethrow，不占退避额度——processor.ts L85-103 catch 不分错误类型，rethrow 会无谓重试 5 次）；RetryableLLMError 传播给 handler → processor 退避
    - 成功后查 recaps 行 status，若 ∈ {ready, degraded} → 调 `fanoutNotifications`（链全体成员，type=`NOTIFICATION_RECAP_READY`，push=true）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/handle-recap-generate.test.ts`（触库，`afterAll(closeDb)`，mock provider）：
```ts
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { notifications, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import { handleRecapGenerate } from '../../src/worker/handlers.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

let owner: TestUser;
let member: TestUser;
const mockPush = { send: jest.fn().mockResolvedValue({ invalidTokens: [] }) } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  member = await createUser(app, 'member@example.com');
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

function mockProvider(content: string, highlightIds: string[]) {
  return {
    async chat() {
      return {
        content: JSON.stringify({ content, highlight_moment_ids: highlightIds }),
        model: 'mock',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

describe('handleRecapGenerate（spec §1/§5）', () => {
  it('无效 payload（空 chainId/period）→ no-op 跳过（不写 recaps，不扇出）', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    setLLMProvider(mockProvider('不应被调用', []) as any);

    await handleRecapGenerate({ chainId: '', period: '' }, { push: mockPush });

    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0); // 未写 recaps（无效 payload 早退）
    expect(mockPush.send).not.toHaveBeenCalled();
  });

  it('成功 → recaps status=ready + fanout recap.ready 通知链全体成员（含 push）', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const { addMember } = await import('../helpers/chains.js');
    await addMember(chainId, member.id, 'viewer');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    setLLMProvider(mockProvider('## 回顾', [m1]) as any);

    await handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('ready');

    // 通知扇出：owner + member 都收到 recap.ready
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(2);
    const userIds = notifs.map((n) => n.userId).sort();
    expect(userIds).toEqual([member.id, owner.id].sort());
    // push 被调用
    expect(mockPush.send).toHaveBeenCalled();
  });

  it('provider=null 降级也扇出 recap.ready（spec §5：降级回顾同样推送）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    // provider=null → generateRecap 走降级路径（status=degraded，不调 LLM）。
    // handler 不再 no-op 跳过 null：generateRecap 落 degraded 行后 handler 查到 degraded → 扇出。
    // 这比预算降级更直接验证「degraded 也扇出」语义，且不依赖 budget（budget 经 handler 无法注入）。
    setLLMProvider(null);

    await handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('degraded');
    expect(recap.model).toBeNull();
    expect(recap.tokenUsage).toBeNull();
    // degraded 也扇出 recap.ready（spec §5：降级回顾同样推送）
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(mockPush.send).toHaveBeenCalled();
  });

  it('NonRetryableLLMError → 落 recaps status=failed + 不 rethrow（不占退避额度）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const provider = {
      async chat() {
        throw new NonRetryableLLMError('LLM 400: bad request', 400);
      },
    };
    setLLMProvider(provider as any);

    // generateRecap 自己 catch NonRetryableLLMError → 落 failed 行 + 正常返回（不 rethrow，不占退避额度）。
    // handler 不 try/catch，generateRecap 正常返回后 handler 查到 failed → 不扇出。
    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).resolves.not.toThrow();

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('failed');
    expect(recap.error).toContain('400');

    // 不扇出通知（failed 不推送，spec §5）
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(0);
  });

  it('RetryableLLMError → rethrow（走 processor 退避，不落 failed）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const provider = {
      async chat() {
        throw new RetryableLLMError('LLM 429: rate limit');
      },
    };
    setLLMProvider(provider as any);

    // RetryableLLMError 由 generateRecap 传播（不 catch）→ handler 传播 → processor 退避
    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).rejects.toThrow('429');

    // 不落 failed（generateRecap 未写行即抛出，由 processor 退避重试）
    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0);
  });

  it('generating 状态不扇出（仅 ready/degraded 扇出）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    // generateRecap 正常应落 ready/failed/degraded，不会留 generating——
    // 此 case 验证：若 recaps 行不存在（generateRecap 未写），不扇出
    // 模拟：注入 mock provider 抛 RetryableLLMError（不落库），handler rethrow
    setLLMProvider({
      async chat() { throw new RetryableLLMError('retry'); },
    } as any);

    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).rejects.toThrow();
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-recap-generate.test.ts`
Expected: FAIL，`handleRecapGenerate` 未导出（`handlers.ts` 无此函数）。

- [ ] **Step 3: 实现 handleRecapGenerate**

Modify `apps/server/src/worker/handlers.ts`：
- import 块加（合并进既有 import 行，不要新起 `import { recaps } from '../db/schema.js'`）：
```ts
import { getLLMProvider } from '../llm/factory.js';
import { generateRecap } from '../llm/recap/generate.js';
import { NOTIFICATION_RECAP_READY } from '../notifications/types.js';
```
既有 `from '../db/schema.js'` import 行（`import { chainMembers, chains, comments, media, moments, users }`）追加 `recaps`：
```ts
import { chainMembers, chains, comments, media, moments, recaps, users } from '../db/schema.js';
```
（`NonRetryableLLMError` / `RetryableLLMError` 不再 import——重试分类已移入 generateRecap，handler 不再 try/catch。）

- 文件末尾（`handlers` 注册表之前）追加 `handleRecapGenerate`：
```ts
/**
 * recap.generate（spec §1）：调 generateRecap 生成回顾，成功后扇出 recap.ready 通知。
 *
 * 重试分类现由 generateRecap 内部处理（p3）：
 * - NonRetryableLLMError：generateRecap 自己落 failed 行后正常返回（不 rethrow，让 outbox 标 done，
 *   避免占 processor 5 次退避额度——见 p3 generate.ts，与 parse 失败同范式）。
 * - RetryableLLMError：generateRecap 不 catch，传播给 handler → processor 退避。
 * 故 handler 不再 try/catch，只负责 fanout。
 *
 * provider 为 null（空 key 停用）时**不再 no-op 跳过**：自动 sweep 已在空 key 时 skip 派发
 * （recap-scheduler.ts，spec §3「扫描照常但跳过派发」），故 handler 正常不会收到 null provider。
 * null 到达 handler 的唯一场景：手动 regenerate API（POST .../regenerate）在空 key 部署触发 outbox。
 * 此时 generateRecap 走降级路径（规则文案，不调 LLM，无内容出域，spec §5）+ 扇出——用户显式请求回顾时
 * 给降级版是合理 UX。retryable 传播给 processor 退避。
 *
 * handler 内直接 fanoutNotifications（对齐 handleMomentCreated 范式，非 spec §1 的「第二条 outbox」——
 * spec §1 是抽象层描述，codebase 既有范式是 handler 内直接 fanout，注明偏差）。
 */
export const handleRecapGenerate: OutboxHandler = async (payload, deps) => {
  const chainId = str(payload.chainId);
  const period = str(payload.period);
  if (!chainId || !period) return;

  // provider 可能为 null（空 key 停用）→ generateRecap 内部走降级路径（status=degraded）。
  // generateRecap 拥有所有 recaps 行写入与重试分类；handler 只负责 fanout。
  const provider = getLLMProvider();
  // RetryableLLMError 传播给 processor 退避（不 try/catch，传播即可）
  await generateRecap(chainId, period, { provider });

  // 成功后查 status，仅 ready/degraded 扇出（spec §5：failed 不推送；generating 不应出现）
  const [recap] = await db
    .select({ status: recaps.status })
    .from(recaps)
    .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
    .limit(1);
  if (!recap || (recap.status !== 'ready' && recap.status !== 'degraded')) return;

  // 链全体成员（复用 handleMomentCreated 的成员查询范式）
  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId);
  if (targets.length === 0) return;

  const { chainName } = await loadSnapshot(chainId, []);
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_RECAP_READY,
    payload: {
      chainId,
      period,
      chainName,
      // recap_ready 无 momentId → fanoutNotifications 跳过去重直接插行（既有语义）
      title: chainName || '时刻',
      body: `${chainName} 的 ${period} 回顾出炉了`,
      data: { chainId, period },
    },
    push: true,
  });
};
```
（`and` / `eq` 已在 handlers.ts 既有 import 中，确认；若缺则补。）

- `handlers` 注册表追加：
```ts
  'recap.generate': handleRecapGenerate,
```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/worker/handle-recap-generate.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，6 个测试全过（no-op 1 + 成功扇出 1 + 降级扇出 1 + NonRetryable 1 + Retryable 1 + generating 不扇出 1）；typecheck exit 0。

> 注：「provider=null 降级也扇出」it 用 `setLLMProvider(null)` 触发 generateRecap 的 provider=null 降级路径（status=degraded，不调 LLM），验证 degraded 状态也扇出 recap.ready（spec §5）。比预算降级更直接，且不依赖 budget（budget 经 handler 无法注入——handler 不传 budgetOverride，config 默认 0=不限）。预算降级路径本身在 p3 generate.test.ts 用 `budgetOverride: 1` 验证。

- [ ] **Step 5: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有 + 新增全绿（handlers 注册表扩展后既有 handler 不回归）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/handlers.ts apps/server/tests/worker/handle-recap-generate.test.ts
git commit -m "feat(server): add recap generate handler with retry classification and fanout"
```

---

### Task 3: runRecapSweep 定时扫描 + worker interval 接入

**Files:**
- Create: `apps/server/src/worker/recap-scheduler.ts`
- Modify: `apps/server/src/worker/index.ts`（接小时级 interval 调 runRecapSweep）
- Test: `apps/server/tests/worker/recap-scheduler.test.ts`

**Interfaces:**
- Consumes: T1 `OUTBOX_RECAP_GENERATE`（Task 1）；`emitOutbox` / `DbTx`（`outbox/outbox.ts`——注意路径 `../outbox/outbox.js`，非 `./outbox.js`）；`moments` / `outbox` / `recaps` schema；`config.LLM_RECAP_TZ`（T2）；`db`。
- Produces:
  - `runRecapSweep(now: Date): Promise<{dispatched: number}>`（recap-scheduler.ts，spec §1）：
    - 判断当前是否为生成窗口（按 `LLM_RECAP_TZ` 每月 1 号——用 `Intl.DateTimeFormat` 以 LLM_RECAP_TZ 格式化 now 取月日，判断是否 1 号）
    - 找出「上月有活动」（上月 period 内存在未软删 moment）的链
    - 对尚无该 period recap 行的链幂等写 `recap.generate` outbox 行（payload `{chainId, period}`——去重：先查 recaps 是否已有该 chainId+period 行，或查 outbox 是否已有同 payload 的 pending 行）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/recap-scheduler.test.ts`（触库，`afterAll(closeDb)`）：
```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, outbox, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runRecapSweep } from '../../src/worker/recap-scheduler.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  // 注入非 null 占位 provider：sweep 只检查 getLLMProvider() !== null，不调 provider.chat，
  // 故占位即可让 6 个机制测试通过派发（空 key 测试在自身内部 setLLMProvider(undefined) 重置）。
  setLLMProvider({} as unknown as import('../../src/llm/base.provider.js').LLMProvider);
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

describe('runRecapSweep（spec §1）', () => {
  it('非 1 号 → 不派发（dispatched=0）', async () => {
    const chainId = await createChain(owner.id);
    // 上月（2026-06）有活动
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // now = 2026-07-15（非 1 号）
    const result = await runRecapSweep(new Date('2026-07-15T00:00:00Z'));
    expect(result.dispatched).toBe(0);
  });

  it('空 key（LLM 停用）→ 跳过派发 dispatched=0（spec §3：扫描照常但跳过派发）', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    setLLMProvider(undefined); // 重置 → getLLMProvider() 返回真实 config（测试库空 key → null）
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(0); // 不派发 outbox
  });

  it('每月 1 号 + 上月有活动 → 派发 recap.generate outbox（period=上月）', async () => {
    const chainId = await createChain(owner.id);
    // 2026-06 有活动
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // now = 2026-07-01（1 号，Asia/Shanghai）→ 扫描上月 = 2026-06
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(1);

    // outbox 有 recap.generate 行
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId, period: '2026-06' });
  });

  it('幂等：已有 recaps 行的链不重复派发', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // 预插 recap 行
    const { randomUUID } = await import('node:crypto');
    const now = new Date();
    await db.insert(recaps).values({
      id: randomUUID(), chainId, period: '2026-06', status: 'ready',
      content: 'x', highlights: [], model: 'm', promptVersion: 1,
      generatedAt: now, createdAt: now, updatedAt: now,
    });

    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0); // 已有 recap 行，跳过
  });

  it('幂等：已有 pending outbox 行不重复派发', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // 第一次派发
    await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    // 第二次（模拟 worker 重复扫描）
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);

    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
  });

  it('上月无活动的链不派发', async () => {
    const chainId = await createChain(owner.id);
    // 2026-05 有活动（不在上月=2026-06 范围）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-05-15T01:00:00Z') });
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);
  });

  it('多链：仅派发上月有活动的链', async () => {
    const activeChain = await createChain(owner.id, '活跃');
    const inactiveChain = await createChain(owner.id, '不活跃');
    await insertMoment({ chainId: activeChain, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    await insertMoment({ chainId: inactiveChain, authorId: owner.id, happenedAt: new Date('2026-05-15T01:00:00Z') });

    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(1);
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId: activeChain });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/recap-scheduler.test.ts`
Expected: FAIL，`Cannot find module '../../src/worker/recap-scheduler.js'`。

- [ ] **Step 3: 实现 recap-scheduler.ts**

Create `apps/server/src/worker/recap-scheduler.ts`：
```ts
import { and, eq, isNull, like, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { moments, outbox, recaps } from '../db/schema.js';
import { getLLMProvider } from '../llm/factory.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_RECAP_GENERATE } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

/** 按 LLM_RECAP_TZ 格式化 now 取「年-月-日」（spec §1：每月 1 号按此时区判定）。 */
function formatInTz(now: Date, tz: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** 上月 period（YYYY-MM）：now 在 LLM_RECAP_TZ 下的年月，取上一个月。 */
function previousPeriod(now: Date, tz: string): string {
  const { year, month } = formatInTz(now, tz);
  // 上月：month 1 → 上月 12 / year-1；其余 month-1
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/** 是否为生成窗口（LLM_RECAP_TZ 下每月 1 号，spec §1）。 */
function isGenerationWindow(now: Date, tz: string): boolean {
  return formatInTz(now, tz).day === 1;
}

/** 查该链上月是否有活动（未软删 moment 的 wall_date 落上月 period，spec §1）。 */
async function chainHasActivity(chainId: string, period: string): Promise<boolean> {
  const [row] = await db
    .select({ id: moments.id })
    .from(moments)
    .where(
      and(
        eq(moments.chainId, chainId),
        isNull(moments.deletedAt),
        like(moments.wallDate, `${period}-%`) as SQL,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** 幂等检查：该 chainId+period 是否已有 recap 行或 pending outbox 行。 */
async function alreadyDispatched(chainId: string, period: string): Promise<boolean> {
  // 查 recaps 是否已有该 chainId+period 行
  const [recap] = await db
    .select({ id: recaps.id })
    .from(recaps)
    .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
    .limit(1);
  if (recap) return true;

  // 查 outbox 是否已有同 type+payload 的 pending 行（去重）
  const pendingRows = await db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.type, OUTBOX_RECAP_GENERATE), eq(outbox.status, 'pending')));
  return pendingRows.some((r) => {
    const p = r.payload as { chainId?: string; period?: string };
    return p.chainId === chainId && p.period === period;
  });
}

/**
 * 定时扫描（spec §1）：每月 1 号（LLM_RECAP_TZ）扫描上月有活动的链，幂等派发 recap.generate。
 * 每小时检查一次（由 worker/index.ts 调度）。
 * @returns {dispatched} 本次派发的 outbox 行数
 */
export async function runRecapSweep(now: Date): Promise<{ dispatched: number }> {
  const tz = config.LLM_RECAP_TZ;
  if (!isGenerationWindow(now, tz)) {
    return { dispatched: 0 };
  }

  const period = previousPeriod(now, tz);
  // spec §3/§8：LLM_API_KEY 空 = recap 管线整体停用——调度照常触发、window 照常判定（上方已检查），
  // 但「跳过派发」：不查活动链、不写 outbox 行。本地开发默认不配置 key，sweep 每月 1 号空跑不产生任何 recap/推送。
  // spec 的「扫描照常」指调度/window 判定照常，非「活动链查询必须执行」；skip 提前省一次 DB 查询。
  if (getLLMProvider() === null) {
    logger.info('recap sweep skipped: LLM disabled (empty LLM_API_KEY)', { period });
    return { dispatched: 0 };
  }

  // 找出上月有活动的链（有未软删 moment 落该 period）
  const activeChainIds = await db
    .select({ chainId: moments.chainId })
    .from(moments)
    .where(
      and(
        isNull(moments.deletedAt),
        like(moments.wallDate, `${period}-%`) as SQL,
      ),
    )
    .groupBy(moments.chainId);

  let dispatched = 0;
  for (const { chainId } of activeChainIds) {
    if (await alreadyDispatched(chainId, period)) continue;
    // 幂等写 outbox 行（事务内）
    await db.transaction(async (tx: DbTx) => {
      await emitOutbox(tx, OUTBOX_RECAP_GENERATE, { chainId, period });
    });
    dispatched++;
  }

  if (dispatched > 0) {
    logger.info('recap sweep dispatched', { period, dispatched });
  }
  return { dispatched };
}
```

> 注：`alreadyDispatched` 的 outbox 去重查全量 pending 行再应用层比对（drizzle 的 json 列不可直接做 eq 条件，与 `notification.service.ts` 既有去重范式一致）。活动链查询用 `GROUP BY chainId` 一次取全量，避免 N 次查询。

- [ ] **Step 4: worker/index.ts 接小时级 interval**

Modify `apps/server/src/worker/index.ts`——在 `main()` 函数的 `while (running)` 循环内，sweeper 块之后追加 recap sweep 块：
```ts
import { runRecapSweep } from './recap-scheduler.js';
```
在 `main()` 的 sweeper try/catch 块之后、`await sleep(...)` 之前加：
```ts
    // recap 定时扫描（spec §1：每小时检查一次，每月 1 号派发上月有活动的链）
    if (Date.now() - lastRecapSweep >= RECAP_SWEEP_INTERVAL_MS) {
      lastRecapSweep = Date.now();
      try {
        const result = await runRecapSweep(new Date());
        if (result.dispatched > 0) {
          logger.info('recap sweep result', result);
        }
      } catch (err) {
        logger.error('recap sweep crashed', err);
      }
    }
```
在 `main()` 开头 `let lastSweep = 0;` 旁加 `let lastRecapSweep = 0;`，文件顶部常量区加：
```ts
/** recap 扫描间隔：1 小时（spec §1：每小时检查一次生成窗口） */
const RECAP_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
```

- [ ] **Step 5: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/worker/recap-scheduler.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，7 个测试全过；typecheck exit 0。

- [ ] **Step 6: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有 + 新增全绿。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/recap-scheduler.ts apps/server/src/worker/index.ts apps/server/tests/worker/recap-scheduler.test.ts
git commit -m "feat(server): add recap scheduler sweep with hourly interval"
```

---

### Task 4: recap controller + service（list/get/regenerate API + 权限 + 限流）

**Files:**
- Create: `apps/server/src/recaps/recap.controller.ts`、`apps/server/src/recaps/recap.service.ts`
- Modify: `apps/server/src/app.ts`（注册 RecapController）
- Test: `apps/server/tests/recaps/recap-api.test.ts`

**Interfaces:**
- Consumes: T1 `RecapDto` / `RecapListResponse` / `periodSchema`（`packages/dto/src/recaps.ts`）；T1 `OUTBOX_RECAP_GENERATE`（Task 1）；`emitOutbox` / `DbTx`（`outbox/outbox.ts`）；`requireChainRole` / `ChainPolicy`；`recaps` schema（T3 p3）；`moments` schema；`outbox` schema；`config`。
- Produces:
  - `GET /api/chains/:chainId/recaps`（`@UseBefore(requireChainRole('viewer'))`，period 倒序，返回 `RecapListResponse`）
  - `GET /api/chains/:chainId/recaps/:period`（period zod 校验 `periodSchema`→非法 `BadRequestError('INVALID_PERIOD')`，返回 `RecapDto`）
  - `POST /api/chains/:chainId/recaps/:period/regenerate`（`@UseBefore(requireChainRole('editor'))`，period 校验；period 必须该月有记录否则 `BadRequestError('RECAP_PERIOD_INACTIVE')`；每日每链限 3 次 `BadRequestError('RECAP_REGENERATE_LIMIT')`；事务内 `emitOutbox(tx, OUTBOX_RECAP_GENERATE, {chainId, period})`）
  - `RecapService.list(chainId)` / `getByPeriod(chainId, period)` / `regenerate(userId, chainId, period)`

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/recaps/recap-api.test.ts`（触库，`afterAll(closeDb)`）：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment, insertRecap } from '../helpers/fixtures.js';

const app = createApp();

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  viewer = await createUser(app, 'viewer@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

async function createChainWithOwner(name = '宝宝成长', template = 'baby') {
  const { createChain } = await import('../helpers/chains.js');
  return createChain(app, owner, name, template);
}

describe('GET /api/chains/:chainId/recaps（spec §6）', () => {
  it('viewer 可读 200，period 倒序', async () => {
    const chain = await createChainWithOwner();
    await insertRecap({ chainId: chain.id, period: '2026-06', status: 'ready', content: '6月' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月' });
    await addMember(chain.id, viewer.id, 'viewer');

    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toHaveLength(2);
    expect(res.body.recaps[0].period).toBe('2026-07'); // 倒序
    expect(res.body.recaps[1].period).toBe('2026-06');
  });

  it('非成员 404 CHAIN_NOT_FOUND', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(outsider));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('空列表 200', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toEqual([]);
  });
});

describe('GET /api/chains/:chainId/recaps/:period（spec §6）', () => {
  it('合法 period → 200 RecapDto', async () => {
    const chain = await createChainWithOwner();
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-07`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-07');
    expect(res.body.content).toBe('7月回顾');
    expect(res.body.status).toBe('ready');
  });

  it('非法 period → 400 INVALID_PERIOD', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-13`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PERIOD');
  });

  it('不存在的 period → 404 RECAP_NOT_FOUND', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).get(`/api/chains/${chain.id}/recaps/2026-07`).set('Authorization', auth(owner));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECAP_NOT_FOUND');
  });
});

describe('POST /api/chains/:chainId/recaps/:period/regenerate（spec §6）', () => {
  it('editor 写 outbox recap.generate → 202', async () => {
    const chain = await createChainWithOwner();
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(202);

    const { outbox } = await import('../../src/db/schema.js');
    const { db } = await import('../../src/db/index.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId: chain.id, period: '2026-07' });
  });

  it('period 无记录 → 400 RECAP_PERIOD_INACTIVE', async () => {
    const chain = await createChainWithOwner();
    // 2026-07 无记录
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECAP_PERIOD_INACTIVE');
  });

  it('每日每链限 3 次 → 第 4 次 400 RECAP_REGENERATE_LIMIT', async () => {
    const chain = await createChainWithOwner();
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
      expect(res.status).toBe(202);
    }
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RECAP_REGENERATE_LIMIT');
  });

  it('viewer 不可重生成 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const chain = await createChainWithOwner();
    await addMember(chain.id, viewer.id, 'viewer');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`).set('Authorization', auth(viewer));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非法 period → 400 INVALID_PERIOD', async () => {
    const chain = await createChainWithOwner();
    const res = await request(app).post(`/api/chains/${chain.id}/recaps/invalid/regenerate`).set('Authorization', auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PERIOD');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/recaps/recap-api.test.ts`
Expected: FAIL，路由 404（RecapController 未注册）。

- [ ] **Step 3: 实现 recap.service.ts**

Create `apps/server/src/recaps/recap.service.ts`：
```ts
import type { RecapDto, RecapListResponse } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, like, type SQL } from 'drizzle-orm';
import { BadRequestError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { moments, outbox, recaps } from '../db/schema.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_RECAP_GENERATE } from '../outbox/types.js';

const RECAP_REGENERATE_DAILY_LIMIT = 3;

function toDto(row: typeof recaps.$inferSelect): RecapDto {
  return {
    id: row.id,
    chainId: row.chainId,
    period: row.period,
    status: row.status,
    content: row.content,
    highlights: row.highlights,
    model: row.model,
    promptVersion: row.promptVersion,
    tokenUsage: row.tokenUsage,
    error: row.error,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Service()
export class RecapService {
  /** 列表（period 倒序，spec §6：无分页——每链每月至多一条） */
  async list(chainId: string): Promise<RecapListResponse> {
    const rows = await db
      .select()
      .from(recaps)
      .where(eq(recaps.chainId, chainId))
      .orderBy(desc(recaps.period));
    return { recaps: rows.map(toDto) };
  }

  /** 单条详情（period 校验在 controller 层） */
  async getByPeriod(chainId: string, period: string): Promise<RecapDto> {
    const [row] = await db
      .select()
      .from(recaps)
      .where(and(eq(recaps.chainId, chainId), eq(recaps.period, period)))
      .limit(1);
    if (!row) throw new NotFoundError('RECAP_NOT_FOUND');
    return toDto(row);
  }

  /**
   * 重生成（spec §6）：事务内写 outbox recap.generate。
   * - period 必须该月有记录（wall_date 落 period 且未软删）否则 RECAP_PERIOD_INACTIVE
   * - 每日每链限 3 次（查 outbox 当日已派发的 recap.generate 行数）否则 RECAP_REGENERATE_LIMIT
   */
  async regenerate(chainId: string, period: string): Promise<void> {
    // period 必须该月有记录（wall_date 落 period 且未软删，spec §6）
    const [active] = await db
      .select({ id: moments.id })
      .from(moments)
      .where(
        and(
          eq(moments.chainId, chainId),
          isNull(moments.deletedAt),
          like(moments.wallDate, `${period}-%`) as SQL,
        ),
      )
      .limit(1);
    if (!active) throw new BadRequestError('RECAP_PERIOD_INACTIVE');

    // 每日每链限 3 次（spec §6）
    if (await this.countTodayDispatches(chainId) >= RECAP_REGENERATE_DAILY_LIMIT) {
      throw new BadRequestError('RECAP_REGENERATE_LIMIT');
    }

    await db.transaction(async (tx: DbTx) => {
      await emitOutbox(tx, OUTBOX_RECAP_GENERATE, { chainId, period });
    });
  }

  /**
   * 查当日该链已派发的 recap.generate outbox 行数。
   * drizzle 对 json 列不可直接 eq（与 notification.service.ts 既有 json 去重范式一致），
   * 取回应用层过滤 chainId + 当日（当日 recap.generate 行数极少，可接受）。
   */
  private async countTodayDispatches(chainId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ payload: outbox.payload, createdAt: outbox.createdAt })
      .from(outbox)
      .where(eq(outbox.type, OUTBOX_RECAP_GENERATE));
    return rows.filter((r) => {
      const p = r.payload as { chainId?: string };
      return p.chainId === chainId && r.createdAt.getTime() >= todayStart.getTime();
    }).length;
  }
}
```

- [ ] **Step 4: 实现 recap.controller.ts**

Create `apps/server/src/recaps/recap.controller.ts`：
```ts
import { periodSchema, type RecapDto, type RecapListResponse } from '@moment/dto';
import { BadRequestError } from 'routing-controllers';
import { Authorized, Body, CurrentUser, Get, HttpCode, JsonController, Param, Post, UseBefore } from 'routing-controllers';
import type { UserProfile } from '@moment/dto';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { RecapService } from './recap.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1：链内资源一律嵌套） */
@JsonController('/chains/:chainId/recaps')
@Service()
export class RecapController {
  constructor(private readonly recapService: RecapService) {}

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Param('chainId') chainId: string): Promise<RecapListResponse> {
    return this.recapService.list(chainId);
  }

  @Get('/:period')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  async getByPeriod(@Param('chainId') chainId: string, @Param('period') period: string): Promise<RecapDto> {
    const parsed = periodSchema.safeParse(period);
    if (!parsed.success) throw new BadRequestError('INVALID_PERIOD');
    return this.recapService.getByPeriod(chainId, parsed.data);
  }

  @Post('/:period/regenerate')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  @HttpCode(202)
  async regenerate(@Param('chainId') chainId: string, @Param('period') period: string): Promise<void> {
    const parsed = periodSchema.safeParse(period);
    if (!parsed.success) throw new BadRequestError('INVALID_PERIOD');
    await this.recapService.regenerate(chainId, parsed.data);
  }
}
```
> 注：`regenerate` 不需要 `@CurrentUser`（角色已由 `requireChainRole('editor')` 中间件保证）；`@Body()` 不需要（无 body）。import 块的 `Body` / `CurrentUser` 若未使用则删除以过 lint。

- [ ] **Step 5: 注册 controller**

Modify `apps/server/src/app.ts`：
- import 区追加 `import { RecapController } from './recaps/recap.controller.js';`
- `controllers: [...]` 数组末尾追加 `RecapController`

- [ ] **Step 6: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/recaps/recap-api.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，11 个测试全过（list 3 + get 3 + regenerate 5）；typecheck exit 0。

- [ ] **Step 7: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有 + 新增全绿。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/recaps/ apps/server/src/app.ts apps/server/tests/recaps/recap-api.test.ts
git commit -m "feat(server): add recap API with list get and regenerate endpoints"
```

---

### Task 5: 分享页附 recap（share_recaps_enabled 开关 + ready/degraded 外发）

**Files:**
- Modify: `apps/server/src/share/share-link.service.ts`（`getSharedChain` 在 `share_recaps_enabled` 时附最近一期 ready/degraded recap）
- Test: `apps/server/tests/share/public-share-recap.test.ts`

**Interfaces:**
- Consumes: T1 `chains.shareRecapsEnabled` 列（Task 1）；`recaps` schema（T3 p3）；`PublicShareResponse.recap` 字段（Task 1 dto）。
- Produces: `ShareLinkService.getSharedChain` 在 `chains.share_recaps_enabled` 为 true 时附最近一期 **ready/degraded** recap（按 period 倒序取第一条；generating/failed 不外发，spec §6 + S2 注）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/share/public-share-recap.test.ts`（触库，`afterAll(closeDb)`）：
```ts
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain } from '../helpers/chains.js';
import { insertMoment, insertRecap } from '../helpers/fixtures.js';
import { db } from '../../src/db/index.js';
import { chains } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const app = createApp();

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

async function shareToken(chainId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/share-links`)
    .set('Authorization', auth(owner))
    .send({});
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('GET /api/public/share/:token 附 recap（spec §6 + S2）', () => {
  it('share_recaps_enabled=true + 有 ready recap → 响应含 recap', async () => {
    const chain = await createChain(app, owner, '宝宝', 'baby');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeTruthy();
    expect(res.body.recap.period).toBe('2026-07');
    expect(res.body.recap.status).toBe('ready');
    expect(res.body.recap.content).toBe('7月回顾');
  });

  it('含 degraded recap（S2 注：降级回顾同样外发）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'degraded', content: '降级回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeTruthy();
    expect(res.body.recap.status).toBe('degraded');
  });

  it('generating/failed 不外发（recap 为 undefined）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'failed', content: '', error: 'err' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });

  it('取最近一期（period 倒序第一条）', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-01T01:00:00Z'), content: '6月' });
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '7月' });
    await insertRecap({ chainId: chain.id, period: '2026-06', status: 'ready', content: '6月回顾' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.body.recap.period).toBe('2026-07'); // 最近一期
  });

  it('share_recaps_enabled=false → 不外发 recap', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    await insertRecap({ chainId: chain.id, period: '2026-07', status: 'ready', content: '7月回顾' });
    // 关闭开关
    await db.update(chains).set({ shareRecapsEnabled: false }).where(eq(chains.id, chain.id));
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });

  it('无 recap → recap undefined', async () => {
    const chain = await createChain(app, owner, '日常');
    await insertMoment({ chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const token = await shareToken(chain.id);

    const res = await request(app).get(`/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recap).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/share/public-share-recap.test.ts`
Expected: FAIL，`res.body.recap` 为 undefined（`getSharedChain` 未附 recap）。

- [ ] **Step 3: 修改 share-link.service.ts**

Modify `apps/server/src/share/share-link.service.ts`：
- import 块加 `import { recaps } from '../db/schema.js';`（合并进既有 `from '../db/schema.js'` 导入列表）
- import 块加 `import { and, desc, eq, inArray } from 'drizzle-orm';`（确认 `and` / `inArray` 是否已在既有 import，缺则补；`desc` / `eq` 已有）
- `getSharedChain` 方法的 chain 查询改为取 `shareRecapsEnabled`：
```ts
    const [chain] = await db
      .select({ name: chains.name, description: chains.description, template: chains.template, shareRecapsEnabled: chains.shareRecapsEnabled })
      .from(chains)
      .where(eq(chains.id, link.chainId))
      .limit(1);
```
- return 之前追加 recap 查询：
```ts
    // 附最近一期 ready/degraded recap（spec §6 + S2 注：含 degraded，T7 回写 spec §6）
    let recap: typeof recaps.$inferSelect | undefined;
    if (chain.shareRecapsEnabled) {
      const [latest] = await db
        .select()
        .from(recaps)
        .where(
          and(
            eq(recaps.chainId, link.chainId),
            inArray(recaps.status, ['ready', 'degraded']),
          ),
        )
        .orderBy(desc(recaps.period))
        .limit(1);
      recap = latest;
    }
```
- return 对象末尾（`nextCursor` 之后）追加 `recap` 字段：
```ts
      ...(recap ? {
        recap: {
          id: recap.id,
          chainId: recap.chainId,
          period: recap.period,
          status: recap.status,
          content: recap.content,
          highlights: recap.highlights,
          model: recap.model,
          promptVersion: recap.promptVersion,
          tokenUsage: recap.tokenUsage,
          error: recap.error,
          generatedAt: recap.generatedAt ? recap.generatedAt.toISOString() : null,
          createdAt: recap.createdAt.toISOString(),
          updatedAt: recap.updatedAt.toISOString(),
        },
      } : {}),
```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/share/public-share-recap.test.ts
pnpm --filter @moment/server typecheck
```
Expected: PASS，6 个测试全过；typecheck exit 0。

- [ ] **Step 5: 全量回归 + lint**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server lint
```
Expected: 全绿——既有 + 本计划新增（Task 1 的 3 + Task 2 的 6 + Task 3 的 7 + Task 4 的 11 + Task 5 的 6 = 33）；lint exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/share/share-link.service.ts apps/server/tests/share/public-share-recap.test.ts
git commit -m "feat(server): attach recap to share page with toggle"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿（既有 + 本计划新增 33 个：Task 1 三、Task 2 六、Task 3 七、Task 4 十一、Task 5 六——新增数以各 Task Step 内 it/test 块为准，若有出入以实际为准并在完工报告说明）
- [ ] `pnpm --filter @moment/dto test` 全绿 + `pnpm --filter @moment/dto build` exit 0（`PublicShareResponse.recap` 类型可生成）
- [ ] `pnpm --filter @moment/server typecheck` exit 0
- [ ] `pnpm --filter @moment/server lint` exit 0
- [ ] `drizzle/0012_*.sql` 为 `ADD COLUMN chains.share_recaps_enabled boolean NOT NULL DEFAULT true`，`pnpm --filter @moment/server migrate` exit 0
- [ ] spec §1（数据流：扫描→派发→消费→扇出）、§5（重试分类：NonRetryable 不占退避 / Retryable 退避）、§6（API：list/get/regenerate + 权限 + 限流 + period 校验 + 分享开关）逐一落实
- [ ] 执行 prompt T4 的 Produces 符号逐个可解析：`OUTBOX_RECAP_GENERATE` / `NOTIFICATION_RECAP_READY` / `handleRecapGenerate` / `runRecapSweep` / RecapController 三端点 / `share_recaps_enabled`
- [ ] S2 注落实：分享页含 degraded（ready/degraded 外发，generating/failed 不外发），注明 T7 回写 spec §6
- [ ] spec 偏差已注明：handler 内直接 fanout（非第二条 outbox）；NonRetryable 不 rethrow（processor.ts 现状 L85-103）；recap_ready 无 momentId 跳过去重（既有语义）
