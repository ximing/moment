# 链排序（per-user）设计

日期：2026-08-24
状态：已批准（brainstorm 结论：每人自己排 + 拖拽交互）

## 1. 背景与目标

web 端链列表（Shell 侧栏 ≥1400px、顶部 chips <1400px）目前固定按 `chains.createdAt desc` 排列（`ChainService.listMine`）。用户希望能调整链在自己列表里的先后顺序。

已批准的决策：

- **顺序是 per-user 的**：同一家庭里各排各的，互不影响。顺序挂在 `chain_members`（「我 × 链」的关系）上，不加新表。
- **交互是拖拽**：在 Shell 链列表里直接拖拽，松手提交完整新顺序。
- **范围只含 web 端交互**；server/dto/api-client 的改动是为了持久化。RN app 不改代码，自动获得新顺序。

非目标（YAGNI）：

- 不做 owner 全局排序、不做置顶单独概念、不做 lexorank/分数索引增量排序。
- 不改公开分享只读页（share link 页是单链视图，无链列表概念）。
- compose 面板、moment sheet 的链选择器只消费新顺序，不提供排序入口。

## 2. 数据模型

`chain_members` 增加一列：

```
sortOrder: int('sort_order').notNull().default(0)
```

- 值越小越靠前；允许负数（见 §4 新链置顶）。
- 无唯一约束：正常情况下同一用户的 membership 行 sortOrder 互不相同（由 reorder 端点全量重写保证），但不靠 DB 约束强制。

### 迁移与回填

- schema 变更走 `drizzle-kit generate`（不手写改表 SQL）。
- 同一迁移文件内追加**数据回填**（drizzle 迁移允许附加自定义语句；回填是数据不是改表）：对每个用户按现有展示顺序（`chains.created_at DESC`，并列按 `chain_id` 稳定）写 1..n，保证老用户升级后列表顺序完全不变：

```sql
UPDATE chain_members cm
JOIN (
  SELECT cm2.user_id, cm2.chain_id,
         ROW_NUMBER() OVER (PARTITION BY cm2.user_id ORDER BY c.created_at DESC, c.id) AS rn
  FROM chain_members cm2 JOIN chains c ON c.id = cm2.chain_id
) ranked ON ranked.user_id = cm.user_id AND ranked.chain_id = cm.chain_id
SET cm.sort_order = ranked.rn;
```

MySQL 8.4（docker-compose 已确认）支持窗口函数。远程共享测试库同为 MySQL 8 系；实现时先验证再跑迁移。

**迁移编辑时序硬约束**：drizzle 迁移的 hash 由 migrator 运行时按文件内容计算（journal 只记 idx/tag/when），所以「generate 后追加回填 SQL」必须在**任何环境（含远程共享测试库）首次执行该迁移之前**完成；计划与实现中要有「generate 后立即追加、首跑前 diff 检查」的显式步骤，防止某个环境先跑了无回填版本的迁移导致 hash 分叉。

## 3. 列表查询

`ChainService.listMine` 排序改为：

```
ORDER BY chain_members.sort_order ASC, chains.created_at DESC
```

`created_at DESC` 是防御性兜底（正常回填后无并列）。

## 4. 新链 / 新加入的链：置顶

保持现在「新链在最前」的行为：

- `ChainService.create`：插入 owner membership 时 `sortOrder = 当前用户所有 membership 的最小 sortOrder - 1`；用户首条链（无现存 membership）取 1。在创建事务内完成。
- `ChainService.acceptInvite`：插入新 member 时同样取 `最小值 - 1`（已是成员的幂等分支不写）。
- 退出/被移除后重新加入 = 新 membership，按新链处理（回顶部），不记忆历史位置。
- 并发 create / acceptInvite 可能读出相同 min 而写入重复 sortOrder——预期内，不设唯一约束；展示由 §3 的 `created_at DESC` 兜底，下次 reorder 全量重写即收敛。

