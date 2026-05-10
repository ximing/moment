# Phase 4 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 4 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 4 实施计划：标签与聚合时间线：tags + 复合游标 feed。

本计划范围与设计要点（spec §3 tags/moment_tags、§4 Tags/Feed API、§5.1 Feed 查询、§5.6 补发可见性）：
1) 表：tags(id uuid, chain_id ref, name varchar(50), created_at，unique(chain_id,name))；moment_tags(moment_id ref, tag_id ref，联合主键)。扩展 resetDb。
2) tags 端点：GET /api/chains/:chainId/tags（viewer+，含每 tag 的 moment 数，一次 GROUP BY）；POST /api/chains/:chainId/tags（editor+，每链上限 100，超限 409 TAG_LIMIT_REACHED；重名 409 TAG_EXISTS）；DELETE /api/tags/:id（editor+，反查链鉴权，先硬删 moment_tags 关联再硬删 tag，一个事务）。
3) moments 扩展：POST /api/chains/:chainId/moments 与 PATCH /api/moments/:id 接受 tagIds（string[]），同事务校验全部 tag 属于该链（否则 400 TAG_NOT_IN_CHAIN）后重建 moment_tags。需要修改 Phase 3 的 moments service/dto——计划里给出精确的修改点与新代码（executor 会在已落地的 Phase 3 代码上改）。
4) feed：GET /api/feed?cursor=&chainIds=&tagId=&order=happened_at|created_at&limit=。实现要点全部按 spec §5.1 与 CONVENTIONS §3.4：请求入口一次查出我的 chain_id+role 集合（复用 chain_members 查询，进 request 上下文，不 join）；WHERE chain_id IN (...) AND deleted_at IS NULL + 复合游标条件 (happened_at, id) < cursor（order=created_at 时用 (created_at, id)）；ORDER BY happened_at DESC, id DESC LIMIT n；tagId 过滤以 moment_tags(tag_id, moment_id) 为驱动表；chainIds 参数可收窄范围但必须是我的链子集（含非我的链 id 时静默过滤并注明理由）。order=created_at 是补发可见性的次要排序。响应复用 momentSerializer，含 nextCursor（无更多时为 null）。
5) 链内 moments 列表（Phase 3）重构为与 feed 共用同一查询 builder（cursor/where 组装），计划给出重构后的代码。
6) dto：tags.ts + feed.ts。测试：tag CRUD/上限/重名/级联删；feed 跨链聚合正确性（只看得到我的链）、同 happened_at 多 moment 翻页不丢不重、tag 过滤、order=created_at 下补发可见、游标损坏 400 INVALID_CURSOR、chainIds 收窄。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md（用 Write 工具）。
- 假设 Phase 1-3 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（routing-controllers 0.11/typedi/drizzle 0.45/zod 3/jest ESM），重点核对复合游标 SQL（drizzle 写法）、IN 查询、GROUP BY。
2. 契约符合性：与 CONVENTIONS §3（特别是 §3.4 游标格式与 serializer 约定）逐字比对；与 spec §5.1 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏、测试断言同步更新）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase 4 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
