# 链排序（per-user）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web 端链列表支持 per-user 拖拽排序：`chain_members` 加 `sort_order` 列持久化「我 × 链」顺序（含老数据回填），`listMine` 按它排序，新链/新入链置顶（min-1），新增 `PUT /api/chains/order` 全量重写端点，web Shell 侧栏（纵向）与顶部 chips（横向）共用一套 pointer 手势拖拽 + 乐观更新提交，失败 toast 并回滚。RN app 零改动，下次拉取自动获得新顺序。

**Architecture:** 顺序挂在 `chain_members.sort_order`（int，越小越靠前，允许负数，无唯一约束）→ `ChainService.listMine` 改为 `ORDER BY sort_order ASC, created_at DESC` → `create`/`acceptInvite` 在各自事务内取 `min(sortOrder)-1` 置顶（首链 = 1）→ `PUT /api/chains/order` 在单事务内做「去重集合恰好等于我的全部链」校验 + `WHERE user_id AND chain_id IN (:ids)` 逐行重写，固定 204 → web `ChainListService.reorder` 乐观更新 + 在途引用计数抑制并发 `load()` 写回 + 收尾统一 `load()` 收敛/回滚 → Shell 两处列表共用 `ChainNavList`：手势状态机在 `src/lib/chain-reorder.ts`（纯逻辑单测），组件层只做 DOM 接线（draggable=false、touchmove preventDefault、contextmenu 捕获 suppress + ContextMenu ref 关闭、click 抑制）。

**Tech Stack:** zod ^3（dto）/ routing-controllers + TypeDI + Drizzle + mysql2 + Jest（supertest 触远程共享测试库，`--runInBand`）（server）/ React 19 + @rabjs/react + Vitest + jsdom（web）/ pointer events 手写手势（不用 HTML5 DnD）。

**Spec:** `docs/superpowers/specs/2026-08-24-chain-ordering-design.md`（唯一真相源；本计划不超出其范围）

## Global Constraints

- **迁移编辑时序硬约束（spec §2，最高优先级）**：`drizzle-kit generate` 产出 0014 后必须**立即**追加回填 SQL，且在任何环境（含远程共享测试库）首次执行该迁移**之前**完成——drizzle 迁移 hash 由运行时按文件内容计算，某个环境先跑了无回填版本会造成 hash 分叉。Task 3 中 generate → append 之间**禁止**运行任何会执行迁移的命令（`pnpm migrate` / `pnpm --filter @moment/server test`（jest globalSetup 自动 migrate）/ `pnpm dev` / 任何部署）；且远程共享测试库的首跑必须排在**本地 docker 回填验证通过之后**（spec §2「实现时先验证再跑迁移」）——顺序为 generate → append → docker 验证 → 远程首跑，若 docker 验证发现回填 SQL 有误，远程库尚未记录任何版本，改完重新验证即可，不会 hash 分叉。docker 验证命令必须带 `SKIP_GLOBAL_MIGRATE=1`：jest globalSetup（`tests/global-setup.ts`）对每次 server jest 调用无条件先对远程库跑 migrate，Task 3 Step 6 给该文件加的环境守卫是闸门成立的机制前提。
- **不新增表、不新增环境变量**：`config.ts` / `.env.example` 不动；`resetDb()` 无需扩展（`sort_order` 随 `chain_members` 行一起被既有 delete 清理，spec §8）。
- **`ChainDto` 不暴露 `sortOrder`**：spec §5 未把它放进响应契约，顺序只能经列表顺序观察；server 测试直接查库断言列值。
- **迁移回填验证（Task 5）是触库规则的唯一例外**：不 import `src/db`（其 pool 指向 `.env` 远程测试库）、不打远程共享库；`RUN_MIGRATION_IT=1` 门控（沿用 `tests/storage/s3-it.test.ts` 的 `RUN_S3_IT` 先例），本地 docker compose MySQL 8.4 起临时 schema，跑完 DROP。
- **web 拖拽视觉只消费既有 tokens 与 Tailwind 刻度值**（`bg-action` / `opacity-50` / `h-0.5` / `w-0.5`），不新增 token、不写一次性像素值、不改 `package.json` scripts / `vitest.config.ts`（`.claude/rules/web-ui.md`）。
- **RN app 零改动**（spec §1）；compose 面板 / moment sheet 只消费 `ChainListService.chains`，顺序自动生效，无代码改动（spec §6.4）。
- 新路由 `PUT /api/chains/order` 落在 CONVENTIONS §3.6 Phase 2 的 `/api/chains*` 命名空间内，不与其他计划撞车。

**Spec 引用与实现取舍（逐条注明）：**

1. **toast 由组件层触发，service 以 reject 传递失败**：spec §6.3 把「toast 错误」写在 `ChainListService.reorder` 流程内；仓内既有约定是 service 抛错、组件 `useToast()` 弹（`pages/chain-settings/sections.tsx` 的 `saveProfile().then(toast).catch()` 模式），`useToast` 是 React hook 无法从 rab Service 调用。`reorder` 失败时先回滚再 reject，Task 9 的 `ChainNavList` catch 后 `toast.show`；service 测试（Task 6）以「reject + 回滚」覆盖 spec §7「失败回滚 + toast」的可测部分。
2. **迁移回填验证直读迁移 SQL 文件顺序执行，不经过 drizzle migrator/journal**：spec §7 允许「子进程跑 migrate 脚本或直接调 migrator」；直接按 journal 顺序执行 `.sql` 文件（`--> statement-breakpoint` 切分）更精确地复现「旧 schema → 旧数据 → 新迁移」时序，且与被验证的产物（SQL 文本）零距离。
3. **reorder 重写用事务内逐行 UPDATE（≤200 行）而非单条 CASE WHEN**：spec §5.2 只约束 `WHERE user_id AND chain_id IN (:chainIds)` 的作用域，不约束 SQL 形态；逐行 UPDATE 空数组天然安全（CASE 空拼接是非法 SQL）、可读性/可测性优先。
4. **ContextMenu 互斥选「受控开关」路线**（spec §6.2c 给出的两个实现钩子之一）：`ContextMenu` 增加可选 `ref` 句柄暴露 `close()`（React 19 ref-as-prop，与 `Menu.tsx` 内 Pressable 的 ref 透传一致）；捕获阶段 suppress 由拖拽接线层在 NavLink 上做。既有调用方零影响（ref 可选）。
5. **touch/pen armed 后的激活同样过 6px 阈值**：spec §6.2b 只写「armed 后移动才激活」，未给数值；统一沿用 mouse 的 6px 阈值，避免手指微抖即激活导致长按菜单被误关。
6. **Task 9 toast 调用行无自动化测试覆盖**（已记录，接受）：`chain-nav-list.tsx` 里 `list.reorder(...).catch(() => t.show({ key: 'chain-reorder-failed', message: '链顺序保存失败，已恢复原顺序' }))` 这一行按 spec §7「DOM 拖拽本身不做 jsdom 仿真」不进组件测试；已核实 `ToastInput` 形状为 `{ key, message, action? }`，用法与仓内既有调用（`pages/chain-settings/sections.tsx` 的 `toast.show({ key: 'settings-saved', message: ... })`）一致，service 侧的失败路径已由 Task 6 的「reject + 回滚」用例覆盖。
7. **Task 6 收尾 load 失败时的 toast 文案在该场景误导但无害**（已记录，接受）：`reorder` 的收尾 `load()` 若失败（PUT 已成功、收敛请求网络故障），promise reject，调用方 toast「链顺序保存失败，已恢复原顺序」——实际 PUT 已成功且 `this.chains` 恰停在正确的乐观顺序，文案两旬皆不准；但状态正确、下一次 `chain:changed`/进站 load 自愈，不为此引入第三种结果态。
8. **触屏 contextmenu 弹出瞬间平台可能补发 pointercancel 的继承风险**（已记录，接受）：长按计时到达、菜单弹出的瞬间，部分平台会对当前 pointer 流补发 pointercancel——按 Task 7 状态机此时手势在 pending（armed），pointercancel 走 `onAbort` 静默清理，语义正确（用户本就在用菜单）；真正的风险是「菜单弹出后用户继续移动想拖拽」的时序差异，无法单测仿真，故 Task 9 Step 6 手动验收第 3 条（真机触屏长按 → 移动进入拖拽）被要求**组件落地后第一时间验**（spec §6.2c 的 flicker 取舍同此）。

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/dto/src/chains.ts` | `reorderChainsInputSchema` + `ReorderChainsInput` | Modify |
| `packages/dto/src/chains.test.ts` | schema 边界用例 | Modify |
| `packages/api-client/src/client.ts` | `reorderChains` 方法（interface + 实现） | Modify |
| `packages/api-client/src/client.test.ts` | 路由对齐断言扩展 | Modify |
| `apps/server/src/db/schema/chain-members.ts` | `sortOrder` 列 | Modify |
| `apps/server/drizzle/0014_<random>.sql` | generate 的 ADD COLUMN + 手追加回填 UPDATE | Create（generate + 编辑） |
| `apps/server/drizzle/meta/_journal.json` / `0014_snapshot.json` | generate 产物 | Modify / Create |
| `apps/server/src/chains/chain.service.ts` | listMine 排序 / create·acceptInvite 置顶 / reorder | Modify |
| `apps/server/src/chains/chains.controller.ts` | `PUT /order` 路由 | Modify |
| `apps/server/tests/chains/schema.test.ts` | 列默认值断言 | Modify |
| `apps/server/tests/chains/chains.ordering.test.ts` | 排序/置顶/reorder 触库测试 | Create |
| `apps/server/tests/migrations/chain-members-sort-order-backfill.test.ts` | 迁移回填验证（本地 docker 临时 schema） | Create |
| `apps/web/src/services/chain-list.service.ts` | `reorder` + load 写回抑制 | Modify |
| `apps/web/src/services/chain-list.service.test.ts` | 乐观/回滚/竞态/重入 | Create |
| `apps/web/src/lib/chain-reorder.ts` | 手势状态机 + moveItem/insertionIndex 纯逻辑 | Create |
| `apps/web/src/lib/chain-reorder.test.ts` | 状态机单测（含副指针忽略） | Create |
| `apps/web/src/ui/menu/Menu.tsx` / `index.ts` | ContextMenu 可选 ref 句柄 `close()` | Modify |
| `apps/web/src/ui/menu/Menu.test.tsx` | ref 关闭用例 | Modify |
| `apps/web/src/shell/chain-nav-list.tsx` | 共用拖拽列表组件（DOM 接线） | Create |
| `apps/web/src/shell/Shell.tsx` | 两处 chains.map 换 ChainNavList | Modify |
| `apps/web/src/shell/shell-navigation.test.tsx` | renderShell 包 ToastProvider | Modify |

---

### Task 1: dto 契约 — `reorderChainsInputSchema`

**Files:**
- Modify: `packages/dto/src/chains.ts`
- Test: `packages/dto/src/chains.test.ts`（扩展既有文件，不触库）

**Interfaces:**
- Consumes: 无（纯 zod 新增）。
- Produces（Task 2/4 消费，不得改名）:
  - `reorderChainsInputSchema: z.ZodObject<{ chainIds: z.ZodArray<z.ZodString> }>`——`chainIds: z.array(z.string().min(1).max(36)).max(200)`，数组允许为空（spec §5：无链用户的空数组是合法恒等提交）。
  - `type ReorderChainsInput = z.infer<typeof reorderChainsInputSchema>`（`{ chainIds: string[] }`）。

- [ ] **Step 1: 写失败测试**

在 `packages/dto/src/chains.test.ts` 的 import 块追加 `reorderChainsInputSchema,`，文件末尾追加：

```ts
test('reorderChainsInputSchema：正常与空数组（无链用户恒等提交）通过', () => {
  assert.deepEqual(reorderChainsInputSchema.parse({ chainIds: ['a', 'b'] }), { chainIds: ['a', 'b'] });
  assert.deepEqual(reorderChainsInputSchema.parse({ chainIds: [] }), { chainIds: [] });
});

test('reorderChainsInputSchema：200 条恰好通过；36 字符 id 恰好通过', () => {
  assert.ok(
    reorderChainsInputSchema.safeParse({ chainIds: Array.from({ length: 200 }, (_, i) => `c${i}`) }).success,
  );
  assert.ok(reorderChainsInputSchema.safeParse({ chainIds: ['x'.repeat(36)] }).success);
});

test('reorderChainsInputSchema：拒绝空 id、超 36 字符 id、超 200 长度、缺键/非数组', () => {
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: [''] }));
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: ['x'.repeat(37)] }));
  assert.throws(() =>
    reorderChainsInputSchema.parse({ chainIds: Array.from({ length: 201 }, (_, i) => `c${i}`) }),
  );
  assert.throws(() => reorderChainsInputSchema.parse({}));
  assert.throws(() => reorderChainsInputSchema.parse({ chainIds: 'c1' }));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL——`reorderChainsInputSchema is not defined`（import 的符号尚不存在，整个文件编译失败即红灯）。

- [ ] **Step 3: 实现 schema**

Modify `packages/dto/src/chains.ts`：在 `transferChainInputSchema` 块之后追加：

