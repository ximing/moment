---
paths:
  - "docs/superpowers/plans/**"
  - "docs/superpowers/prompts/**"
---

# 计划与提示词文档规则

- 编写/修改 Phase 计划前**必须先读** `docs/superpowers/plans/CONVENTIONS.md`（计划格式、代码基线、数据表约定、跨计划接口契约），其中接口契约（§3）不得改名或改语义。
- 计划头部格式：Goal / Architecture / Tech Stack / Spec 引用 / Global Constraints（只写本计划新增约束，通用约束继承 Phase 1，不重复抄）。
- 每个 Task：Files（精确路径）、Interfaces（Consumes/Produces 精确签名）、Steps（写失败测试 → 确认失败 → 最小实现 → 确认通过 → commit）。
- 代码必须完整可运行：严禁 TBD / TODO / 「适当处理」/「类似 Task N」等占位。
- 每 Task 一个 commit，conventional commits（`feat(server): ...` / `feat(web): ...` / `feat(app): ...`）。
- 写完自查：spec 覆盖、占位符扫描、跨 Task 类型一致性。
