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
- 迁移：`drizzle-kit generate` 产出加列（schema 中定义为 `date('wall_date').notNull()`，生成 `ADD COLUMN`）+ 索引 `idx_moments_wall_date (wall_date)`；在生成的迁移文件末尾追加两条语句完成存量回填与收紧——`UPDATE moments SET wall_date = DATE(happened_at - INTERVAL happened_tz_offset MINUTE)`（MySQL 单语句回填，不需要应用层脚本）。若 strict mode 下直接加 `NOT NULL` 列报错，则改三步：`ADD COLUMN ... NULL` → UPDATE 回填 → `MODIFY wall_date date NOT NULL`。
- 读路径语义不变：`wall_date` 是纯冗余投影；展示仍用 `happened_at + happened_tz_offset`。
- `resetDb()` 无需改（加列不改表间删除顺序）。

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
- 序列化：复用 `serializeMoments(rows, userId)`（media/author/tags/计数/myReaction 同 feed）。
- 分页：不做。单日周年数据量家庭规模天然小；超长时前端截断展示「等 N 条」（YAGNI）。
- api-client：`getMemoriesToday(date: string): Promise<MemoriesTodayResponse>`。

## 3. server 实现

- 新域模块 `src/memories/`：`memories.controller.ts` + `memories.service.ts`（对齐 feed 模块范式）。
- 查询：`getMyChains(userId)` → 一条 SQL：

```sql
WHERE chain_id IN (...) AND deleted_at IS NULL
  AND MONTH(wall_date) = :m AND DAY(wall_date) = :d AND YEAR(wall_date) < :y
ORDER BY wall_date DESC
```

  → 内存按 `YEAR(wall_date)` 分组、组内墙钟升序 → `serializeMoments`。
- `MemoriesController` 记入 `app.ts` controllers 数组。
- 无 outbox/推送副作用（纯读端点）。

## 4. web 端

- feature `src/memories/`：`memories.service.ts`（页面级 Service，加载 `getMemoriesToday(today)`）+ 组件。
- 入口条：feed 顶部（`feed-home`），有周年内容时显示「📅 {N} 年前的今天 · 共 {count} 条」；点击展开同页内嵌面板（不新增路由，保持单页时间线形态）。
- 面板：按年份分组，复用现有 moment 卡片组件；分组头「{year} 年 · {n} 条」。
- 跨午夜：面板每次打开都重拉（不做过夜驻留刷新）。

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
  - 只含整数周年（当年/跨时区致同日但年份 = 今年的不出现）；年份倒序；组内升序；
  - 可见性：非成员链数据不出现在他人结果；
  - 软删 moment 不出现；
  - update 改 `happenedAt` 后 `wall_date` 重算（编辑链路）。
- api-client：mock 断言路径与参数。
- web/app：`pnpm lint` + tsc；手测入口条出现/不出现、分组渲染、点击进详情。
- 全量验证门槛：`pnpm test` 通过。

## 7. 明确不做（本轮）

- 通知/推送触发、月份维度回溯、分页、时光机 H5 分享卡、AI 文案总结。
- `wall_date` 的其他消费者（日历视图等）留待后续功能。