```ts
/**
 * 链排序提交（spec chain-ordering §5）：当前用户全部链 id 的新顺序。
 * server 校验「去重后恰好等于我的参与集合」；数组允许为空（无链用户的恒等提交），
 * 故不加 min(1)（加了反而对 0 条链的用户制造无谓 400）。
 */
export const reorderChainsInputSchema = z.object({
  chainIds: z.array(z.string().min(1).max(36)).max(200),
});
export type ReorderChainsInput = z.infer<typeof reorderChainsInputSchema>;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: 全过；build exit 0。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/chains.ts packages/dto/src/chains.test.ts
git commit -m "feat(dto): add reorderChainsInputSchema for per-user chain ordering"
```

---

### Task 2: api-client — `reorderChains`

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Test: `packages/api-client/src/client.test.ts`（扩展既有路由对齐测试，不触库）

**Interfaces:**
- Consumes: Task 1 的 `ReorderChainsInput`（`@moment/dto`）；既有 `Http.request`（204 时返回 `undefined`，`http.ts` `parseBody` 已处理）。
- Produces（Task 6 消费，不得改名）:
  - `MomentClient.reorderChains(input: ReorderChainsInput): Promise<void>`——`PUT /api/chains/order`，body 原样透传（client 不做 schema parse，与 `transferChain` 等既有方法一致）。

- [ ] **Step 1: 写失败测试**

Modify `packages/api-client/src/client.test.ts` 的 `test('chains/members/invites 路径与方法名对齐 Phase 2 路由', ...)`：

1. 在 `await client.acceptInvite('tok');` 之后追加一行：

```ts
  await client.reorderChains({ chainIds: ['c2', 'c1'] });
```

2. 在 `assert.deepEqual(calls.map(...))` 的期望数组末尾（`'POST http://x/api/invites/tok/accept',` 之后）追加：

```ts
    'PUT http://x/api/chains/order',
```

3. 在 `assert.deepEqual(calls[8]!.body, { userId: 'u2' });` 之后追加：

```ts
  assert.deepEqual(calls[13]!.body, { chainIds: ['c2', 'c1'] });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL——`client.reorderChains is not a function`。

- [ ] **Step 3: 实现方法**

Modify `packages/api-client/src/client.ts`：

1. 类型 import 块（`RegisterInput,` 行附近按字母序）加入 `ReorderChainsInput,`。

2. `MomentClient` interface 的 `transferChain(chainId: string, userId: string): Promise<ChainDto>;` 行之后加入：

```ts
  /** 全量提交「我 × 链」展示顺序（spec chain-ordering §5）：204 空 body；成功/失败都由调用方重新 listChains 收敛 */
  reorderChains(input: ReorderChainsInput): Promise<void>;
```

3. `createMomentClient` 返回对象的 `transferChain: ...` 行之后加入：

```ts
    reorderChains: (input) => http.request('/api/chains/order', { method: 'PUT', body: input }),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build`
Expected: 全过；build exit 0。

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/client.ts packages/api-client/src/client.test.ts
git commit -m "feat(api-client): add reorderChains PUT /api/chains/order"
```

---

### Task 3 (server): `chain_members.sort_order` 列 + 迁移 0014（generate 后立即追加回填）

**Files:**
- Modify: `apps/server/src/db/schema/chain-members.ts`
- Create: `apps/server/drizzle/0014_<drizzle-kit 随机名>.sql`（generate 产出 + 手工追加回填 UPDATE）
- Modify: `apps/server/drizzle/meta/_journal.json`（generate 产出 idx 14 条目）
- Create: `apps/server/drizzle/meta/0014_snapshot.json`（generate 产出）
- Modify: `apps/server/tests/global-setup.ts`（加 `SKIP_GLOBAL_MIGRATE` 环境守卫，docker 验证闸门的机制前提）
- Test: `apps/server/tests/chains/schema.test.ts`（扩展既有文件，触库）

**Interfaces:**
- Consumes: 既有 `chainMembers` 表定义（`apps/server/src/db/schema/chain-members.ts`）；`drizzle-kit generate`（`pnpm --filter @moment/server migrate:generate`）；`pnpm --filter @moment/server migrate`（`src/db/migrate.ts`）。
- Produces:
  - `chainMembers.sortOrder`——drizzle 列 `int('sort_order').notNull().default(0)`，TS 类型 `number`（Task 4 消费）。
  - DB 迁移 0014：`ALTER TABLE chain_members ADD sort_order int NOT NULL DEFAULT 0` + 同事务文件内的回填 UPDATE（每个用户按 `created_at DESC, id ASC` 写 1..n，Task 5 验证）。

**时序警告（实现者必读，spec §2 硬约束）：** Step 3（generate）与 Step 4（追加回填）之间禁止运行 `pnpm migrate`、`pnpm --filter @moment/server test`、`pnpm dev` 或任何部署——它们都会执行迁移。drizzle 迁移 hash 在运行时按文件内容计算，任何环境先执行了无回填版本的 0014 都会造成 hash 分叉。执行顺序固定为 **generate → append → globalSetup 守卫（Step 6）→ docker 回填验证（Step 7）→ 远程首跑（Step 9）**：远程共享测试库的首跑必须排在 docker 验证通过之后（spec §2「先验证再跑迁移」），否则一旦回填 SQL 有误，远程库已记录错误版本的 hash，正中本计划设防的 hash 分叉。Step 2 的红灯测试运行发生在 generate **之前**，是安全的（彼时 0014 尚不存在，jest globalSetup 的 migrate 只跑到 0013）。

**机制前提（复审确认）：** `apps/server/jest.config.mjs` 配了 `globalSetup: '<rootDir>/tests/global-setup.ts'`，该文件对**每一次** server jest 调用无条件 `execFileSync('pnpm', ['migrate'])`，打的是 `.env` 指向的远程共享测试库。因此 docker 验证若直接以 jest 运行，globalSetup 会先把 0014 应用到远程库（hash 落库），闸门形同虚设——Step 6 的 `SKIP_GLOBAL_MIGRATE` 守卫是闸门成立的机制前提，不可跳过。

- [ ] **Step 1: 写失败测试**

Modify `apps/server/tests/chains/schema.test.ts`：在 `const [invite] = await db.select().from(chainInvites);` 断言块之后、「联合主键」注释之前插入：

```ts
    // spec chain-ordering §2：sort_order 默认 0；回填（迁移 0014）/ 新链置顶（min-1）/ reorder 全量重写另行赋值
    const [member] = await db.select().from(chainMembers);
    expect(member.sortOrder).toBe(0);
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/chains/schema.test.ts`
Expected: FAIL——drizzle schema 尚无 `sortOrder` 键，`member.sortOrder` 为 `undefined`，`expect(undefined).toBe(0)` 失败。注意 server jest 经 ts-jest 全量类型检查，该文件实际在**编译期**即报 TS2339（`Property 'sortOrder' does not exist on type 'ChainMember'`）——编译错误即红灯，属预期，不必走到运行期断言。

- [ ] **Step 3: schema 加列 + generate**

Modify `apps/server/src/db/schema/chain-members.ts`：

1. 第 1 行 import 的 `drizzle-orm/mysql-core` 列表中加入 `int`。
2. `joinedAt` 行之后加入：

```ts
    /** per-user 展示顺序（spec chain-ordering §2）：值越小越靠前，允许负数（新链置顶 min-1）；无唯一约束，reorder 全量重写收敛 */
    sortOrder: int('sort_order').notNull().default(0),
```

Run: `pnpm --filter @moment/server migrate:generate`
Expected: 产出 `apps/server/drizzle/0014_<random>.sql`（内容仅 `ALTER TABLE \`chain_members\` ADD \`sort_order\` int NOT NULL DEFAULT 0;`）、`drizzle/meta/0014_snapshot.json`，`_journal.json` 追加 idx 14 条目。

- [ ] **Step 4: 立即追加回填 SQL（与 Step 3 同一会话连续完成，中间不运行任何命令）**

编辑刚生成的 `apps/server/drizzle/0014_<random>.sql`，在既有 ALTER 语句的 `--> statement-breakpoint` 之后追加（spec §2 给定 SQL，逐字）：

```sql
--> statement-breakpoint
UPDATE chain_members cm
JOIN (
  SELECT cm2.user_id, cm2.chain_id,
         ROW_NUMBER() OVER (PARTITION BY cm2.user_id ORDER BY c.created_at DESC, c.id) AS rn
  FROM chain_members cm2 JOIN chains c ON c.id = cm2.chain_id
) ranked ON ranked.user_id = cm.user_id AND ranked.chain_id = cm.chain_id
SET cm.sort_order = ranked.rn;
```

（若 generate 产物末尾无 trailing breakpoint，则先补一个 `--> statement-breakpoint` 再写 UPDATE；最终文件 = ALTER 语句、breakpoint、UPDATE 语句，可有多余空行。）

- [ ] **Step 5: 首跑前 diff 检查**

Run: `git diff --stat apps/server/drizzle/` 并 `cat apps/server/drizzle/0014_*.sql`
Expected: 新文件恰好含 1 条 `ALTER TABLE ... ADD sort_order ... DEFAULT 0` 与 1 条 `UPDATE chain_members ... ROW_NUMBER() ...`；无其它语句。确认 `_journal.json` 新增条目 `idx: 14` 且 tag 与新文件名（去 `.sql`）一致。

- [ ] **Step 6: `tests/global-setup.ts` 加 `SKIP_GLOBAL_MIGRATE` 环境守卫（闸门成立的机制前提）**

Modify `apps/server/tests/global-setup.ts`——在 `execFileSync` 之前加守卫（完整替换文件内容）：

```ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Jest globalSetup does not apply moduleNameMapper, so we cannot import `../src/db/index.js`. */
export default function globalSetup(): void {
  // SKIP_GLOBAL_MIGRATE=1：迁移验证测试（tests/migrations/，自带本地 docker 临时 schema）
  // 必须先于任何远程 migrate 执行（spec chain-ordering §2「先验证再跑迁移」）——
  // 不设守卫的话本 globalSetup 会先把被测迁移应用到远程共享测试库（hash 落库），验证闸门形同虚设。
  if (process.env.SKIP_GLOBAL_MIGRATE === '1') return;
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync('pnpm', ['migrate'], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
}
```

守卫影响自查（实现者逐项确认）：
- 类型：`process.env` 读取在 node types 覆盖内，无类型变更；该文件由 jest 经 ts-jest 编译（`jest.config.mjs` 的 `globalSetup` + transform），改动是一行早退守卫，语法平凡；Step 10 的实跑即其编译验证。
- **默认行为不变**：不设环境变量时照常 migrate——本步之后的 Step 10（不带守卫跑 schema.test）会实际观察 globalSetup 照常输出 `migrations applied`（no-op migrate），Task 4 的全量测试同理；既有触库测试零影响。
- 此步只改文件、不运行任何 jest/migrate 命令（守卫未就位前运行 jest 会先把 0014 打到远程库）。

- [ ] **Step 7: 本地 docker 回填验证（远程首跑的前置闸门，spec §2「先验证再跑迁移」）**

按 Task 5 Step 1 的完整代码（权威版本，逐字）创建 `apps/server/tests/migrations/chain-members-sort-order-backfill.test.ts`，然后执行：

```bash
docker compose up -d mysql
SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-members-sort-order-backfill
```

`SKIP_GLOBAL_MIGRATE=1` 必须带：否则 jest globalSetup 会先把 0014 应用到远程共享测试库（hash 落库），本闸门的「验证通过才首跑」时序被架空（Step 6 的守卫正是为此而加）。

Expected:
- 输出**不含** `migrations applied`（globalSetup 被守卫跳过——这是闸门机制成立的直接观察证据）；该测试不 import `src/db`，全程零接触远程库。
- 两个用例全过——回填后每用户 `sort_order` 恰为 `created_at DESC, id ASC` 的 1..n。**不通过则回到 Step 4 修回填 SQL（此时远程库尚未执行 0014，改 SQL 无 hash 分叉风险），修好重新验证，全过才允许进 Step 9。**

注意：本步创建的测试文件**不在本 Task 提交**——由 Task 5 提交，保持「feat(server)=迁移」与「test(server)=验证」两个 conventional commit 的语义分离；文件在工作区保持未提交状态进入后续 Task（有 `RUN_MIGRATION_IT` 门控，不影响 Task 4 的全量测试）。

- [ ] **Step 8: 确认临时 schema 已清理**

执行 Task 5 Step 4 的命令与检查（`SHOW DATABASES LIKE 'moment_migration_it_%'` 应为空）。

- [ ] **Step 9: 对 `.env` 指向的测试库执行迁移（该迁移在远程环境的首次执行，且已通过 Step 7 验证）**

Run: `pnpm --filter @moment/server migrate`
Expected: 输出 `migrations applied`，无报错。这是 0014 在远程共享测试库的**首次**执行，执行的是已通过 docker 回填验证的版本。

- [ ] **Step 10: 运行确认通过（顺带验证守卫默认行为不变）**

