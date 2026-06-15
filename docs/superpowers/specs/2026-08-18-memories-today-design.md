# 时刻 Moment — 那年今日（往年今日）Design

> 日期：2026-08-18
> 状态：设计已与用户对齐（方案 2：wall_date 冗余列；呈现 = 入口页面；范围 = 仅整年周年；端 = App + web；入口 = 时间线顶部入口条）
> 范围：server（新列 + 新端点）+ dto + api-client + web + app。
> 权威边界：数据模型与容量假设听 `2026-08-15-moment-design.md`；状态分层听 `2026-08-17-web-rab-state-migration.md` / `2026-08-18-app-mvp-rab-design.md`。

## 0. 背景与产品决策

「那年今日/时光机」是 backlog 中的情感差异化功能：展示「N 年前的今天」记录的时刻。

已对齐的决策：

- **形态**：入口页面（不做通知/推送触发）。
- **回溯范围**：仅整数周年（同月同日、年份严格小于今年），不做月份维度。
- **端**：App + web 同轮交付。
- **入口**：时间线顶部入口条，有内容才渲染，无内容不打扰。

## 1. 数据模型与迁移

- `moments` 新增列 `wall_date date not null`：发生地墙钟日期，= `DATE(happened_at − INTERVAL happened_tz_offset MINUTE)`，server 写路径计算。
- 写路径统一赋值：
  - create：insert 时随 `happenedAt`/`happenedTzOffset` 一并写入。
  - update：`happenedAt` 或 `happenedTzOffset` 变更时重算（本批 App 编辑功能会走到该路径，正好闭环）。
- 迁移（drizzle-kit 生成框架 + 手工追加数据语句；这是「不手写 SQL 改表」约定的已知偏离，回填语句属数据修正，与 share_links 迁移先例同性质）：
  1. `ADD COLUMN wall_date date NULL`（先允许 NULL，避免 strict mode 下对存量表直接加 NOT NULL 报错——无条件走三步，不依赖环境）；
  2. `UPDATE moments SET wall_date = DATE(happened_at - INTERVAL happened_tz_offset MINUTE)`（单语句回填存量）；
  3. `MODIFY wall_date date NOT NULL`；
  4. 索引 `idx_moments_wall_date (wall_date)`。
- 回滚 = drop column（纯投影，无损）。部署顺序：迁移与新代码同批发布——旧代码在 NOT NULL 收紧后 insert 不带 `wall_date` 会失败，不允许「先迁移后隔天部署」。
- 读路径语义不变：`wall_date` 是纯冗余投影；展示仍用 `happened_at + happened_tz_offset`。
- `resetDb()` 无需改（加列不改表间删除顺序）；**`tests/helpers/fixtures.ts` 的 `insertMoment` 必须同步补 `wall_date`**（按同一公式计算），否则加列后所有触库测试在夹具处失败（review I2——这是写路径三处之外的第四处）。

## 2. API 与 dto

- `GET /api/memories/today?date=YYYY-MM-DD`（auth）。`date` = 查看者本地日期，zod 校验 `YYYY-MM-DD`，非法 → `INVALID_DATE`。
- 响应 `MemoriesTodayResponse`：

```ts
interface MemoriesYearGroup {
  year: number;            // 墙钟年份（= moment 发生年份）
  moments: MomentResponse[]; // 组内按墙钟时间升序
}
interface MemoriesTodayResponse {
  years: MemoriesYearGroup[]; // 年份倒序；仅含有内容的周年
}
```

- 可见范围：与 feed 一致——我的链（`getMyChains`），未软删。
- **日期匹配语义（显式决策，review I5）**：`date` 是查看者本地日期，`wall_date` 是**记录者**时区墙钟日期——两套时钟。跨时区家庭中，同一时刻对不同成员的「那年今日」集合可能不同（记录贴近当地午夜的条目对某成员算昨天/今天不同侧）。这与 month-index 的墙钟归桶语义一致，是**有意选择**：回忆锚定「发生地那一天」，写入 dto 的字段注释。dto schema 注释须包含此说明。
- 序列化：复用 `serializeMoments(rows, userId)`（media/author/tags/计数/myReaction 同 feed）。
- 分页：不做。单日周年数据量家庭规模天然小；超长时前端截断展示「等 N 条」（YAGNI）。
- api-client：`getMemoriesToday(date: string): Promise<MemoriesTodayResponse>`。

## 3. server 实现

