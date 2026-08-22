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

一台机器跑完整栈：`web`（nginx，静态页 + `/api` 反代）· `server` · `worker` · `mysql` · `backup`。

前置：

- Docker Compose v2
- 一块 **S3 兼容私有桶**（阿里云 OSS / AWS / R2）。预签名 URL 会发给浏览器，所以 `ATTACHMENT_S3_ENDPOINT` 必须是公网可访问地址。server 不配齐 `ATTACHMENT_S3_*` 会拒绝启动。
- 可选：域名 + HTTPS（Caddy / Cloudflare / 反代到 `MOMENT_HTTP_PORT`）

### 启动栈

```bash
# 1) 环境变量（真实凭据已 gitignore，严禁提交）
cp deploy/.env.example .env
# 必改：MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD / JWT_SECRET（≥32）
#       ATTACHMENT_S3_* 与 BACKUP_S3_*
# JWT_SECRET=$(openssl rand -base64 48)

# 2) 一次性配置附件桶 lifecycle（tmp/ 7 天过期 + 未完成 multipart 7 天中止）
#    需要本机 pnpm；只做一次
pnpm install && pnpm --filter @moment/server setup:s3-lifecycle

# 3) 构建并启动（没有 compose 插件时把 docker compose 换成 docker-compose）
docker compose -f docker-compose.prod.yml up -d --build

# 4) 数据库迁移（首次与每次发版）
docker compose -f docker-compose.prod.yml run --rm server node dist/db/migrate.js
```

浏览器打开 `http://<主机>:${MOMENT_HTTP_PORT:-80}`。API 不要单独暴露 3000，一律走 nginx 同源 `/api`。

发版：拉代码后重复步骤 3–4。

Expo App 把 `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WEB_URL` 指到这个公网 origin（含协议，无尾斜杠）。

HTTPS 示例（宿主机 Caddy 反代 compose 的 80 端口）：

```
moment.example.com {
    reverse_proxy 127.0.0.1:80
}
```

本地开发仍用根目录 `docker-compose.yml`：`docker compose up -d mysql`。

### sweeper 上线

`deploy/.env.example` 默认 `SWEEPER_DRY_RUN=true`。`docker compose -f docker-compose.prod.yml logs -f worker` 观察一轮（每 `SWEEPER_INTERVAL_MS`，默认 1h）确认 `would delete` 符合预期，再改 `.env` 为 `false` 后 `docker compose -f docker-compose.prod.yml up -d worker`。

### 备份与恢复演练

backup sidecar 每 `BACKUP_INTERVAL_SECONDS`（默认 86400s）执行 `mysqldump --single-transaction | gzip | aws s3 cp` 到 `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/`；启动后立即跑首轮。**每季度至少做一次恢复演练**：

```bash
# 1) 找最新备份
aws s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} | tail -1

# 2) 恢复到一次性验证库（严禁直接覆盖生产库）
#    MYSQL_ROOT_PASSWORD 取 .env 里的值。导入必须用 root：moment 用户只有本库授权。
docker compose -f docker-compose.prod.yml exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "CREATE DATABASE moment_restore_drill"
aws s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<file>.sql.gz" - ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} \
  | gunzip \
  | docker compose -f docker-compose.prod.yml exec -T mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill

# 3) 校验：表齐全 + 关键表行数与生产同量级
docker compose -f docker-compose.prod.yml exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" moment_restore_drill \
  -e "SHOW TABLES; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM moments; SELECT COUNT(*) FROM share_links;"

# 4) 销毁演练库
docker compose -f docker-compose.prod.yml exec mysql mysql -uroot -p"<MYSQL_ROOT_PASSWORD>" -e "DROP DATABASE moment_restore_drill"
```

## Spec

产品与设计的权威文档在 [`docs/superpowers/specs/`](docs/superpowers/specs/)：

- [产品设计 & 技术架构](docs/superpowers/specs/2026-08-15-moment-design.md)
- [Web 产品](docs/superpowers/specs/2026-08-16-web-product.md)
- [链模板](docs/superpowers/specs/2026-08-20-chain-templates-design.md)
- [AI 月度回顾](docs/superpowers/specs/2026-08-20-ai-recap-design.md)
