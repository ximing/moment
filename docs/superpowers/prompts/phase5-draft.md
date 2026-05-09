你在为「时刻 Moment」项目编写 Phase 5 实施计划：互动与异步：评论 + 表情 + 通知 + outbox worker + 推送。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

本计划范围与设计要点（spec §3 comments/reactions/notifications/push_tokens、§4 对应 API、§5.4 outbox+worker、§5.1 计数）：
1) 表：comments(id uuid, moment_id ref, author_id ref, content text, created_at, deleted_at null)；reactions(id uuid, moment_id ref, user_id ref, emoji varchar(16), created_at，unique(moment_id,user_id))；notifications(id uuid, user_id ref, type varchar(32), payload json, read_at null, created_at，索引(user_id, read_at))；push_tokens(id uuid, user_id ref, expo_token varchar(128) unique, platform varchar(16), last_seen_at, invalidated_at null)。扩展 resetDb；扩展 src/outbox/types.ts（comment.created / reaction.created）。
2) 端点：GET /api/moments/:id/comments（moment 可见即可读，分页方式自定并写明）；POST /api/moments/:id/comments（viewer+，content 1-1000 字，事务：插 comment + emitOutbox(comment.created)）；DELETE /api/comments/:id（评论作者或链 owner，软删）；PUT /api/moments/:id/reaction（viewer+，body {emoji}，upsert，emoji 白名单（定义 8-12 个常用 emoji 常量于 dto），事务：upsert + emitOutbox(reaction.created)）；DELETE /api/moments/:id/reaction（硬删）；GET /api/notifications?unread=&cursor=；POST /api/notifications/read（body {ids[]}，仅本人的）；POST /api/devices/push-token（body {expoToken, platform}，upsert + last_seen_at）。
3) worker：apps/server/src/worker/index.ts 独立入口（package script "worker": "tsx watch src/worker/index.ts"），轮询 outbox（每 2s 一批，SELECT ... WHERE status=pending AND (next_retry_at IS NULL OR next_retry_at<=now) ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED——mysql2/drizzle 写法给出真实代码；处理成功→done，失败→attempts+1、next_retry_at 指数退避（1min,5min,15min,1h,4h），attempts>=5→failed）。处理器：moment.created→链全体成员（除作者）插 notifications（payload 存标题快照：链名、作者昵称、moment 摘要，isBackfill=true 时跳过 push 但仍插通知并标记 backfill:true）；comment.created→moment 作者（非本人时）；reaction.created→moment 作者（非本人时）。push 通过 PushService 接口（src/push/push-service.ts 接口 + expo.ts 实现（expo-server-sdk）+ mock 实现），批量发送、处理 receipts、DeviceNotRegistered→push_tokens.invalidated_at。worker 与 API 同 codebase 不同进程。
4) momentSerializer 扩展：批量计数——feed/列表序列化时对一页 momentIds 各一次 GROUP BY（comments 数、reactions 按 emoji 分组、当前用户是否已点），严禁 N+1；计划给出改造后 serializer 完整代码。
5) dto：comments.ts + notifications.ts。测试：comments/reactions CRUD 与权限（viewer 可评论、非成员 404）；outbox→处理器函数级测试（直接调用 handler，不起 worker 进程）：moment.created 扇出正确人数、is_backfill 不 push、作者不自通知；push mock 验证 payload 与失效 token 处理；serializer 计数正确性与当前用户已点标记。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase5-interactions-worker.md（用 Write 工具）。
- 假设编号小于 5 的所有 Phase 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖（范围内每条要求能指到具体 Task）、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