Run: `pnpm --filter @moment/server test -- tests/chains/schema.test.ts`
Expected: PASS（列存在且默认 0）；输出开头可见 globalSetup 照常执行的 `migrations applied`（no-op migrate）——证明 `SKIP_GLOBAL_MIGRATE` 守卫不改变默认行为，既有触库测试的 globalSetup 路径零影响。

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/db/schema/chain-members.ts apps/server/drizzle/ apps/server/tests/global-setup.ts apps/server/tests/chains/schema.test.ts
git commit -m "feat(server): add chain_members.sort_order column with backfill migration"
```

---

### Task 4 (server): listMine 排序 + 新链置顶 + `PUT /api/chains/order`

**Files:**
- Modify: `apps/server/src/chains/chain.service.ts`
- Modify: `apps/server/src/chains/chains.controller.ts`
- Test: `apps/server/tests/chains/chains.ordering.test.ts`（新建，触库）

**Interfaces:**
- Consumes: Task 1 的 `reorderChainsInputSchema` / `ReorderChainsInput`（`@moment/dto`）；Task 3 的 `chainMembers.sortOrder`；既有 `DbTx`（`src/outbox/outbox.ts`）；drizzle-orm 的 `asc` / `min`；routing-controllers 的 `Put` / `HttpCode` / `OnUndefined`（204 组合参照 `chains.controller.ts` 既有 `remove`、`reactions.controller.ts` 的 `@Put`）。
- Produces:
  - `ChainService.reorder(userId: string, input: ReorderChainsInput): Promise<void>`——去重后集合必须恰好等于该用户全部链 id，否则 `BadRequestError('CHAIN_ORDER_MISMATCH')`；校验与重写同事务；重写逐行 `UPDATE ... WHERE user_id = ? AND chain_id = ?`（天然限定 IN 集合）；sortOrder 写 1..n（spec §5）。
  - `ChainService.reorderAfterValidateHook: ((userId: string) => Promise<void>) | null`——实例属性，默认 `null`；非空时在 reorder 事务校验通过后、重写执行前 `await`。**仅测试注入**（spec §7「并发入链不被改写」的顺序模拟手段），生产代码不得赋值。
  - `ChainService.listMine` 排序：`ORDER BY chain_members.sort_order ASC, chains.created_at DESC`（spec §3）。
  - `ChainService.create` / `acceptInvite`：新 membership `sortOrder = 当前用户 min(sortOrder) - 1`，无现存 membership 取 1（spec §4）。
  - 路由：`PUT /api/chains/order`（`@Authorized()` 类级继承）→ 204。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/chains/chains.ordering.test.ts`（完整内容）：

```ts
import type { ChainDto } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { Container } from 'typedi';
import { createApp } from '../../src/app.js';
import { ChainService } from '../../src/chains/chain.service.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

// 链排序（spec chain-ordering §3/§4/§5/§7）：
// listMine 按 sort_order ASC（created_at DESC 兜底）；create/acceptInvite 新 membership 置顶（min-1，首链 1）；
// reorder 全量重写（集合恰好匹配、同事务、IN 限定）；退出重进 = 新 membership 回顶部。

const app = listenLocal(createApp());

let owner: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

async function sortOrderOf(chainId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ sortOrder: chainMembers.sortOrder })
    .from(chainMembers)
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)))
    .limit(1);
  if (!row) throw new Error(`membership not found: ${chainId}/${userId}`);
  return row.sortOrder;
}

async function listIds(user: TestUser): Promise<string[]> {
  const res = await request(app).get('/api/chains').set('Authorization', auth(user));
  expect(res.status).toBe(200);
  return (res.body as ChainDto[]).map((c) => c.id);
}

async function setSortOrder(chainId: string, userId: string, value: number): Promise<void> {
  await db
    .update(chainMembers)
    .set({ sortOrder: value })
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)));
}

async function setCreatedAt(chainId: string, at: Date): Promise<void> {
  await db.update(chains).set({ createdAt: at }).where(eq(chains.id, chainId));
}

/** 走真实 API 建邀请并返回 token（outsider 的链）。 */
async function inviteToken(chainId: string, by: TestUser, role: 'editor' | 'viewer'): Promise<string> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/invites`)
    .set('Authorization', auth(by))
    .send({ role });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('GET /api/chains 按 sort_order 排序（spec §3）', () => {
  it('按 sortOrder ASC；并列按 createdAt DESC 兜底', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const c3 = await createChain(app, owner, '链3');

    await setSortOrder(c1.id, owner.id, 20);
    await setSortOrder(c2.id, owner.id, 10);
    await setSortOrder(c3.id, owner.id, 30);
    expect(await listIds(owner)).toEqual([c2.id, c1.id, c3.id]);

    // 并列（正常回填后不存在，防御性兜底）：createdAt 新者在前
    await setSortOrder(c1.id, owner.id, 10);
    await setCreatedAt(c1.id, new Date('2026-01-01T00:00:00Z'));
    await setCreatedAt(c2.id, new Date('2026-02-01T00:00:00Z'));
    expect(await listIds(owner)).toEqual([c2.id, c1.id, c3.id]);
  });
});

describe('新链 / 新加入的链置顶（spec §4）', () => {
  it('create：首链 sortOrder = 1，次链 = min-1 = 0 并列列表最前', async () => {
    const c1 = await createChain(app, owner, '首链');
    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);

    const c2 = await createChain(app, owner, '次链');
    expect(await sortOrderOf(c2.id, owner.id)).toBe(0);
    expect(await listIds(owner)).toEqual([c2.id, c1.id]);
  });

  it('acceptInvite：新 membership 取 min-1，被邀请的链直接到顶', async () => {
    const mine = await createChain(app, owner, '我的链'); // owner 的 sortOrder = 1
    const theirs = await createChain(app, outsider, '别人的链');
    const token = await inviteToken(theirs.id, outsider, 'editor');

    const accept = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('Authorization', auth(owner));
    expect(accept.status).toBe(200);

    expect(await sortOrderOf(theirs.id, owner.id)).toBe(0); // min(1) - 1
    expect(await listIds(owner)).toEqual([theirs.id, mine.id]);
  });

  it('退出后重新加入 = 新 membership，回顶部不记忆历史位置', async () => {
    const mine = await createChain(app, owner, '我的链');
    const theirs = await createChain(app, outsider, '别人的链');
    const token1 = await inviteToken(theirs.id, outsider, 'viewer');
    await request(app).post(`/api/invites/${token1}/accept`).set('Authorization', auth(owner));
    // 人为把 owner 在 theirs 上的顺序压到底部，模拟「历史位置」
    await setSortOrder(theirs.id, owner.id, 99);

    // viewer 自己退链（已接受过的邀请不能复用：acceptedAt 已写）
    const leave = await request(app)
      .delete(`/api/chains/${theirs.id}/members/${owner.id}`)
      .set('Authorization', auth(owner));
    expect(leave.status).toBe(204);

    // 重新接受新邀请 → 新 membership 回顶部（min(1) - 1 = 0，不是 99）
    const token2 = await inviteToken(theirs.id, outsider, 'viewer');
    const rejoin = await request(app)
      .post(`/api/invites/${token2}/accept`)
      .set('Authorization', auth(owner));
    expect(rejoin.status).toBe(200);

    expect(await sortOrderOf(theirs.id, owner.id)).toBe(0);
    expect(await listIds(owner)).toEqual([theirs.id, mine.id]);
  });
});

describe('PUT /api/chains/order（spec §5）', () => {
  it('204：全量重写 sortOrder 为提交顺序的 1..n，列表随即按新顺序返回', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const c3 = await createChain(app, owner, '链3');

    const res = await request(app)
      .put('/api/chains/order')
      .set('Authorization', auth(owner))
      .send({ chainIds: [c1.id, c2.id, c3.id] });
    expect(res.status).toBe(204);

    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(2);
    expect(await sortOrderOf(c3.id, owner.id)).toBe(3);
    expect(await listIds(owner)).toEqual([c1.id, c2.id, c3.id]);
  });

  it('幂等：重复提交同一顺序两次均 204 且无副作用', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const body = { chainIds: [c1.id, c2.id] };

    const first = await request(app).put('/api/chains/order').set('Authorization', auth(owner)).send(body);
    const second = await request(app).put('/api/chains/order').set('Authorization', auth(owner)).send(body);
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(2);
    expect(await listIds(owner)).toEqual([c1.id, c2.id]);
  });

  it('空数组：无链用户的恒等提交 204', async () => {
    const lonely = await createUser(app, 'lonely@example.com');
    const res = await request(app)
      .put('/api/chains/order')
      .set('Authorization', auth(lonely))
      .send({ chainIds: [] });
    expect(res.status).toBe(204);
  });

  it('400 CHAIN_ORDER_MISMATCH：漏 id / 多他人链 id / 未知 id；且不作任何写入', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const theirs = await createChain(app, outsider, '别人的链');
    const before1 = await sortOrderOf(c1.id, owner.id);
    const before2 = await sortOrderOf(c2.id, owner.id);

    for (const chainIds of [[c1.id], [c1.id, c2.id, theirs.id], [c1.id, c2.id, 'no-such-chain']]) {
      const res = await request(app)
        .put('/api/chains/order')
        .set('Authorization', auth(owner))
        .send({ chainIds });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHAIN_ORDER_MISMATCH');
    }
    // 校验失败整体回滚：既有顺序不变
    expect(await sortOrderOf(c1.id, owner.id)).toBe(before1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(before2);
  });

  it('未登录 401', async () => {
    const res = await request(app).put('/api/chains/order').send({ chainIds: [] });
    expect(res.status).toBe(401);
  });

  it('校验与重写同事务且限定 chain_id IN：校验后并发入链的置顶行不被改写（spec §5.2/§7 顺序模拟）', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const late = { id: randomUUID() };

    // spec §7：--runInBand 下真实并发难以确定性复现——经 service 测试钩子在 reorder 事务
    // 校验之后、重写之前注入一条新 membership（等价于并发入链的 min-1 置顶行）。
    const service = Container.get(ChainService);
    service.reorderAfterValidateHook = async (userId: string) => {
      await db.insert(chains).values({ id: late.id, name: '并发入链', ownerId: userId, template: 'daily' });
      await db.insert(chainMembers).values({ chainId: late.id, userId, role: 'owner', sortOrder: 0 });
    };
    try {
      const res = await request(app)
        .put('/api/chains/order')
        .set('Authorization', auth(owner))
        .send({ chainIds: [c2.id, c1.id] });
      expect(res.status).toBe(204);
    } finally {
      service.reorderAfterValidateHook = null;
    }

    // 提交集合内的行被重写；并发入链的置顶行（sortOrder 0）不在 IN 集合内，保持原值
    expect(await sortOrderOf(c2.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c1.id, owner.id)).toBe(2);
    expect(await sortOrderOf(late.id, owner.id)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/chains/chains.ordering.test.ts`
Expected: FAIL——`PUT /api/chains/order` 404（路由不存在）；`create` 首链 sortOrder 断言失败（insert 未写 sortOrder，默认 0 而非 1）；排序用例失败（listMine 仍按 createdAt DESC）。注意 server jest 经 ts-jest 全量类型检查，`Container.get(ChainService).reorderAfterValidateHook` 在实现前是 TS2339 编译错误——编译错误即红灯，属预期，不必走到运行期断言。

- [ ] **Step 3: 实现 ChainService 改动**

Modify `apps/server/src/chains/chain.service.ts`：

1. `drizzle-orm` import 行改为 `import { and, asc, desc, eq, inArray, min } from 'drizzle-orm';`
2. `@moment/dto` type import 列表加入 `type ReorderChainsInput,`（按字母序放在 `InviteRole,` 之后）。
3. 新增 import：`import type { DbTx } from '../outbox/outbox.js';`
4. `create` 方法的事务内、`tx.insert(chainMembers)...` 之前插入计算，并把 values 改为带 sortOrder：

```ts
    await db.transaction(async (tx) => {
      await tx.insert(chains).values({
        id,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        color: input.color ?? null,
        icon: input.icon ?? null,
        ownerId: userId,
        template: input.template,
        payload,
      });
      // 新链置顶（spec §4）：min-1；首条链（无现存 membership）取 1
      const sortOrder = await this.nextTopSortOrder(tx, userId);
      await tx.insert(chainMembers).values({ chainId: id, userId, role: 'owner', sortOrder });
    });
```

5. `listMine` 的 `.orderBy(desc(chains.createdAt))` 改为（spec §3）：

```ts
      .orderBy(asc(chainMembers.sortOrder), desc(chains.createdAt));
```

同时把方法 doc 注释改为 `/** 我参与的链（含我的角色）：sortOrder 升序，createdAt 倒序兜底（spec chain-ordering §3）。 */`

6. `acceptInvite` 的事务内 insert 改为：

```ts
    await db.transaction(async (tx) => {
      // 新加入的链同样置顶（spec §4）；幂等分支已在上方提前返回，不写库
      const sortOrder = await this.nextTopSortOrder(tx, user.id);
      await tx.insert(chainMembers).values({ chainId: invite.chainId, userId: user.id, role: invite.role, sortOrder });
      await tx.update(chainInvites).set({ acceptedAt: new Date() }).where(eq(chainInvites.id, invite.id));
      // outbox 锚点：「被邀请入链」通知扇出属 Phase 5（outbox 表 Phase 3 才建立），此处不写。
    });
```

7. 在 `acceptInvite` 方法之后、`private toChainDto` 之前插入：

```ts
  /**
   * 测试专用钩子（spec §7「并发入链不被改写」的顺序模拟）：
   * 非空时在 reorder 事务校验通过后、重写执行前 await。生产代码不得赋值。
   */
  reorderAfterValidateHook: ((userId: string) => Promise<void>) | null = null;

  /**
   * 全量重写「我 × 链」展示顺序（spec §5）：
   * 去重后的集合必须恰好等于我的全部链 id（防漏/防越权/防半截）；校验与重写同事务；
   * 重写按 chain_id 逐行 UPDATE（天然限定在提交集合内）——校验后并发入链的置顶新行
   * 不参与本次重写，容忍交错，下次 reorder 收敛。响应固定 204（controller 声明）。
   */
  async reorder(userId: string, input: ReorderChainsInput): Promise<void> {
    const ordered = [...new Set(input.chainIds)];
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ chainId: chainMembers.chainId })
        .from(chainMembers)
        .where(eq(chainMembers.userId, userId));
      const mine = new Set(rows.map((r) => r.chainId));
      if (ordered.length !== mine.size || ordered.some((id) => !mine.has(id))) {
        throw new BadRequestError('CHAIN_ORDER_MISMATCH');
      }
      if (this.reorderAfterValidateHook) await this.reorderAfterValidateHook(userId);
      for (let i = 0; i < ordered.length; i++) {
        await tx
          .update(chainMembers)
          .set({ sortOrder: i + 1 })
          .where(and(eq(chainMembers.userId, userId), eq(chainMembers.chainId, ordered[i] as string)));
      }
    });
  }

  /** 新 membership 置顶（spec §4）：当前用户最小 sortOrder - 1；无现存 membership（首条链）取 1。 */
  private async nextTopSortOrder(tx: DbTx, userId: string): Promise<number> {
    const [row] = await tx
      .select({ value: min(chainMembers.sortOrder) })
      .from(chainMembers)
      .where(eq(chainMembers.userId, userId));
    return row?.value == null ? 1 : Number(row.value) - 1;
  }
