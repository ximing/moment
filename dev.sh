#!/usr/bin/env bash
# 一键启动本地开发：迁移 + API :3000 + worker + Web :5173
# 数据库走 apps/server/.env（外部库已配好，不拉 Docker）
# 用法：
#   ./dev.sh          启动（已在跑则只打印地址）
#   ./dev.sh stop     停掉本脚本拉起的进程
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PID_FILE="${TMPDIR:-/tmp}/moment-dev.pids"
LOG_DIR="${TMPDIR:-/tmp}/moment-dev-logs"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  fi
}

healthy() {
  # 本机开发口不要走系统 HTTP 代理（否则 127.0.0.1 会被代理成 502）
  curl --noproxy '*' -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null
}

stop_dev() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "已停止 API / worker / Web"
}

if [[ "${1:-}" == "stop" ]]; then
  stop_dev
  exit 0
fi

need pnpm
need curl

if [[ ! -f apps/server/.env ]]; then
  echo "没有 apps/server/.env。外部库连接写在这个文件里，请先配好再启动。" >&2
  exit 1
fi

echo "构建 dto / api-client…"
pnpm --filter @moment/dto build
pnpm --filter @moment/api-client build

echo "数据库迁移…"
pnpm --filter @moment/server migrate

mkdir -p "$LOG_DIR"

start_one() {
  local name="$1"
  shift
  echo "starting ${name}"
  "$@" >"${LOG_DIR}/${name}.log" 2>&1 &
  echo $! >>"$PID_FILE"
}

if healthy http://localhost:3000/api/health; then
  echo "API 已在 :3000"
else
  if port_in_use 3000; then
    echo "端口 3000 已被占用且 /api/health 不通" >&2
    exit 1
  fi
  : >"$PID_FILE"
  start_one server pnpm --filter @moment/server dev
fi

if port_in_use 5173 && healthy http://localhost:5173/; then
  echo "Web 已在 :5173"
elif port_in_use 5173; then
  echo "端口 5173 已被占用（可能是反代）。请先停掉占用进程，或把 Vite 改到空闲端口。" >&2
  exit 1
else
  [[ -f "$PID_FILE" ]] || : >"$PID_FILE"
  start_one web pnpm --filter @moment/web dev
fi

if [[ -f "$PID_FILE" ]] && ! pgrep -f 'apps/server.*worker/index' >/dev/null 2>&1; then
  start_one worker pnpm --filter @moment/server worker
fi

api_ok=0
web_ok=0
for _ in $(seq 1 60); do
  healthy http://localhost:3000/api/health && api_ok=1
  healthy http://localhost:5173/ && web_ok=1
  if [[ "$api_ok" == 1 && "$web_ok" == 1 ]]; then
    break
  fi
  sleep 1
done

if [[ "$api_ok" != 1 ]]; then
  echo "API 未就绪。日志：$LOG_DIR/server.log" >&2
  tail -n 40 "$LOG_DIR/server.log" 2>/dev/null || true
  exit 1
fi
if [[ "$web_ok" != 1 ]]; then
  echo "Web 未就绪。日志：$LOG_DIR/web.log" >&2
  tail -n 40 "$LOG_DIR/web.log" 2>/dev/null || true
  exit 1
fi

cat <<EOF

开发环境已就绪
  Web   http://localhost:5173
  API   http://localhost:3000/api/health
  日志  $LOG_DIR
  停止  $ROOT/dev.sh stop

EOF
