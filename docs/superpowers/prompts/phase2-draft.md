你在为「时刻 Moment」项目编写 Phase 2 实施计划：时光链：chains + 成员/角色 + ChainPolicy + 邀请闭环。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

本计划范围与设计要点：
1) 三张表：chains(id uuid pk, name varchar(100), description text null, cover_media_id char(36) null（引用未来 media 表，本阶段不加外键，注明后续补）, visibility enum(private,link,public) default private, owner_id char(36) ref users.id, created_at, updated_at)；chain_members(chain_id, user_id, role enum(owner,editor,viewer), joined_at, 联合主键(chain_id,user_id))；chain_invites(id uuid, chain_id ref, token char(64) unique, email varchar(255) null, role enum(editor,viewer) default editor, created_by char(36), expires_at, accepted_at null, created_at)。扩展 resetDb。
2) ChainPolicy 与 requireChainRole 中间件工厂，严格按 CONVENTIONS §3.1 的签名与错误码（CHAIN_ROLE_INSUFFICIENT / CHAIN_NOT_FOUND）。policy 单测覆盖 3 角色 × 全部操作的矩阵。
3) 端点：POST /api/chains（创建者在同一事务自动成为 owner 成员）；GET /api/chains（我参与的，含我的角色，join chain_members）；GET /api/chains/:chainId（viewer+）；PATCH /api/chains/:chainId（owner）；DELETE /api/chains/:chainId（owner，级联策略写明：members 硬删、invites 硬删，moments/media 尚未存在，注明后续阶段补级联）；GET /api/chains/:chainId/members（viewer+）；PATCH /api/chains/:chainId/members/:userId（owner 改角色，禁止改自己，禁止把别人改成 owner——转让走专门端点）；DELETE /api/chains/:chainId/members/:userId（owner 移除他人，或本人退链；owner 退链返回 409 OWNER_MUST_TRANSFER）；POST /api/chains/:chainId/transfer（owner 转让，同事务改 chains.owner_id 与两边 members 角色）。
4) 邀请：POST /api/chains/:chainId/invites（owner/editor，生成不可猜测 token，role 仅 editor/viewer，默认 7 天过期）；GET /api/chains/:chainId/invites（owner）；DELETE /api/invites/:inviteId（owner 吊销）；POST /api/invites/:token/accept（@Authorized 登录用户，幂等：已是成员返回 200 原角色；过期/不存在 410/404；invite.email 非空且不匹配当前用户邮箱时 403 INVITE_EMAIL_MISMATCH；成功后同事务写 member + accepted_at + emitOutbox 不需要——outbox Phase 3 才有，注明）。accept 端点挂 authRateLimiter。
5) dto：packages/dto/src/chains.ts（CreateChainInput/UpdateChainInput/ChainDto/ChainMemberDto/InviteDto/AcceptInviteResponse 等，zod + interface）。
6) 测试：policy 矩阵单测；全部端点集成测试（含越权：非成员访问 404、viewer 调 PATCH 403、owner 退链 409、转让后旧 owner 变 editor、invite 幂等/过期/邮箱不匹配）。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase2-chains.md（用 Write 工具）。
- 假设编号小于 2 的所有 Phase 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖（范围内每条要求能指到具体 Task）、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