```

- [ ] **Step 4: 实现 controller 路由**

Modify `apps/server/src/chains/chains.controller.ts`：

1. `@moment/dto` import 列表加入 `reorderChainsInputSchema,`（放在 `createInviteInputSchema,` 之后）。
2. routing-controllers import 列表加入 `Put,`（放在 `Post,` 之后）。
3. 在 `@Get('/')` 的 `list` 方法之后插入：

```ts
  // spec chain-ordering §5：全量重写我的链顺序，固定 204——客户端已持有完整顺序（乐观更新），不需要回读
  @Put('/order')
  @HttpCode(204)
  @OnUndefined(204)
  reorder(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<void> {
    return this.chainService.reorder(user.id, reorderChainsInputSchema.parse(body));
  }
```

（`/order` 是 PUT 方法下唯一的静态段路由，与既有 `@Get('/:chainId')` 等参数路由不冲突；类级 `@Authorized()` 已覆盖未登录 401。）

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/chains/`
Expected: 全过（新文件 10 个用例 + 既有 chains 套件不回归）。

- [ ] **Step 6: 全量回归 + typecheck**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck`
Expected: 全过（feed / invites / members 等消费链列表与 acceptInvite 的套件不回归）；typecheck exit 0。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/chains/chain.service.ts apps/server/src/chains/chains.controller.ts apps/server/tests/chains/chains.ordering.test.ts
git commit -m "feat(server): per-user chain ordering (sort list, top-insert, reorder endpoint)"
```

---

### Task 5 (server): 迁移 0014 回填验证（本地 docker 临时 schema，`RUN_MIGRATION_IT=1`）

**Files:**
- Test: `apps/server/tests/migrations/chain-members-sort-order-backfill.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `apps/server/drizzle/0000–0014 *.sql` 与 `drizzle/meta/_journal.json`；根 `docker-compose.yml` 的 `mysql` 服务（`mysql:8.4`，root/`moment_root_dev` @ `127.0.0.1:3306`）；`mysql2/promise`（server 既有依赖）。
- Produces: 无（一次性验证测试；后续迁移落地时需按文件内守卫提示重定基线）。

**为什么不用远程共享测试库（spec §7 原话落实）：** 远程共享测试库已应用全部既有迁移，直接跑 migrate 是 no-op，观察不到回填效果。本测试在本地 docker MySQL 起**临时 schema**：顺序执行 0000–0013（旧行为，`chain_members` 尚无 `sort_order` 列）→ 造多用户多链数据（含 `created_at` 同秒并列）→ 执行 0014 → 断言回填结果。**全程不碰远程共享库**：不 import `src/db` / `tests/helpers/db.ts`（避免创建指向远程的全局 pool），自带 mysql2 连接，收尾 `DROP DATABASE`。门控方式沿用 `tests/storage/s3-it.test.ts` 的 `RUN_S3_IT` 先例（`const d = ... ? describe : describe.skip`），默认跳过、按需运行。

**执行时机（spec §2「先验证再跑迁移」）：** 本测试的**首次执行在 Task 3 Step 7**——generate → append → globalSetup 守卫 → docker 验证 → 远程首跑，docker 验证是远程共享测试库首跑 0014 的前置闸门（首次执行必须带 `SKIP_GLOBAL_MIGRATE=1`，否则 jest globalSetup 会先把 0014 打到远程库）。本 Task 持有该测试文件的**权威代码**与门控设计，并负责提交；Step 3/4 是复跑与清理规程。

- [ ] **Step 1: 写测试（权威代码；该文件已在 Task 3 Step 7 逐字创建并执行——若已创建，本步核对一致即可，无需重写）**

Create `apps/server/tests/migrations/chain-members-sort-order-backfill.test.ts`（完整内容）：

```ts
/**
 * 迁移 0014（chain_members.sort_order + 数据回填）验证（spec chain-ordering §2/§7）。
 *
 * 远程共享测试库已应用全部既有迁移，migrate 是 no-op，观察不到回填效果。本测试在本地
 * docker compose 的 MySQL 8.4（docker-compose.yml：root/moment_root_dev @ 127.0.0.1:3306）
 * 起临时 schema：顺序执行 0000–0013 → 按旧行为造多用户多链数据（含 created_at 同秒并列）→
 * 执行 0014 → 断言 sort_order 恰好是每用户按「created_at DESC, id ASC」的 1..n
 * （老用户升级后列表顺序完全不变）。
 *
 * 不 import src/db / tests/helpers/db.ts（其 pool 指向 .env 远程测试库）；自带连接，
 * 收尾 DROP 临时 schema，全程不碰远程共享库。jest --runInBand 串行，无并行冲突。
 *
 * 运行方式（SKIP_GLOBAL_MIGRATE=1 必须带：jest globalSetup 默认每次都对远程共享测试库跑
 * migrate，本测试的语义是「先于任何远程 migrate 验证回填」，守卫保证闸门时序不被架空）：
 *   docker compose up -d mysql
 *   SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-members-sort-order-backfill
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import mysql, { type Connection } from 'mysql2/promise';

const d = process.env.RUN_MIGRATION_IT === '1' ? describe : describe.skip;

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'drizzle');

/** 本地 docker compose MySQL；可用环境变量覆盖（不读 .env，杜绝误连远程库）。 */
const CONN = {
  host: process.env.MIGRATION_IT_HOST ?? '127.0.0.1',
  port: Number(process.env.MIGRATION_IT_PORT ?? 3306),
  user: process.env.MIGRATION_IT_USER ?? 'root',
  password: process.env.MIGRATION_IT_PASSWORD ?? 'moment_root_dev',
};

/** 按 drizzle 的 statement-breakpoint 切分迁移文件并逐句执行。 */
async function applyMigration(conn: Connection, tag: string): Promise<void> {
  const raw = await readFile(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await conn.query(stmt);
}

d('迁移 0014 chain_members.sort_order 回填（RUN_MIGRATION_IT=1，本地 docker MySQL）', () => {
  let conn: Connection;
  const schema = `moment_migration_it_${Date.now().toString(36)}`;

  beforeAll(async () => {
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    // 基线守卫：本测试按「0000–0013 旧行为 + 0014 回填」编写；未来新迁移落地后必须重定基线
    if (tags.length !== 15 || !tags[14]!.startsWith('0014_')) {
      throw new Error(
        `chain-ordering 回填验证基线失效：期望 journal 恰好 15 条且末条为 0014_*，实际 ${tags.length} 条末条 ${tags[tags.length - 1]}。请按新基线调整本测试。`,
      );
    }

    conn = await mysql.createConnection(CONN);
    await conn.query(`CREATE DATABASE \`${schema}\``);
    await conn.query(`USE \`${schema}\``);

    // 旧行为：迁移到 0013（此时 chain_members 还没有 sort_order 列，INSERT 不带它）
    for (const tag of tags.slice(0, 14)) await applyMigration(conn, tag);

    // 多用户多链：chain-2 与 chain-3 同一秒 created_at（回填的并列按 id 稳定，spec §2 回填 SQL）
    await conn.query(
      `INSERT INTO users (id, email, password_hash, nickname) VALUES
       ('user-1', 'u1@migration.it', 'x', 'u1'),
       ('user-2', 'u2@migration.it', 'x', 'u2')`,
    );
    await conn.query(
      `INSERT INTO chains (id, name, owner_id, template, created_at) VALUES
       ('chain-1', '旧链', 'user-1', 'daily', '2026-01-01 00:00:00'),
       ('chain-2', '并列A', 'user-2', 'daily', '2026-01-03 00:00:00'),
       ('chain-3', '并列B', 'user-2', 'daily', '2026-01-03 00:00:00')`,
    );
    await conn.query(
      `INSERT INTO chain_members (chain_id, user_id, role) VALUES
       ('chain-1', 'user-1', 'owner'),
       ('chain-2', 'user-1', 'viewer'),
       ('chain-3', 'user-1', 'viewer'),
       ('chain-2', 'user-2', 'owner'),
       ('chain-3', 'user-2', 'viewer')`,
    );

    // 应用被测迁移（ALTER ADD sort_order DEFAULT 0 + 回填 UPDATE 在同一文件）
    await applyMigration(conn, tags[14]!);
  }, 120_000);

  afterAll(async () => {
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await conn.end();
    }
  });

  it('回填后 sort_order = 每用户按 created_at DESC, id ASC 的 1..n（ROW_NUMBER 按 user 分区）', async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT user_id AS userId, chain_id AS chainId, sort_order AS sortOrder
       FROM chain_members ORDER BY user_id, sort_order`,
    );
    expect(rows).toEqual([
      // user-1：chain-2/chain-3 同秒并列按 id 升序 → chain-2 在前；chain-1 最旧垫底
      { userId: 'user-1', chainId: 'chain-2', sortOrder: 1 },
      { userId: 'user-1', chainId: 'chain-3', sortOrder: 2 },
      { userId: 'user-1', chainId: 'chain-1', sortOrder: 3 },
      // user-2：ROW_NUMBER 按 user_id 分区，互不影响
      { userId: 'user-2', chainId: 'chain-2', sortOrder: 1 },
      { userId: 'user-2', chainId: 'chain-3', sortOrder: 2 },
    ]);
  });

  it('ORDER BY sort_order ASC 与迁移前 created_at DESC 展示顺序一致（老用户升级后列表不变）', async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT cm.user_id AS userId, cm.chain_id AS chainId
       FROM chain_members cm JOIN chains c ON c.id = cm.chain_id
       ORDER BY cm.user_id, cm.sort_order ASC, c.created_at DESC`,
    );
    expect(rows).toEqual([
      { userId: 'user-1', chainId: 'chain-2' },
      { userId: 'user-1', chainId: 'chain-3' },
      { userId: 'user-1', chainId: 'chain-1' },
      { userId: 'user-2', chainId: 'chain-2' },
      { userId: 'user-2', chainId: 'chain-3' },
    ]);
  });
});
```

- [ ] **Step 2: 确认门控（默认跳过，不打本地 docker）**

Run: `pnpm --filter @moment/server test -- chain-members-sort-order-backfill`
Expected: 通过但显示 skipped（未设 `RUN_MIGRATION_IT=1` 时 `describe.skip` 生效）——默认的 server 全量测试不因本地 docker 未启动而失败。注：本步不带 `SKIP_GLOBAL_MIGRATE=1`，jest globalSetup 会对远程库跑一次 no-op migrate（此时 0014 已经 Task 3 Step 9 应用）——行为与既有全量测试一致，无害。

- [ ] **Step 3: 运行方式（复跑规程；首次执行已在 Task 3 Step 7 作为远程首跑前置闸门完成）**

Run:
```bash
docker compose up -d mysql
SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-members-sort-order-backfill
```

统一带 `SKIP_GLOBAL_MIGRATE=1`（与首次执行同一命令形态）：复跑时远程已有 0014、守卫在功能上非必需（globalSetup 的 migrate 是 no-op），但统一守卫让「首跑与复跑等**验证性执行**从不触发远程 migrate」成为不变量（Step 2 的门控确认不带守卫、触发一次 no-op migrate，属既有全量测试路径，不在此列），命令在任何时序下都安全，也避免两种命令形态并存记错。

Expected: 两个用例全过。若本地 3306 已有其它 MySQL 占用，用 `MIGRATION_IT_PORT=<port>` 覆盖；严禁把 `MIGRATION_IT_HOST` 指向任何远程/生产库。

- [ ] **Step 4: 确认临时 schema 已清理（已在 Task 3 Step 8 执行过；此处为复跑后的清理规程）**

Run: `docker compose exec mysql mysql -uroot -pmoment_root_dev -e "SHOW DATABASES LIKE 'moment_migration_it_%';"`
Expected: 空结果（afterAll 已 DROP；即使测试中途失败，`IF EXISTS` 的 DROP 也不影响下次运行——失败遗留时手动 `DROP DATABASE` 即可）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/migrations/chain-members-sort-order-backfill.test.ts
git commit -m "test(server): verify sort_order backfill migration against local docker MySQL"
```

