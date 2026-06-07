---
paths:
  - "apps/server/tests/**"
  - "packages/*/src/**/*.test.ts"
---

# 测试规则

- server 测试（`apps/server/tests/`）打 `.env` 指向的**真实测试库**，严禁指向生产库；可用 `apps/server/.env.test`（已 gitignore）覆盖配置。
- jest 以 `--runInBand` 串行运行；触库测试文件必须 `afterAll(closeDb)`，并用 `tests/helpers/db.ts` 的 `resetDb()` 清理数据。
- 新增数据表时必须同步扩展 `resetDb()`（按外键依赖逆序 delete），否则跨文件脏数据会导致顺序相关失败。
- `packages/dto`、`packages/api-client` 的测试与源文件同目录（`*.test.ts`），不触库。
- 测试先于实现失败一次（TDD 红灯）再实现，是计划文档的默认流程；修复测试时不要为了绿灯弱化断言。