## 5. API

新增端点：

```
PUT /api/chains/order
body: { chainIds: string[] }
→ 204 No Content
```

语义与校验（在 `ChainService.reorder(userId, chainIds)`，响应固定 204——客户端已持有完整顺序，不需要回读）：

1. `chainIds` 去重后的集合必须**恰好等于**当前用户参与的全部链 id 集合（防漏、防越权、防半截状态）。不满足 → `HttpError(400, 'CHAIN_ORDER_MISMATCH')`。
2. **集合校验与重写 UPDATE 在同一事务内**；重写限定 `WHERE user_id = ? AND chain_id IN (:chainIds)`，不用裸 `WHERE user_id = ?` 全量重写——校验后、提交前并发入链的置顶新行（min-1）不参与本次重写，容忍其与新顺序交错，下次 reorder 收敛。
3. 响应返回 **204**（routing-controllers 惯例：`@HttpCode(204)` + `@OnUndefined(204)` 组合，参照 chains.controller 既有写法）。客户端已持有完整顺序（乐观更新），不需要回读；`chain:changed` 事件流不变。

dto（`packages/dto/src/chains.ts`）：

```ts
export const reorderChainsInputSchema = z.object({
  chainIds: z.array(z.string().min(1).max(36)).max(200),
});
export type ReorderChainsInput = z.infer<typeof reorderChainsInputSchema>;
```

（数组允许为空：0 条链的用户提交空数组是合法恒等操作；min(1) 反而制造无谓的 400。）

api-client 增加 `reorderChains(input: ReorderChainsInput): Promise<void>`，路由 `/api/chains/order`，PUT。

错误结构沿用统一 `{error:{code,message,details?}}`，机器码 UPPER_SNAKE。

## 6. web 端交互

### 6.1 拖拽位置

Shell 两处链列表渲染（`apps/web/src/shell/Shell.tsx`：侧栏 `chains.map`、顶部 chips `chains.map`）都支持拖拽排序。两处共用同一个 `ChainNav` 与排序逻辑，不各写一份。

### 6.2 拖拽方式：pointer-based，整项拖拽

用 pointer 事件手写手势，不用 HTML5 DnD API（链项被 `ContextMenu` 包裹，HTML5 DnD 会与其打架）。以下每条都是已核对代码后必须满足的硬要求：

**a) 压制锚元素原生拖拽**。`ChainNav` 内的 `NavLink` 渲染为 `<a href>`（Shell.tsx），锚元素默认可拖，越过浏览器自身阈值即触发原生 dragstart（URL 幽灵图），pointer 流随后收到 pointercancel，手势状态机会被半途杀死。必须给 NavLink 加 `draggable={false}`（或等价 dragstart preventDefault）。

**b) 触屏与原生滚动同轴冲突**。主目标设备是家庭平板，而两处容器都是原生可滚动且滚动方向与拖拽同轴：侧栏 `nav overflow-y-auto`（纵向拖）、顶部 chips `div overflow-x-auto`（横向拖）。触屏 pointerdown 后一旦移动，浏览器接管滚动并派发 pointercancel，固定像素阈值手势会被掐死。按 `pointerType` 区分激活方式：
   - `mouse`：移动超过 ~6px 阈值激活拖拽；
   - `touch` / `pen`：**长按 ~350ms 进入 armed 态，armed 后移动才激活拖拽**（见 c 的菜单互斥）；armed 前移动即放弃手势让位滚动。（pen 并入此分支：iPad + Apple Pencil 与 touch 一样受 touch-action 约束、会触发滚动接管，6px 阈值会被 pointercancel 杀手势。）
   - 注意：`touch-action` 的许可值在 pointerdown 时刻由浏览器采样，**手势进行中修改 `touch-action` 对当前手势无效**。因此激活后阻止滚动接管的手段是：对当前手势挂**非 passive 的 `touchmove` 监听并 `preventDefault()`**（pointermove 的 preventDefault 不能阻止滚动接管，必须用 touch 事件层）。pointercancel 清理（见 d）保留为兜底。不在静态样式上给链项预设 `touch-action: none`（否则链多时列表在链项上无法滚动）。