---

### Task 6 (web): `ChainListService.reorder` — 乐观更新 + 在途引用计数抑制 load 写回

**Files:**
- Modify: `apps/web/src/services/chain-list.service.ts`
- Test: `apps/web/src/services/chain-list.service.test.ts`（新建，Vitest + jsdom）

**Interfaces:**
- Consumes: Task 2 的 `client.reorderChains` / `client.listChains`；既有 `AuthService`（`src/services/auth.service.ts`）；`@rabjs/react` 的 `Service`。
- Produces（Task 9 消费，不得改名）:
  - `ChainListService.reorder(orderedIds: string[]): Promise<void>`——立即按新顺序写 `this.chains`（乐观）→ `client.reorderChains({ chainIds: orderedIds })` → 收尾统一 `await this.load()`（成功 = 收敛，失败 = 回滚）；失败在回滚后 **reject**（调用方 toast）。
  - `ChainListService.load()` 新语义：reorder 在途计数 > 0 时**写回被抑制**（请求照发、结果丢弃，spec §6.3 竞态防护）。计数而非布尔（spec §6.3 重入语义：并发第二次 reorder 期间第一次完成不得解除抑制）。

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/services/chain-list.service.test.ts`（完整内容）：

```ts
import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto } from '@moment/dto';
import { AuthService } from './auth.service';
import { ChainListService } from './chain-list.service';

// ChainListService.reorder（spec chain-ordering §6.3/§7）：
// 乐观更新 → PUT → 统一 load 收敛（成功）/回滚（失败，reject 由调用方 toast）；
// 在途期间并发 load() 写回抑制（引用计数，含重入用例——本设计最易出 bug 的点）。

const api = vi.hoisted(() => ({
  listChains: vi.fn(),
  reorderChains: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  client: api,
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ChainListService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
    description: null,
    coverMediaId: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ids = (list: ChainDto[]) => list.map((c) => c.id);

beforeEach(() => {
  api.listChains.mockReset();
  api.reorderChains.mockReset();
  // user = null：ChainListService 构造器不自动 load，chains 由用例直接播种
  resolve(AuthService).user = null;
  resolve(ChainListService).chains = [chain('a'), chain('b'), chain('c')];
});

describe('ChainListService.reorder', () => {
  it('乐观更新先行；成功后统一 load 与服务端收敛', async () => {
    const service = resolve(ChainListService);
    const server = deferred();
    api.reorderChains.mockReturnValue(server.promise);
    api.listChains.mockResolvedValue([chain('c'), chain('a'), chain('b')]);

    const p = service.reorder(['c', 'a', 'b']);
    // 乐观：PUT 未返回，chains 已按新顺序（reorder 同步执行到首个 await 之前完成赋值）
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
    expect(api.reorderChains).toHaveBeenCalledWith({ chainIds: ['c', 'a', 'b'] });

    server.resolve();
    await p;
    expect(api.listChains).toHaveBeenCalledTimes(1); // 收尾收敛请求
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
  });

  it('失败：load 回滚到服务端顺序后 reject（reject 是调用方 toast 的触发源）', async () => {
    const service = resolve(ChainListService);
    api.reorderChains.mockRejectedValue(new Error('boom'));
    api.listChains.mockResolvedValue([chain('a'), chain('b'), chain('c')]);

    const p = service.reorder(['c', 'b', 'a']);
    expect(ids(service.chains)).toEqual(['c', 'b', 'a']); // 乐观

    await expect(p).rejects.toThrow('boom');
    expect(ids(service.chains)).toEqual(['a', 'b', 'c']); // 回滚完成才 reject
  });

  it('竞态防护：reorder 在途期间并发 load() 完成的写回被抑制', async () => {
    const service = resolve(ChainListService);
    const server = deferred();
    api.reorderChains.mockReturnValue(server.promise);
    // 并发 load（chain:changed 触发）拉到的是提交前的旧顺序
    api.listChains.mockResolvedValue([chain('x'), chain('a')]);

    const p = service.reorder(['b', 'a', 'c']);
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);

    await service.load(); // 在途期间的并发 load：请求照发，写回抑制
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);

    api.listChains.mockResolvedValue([chain('b'), chain('a'), chain('c')]);
    server.resolve();
    await p;
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);
  });

  it('重入：两次 reorder 并发，第一次先完成时第二次的乐观顺序不被 load 覆盖', async () => {
    const service = resolve(ChainListService);
    const first = deferred();
    const second = deferred();
    api.reorderChains.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    api.listChains.mockResolvedValue([chain('a'), chain('b'), chain('c')]); // 陈旧顺序

    const p1 = service.reorder(['b', 'a', 'c']);
    const p2 = service.reorder(['c', 'a', 'b']);
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);

    // 第一次先完成：其收尾 load 的写回必须仍被第二次的在途计数抑制
    first.resolve();
    await p1;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);

    // 第二次完成：计数归零，统一 load 收敛（服务端 last-write-wins，最终顺序 = 第二次）
    api.listChains.mockResolvedValue([chain('c'), chain('a'), chain('b')]);
    second.resolve();
    await p2;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
  });

  it('无 reorder 在途时 load 正常写回', async () => {
    const service = resolve(ChainListService);
    api.listChains.mockResolvedValue([chain('b')]);
    await service.load();
    expect(ids(service.chains)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- chain-list.service`
Expected: FAIL——`service.reorder is not a function`。

- [ ] **Step 3: 实现 service 改动**

Modify `apps/web/src/services/chain-list.service.ts`（完整替换文件内容）：

```ts
import { Service } from '@rabjs/react';
import type { ChainDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

/** 全局链列表（spec §3.3）：侧栏 / 首页链色表 / 发布选链共用一份，禁止各拉。 */
export class ChainListService extends Service {
  chains: ChainDto[] = [];
  /**
   * reorder 在途计数（spec chain-ordering §6.3）：> 0 期间 load() 的写回被抑制
   * （请求照发、结果丢弃），由 reorder 收尾的统一 load 收敛。
   * 必须是计数而非布尔——重入语义允许并发第二次 reorder，第一次完成即解除抑制的话，
   * 并发 load 会覆盖第二次的乐观顺序造成闪回。
   */
  private reorderInFlight = 0;

  constructor() {
    super();
    // 冷启动兜底：不能只听 auth:changed——缓存登录态下 AuthService 构造不发事件、
    // me() 失败也不发，只听事件侧栏会一直空（spec §3.3）
    if (this.resolve(AuthService).user) void this.load();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) void this.load();
        else this.chains = [];
      },
      'global',
    );
    this.on('chain:changed', () => void this.load(), 'global');
  }

  async load(): Promise<void> {
    const chains = await client.listChains();
    // reorder 在途期间的并发 load（chain:changed 等）写回抑制：丢弃，由 reorder 收尾的统一 load 收敛
    if (this.reorderInFlight > 0) return;
    this.chains = chains;
  }

  /**
   * 拖拽松手提交完整新顺序（spec chain-ordering §6.3）：
   * 乐观更新 → PUT → 统一 load 收敛（成功）/回滚（失败）；失败回滚后 reject，由调用方 toast。
   * 重入允许（不排队、不阻塞 UI）：服务端按到达顺序 last-write-wins，
   * 每次收尾 load 收敛，最终呈现以最后一次 load 为准。
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.chains.map((c) => [c.id, c]));
    const optimistic = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is ChainDto => c !== undefined);
    // 防御：orderedIds 与当前列表不一致（拖拽期间列表被 chain:changed 改动）时跳过乐观写，
    // 仍提交并由收尾 load 收敛到服务端结果
    if (optimistic.length === orderedIds.length) this.chains = optimistic;
    this.reorderInFlight++;
    let failure: unknown = null;
    try {
      await client.reorderChains({ chainIds: orderedIds });
    } catch (err) {
      failure = err;
    } finally {
      this.reorderInFlight--;
    }
    // 计数已归零才 load：写回生效。成功 = 与服务端收敛；失败 = 回滚到服务端顺序。
    await this.load();
    if (failure) throw failure;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- chain-list.service`
Expected: 5 个用例全过。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @moment/web typecheck`
Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/chain-list.service.ts apps/web/src/services/chain-list.service.test.ts
git commit -m "feat(web): optimistic ChainListService.reorder with in-flight load suppression"
```

---

### Task 7 (web): `src/lib/chain-reorder.ts` — 拖拽手势状态机（纯逻辑）

**Files:**
- Create: `apps/web/src/lib/chain-reorder.ts`
- Test: `apps/web/src/lib/chain-reorder.test.ts`（新建，Vitest；不触 DOM，fake timers 驱动长按）

**Interfaces:**
- Consumes: 无（纯逻辑，不 import React / DOM；事件入参是最小结构接口，组件层直接传 React PointerEvent——结构化兼容）。
- Produces（Task 9 消费，不得改名）:
  - `DRAG_THRESHOLD_PX = 6` / `LONG_PRESS_ARM_MS = 350`（spec §6.2b 阈值常量）。
  - `moveItem<T>(items: readonly T[], from: number, to: number): T[]`——移除 `from` 项插入到 `to`（`to` = 移除后的最终下标）。
  - `insertionIndex(pointer: number, midpoints: readonly number[], excludeIndex: number): number`——不计 `excludeIndex` 项，中点沿主轴小于 `pointer` 的项数（= 拖动项的最终下标）。
  - `createDragGesture(options: { axis: 'x' | 'y'; handlers: DragGestureHandlers }): DragGesture`。
  - `DragGesture`：`phase`（`'idle' | 'pending' | 'dragging'`）、`suppressContextMenu`（getter，拖拽激活期间 true）、`pointerDown/pointerMove/pointerUp/pointerCancel`、`consumeClickSuppress()`（读取即清除的松手后 click 抑制标记）。
  - `DragGestureHandlers`：`onActivate()` / `onDragMove(offset: number)` / `onDrop()` / `onAbort()`。
  - `DragGesturePointerEvent`：`{ pointerId: number; isPrimary: boolean; pointerType: string; clientX: number; clientY: number }`。

**状态机规则（spec §6.2 逐条映射）：**
- 只跟踪主指针（`e.isPrimary`）；任何 `pointerId` 不匹配的事件忽略（§6.2d 副指针忽略）。
- `mouse`：位移 > 6px 激活；`touch`/`pen`：按下起 350ms 定时器进入 armed，armed 前任何移动 = `onAbort` 让位滚动，armed 后位移 > 6px 激活（§6.2b）。
- 激活时先 `onActivate()` 再 `onDragMove(offset)`（同一帧位移不丢）。
- 任何阶段 `pointerCancel` → 复位 + `onAbort()`，不产生提交（§6.2d）。
- `dragging` 中 `pointerUp` → 复位 + `onDrop()`，并置 click 抑制标记（§6.2e）；`pending` 中 `pointerUp` = 普通点击/长按菜单，静默复位、不置标记、不回调。
- `pending` 中 `pointerDown`（第二手势）忽略；`idle` 才接受新手势；每次 `pointerDown` 清除旧的 click 抑制标记。

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/lib/chain-reorder.test.ts`（完整内容）：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  LONG_PRESS_ARM_MS,
  createDragGesture,
  insertionIndex,
  moveItem,
  type DragGestureHandlers,
  type DragGesturePointerEvent,
} from './chain-reorder';

// 拖拽手势状态机（spec chain-ordering §6.2/§7）：
// pointerType 激活方式（mouse 6px / touch·pen 长按 350ms armed 后 6px）、armed 前移动让位滚动、
// pointercancel 清理、仅跟踪 isPrimary 主指针、松手 click 抑制、contextmenu suppress 窗口。

function makeHandlers() {
  return {
    onActivate: vi.fn(),
    onDragMove: vi.fn(),
    onDrop: vi.fn(),
    onAbort: vi.fn(),
  } satisfies DragGestureHandlers;
}

function down(over: Partial<DragGesturePointerEvent> = {}): DragGesturePointerEvent {
  return { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100, ...over };
}

function move(over: Partial<DragGesturePointerEvent> = {}) {
  return { pointerId: 1, clientX: 100, clientY: 100, ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('常量（spec §6.2b）', () => {
  it('阈值 6px / 长按 350ms', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
    expect(LONG_PRESS_ARM_MS).toBe(350);
  });
});

describe('moveItem / insertionIndex', () => {
  it('moveItem：前移 / 后移 / 原位', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('insertionIndex：不计排除项，按中点计数', () => {
    const midpoints = [10, 30, 50]; // 三项主轴中点，排除 index 1（拖动项）
    expect(insertionIndex(5, midpoints, 1)).toBe(0); // 最前
    expect(insertionIndex(20, midpoints, 1)).toBe(1); // 中点 10 在前
    expect(insertionIndex(40, midpoints, 1)).toBe(1); // 中点 50 仍在后
    expect(insertionIndex(60, midpoints, 1)).toBe(2); // 最后（排除项不计数）
  });
});

describe('mouse：6px 阈值激活（§6.2b）', () => {
  it('阈值内移动不激活；未激活的 pointerup = 普通点击，无回调无 click 抑制', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 103 })); // 3px < 6px
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('pending');

    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.consumeClickSuppress()).toBe(false); // 普通点击不抑制导航（§6.2e）
  });

  it('超阈值激活：onActivate 后同帧 onDragMove；松手 onDrop 且 click 抑制只消费一次', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 107 })); // 7px > 6px
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(7);
    expect(g.phase).toBe('dragging');
    expect(g.suppressContextMenu).toBe(true); // 激活期间 suppress contextmenu（§6.2c）

    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(20);

    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.suppressContextMenu).toBe(false);
    expect(g.consumeClickSuppress()).toBe(true); // 松手后 click 抑制（§6.2e）
    expect(g.consumeClickSuppress()).toBe(false); // 读取即消费，只一次
  });

  it('x 轴：按 clientX 计算位移', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'x', handlers });
    g.pointerDown(down());
    g.pointerMove(move({ clientX: 93, clientY: 100 })); // -7px
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(-7);
  });
});

describe('touch / pen：长按 armed 后移动才激活（§6.2b/§6.2c）', () => {
  it('armed 前（<350ms）移动 = 放弃手势让位滚动：onAbort，后续事件全部忽略', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(100);
    g.pointerMove(move({ clientY: 101 })); // armed 前任何移动即放弃
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');

    // 手势已放弃：同 pointerId 的后续移动/松手不再有任何回调（浏览器已接管滚动）
    g.pointerMove(move({ clientY: 130 }));
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDragMove).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });

  it('长按 350ms armed 后，位移超阈值才激活；armed 后阈值内移动不激活', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS); // armed
    g.pointerMove(move({ clientY: 103 })); // 3px，阈值内
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('pending');

    g.pointerMove(move({ clientY: 110 })); // 10px 激活
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(10);
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
  });

  it('长按 armed 后未移动即松手 = 长按菜单场景：无激活无提交，不抑制 click', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS);
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.consumeClickSuppress()).toBe(false); // contextmenu 由平台派发，手势不干预（§6.2c）
  });

  it('pen 与 touch 同规则：armed 前移动放弃（iPad + Pencil 同受滚动接管约束）', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'pen' }));
    vi.advanceTimersByTime(50);
    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onActivate).not.toHaveBeenCalled();
  });
});

describe('pointercancel 清理与多点触控（§6.2d）', () => {
  it('dragging 中 pointercancel：onAbort 清理，无提交，不抑制 click', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 110 })); // 激活
    g.pointerCancel({ pointerId: 1 });
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.suppressContextMenu).toBe(false);
    expect(g.consumeClickSuppress()).toBe(false);
  });

  it('pending（已 armed）中 pointercancel：onAbort', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS);
    g.pointerCancel({ pointerId: 1 });
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(g.phase).toBe('idle');
  });

  it('只跟踪 isPrimary 主指针：副指针的 down/move/up 全部忽略，主指针流程不受影响', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    // 副指针先落下（isPrimary=false）：完全不开启手势
    g.pointerDown(down({ pointerId: 2, isPrimary: false }));
    expect(g.phase).toBe('idle');

    // 主指针手势开始并激活
    g.pointerDown(down({ pointerId: 1 }));
    // 拖拽中第二根手指落下（儿童误触）：down / move / up 均不影响
    g.pointerDown(down({ pointerId: 2, isPrimary: false }));
    g.pointerMove(move({ pointerId: 2, clientY: 200 }));
    g.pointerUp({ pointerId: 2 });
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();

    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(20);

    // 主指针 pointerId 不匹配的 cancel 也忽略
    g.pointerCancel({ pointerId: 9 });
    expect(g.phase).toBe('dragging');
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
  });

  it('手势进行中新的 pointerDown 被忽略（单手势状态机）', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerId: 1 }));
    g.pointerDown(down({ pointerId: 1, clientY: 500 })); // 重复 down 不重置起点
    g.pointerMove(move({ clientY: 110 }));
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(10); // 起点仍是 100
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- chain-reorder`
Expected: FAIL——模块 `./chain-reorder` 不存在。

- [ ] **Step 3: 实现状态机**

Create `apps/web/src/lib/chain-reorder.ts`（完整内容）：

```ts
// 链拖拽排序纯逻辑（spec chain-ordering §6.2/§7）：手势状态机 + 顺序计算。
// 不依赖 React / DOM——事件入参是最小结构接口（React PointerEvent 结构化兼容），
// 计时用全局 setTimeout（测试经 vi.useFakeTimers 驱动）。DOM 接线见 shell/chain-nav-list.tsx。

/** 拖拽主轴位移阈值（px）：mouse 直接按阈值激活；touch/pen 长按 armed 后同样按阈值激活（§6.2b） */
export const DRAG_THRESHOLD_PX = 6;
/** touch/pen 长按进入 armed 态的时长（ms）；armed 前任何移动 = 放弃手势让位原生滚动（§6.2b） */
export const LONG_PRESS_ARM_MS = 350;

/** 给定 items 与 from/to 计算新顺序：移除 from 项后插入到 to（to = 移除后的最终下标）。 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * 由指针主轴坐标与各项主轴中点计算插入后下标：
 * 不计 excludeIndex（拖动项自身），返回中点严格小于 pointer 的项数——即拖动项的最终下标。
 */
export function insertionIndex(pointer: number, midpoints: readonly number[], excludeIndex: number): number {
  let count = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i === excludeIndex) continue;
    if ((midpoints[i] as number) < pointer) count++;
  }
  return count;
}

