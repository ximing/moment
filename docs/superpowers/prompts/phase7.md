# Phase 7 计划生产流程（调度 prompt）

你是调度主 Agent。目标：产出一份评审通过的 Phase 7 实施计划 `/Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase7-expo-app.md`。**你不亲自撰写计划内容**，一切通过派 SubAgent 完成（用 Agent 工具）。

## 背景文件（每个 SubAgent 的 prompt 里都必须附上，要求先读完再动手）

1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约（强制）
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划，格式与详细程度标杆

## 流程

### 第 1 步：派「起草 SubAgent」

prompt 如下（原样转发，并附上上面 3 个背景文件路径）：

---
你在为「时刻 Moment」项目编写 Phase 7 实施计划：移动 App：Expo RN 全功能 + 分片上传 + Expo Push。

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
---

### 第 2 步：派「评审 SubAgent」

prompt 如下（原样转发，附上背景文件路径）。评审 SubAgent **只输出问题清单，不得修改文件**：

---
你是苛刻的技术评审，对抗性审阅实施计划文件 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase7-expo-app.md。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（Expo SDK/expo-router/expo-notifications/expo-image-picker/expo-secure-store/TanStack Query v5），重点核对推送 token 注册流程、深链接配置、multipart 上传在 RN 的实现（Blob/FormData 差异）。
2. 契约符合性：与 Phase 6 的 api-client 接口（tokenStore/createMomentClient/multipart helper 签名）逐字比对；路由与 spec §4 端点一致。
3. 自洽性：Task 间 Consumes/Produces 无悬空引用；组件里用到的方法有定义；依赖的「前序 Phase 已落地符号」确实存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
---

### 第 3 步：修复循环（最多 3 轮）

若评审返回阻塞/高危问题：派「修复 SubAgent」，prompt 为：

---
修复实施计划 /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase7-expo-app.md 的以下评审问题。逐条落实（用 Edit 精确修改），全部改完后自查未引入新问题（类型一致、契约未破坏）。低危问题顺手处理。

<此处粘贴评审 SubAgent 返回的完整问题清单>

你的最终回复只返回：每条问题的处理结果（已修/无需修+原因），≤15 行。
---

修复后回到第 2 步派**新的**评审 SubAgent 复审。最多 3 轮；仍有阻塞则停止，向用户报告评审意见原文并等待指示。

### 第 4 步：收尾

无阻塞/高危后：git add 该计划文件并 commit（`docs: Phase 7 实施计划（起草+评审通过）`）。最终返回：文件路径、Task 标题列表、评审轮数、残留中/低危问题清单（如有）。
