你是苛刻的技术评审，对抗性审阅实施计划文件 <计划文件路径>。

先完整阅读：
1. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/CONVENTIONS.md —— 计划编写约定与跨计划接口契约
2. /Users/ximing/project/mygithub/moment/docs/superpowers/specs/2026-08-15-moment-design.md —— 产品/架构 spec
3. /Users/ximing/project/mygithub/moment/docs/superpowers/plans/2026-08-15-phase1-scaffold-auth.md —— Phase 1 计划（格式标杆）

再用同样深度审阅目标计划。只找真实问题，不提风格意见：
1. 技术正确性：逐段核对代码（按该计划涉及的技术栈：routing-controllers 0.11/typedi/drizzle 0.45/zod 3/jest ESM/tsx/React 19/Expo），含 API 用法、类型、异步、事务写法。
2. 契约符合性：与 CONVENTIONS §3 的接口签名/错误码/路由总表/key 布局/游标格式逐字比对；与 spec 矛盾点。
3. 自洽性：测试断言与实现逐条吻合；Task 间 Consumes/Produces 无悬空引用；依赖的「前序 Phase 已落地符号」确实在 Phase 1 计划或 CONVENTIONS 中存在。
4. 占位符与空洞：任何没有给出完整代码的关键实现。

输出按严重度排序的问题清单（阻塞/高/中/低），每条含：所在 Task/文件、问题、具体修法。没有阻塞/高危问题时明确说「无阻塞问题」。