export type DragPhase = 'idle' | 'pending' | 'dragging';

/** 最小指针事件结构：React PointerEvent 与本接口结构化兼容，组件层无需适配。 */
export interface DragGesturePointerEvent {
  pointerId: number;
  isPrimary: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
}

export interface DragGestureHandlers {
  /** 拖拽激活：组件层开始视觉反馈，并挂非 passive touchmove preventDefault 阻止滚动接管（§6.2b） */
  onActivate(): void;
  /** 激活后移动：主轴位移 px（当前坐标 - 按下坐标，含符号） */
  onDragMove(offset: number): void;
  /** 激活后松手：提交新顺序。紧随的 click 由 consumeClickSuppress 抑制（§6.2e） */
  onDrop(): void;
  /** 任意阶段中止（armed 前移动 / pointercancel）：清理临时态，不产生提交（§6.2d） */
  onAbort(): void;
}

export interface DragGesture {
  readonly phase: DragPhase;
  /** 拖拽激活期间为 true：组件层在 contextmenu 捕获阶段 suppress 本次菜单（§6.2c） */
  readonly suppressContextMenu: boolean;
  pointerDown(e: DragGesturePointerEvent): void;
  pointerMove(e: Pick<DragGesturePointerEvent, 'pointerId' | 'clientX' | 'clientY'>): void;
  pointerUp(e: Pick<DragGesturePointerEvent, 'pointerId'>): void;
  pointerCancel(e: Pick<DragGesturePointerEvent, 'pointerId'>): void;
  /** 激活过的拖拽松手后为 true 一次（读取即清除）：组件层在 click 捕获阶段抑制导航（§6.2e） */
  consumeClickSuppress(): boolean;
}

/**
 * 单手势状态机（§6.2 逐条）：
 * - 只跟踪主指针（isPrimary）；pointerId 不匹配的事件一律忽略（§6.2d 副指针忽略）；
 * - mouse：位移 > 阈值激活；touch/pen：350ms 长按 armed 后位移 > 阈值才激活，
 *   armed 前任何移动 = 放弃让位滚动（pen 与 touch 同受滚动接管约束，§6.2b）；
 * - 任何阶段 pointercancel → 复位 + onAbort，不提交（§6.2d）；
 * - pending 中 pointerUp = 普通点击 / 长按菜单，静默复位不干预（§6.2c/§6.2e）。
 */
