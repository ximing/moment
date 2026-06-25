# Web E2E：design-system 视觉回归

可重放的 CSI E2E + 视觉回归：`e2e/cases/design-system-regression.md` 是人类可读的验收旅程，
`e2e/suites/design-system-regression.mjs` 是它的固化重放；24 张基线 PNG 的唯一生产者清单是
`e2e/baselines/manifest.json`。

## 硬前置

1. **CSI daemon + Chrome 扩展**：`curl -s http://127.0.0.1:10088/status` 的 `extension_connected` 必须为 `true`。
2. **专用、私有、非生产的本地 S3 兼容服务**（如本地 MinIO）。配置名为 `e2e` 的 `mc` alias 指向 loopback endpoint，然后：

   ```bash
   mc mb --ignore-existing e2e/moment-e2e
   mc anonymous set none e2e/moment-e2e
   ```

   绝不复用开发或生产桶。
3. **专用一次性数据库**：fixture CLI 守卫要求 `MYSQL_DATABASE` 整串精确等于 `moment_e2e`。
4. **被 gitignore 的 `apps/server/.env.e2e`**（真实凭据只在这里或 CI 非生产 secret store；tracked 内容零凭据）。字段清单：

   ```bash
   MYSQL_HOST=127.0.0.1            # 覆盖既有 MySQL 连接变量；不新增连接变量
   MYSQL_PORT=3306
   MYSQL_USER=<local-e2e-user>
   MYSQL_PASSWORD=<local-e2e-password>
   MYSQL_DATABASE=moment_e2e
   ATTACHMENT_S3_BUCKET=moment-e2e
   ATTACHMENT_S3_PREFIX=e2e/attachments
   ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9000
   ATTACHMENT_S3_IS_PUBLIC=false
   ATTACHMENT_S3_ACCESS_KEY_ID=<local-minio-key>       # 本地供给，禁止入库
   ATTACHMENT_S3_SECRET_ACCESS_KEY=<local-minio-secret> # 本地供给，禁止入库
   MOMENT_E2E_OWNER_EMAIL=owner.e2e@moment.invalid
   MOMENT_E2E_OWNER_PASSWORD=<local-only>
   MOMENT_E2E_VIEWER_EMAIL=viewer.e2e@moment.invalid
   MOMENT_E2E_VIEWER_PASSWORD=<local-only>
   # 可选覆盖（默认即守卫要求的值）：
   # E2E_API_BASE_URL=http://127.0.0.1:3000/api
   # E2E_WEB_BASE_URL=http://127.0.0.1:5173
   ```

   另需 `.env.e2e` 或环境提供 server 启动所需的其余常规变量（如 `JWT_SECRET`、S3 region 等），
   与 `apps/server/.env.example` 对齐。

## 运行（三个终端）

桶已建好且 ignored 环境已 source 之后：

```bash
# terminal 1: server; the ignored file contains only dedicated E2E values
set -a; source apps/server/.env.e2e; set +a
MOMENT_E2E=1 NODE_ENV=test PORT=3000 pnpm --filter @moment/server exec nodemon --exec "node --loader ts-node/esm" ./src/index.ts

# terminal 2: Web uses Vite's existing same-origin /api proxy
pnpm --filter @moment/web dev -- --host 127.0.0.1 --port 5173 --strictPort

# terminal 3: readiness, deterministic reset/seed, replay, deterministic teardown
set -a; source apps/server/.env.e2e; set +a
until curl -fsS http://127.0.0.1:3000/api/health | rg -q '"status":"ok"'; do sleep 0.2; done
until curl -fsS http://127.0.0.1:5173/ > /dev/null; do sleep 0.2; done
MOMENT_E2E=1 node --loader ts-node/esm apps/server/src/e2e/fixture-cli.ts preflight
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs reset
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs seed
pnpm --filter @moment/web e2e:design-system
MOMENT_E2E=1 node apps/web/e2e/fixtures/seed.mjs teardown
```

runner 自己拥有 `try/finally` teardown（正常、失败、中断、含 `--update-baselines` 都会执行），
所以最后一条 teardown 命令只是恢复/调试手段。

## 基线纪律

- 普通运行只写被 gitignore 的 `e2e/artifacts/{runId}/`（actual/diff/JSON 证据），绝不触碰基线。
- 只有人工视觉确认后才允许更新基线：

  ```bash
  pnpm --filter @moment/web e2e:design-system -- --update-baselines
  node apps/web/e2e/lib/manifest.mjs --verify
  ```

- 重放只读证明：

  ```bash
  node apps/web/e2e/lib/manifest.mjs --hashes > apps/web/e2e/artifacts/baselines.before.sha256
  pnpm --filter @moment/web e2e:design-system
  pnpm --filter @moment/web e2e:design-system
  node apps/web/e2e/lib/manifest.mjs --hashes > apps/web/e2e/artifacts/baselines.after.sha256
  cmp apps/web/e2e/artifacts/baselines.before.sha256 apps/web/e2e/artifacts/baselines.after.sha256
  ```
