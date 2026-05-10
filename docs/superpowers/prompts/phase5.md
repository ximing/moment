# Phase 5 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 5 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 5 实施计划：互动与异步：评论 + 表情 + 通知 + outbox worker + 推送。

本计划范围与设计要点（spec §3 comments/reactions/notifications/push_tokens、§4 对应 API、§5.4 outbox+worker、§5.1 计数）：
1) 表：comments(id uuid, moment_id ref, author_id ref, content text, created_at, deleted_at null)；reactions(id uuid, moment_id ref, user_id ref, emoji varchar(16), created_at，unique(moment_id,user_id))；notifications(id uuid, user_id ref, type varchar(32), payload json, read_at null, created_at，索引(user_id, read_at))；push_tokens(id uuid, user_id ref, expo_token varchar(128) unique, platform varchar(16), last_seen_at, invalidated_at null)。扩展 resetDb；扩展 src/outbox/types.ts（comment.created / reaction.created）。
2) 端点：GET /api/moments/:id/comments（moment 可见即可读，分页方式自定并写明）；POST /api/moments/:id/comments（viewer+，content 1-1000 字，事务：插 comment + emitOutbox(comment.created)）；DELETE /api/comments/:id（评论作者或链 owner，软删）；PUT /api/moments/:id/reaction（viewer+，body {emoji}，upsert，emoji 白名单（定义 8-12 个常用 emoji 常量于 dto），事务：upsert + emitOutbox(reaction.created)）；DELETE /api/moments/:id/reaction（硬删）；GET /api/notifications?unread=&cursor=；POST /api/notifications/read（body {ids[]}，仅本人的）；POST /api/devices/push-token（body {expoToken, platform}，upsert + last_seen_at）。
3) worker：apps/server/src/worker/index.ts 独立入口（package script "worker": "tsx watch src/worker/index.ts"），轮询 outbox（每 2s 一批，SELECT ... WHERE status=pending AND (next_retry_at IS NULL OR next_retry_at<=now) ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED——mysql2/drizzle 写法给出真实代码；处理成功→done，失败→attempts+1、next_retry_at 指数退避（1min,5min,15min,1h,4h），attempts>=5→failed）。处理器：moment.created→链全体成员（除作者）插 notifications（payload 存标题快照：链名、作者昵称、moment 摘要，isBackfill=true 时跳过 push 但仍插通知并标记 backfill:true）；comment.created→moment 作者（非本人时）；reaction.created→moment 作者（非本人时）。push 通过 PushService 接口（src/push/push-service.ts 接口 + expo.ts 实现（expo-server-sdk）+ mock 实现），批量发送、处理 receipts、DeviceNotRegistered→push_tokens.invalidated_at。worker 与 API 同 codebase 不同进程。
4) momentSerializer 扩展：批量计数——feed/列表序列化时对一页 momentIds 各一次 GROUP BY（comments 数、reactions 按 emoji 分组、当前用户是否已点），严禁 N+1；计划给出改造后 serializer 完整代码。
5) dto：comments.ts + notifications.ts。测试：comments/reactions CRUD 与权限（viewer 可评论、非成员 404）；outbox→处理器函数级测试（直接调用 handler，不起 worker 进程）：moment.created 扇出正确人数、is_backfill 不 push、作者不自通知；push mock 验证 payload 与失效 token 处理；serializer 计数正确性与当前用户已点标记。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md（用 Write 工具）。
- 假设 Phase 1-4 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（routing-controllers 0.11/typedi/drizzle 0.45/zod 3/jest ESM/expo-server-sdk），重点核对 FOR UPDATE SKIP LOCKED 的 drizzle/mysql2 写法、upsert（onDuplicateKeyUpdate）、GROUP BY 批量计数。
2. 契约符合性：与 CONVENTIONS §3（§3.2 outbox、§3.4 serializer）逐字比对；与 spec §5.4 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏、测试断言同步更新）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase 5 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