export function createDragGesture(options: { axis: 'x' | 'y'; handlers: DragGestureHandlers }): DragGesture {
  const { axis, handlers } = options;
  const coord = (e: { clientX: number; clientY: number }): number => (axis === 'y' ? e.clientY : e.clientX);

  let phase: DragPhase = 'idle';
  let pointerId = -1;
  let startCoord = 0;
  /** touch/pen 手势（需长按 armed）；mouse 按下即 armed */
  let longPress = false;
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let clickSuppress = false;

  const cancelArm = () => {
    if (armTimer !== null) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  };

  const reset = () => {
    cancelArm();
    phase = 'idle';
    pointerId = -1;
    longPress = false;
    armed = false;
  };

  return {
    get phase() {
      return phase;
    },
    get suppressContextMenu() {
      return phase === 'dragging';
    },
    consumeClickSuppress() {
      const value = clickSuppress;
      clickSuppress = false;
      return value;
    },
    pointerDown(e) {
      if (!e.isPrimary) return; // 只跟踪主指针（§6.2d）
      if (phase !== 'idle') return; // 单手势：进行中的手势不被新 down 打断
      clickSuppress = false; // 旧抑制标记随新手势清除（真实 click 必 preceded by pointerdown）
      pointerId = e.pointerId;
      startCoord = coord(e);
      longPress = e.pointerType !== 'mouse'; // touch/pen 同走长按分支（§6.2b）
      armed = !longPress;
      phase = 'pending';
      if (longPress) {
        armTimer = setTimeout(() => {
          armTimer = null;
          if (phase === 'pending') armed = true;
        }, LONG_PRESS_ARM_MS);
      }
    },
    pointerMove(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return; // 未跟踪 / 副指针
      const offset = coord(e) - startCoord;
      if (phase === 'dragging') {
        handlers.onDragMove(offset);
        return;
      }
      // pending
      if (longPress && !armed) {
        // armed 前移动 = 放弃手势让位原生滚动（§6.2b）；浏览器随后接管并可能补发 pointercancel（已 idle，忽略）
        reset();
        handlers.onAbort();
        return;
      }
      if (Math.abs(offset) > DRAG_THRESHOLD_PX) {
        cancelArm();
        phase = 'dragging';
        handlers.onActivate();
        handlers.onDragMove(offset); // 同帧位移不丢
      }
    },
    pointerUp(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return;
      if (phase === 'dragging') {
        reset();
        clickSuppress = true; // 抑制紧随的 click，防松手触发导航（§6.2e）
        handlers.onDrop();
      } else {
        reset(); // 未激活的 pointerup = 普通点击 / 长按菜单，不干预（§6.2c/§6.2e）
      }
    },
    pointerCancel(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return;
      reset();
      handlers.onAbort(); // §6.2d：浏览器接管滚动 / 系统打断，中止并清理
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- chain-reorder`
Expected: 全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chain-reorder.ts apps/web/src/lib/chain-reorder.test.ts
git commit -m "feat(web): chain reorder drag gesture state machine"
```

---

### Task 8 (web): `ContextMenu` 可选 ref 句柄 `close()`（拖拽激活先关已开菜单）

**Files:**
- Modify: `apps/web/src/ui/menu/Menu.tsx`
- Modify: `apps/web/src/ui/menu/index.ts`
- Test: `apps/web/src/ui/menu/Menu.test.tsx`（扩展既有文件）

**Interfaces:**
- Consumes: React 19 ref-as-prop（与 `Menu.tsx` 内 `Pressable ref={triggerRef}` 透传同一房式）。
- Produces（Task 9 消费，不得改名）:
  - `type ContextMenuHandle = { close(): void }`——从 `@/ui/menu/index` 导出。
  - `ContextMenuProps` 新增可选 `ref?: Ref<ContextMenuHandle>`；既有调用方零影响（不改既有 props 语义）。

**背景（实现者必读）：** spec §6.2c 要求「拖拽已因移动而激活时，若菜单已开则先关闭再进入拖拽」。`ContextMenu` 的开关是其内部 state（`Menu.tsx` `ContextMenu` 函数体内 `useState`），外部无法关闭——spec 给出的两个实现钩子是「捕获阶段 suppress」或「给 ContextMenu 加受控开关」。捕获 suppress 只能拦住尚未派发的 contextmenu（由 Task 9 在 NavLink 上做）；菜单已开（长按计时到达、手指仍按住时平台自动派发）的场景必须能程序化关闭，故加 ref 句柄。

- [ ] **Step 1: 写失败测试**

Modify `apps/web/src/ui/menu/Menu.test.tsx`：

1. 在 `import userEvent from '@testing-library/user-event';` 之后加一行 `import { createRef } from 'react';`（RTL 第 1 行 import 不动，`act` 已从 RTL 导入）。
2. `'./index'` 的 import 块加入 `type ContextMenuHandle`（并入既有 import）。
3. 在 `describe('ContextMenu', ...)` 块内末尾追加：

```tsx
  it('ref 句柄：程序化关闭已打开的菜单（拖拽激活先关菜单，spec chain-ordering §6.2c）', async () => {
    const ref = createRef<ContextMenuHandle>();
    render(
      <ContextMenu
        ref={ref}
        aria-label="链操作"
        items={
          <MenuItem id="settings" textValue="链设置">
            链设置
          </MenuItem>
        }
      >
        <button type="button">链</button>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '链' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    act(() => ref.current?.close());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- Menu.test`
Expected: FAIL——TS 报错 `ref` 不在 `ContextMenuProps` 上 / 运行时 `ref.current` 为 null。

- [ ] **Step 3: 实现句柄**

Modify `apps/web/src/ui/menu/Menu.tsx`：

1. react import 块加入 `useImperativeHandle,`（hooks 列表按字母序合入既有 `createContext, useContext, useEffect, useId, useRef, useState`）与类型 `Ref`（`import type { ComponentProps, ReactElement, ReactNode } from 'react';` 改为 `import type { ComponentProps, ReactElement, ReactNode, Ref } from 'react';`）。
2. `ContextMenuProps` 类型加入：

```ts
export type ContextMenuHandle = {
  /** 程序化关闭（拖拽激活时先关已弹出的菜单，spec chain-ordering §6.2c） */
  close(): void;
};

export type ContextMenuProps = {
  /** 命令集合的可访问名称 */
  'aria-label': string;
  onAction?(key: Key): void;
  /** 与 ResponsiveMenu 共享的同一批命令（MenuItem / MenuGroup） */
  items: ReactNode;
  /** 可选 ref 句柄（React 19 ref-as-prop）：仅暴露 close()，菜单开关仍为内部状态 */
  ref?: Ref<ContextMenuHandle>;
  children: ReactNode;
};
```

3. `ContextMenu` 函数签名解构加入 `ref`，函数体内 `const handleAction = ...` 之前加入：

```ts
  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), [ref]);
```

（`setOpen(false)` 即关闭：`point` 保留无碍——下次 `openAt` 总是先写新坐标再开。）

Modify `apps/web/src/ui/menu/index.ts`：type 导出块加入 `ContextMenuHandle,`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- Menu.test && pnpm --filter @moment/web typecheck`
Expected: 全过（既有 Menu 套件不回归）；typecheck exit 0。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/menu/Menu.tsx apps/web/src/ui/menu/index.ts apps/web/src/ui/menu/Menu.test.tsx
git commit -m "feat(web): expose imperative close on ContextMenu"
```

---

### Task 9 (web): Shell 接线 — `ChainNavList` 共用拖拽列表 + 两处渲染替换

**Files:**
- Create: `apps/web/src/shell/chain-nav-list.tsx`
- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/shell/shell-navigation.test.tsx`（renderShell 包 `ToastProvider`）

**Interfaces:**
- Consumes: Task 6 的 `ChainListService.reorder`；Task 7 的 `createDragGesture` / `moveItem` / `insertionIndex` / `DragGesture`；Task 8 的 `ContextMenuHandle`；既有 `ContextMenu` / `MenuItem`（`@/ui/menu/index`）、`useToast`（`@/ui/feedback/index`）、`ChainMark`、`sideLink` / `chipLink` 类名函数（**Shell.tsx 保留**——「大家的日子」两处 NavLink（Shell.tsx 行 50/75）仍在用——经 `itemClassName` prop 传入本组件，不移动）。
- Produces: `ChainNavList`——`{ chains: ChainDto[]; axis: 'x' | 'y'; itemClassName: (args: { isActive: boolean }) => string }`，Shell 侧栏（`axis="y"`）与顶部 chips（`axis="x"`）共用（spec §6.1「不各写一份」）。

**DOM 接线清单（spec §6.2 硬要求逐条落点，实现者逐条核对）：**
- **a) 压锚元素原生拖拽**：NavLink 加 `draggable={false}`。
- **b) 触屏滚动同轴冲突**：激活方式全在 Task 7 状态机；组件层在 `onActivate` 时对拖动项元素挂**非 passive** `touchmove` 监听并 `preventDefault()`（`touch-action` 在 pointerdown 时刻已采样，进行中改无效——故不给链项预设 `touch-action: none`），`onDrop`/`onAbort` 摘除。
- **c) ContextMenu 互斥**：NavLink 上 `onContextMenuCapture`——`gesture.suppressContextMenu` 为 true 时 `preventDefault + stopPropagation`（ContextMenu 的处理器在父 div 冒泡阶段，捕获拦截后不再触发）；`onActivate` 时经 `menusRef` 调 `close()` 关已开菜单；菜单打开期间不启动拖拽（菜单打开时 FloatingLayer 接管指针，pointerdown 落在浮层而非链项，手势自然不会启动）。
- **d) pointercancel / 多点触控**：状态机已保证；`onAbort` 清理指示线与 touchmove 监听。
- **e) 点击不回归**：NavLink 上 `onClickCapture`——`gesture.consumeClickSuppress()` 为 true 时 `preventDefault + stopPropagation`；未激活的 pointerup 不置标记，导航不变。
- **f) 视觉**：拖动项 `opacity-50`；插入指示线 `bg-action` 圆角细条（`h-0.5` 纵向 / `w-0.5 self-stretch` 横向，Tailwind 刻度值）；不新增 token。
- **g) 键盘可访问性**：本迭代不做（spec 已知取舍）。

**本 Task 无新组件测试**：spec §7 明确「DOM 拖拽本身不做 jsdom 仿真」；验收 = 既有 web 测试全绿（含调整后的 shell-navigation）+ typecheck/lint/build + 手动验收清单。

- [ ] **Step 1: 调整既有测试的 Provider 包裹（防回归准备）**

Modify `apps/web/src/shell/shell-navigation.test.tsx`：

1. import 块加入 `import { ToastProvider } from '@/ui/feedback/index';`
2. `renderShell` 的 JSX 中 `<RSRoot>` 与 `<Routes>` 之间包一层：

```tsx
      <RSRoot>
        <ToastProvider>
          <Routes>
```

并对应闭合 `</Routes>` 之后加 `</ToastProvider>`。

（Step 2 的 `ChainNavList` 消费 `useToast()`，App 真实挂载有 ToastProvider（`app-toast.test.tsx` 已锁定），本测试渲染裸 Shell 必须补包，否则 `useToast` 抛「必须在 ToastProvider 内使用」。）

Run: `pnpm --filter @moment/web test -- shell-navigation`
Expected: 全绿——此时 `Shell.tsx` 尚未改动、尚不消费 useToast；本步锁定 harness 基线，组件落地后的红灯由 Step 3 前「`./chain-nav-list` 模块不存在」承担。

- [ ] **Step 2: 创建 `chain-nav-list.tsx`**

Create `apps/web/src/shell/chain-nav-list.tsx`（完整内容）：

```tsx
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import {
  createDragGesture,
  insertionIndex,
  moveItem,
  type DragGesture,
} from '@/lib/chain-reorder';
import { ChainListService } from '@/services/chain-list.service';
import { useToast } from '@/ui/feedback/index';
// 必须显式指向 barrel：src/ui/ 下遗留 Menu.tsx 会截获裸目录导入（见 ui/menu/index.ts）
import { ContextMenu, MenuItem, type ContextMenuHandle } from '@/ui/menu/index';

type Axis = 'x' | 'y';
type ItemClassName = (args: { isActive: boolean }) => string;

type DragState = {
  id: string;
  from: number;
  index: number;
  el: HTMLElement;
  /** 按下时刻的指针主轴坐标（clientX/Y 坐标系，与 getBoundingClientRect 同空间） */
  startPointer: number;
};

function axisCoord(e: { clientX: number; clientY: number }, axis: Axis): number {
  return axis === 'y' ? e.clientY : e.clientX;
}

function midpointOf(el: HTMLElement, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  return axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
}

/** 插入指示线（spec §6.2f）：只消费 --action token；h-0.5 / w-0.5 是 Tailwind 刻度值，非一次性尺寸 */
function DropIndicator({ axis }: { axis: Axis }) {
  return (
    <span
      aria-hidden
      className={
        axis === 'y'
          ? 'h-0.5 shrink-0 rounded-full bg-action'
          : 'w-0.5 shrink-0 self-stretch rounded-full bg-action'
      }
    />
  );
}

/**
 * 可拖拽排序的链导航列表（spec chain-ordering §6.1）：Shell 侧栏（axis=y）与顶部 chips（axis=x）共用。
 * 手势状态机在 @/lib/chain-reorder（纯逻辑，单测覆盖）；本组件只做 DOM 接线：
 * draggable={false} 压锚元素原生拖拽（§6.2a）；激活后挂非 passive touchmove preventDefault
 * 阻止滚动接管（§6.2b）；contextmenu 捕获阶段 suppress + 已开菜单经 ContextMenuHandle 关闭（§6.2c）；
 * 松手后抑制紧随的 click 防误导航（§6.2e）。拖拽手势期间的临时顺序只在本组件内，松手才调 reorder（§6.3）。
 */
export const ChainNavList = observer(function ChainNavList({
  chains,
  axis,
  itemClassName,
}: {
  chains: ChainDto[];
  axis: Axis;
  itemClassName: ItemClassName;
}) {
  const chainList = useService(ChainListService);
  const toast = useToast();
  const navigate = useNavigate();
  /** 拖动中的视觉态：id = 拖动项；index = 插入后下标（不计拖动项自身） */
  const [indicator, setIndicator] = useState<{ id: string; index: number } | null>(null);
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const menusRef = useRef(new Map<string, ContextMenuHandle>());
  const dragRef = useRef<DragState | null>(null);
  const removeTouchBlockRef = useRef<(() => void) | null>(null);
  // 手势机整个组件生命周期单例：chains 变化（chain:changed 等）不重建，避免拖拽途中被重置；
  // 处理器经 latestRef 读最新 chains / chainList / toast
  const latestRef = useRef({ chains, chainList, toast });
  latestRef.current = { chains, chainList, toast };
  const gestureRef = useRef<DragGesture | null>(null);
  if (gestureRef.current === null) {
    gestureRef.current = createDragGesture({
      axis,
      handlers: {
        onActivate() {
          const drag = dragRef.current;
          if (!drag) return;
          // 已弹出的「链设置」菜单先关闭：长按 + 移动 = 拖拽（§6.2c）
          menusRef.current.get(drag.id)?.close();
          // 激活后阻止浏览器滚动接管（§6.2b）：touch-action 在 pointerdown 时已采样，
          // 手势进行中只能挂非 passive touchmove preventDefault
          const prevent = (ev: TouchEvent) => {
            if (ev.cancelable) ev.preventDefault();
          };
          drag.el.addEventListener('touchmove', prevent, { passive: false });
          removeTouchBlockRef.current = () => drag.el.removeEventListener('touchmove', prevent);
          setIndicator({ id: drag.id, index: drag.index });
        },
        onDragMove(offset) {
          const drag = dragRef.current;
          if (!drag) return;
          const { chains: items } = latestRef.current;
          const pointer = drag.startPointer + offset;
          const midpoints = items.map((c) => {
            const el = itemsRef.current.get(c.id);
            return el ? midpointOf(el, axis) : Number.POSITIVE_INFINITY;
          });
          drag.index = insertionIndex(pointer, midpoints, drag.from);
          setIndicator({ id: drag.id, index: drag.index });
        },
        onDrop() {
          const drag = dragRef.current;
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          setIndicator(null);
          if (!drag) return;
          if (drag.index === drag.from) return; // 原位松手：顺序未变，不提交
          const { chains: items, chainList: list, toast: t } = latestRef.current;
          const orderedIds = moveItem(
            items.map((c) => c.id),
            drag.from,
            drag.index,
          );
          // 乐观更新 / 失败回滚 + 收敛由 service 统一 load 完成（§6.3）；失败 toast 遵循 Feedback 规范
          void list.reorder(orderedIds).catch(() =>
            t.show({ key: 'chain-reorder-failed', message: '链顺序保存失败，已恢复原顺序' }),
          );
        },
        onAbort() {
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          dragRef.current = null;
          setIndicator(null);
        },
      },
    });
  }
  const gesture = gestureRef.current;

  const onItemPointerDown = (c: ChainDto, index: number) => (e: ReactPointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 只认主键
    if (!e.isPrimary) return; // 副指针一律忽略（§6.2d）
    if (gesture.phase !== 'idle') return; // 单手势
    const el = e.currentTarget;
    if (e.pointerType === 'mouse') el.setPointerCapture?.(e.pointerId); // touch/pen 有隐式捕获；jsdom 无此方法，可选调用
    dragRef.current = { id: c.id, from: index, index, el, startPointer: axisCoord(e, axis) };
    gesture.pointerDown(e);
  };

  // 渲染：拖动项保持原位（半透明），指示线插在「最终下标」对应的空隙
  const rendered: ReactNode[] = [];
  let nonDragged = 0;
  chains.forEach((c, index) => {
    if (indicator && c.id !== indicator.id && nonDragged === indicator.index) {
      rendered.push(<DropIndicator key="__drop-indicator" axis={axis} />);
    }
    if (c.id !== indicator?.id) nonDragged++;
    rendered.push(
      <ContextMenu
        key={c.id}
        ref={(handle: ContextMenuHandle | null) => {
          if (handle) menusRef.current.set(c.id, handle);
          else menusRef.current.delete(c.id);
        }}
        aria-label={`${c.name} 的链操作`}
        onAction={(key) => {
          if (key === 'settings') navigate(`/chains/${c.id}/settings`);
        }}
        items={
          <MenuItem id="settings" textValue="链设置">
            链设置
          </MenuItem>
        }
      >
        <NavLink
          to={`/chains/${c.id}`}
          draggable={false}
          ref={(el: HTMLAnchorElement | null) => {
            if (el) itemsRef.current.set(c.id, el);
            else itemsRef.current.delete(c.id);
          }}
          className={(args) => `${itemClassName(args)}${indicator?.id === c.id ? ' opacity-50' : ''}`}
          onPointerDown={onItemPointerDown(c, index)}
          onPointerMove={(e) => gesture.pointerMove(e)}
          onPointerUp={(e) => {
            gesture.pointerUp(e);
            if (gesture.phase === 'idle') dragRef.current = null; // 未激活的 pointerup（普通点击）清掉临时态
          }}
          onPointerCancel={(e) => gesture.pointerCancel(e)}
          onClickCapture={(e) => {
            // 激活过拖拽的手势结束后抑制随后的 click（§6.2e）；普通点击不置标记，导航不变
            if (gesture.consumeClickSuppress()) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onContextMenuCapture={(e) => {
            // 仅当拖拽已因移动而激活时才 suppress 本次 contextmenu（§6.2c）；未激活则菜单照常弹
            if (gesture.suppressContextMenu) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <ChainMark chainId={c.id} color={c.color} icon={c.icon} size={16} />
          <span className="truncate">{c.name}</span>
        </NavLink>
      </ContextMenu>,
    );
  });
  if (indicator && nonDragged === indicator.index) {
    rendered.push(<DropIndicator key="__drop-indicator" axis={axis} />);
  }
  return <>{rendered}</>;
});
```

- [ ] **Step 3: 替换 Shell 两处 chains.map**

Modify `apps/web/src/shell/Shell.tsx`：

1. import 调整：删去 `import type { ChainDto } from '@moment/dto';`、`import { ChainMark } from '@/chain/ChainMark';`、`import { ContextMenu, MenuItem } from '@/ui/menu/index';`（含其上方注释行）；加入 `import { ChainNavList } from './chain-nav-list';`。
2. 侧栏 `<nav>` 内 `{(chains ?? []).map((c) => (<ChainNav key={c.id} chain={c} className={sideLink} />))}` 替换为：

```tsx
          <ChainNavList chains={chains ?? []} axis="y" itemClassName={sideLink} />
```

3. 顶部 chips `<div>` 内 `{(chains ?? []).map((c) => (<ChainNav key={c.id} chain={c} className={chipLink} />))}` 替换为：

```tsx
            <ChainNavList chains={chains ?? []} axis="x" itemClassName={chipLink} />
```

4. 删除文件底部的 `function ChainNav(...)` 整个函数（逻辑已迁入 `chain-nav-list.tsx`，含右键「链设置」命令——`shell-navigation.test.tsx` 的右键用例守护不回归）。

- [ ] **Step 4: 运行确认通过（既有套件守护不回归）**

Run: `pnpm --filter @moment/web test`
Expected: 全绿——`shell-navigation.test.tsx` 的链链接导航、右键「链设置」、create-chain、composer 用例全部不回归；Task 6/7/8 新增测试在内。

- [ ] **Step 5: typecheck / lint / build**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: 全部 exit 0。

- [ ] **Step 6: 手动验收清单（真实浏览器 + 平板或 DevTools touch 仿真，逐条过）**

1. ≥1400px 侧栏：鼠标按下移动 6px 内不激活（无指示线），超过 6px 激活，拖动项半透明、指示线随动；松手后新顺序立即生效，刷新页面后保持（服务端已持久化）。
2. <1400px 顶部 chips：横向拖拽同理；chips 容器横向滚动在**未长按直接划动**时正常（手势让位滚动）。
3. **（组件落地后第一时间验，不要全套装完再验）** 触屏真机优先、仿真次之：长按链项不动 → ~500ms 弹出「链设置」菜单（现状不回归）；长按后移动 → 菜单关闭（或未来得及弹出则被 suppress）进入拖拽；松手落点正确。此条覆盖「平台在 contextmenu 弹出瞬间可能补发 pointercancel」的继承风险（取舍第 8 条），仿真环境不复现时以真机（家庭平板）为准。
4. 触屏拖拽中列表不滚动（touchmove preventDefault 生效）；拖出列表区域松手 / 系统手势打断（pointercancel）→ 指示线消失、无提交。
5. 拖拽中第二根手指落下/滑动 → 拖拽不受干扰。
6. 拖拽松手后不触发导航（停留在当前页）；普通点击链项导航到 `/chains/:id` 不变。
7. DevTools 离线（或停 server）后拖拽提交 → toast「链顺序保存失败，已恢复原顺序」，列表回滚到服务端顺序；恢复网络后列表与另一台设备/浏览器在下一次拉取时收敛（多设备 last-write-wins，spec §6.4 取舍）。
8. 右键（桌面）/ Shift+F10 链设置菜单不回归。
9. 「链设置」菜单已打开时按压同一链项拖动：不启动拖拽（无指示线、无半透明——菜单为当前语境，`onItemPointerDown` 经 `ContextMenuHandle.isOpen()` 直接 bail）；外点关闭菜单后拖拽恢复正常。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shell/chain-nav-list.tsx apps/web/src/shell/Shell.tsx apps/web/src/shell/shell-navigation.test.tsx
git commit -m "feat(web): drag-to-reorder chains in shell navigation"
```

---

## Self-Review

**1. Spec 覆盖（逐节核对）：**

- §1 背景与目标 / 非目标：只做 per-user 排序 + web 拖拽；不做 owner 全局排序、置顶概念、lexorank；share 只读页 / compose 面板 / moment sheet 零改动（Global Constraints 注明 compose 自动生效）。✓
- §2 数据模型：`sort_order int notNull default 0`、允许负数、无唯一约束 → Task 3 schema；`drizzle-kit generate` 不手写改表 SQL → Task 3 Step 3；同迁移文件内回填（ROW_NUMBER PARTITION BY user_id ORDER BY created_at DESC, id）→ Task 3 Step 4（SQL 逐字取自 spec）；MySQL 8.4 窗口函数 → Task 3 Step 7 / Task 5 实测；**迁移编辑时序硬约束** → Global Constraints 首条 + Task 3 时序警告与机制前提 + Step 3–9 顺序（generate → 立即 append → diff 检查 → **globalSetup 加 `SKIP_GLOBAL_MIGRATE` 守卫** → **docker 回填验证（带守卫，输出不含 `migrations applied` 为机制证据）** → 远程首跑——「先验证再跑迁移」，docker 验证不过则远程库零记录、无 hash 分叉）。✓
- §3 列表查询：`ORDER BY sort_order ASC, created_at DESC` → Task 4 Step 3.5，测试含并列兜底用例。✓
- §4 新链置顶：create / acceptInvite min-1、首链 1、退出重进回顶部、并发重复 sortOrder 容忍（不设唯一约束）→ Task 4 Step 3.4/3.6/3.7 + 三个测试用例。✓
- §5 API：`PUT /api/chains/order`、body `{chainIds}`、204（`@HttpCode(204)+@OnUndefined(204)`）、去重集合恰好等于全部链否则 `CHAIN_ORDER_MISMATCH`、校验与重写同事务、IN 限定、空数组合法、dto schema（min(1).max(36).max(200)）、api-client `reorderChains` → Task 1/2/4；错误结构统一 `{error:{code,...}}` UPPER_SNAKE（沿用 `BadRequestError` + 既有 error-handler）。✓
- §6.1 两处共用同一个 ChainNav 与排序逻辑 → Task 9 `ChainNavList` 单组件两 axis。✓
- §6.2 a–g：a) `draggable={false}` → Task 9 组件；b) pointerType 激活 + 350ms armed + touchmove preventDefault（非 passive）+ 不预设 touch-action + pen 并 touch → Task 7 状态机 + Task 9 onActivate；c) contextmenu 互斥（捕获 suppress / 已开则 close / 未移动不干预 / flicker 取舍）→ Task 8 ref 句柄 + Task 9 onContextMenuCapture/onActivate；d) pointercancel 清理 + isPrimary 主指针 + 副指针忽略 → Task 7 + 单测；e) 点击不回归 + 松手 click 抑制 → Task 7 suppress 标记 + Task 9 onClickCapture；f) 视觉只消费既有 tokens（`bg-action`/`opacity-50`/刻度值）→ Task 9；g) 键盘本迭代不做 → Task 9 清单注明。✓
- §6.3 提交流程：乐观更新 / 在途标志 / 成功收敛 load / 失败 toast + 回滚 load / **竞态防护（在途抑制 load 写回）** / **重入语义（引用计数非布尔）** / 拖拽临时顺序只在组件内 → Task 6（service + 4 个竞态/重入用例）+ Task 9（onDrop 才调 reorder）。✓
- §6.4 compose 同源消费无改动、多设备 last-write-wins 取舍 → Global Constraints + Task 9 验收清单第 7 条。✓
- §7 测试清单逐条：dto 正常/边界（空数组、超长 id、超 200）→ Task 1 三个用例；api-client 路由对齐 → Task 2；server listMine 排序 / create·acceptInvite 置顶（min-1、首链 1）/ reorder 正常重写 / 漏 id·多 id·他人链 id → CHAIN_ORDER_MISMATCH / 幂等 / 同事务+IN 限定（hook 顺序模拟）/ 退出重进回顶部 / 迁移回填验证（本地 docker 临时 schema）→ Task 4 十个用例 + Task 5 两个用例；web reorder 乐观·失败回滚+toast / 在途+并发 load 竞态 / 重入 / 状态机单测（含副指针忽略）/ DOM 不仿真 → Task 6 五个用例 + Task 7 十四个用例 + Task 9 无组件测试。✓
- §8 红线：不新增表、`resetDb()` 不动、迁移只打 `.env` 测试库（且首跑排在 docker 回填验证之后）、每 Task 一个 conventional commit、TDD 红灯先行 → 各 Task Steps。**TDD 豁免点名：Task 9（Shell 接线）无红灯步骤**——spec §7 明确「DOM 拖拽本身不做 jsdom 仿真」，其红灯由 Step 3 前「`./chain-nav-list` 模块不存在」的编译失败承担，行为正确性由 Task 6/7/8 的单测与既有 shell-navigation 套件共同守护；另 Task 5 是迁移验证测试，其「红灯」形态是 Task 3 时序内的基线守卫失败，已在 Task 3 Step 7 说明。✓

