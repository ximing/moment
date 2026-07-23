# 时刻 Moment

把此刻发生的事记成 **moment**，收进一条可邀请、可分享的 **时光链（chain）**。

给家里人用的时间线：父母一起记，长辈打开链接就能翻。典型场景是亲子成长、家庭相册、情侣或兴趣小组的共同记录。

## 能做什么

- **链**：主题时间线，成员角色为 owner / editor / viewer
- **时刻**：文字、图文、视频；可补记发生时间
- **互动**：标签、评论、表情；应用内通知 + Expo Push
- **分享**：只读链接，长辈不用注册
- **那年今日**：回到往年的同一天
- **链模板**：宝宝成长 / 旅行 / 日常，结构化记录（里程碑、身高体重、足迹）
- **AI 月度回顾**：每月初自动生成上月回顾并推给全家

客户端：Web（平板 / 电脑）+ Expo App（iOS / Android）。后端是一份 API。

## 结构

```
moment/
├── apps/
│   ├── server/     # Express API + worker（routing-controllers · TypeDI · Drizzle · MySQL）
│   ├── web/        # Vite + React 家庭时间线
│   └── app/        # Expo React Native
├── packages/
│   ├── dto/        # 跨端 zod schema 与类型
│   └── api-client/ # 类型化 HTTP client
├── config/         # 共享 tsconfig / eslint
├── backup/         # MySQL 备份 sidecar
└── docs/superpowers/specs/   # 产品与设计 spec
```

pnpm workspace + Turbo。Node ≥ 20，TypeScript ESM。

## 快速开始

```bash
pnpm install

# 若 apps/server/.env 已存在（含真实凭据）请跳过，切勿覆盖
[ -f apps/server/.env ] || cp apps/server/.env.example apps/server/.env
# 确保 JWT_SECRET ≥ 32 字符：
# echo "JWT_SECRET=$(openssl rand -base64 48)" >> apps/server/.env

docker compose up -d mysql
pnpm build                                      # 先构建 dto 等依赖包
pnpm --filter @moment/server migrate
pnpm dev                                        # server :3000 · web :5173 · 全部并行
```

| 服务 | 地址 |
|------|------|
| API | http://localhost:3000 |
| Web | http://localhost:5173（dev 代理 `/api` → server） |
| App | `pnpm --filter @moment/app start`，默认打 `http://localhost:3000` |

媒体上传需要 S3 兼容私有桶（见 `.env.example` 的 `ATTACHMENT_S3_*`）。不配存储时仍可跑通文字时刻。AI 回顾默认关闭，配置 `LLM_API_KEY` 后才会出域调用 LLM。

## 测试

```bash
pnpm --filter @moment/server test   # 打 .env 指向的库（必须是测试库，严禁生产库）
pnpm --filter @moment/web test
```

可另建 `apps/server/.env.test`（已 gitignore），优先级高于 `.env`。

## 自托管

### 启动栈

```bash
# 1) 准备环境（真实凭据已 gitignore，严禁提交）
cp apps/server/.env.example apps/server/.env   # 若不存在
# 编辑 .env：MYSQL_*（生产库）、JWT_SECRET（≥32 随机）、
# ATTACHMENT_S3_*（生产桶，PREFIX 如 prod/attachments）、BACKUP_S3_*

# 2) 一次性配置 S3 bucket lifecycle（tmp/ 7 天过期 + 未完成 multipart 7 天中止）
pnpm install && pnpm --filter @moment/server setup:s3-lifecycle

# 3) 构建并启动（server + worker + mysql + backup）
docker compose build
docker compose up -d

# 4) 数据库迁移（首次与每次发版）
docker compose run --rm server node dist/db/migrate.js
```

### sweeper 上线

首次部署（或调整保留期）时，先在 `.env` 设 `SWEEPER_DRY_RUN=true`，`docker compose up -d worker` 后观察一轮日志（`docker compose logs -f worker`，每 `SWEEPER_INTERVAL_MS` 一轮，默认 1h）确认 `would delete` 的行符合预期，再改回 `false` 重启 worker。

### 备份与恢复演练

backup sidecar 每 `BACKUP_INTERVAL_SECONDS`（默认 86400s）执行 `mysqldump --single-transaction | gzip | aws s3 cp` 到 `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/`；启动后立即跑首轮。**每季度至少做一次恢复演练**：

```bash
# 1) 找最新备份
aws s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} | tail -1

# 2) 恢复到一次性验证库（严禁直接覆盖生产库）
#    MYSQL_ROOT_PASSWORD 取部署时 compose 里为 mysql service 设定的值（本地 dev compose 默认为 moment_root_dev）。
#    导入/校验必须用 root：moment 用户只有 moment_dev.* 库级授权，对 root 新建的演练库无权限。
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

### Web 部署

Web 为静态产物：`pnpm --filter @moment/web build` → `apps/web/dist/`，托管到任意静态服务 / nginx，与 API **同源**部署并反代 `/api` 到 server:3000（媒体 302 与分享页均依赖同源相对路径）。

## Spec

产品与设计的权威文档在 [`docs/superpowers/specs/`](docs/superpowers/specs/)：

- [产品设计 & 技术架构](docs/superpowers/specs/2026-08-15-moment-design.md)
- [Web 产品](docs/superpowers/specs/2026-08-16-web-product.md)
- [链模板](docs/superpowers/specs/2026-08-20-chain-templates-design.md)
- [AI 月度回顾](docs/superpowers/specs/2026-08-20-ai-recap-design.md)