**c) 与 ContextMenu 的互斥（触屏长按入口不回归）**。`ContextMenu` 只挂 `onContextmenu`（Menu.tsx），而今天触屏上长按链项就会派发 contextmenu 弹「链设置」菜单——这是触屏上进链设置的唯一入口，不能被拖拽抢占。注意平台的 contextmenu 在长按计时到达（手指仍按住）时自动派发，并非松手触发。规则：
   - **contextmenu 默认不拦截**（菜单照常弹，现状不回归）；**仅当拖拽已因移动而激活时**才 suppress 本次 contextmenu，且若菜单已开则先关闭再进入拖拽；
   - 即：**长按 + 移动** = 进入拖拽（菜单被关闭/抑制）；**长按未移动** = 菜单正常弹出使用；
   - 菜单已打开时不启动拖拽手势；
   - 已知取舍：长按意图拖拽的用户会在 ~500ms 看到菜单闪开、移动瞬间关闭（flicker），功能正确，本迭代接受。
   实现钩子（plan 落实）：拖拽层在**捕获阶段**监听 contextmenu 做 stopPropagation/preventDefault，或给 ContextMenu 加受控开关——ContextMenu 的处理器会 preventDefault 并开菜单，不在捕获阶段拦截则 suppress 无法实现。

**d) pointercancel 清理与多点触控**。任何阶段收到 pointercancel（浏览器接管滚动、手势被系统打断等）都必须中止手势、清理临时态（指示线、位移、抑制标记），不产生 reorder 提交。状态机只跟踪主指针（`e.isPrimary`），拖拽进行中落下的第二根手指等副指针一律忽略（平板场景儿童误触）。

**e) 点击与导航不回归**。未激活拖拽的 pointerup = 普通点击，NavLink 导航不变；激活过拖拽的手势结束后抑制随后的 click（防松手触发导航）。

**f) 方向与视觉**。侧栏纵向、顶部 chips 横向；插入位置用指示线/空隙表达。视觉只消费既有 tokens：拖动项半透明/位移，插入指示用 `--action` 或既有线色，hover/focus 态不变；不新增 token、不写一次性像素值（遵循 `.claude/rules/web-ui.md` 与各设计规范）。

**g) 键盘可访问性**。本迭代不为拖拽提供键盘替代（链少、右键菜单可进设置），记为已知取舍。

### 6.3 提交流程（乐观更新 + 竞态防护）

`ChainListService`（`apps/web/src/services/chain-list.service.ts`）增加 `reorder(orderedIds: string[])`：

1. 立即按新顺序更新 `this.chains`（乐观），并置「reorder 在途」标志。
2. 调 `client.reorderChains({ chainIds: orderedIds })`。
3. 成功（204）：清在途标志，然后 `await this.load()` 与服务端收敛（一次列表请求，消除任何在途期间的漂移）。
4. 失败：清在途标志，toast 错误（遵循 Feedback 规范），并 `await this.load()` 回滚到服务端顺序。

**与 `chain:changed → load()` 的竞态防护（必须实现）**：本仓多处会 emit `chain:changed`（建链、链设置、邀请等），`load()` 会整体覆盖 `this.chains`。reorder 在途期间若有并发 `load()` 完成，会用提交前的旧顺序覆盖乐观顺序且不再自愈。因此：reorder 在途标志置位期间，`load()` 的**写回被抑制**（请求可发，结果丢弃）；在途结束（成功/失败）后由上面的 `load()` 统一收敛。等价实现（如单调序号丢弃陈旧写回）可接受，但必须在测试里覆盖该竞态。

拖拽手势期间的临时顺序只在组件内，松手才调 `reorder`。

