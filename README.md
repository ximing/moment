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

## 生产部署

### 启动栈

```bash
# 1) 准备环境（真实凭据，已 gitignore，严禁提交）
cp apps/server/.env.example apps/server/.env   # 若不存在
# 编辑 .env：MYSQL_*（生产库）、JWT_SECRET（≥32 随机）、ATTACHMENT_S3_*（生产桶，PREFIX 如 prod/attachments）、BACKUP_S3_*

# 2) 一次性配置 S3 bucket lifecycle（tmp/ 7 天过期 + 未完成 multipart 7 天中止，spec §5.5）
pnpm install && pnpm --filter @moment/server setup:s3-lifecycle

# 3) 构建并启动（server + worker + mysql + backup）
docker compose build
docker compose up -d

# 4) 数据库迁移（首次与每次发版）
docker compose run --rm server node dist/db/migrate.js
```

### sweeper 上线流程（dry-run 先行）

首次部署（或调整保留期）时，先在 `.env` 设 `SWEEPER_DRY_RUN=true`，`docker compose up -d worker` 后观察一轮日志（`docker compose logs -f worker`，每 `SWEEPER_INTERVAL_MS` 一轮，默认 1h）确认 `would delete` 的行符合预期，再改回 `false` 重启 worker。

### 备份与恢复演练

backup sidecar 每 `BACKUP_INTERVAL_SECONDS`（默认 86400s）执行 `mysqldump --single-transaction | gzip | aws s3 cp` 到 `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/`；启动后立即跑首轮。**每季度至少做一次恢复演练**：

```bash
# 1) 找最新备份
aws s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} | tail -1

# 2) 恢复到一次性验证库（严禁直接覆盖生产库）
#    MYSQL_ROOT_PASSWORD 取部署时 compose 里为 mysql service 设定的值（本地 dev compose 默认为 moment_root_dev）。
#    导入/校验必须用 root：moment 用户只有 moment_dev.* 库级授权，对 root 新建的演练库无权限（Access denied）。
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "CREATE DATABASE moment_restore_drill"
aws s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<file>.sql.gz" - ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} \
  | gunzip \
  | docker compose exec -T mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill

# 3) 校验：表齐全 + 关键表行数与生产同量级
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill \
  -e "SHOW TABLES; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM moments; SELECT COUNT(*) FROM share_links;"

# 4) 销毁演练库
docker compose exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "DROP DATABASE moment_restore_drill"
```

### web 部署

web 为静态产物：`pnpm --filter @moment/web build` → `apps/web/dist/`，托管到任意静态服务/nginx，与 API **同源**部署并反代 `/api` 到 server:3000（媒体 302 与分享页均依赖同源相对路径）。
