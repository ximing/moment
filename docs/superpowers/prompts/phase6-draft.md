你在为「时刻 Moment」项目编写 Phase 6 实施计划：共享客户端与 Web：packages/api-client + apps/web 全功能。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

本计划范围与设计要点（spec §2 Web 选型、§4 全部已建 API、CONVENTIONS §4 测试策略）：
1) packages/api-client（@moment/api-client）：createMomentClient({baseUrl, tokenStore})；tokenStore 接口 {getAccessToken,getRefreshToken,setTokens,clear}（web 用 localStorage 实现、app 用 expo-secure-store 实现，各自在自己的 app 包里提供）；fetch 封装：自动带 Bearer、401 时单飞 refresh（并发请求只 refresh 一次，其余等待）后重放一次、refresh 失败 clear 并抛 ApiError；ApiError 携带服务端 error.code/message/status；typed methods 覆盖 Phase 1-5 全部端点（auth/chains/members/invites/moments/media/tags/feed/comments/reactions/notifications/devices），媒体上传 helper（put 直传 + multipart 分片串行带每片重试与 onProgress 回调，不得挡死上传进度——spec 原文要求）。测试：mock fetch 或 msw 覆盖 refresh 单飞/错误透传/重试。
2) apps/web（@moment/web）：Vite + React 19 + TS + TanStack Query + React Router。UI 选型先读 /Users/ximing/project/mygithub/aimo/apps/web/package.json 与 src 结构，沿用其方案（若 aimo 用 Tailwind 则 Tailwind，组件库同理）；在计划中写明你观察到的 aimo 选型并照搬。
3) 页面与路由：/login、/register（表单校验用 dto zod schema）、/（feed：无限滚动游标分页、链/tag 过滤 chips、happened_at|created_at 排序切换）、/chains（我的链列表 + 创建）、/chains/:id（链时间线 + 成员管理（owner）+ 邀请生成 + tag 管理）、发布 moment（链内 composer：三种类型切换、图片九宫格选择预览、视频选择显示大小/时长、happened_at 日期时间选择、is_backfill 开关、tag 选择；上传走 api-client multipart helper 带进度条）、moment 详情（评论列表/发评论/表情 reaction 选择与取消）、/notifications（未读标记）、/invites/:token（登录态接受邀请，未登录跳登录后回来）。公开分享页 /share/:token 不做（Phase 8）。
4) 状态：TanStack Query 管理服务端状态（feed 用 useInfiniteQuery，mutation 后精确 invalidate）；本地 auth 状态一个轻量 context。
5) 验证：typecheck + build + lint 必须通过；测试不做组件测试（CONVENTIONS §4），DoD 写手动验收清单（逐页面可执行步骤）。计划代码量很大，Task 切分按「api-client 包 / web 骨架+路由+auth / feed+链 / 发布+上传 / 互动+通知」分组，每组的组件代码必须真实完整（不允许「类似上一个组件」），但样式可以简洁。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase6-api-client-web.md（用 Write 工具）。
- 假设 Phase 1-5 已按计划执行完毕，其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。前端计划的 Steps 同样要求可验证（typecheck/build/lint/手动步骤），组件代码完整，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：ESM；dto 复用 @moment/dto 的 zod schema；API 调用一律走 @moment/api-client，不允许组件里裸 fetch。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性（特别是 api-client 方法名与组件使用处）。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
