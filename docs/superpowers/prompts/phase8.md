# Phase 8 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 8 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase8-share-hardening.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 8 实施计划：分享与加固：share_links + 匿名公开页 + sweeper + 生产部署。

本计划范围与设计要点（spec §1 可见性、§3 share_links、§4 Public API、§5.5 防孤儿、§8、§9 部署运维）：
1) 表：share_links(id uuid, chain_id ref, token char(64) unique, created_by char(36), expires_at null, revoked_at null, created_at)。扩展 resetDb。
2) 端点：POST /api/chains/:chainId/share-links（owner，生成 token，可传 expiresAt）；GET /api/chains/:chainId/share-links（owner）；DELETE /api/share-links/:id（owner 吊销）。GET /api/public/share/:token（匿名，有效 token→链信息+moments 游标分页（复用查询 builder；互动数据给只读计数还是不给——做决定并写明），无效/过期/吊销→404 SHARE_NOT_FOUND）。GET /api/media/:id 扩展：?st=<shareToken> 时校验该 token 有效且 media 属于该链 → 放行 302（spec §5.3 的 share 透传点落地；跨链媒体拒绝）。
3) web /share/:token 公开只读页（复用 Phase 6 时间线渲染组件，隐藏一切互动与编辑入口；匿名可访问）。
4) sweeper（worker 新增定时处理器，node-cron 或 setInterval）：清理 uploading 超 24h 的 media 行 + 对应 S3 对象（含 abort 未完成 multipart）；清理软删超 30 天 moment 的媒体（S3 对象 + media 行硬删）。dry-run 日志先行。scripts/setup-s3-lifecycle.md 或 .ts：tmp/ 前缀 7 天过期 + AbortIncompleteMultipartUpload 7 天的 bucket lifecycle 配置步骤。
5) 生产化：docker-compose.yml 扩展为 server（build 后 node dist）+ worker + mysql + backup（mysqldump 定时 → S3，给出可运行配置）；.env.example 收尾（worker/backup 相关变量）；邀请 accept 等剩余敏感端点限流复核；express-rate-limit 评估升级 v8（解决 IPv6 keyGenerator 问题，Phase 1 评审遗留项）或记录决策；README 生产部署章节（备份恢复演练步骤）。
6) 测试：share_links CRUD 与匿名访问（有效/吊销/过期/跨链媒体拒绝）；media ?st= 鉴权矩阵；sweeper 逻辑单测（mock storage + 构造超期行）；全量回归。DoD：pnpm build && lint && test 全绿 + 生产 compose 手工验证清单。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase8-share-hardening.md（用 Write 工具）。
- 假设 Phase 1-7 已按计划执行完毕（web 已就绪，可复用其组件），其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 走 TDD（后端部分）或可验证步骤（部署部分：命令+预期输出），代码完整可运行，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM NodeNext 相对 import 带 .js；业务错误 HttpError 系 message 为 UPPER_SNAKE 机器码；新表必须扩展 tests/helpers/db.ts 的 resetDb；触库测试 afterAll(closeDb)；新环境变量同步 config.ts 与 .env.example。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase8-share-hardening.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（routing-controllers/drizzle/docker-compose/mysqldump 备份配置），重点核对匿名访问的鉴权边界（?st= 校验逻辑不能绕过成员校验）、sweeper 的并发安全（与 API 同时删同一 media）。
2. 契约符合性：与 CONVENTIONS §3（§3.6 路由总表、§3.3 storage）逐字比对；与 spec §5.3/§5.5 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码/完整配置的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase8-share-hardening.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏、测试断言同步更新）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase 8 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
