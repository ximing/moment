# Phase 2 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 2 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase2-chains.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 2 实施计划：时光链：chains + 成员/角色 + ChainPolicy + 邀请闭环。

本计划范围与设计要点：
1) 三张表：chains(id uuid pk, name varchar(100), description text null, cover_media_id char(36) null（引用未来 media 表，本阶段不加外键，注明后续补）, visibility enum(private,link,public) default private, owner_id char(36) ref users.id, created_at, updated_at)；chain_members(chain_id, user_id, role enum(owner,editor,viewer), joined_at, 联合主键(chain_id,user_id))；chain_invites(id uuid, chain_id ref, token char(64) unique, email varchar(255) null, role enum(editor,viewer) default editor, created_by char(36), expires_at, accepted_at null, created_at)。扩展 resetDb。
2) ChainPolicy 与 requireChainRole 中间件工厂，严格按 CONVENTIONS §3.1 的签名与错误码（CHAIN_ROLE_INSUFFICIENT / CHAIN_NOT_FOUND）。policy 单测覆盖 3 角色 × 全部操作的矩阵。
3) 端点：POST /api/chains（创建者在同一事务自动成为 owner 成员）；GET /api/chains（我参与的，含我的角色，join chain_members）；GET /api/chains/:chainId（viewer+）；PATCH /api/chains/:chainId（owner）；DELETE /api/chains/:chainId（owner，级联策略写明：members 硬删、invites 硬删，moments/media 尚未存在，注明后续阶段补级联）；GET /api/chains/:chainId/members（viewer+）；PATCH /api/chains/:chainId/members/:userId（owner 改角色，禁止改自己，禁止把别人改成 owner——转让走专门端点）；DELETE /api/chains/:chainId/members/:userId（owner 移除他人，或本人退链；owner 退链返回 409 OWNER_MUST_TRANSFER）；POST /api/chains/:chainId/transfer（owner 转让，同事务改 chains.owner_id 与两边 members 角色）。
4) 邀请：POST /api/chains/:chainId/invites（owner/editor，生成不可猜测 token，role 仅 editor/viewer，默认 7 天过期）；GET /api/chains/:chainId/invites（owner）；DELETE /api/invites/:inviteId（owner 吊销）；POST /api/invites/:token/accept（@Authorized 登录用户，幂等：已是成员返回 200 原角色；过期/不存在 410/404；invite.email 非空且不匹配当前用户邮箱时 403 INVITE_EMAIL_MISMATCH；成功后同事务写 member + accepted_at + emitOutbox 不需要——outbox Phase 3 才有，注明）。accept 端点挂 authRateLimiter。
5) dto：packages/dto/src/chains.ts（CreateChainInput/UpdateChainInput/ChainDto/ChainMemberDto/InviteDto/AcceptInviteResponse 等，zod + interface）。
6) 测试：policy 矩阵单测；全部端点集成测试（含越权：非成员访问 404、viewer 调 PATCH 403、owner 退链 409、转让后旧 owner 变 editor、invite 幂等/过期/邮箱不匹配）。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase2-chains.md（用 Write 工具）。
- 假设 Phase 1 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD：写失败测试→运行确认失败→最小实现→运行确认通过→commit，每步 2-5 分钟粒度，代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase2-chains.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（routing-controllers 0.11/typedi/drizzle 0.45/zod 3/jest ESM/tsx），含 API 用法、类型、异步、事务写法。
2. 契约符合性：与 CONVENTIONS §3 的接口签名/错误码/路由总表逐字比对；与 spec 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase2-chains.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏、测试断言同步更新）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase N 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