**2. 占位符扫描：** 无 TBD / TODO / 「适当处理」/「类似 Task N」。所有代码块完整（dto schema、client 方法、service 方法、controller 路由、两个新测试文件、lib 状态机、组件、ContextMenu diff）；唯一非逐字产物是 `0014_<random>.sql` 的文件名（drizzle-kit 随机后缀），其内容已逐字给出。

**3. 跨 Task 类型一致性：**
- `reorderChainsInputSchema` / `ReorderChainsInput`：Task 1 定义 → Task 2 interface 签名消费 → Task 4 controller parse + service 入参，名称/形状一致（`{ chainIds: string[] }`）。✓
- `client.reorderChains({ chainIds })` → Task 6 service 调用形状一致；`ChainListService.reorder(orderedIds): Promise<void>`（失败 reject）→ Task 9 `.catch(toast)` 接线一致。✓
- `createDragGesture({ axis, handlers })` / `DragGesture.phase` / `suppressContextMenu` / `consumeClickSuppress()`：Task 7 定义 → Task 9 逐名消费；`insertionIndex(pointer, midpoints, excludeIndex)` 与 `moveItem(items, from, to)` 的参数序两处一致。✓
- `ContextMenuHandle`：Task 8 定义并从 `@/ui/menu/index` 导出 → Task 9 import 同一 barrel。✓
- `reorderAfterValidateHook` 只在 Task 4 定义与消费（测试注入），无跨 Task 泄漏。✓
- toast key `chain-reorder-failed` 仅 Task 9 使用；`axis: 'x' | 'y'` 在 Task 7 options 与 Task 9 props 一致。✓

