你在为「时刻 Moment」项目编写 Phase 4 实施计划：标签与聚合时间线：tags + 复合游标 feed。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

本计划范围与设计要点（spec §3 tags/moment_tags、§4 Tags/Feed API、§5.1 Feed 查询、§5.6 补发可见性）：
1) 表：tags(id uuid, chain_id ref, name varchar(50), created_at，unique(chain_id,name))；moment_tags(moment_id ref, tag_id ref，联合主键)。扩展 resetDb。
2) tags 端点：GET /api/chains/:chainId/tags（viewer+，含每 tag 的 moment 数，一次 GROUP BY）；POST /api/chains/:chainId/tags（editor+，每链上限 100，超限 409 TAG_LIMIT_REACHED；重名 409 TAG_EXISTS）；DELETE /api/tags/:id（editor+，反查链鉴权，先硬删 moment_tags 关联再硬删 tag，一个事务）。
3) moments 扩展：POST /api/chains/:chainId/moments 与 PATCH /api/moments/:id 接受 tagIds（string[]），同事务校验全部 tag 属于该链（否则 400 TAG_NOT_IN_CHAIN）后重建 moment_tags。需要修改 Phase 3 的 moments service/dto——计划里给出精确的修改点与新代码（executor 会在已落地的 Phase 3 代码上改）。
4) feed：GET /api/feed?cursor=&chainIds=&tagId=&order=happened_at|created_at&limit=。实现要点全部按 spec §5.1 与 CONVENTIONS §3.4：请求入口一次查出我的 chain_id+role 集合（复用 chain_members 查询，进 request 上下文，不 join）；WHERE chain_id IN (...) AND deleted_at IS NULL + 复合游标条件 (happened_at, id) < cursor（order=created_at 时用 (created_at, id)）；ORDER BY happened_at DESC, id DESC LIMIT n；tagId 过滤以 moment_tags(tag_id, moment_id) 为驱动表；chainIds 参数可收窄范围但必须是我的链子集（含非我的链 id 时静默过滤并注明理由）。order=created_at 是补发可见性的次要排序。响应复用 momentSerializer，含 nextCursor（无更多时为 null）。
5) 链内 moments 列表（Phase 3）重构为与 feed 共用同一查询 builder（cursor/where 组装），计划给出重构后的代码。
6) dto：tags.ts + feed.ts。测试：tag CRUD/上限/重名/级联删；feed 跨链聚合正确性（只看得到我的链）、同 happened_at 多 moment 翻页不丢不重、tag 过滤、order=created_at 下补发可见、游标损坏 400 INVALID_CURSOR、chainIds 收窄。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase4-tags-feed.md（用 Write 工具）。
- 假设编号小于 4 的所有 Phase 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖（范围内每条要求能指到具体 Task）、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
