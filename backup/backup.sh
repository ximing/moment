#!/bin/bash
# 每日 mysqldump → gzip → S3（spec §9）。while/sleep 循环，不依赖 cron daemon。
# 首次启动立即跑一轮（便于部署后立刻验证）；失败不退出，下一轮重试。
# --no-tablespaces 必需：mysql:8.4 官方镜像给 MYSQL_USER 的授权是库级（moment_dev.*），
# 不含全局 PROCESS；MySQL 8.0.21+ mysqldump 默认导出 tablespace 信息，无 PROCESS 直接报错退出。
set -uo pipefail

: "${MYSQL_HOST:?missing MYSQL_HOST}"
: "${MYSQL_USER:?missing MYSQL_USER}"
: "${MYSQL_PASSWORD:?missing MYSQL_PASSWORD}"
: "${MYSQL_DATABASE:?missing MYSQL_DATABASE}"
: "${BACKUP_S3_BUCKET:?missing BACKUP_S3_BUCKET}"

MYSQL_PORT="${MYSQL_PORT:-3306}"
PREFIX="${BACKUP_S3_PREFIX:-backups/mysql}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
# awscli 只认 AWS_* 变量：从 BACKUP_S3_* 映射（compose 的 ${} 插值读不到 env_file，必须在脚本内做）
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${BACKUP_S3_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${BACKUP_S3_SECRET_ACCESS_KEY:-}}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${BACKUP_S3_REGION:-us-east-1}}"
ENDPOINT_ARGS=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  ENDPOINT_ARGS=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi

while true; do
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  FILE="moment-${MYSQL_DATABASE}-${TS}.sql.gz"
  echo "[backup] $(date -u +%FT%TZ) starting ${FILE}"
  if mysqldump -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" \
      --single-transaction --no-tablespaces --routines --triggers "$MYSQL_DATABASE" \
    | gzip \
    | aws s3 cp - "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${FILE}" "${ENDPOINT_ARGS[@]}"; then
    echo "[backup] $(date -u +%FT%TZ) uploaded s3://${BACKUP_S3_BUCKET}/${PREFIX}/${FILE}"
  else
    echo "[backup] $(date -u +%FT%TZ) FAILED ${FILE}（下一轮重试）" >&2
  fi
  sleep "$INTERVAL"
done
