你在为「时刻 Moment」项目编写 Phase 7 实施计划：移动 App：Expo RN 全功能 + 分片上传 + Expo Push。

动手前完整阅读（按此顺序）：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆（真实代码、TDD 步骤、Interfaces 块、每 Task commit）

本计划范围与设计要点（spec §2 App 选型、§5.5 客户端压缩、§5.4 推送、CONVENTIONS §4）：
1) apps/app（@moment/app）：Expo（最新稳定 SDK）+ expo-router + TanStack Query + @moment/api-client + @moment/dto。tokenStore 用 expo-secure-store 实现（api-client 约定的接口）。API 地址走 app.config.ts 的 extra.apiUrl（环境切换说明写入计划）。
2) 页面镜像 web：登录/注册、feed（FlashList 或 FlatList 无限滚动、过滤）、链列表/链详情（成员/邀请/tag）、发布（三种类型、expo-image-picker 多选图与视频、expo-image-manipulator 压图到 2048px 内、视频大小/时长校验（≤500MB/≤5min，超出提示用户先系统相册压缩）、happened_at 选择（@react-native-community/datetimepicker）、is_backfill、tag）、moment 详情（评论/表情）、通知列表、邀请接受深链接。
3) 上传：api-client multipart helper（分片串行 + 每片重试 + onProgress），App 端注意后台/断网中断后重新 complete 的幂等性（服务端已幂等，客户端重试整个 complete 即可）。
4) 推送：expo-notifications 申请权限 → getExpoPushTokenAsync → POST /api/devices/push-token（登录后 + token 变化时）；通知点击 response listener 跳转对应 moment；eas.json（development/preview/production 三 profile）；app.json 配置 bundleIdentifier/package/scheme。
5) 验证：typecheck + lint + expo export 或 prebuild 可通过；DoD 为真机/模拟器手动验收清单（含推送在真机验证的步骤说明）。组件代码真实完整，样式简洁。

硬性要求：
- 输出写入文件：/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase7-expo-app.md（用 Write 工具）。
- 假设 Phase 1-6 已按计划执行完毕（api-client 已就绪），其代码与 CONVENTIONS 契约可直接引用；引用符号必须与 CONVENTIONS §3 完全一致，不得改名。
- 格式完全对齐 Phase 1：头部（Goal/Architecture/Tech Stack/Spec/Global Constraints——只写本计划新增约束）+ Task N（Files/Interfaces/Steps）。Steps 同样要求可验证（typecheck/lint/export/手动步骤），组件代码完整，严禁任何占位符（TBD/TODO/"适当处理"/"类似 Task N"）。
- 工程约定：dto 复用 @moment/dto 的 zod schema；API 调用一律走 @moment/api-client，不允许组件里裸 fetch。
- 写完后自查三遍：spec 覆盖、占位符扫描、跨 Task 类型/命名一致性。发现问题直接改。
- 你的最终回复只返回：文件路径 + Task 标题列表 + 关键设计决策（≤10 行）。
