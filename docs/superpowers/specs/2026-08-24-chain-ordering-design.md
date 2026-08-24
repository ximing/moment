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

## 5. API

新增端点：

```
PUT /api/chains/order
body: { chainIds: string[] }
→ 204 No Content
```

语义与校验（在 `ChainService.reorder(userId, chainIds)`，响应固定 204——客户端已持有完整顺序，不需要回读）：

1. `chainIds` 去重后的集合必须**恰好等于**当前用户参与的全部链 id 集合（防漏、防越权、防半截状态）。不满足 → `HttpError(400, 'CHAIN_ORDER_MISMATCH')`。
2. 校验通过后，单事务把该用户每行 membership 的 `sortOrder` 重写为数组下标 + 1。
3. 响应返回 **204**。客户端已持有完整顺序（乐观更新），不需要回读；`chain:changed` 事件流不变。

dto（`packages/dto/src/chains.ts`）：

```ts
export const reorderChainsInputSchema = z.object({
  chainIds: z.array(z.string().min(1).max(36)),
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

- 用 pointer 事件（pointerdown → 移动超过阈值 ~6px 进入拖拽）而非 HTML5 DnD：链项是 `NavLink`（`<a>`，原生可拖链接）且被 `ContextMenu` 包裹，HTML5 DnD 会与链接拖拽/右键菜单打架；pointer 方案点击与拖拽天然不冲突。
- 未超阈值的 pointerup = 普通点击，导航行为不变；进入拖拽后抑制随后的 click（防止松手触发导航）。
- 侧栏为纵向拖动，顶部 chips 为横向拖动；插入位置用指示线/空隙表达。
- 视觉只消费既有 tokens：拖动项半透明/位移，插入指示用 `--action` 或既有线色，hover/focus 态不变；不新增 token、不写一次性像素值（遵循 `.claude/rules/web-ui.md` 与各设计规范）。
- 键盘可访问性：本迭代不为拖拽提供键盘替代（链少、有右键菜单可进设置）；如规范评审要求再补。记为已知取舍。

### 6.3 提交流程（乐观更新）

`ChainListService`（`apps/web/src/services/chain-list.service.ts`）增加 `reorder(orderedIds: string[])`：

1. 立即按新顺序更新 `this.chains`（乐观）。
2. 调 `client.reorderChains({ chainIds: orderedIds })`。
3. 失败：toast 错误（遵循 Feedback 规范）并 `await this.load()` 回滚到服务端顺序。
4. 成功：不发额外事件——`chains` 在同一 Service 内，所有消费方（compose 面板、moment sheet、feed-home）自动一致。

拖拽手势期间的临时顺序只在组件内，松手才调 `reorder`。

### 6.4 其它消费方

- compose 面板 / moment sheet 链选择器：只读 `chainList.chains`，顺序自动生效，无代码改动（实现时确认确实同源）。
- `chain:changed` 事件触发的 `load()` 从服务端拿回新顺序，与乐观态一致，无闪烁。

## 7. 测试

- **dto**：`reorderChainsInputSchema` 正常/边界用例（空数组、超长 id）。
- **server**（触真实测试库，`--runInBand`）：
  - `listMine` 按 sortOrder 排序；
  - 迁移回填后老数据顺序 = 旧行为（可用 service 层模拟：手动构造乱序 sortOrder 验证查询）；
  - `create` / `acceptInvite` 新链置顶（sortOrder = min-1，首链 = 1）；
  - `reorder`：正常重写；漏 id / 多 id / 他人链 id → `CHAIN_ORDER_MISMATCH`；幂等（重复提交同序无副作用）；
  - 退出重进 = 回顶部。
- **web**（Vitest + jsdom）：
  - `ChainListService.reorder` 乐观更新、失败回滚 + toast；
  - 拖拽手势的状态机逻辑抽到 `src/lib/`（如 `chain-reorder.ts`：给定 items + from/to 计算新顺序、阈值判定），单测覆盖；DOM 拖拽本身不做 jsdom 仿真。

## 8. 红线与约定

- 不新增表，`resetDb()` 无需改动。
- server 迁移先打 `.env` 指向的测试库验证，严禁碰生产库。
- 每 Task 一个 conventional commit；TDD 红灯先行（`.claude/rules/testing.md`）。