- 新域模块 `src/memories/`：`memories.controller.ts` + `memories.service.ts`（对齐 feed 模块范式）。
- 查询（review I1 修正：函数包裹列不走索引，改为可 sargable 的年份枚举）：`getMyChains(userId)`（返回 `Map<chainId, role>`，取 key 列表）→ 对 `date` 的每个候选年份 `y < 今年` 生成候选日期串，一条 SQL：

```sql
WHERE chain_id IN (...) AND deleted_at IS NULL
  AND wall_date IN ('2025-08-18', '2024-08-18', ...)  -- 枚举 date 的所有往年同月同日
ORDER BY wall_date DESC
```

  年份枚举下界：不无限回溯，取 `wall_date` 全表最小年份？否——固定回溯 **50 年**（家庭产品实际数据起点远小于此，避免无界列表；50 年前的今天几乎不可能有记录，IN 列表最长 50 项，无性能问题）。
  → 内存按 `YEAR(wall_date)` 分组、组内墙钟升序 → `serializeMoments`。
  `idx_moments_wall_date` 由此查询实际使用（IN 等值可走索引 range scan）。
- 2 月 29 日边界：`date = 02-29` 时往年候选仅为闰年的 `02-29`（非闰年无该日，自然跳过）——由日期串枚举天然保证，测试固定该行为。
- `MemoriesController` 记入 `app.ts` controllers 数组。
- 无 outbox/推送副作用（纯读端点）。

## 4. web 端

- feature `src/memories/`：`memories.service.ts`（页面级 Service，加载 `getMemoriesToday(today)`）+ 组件。
- 入口条：feed 顶部（`feed-home`），有周年内容时显示「📅 {N} 年前的今天 · 共 {count} 条」；点击展开同页内嵌面板（不新增路由，保持单页时间线形态）。
- 面板：按年份分组，复用现有 moment 卡片组件；分组头「{year} 年 · {n} 条」。
- 跨午夜：面板每次打开都重拉，`today` 在**打开时**定格为字符串（与 App 同款处理，不做过夜驻留刷新）。
- 已知成本：入口条判定需要一次 `getMemoriesToday` 请求（即使结果为空），feed 加载多一次轻量查询——家庭规模接受，不缓存。

## 5. App 端

- feature `src/features/memories/`：`index.tsx` + `memories.service.ts`（页面级 Service）。
- 入口条：`(tabs)/index.tsx` 时间线顶部筛选条之上，有内容才渲染：「📅 {N} 年前的今天有 {count} 条时刻 →」。
- 详情页：新路由 `app/memories/today.tsx`（Stack push，标题「往年今日」）；按年份分组，复用 `MomentCard`，点击进 `/moments/:id`。
- `today` 取设备本地日期，hydrate 时定格为字符串传参（页面存活跨午夜不漂移）。
- 遵守 rab 分层：入口条数据由 feed 页的 Service 或 memories 入口条自持有（实现时取更简单者），详情页独立页面级 Service；不新增全局 Service。

## 6. 测试与验证

- dto：`memories.test.ts` —— date 格式校验（含非法格式拒绝）。
- server：`memories.test.ts` 触库测试（`--runInBand`，`afterAll(closeDb)`，只打测试库）：
  - 两用户两链，不同年份同月同日数据，含不同 `happenedTzOffset` 的样本，断言墙钟归日正确；
  - **查看者时区 ≠ 记录者时区**样本：断言按 `wall_date`（记录者墙钟）归日、与 `date`（查看者本地）匹配的语义（review I5）；
  - 只含整数周年（当年/跨时区致同日但年份 = 今年的不出现）；年份倒序；组内升序；
  - 2 月 29：闰年记录在平年今日查询不出现，闰年今日查询出现（review M2）；12-31 / 01-01 跨年边界各一例；
  - 可见性：非成员链数据不出现在他人结果；
  - 软删 moment 不出现；
  - update 改 `happenedAt` 后 `wall_date` 重算（编辑链路）；`happenedTzOffset` 单独变化（不改时间点）也重算。
- api-client：mock 断言路径与参数。
- web/app：`pnpm lint` + tsc；手测入口条出现/不出现、分组渲染、点击进详情。
- 全量验证门槛：`pnpm test` 通过。

## 7. 明确不做（本轮）

- 通知/推送触发、月份维度回溯、分页、时光机 H5 分享卡、AI 文案总结。
- `wall_date` 的其他消费者（日历视图等）留待后续功能。
