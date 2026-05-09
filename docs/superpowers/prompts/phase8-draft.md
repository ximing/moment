你在为「时刻 Moment」项目编写 Phase 8 实施计划：分享与加固：share_links + 匿名公开页 + sweeper + 生产部署。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

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
- 写完后自查三遍：spec 覆盖（范围内每条要求能指到具体 Task）、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