**重入语义**：在途期间用户再次松手发起第二次 reorder 是允许的，不排队、不阻塞 UI；服务端按到达顺序 last-write-wins，客户端每次成功/失败都经统一 `load()` 收敛，最终呈现以最后一次 load 为准（短暂中间态可接受）。因此「在途标志」**不能是布尔量**——必须是引用计数/请求代序号（计数归零才解除 load 抑制），否则第一次完成即解除抑制，并发 load 会覆盖第二次的乐观顺序造成闪回。

### 6.4 其它消费方与多设备语义

- compose 面板链选择器：只读 `chainList.chains`（已核实同源，compose-panel.service resolve ChainListService），顺序自动生效，无代码改动。moment sheet 无链选择器（只有跳链链接），不涉及。
- **多设备 / 多端语义（显式取舍）**：`chain:changed` 是进程内事件总线，不是跨设备同步机制。设备 A reorder 后，设备 B 与 RN app 只在下次各自拉取列表时才看到新顺序；同一用户两台设备同时 reorder 时**last-write-wins**，后写者覆盖先写者，先写方客户端维持本地顺序直到下次 load。本迭代不做跨设备实时同步。



## 7. 测试

- **dto**：`reorderChainsInputSchema` 正常/边界用例（空数组、超长 id、超 200 长度）。
- **api-client**：`reorderChains` 加入 `client.test.ts` 既有路由对齐测试（方法 + 路径断言，参照 listChains 既有用例）。
- **server**（触真实测试库，`--runInBand`）：
  - `listMine` 按 sortOrder 排序；
  - `create` / `acceptInvite` 新链置顶（sortOrder = min-1，首链 = 1）；
  - `reorder`：正常重写；漏 id / 多 id / 他人链 id → `CHAIN_ORDER_MISMATCH`；幂等（重复提交同序无副作用）；校验与重写同事务、`chain_id IN` 限定（reorder 后并发入链的置顶行不被改写）；
  - 退出重进 = 回顶部；
  - **迁移回填验证**：远程共享测试库已应用全部既有迁移，直接跑 migrate 是 no-op，无法观察回填效果。验证规程（plan 落实细节）：用本地 docker compose 的 MySQL 8.4 起**临时 schema**（不碰远程共享库），migrate 到 0013 → 按旧行为造多用户多链数据 → 应用本迁移（0014）→ 断言 `listMine` 顺序与迁移前 `created_at DESC` 顺序一致；jest 内可通过指向临时 DATABASE_URL 的子进程跑 migrate 脚本或直接调 migrator；
  - 「并发入链不被改写」测试手段：`--runInBand` 下真实并发难以确定性复现，采用顺序模拟——在 reorder 事务的校验之后、提交之前注入一条新 membership 行，断言该行 sortOrder 不被重写（plan 落实具体注入方式，如 service 内可测试钩子或拆步调用）。
- **web**（Vitest + jsdom）：
  - `ChainListService.reorder` 乐观更新、失败回滚 + toast；
  - **reorder 在途 + 并发 load() 完成的竞态**：在途期间 load 结果被抑制，成功/失败后由统一 load 收敛（本设计最易出 bug 的点，必须有测试）；含**重入用例**（两次 reorder 并发，第一次先完成时第二次的乐观顺序不被 load 覆盖）；
  - 拖拽手势的状态机逻辑抽到 `src/lib/`（如 `chain-reorder.ts`：给定 items + from/to 计算新顺序、pointerType 激活方式、阈值/长按判定、pointercancel 清理、仅跟踪 isPrimary 主指针），单测覆盖（含副指针忽略用例）；DOM 拖拽本身不做 jsdom 仿真。

## 8. 红线与约定

- 不新增表，`resetDb()` 无需改动。
- server 迁移先打 `.env` 指向的测试库验证，严禁碰生产库。
- 每 Task 一个 conventional commit；TDD 红灯先行（`.claude/rules/testing.md`）。
