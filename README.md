# 时刻 Moment

多用户时光链记录应用。Spec: docs/superpowers/specs/2026-08-15-moment-design.md

## 快速开始

```bash
pnpm install
# 若 apps/server/.env 已存在（含真实凭据）请跳过本步，切勿覆盖
[ -f apps/server/.env ] || cp apps/server/.env.example apps/server/.env
# 若上一步刚新建 .env（指向本地库），先起本地 MySQL：
# docker compose up -d mysql
# 确保 .env 含 JWT_SECRET（≥32 字符），缺失则：
# echo "JWT_SECRET=$(openssl rand -base64 48)" >> apps/server/.env
pnpm build                                      # 先构建 dto 等依赖包
pnpm --filter @moment/server migrate            # 跑数据库迁移
pnpm dev                                        # 启动全部 dev 服务
```

## 数据库说明

- 当前团队的测试库是远程 MySQL（已配置在 `apps/server/.env`，测试/开发都用它）。
- `docker compose up -d mysql` 起的是**本地开发库**（`moment_dev`），供无远程库访问权时使用；
  使用时把 `.env` 的 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 改为 `.env.example` 中的本地值。

## 测试

```bash
pnpm --filter @moment/server test   # 打 .env 指向的库（必须是测试库，严禁生产库！）
```

- 测试配置隔离：可建 `apps/server/.env.test`（已 gitignore），优先级高于 `.env`。

## 结构

- apps/server — Express API（routing-controllers + TypeDI + Drizzle）
- packages/dto — 共享 zod schema 与类型
- config/ — 共享 tsconfig / eslint
